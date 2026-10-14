import websockets
import requests
import asyncio
import certifi
import random
import json
import ssl

 
# Opcodes
DISPATCH, HEARTBEAT, IDENTIFY = 0, 1, 2
RECONNECT, INVALID_SESSION, HELLO, HEARTBEAT_ACK = 7, 9, 10, 11
SUBSCRIPTION = 37
 

class Client:
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    INTENTS = (
        (1 << 0)   # GUILDS
        | (1 << 9)   # GUILD_MESSAGES
        | (1 << 11)  # GUILD_MESSAGE_TYPING
        | (1 << 12)  # DIRECT_MESSAGES
        | (1 << 14)  # DIRECT_MESSAGE_TYPING
        | (1 << 15)  # MESSAGE_CONTENT
    )
    API = {
        'guilds': 'https://discord.com/api/v10/users/@me/guilds',
        'guild_channels': 'https://discord.com/api/v10/guilds/{guild_id}/channels',
        'messages': 'https://discord.com/api/v9/channels/{channel_id}/messages?limit=50',
        'send_message': 'https://discord.com/api/v10/channels/{channel_id}/messages',
        'dms': 'https://discord.com/api/v10/users/@me/channels',
        'user': 'https://discord.com/api/v10/users/{user_id}',
        'me': 'https://discord.com/api/users/@me'
    }

    def __init__(self, token):
        self.token = token
        self.intents = Client.INTENTS
        self.ws = None
        self.seq = None
        self.acked = True
        self._hb_task = None
        self._handlers = {}

        # requests
        self.session = requests.Session()
        self.session.headers = {'Authorization': token}

    def on(self, event_name):
        def decorator(func):
            self._handlers.setdefault(event_name, []).append(func)
            return func
        return decorator

    def run(self):
        asyncio.run(self._run())

    # [server, [channels]]
    async def subscribe(self, server_ids):
        payload = {'subscriptions': {}}
        for server, channels in server_ids:
            payload['subscriptions'][str(server)] = {
                "typing": True,
                "threads": False,
                "activities": False,
                "members": [],
                "channels": {str(channel): [[0, 99]] for channel in channels}
            }
        await self._send(SUBSCRIPTION, payload)

    async def on_dispatch(self, event_name, data):
        for handler in self._handlers.get(event_name, []):
            await handler(data)

    async def _run(self):
        async with websockets.connect('wss://gateway.discord.gg/?v=10&encoding=json', ssl=Client.ssl_ctx) as self.ws:
            try:
                async for raw in self.ws:
                    if not await self._handle(json.loads(raw)):
                        break
            finally:
                self._stop_heartbeat()

    async def _send(self, op: int, d):
        await self.on_dispatch('RAW_GATEWAY', {'direction': 'out', 'payload': {'op': op, 'd': d}})
        await self.ws.send(json.dumps({"op": op, "d": d}))
 
    async def _identify(self):
        await self._send(IDENTIFY, {
            "token": self.token,
            "capabilities": 16381,
            "intents": self.intents,
            "properties": {"os": "linux", "browser": "pygw", "device": "pygw"},
        })
 
    async def _heartbeat_loop(self, interval_ms: int):
        await asyncio.sleep(interval_ms / 1000 * random.random())
        while True:
            if not self.acked:
                await self.ws.close(code=4000)
                return
            self.acked = False
            await self._send(HEARTBEAT, self.seq)
            await asyncio.sleep(interval_ms / 1000)
 
    def _stop_heartbeat(self):
        if self._hb_task:
            self._hb_task.cancel()
            self._hb_task = None
 
    async def _handle(self, msg: dict) -> bool:
        await self.on_dispatch('RAW_GATEWAY', {'direction': 'in', 'payload': msg})
        op, data = msg["op"], msg.get("d")
 
        if msg.get("s") is not None:
            self.seq = msg["s"]
 
        if op == HELLO:
            interval = data["heartbeat_interval"]
            self._hb_task = asyncio.create_task(self._heartbeat_loop(interval))
            await self._identify()
 
        elif op == HEARTBEAT_ACK:
            self.acked = True
 
        elif op == HEARTBEAT:
            await self._send(HEARTBEAT, self.seq)
 
        elif op == DISPATCH:
            await self.on_dispatch(msg["t"], data)
 
        elif op in (RECONNECT, INVALID_SESSION):
            return False
 
        return True
