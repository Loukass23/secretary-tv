# Secretary TV

Small Preact apps for Samsung Tizen TVs, MIT licensed. Formerly the private repo `torbox-tv`, branded "Secretary
Frame"; the Frame dashboard is now Secretary Nest (`packages/launcher`). Read `README.md` and `CONTRIBUTING.md` first.

## Hard rule: no sources

Code, tests, docs, commit messages, issues and PRs never name or link stream sources, indexers, addons, plugin
repositories or release groups. Tests use the fixtures in `packages/plugins/test/fixtures` and documentation-only
addresses (192.0.2.0/24, `example.com`). TorBox, Premiumize and other debrid services may appear only as debrid
support (`packages/core`, one file per service behind `debrid.ts`). No credentials or built `.wgt` files either: keys
live in `.env` / `.env.tizen` (gitignored) and on the TV.

## Layout

pnpm workspace, one package per folder in `packages/`. Packages import each other's TypeScript source directly
(`main: src/index.ts`); there is no build step outside the Tizen apps.

| Package | What it is |
| --- | --- |
| `core` | Debrid cache checks and links, file choice, release ranking |
| `plugins` | Runs Nuvio-format plugin repositories on the TV, one Worker per provider |
| `catalog-kit` | Shared catalog engine: home, detail, Hub (search, settings), sources, AVPlay player |
| `app-movies`, `app-series`, `app-anime` | Thin Tizen shells over `catalog-kit` (Cinema, Shows, Anime) |
| `launcher` | Secretary Nest, the glass home screen |
| `server` | Home server and Secretary Desk (phone companion) |
| `nuvio` | Nuvio Cloud client |
| `smartthings` | SmartThings client used from the TV: devices, scenes, OAuth refresh, home alerts and by-name commands |
| `party` | Watch-party Cloudflare Worker and Durable Object |
| `tv-kit` | Focus grid, keys, glass components, perf marks, Vite plugin, deploy and inspector scripts |

## Commands

```bash
pnpm install
pnpm test        # node --test with --experimental-strip-types over packages/*/test/*.test.ts, no browser
pnpm typecheck   # tsc --noEmit over every package's src and test
```

Both run in CI (`.github/workflows/ci.yml`) and must pass before a PR. Tizen builds do not run in CI.

Deploy to a TV from an app folder (needs Tizen Studio CLI `tz`/`sdb`, a certificate profile with the TV's DUID, and
`.env.tizen` from `.env.tizen.example`):

```bash
cd packages/app-movies
node ../tv-kit/scripts/tizen.mjs deploy   # build, sign, install, launch
node ../tv-kit/scripts/tizen.mjs debug    # prints the inspector port
node ../tv-kit/scripts/cdp.mjs <port> walk|keys|eval|shot|logs|soak|layers
```

`scripts/check-budget.mjs` enforces each app's `budget.json` after every build. Server: `pnpm --filter
@secretary/server start`, or the root `Dockerfile` for hosting it with a `SERVER_KEY` (`docs/hosting.md`).

## UI direction

Build new UI on `packages/tv-kit/src/glass` (`Glass`, `GlassRoot`, `MediaTile`, `ListCard`, `Segmented`, `Scroller`,
`IconButton`, backdrops), imported by path as `@secretary/tv-kit/src/glass/index.ts`. Preact and plain DOM: no WebGL or
canvas UI framework. The measured reasons are in `docs/performance.md` (Glass lab and later sections) and
`docs/lessons.md`:

- **Faked blur only** (`GlassRoot mode="fake"`): the wallpaper is blurred once into a small canvas and each surface
  shows it behind itself. A live `backdrop-filter` dropped the screen to about 15 fps; the fake costs nothing over a
  flat fill.
- **No large soft shadows** (`box-shadow: 0 18px 40px` and the like): they cost 16-20 long frames per walk. Inset
  hairlines are fine.
- **Focus by opacity and transform** only, moving elements on their own layers (`will-change`); no animated layout,
  sizes or filters. Flat fills, no gradients.
- Full-page art goes on its own layer, decoded before it is shown; frost swaps wait until focus rests. Long lists
  render only the rows around focus.

When a change touches the player, focus or rendering, measure it on a TV with `cdp.mjs walk` and add the numbers to
`docs/performance.md`.

### Restyle status (checked 2026-10-31)

The catalog apps are already restyled to glass. Every catalog-kit screen (`Home`, `Detail`, `HubOverlay`,
`SagaTimeline`, `NuvioFolder`, `PlayerView`, `ControlCentre`, `PartyOverlay`, `Island`) uses `GlassRoot`/`Glass`, and
`catalog-kit/src/style.css` holds only base styles.
