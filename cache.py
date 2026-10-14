from threading import Thread, RLock, Lock
from copy import deepcopy
from requests.exceptions import RequestException
from helpers import *
import time
from collections import OrderedDict

configs = loadf('configs.json')

class CacheHandler:
    def __init__(self, gateway):
        self.me = None

        guild_cache = loadf('cache/guilds.json')
        self.guilds = guild_cache['data']
        self.guilds_last_updated = guild_cache['last_updated']
        self.guild_channels = loadf('cache/guild_channels.json')
        self.channels = {}
        try:
            self.messages = loadf('cache/messages.json')
        except FileNotFoundError:
            self.messages = {}
        for entry in self.messages.values():
            entry.pop('pending', None)
        self._message_lock = RLock()
        self._history_locks = {}
        self._validated_history = set()
        try:
            dm_cache = loadf('cache/dms.json')
        except FileNotFoundError:
            dm_cache = {'data': None, 'last_updated': 0}
        self.dms = dm_cache['data']
        self.dms_last_updated = dm_cache['last_updated']
        self._list_lock = RLock()
        try:
            profile_cache = loadf('cache/me.json')
        except FileNotFoundError:
            profile_cache = {'data': None, 'last_updated': 0}
        self.me = profile_cache['data']
        self.me_last_updated = profile_cache['last_updated']
        self.profiles = {}
        self.user_activity = OrderedDict()
        self._activity_lock = RLock()
        self._profile_lock = RLock()

        self.gateway = gateway
        self.Client = type(gateway)

        # self.check_ttl('guilds')

    def message_source(self, message):
        channel_id = str(message['channel_id'])
        for guild_id, entry in self.guild_channels.items():
            channel = next((item for item in entry.get('data', []) if str(item['id']) == channel_id), None)
            if channel:
                guild = next((item for item in (self.guilds or []) if str(item['id']) == guild_id), {})
                return {'guild_id': guild_id, 'guild': guild.get('name', guild_id), 'icon': guild.get('icon'), 'channel': channel.get('name', channel_id)}
        dm = next((item for item in (self.dms or []) if str(item['id']) == channel_id), None)
        if dm:
            name = dm.get('name') or ', '.join(user.get('global_name') or user.get('username', '') for user in dm.get('recipients', []))
            return {'guild_id': 'dm', 'guild': 'Direct Messages', 'channel': name or channel_id}
        guild_id = str(message.get('guild_id', 'dm'))
        guild = next((item for item in (self.guilds or []) if str(item['id']) == guild_id), {})
        return {'guild_id': guild_id, 'guild': guild.get('name', 'Direct Messages' if guild_id == 'dm' else guild_id), 'icon': guild.get('icon'), 'channel': channel_id}

    def global_messages(self):
        with self._message_lock:
            by_id = {str(message['id']): message for entry in self.messages.values() for message in entry.get('data', [])}
            messages = sorted(by_id.values(), key=lambda message: int(message['id']))[-200:]
            return [{'message': deepcopy(message), 'source': self.message_source(message)} for message in messages]

    def record_user_activity(self, message):
        user_id = str(message.get('author', {}).get('id', ''))
        if not user_id or not message.get('id') or not message.get('channel_id'):
            return
        with self._activity_lock:
            messages = self.user_activity.setdefault(user_id, OrderedDict())
            messages[str(message['id'])] = deepcopy(message)
            self.user_activity.move_to_end(user_id)
            for identifier in sorted(messages, key=int)[:-100]:
                del messages[identifier]
            while len(self.user_activity) > 1000:
                self.user_activity.popitem(last=False)

    def get_user_activity(self, user_id):
        with self._activity_lock:
            messages = sorted(self.user_activity.get(str(user_id), {}).values(),
                              key=lambda item: int(item['id']), reverse=True)
            return [{'message': deepcopy(item), 'source': self.message_source(item)}
                    for item in messages]

    def get_profile(self, user_id):
        user_id = str(user_id)
        with self._profile_lock:
            cached = self.profiles.get(user_id)
            ttl = configs['ttl'].get('profiles', configs['ttl']['me'])
            if cached and time.time() - cached['last_updated'] < ttl:
                return deepcopy(cached['data'])
            response = self.gateway.session.get(
                self.Client.API['user'].format(user_id=user_id), timeout=10
            )
            response.raise_for_status()
            profile = response.json()
            if not isinstance(profile, dict) or str(profile.get('id')) != user_id:
                raise ValueError('Invalid user profile')
            self.profiles[user_id] = {'last_updated': time.time(), 'data': profile}
            return deepcopy(profile)

    def invalidate_messages(self):
        # Revalidate disk history after startup or a gateway reconnection gap.
        with self._message_lock:
            self._validated_history.clear()

    def get_messages(self, channel_id, before=None):
        channel_id = str(channel_id)
        before = str(before) if before is not None else None
        with self._message_lock:
            history_lock = self._history_locks.setdefault(channel_id, Lock())
        with history_lock:
            with self._message_lock:
                if before is not None:
                    entry = self.messages.get(channel_id, {})
                    page = entry.get('pages', {}).get(before)
                    if page is not None:
                        by_id = {str(item['id']): item for item in entry.get('data', [])}
                        return deepcopy([by_id[identifier] for identifier in page if identifier in by_id])
                if before is None and channel_id in self._validated_history:
                    data = self.messages[channel_id]['data']
                    latest = max((int(item['id']) for item in data), default=0)
                    known_channels = [channel for guild in self.guild_channels.values()
                                      for channel in guild.get('data', [])] + (self.dms or [])
                    known_latest = max((
                        int(channel.get('last_message_id') or 0)
                        for channel in known_channels
                        if str(channel['id']) == channel_id
                    ), default=0)
                    if known_latest <= latest:
                        return deepcopy(data[-50:])
            options = {'timeout': 10}
            if before is not None:
                options['params'] = {'before': before}
            response = self.gateway.session.get(
                self.Client.API['messages'].format(channel_id=channel_id), **options
            )
            response.raise_for_status()
            history = response.json()
            if not isinstance(history, list):
                raise ValueError('Expected a list of messages')
            with self._message_lock:
                entry = self.messages.setdefault(channel_id, {'data': []})
                pages = entry.get('pages', {})
                if before is not None:
                    previous = entry['data']
                    pages[before] = [str(item['id']) for item in sorted(history, key=lambda item: int(item['id']))]
                    pending = entry.get('pending', [])
                else:
                    # Retain loaded older history; use a fresh authoritative latest page.
                    oldest = min((int(item['id']) for item in history), default=0)
                    previous = [item for item in entry['data'] if int(item['id']) < oldest]
                    pending = entry.get('pending', [])
                    self._validated_history.add(channel_id)
                by_id = {str(item['id']): item for item in previous + history + pending}
                data = sorted(by_id.values(), key=lambda item: int(item['id']))
                self.messages[channel_id] = {'last_updated': time.time(), 'data': data, 'pages': pages}
                if before is not None:
                    self.messages[channel_id]['pending'] = pending
                writef('cache/messages.json', self.messages)
                return deepcopy(sorted(history, key=lambda item: int(item['id'])) if before is not None else data[-50:])

    def receive_message(self, message):
        channel_id = str(message['channel_id'])
        with self._message_lock:
            entry = self.messages.setdefault(channel_id, {'data': [], 'pending': []})
            by_id = {str(item['id']): item for item in entry['data']}
            by_id[str(message['id'])] = message
            entry['data'] = sorted(by_id.values(), key=lambda item: int(item['id']))
            entry['last_updated'] = time.time()
            if channel_id not in self._validated_history:
                pending = {str(item['id']): item for item in entry.get('pending', [])}
                pending[str(message['id'])] = message
                entry['pending'] = sorted(pending.values(), key=lambda item: int(item['id']))[-50:]
            writef('cache/messages.json', self.messages)

    def update_channels(self, guild):
        guild = str(guild)
        cached = self.guild_channels.get(guild)
        if cached and time.time() - cached['last_updated'] < configs['ttl']['guild_channels']:
            return

        response = self.gateway.session.get(self.Client.API['guild_channels'].format(guild_id=guild), timeout=10).json()
        self.guild_channels[guild] = {'last_updated': time.time(), 'data': response}
        writef('cache/guild_channels.json', self.guild_channels)

    def check_ttl(self, _type, force=False):
        with self._list_lock:
            try:
                data = loadf(f'cache/{_type}.json')
            except FileNotFoundError:
                data = {'data': None, 'last_updated': 0}
            last_updated = data['last_updated']
            response = data['data']
            if force or response is None or time.time() - last_updated >= configs['ttl'][_type]:
                result = self.gateway.session.get(self.Client.API[_type], timeout=10)
                result.raise_for_status()
                response = result.json()
                expected_type = dict if _type == 'me' else list
                if not isinstance(response, expected_type):
                    raise ValueError(f'Invalid {_type} response')
                last_updated = time.time()
                writef(f'cache/{_type}.json', {'last_updated': last_updated, 'data': response})
            setattr(self, _type, response)
            setattr(self, f'{_type}_last_updated', last_updated)

    def refresh_worker(self, from_self=False):
        if from_self:
            while True:
                time.sleep(configs['ttl']['all'])
                for resource in ('guilds', 'dms', 'me'):
                    try:
                        self.check_ttl(resource)
                    except (RequestException, ValueError):
                        continue
        else:
            Thread(target=lambda: self.refresh_worker(from_self=True), daemon=True).start()
