# Fakecord

A dashboard for monitoring multiple channels and DMs on Discord in movable windows. Includes grid/freeform layouts, saved workspaces, live messages, profile activity, and gateway output.

## Setup

Run from the project directory with Python 3.10+:

```sh
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Only if .env does not already exist
```

Set `DISCORD_TOKEN` in `.env`. Cache lifetimes are configured in `configs.json`.

For a fresh checkout without cache files, initialize the required caches:

```sh
mkdir -p cache
printf '{"last_updated":0,"data":[]}' > cache/guilds.json
printf '{}' > cache/guild_channels.json
```

## Run

```sh
python fakecord.py
```

Open **http://127.0.0.1:8000**.