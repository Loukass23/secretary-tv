# Porting Nuvio Legacy 2.x ideas into the catalog apps

## Context

The maintainer wants the catalog apps (Cinema, Shows, Anime) to feel like Nuvio Legacy 2.x: they should start playing sooner,
pick sources more cleverly, remember the viewer's choices, and have a few player and design touches. Legacy is GPL-3.0
and this repo will be public, so the rule is **ideas and behaviour only**:
- no code, no close translations, no copied tables of constants;
- where this plan keeps a Legacy number (4 s, 6 h), that number is a product decision written in our own words;
- weights and scores are our own, designed for AVPlay on the reference TV.

**Where things stand today** (`feat/nuvio-plugins`):
- `plugins/src/host.ts` `find()` returns streams only once every provider has answered, or when the 30 s round ends. The cache
  check runs once, after that.
- Only `ProviderStatus[]` is pushed live, through `onStatus`, which feeds `publishStatus` and the detail page's status line.
- `lib/autopick.ts` `tryInOrder` plays the list as it comes, at most 4 sources, one at a time. The ranking comes from the
  providers, with AV1 moved last. `core/src/rank.ts` is only used by the server.
- The sources sheet (`ui/Detail.tsx`) is a flat virtualised list (`windowOf`) with 4K/1080p/Other count chips.
- Next episode: `onPrefetchNext` runs as soon as playback starts and warms `found[0]`. The stream cache's TTL is 4 min
  (`lib/streams.ts`) and the link cache's is 25 min (`lib/playable.ts`). For an episode longer than 25 min both have
  expired before the episode ends, so the prefetch is wasted.
- There is no end card, no skip intro, no pause panel and no source memory.
- Resume and Start over exist on the detail page.

## Rules every phase follows

**From `docs/lessons.md` and `docs/performance.md`:**
- Flat fills and hairlines only. No `backdrop-filter`, gradients or soft `box-shadow`. Movement is by transform only.
- Glass over video is smoked glass with no frost (the page is transparent while AVPlay plays). Frost elsewhere arrives only
  once focus rests.
- Lists render only the rows around focus (`windowOf`). The sources sheet already proves this at 109 rows.
- **One decoder.** "Checking" a source is network only (fetch). Nothing ever opens a second AVPlay. The next episode
  cannot be prepared while one plays, so the gap of about 3 s stays.
- Never send a `HEAD`. `seekTo` is synchronous and can block for seconds on a remote 4K stream, so a skip is one seek,
  never a series of them.
- Browsing never adds anything to a debrid account. Only Play, or prepare-ahead of the top source, may call `resolve`.
- Every install wipes app data. Storage goes through `readJson`/`writeJson` (`tv-kit/src/storage.ts`), with small
  capped tables. Writes go through `whenIdle`.
- Budgets (`budget.json`): JS 300 KB gzip, and each catalog app is about 35 KB today. A phase that adds more than 3 KB gzip
  says so in its commit.
- New settings go in `SETTING_ITEMS` (`lib/settings.ts`), which `HubOverlay` renders automatically. Source settings go in
  `ui/sources.ts` `sourceRows`.
- UI is built on `tv-kit/src/glass` (`Glass`, `ListCard`, `Segmented`, `IconButton`, `Scroller`), imported by path.
  Focus is `move`/`windowOf` from `tv-kit/src/grid.ts` and keys come from `useKeys`.

**Tests in every phase:**
- **Node:** `pnpm test`, which runs `node --test` on `packages/*/test/*.test.ts`, plus `tsc --noEmit`. New logic lives in
  pure modules with injected `now`, `fetch` and `kv`, as `plugins.test.ts` does with `inlineRunner` and a fake `Debrid`.
- **TV:** `tizen.mjs deploy`, then `debug` to get `<port>`, then `cdp.mjs <port> eval|keys|walk|logs|layers`.
  - Use the `__sectv` handles, adding new ones where a phase needs them.
  - Screens with new UI get a `walk` and must stay at 17 ms median and 0 to 2 frames over 50 ms after the first walk.
- **A slow test repository** (phase 1): `packages/plugins/test/fixtures/slow-repo/`, a manifest plus three providers
  that answer after 0.3 s, 4 s and 12 s with fixed results. The PC serves it with a small static server, and it is added
  in Settings › Sources. Its plain https results point at an unreachable address and `/resolve` is blocked, as
  lessons.md describes, so timing checks never touch a real debrid account.
- Each phase that changes behaviour updates `docs/plugins.md` or `docs/lessons.md` in the same commit. A measured number
  goes in `docs/performance.md`.

---

## 1. Autoplay that decides on partial results, with per-provider status

**What the user gets:**
- OK on Play, or a Continue Watching resume, starts as soon as a good enough source is known. It no longer waits for the
  slowest provider (up to 30 s).
- The sources sheet fills as providers answer, with a tab per provider showing "…", a count, or "failed".

**Where it lands:**
- `plugins/src/host.ts`: `find()` gets an `onUpdate(snapshot)` callback, fired after each provider answers.
  - The snapshot is `{ streams, status, done }`.
  - Each provider's new hashes go through `checkTorrents` as they arrive, rather than once at the end. The calls are
    debounced at about 150 ms so a burst of fast providers shares one call.
  - De-duplication is by `key` across snapshots, and the AV1-last rule applies to every snapshot.
  - The final promise stays as it is, so callers that do not need partial results are unchanged.
- `lib/streams.ts` `createPluginStreamClient`: adds `watch(id, hint, type, cb)` beside `get`, sharing the cache entry.
  A partial result is never cached as final.
- `lib/autoplay.ts` (new, pure) holds `decide(input)`:
  - Input: candidates, provider status, elapsed ms, the wait setting, the remembered source and its provider
    (phase 8), and the rules (phase 6).
  - Output: `{ go: index } | { wait: reason }`.
  - The decision order:
    1. Nothing usable: wait.
    2. Every provider has answered: go.
    3. The remembered source is present: go.
    4. Its provider is still searching inside the wait: wait.
    5. The wait has run out: go.
    6. Otherwise go only if the best candidate is "good enough": inside the size and quality limits, cached or a direct
       link, and at the top resolution allowed.
  - The reason is logged, for checking over `cdp.mjs logs`.
- Settings › Playback "Start playing after": Instantly, 3 s, 5 s (default), 10 s, or All providers.
- `ui/Detail.tsx`:
  - Pressing Play while a search runs shows "Starting when a good source is found · Alpha 12 · Beta …" and plays when
    `decide` says go. Back cancels.
  - The sheet header gets a `Segmented` row of provider tabs (All plus up to 8), fed by `onPluginStatus`.

**TV constraints:**
- A snapshot re-renders the sheet. Only the windowed rows exist, and while the sheet is closed only the "Will play"
  strip changes.
- Prepare-ahead holds the one decoder: it prepares the current top source after 1 s, and is cancelled and re-prepared
  only if the top changes and focus is still on Play.

**Tests:**
- Node:
  - Partial snapshots arrive in provider order.
  - The cache check runs once per batch.
  - `decide` has a table of cases, one per rule above.
  - The final result equals today's result.
- TV, with the slow repository:
  - Instantly plays the 0.3 s provider's source.
  - 5 s plays at about 5 s with the 4 s provider's better source included.
  - All providers waits about 12 s.
  - `eval "__sectv.results"` for ok-to-frame, and `walk` with the sheet open while results stream in.

**Phases:**
- 1a: host snapshots and the slow test repository.
- 1b: client `watch` and live sheet rows with provider tabs.
- 1c: `lib/autoplay.ts` and the Playback setting, wired to Play and to Continue Watching.

## 2. Cached sources checked in parallel, uncached ones one at a time

**What the user gets:** when the first sources are bad (a warning clip, a 403, an HTML page), the next good one plays
within seconds, and nothing the viewer did not choose is added to a debrid account.

**Where it lands:** `lib/verify.ts` (new), which runs before AVPlay is given a URL in `PlayerView`'s attempt.
- **Verifying is network only:**
  - `playable(url)` for `debrid:` sources.
  - Then a `GET` with `Range: bytes=0-1023`, a 6 s timeout, and redirects followed.
  - `res.url`, the status and `content-type` are read, and the body is cancelled.
- **The verdict** is ok, warning clip, not video, refused or no answer:
  - Warning clips are recognised by their final URL (slate or downloading placeholders).
  - HTML, JSON or text content types, or a tiny body, mean not video.
- **The queue:**
  - The leading run of "safe to check" sources goes in parallel, at most 3, under a 20 s deadline. A source is safe when
    it is a `debrid:` source the cache check confirmed, or a provider link marked cached.
  - The winner is the **first in queue order** that verifies, never simply the fastest, so the order of quality never
    changes.
  - After that run, every other source is checked one at a time, as `tryInOrder` does today.
- **TorBox:** `createTorrent` adds even a cached torrent to the account. So parallel checking applies to Premiumize
  (`directdl` adds nothing) and to provider links. For TorBox only the top source is resolved, unless a setting
  "Check TorBox sources ahead" is on (default off).
- `tryInOrder` keeps its shape and is given verified items.

**TV constraints:**
- The 6 s probe and the 15/30 s prepare timer must not add up past the user's patience: a verified source goes straight
  to `load`.
- Spike first: does a ranged `GET` from the widget get through to a TorBox CDN link and to a redirector (status, `res.url`,
  time)? The result goes in `lessons.md`. If ranges are refused, the probe reads only status and type and aborts.

**Tests:**
- Node: queue-order winner when a later source answers first, the deadline, serial fallback, no `resolve` for unchecked
  TorBox sources, and verdict classification from fake responses.
- TV: `eval` verify on a real cached Premiumize hash and a real link, with timings in `performance.md`. A fixture source
  pointing at a slate-named URL on the PC must be skipped.

**Phases:**
- 2a: spike and `lessons.md` entry.
- 2b: `lib/verify.ts` and tests.
- 2c: wiring in `PlayerView`, plus the TorBox setting.

## 3. A remembered source per title, and the same release across episodes

**What the user gets:**
- After picking a source by hand, or once an automatic pick has played for a few seconds, the next play of that title
  starts with the same kind of release (same group, same audio).
- A series keeps the same release on Next.

**Where it lands:**
- `plugins/src/host.ts` `toItem`: keeps `behaviorHints.bingeGroup` and the filename when providers send them.
  `Stream` gains optional `group` and `file` (`lib/streams.ts`, `plugins/src/host.ts`).
- `lib/sourcepref.ts` (new, pure):
  - What is stored per title id (season and episode stripped): group, release key (the file name cut at the episode
    marker), a release fingerprint from `core` `parseRelease` (group, resolution, origin, codec, HDR), the audio
    languages read from the name, the provider, and the time.
  - Storage: key `sectv.sourcepref.v1` with manual and automatic tables, 200 titles each, oldest dropped, valid 180 days.
    A future or zero time counts as valid, because of a wrong boot clock.
  - Matching is a lexicographic comparison of our own design:
    1. same group;
    2. same provider and fingerprint;
    3. same provider and audio;
    4. tie-breakers: release key, then name, then resolution.
  - A candidate missing a remembered audio language never matches.
- **Writes:**
  - A manual pick in the sheet writes the manual table and clears the automatic entry.
  - An automatic pick writes the automatic table after 3 s of playback, series only.
- **Reads:**
  - The matched source goes first in `decide`'s queue (phase 1).
  - `decide` waits for its provider, within the wait.
- **Next episode:** `PlayerView` keeps the playing source's group in memory and passes it to `onNext`. `app.tsx` prefers
  that group in the next episode's list.
- The sheet marks the row "Your previous choice".
- Setting: "Remember my source" On/Off.

**Tests:**
- Node: matching cases (dub kept, group wins, expiry, cap, wrong clock) and release-key cuts (`S01E06`, `1x06`, not
  `1280x720`).
- TV: pick the 3rd source on a series episode, Back, play the next episode, and check over `logs` that the reason is
  "remembered".

**Phases:**
- 3a: carry the group and file name through `Stream`.
- 3b: `sourcepref` and tests.
- 3c: wiring in Detail and Player, the mark, and the setting.

## 4. Next-episode card timing and prefetch

**What the user gets:**
- An "Up next" glass card appears when the credits start, or about 45 s before the end (15 s for episodes under 10 min).
- The card has a 5 s countdown (Off, or 5, 10 or 15 s). OK plays now and Back hides it.
- The next episode starts in about 3 s.

**Where it lands:** `ui/PlayerView.tsx`.
- **The card:** a smoked `Glass` above the OSD with the next episode's still and label. The countdown bar moves by
  transform.
- **Credits:** the credits marker comes from phase 5 when one is known.
- **Timing:** the duration must have been stable for a few seconds first. Movies get no card.
- **Prefetch:** moves from playback start to about 90 s before the card.
  - At that point: `streams.get` for the next episode, the phase 1 snapshot, and the phase 3 group.
  - `warm` runs only for a source that is safe to resolve (phase 2's TorBox rule).
  - A refresh runs at the card if the cache has gone stale.
  - The fix for today's expiry is to make the prefetch late, not to make the TTLs longer.
- On OK or at the end of the countdown: `stop` and `close`, then `onNext`. This keeps the one-decoder rule.
- The specials rule stays: `nextEpisode` never moves into season 0.

**Tests:**
- Node: card-time function (credits marker, short episodes, unstable duration, movie) and prefetch scheduling with a fake
  clock.
- TV:
  - Seek near the end of a real episode (one `seekTo`) and check the card appears.
  - Measure end to next frame against the 3.3 s in `performance.md`.
  - `walk` while the card counts down.

**Phases:**
- 4a: timing functions and tests.
- 4b: card UI and countdown.
- 4c: prefetch moved and measured.

## 5. Skip intro, recap and credits

**What the user gets:**
- A "Skip intro", "Skip recap" or "Skip credits" pill appears on its own for about 10 s at the start of a segment.
- Auto-skip is optional (Settings › Playback).

**Where it lands:** `lib/skip.ts` (new, pure, with injected `fetch` and `now`).
- **Sources, in order, first answer per segment type:**
  1. **AniSkip**, for anime, by MAL id and episode:
     - The MAL id comes from ARM, which `plugins/src/ids.ts` already calls for Kitsu ids.
     - Among the answers, the one whose length is closest to the file's wins. An answer more than 10% off is rejected.
  2. **TheIntroDB**, by TMDB or IMDb id plus season and episode, for the segment types still missing.
     - It asks only once the real duration is known.
     - "None" is remembered for the session.
  3. **Timed estimate**, credits only: the card time from phase 4, used for the Up next card and never for auto-skip.
- **Sanity limits:** intro and recap must fall in the first half and last at most 3 min. Credits must fall in the last 15%
  of the episode. A segment ending past the duration is rejected.
- `PlayerView` gets the pill (smoked glass, focusable with OK). Skipping is **one** `seekTo` to the segment end; see the
  blocking note above. A segment already skipped is not skipped again after seeking back.
- Cache: `sectv.skip.v1`, 300 episodes, 30 days.

**Tests:**
- Node: response parsing (fixtures written by us), length-closest choice, the limits, and the fallback order.
- TV: an anime episode via Kitsu and a series episode via TheIntroDB. Check that the pill appears and that one OK lands
  past the intro (player position over `eval`). Measure how long the seek blocks.

**Phases:**
- 5a: `lib/skip.ts` with AniSkip.
- 5b: TheIntroDB and the estimate.
- 5c: pill, auto-skip setting, and credits feeding phase 4.

## 6. Autoplay rules and skipping warning clips

**What the user gets:** control over what autoplay may pick:
- size limits;
- a "require" and a "prefer" pattern (for example only `MULTI|DUAL`, or prefer `REMUX`);
- a provider order.

Ads, "configure this addon" rows and warning clips never autoplay. They still show in the sheet, marked.

**Where it lands:**
- `lib/rules.ts` (new, pure): `rank(candidates, rules)` builds the queue that `decide` uses.
  - Order: in-scope sources first, then require/prefer, then size limits, then provider order, then the providers' own
    order.
  - Size limits are preferences: an out-of-range source goes last, it is not dropped.
  - An invalid regex is ignored, and the setting row says so.
- **Notice rows:** `plugins/src/host.ts` gets a detector of our own. A row with no resolution, size or codec token whose
  text reads as a message (a short phrase list we write: donate, configure, not available, error, expired) is flagged
  `notice` and kept out of autoplay. Warning clips by URL come from phase 2.
- **Settings:** Playback › Max size and Min size (None, 2, 4, 8, 15, 30 GB) and Require/Prefer, typed with the Hub's
  keyboard as repository URLs are. Settings › Sources › Provider order cycles a provider's position, beside the existing
  "Debrid order" row in `ui/sources.ts`.
- If sources exist but none passes the rules, the sheet opens instead of autoplay.

**Tests:**
- Node: rule tables, an invalid regex, size preferences that are not filters, notice detection (with true negatives such
  as "Error.2023.1080p"), and provider order.
- TV: set Require `MULTI` on a title, check the reason in `logs`, then clear it.

**Phases:**
- 6a: `rules.ts`, size and provider order.
- 6b: regex settings with the keyboard.
- 6c: notice rows.

## 7. Dead-link memory and a failure explanation

**What the user gets:**
- A source that failed is skipped by autoplay for 6 hours.
- The sheet shows "failed 12 min ago · server refused (403)", so the viewer knows why.

**Where it lands:**
- `lib/deadlinks.ts` (new, pure):
  - Identity: provider plus hash plus file index, or provider plus host plus path plus query. The query drops volatile
    parameters: token, sig, signature, expires, exp, auth, key-pair-id, and anything starting with `x-amz-` or
    `x-goog-`.
  - Storage: `sectv.dead.v1`, 128 entries, 6 h. A later success clears an entry.
  - Each entry carries a reason.
- **The reason** comes from AVPlay's error name (`PLAYER_ERROR_CONNECTION_FAILED`, the 15/30 s prepare timeout, "no audio
  track", decoder errors). When the error was a connection error, the reason is followed by the phase 2 probe, run once,
  6 s, in the background.
- Full URLs are never logged, only the host, because debrid keys sit in paths.

**Tests:**
- Node: identity normalisation (token stripped, `episode=` kept), TTL with a wrong clock, cap, and success clears.
- TV: a fixture source on an unreachable address fails once and is skipped on the next Play, and the sheet shows the
  reason.

**Phases:**
- 7a: `deadlinks.ts` and wiring into `tryInOrder`'s failures.
- 7b: reasons, the probe, and the sheet mark.

## 8. Pause info panel after 4 s

**What the user gets:** paused for 4 s, the screen shows:
- "You're watching", the title's logo or name, and the episode line;
- year, runtime and rating;
- three lines of synopsis;
- up to 6 cast names;
- the progress bar.

OK resumes. Any other key brings the controls back.

**Where it lands:**
- `ui/PlayerView.tsx`: a pause timer that restarts on any change. The panel is a smoked `Glass` at the lower left.
- The data comes from the title meta the app already has (Cinemeta or Kitsu: description, cast, imdbRating). There is
  no new service.
- The logo derives from the id on `images.metahub.space`, as artwork does, and is decoded before it is shown.
- Setting: Playback › Pause panel On/Off.

**TV constraints:** over video the panel has no frost and no full-page image. The OSD timer must not fight it: the panel
replaces the controls.

**Tests:**
- Node: timer state machine.
- TV: `keys Pause`, wait 5 s, `layers` shows only smoked surfaces, and `walk` with no long frames.

**Phase:** 8, one commit.

## 9. Design elements

### 9a. The sources sheet: grouped, filtered, with a details card

**What the user gets:**
- A "Best for this TV" row first, the autoplay choice.
- Then sections: 4K HDR, 4K, 1080p HDR, 1080p, 720p, Other, with headers such as "4K HDR · 12".
- Inside a section the largest file comes first, unknown sizes last, and uncached or marked rows last.
- Marks: Playing now, Your previous choice, failed N min ago, Warning clip.

**Filter chips** above the list: HDR off, MP4 only, Cached only, and Audio <language> when languages are present. When a
filter hides rows, the sheet says "N hidden by MP4 only · OK shows all".

**Details card:** hold OK, or press Info, on a row. It shows provider, full title, file, size, audio languages and the
description, scrolled in a `Scroller`.

**Where it lands:**
- `ui/sheet.ts` (new, pure): `sheetRows(streams, filters, marks)` returns headers and rows as one windowed list. Headers
  are not focusable, and `windowOf` skips them.
- `ui/Detail.tsx` renders it with `ListCard`. The chips are a `Segmented`.
- The phase 1 provider tabs sit in the same header strip.
- Setting: Sources › Sheet order, Grouped or Provider order.

**Tests:**
- Node: grouping thresholds, size sort, hidden counts.
- TV: the 109-source title from `performance.md` again, with a 30-key `walk` held at 0 to 2 long frames.

**Phases:** 9a-1 grouping and marks; 9a-2 chips; 9a-3 details card.

### 9b. Detail page: one card, and Resume carrying its progress

**What the user gets:**
- The primary button reads "Resume S2E1" with a line above it, "16% watched · 38 min left". Start over sits beside it.
- Resume plays the remembered source (phase 3) first.
- Focused buttons grow around their centre while the gaps between buttons stay constant.

**Where it lands:**
- `ui/Detail.tsx` action row.
- `lib/resume.ts` `resumeStart` and `isFinished` decide when the button shows, so the rule is the same one the player uses.
- Reach buttons by label in CDP scripts, as `lessons.md` warns.

**Tests:** Node for the label function. TV `walk` through the action row.

**Phase:** one commit.

### 9c. Glass "island" and the clock-island hub

**What the user gets:**
- A clock pill at the top centre of the catalog apps. It widens to show short messages ("Sources: Alpha failed",
  "Remembered your source", "Up next in 5 s") and shrinks back.
- **Messages:** errors go first and others queue, at most 6 queued, about 4 s each. A message with the same key updates in
  place.
- **Later step, a control centre:** holding CH+ grows the pill into a column with the time, what is playing (resolution,
  HDR) and shortcut toggles for the Playback settings.

**Where it lands:**
- `lib/island.ts` (new, pure queue).
- `ui/Island.tsx`, built on `Glass`, which grows by `transform: scaleX` on a fixed-size pill so there is no relayout,
  with the text faded in after.
- It is mounted in `app.tsx` above the views. Over the player it is smoked.
- The control centre is a separate later commit, and it depends on a spike:
  - A short CH+ already opens Nest (`docs/launcher.md`).
  - The spike checks that a hold can be told from a press through keydown repeats or keyup on Tizen without delaying
    Nest. If it cannot, the control centre goes into the Hub instead.

**Tests:**
- Node: queue priority, collapsing, keyed update.
- TV: `walk` on Home while three messages play, then a `layers` check over video.

**Phases:** 9c-1 island and queue; 9c-2 long-press spike; 9c-3 control centre (only if the spike passes).

---

## Order of commits

Each line is one commit on its own branch from `feat/nuvio-plugins`, unless the maintainer says otherwise.

| # | Commit | Depends on |
| --- | --- | --- |
| 1 | host partial snapshots and the slow test repository (1a) | — |
| 2 | live sheet rows and provider tabs (1b) | 1 |
| 3 | `autoplay.ts` decide and the Playback wait setting (1c) | 2 |
| 4 | verify spike, lessons entry (2a) | — |
| 5 | `verify.ts` and parallel checking of cached sources (2b, 2c) | 3, 4 |
| 6 | dead-link memory (7a) | 5 |
| 7 | failure reasons and the sheet mark (7b) | 6 |
| 8 | rules: size and provider order (6a) | 3 |
| 9 | rules: regex settings (6b) | 8 |
| 10 | notice rows (6c) | 3 |
| 11 | carry the group and file name (3a) | — |
| 12 | source memory (3b, 3c) | 3, 11 |
| 13 | sheet grouping and marks (9a-1) | 7, 12 |
| 14 | filter chips (9a-2) | 13 |
| 15 | details card (9a-3) | 13 |
| 16 | Resume with progress (9b) | 12 |
| 17 | next-episode timing functions and card (4a, 4b) | — |
| 18 | late prefetch, measured (4c) | 5, 12, 17 |
| 19 | `skip.ts` with AniSkip (5a) | — |
| 20 | TheIntroDB and estimate (5b) | 19 |
| 21 | skip pill, auto-skip, credits into the card (5c) | 17, 20 |
| 22 | pause panel (8) | — |
| 23 | island and queue (9c-1) | — |
| 24 | CH+ long-press spike (9c-2) | — |
| 25 | control centre (9c-3) | 23, 24 |

Commits 17, 19, 22 and 23 have no dependencies and can run in parallel sessions while 1 to 16 proceed.

## Verification at the end

- `pnpm test` and `pnpm typecheck` green, and every app builds within `budget.json`.
- On the reference TV, for each app (Movies, Series, Anime):
  - a title through the slow repository, with ok-to-frame logged for each wait setting;
  - a series run over two episodes with the remembered source, the up-next card and a skip;
  - a failed fixture source remembered and explained;
  - walks of Home, Detail with the sheet open, and the Player with the card and pause panel, compared against
    `performance.md`.
- `docs/plugins.md`, `lessons.md` and `performance.md` updated with what was measured.
- A last read of every new file against the GPL rule: no Legacy identifiers, comments or tables.

## Final checks (done)

All 25 commits landed on `feat/partial-autoplay`. The last pass found:

- **GPL read.**
  - The new code takes no code, comments or tables from Nuvio Legacy. Its "Nuvio" mentions name the plugin format it is
    compatible with.
  - Three older files, from before this port, took from Legacy. They have since been rewritten from scratch (see below):
    - `tv-kit/src/keys.ts`, the TV keyboard bridge, a close translation of Legacy's `tools/tizen-shell.html`
      ("nvTexto"): same hidden input, events, blur-commits rule, key loop and microphone check;
    - `tv-kit/src/boot.ts` and the boot styles in each app's `index.html`, Legacy's animation numbers (320 ms, 460 ms,
      the 1.018 to 1.09 zoom), cited from `abertura.c`.
  - The remote key lists in `keys.ts` and `use-keys.ts` are Samsung's own key names and codes; only their "ported from"
    comments need to go.
- **Home walk.** Not a regression from this port: the build before it gives the same 3 to 5 slow frames per walk
  (`performance.md`).
- **Anime app.** Attack on Titan (the series) found 36 sources, played in 0.4 s from prepare-ahead, and got its intro
  from TheIntroDB. The film of the same name has no source.
- **Bug fixed during the checks.** On that film, the empty search fell back to the server's addon. With the server down
  the request never ended, so Play waited for ever. The fallback now has 8 seconds, and Play then says "No source found
  for this title".
- **Not run.** The AniSkip path in the app: this catalog gives anime episodes IMDb ids, so TheIntroDB answers them. It is
  covered by the unit tests and was reached from the TV in 5a.

## Rewrite of the Legacy-derived files (done)

- **`tv-kit/src/keys.ts`, the TV keyboard bridge,** is rewritten with its own design. The public surface is kept
  (`isOpen`, `value`, `open`, `close`, `isTvImeOpen`), so callers are unchanged, and the unused microphone check is
  gone. Typing is one session at a time on an off-screen field:
  - Done or OK commits, and Cancel or Back cancels;
  - leaving the keyboard any other way commits only if the text changed from what it opened with;
  - CH+ and CH- end the session and still reach the app;
  - every other key stays in the keyboard.

  Checked on the TV in the Hub's search: Done committed "dune", leaving with new text committed "alien", leaving
  unchanged changed nothing, Back closed only the keyboard, and an arrow while typing left the Hub's focus where it was.
- **The boot screen** (`tv-kit/src/boot.ts` and each app's `index.html`) has its own motion and timings. The crest rises
  14 px and fades in over 480 ms, holds 280 ms, then the screen slides up 24 px and fades over 360 ms (fade mode: 220
  ms). Settings calls it "Quill rises in".
- **The "ported from" and "modeled on Legacy" comments** are gone from `keys.ts`, `use-keys.ts` and `boot.ts`. So are
  the "Vai tocar" wording and the "Nuvio Rose" accent name, now "Rose". No code under `packages/*/src` or in the apps'
  `index.html` names Legacy any more.

