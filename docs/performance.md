# Performance

Measured on the reference TV (Samsung GU43DU7199UXZG, Tizen 9, Chromium 120) over the inspector port with
`packages/tv-kit/scripts/cdp.mjs`.

## Results

| Measure | Result |
| --- | --- |
| Build output (`dist/`, unpacked) | 36 KB |
| JS shipped, gzip | 12.6 KB (13.8 KB for the series and anime apps) |
| First paint (empty shell) | 591 ms |
| First cards on screen, relaunch with cached home | about 1.0 s |
| Key walk (22 moves, 3 rows, posters on screen): median frame | 17 ms (60 fps) |
| Same walk, worst frame / frames over 50 ms | 67 ms / 2 of 629 |
| JS heap after the walk | 2.3 MB |
| OK to first frame, 4K HDR remux, no prepare-ahead | 5.1 s |
| OK to first frame, prepare-ahead on | 0.8 s (resumed at 0:40) |

The soak, cold start and suspend/restore checks are in the last section.

## Method

- `node ../tv-kit/scripts/tizen.mjs deploy`, then `node ../tv-kit/scripts/tizen.mjs debug` for the inspector port.
- `node ../tv-kit/scripts/cdp.mjs <port> walk 250` records `requestAnimationFrame` gaps during a fixed key walk and prints
  frame statistics plus `Runtime.getHeapUsage`.
- `window.__sectv.results` holds `first-cards` and `ok-to-frame`. `__sectv.openTitle("tt...")` opens a title.
- Every install wipes app data, so the first launch after `deploy` has no home cache. Measure the second launch
  for the cached number.

## What made the difference

- Flat fills only, transform-only movement, virtualised rows (focused card plus a margin), small posters.
- First frame from a localStorage snapshot of ids and names; artwork URLs derive from the id.
- Prepare-ahead: the detail page opens and prepares the top source after 1 s, so OK only calls `play()`.
  The decoder is held while the page is open and released on Back, on leaving for another view and on suspend.

## Budgets

`budget.json`: JS gzip 300 KB, whole `dist/` 5 MB. `scripts/check-budget.mjs` runs after every build.

## Series app

Same shared catalog-kit as movies (13.8 KB JS gzipped for either app), measured on the same TV with Game of Thrones.

| Measure | Result |
| --- | --- |
| OK to first frame, S1E1 from a season pack, prepare-ahead on | 0.26 s |
| Episode end to next episode's first frame, next sources and CDN link prefetched | 3.3 s |
| Same, before the CDN link was warmed | 6.9 s |
| S1E1 file picked from a 10-episode pack | 62 min, 2.27 GB (the right episode) |

The gap between episodes is open + prepare of the next file. A second AVPlay object (`avplaystore.getPlayer()`) can prepare the
next episode in 4.2 s and swap in at 0.27 s, but the playing one then stops advancing and never recovers, so that route is
closed on this TV (`lessons.md`). The 3 s gap is the floor.

## Soak, cold start, suspend/restore

All on the reference TV with the series app (the heaviest screen: episode thumbnails).

| Check | Result |
| --- | --- |
| Browsing soak, about 31 minutes, 110 cycles of home walk, open detail, browse seasons and episodes, Back | JS heap 1.41 MB at start, 1.76 MB from cycle 55 on and flat for the remaining 55+ cycles; DOM stayed at 82 nodes and 19 images |
| Real process restart, cached snapshot present (3 runs) | first cards at 0.85 to 0.93 s |
| Fresh install, no cache | first cards at about 1.1 s (network catalogs) |
| In-process reload, cache cleared / cached | 0.45 s / 0.23 s (the webview's HTTP cache is warm, so not a cold number) |
| Hide a playing episode for 70 s, bring it back | page kept alive; AVPlay was paused at the same second (0:15), one OK resumed |
| Hide a prepared (READY) player for 90 s | still READY on return; OK reached the first frame in 0.64 s |
| Hide a playing episode for 5 min | still alive and paused at 0:40; one OK resumed |

Method notes:

- The soak blocks `/resolve/` calls in the page and turns prepare-ahead off, so browsing never adds torrents to the TorBox
  account. Playback itself was tested separately above.
- The soak stopped at 24 minutes when the `sdb` link to the TV dropped (the app itself was fine: uptime 46 min, same 82 nodes).
  After `sdb connect` and `sdb forward` a 7-minute top-up continued from the same state.
- "Hidden" was done by starting the launcher with `tz run`, then starting the app again. That is the same
  visibility change and restore path as Home then Smart Hub, but the system Home key was not pressed. The real Home key was then checked by hand on the TV (reported by the maintainer): while an episode played, Home, then back
  into the app and OK, and the picture returned.
- Heap is read after `HeapProfiler.collectGarbage`. Run it with
  `node ../tv-kit/scripts/cdp.mjs <port> soak <minutes>`.

## Glass lab (launcher, `?lab=` or `localStorage["nest.lab"]`)

One home screen in a floating translucent "glass" style (clock, segmented pill, weather panel, two tiles, a scrolling date strip
and a scrolling list of 10 cards whose focused card turns white), rendered three ways to choose how the glass UI is built. It
answers whether the DOM is enough or a WebGL framework (Lightning.js) is needed.

- `flat`: translucent fill and hairline only, no blur.
- `live`: `backdrop-filter: blur(26px) saturate(1.4)` on every glass surface (the TV supports it).
- `fake`: the wallpaper is blurred once at boot into a 480x270 canvas; each surface shows it behind itself, scaled x4 by the
  compositor and placed at the surface's own page position. Moving surfaces counter-move it with the same transition.

Same TV, three walks per mode, each a 48-key path through every area, starting on the first card after a reload:

```bash
node ../tv-kit/scripts/cdp.mjs <port> walk 250 Down,Down,Down,Down,Down,Down,Up,Up,Up,Up,Up,Left,Left,Left,Left,Right,Right,Right,Right,Right,Right,Right,Up,Right,Right,Right,Right,Right,Left,Left,Left,Left,Left,Up,Left,Left,Left,Left,Down,Down,Right,Up,Up,Down,Right,Right,Right,Right
```

| Mode | Median frame | p95 | Worst | Frames over 50 ms (of ~810) |
| --- | --- | --- | --- | --- |
| flat | 17 ms | 17 ms | 50-67 ms | 1-2 |
| live | 67 ms | 84 ms | 100-133 ms | 178-179 (of ~205) |
| fake | 17 ms | 33 ms | 50-83 ms | 0-1 |

- A live blur drops the whole screen to about 15 fps; the fake blur costs nothing over a flat fill. So the DOM stays, and the
  Lightning comparison was not built: it could only have matched the fake glass, at the cost of a rewrite.
- Soft outer shadows (`box-shadow: 0 18px 40px`) on the glass surfaces were the other cost: with them, flat and fake had 16-20
  frames over 50 ms per walk. Without them, and with the moving cards, chips and focus sheets on their own layers
  (`will-change`), 0-2.

## Glass Nest (launcher home and search)

The launcher built from the glass components, on the reference TV with the server running (8 apps, 2 reminders, 3 Continue
Watching entries), three walks of 36 keys through every home area and two of 26 keys through the search keyboard and results:

| Screen | Median frame | p95 | Worst | Frames over 50 ms |
| --- | --- | --- | --- | --- |
| Home | 17 ms | 17 ms | 33-50 ms | 0 |
| Search ("dune", 24 results) | 17 ms | 17-33 ms | 50 ms | 0 |

The first walk after a launch had 5 long frames while artwork decoded the first time; later walks had none. JS 18.9 KB gzip.

### Ask Nest, glow and Daylight

The same home screen with the Ask Nest panel (the wave animating all the time), a row of 6+ poster results and the
artwork glow, server running, 36-key walks through the pill, chips, results, apps and reminders:

| Theme | Median frame | p95 | Worst | Frames over 50 ms |
| --- | --- | --- | --- | --- |
| Daylight (3 walks) | 17 ms | 33 ms | 33-34 ms | 0 |
| Night (3 walks) | 17 ms | 33 ms | 33 ms | 0 |

The first two walks after a launch had 3-4 frames over 50 ms while posters decoded and their colours were read the first
time; with the wave paused or the glow hidden those first walks had none, so neither costs anything once warm. The wave is
three SVG ribbons drawn once and moved by transform (translate and a flipping scaleY). JS 30 KB gzip.

### Room microphone (Ask Nest by voice)

The same home screen on the reference TV with a Jabra Speak 510 on USB (`docs/launcher.md`, "Room microphone"), default
`cdp.mjs walk` after a reload and one warm-up walk. "Mic open" means the mic key was pressed and the clip ended with
no speech, which leaves the stream open for the next ask (no Web Audio graph is running then):

| State (3 walks each) | Median frame | p95 | Worst | Frames over 50 ms |
| --- | --- | --- | --- | --- |
| Mic never opened | 17 ms | 17 ms | 33-50 ms | 0 |
| Mic open | 17 ms | 17-33 ms | 50-67 ms | 0-1 |

Keeping the microphone open costs nothing measurable. The first walk with eleven new poster results in the row had 7
frames over 50 ms while they decoded, as in the Ask Nest walks above.

## Glass catalog home (Cinema, Shows, Anime)

The catalog home in glass, "top shelf" style: the focused title's backdrop fills the page after focus rests 0.6 s, a
frosted info panel describes it, and poster rows scroll underneath. Cinema on the reference TV, with prepare-ahead off and
the default `cdp.mjs walk` path (22 keys through Continue Watching, the saga cards and a timeline row):

| Walk | Median frame | p95 | Frames over 50 ms |
| --- | --- | --- | --- |
| 250 ms per key (backdrop rarely changes) | 17 ms | 33 ms | 4-7 of ~355 after the first walk |
| 800 ms per key (backdrop changes nearly every key) | 17 ms | 17-33 ms | 6-9 of ~1040 after the first walk |
| Rest on a title (backdrop swap and frost arrive) | 17 ms | 17 ms | 0 |
| Same home with the backdrop hidden | 17 ms | 17 ms | 1-2 |

The first walk after a launch had 13-14 while posters and art loaded. What it took to get here, in order of effect:

- The backdrop as an image in the root layer was re-scaled on every repaint (16 frames over 50 ms). On its own layer,
  decoded before it is shown, with the faded-out copy removed: the numbers above.
- Swapping the frost re-rasterized every glass layer at page scale. It now waits until focus has rested 1.2 s after the
  backdrop swap, and the saga cards in the rows have no frost (they sit over the darkest part of the shade).
- The remaining 3-4 extra long frames per fast walk, against a home with no backdrop, are the cost of compositing a
  full-page image under moving rows. Cropping it to the top 700 px did not change that.

JS 35.6 KB gzip per catalog app (39.6 KB before: the Frame dashboard went to Secretary Nest).

## Glass detail page and saga timeline

Same rules as the home (`catalog-kit/src/ui/art.tsx`): the art on its own layer, decoded first, frost only once focus
rests; the sources sheet is smoked glass and its rows carry no frost. Cinema on the reference TV, prepare-ahead off,
arrow keys only:

| Screen and walk | Median frame | p95 | Frames over 50 ms |
| --- | --- | --- | --- |
| Series detail (Breaking Bad), 30 keys through actions, seasons and episodes, 250 ms | 17 ms | 17-33 ms | 0 after the first walk (5 while stills loaded) |
| Saga timeline (The Matrix), 24 keys through steps, actions and the order pill, 250 ms | 17 ms | 33 ms | 0-3 |
| Same, 800 ms per key (the backdrop follows every step) | 17 ms | 33 ms | 9 |

The slow timeline walk pays the same full-page art cost as the home's slow walk.

## Glass Hub (search and settings)

The in-app Hub in the same glass as Secretary Nest's search: a three-row keyboard, recent-search chips, poster rails
and settings rows. Cinema on the reference TV, arrow keys only:

| Walk | Median frame | p95 | Frames over 50 ms |
| --- | --- | --- | --- |
| Search keyboard and recent chips, 27 keys, 250 ms | 17 ms | 33 ms | 1 |
| "dune" results and Continue Watching rails, 18 keys, 250 ms | 17 ms | 33-50 ms | 0 on the first walk, 7 on the second while more posters loaded |
| Sources sheet with 109 real sources, 30 keys | 17 ms | 33 ms | 2 |

The sources sheet renders only the rows around the focused one (12 of 109 in the page); before that every row was its
own compositor layer. `catalog-kit/src/style.css` went from 1,890 to 181 lines, leaving only the player and the base
styles in the old look at that point. The player moved to glass next ("Glass player" below), and `style.css` now holds
only the base styles. JS 35.2 KB gzip per catalog app.

## Glass player

While the stream prepares: the title's art and a frosted panel (status, source badges, an accent bar). Over the video
the page is transparent, so the controls are smoked glass with no frost, and their progress bar moves by transform.
The Matrix resumed through debrid on the reference TV (cinema dimming and progress sync blocked for the test):

- Playing at 57:32; the home and detail pages hidden, the page background transparent, so the video shows.
- Controls up and fading with six seeks back, 13 s: median 17 ms, p95 17 ms, 7 frames over 50 ms. One of them was a
  16 s gap: `seekBy` calls AVPlay's synchronous `seekTo`, which blocks the page until a remote 4K stream has
  re-buffered (unchanged since the first commit). The controls themselves added no long frames.

## Player over the catalog (AVPlay object)

Every start showed the loading card, then the catalog again with the film's sound. `cdp.mjs layers` during playback on the
reference TV: only `.ply-osd`, `.player`, body and html at five points, all transparent, home `visibility: hidden`. The DOM
was not covering the video; the page had no `<object type="application/avplayer">`. With the object mounted at the app
root: Dune from the home (auto play) reached the first frame in 5.9 s with a resume seek, Nest and back left it paused at
the same spot and OK played on. Movies, Series and Anime redeployed. The maintainer confirmed by eye that the picture now shows.

## Play on partial results (slow test repository)

Only the slow test repository on (providers answering after 0.3, 4 and 12 s), Play pressed about 0.9 s after the
detail page opened, time from the press to the autoplay decision on the reference TV:

| Start playing after | Decided after Play | Source |
| --- | --- | --- |
| Instantly | 0.2 s | the 0.3 s provider's 1080p |
| 3 s | 2.4 s (3.2 s into the search) | the same 1080p, the best so far |
| 5 s, 10 s | 3.4 s (4.2 s into the search) | the 4 s provider's 4K: nothing later can beat it |
| Every provider | 11.5 s | the first 4K, once the 12 s provider answered |

The sources sheet open while results stream in: 17 ms median frame, no frame over 50 ms on the second walk.

## Sources sheet grouped by quality

The Matrix Resurrections, 28 sources, the grouped sheet open, three 30-key walks on the reference TV, after making the
detail page rank its sources once per change instead of once per key press:

| Walk | Median | Frames over 50 ms |
| --- | --- | --- |
| 1 | 17 ms | 7 |
| 2 | 17 ms | 3 |
| 3 | 17 ms | 2 |

Before that change, both the grouped list and the providers' flat order had 4 to 7 frames over 50 ms on every walk.
On each key press the page re-ranked every source, read the source memory from storage, and read the failure memory
once per source.

With the filter chips added (same title, sheet open, three walks): 17 ms median, and 4, 1 and 1 frames over 50 ms.

## Next episode with the lookup moved before the card

Better Call Saul S1E1 → S1E2 through the Up next countdown: 10.4 s to the next frame when the sources were looked up at
playback start (expired by the end), 4.4 s when they are looked up about 90 s before the card. The current player is
released first (one decoder), so the next one cannot be prepared ahead; the rest is open, prepare and start.

## The island, and Home now

Home walks on the reference TV (22 keys, 250 ms), two each:

| Home | Frames over 50 ms |
| --- | --- |
| Island mounted, no message | 6, 4 |
| Island hidden | 7, 6 |
| Three island messages playing | 12, 8 |

The island itself adds nothing at rest and about 3 to 5 slow frames per walk while its messages animate. Home is at 4
to 7 even without it, against 0 to 2 recorded earlier for the glass home.

Traced in the final checks: it is not a regression from the Legacy port. The same walk on the build before it (`827966a`)
gave 11, 3, 5 and 3 frames over 50 ms, against 16, 6 and 5 on the current build. Turning plugin searches off, or
removing the AVPlay object, did not change the current numbers (6, 4, 5 and 5, 6, 4). The earlier 0 to 2 was measured
with other home rows (no Collections & Timelines row) and on another day: Home's long frames come from what it draws,
which is for its own look. JS is 55.5 KB gzip per catalog app, up from about 35 KB before the Legacy port, inside the 300 KB budget.

## Seeking during playback (AVPlay)

Cinema on the reference TV, The Matrix resumed at 57:32 from debrid (4K DV/HDR WEB-DL MP4, cached), six Left presses
(10 s each) 900 ms apart, with `/domotics` and `/resume` blocked through the inspector's Fetch domain:

```bash
node ../tv-kit/scripts/cdp.mjs <port> walk 900 Left,Left,Left,Left,Left,Left
```

| Build | Median frame | Worst frame | Frames over 50 ms |
| --- | --- | --- | --- |
| Before: `seekTo(ms)` on the prepared stream | 17 ms | 16 s | not recorded |
| `seekTo(ms, ok, err)`, presses coalesced | 17 ms | 21 s | 5 of 251 |
| Reopen at the target (`seekTo` in IDLE, then `prepareAsync`) | 17 ms | 433 ms | 1 of 305 |

- Every way of seeking a prepared stream blocks the page for the whole re-buffer, not only the plain `seekTo(ms)`.
  Single 20-30 s seeks, timed inside the call: `seekTo(ms, ok, err)` 2-34 s, `jumpBackward(ms, ok, err)` 12 s, the same
  while paused 3-29 s, and with `PLAYER_BUFFER_FOR_RESUME` at 1 s instead of 5 s 3-26 s. The callbacks fire 0.1-3 s after
  the call has already returned.
- `seekTo` in IDLE returns in about 5 ms and `prepareAsync` then starts there, off the page thread (4.5-4.9 s to the next
  first frame). So a seek closes the source and reopens it at the target. The one long frame is the decoder teardown
  (`stop()` 350-420 ms, `close()` alone on a playing stream 320 ms; pausing first does not help).
- Presses are coalesced: the reopen starts 350 ms after the last press, presses during a reopen only move the target,
  and the shown time holds the target meanwhile. In the walk above playback came back at 56:41 for a 56:44 target (the
  previous keyframe), about 5 s after the last press.
- The resume point uses the same IDLE seek, so prepare-ahead prepares at the resume point: OK to first frame 0.38 s at
  57:28, with no seek after play.
