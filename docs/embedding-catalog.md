# Embedding the catalog in Nest (option B, built behind a flag)

**Question.** Nest stays fluid (about 60 fps, 0-2 long frames per walk). Could the catalog (`catalog-kit`: Home, Detail,
folders, Hub) run inside Nest instead of as separate Tizen apps, so there is no app switch?

## Moving the rest of the apps' capabilities into Nest

Nest now builds with the catalog and the player inside by default; `NEST_EMBED_PLAYER=0` builds the old launcher that opens
the apps. What moved with it (the shared state the three app origins used to keep apart):

- **One Nuvio client.** Nest passes its own client to the catalog (`EmbeddedHost.cloud`, `shareCloud` in
  `catalog-kit/src/lib/cloud.ts`): one session in memory, one refresh, one profile. Two clients over the same
  `sectv.nuvio.session` could rotate the refresh token under each other and sign Nest out.
- **Profile switches.** Embedded there is no launch payload, so the catalog runs `checkOwner` each time it opens and drops
  the previous profile's local lists before they can be pushed to the new one. Leaving the catalog makes Nest read
  Continue, My List and collections again (`refreshCloud`).
- **Cinema lights.** Nest writes its SmartThings grant to the key the catalog reads (`sectv.home`) as the catalog opens
  and every 20 minutes while it is open, so the movie scene runs and the restore scene runs when the film ends.
- **Watch together.** Nest's header joins a room inside Nest (`WatchTogether` `onJoinHere`, `CatalogConfig.open.room`).
- **Hygiene.** The plugin scope follows the kind being browsed, list sync stops when the catalog closes, the server's
  handoff poll is skipped embedded.

Tested with Cinema, Shows and Anime uninstalled from the TV (2026-11-20, `vd_appuninstall` of `ScrtMovies`, `ScrtSeries.dist`,
`ScrtAnimes.dist`): Nest boots clean; Resume from Continue plays a film and an episode in Nest; a My List and an Anime
row title open their page; the "Open" tile and a Nuvio collection folder open the catalog in Nest (the folder shows once the
addons and collections have synced, a few seconds after the first open); eight play/Back cycles ended with the decoder
released each time, heap 7-11 MB (a slight rise, to watch in a longer soak), Back to Nest 620-1170 ms. Nest's own search
results now open through the same path. Not tested: lights scene, Watch together, a profile switch, a 30-minute soak.

Left as it is: the three apps' settings, debrid keys and addon lists are not migrated (one shared set now; retype, seed
from the env, or sync through the Nuvio profile); the catalog's "Boot animation" setting also drives Nest's boot; the
catalog has no subtitle or audio-track menu (it never had one).

## Status: option C works behind `NEST_EMBED_PLAYER=1` (now the default)

Build Nest with `NEST_EMBED_PLAYER=1` (it implies the catalog flag below). The catalog's own player then runs in Nest's page:
`EmbeddedHost.ownPlayer` keeps `<object type="application/avplayer">` and prepare-ahead in the embedded catalog, and
`player.css` keeps the player (and the island and control centre) visible while the rest of Nest hides under
`html.avplay`. The Nest home row has one card each for Cinema, Shows and Anime: it expands in place to the picks and, pressing Down, to
that kind's My List and genre rows (the stack slides up by transform; `MoreBlock` in `cards.tsx`). OK on a title (or Resume) opens the embedded page and plays there, with no app switch. The launcher template gained the
`productinfo` privilege (the catalog reads the panel's capabilities with it).

Measured on the TV (2026-11-20, Musk from its resume point): OK on the Continue card to AVPlay PLAYING in about 5 s
(source search included), four play/Back cycles with heap 6-8 MB and the decoder released (`NONE`) every time, Back
from the player to the page and Back again to Nest in about 370 ms. While playing, Nest's root is `visibility: hidden`,
the body transparent, AVPlay PLAYING. Walking an opened card (24 moves across and down its rows) showed median frames of 17 ms with 7-14 frames over 50 ms; the
home row itself stays at 0-1. The long frames are the vertical slide and the row of tiles behind it (CSS containment on
the rows helped a little; memoising them did not). Not yet looked at: audio/subtitle track menus, Watch together, the cinema lights
scene (the catalog reads its SmartThings grant from its own storage; Nest holds that grant in its own), the player's
look beside Nest's (it is the catalog's smoked-glass bar for now) and a long-run soak.

## Option B (catalog browsing in Nest, the player in the catalog app), built behind `NEST_EMBED_CATALOG=1`

Build Nest with `NEST_EMBED_CATALOG=1` (in `.env.tizen`, or in front of `tizen.mjs deploy`). Then:

- **Cinema, Shows and Anime** cards: "Open Cinema" (the last tile of an opened card), a pick or a search hit, and a
  collection folder card open the catalog **inside Nest** (`src/catalog-host.tsx`, a dynamic chunk that loads on first
  use). Resume still opens the catalog app, which plays it at once.
- **Playing** hands the title to the catalog app (`openTitleInApp`): a film plays at once, a series opens on its
  page. The app owns AVPlay; the embedded catalog draws no `<object type="application/avplayer">` and does not prepare
  a decoder ahead (`setEmbeddedPlayback`). Watch together stays in the app.
- **Back** at the catalog's home, CH+ and the Nest pill return to Nest (`EmbeddedHost.onExit`); a title or folder opened
  from a Nest card returns to Nest in one Back.
- **One card per kind:** with the flag, OK on the Cinema, Shows or Anime card opens the catalog on that kind at once, and
  Down walks its rows: Continue watching, My List, Popular, Top rated, New releases, then genre rows (Cinemeta genres for
  films and shows, Kitsu for anime; `rowsFor` in `lib/cinemeta.ts`). The separate My List card is hidden then. What the
  assistant just suggested still opens in place on its card.
- **Play now (direct to the player):** Play in the embedded Detail page sends the app what it already found (title,
  episode, the first 8 sources in the order to try them, where to start) as the launch payload's `play`
  (`nuvio/src/handoff.ts`, `PlayNow`). The app opens its player on them with no second search (`takeLaunch` and the
  wake effect in `catalog-kit/src/app.tsx`). Checked: the payload Nest sends (stubbed launch) and the decode and
  callback in tests. **Not yet seen:** the app's player starting from it on the TV.
- **Look:** the embedded catalog's top bar follows Nest's header (the section pill at the left, then the time and two quiet
  buttons at Nest's size and height), and the view fades in by opacity on its own layer (`.nest-catalog-in`).
- Without the flag nothing changes: the catalog's keys stay out of the package and the cards launch the apps.
- Budget: `packages/launcher/budget.embed.json` (150 KB gzip of JS, 3 MB) applies to flagged builds; the unflagged
  launcher stays at 100 KB.

Measured on the TV (2026-11-20), flagged build:

| What | Result |
| --- | --- |
| First open of the catalog (chunk load) | about 680 ms; later opens 55-350 ms |
| Back to Nest | 150-490 ms |
| Nest home walk (`cdp.mjs walk`) | median 17 ms, 0 frames over 50 ms (the first walk after a start showed 6, the warm-up) |
| Embedded catalog home walk | median 17 ms, 3-11 frames over 50 ms (today's catalog app: 4-9) |
| 12 Nest/catalog round trips | heap 5-9 MB, no growth |
| Play from the embedded Detail page | launches `ScrtMovies.Movies` with the title and `autoPlay` in the payload (checked with the launch stubbed) |

Not done: the 30-minute soak (these were 12 round trips) and a look at the real handoff in a series with a chosen episode.

**Short answer.** Browsing: feasible, behind a flag, as a lazily loaded chunk. Playback: keep it in the catalog apps.
The numbers below are from `docs/performance.md` and the code; nothing has been measured in an embedded build yet, so the
recommendation is conditional on the spike at the end.

## How it works today

- Cinema, Shows and Anime are three Tizen apps (`app-movies`, `app-series`, `app-anime`), each a thin shell over
  `CatalogApp` with its own webview, AVPlay and storage. Nest opens them with `launchAppControl`; the launch payload
  carries a session, a title or (now) a collection folder (`nuvio/src/handoff.ts`). Back returns to Nest by launching its id.
- Each app is about 284 KB of `dist`, about 55 KB gzip of JS, a 1.4-1.8 MB heap and about 82 DOM nodes. Nest is about
  47 KB gzip, 3-4 MB and 146 nodes. Budgets (`budget.json`): Nest 100 KB gzip, each catalog app 300 KB.
- Catalog Home had 4-9 frames over 50 ms per walk; Nest 0-2. Cold boot is about 1.1 s; first cards 0.85-0.93 s from a
  localStorage snapshot.

## What embedding would cost

| Area | Finding |
| --- | --- |
| Size | About 55 KB gzip more than Nest's 47 KB fits its 100 KB budget, but with little room. Lazy loading `CatalogApp` as a dynamic chunk keeps Nest's own boot as it is (`modulePreload` is off and dynamic chunks load over `file://`; confirm on the TV). |
| Player | AVPlay needs one `<object type="application/avplayer">` mounted for the page's life, makes the page transparent while it plays (every other screen must be hidden, `html.avplay #root > :not(.player)`), allows one decoder, and blocks the page while seeking (`docs/lessons.md`). Nest would have to give the screen up entirely during playback, which is most of what the app switch does today. |
| Keys and Back | Nest (`useKeys`, `useOkHold`) and `CatalogApp` each install key handling and a Back adapter (250 ms de-dup); `CatalogApp` exits through `exitApp`. Two owners in one page need a single router that hands the keys to one screen at a time. |
| State | Nest and the catalog keep their own storage keys today; one origin would share them. The launch payload and the owner/grant logic (`takeLaunch`, `needsGrant`) would go away, which is a simplification. |
| Config | Nest's `vite.config.ts` lacks the catalog's defines (`__TMDB_API_KEY__`, plugin repositories, debrid keys, `__FANART_API_KEY__`, `__TRAKT_CLIENT_ID__`); they would ship in one `.wgt`, which widens what a leaked package exposes. |
| Privileges | The catalog needs `application.launch`, `internet`, `tv.inputdevice`, `productinfo`; Nest adds `application.info` and `mediacapture`. A merged app has the union. |
| Memory and fps | A browsing screen in the same webview adds the catalog's heap (1.4-1.8 MB) and its long frames to Nest's. Catalog Home's 4-9 long frames per walk are the risk; Nest's measured 0-2 is the bar. |
| Fault isolation | Today a crash in an app leaves Nest alive behind it. Embedded, one crash takes both. |

## Options

- **A. Keep separate apps, deepen the hand-off.** Already what the Nuvio collection cards do (`folder` in the launch
  payload). Costs a launch (a few hundred ms) per open; no risk to Nest's frame rate. Next steps: more payload targets
  (a Hub search, a saga timeline), and the detail context menu already works inside the app.
- **B. Embed browsing, hand playback off.** Home, Detail, folders and search run in Nest as a lazy chunk; Play launches the
  catalog app on that title. Removes the app switch for browsing, keeps AVPlay out of Nest. The most useful option if
  the numbers hold.
- **C. Embed everything, player included.** Biggest change and the riskiest: the transparent-page rule and the single
  decoder mean Nest's screens, glow and wave must all be hidden or paused during playback, and Back must restore them.
  Not recommended.

## Recommendation

Do A now. Run the spike for B; adopt it only if it keeps Nest's frame numbers. Never C.

## Spike (about two days)

1. In `packages/launcher`, add a flag (`NEST_EMBED_CATALOG=1`) and a dynamic `import("@secretary/catalog-kit")` mounted
   as a Nest view (`view === "catalog"`), with the catalog's defines added behind the flag. Keys: the view owns them while
   mounted, Back leaves it; `CatalogApp`'s `onPlay` launches the app (as `openTitleInApp` does).
2. Build for the TV and run `cdp.mjs walk` on Nest's home, then on the embedded Home, then `soak` for 30 minutes
   going Nest, catalog, Nest. Record median frame time, frames over 50 ms, heap, DOM nodes, time from OK to first cards
   and Back-to-Nest latency in `docs/performance.md`.
3. Decide by these gates: Nest's own walk unchanged (0-2 long frames); the embedded Home no worse than today's catalog
   app (4-9); heap after the soak flat; `check-budget.mjs` green with the chunk counted.
4. If any gate fails, drop the flag and keep A.
