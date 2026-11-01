# Platform notes

Things learned building and testing on a real Samsung TV (the "reference TV": Samsung GU43DU7199UXZG, Tizen 9, Chromium 120).
Each item cost a debugging session. If one turns out wrong, fix it here in the same commit.

## Packaging and boot

- The widget loads over `file://`. Vite needs `base: "./"`; an absolute asset path or a `crossorigin` attribute gives a black
  screen. `tv-kit/src/vite.ts` strips the attribute and fails the build on absolute paths.
- Vite's lazy-chunk preloader adds `crossorigin` at runtime. The build sets `modulePreload: false` and `cssCodeSplit: false`
  so there is nothing left to inject.
- Samsung's `webapis.js` exists only if the page loads `$WEBAPIS/webapis/webapis.js`; the build adds that tag after bundling.
- The package id is exactly 10 letters or digits, or install fails with `Load archive info fail [118,-4]`. (`ScrtAnime` is nine
  and failed; the anime app uses `ScrtAnimes`.)
- The TV's DUID must be in the distributor certificate and Developer Mode must be on. Signing profile, TV address and package
  ids live in a gitignored `.env.tizen`.
- `tz pack -w <dir>` treats the folder as a project and writes `Debug/`, `tizen_web_project.yaml` and `.tizen-rds` into it. Remove
  them before packing again. `tz install` uninstalls first, so every install wipes the app's data (Nuvio sign-in,
  SmartThings tokens, Nest's reminders). `tizen.mjs install` and `deploy` push the package and run the TV's own
  `sdb shell 0 vd_appinstall <package id> <path>` instead, which upgrades in place and keeps the data (checked
  2026-11-01). `tizen.mjs reinstall` is the wiping way, for a package signed with a new certificate.
- `sdb dlog` prints nothing on a retail TV. Read the console over the inspector port instead (`tizen.mjs debug`, then
  `cdp.mjs <port> logs`).
- The boot watchdog logs script errors and shows them on screen if the splash is still up after 30 s.
- Package ids and addresses in the example env files are placeholders. `BASE_URL` (server) and `SECRETARY_TV_SERVER_URL` (apps) must
  be the computer's real address on the TV's subnet, or the apps boot, show catalogs, and then fail every stream with no clear error.

## Input

- Back arrives as both `tizenhwkey` and a keydown with keyCode 10009. Listen to the keydown only, drop repeats and presses
  within 250 ms, and re-send it as Escape so every view closes on one key (`tv-kit/src/keys.ts`).
- Registering a media key takes it from the system, so only the keys the apps handle are registered, through
  `tizen.tvinputdevice`. Register after startup; registering too early fails silently.
- Exit only through `tizen.application.getCurrentApplication().exit()`. An unhandled Back lets the webview navigate back and can
  close the app.
- Focus and activation are separate: arrows move focus, OK activates.
- A held key can be told from a press. Measured on the reference TV's remote with CH+ and CH-, about 20 presses and
  holds:
  - a press sends one keydown and a keyup 90 to 310 ms later, with no repeat;
  - a hold sends the keydown, then keydowns marked `repeat` from 350 ms on, every 108 ms, then the keyup.

  So a hold is known at its first repeat, about 0.35 s in. A short press is acted on at its keyup when no repeat came,
  which costs only the time the button was down. OK on a source in the sheet already works this way (hold for its
  details card).
- **OK is not CH+.** A hold on a collection row that waited for the first repeat never fired on the TV with the real
  remote (2026-10-31), though the same code worked from CDP with synthetic repeats. A held OK is told by time
  instead: a 600 ms timer from the keydown, cancelled by the keyup (`ui/Home.tsx`, as `ui/Detail.tsx` does for the
  sources sheet). The keydowns and keyup of the press that opened something are not a choice in it.

## Rendering and performance

- Timers can starve during boot while `requestAnimationFrame` keeps firing. Take the splash down from a rAF callback.
- Gradients are the slowest raster fill; paint is main-thread time on this TV. The apps use flat fills, transform-only movement
  and virtualised rows (the focused card plus a margin).
- `backdrop-filter` works but drops a glass screen to about 15 fps. Fake it: blur the backdrop once into a small canvas and show
  the matching piece behind each surface (`performance.md`, glass lab). Large soft `box-shadow`s cost long frames the same way
  whenever the element repaints; glass surfaces use a hairline instead.
- Remote artwork can be drawn into a canvas and read back (`toBlob`): the widget runs from `file://` and the canvas is not
  tainted. Blurring a title's backdrop that way takes about 0.6 s including the download.
- A full-page image costs every frame anything moves over it. Give it its own layer (`will-change`), decode it before
  showing it, and remove the faded-out one: even at opacity 0 a second full-page layer cost long frames.
- A frost layer (`translate3d(…) scale(4)`) is rasterized at page scale, so swapping its image is expensive. Swap the frost
  only once focus rests, and leave it off surfaces that move with every key. A 2D transform avoids the layer but then
  every text change in the surface repaints the scaled frost, which was worse.
- An IndexedDB read can take many seconds during boot, so the first frame comes from a small localStorage snapshot.
- A plain page lays out at 1920x1080 CSS px with `devicePixelRatio` 1. Check `screen.width / innerWidth` before assuming a
  scale for the video rectangle (it is 1 here).
- To test a detail page without touching TorBox: prepare-ahead off, and answer `/stream/` with sample sources through the
  inspector's `Fetch` domain (the stream client keeps the `fetch` it was created with, so patching `window.fetch` later
  does not reach it); point the sample URLs at an unreachable address and block `/resolve/` and `/warm`. Reach buttons by
  their label, not by position: a title with saved progress has Resume and Start over first, and Start over plays.
- The TV could not reach the public test clips tried (`PLAYER_ERROR_CONNECTION_FAILED` for test-videos.co.uk; Google's
  sample bucket answers 403), so playback checks need a real source.
- Measure, do not guess: `cdp.mjs <port> walk` records frame gaps over a fixed key path, `soak` samples heap and DOM size.

## AVPlay

- Open the URL straight with `avplay.open()`; never send a HEAD request first (debrid hosts answer 403/405). AVPlay follows
  redirects itself.
- Buffering properties can only be set before `prepareAsync`. Never combine `BUFFER_SIZE` with `setBufferingParam`.
- `prepareAsync` can hang without an error (AV1 never leaves prepare on this TV), so it runs under a timer: 15 s for plain files,
  30 s for adaptive streams.
- A picture with no audio track in `getTotalTrackInfo()` means AVPlay cannot decode the audio (DTS and TrueHD are silent on most
  models). The player treats that as a failed source and tries the next one.
- Never call `setSelectTrack("TEXT", …)`; it can crash the decoder.
- Never seek a prepared stream. Every form (`seekTo` with or without callbacks, `jumpForward`/`jumpBackward`, paused or
  playing) blocks the page until a remote file re-buffers: 3 to 34 s for a 4K stream. `seekTo` in IDLE (after `open()`,
  before `prepareAsync()`) returns at once and only sets where prepare starts, so the resume point and every seek reopen
  the source there (`performance.md`, seeking). Tearing down a playing decoder still costs one 0.3-0.4 s frame.
- `getDuration()` reads 0 right after prepare. If a firmware ignores the IDLE seek, wait for a real duration before seeking.
- Video renders on a plane behind the page, so the page goes transparent while a player is attached. Every screen still
  mounted under the player must be hidden or transparent then: the player owns the screen
  (`html.avplay #root > :not(.player)…` in `ui/player.css`), whatever screens exist.
- The page needs an `<object type="application/avplayer">` where the video goes (`app.tsx`, mounted for the app's life
  because the detail page prepares ahead). Without it the DOM over the video was fully transparent, AVPlay played and
  the sound came through, yet the TV kept showing the catalog.
- CDP screenshots show the video plane as blank, so they prove nothing about the picture. Check the stack with
  `cdp.mjs <port> layers` and playback through player state and position.
- After `restore()` leaves AVPlay idle, the reopen must give the display back and keep the saved position for the next
  play; `load()` alone only prepares.
- `suspend()` on hide and `restore()` on show. If restore leaves the player idle, reopen the source at the saved position, paused.
  Tested: 70 s, 90 s and 5 min hidden, playing and prepared.
- A player that is only preparing must not call `setDisplayRect`; the display area is set in `start()`, just before `play()`.
- Prepare-ahead works: `open()` + `prepareAsync()` behind the detail page leaves AVPlay in `READY`, and `play()` on OK reaches the
  first frame in about 0.3 to 0.8 s, against about 5 s cold. `stop()` + `close()` returns it to `NONE`.
- **One AVPlay for every player object.** A source that fails after `open()` (no playable audio, a prepare error) must be
  closed, or the next source's `open()` throws `InvalidStateError` and every following source fails with it. The player
  closes a failed source, and `load()` closes anything still open first. Measured: before the fix, Better Call Saul
  S1E2's first source had no playable audio and the next three failed in the same second; after it, the second source
  played.
- **One decoder at a time.** `webapis.avplaystore.getPlayer()` hands out separate player objects, and a second one prepares
  fine while the first plays. But once it is prepared the first stops advancing, stays `PLAYING`, and does not recover even
  after the second is closed. So the next episode cannot be prepared during playback; the gap between episodes (about 3 s) is
  the floor on this firmware.

## Network

- The packaged widget applies no CORS, and plain `http://` LAN hosts load, so the apps talk to the server and the public
  catalog hosts directly.
- A TorBox download link comes from `requestdl` and is served by TorBox with range support, so the server redirects to it
  and never carries video itself.
- A source can be checked before AVPlay gets it with a `GET` and `Range: bytes=0-1023`, never a `HEAD`. The fetch
  follows redirects and shows where it ended (`res.redirected`, `res.url`). Cancel the body once the headers are in.
  Measured from the widget on the reference TV:

  | Link | Answer | Time |
  | --- | --- | --- |
  | A plugin's redirector to Premiumize | 206 on the CDN host after the redirect | 0.3 s |
  | Premiumize `directdl` link | 206 | 0.5 s |
  | TorBox `requestdl` link | 206 | 0.2 s |

  Video comes as `application/octet-stream`, not `video/*`, so "not video" means an HTML, JSON or text type. The total
  after the slash in `Content-Range` is the real file size, which is how a tiny warning clip shows itself.

## Catalog data

- Cinemeta catalogs live on `cinemeta-catalogs.strem.io` (the `v3-cinemeta` host redirects there) and use `imdb_id`. Artwork
  derives from the id on `images.metahub.space`.
- Series meta lists season 0 specials first (55 of 128 videos for one popular show). Show them last and never auto-advance from
  a regular season into them.
- The Kitsu addon serves anime catalogs, `/small.` posters beside the `/medium.` links, and per-episode `absoluteEpisode`,
  `imdbSeason` and `imdbEpisode`. Kitsu entries are per season, so each shows one season.
- Anime ids carry no season or running number, so the app adds `?s=&e=&a=` to resolve URLs.

## Choosing the file inside a torrent

- TorBox lists a torrent's readme as file id 0. Never default to id 0.
- The upstream `fileIdx` is the torrent's own index and TorBox ids can differ, so it is only used when it lands on a video.
- A season pack plays the requested episode by name: `S01E02`, `s1e2`, `1x02` or `S1 - 02` (exactly that episode, not `E20` for `E2`).
- Anime batches number episodes inconsistently: per season, or across seasons (`Season 3 / - 41`). The server scores candidates by
  episode match and folder, judging movie, OVA and extras folders *below* the root folder, whose own name often lists
  "OVA+Movies". A bigger "Movie 03" must never beat the season folder's episode 03 (it did once, before scoring).

## Ranking

- Order: cached first, then resolution, then what the TV decodes well (HEVC, DD+ and AAC up; AV1, DTS, TrueHD and Dolby Vision
  without an HDR10 fallback down).
- Releases titled in Cyrillic, CJK and similar scripts are usually dubs with other-language audio and rank far lower; dual or
  multi audio gets a small bonus.

## Launching other apps

- `tizen.application.getAppsInfo` lists hundreds of internal ids on a retail TV. Filter to store-style ids and drop names with
  service, worker, agent or e-manual. It needs `application.info`; `application.launch` opens an app by id, and the caller's page
  goes `hidden`. Icon paths load in `<img>`.
- Some consumer apps do not appear in `getAppsInfo` at all; pin them by id.

## Tooling

- Python on Windows writes files in cp1252: a script that opens a file for writing and then fails to encode non-ASCII text
  leaves it empty. Use the editor tool for anything with non-ASCII text.
- Node 22 has a global `WebSocket`, so the CDP scripts need no dependency.
- Stopping a `pnpm --filter @secretary/server start` run does not stop its `node` child on Windows: the old server keeps
  port 7000 and the old environment (a changed TorBox key is not picked up). Check the port's owner and stop that
  process before starting again.
