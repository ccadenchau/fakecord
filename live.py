"""Bridge gateway events onto the FastAPI event loop."""
import asyncio
import json
import time
from collections import deque
from fastapi import WebSocket, WebSocketDisconnect


class MessageHub:
    def __init__(self, subscribe=None):
        self.loop = None
        self.clients = {}
        self.connected = False
        self.subscribe = subscribe
        self.guild_watches = {}
        self.subscribed = {}
        self.subscription_lock = asyncio.Lock()
        self.output_clients = set()
        self.raw_history = deque(maxlen=200)
        self.resolve_source = None

    async def sync_subscriptions(self, force=False):
        if not self.subscribe or not self.connected:
            return
        async with self.subscription_lock:
            grouped = {}
            for watches in self.guild_watches.values():
                for guild_id, channels in watches.items():
                    grouped.setdefault(guild_id, set()).update(channels)
            desired = {guild_id: sorted(channels) for guild_id, channels in grouped.items() if channels}
            if not force and desired == self.subscribed:
                return
            # Include removed guilds with empty channel lists to clear their subscriptions.
            payload = [[guild_id, desired.get(guild_id, [])]
                       for guild_id in sorted(set(desired) | set(self.subscribed))]
            await self.subscribe(payload)
            self.subscribed = desired

    @staticmethod
    def redact(value):
        if isinstance(value, dict):
            private = {'token', 'access_token', 'refresh_token', 'authorization', 'email', 'phone', 'session_id', 'session_token', 'client_secret', 'password', 'auth_token', 'resume_token'}
            return {key: '[REDACTED]' if key.lower() in private else MessageHub.redact(item)
                    for key, item in value.items()}
        if isinstance(value, list):
            return [MessageHub.redact(item) for item in value]
        return value

    async def publish(self, event):
        if event.get('type') == 'CONNECTION' and event.get('connected'):
            await self.sync_subscriptions(force=True)
        if event.get('type') == 'MESSAGE_CREATE' and self.resolve_source:
            event = {**event, 'source': self.resolve_source(event['data'])}
        if event.get('type') == 'GATEWAY_LOG':
            entry = {'timestamp': time.time(), **self.redact(event['data'])}
            encoded = json.dumps(entry['payload'])
            if len(encoded) > 131072:
                entry['payload'] = {'truncated': True, 'preview': encoded[:131072]}
            self.raw_history.append(entry)
            event = {'type': 'GATEWAY_LOG', 'data': entry}
        channel_id = str(event.get('data', {}).get('channel_id', ''))
        for socket, (queue, channels) in list(self.clients.items()):
            if event.get('type') == 'GATEWAY_LOG' and socket not in self.output_clients:
                continue
            if channel_id and channel_id not in channels and event.get('type') != 'MESSAGE_CREATE':
                continue
            if queue.full():
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({'type': 'RESYNC'})
            else:
                queue.put_nowait(event)

    async def from_gateway(self, event):
        if self.loop and not self.loop.is_closed():
            future = asyncio.run_coroutine_threadsafe(self.publish(event), self.loop)
            await asyncio.wrap_future(future)

    async def connect(self, socket: WebSocket):
        await socket.accept()
        queue = asyncio.Queue(maxsize=256)
        channels = set()
        self.clients[socket] = (queue, channels)
        self.guild_watches[socket] = {}
        await socket.send_json({'type': 'CONNECTION', 'connected': self.connected})

        async def send():
            while True:
                await socket.send_json(await queue.get())

        sender = asyncio.create_task(send())
        try:
            while True:
                # Each browser sends its complete open-window set.
                request = await socket.receive_json()
                if isinstance(request, dict) and request.get('type') == 'WATCH':
                    ids = request.get('channels', [])
                    if isinstance(ids, list):
                        if request.get('output') is True:
                            if socket not in self.output_clients:
                                await queue.put({'type': 'GATEWAY_LOG_HISTORY', 'data': list(self.raw_history)})
                            self.output_clients.add(socket)
                        else:
                            self.output_clients.discard(socket)
                        channels.clear()
                        channels.update(str(value) for value in ids[:100] if str(value).isdigit())
                        watches = {}
                        windows = request.get('windows', [])
                        if isinstance(windows, list):
                            for window in windows[:100]:
                                if not isinstance(window, dict):
                                    continue
                                guild_id = str(window.get('guild_id', ''))
                                channel_id = str(window.get('channel_id', ''))
                                if guild_id.isdigit() and channel_id in channels:
                                    watches.setdefault(guild_id, set()).add(channel_id)
                        self.guild_watches[socket] = watches
                        await self.sync_subscriptions()
        except (WebSocketDisconnect, ValueError, RuntimeError):
            pass
        finally:
            self.output_clients.discard(socket)
            self.clients.pop(socket, None)
            self.guild_watches.pop(socket, None)
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
            await self.sync_subscriptions()
