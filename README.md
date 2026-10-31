# Secretary TV

Small, fast apps for Samsung Tizen TVs: **Secretary Cinema** (films), **Secretary Shows** (series), **Secretary Anime**
and **Secretary Nest**, a glass home screen with your apps, Continue Watching, reminders, an assistant and your
lights. **Secretary Desk** is the phone companion, served by a small home server.

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

| Service | TV apps | Home server | Notes |
| --- | --- | --- | --- |
| [TorBox](https://torbox.app) | ✅ | ✅ | Checking a source adds it to the account, so sources are checked ahead only when Settings › Sources › "Check TorBox sources ahead" is on. |
| [Premiumize](https://www.premiumize.me) | ✅ | — | Cache checks add nothing to the account, so sources are checked in parallel. |
| Real-Debrid, AllDebrid, Debrid-Link | planned | planned | |

Keys are entered on the TV (Settings › Sources) and stored there; the services are tried in the order you choose. The
shared code is `packages/core` (`debrid.ts`, one file per service).

## Features

### TV apps (Cinema, Shows, Anime)

- Glass "top shelf" home with windowed rows, detail pages, saga and collection timelines.
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

### Secretary Nest (launcher)

- Clock, weather, installed TV apps, cross-app Continue Watching, Raptor Hunt.
- **Ask Nest**: an assistant panel ("play dune", "something for tonight"), reminders, SmartThings lights and the
  Daylight theme (`docs/launcher.md`).

### Home server (`packages/server`)

Implemented:

- A Stremio-shaped addon (`/manifest.json`, `/stream/…`) that answers with cached debrid streams ranked for TVs, with
  an optional upstream addon of your own as a fallback (`UPSTREAM_ADDON`).
- `/resolve/<hash>`: picks the right file (episode matching, absolute anime numbers) and redirects to the debrid link.
- `/cloud`: the files already in your debrid cloud.
- `/search`: one search across films, shows and anime.
- `/resume` and `/handoff`: progress across apps, and "open this on the TV" from the phone.
- **Secretary Desk** (`/companion`, `/remote`): the phone web app with reminders and the assistant.
- `/reminders`, `/ai/ask`, `/ai/state`: reminders sync and the Secretary Bird assistant (Google Gemini, optional).
- `/weather` (Open-Meteo, no key), `/art` (fanart.tv artwork), `/domotics` (SmartThings lights).
- `/health`.

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
| `packages/catalog-kit` (`@secretary/catalog-kit`) | **Secretary Catalog Kit** | The shared catalog engine: home, detail pages, search, sources, and the AVPlay player. |
| `packages/app-movies`, `app-series`, `app-anime` | **Secretary Cinema**, **Secretary Shows**, **Secretary Anime** | Thin Tizen app shells over the catalog kit. |
| `packages/launcher` (`@secretary/launcher`) | **Secretary Nest** | The home screen. |
| `packages/server` (`@secretary/server`) | **Secretary Desk & Server** | The home server and the phone companion. |
| `packages/nuvio` (`@secretary/nuvio`) | **Secretary Nuvio** | Nuvio Cloud client: auth, profiles, library, progress, collections. |
| `packages/party` (`@secretary/party`) | **Secretary Party** | Watch-party rooms: a Cloudflare Worker and Durable Object, signed in with Nuvio Cloud. |
| `packages/tv-kit` (`@secretary/tv-kit`) | **Secretary TV Kit** | Focus grid, remote keys, glass components, perf marks, the Tizen build plugin, deploy and inspector scripts. |

## Run it

Requirements: Node 22, pnpm, Tizen Studio's command line tools (`tz`, `sdb`), a Samsung certificate profile that
includes your TV's DUID, and the TV in Developer Mode.

```bash
pnpm install
cp .env.example .env              # debrid keys, BASE_URL (this computer's LAN address), optional extras
pnpm --filter @secretary/server start

cp .env.tizen.example .env.tizen  # signing profile, TV address, package ids, SECRETARY_TV_SERVER_URL, metadata keys
cd packages/app-movies && node ../tv-kit/scripts/tizen.mjs deploy
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
- `docs/launcher.md`: Secretary Nest, and why the Home button is not rebound.
- `docs/performance.md`: measured numbers and the reasoning behind them.
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
