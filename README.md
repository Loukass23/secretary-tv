# Secretary TV

**Secretary** is one small, fast app for Samsung Tizen TVs: a glass home screen with your films, shows and anime,
Continue Watching, your TV apps, reminders, an assistant and your lights. Browsing, the title pages, search and the
player all run inside it. **Secretary Desk** is the phone companion, served by a small home server.

(Secretary Cinema, Shows and Anime used to be separate apps. They were folded into Secretary in November 2026 and
are gone.)

Named after the **Secretary Bird** (_Sagittarius serpentarius_), the tall African raptor crowned with black quill
feathers that hunts snakes by stomping them in 15 milliseconds. Zero bloat, flat-fill Tizen rendering, and instant
source failover.

Built and measured on a Samsung GU43DU7199UXZG (Tizen 9). Other Tizen 8/9 TVs should work; older ones are untested.

## What this is not

This project contains no media, no catalog of releases, no stream sources, no addon or plugin lists and no
credentials. You bring your own accounts and your own sources:

- **Sources** are [Nuvio](https://github.com/NuvioMedia)-format plugin repositories or Stremio-protocol addons that
  you add yourself on the TV (Settings › Sources, Settings › Addons). None ship with this project, and none are
  recommended here.
- **Playback** goes through your own debrid account, which only serves files it already has cached.

Use it only with content you have the right to watch. Please don't open issues or PRs that name or link specific
stream sources.

## Debrid support

| Service | TV app | Home server | Notes |
| --- | --- | --- | --- |
| [TorBox](https://torbox.app) | ✅ | ✅ | Checking a source adds it to the account, so sources are checked ahead only when Settings › Sources › "Check TorBox sources ahead" is on. |
| [Premiumize](https://www.premiumize.me) | ✅ | — | Cache checks add nothing to the account, so sources are checked in parallel. |
| Real-Debrid, AllDebrid, Debrid-Link | planned | planned | |

Keys are entered on the TV (Settings › Sources) and stored there; the services are tried in the order you choose. The
shared code is `packages/core` (`debrid.ts`, one file per service).

## Features

### Secretary on the TV

The home screen (`packages/launcher`):

- Cards for Continue watching, tonight's picks, films, shows and anime, opening into rows of titles; your TV apps,
  the weather, reminders and Home.
- **Ask Secretary**: an assistant panel ("play dune", "something for tonight"), reminders and the Daylight theme
  (`docs/launcher.md`).
- **SmartThings from the TV, no server**: real scenes and lights, movie lights while a film plays, home status toasts,
  and "turn off the couch light" by name (`docs/smartthings.md`).

Films, shows and anime (the screens of `packages/catalog-kit`, inside Secretary):

- Glass "top shelf" catalog with windowed rows, title pages, saga and collection timelines.
- **Raptor Hunt**: one search across films, shows and anime.
- Streams from Nuvio plugin repositories run on the TV, one Worker per provider (`docs/plugins.md`), and from
  Stremio-protocol addons (streams, meta, catalogs as home rows; `docs/addons.md`).
- Release ranking tuned for TVs (resolution, HDR/DV, codec, size), with AV1 last.
- AVPlay player with prepare-ahead, source retry and failover, and a memory of dead links and of the source you picked.
- Resume, "Up next" with a countdown, skip intro / recap / credits (AniSkip, TheIntroDB).
- Anime grouped into seasons with Kitsu and TVDB.
- Nuvio Cloud sign-in: profiles, My List, watch progress, plugin and addon sync, and collections including Trakt lists
  (`docs/nuvio-cloud.md`).
- Watch party client: watch together across TVs (`docs/watch-party.md`; needs the Worker deployed).

### Home server (`packages/server`)

Implemented:

- A Stremio-shaped addon (`/manifest.json`, `/stream/…`) that answers with cached debrid streams ranked for TVs, with
  an optional upstream addon of your own as a fallback (`UPSTREAM_ADDON`).
- `/resolve/<hash>`: picks the right file (episode matching, absolute anime numbers) and redirects to the debrid link.
- `/cloud`: the files already in your debrid cloud.
- `/search`: one search across films, shows and anime.
- `/resume` and `/handoff`: watch progress, and "open this on the TV" from the phone.
- **Secretary Desk** (`/companion`, `/remote`): the phone web app with reminders and the assistant.
- `/reminders`, `/ai/ask`, `/ai/state`, `/ai/transcribe`: reminders sync and the Secretary Bird assistant (Google
  Gemini, optional), with voice from a room microphone and spoken replies.
- `/weather` (Open-Meteo, no key), `/art` (fanart.tv artwork), `/domotics` (SmartThings lights).
- `/health`.
- Runs at home on the LAN, or hosted on the internet from the `Dockerfile` with a secret key in every URL
  (`docs/hosting.md`).

Upcoming:

- A debrid-agnostic server: today it needs `TORBOX_API_KEY`; Premiumize and others should work there as they do on the
  TV.
- More debrid services (Real-Debrid, AllDebrid, Debrid-Link) in `packages/core`.
- Pairing or auth for the LAN server, so only your TVs and phone can call it.
- A deployment guide and a hosted option for the watch-party Worker (`packages/party`).
- A header-aware local proxy for providers that need `Referer` or `Cookie` (`docs/plugins.md`).
- Matter lights next to SmartThings.

### Upcoming on the TV

- External subtitles from addons in the player.
- Addon catalogs in search, genre rows, configurable addons.
- Rebinding the TV's Home button (it needs system settings; see `docs/launcher.md`).

## Packages

| Package | Name | What it does |
| --- | --- | --- |
| `packages/core` (`@secretary/core`) | **Secretary Core** | Debrid cache checks and links, file choice, release ranking. Plain TypeScript. |
| `packages/plugins` (`@secretary/plugins`) | **Secretary Plugins** | Runs Nuvio plugin repositories on the TV: manifests, one Worker per provider, id mapping, debrid for hashes. |
| `packages/launcher` (`@secretary/launcher`) | **Secretary** | The app: the home screen, with the catalog and the player inside. The only thing deployed to the TV. |
| `packages/catalog-kit` (`@secretary/catalog-kit`) | **Secretary Catalog Kit** | The catalog screens Secretary embeds: rows, title pages, search, sources, settings, and the AVPlay player. Not an app of its own. |
| `packages/server` (`@secretary/server`) | **Secretary Desk & Server** | The home server and the phone companion. |
| `packages/nuvio` (`@secretary/nuvio`) | **Secretary Nuvio** | Nuvio Cloud client: auth, profiles, library, progress, collections. |
| `packages/party` (`@secretary/party`) | **Secretary Party** | Watch-party rooms: a Cloudflare Worker and Durable Object, signed in with Nuvio Cloud. |
| `packages/tv-kit` (`@secretary/tv-kit`) | **Secretary TV Kit** | Focus grid, remote keys, glass components, row looks, perf marks, the Tizen build plugin, deploy and inspector scripts. |
| `packages/design` (`@secretary/design`) | **Secretary Design** | The desktop workbench (`pnpm design`): Secretary's screens and components at 1920x1080 with the TV rules linter. |

## Run it

Requirements: Node 22, pnpm, Tizen Studio's command line tools (`tz`, `sdb`), a Samsung certificate profile that
includes your TV's DUID, and the TV in Developer Mode.

```bash
pnpm install
cp .env.example .env              # debrid keys, BASE_URL (this computer's LAN address), optional extras
pnpm --filter @secretary/server start

cp .env.tizen.example .env.tizen  # signing profile, TV address, Secretary's package id, SECRETARY_TV_SERVER_URL, metadata keys
cd packages/launcher && node ../tv-kit/scripts/tizen.mjs deploy
```

`deploy` builds, signs, installs and launches. `node ../tv-kit/scripts/tizen.mjs debug` prints the inspector port for
`node ../tv-kit/scripts/cdp.mjs <port> walk|keys|eval|shot|logs|soak|layers`.

Debrid keys set at build time are copied into your `.wgt` as defaults: never share a package you built.

## Development

```bash
pnpm test         # Node's test runner, no browser needed
pnpm typecheck
```

## Docs

- `docs/plugins.md`: how plugin repositories run on the TV, and how debrid is used.
- `docs/addons.md`: Stremio-protocol addons.
- `docs/nuvio-cloud.md`: accounts, profiles and sync.
- `docs/watch-party.md`: watching together, and deploying the Worker.
- `docs/launcher.md`: Secretary's home screen, and why the Home button is not rebound.
- `docs/embedding-catalog.md`: how the catalog and the player live inside Secretary.
- `docs/performance.md`: measured numbers and the reasoning behind them.
- `docs/design.md`: the design workbench (`pnpm design`), tokens and the TV rules linter.
- `docs/lessons.md`: what the TV does and does not allow.
- `docs/legacy-port-plan.md`: design notes for the player and sources work.

See `CONTRIBUTING.md` to contribute.

## Acknowledgements

Secretary TV would not exist without these projects. Thank you to their authors and contributors:

- **[Nuvio](https://github.com/NuvioMedia)** by NuvioMedia: the plugin repository format, Nuvio Cloud accounts and
  sync, and NuvioTVSmart's approach to Tizen.
- **[nuvio-native-legacy](https://github.com/iqui27/nuvio-native-legacy)**: the native TV client whose 2.x releases
  inspired the faster start, source failover, Up next and watch-party work here.

Only ideas were taken; Secretary TV contains no code from either project. It is not affiliated with NuvioMedia, TorBox,
Premiumize or Samsung.

## License

[MIT](LICENSE)
