# Hosting the server

`packages/server` normally runs on a computer at home and the TV reaches it on the LAN. It can also run on any host
that runs a Docker image, which gives it HTTPS (so Secretary Desk can use the phone's microphone) and keeps it up
when the home computer is off. The room microphone for Ask Nest still plugs into the TV (`docs/launcher.md`, "Room
microphone"); only the recorded clip goes to the server.

## The key

On the internet the server holds your debrid account, Gemini key and SmartThings token, so every URL starts with a
secret: `https://<host>/<SERVER_KEY>/...`. Requests without it get a 404. The key goes in the path rather than a
header because the TV's player opens `/resolve/...` links itself and cannot add headers. Every TV app and Desk add
paths to the server URL, so they need no other change.

- Make one with `openssl rand -hex 24` (24 or more letters, digits, `-` or `_`).
- `GET /health` without the key answers `{"ok":true}` and nothing else, for the host's health check.
- The key is in every URL, so it shows up in the host's request logs. Treat those logs as secret, and change the key
  if they leak. That means redeploying with a new `SERVER_KEY` and rebuilding the TV apps with the new URL.
- Without `SERVER_KEY` the paths are as before. Use that only on a home network. The Docker image sets
  `SECRETARY_HOSTED=1`, which refuses to start without a key.

## Build and run

From the repository root:

```bash
docker build -t secretary-server .
docker run -d --name secretary -p 7000:7000 -v secretary-data:/data \
  -e SERVER_KEY=... -e BASE_URL=https://tv.example.com \
  -e TORBOX_API_KEY=... -e GEMINI_API_KEY=... -e SMARTTHINGS_TOKEN=... \
  secretary-server
```

The image copies only `packages/core` and `packages/server`, which have no npm dependencies. Node 22 runs the
TypeScript directly.

| Variable | |
| --- | --- |
| `SERVER_KEY` | Required in the image. The first path segment of every URL. |
| `BASE_URL` | The public origin the host gives you, without the key. The server adds `/<SERVER_KEY>` to the links it writes. |
| `PORT` | 7000 by default. Most hosts set it. |
| `STATE_FILE` | `/data/secretary-state.json` in the image. Mount a volume on `/data`, or reminders and progress reset on every deploy. |
| `TORBOX_API_KEY`, `GEMINI_API_KEY`, `SMARTTHINGS_TOKEN`, `GEMINI_TTS_MODEL`, `WEATHER_*`, `UPSTREAM_ADDON` | As in `.env.example`. Set them as the host's secrets, never in the image. |

The host terminates HTTPS. Request bodies over 2 MB are refused (a voice clip is at most 1 MB).

## Point the TV and phone at it

In `.env.tizen`, set the server URL with the key on the end, then redeploy Nest and the catalog apps:

```bash
SECRETARY_TV_SERVER_URL=https://tv.example.com/<SERVER_KEY>
```

Desk is at `https://tv.example.com/<SERVER_KEY>/companion`. Bookmark it on the phone.

## Not covered

- Rate limits: the key is the only gate.
- Several users or keys: one key per server.
- Serverless hosts without a disk (Workers and the like). The server writes its state to a file, and it would need a
  storage adapter behind `createStateStore` (`packages/server/src/state.ts`).
