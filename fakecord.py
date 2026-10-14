from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from selfbot.client import Client
from cache import CacheHandler
from threading import Thread, Event
from fastapi import FastAPI, HTTPException, WebSocket, Response
from pathlib import Path
from helpers import *
from requests.exceptions import RequestException, HTTPError
from contextlib import asynccontextmanager
from live import MessageHub
from pydantic import BaseModel, Field
import asyncio
import os
from dotenv import load_dotenv
import uvicorn
import json
import time


configs = loadf('configs.json')
load_dotenv(Path(__file__).resolve().parent / ".env")
discord_token = os.getenv("DISCORD_TOKEN")
if not discord_token:
    raise RuntimeError("Set DISCORD_TOKEN in .env before starting Fakecord")
gateway = Client(discord_token)
cache = CacheHandler(gateway)
async def subscribe_windows(groups):
    if gateway_loop and gateway_loop.is_running():
        future = asyncio.run_coroutine_threadsafe(gateway.subscribe(groups), gateway_loop)
        await asyncio.wrap_future(future)


hub = MessageHub(subscribe=subscribe_windows)
hub.resolve_source = cache.message_source
gateway_loop = None
refresh_started = False
gateway_user_id = None


@asynccontextmanager
async def lifespan(app):
    hub.loop = asyncio.get_running_loop()
    stopping = Event()

    async def run_gateway():
        global gateway_loop
        gateway_loop = asyncio.get_running_loop()
        while not stopping.is_set():
            try:
                await gateway._run()
            except Exception:
                pass
            finally:
                hub.connected = False
                cache.invalidate_messages()
                await hub.from_gateway({'type': 'CONNECTION', 'connected': False})
            if not stopping.is_set():
                await asyncio.sleep(5)

    thread = Thread(target=lambda: asyncio.run(run_gateway()), daemon=True)
    thread.start()
    try:
        yield
    finally:
        stopping.set()
        if gateway.ws and gateway_loop and gateway_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(gateway.ws.close(), gateway_loop)
            try:
                await asyncio.wait_for(asyncio.wrap_future(future), timeout=2)
            except (Exception, asyncio.CancelledError):
                pass
        hub.loop = None


@gateway.on("RAW_GATEWAY")
async def raw_gateway(data):
    await hub.from_gateway({'type': 'GATEWAY_LOG', 'data': data})


@gateway.on("READY")
async def ready(data):
    global refresh_started, gateway_user_id
    gateway_user_id = str(data.get("user", {}).get("id", ""))
    cache.invalidate_messages()
    await asyncio.to_thread(cache.check_ttl, 'guilds')
    if not refresh_started:
        cache.refresh_worker()
        refresh_started = True
    hub.connected = True
    await hub.from_gateway({'type': 'CONNECTION', 'connected': True})

@gateway.on("MESSAGE_CREATE")
async def message_create(data):
    cache.record_user_activity(data)
    await asyncio.to_thread(cache.receive_message, data)
    await hub.from_gateway({'type': 'MESSAGE_CREATE', 'data': data})


@gateway.on("TYPING_START")
async def typing_start(data):
    if str(data.get('user_id')) == gateway_user_id:
        return
    await hub.from_gateway({'type': 'TYPING_START', 'data': data})


app = FastAPI(
    title="Fakecord API",
    description="API for Fakecord.",
    version="0.1.0",
    lifespan=lifespan,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
@app.middleware("http")
async def fresh_frontend_assets(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith(("/static/js/", "/static/css/")):
        response.headers["Cache-Control"] = "no-store"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=FileResponse, include_in_schema=False)
async def root() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/guilds")
def guilds(response: Response, refresh: bool = False) -> list[dict]:
    try:
        cache.check_ttl('guilds', force=refresh)
    except (RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Could not load server list")
    response.headers["X-Cache-Last-Updated"] = str(cache.guilds_last_updated)
    return [
        {"id": str(guild["id"]), "name": guild["name"], "icon": guild.get("icon"), "banner": guild.get("banner")}
        for guild in (cache.guilds or [])
    ]


@app.get("/api/messages/global")
def global_messages():
    return cache.global_messages()


@app.get("/api/users/{user_id}")
def user_profile(user_id: str) -> dict:
    if not user_id.isdigit():
        raise HTTPException(status_code=400, detail="Invalid user ID")
    try:
        profile = cache.get_profile(user_id)
    except (RequestException, ValueError):
        activity = cache.get_user_activity(user_id)
        profile = activity[0]['message'].get('author', {}) if activity else {'id': user_id}
    return {key: profile.get(key) for key in (
        'id', 'username', 'global_name', 'discriminator', 'avatar', 'banner', 'accent_color', 'bot',
    )}


@app.get("/api/me")
def current_user(refresh: bool = False) -> dict:
    try:
        cache.check_ttl('me', force=refresh)
    except (RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Could not load your profile")
    # Only expose fields used by the UI, excluding private account details.
    return {key: (cache.me or {}).get(key) for key in (
        'id', 'username', 'global_name', 'discriminator', 'avatar', 'banner', 'accent_color',
    )}


@app.get("/api/dms")
def direct_messages(response: Response, refresh: bool = False) -> list[dict]:
    try:
        cache.check_ttl('dms', force=refresh)
    except (RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Could not load direct messages")
    response.headers["X-Cache-Last-Updated"] = str(cache.dms_last_updated)
    return [
        {key: dm.get(key) for key in ('id', 'type', 'name', 'icon', 'recipients', 'last_message_id')}
        for dm in (cache.dms or [])
    ]


@app.get("/api/guilds/{guild_id}/channels")
def guild_channels(guild_id: str) -> list[dict]:
    if not any(str(guild["id"]) == guild_id for guild in (cache.guilds or [])):
        raise HTTPException(status_code=404, detail="Guild not found")
    try:
        cache.update_channels(guild_id)
    except (RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Could not load guild channels")
    return cache.guild_channels[guild_id]['data']


@app.get("/api/channels/{channel_id}/messages")
def channel_messages(channel_id: str, before: str | None = None) -> list[dict]:
    if not channel_id.isdigit() or before is not None and not before.isdigit():
        raise HTTPException(status_code=400, detail="Invalid channel ID")
    try:
        messages = cache.get_messages(channel_id, before=before)
        for message in messages:
            cache.record_user_activity({**message, 'channel_id': channel_id})
        return messages
    except HTTPError as error:
        status = error.response.status_code if error.response is not None else 502
        details = {
            401: "Discord session is not authenticated",
            403: "You don't have access to this channel's message history",
            404: "This channel no longer exists or is unavailable",
            429: "Discord rate limit reached. Try again shortly",
        }
        headers = {}
        if status == 429 and error.response.headers.get('Retry-After'):
            headers['Retry-After'] = error.response.headers['Retry-After']
        raise HTTPException(
            status_code=status if status in details else 502,
            detail=details.get(status, "Discord could not load message history"),
            headers=headers,
        ) from error
    except (RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Could not load message history")


@app.get("/api/users/{user_id}/activity")
def user_activity(user_id: str):
    return cache.get_user_activity(user_id)


class MessagePayload(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    nonce: str = Field(min_length=1, max_length=25, pattern=r"^\d+$")


@app.post("/api/channels/{channel_id}/messages")
async def send_message(channel_id: str, payload: MessagePayload):
    if not channel_id.isdigit() or not payload.content.strip():
        raise HTTPException(status_code=400, detail="Invalid channel or empty message")
    try:
        response = await asyncio.to_thread(
            gateway.session.post,
            gateway.API['send_message'].format(channel_id=channel_id),
            json={'content': payload.content, 'nonce': payload.nonce, 'enforce_nonce': True},
            timeout=10,
        )
        response.raise_for_status()
        message = response.json()
    except HTTPError as error:
        response = error.response
        status = response.status_code if response is not None else 502
        details = {
            400: "Discord rejected this message",
            401: "Discord session is not authenticated",
            403: "You don't have permission to send messages here",
            404: "This channel is unavailable",
            429: "You're sending too quickly. Wait before trying again",
        }
        headers = {}
        if response is not None and status == 429:
            try:
                retry_after = response.json().get('retry_after')
            except ValueError:
                retry_after = None
            if retry_after is not None:
                headers['Retry-After'] = str(retry_after)
        raise HTTPException(status_code=status if status in details else 502,
                            detail=details.get(status, "Discord could not send this message"), headers=headers) from error
    except (RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Could not confirm sending. Retry to check the same message")
    await asyncio.to_thread(cache.receive_message, message)
    await hub.publish({'type': 'MESSAGE_CREATE', 'data': message})
    return message


@app.websocket("/ws/messages")
async def message_socket(socket: WebSocket):
    await hub.connect(socket)


if __name__ == "__main__":
    uvicorn.run("fakecord:app", host="127.0.0.1", port=8000, reload=True)
