# Secretary TV

One Preact app for Samsung Tizen TVs, **Secretary**, plus its home server and phone companion. MIT licensed. Read
`README.md` and `CONTRIBUTING.md` first.

## The product: one app, Secretary

- **Secretary is the only TV app.** It is built and deployed from `packages/launcher` (the folder keeps its old
  name, and the TV keeps the app id `<package id>.Launcher`, so installs update in place and keep their data).
- The films, shows and anime screens (rows, title pages, Hub, sources, the AVPlay player) are `packages/catalog-kit`,
  a library that Secretary mounts inside itself (`launcher/src/catalog-host.tsx`, `docs/embedding-catalog.md`). It is
  not an app.
- Secretary Cinema, Shows and Anime were separate apps until November 2026. They are retired and deleted; there is no
  fallback that launches another app.
- **Every TV deploy, test and measurement goes through `packages/launcher`.** Reach catalog screens the way a viewer
  does, from Secretary's cards (See all on a card's end bar opens the catalog home). In the design workbench, check
  the Secretary screens.
- "Nest" survives in code names (`nest-nav.ts`, `NEST_*` env vars, CSS classes) for Secretary's home screen. What the
  viewer reads says Secretary.

## Hard rule: no sources

Code, tests, docs, commit messages, issues and PRs never name or link stream sources, indexers, addons, plugin
repositories or release groups. Tests use the fixtures in `packages/plugins/test/fixtures` and documentation-only
addresses (192.0.2.0/24, `example.com`). TorBox, Premiumize and other debrid services may appear only as debrid
support (`packages/core`, one file per service behind `debrid.ts`). No credentials or built `.wgt` files either: keys
live in `.env` / `.env.tizen` (gitignored) and on the TV.

## Layout

pnpm workspace, one package per folder in `packages/`. Packages import each other's TypeScript source directly
(`main: src/index.ts`); the only build is Secretary's Tizen build.

| Package | What it is |
| --- | --- |
| `core` | Debrid cache checks and links, file choice, release ranking |
| `assistant` | The assistant's answers (`route()`), Gemini, watch intents, catalog search and weather; shared by the server and Secretary |
| `plugins` | Runs Nuvio-format plugin repositories on the TV, one Worker per provider |
| `launcher` | **Secretary, the app**: the glass home screen, with the catalog and player mounted inside |
| `catalog-kit` | The catalog screens Secretary embeds: home rows, detail, Hub (search, settings), sources, AVPlay player |
| `server` | Home server and Secretary Desk (phone companion) |
| `nuvio` | Nuvio Cloud client |
| `simkl` | Simkl client: device sign-in, scrobbling, watch history and stats (`docs/simkl.md`) |
| `anilist` | AniList client for anime: pasted-token sign-in, list progress, lists and stats (`docs/anilist.md`) |
| `smartthings` | SmartThings client used from the TV: devices, scenes, OAuth refresh, home alerts and by-name commands |
| `party` | Watch-party Cloudflare Worker and Durable Object |
| `tv-kit` | Focus grid, keys, glass components and tokens, row looks, perf marks, Vite plugin, deploy and inspector scripts |
| `design` | Desktop design workbench (`pnpm design`): tokens, components and Secretary's screens with a TV-rules linter |

## Commands

```bash
pnpm install
pnpm test        # node --test with --experimental-strip-types over packages/*/test/*.test.ts, no browser
pnpm typecheck   # tsc --noEmit over every package's src and test
```

Both run in CI (`.github/workflows/ci.yml`) and must pass before a PR. Tizen builds do not run in CI.

Deploy Secretary to a TV (needs Tizen Studio CLI `tz`/`sdb`, a certificate profile with the TV's DUID, and
`.env.tizen` from `.env.tizen.example`):

```bash
cd packages/launcher
node ../tv-kit/scripts/tizen.mjs deploy   # build, sign, install in place (keeps the app's data), launch
node ../tv-kit/scripts/tizen.mjs debug    # prints the inspector port
node ../tv-kit/scripts/cdp.mjs <port> walk|keys|eval|shot|logs|soak|layers
```

`scripts/check-budget.mjs` enforces Secretary's `budget.json` after every build. Server: `pnpm --filter
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

Try designs first in the workbench (`pnpm design`, `docs/design.md`): the TV's own components at 1920x1080 with
the keyboard as the remote, Night/Daylight, and a linter for the rules above. Tokens live in `glass/tokens.ts` and
`glass.css` together (a test keeps them in step). The workbench does not measure frames: when a change touches the
player, focus or rendering, measure it on a TV inside Secretary with `cdp.mjs walk` (against `main` deployed the same
way) and add the numbers to `docs/performance.md`.

### Restyle status (checked 2026-10-31)

The catalog screens are already restyled to glass. Every catalog-kit screen (`Home`, `Detail`, `HubOverlay`,
`SagaTimeline`, `NuvioFolder`, `PlayerView`, `ControlCentre`, `PartyOverlay`, `Island`) uses `GlassRoot`/`Glass`, and
`catalog-kit/src/style.css` holds only base styles.
