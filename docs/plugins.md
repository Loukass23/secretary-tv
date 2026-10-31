# Streams from Nuvio plugins

The catalog apps find streams on the TV with [Nuvio](https://github.com/NuvioMedia) plugin repositories, the same
repositories the official Nuvio apps install. This project ships none: you add a repository's manifest URL in
**Settings › Sources** (or put it in your gitignored `.env.tizen`), and you are responsible for what it finds.

`packages/plugins` is the host and `catalog-kit/src/lib/plugins.ts` sets it up in the apps. It is our own
code: the Nuvio apps are GPL-3.0, so only their documented contract and behaviour were followed.

## What a repository is

A `manifest.json` with a `scrapers` list. Each entry names a provider script by `filename`, which is resolved against
the manifest's URL. The fields read are `id`, `name`, `description`, `filename`, `supportedTypes` and `enabled`, the
last one being the default for the user's toggle.

A provider is CommonJS and exports `getStreams(tmdbId, mediaType, season, episode)`, which returns
`[{ name, title, url, quality, size, infoHash?, headers? }]`. When a result also has `behaviorHints.bingeGroup` (the
same release across episodes) or a file name (`behaviorHints.filename` or `filename`), the app keeps them as the
stream's `group` and `file`, for the source memory. The maintainer's repository sends neither today (0 of 24 sources for an
episode on the reference TV), so the memory matches its sources by provider, release details and audio instead. It can use:
- `fetch`, where `Response.json()` gives `null` on a bad body, as in the Nuvio runtimes;
- the globals `SCRAPER_ID`, `SCRAPER_SETTINGS` (always `{}`) and `TMDB_API_KEY`.

`require` offers nothing yet, so providers that need cheerio or crypto-js fail.

Manifests and provider code are read again after six hours. If that read fails, the old copy is kept. Everything is
stored in `localStorage` under the keys `sectv.plugins` and `sectv.plugin.code:*`.

## A search

1. **The catalog id becomes a TMDB id** (`plugins/src/ids.ts`):
   - IMDb ids go through TMDB's `/find` when the build has `TMDB_API_KEY`, and through Cinemeta's `moviedb_id`
     without one.
   - A Kitsu episode the catalog has placed in a season (from its IMDb numbering) goes through ARM to the show's
     TMDB id.
   - Any other anime id is passed as `kitsu:<id>` with the absolute episode, as the official apps do. Only providers
     that know anime answer those.
2. **Every enabled provider runs.** Each is filtered by `supportedTypes` and runs in its own Worker (`?worker&inline`,
   because the app is loaded over `file://`). Up to 6 run at once, each gets 20 s, and the whole round gets 30 s.
   The Worker is terminated when it answers or overruns, so a provider that hangs costs nothing afterwards.
3. **Results arrive as providers answer.** `find()`'s `onUpdate` gets a snapshot after each provider answers, and
   after each debrid check (torrents from providers answering within 150 ms of each other share one check). A torrent
   shows up once its check is back, in its provider's place. The last snapshot is marked `done` and equals what the
   promise returns.
4. **Results keep the providers' own order**, because providers rank for the device themselves. Duplicates are
   removed by info hash or URL, and AV1 goes last because AVPlay never prepares it.
5. **Provider messages are flagged.** A row with no resolution, codec or size whose words read as a notice ("configure",
   "donate", "expired", "not available", "error") is marked `notice` (`plugins/src/host.ts` `isNotice`). It shows in
   the sheet as "ⓘ A message from the provider, not a film" and never autoplays; a release named "Error.2023.1080p" is
   not one.
6. **Two kinds of streams are skipped:**
   - those that need `headers`, because AVPlay cannot send them;
   - torrents that no debrid service has cached.
7. **When the plugins find nothing**, the app asks the server's Stremio addon instead, if the build has a server and
   the server has `UPSTREAM_ADDON`. That request has 8 seconds: a server that is down ends the search empty rather than leaving it, and a pending Play,
   open. Play on a title with no source says "No source found for this title" on the island.

The detail page shows each provider's progress while it waits, for example "Example Provider 15 · Anime Provider searching".
The sources sheet is grouped by quality (`catalog-kit/src/ui/sheet.ts`). It starts with "Best for this TV", the source
autoplay would start. Then come sections for 4K HDR, 4K, 1080p HDR, 1080p, 720p and Other, each headed with its count
("4K HDR · 10"). Inside a section the largest file comes first, sizes the source does not give come after, and sources
that failed recently or are provider messages come last. Headers never take focus. Settings › Playback "Sources list
order" switches back to the providers' own order, with no headers.

Filter chips sit above the list: HDR off, MP4 only, Cached only, then Audio chips for up to three languages that some
sources announce and others do not (the most common first). Up from the first source reaches the chips, where Left and
Right move along them, OK turns a chip on or off, and Down goes back to the list. The heading says what the chips
hide, for example "28 sources · 20 hidden by Audio Multi". When they hide everything, the list says "All hidden by the
filters · OK shows all", and OK clears them. Opening the sheet starts with no chip on.

Holding OK on a source for 0.6 s, or pressing Info, opens its details card: provider, quality, size, audio languages,
file name and binge group when the provider gives them, and the source's text as the provider wrote it. Up and Down
scroll it; OK or Back closes it. The stream's URL is never shown, because it can hold debrid keys. A short OK still
plays the source; it now acts when the button is released, so that holding can open the card instead.

The sources sheet lists what has been found so far ("29 sources so far") and fills as providers answer. Its tabs show
All, then each provider (up to eight) with its count, "…" while it searches, or "failed"; Left and Right move between
them. With the sheet open while results stream in, the reference TV kept a 17 ms median frame and no frame over 50 ms
on the second walk.

## When Play starts

Play does not wait for the slowest provider (`catalog-kit/src/lib/autoplay.ts`). Settings › Playback "Start playing
after" (Instantly, 3, 5 by default, or 10 seconds, or when every provider has answered) sets how long it may wait,
counted from when the title's search started. The decision is taken again whenever a provider answers and every
250 ms:

1. Nothing found yet: wait, or give up once the search is over.
2. Every provider has answered: play.
3. A remembered source (coming with the source memory) is in the list: play it. Its provider still searching: wait
   for it, within the wait.
4. The wait has run out: play the best source so far.
5. Before that, only a 4K source starts early, since nothing found later can beat it. "When every provider has
   answered" waits even then.

"The best" is the first source in the order autoplay tries them (`catalog-kit/src/lib/rules.ts`). Each step only
breaks the ties left by the one before:
1. real sources (not provider messages) matching Settings › Playback "Autoplay only sources matching";
2. sources that have not failed recently;
3. sources matching "Prefer sources matching";
4. inside the size limits from "Largest file autoplay picks" and "Smallest file autoplay picks" (None, 2, 4, 8, 15 or
   30 GB);
5. the best resolution, AV1 last;
6. the provider order from Settings › Sources, where Left and Right on a provider move it;
7. the list's own order, which is the providers' own ranking.

The two patterns are typed with the TV keyboard (OK types, Left clears), for example `MULTI|DUAL` or `REMUX`. They are
matched case-insensitively against a source's name and title; a pattern that is not a valid regular expression is
ignored, and its row says so. Size limits and Prefer are preferences: a source outside them is tried after the others
and still shows in the sheet. Require is the one hard rule, and only for autoplay. When no source matches it, or only
provider messages were found, Play waits for every provider, then opens the sources sheet to pick from. A 4K source
starts early only when it matches Require and is inside the limits. Every Play goes through this decision, whether or
not the search is over. The rest of the order is the failover queue. The best source is also the
"Will play" line, the sheet's "Auto-picked" row and what prepare-ahead prepares. On the reference TV, The Matrix played
a 24.4 GB 4K release with no limit and a 4.0 GB 4K release with a 15 GB limit. With Require `MULTI` it went past 15
better-ranked sources to a MULTI 4K one, and with `zzzz` the sheet opened. While Play waits, the detail page says "Starting
when a good source is found" with each provider's progress, and Back cancels. Continue Watching and Up Next cards start
the same way. The reason is logged as `[autoplay] source N of M: <reason>` for `cdp.mjs logs`.

## Remembering the viewer's source

With Settings › Playback "Remember my source" on (the default), a title starts with the same kind of release as last
time (`catalog-kit/src/lib/sourcepref.ts`):
- **Manual picks:** a source picked by hand in the sheet is remembered for the title at once.
- **Automatic picks:** on a series, an automatic pick is remembered once it has played for 3 seconds.
- **Storage:** the manual and automatic tables hold 200 titles each, for 180 days, under `sectv.sourcepref.v1`. An
  episode counts as its show. A time in the future or zero, from a wrong boot clock, still counts.

A candidate is the same kind of release when it keeps every remembered audio language and shares one of these:
- the binge group;
- the provider and the release details (group, resolution, origin, codec, HDR);
- the provider and the audio.

Ties go to the closest:
1. group;
2. provider and details;
3. provider and audio;
4. the release name without its episode;
5. the name;
6. the resolution.

Provider notices and sources that failed recently are never the match. The match plays first ("[autoplay] … remembered"
in the logs). While its provider is still searching, Play waits for it within the wait. The sheet marks it "★ Your
previous choice". On Next, the next episode starts with the same kind of release as the one that just played.

On the reference TV, picking the 3rd source of Better Call Saul S1E1 by hand made Play on S1E2 start the same kind of
release ("source 1 of 22: remembered"). Resuming from Continue Watching waited for that source's provider, then played
it.

## Resume on the detail page

When a title or episode was left part-way, its detail page shows a thin progress line above the buttons, for example
"16% watched · 38 min left" (`lib/resume.ts` `resumeLabel`, under the same rule the player uses to resume). The main
button reads "▶ Resume", or "▶ Resume S2E1" for a series, and "↺ Start over" sits beside it for films and episodes
alike. Resume plays the remembered source first.

## Up next

Near an episode's end an "Up next" card shows over the video: the next episode's still, its label, and a countdown
(`lib/upnext.ts`, `ui/PlayerView.tsx`). It appears 45 s before the end, or 15 s for episodes under 10 minutes, once
the reported duration has held still for 3 s; films get none. OK plays the next episode at once, Back hides the card
and keeps watching, and Settings › Playback "Up next countdown" sets Off, 5 (default), 10 or 15 seconds. Moving on
releases the current player before the next one opens. When credits markers come with the skip feature, the card will
show where the credits start.

The next episode's sources are looked up about 90 s before the card (`prefetchAt`), not when playback starts. Before
this change, an episode longer than the stream cache's 4 minutes ended with the lookup expired, and Next started from
nothing. The source Next will play first (the same release when there is one) is also resolved then, but only when
doing so adds nothing to a debrid account (`safeToCheck`).

On the reference TV, Better Call Saul S1E1 → S1E2 after the countdown:

| Lookup | Next episode's first frame |
| --- | --- |
| At playback start (before) | 10.4 s |
| About 90 s before the card | 4.4 s |

## Skip intro, recap and credits

`catalog-kit/src/lib/skip.ts` finds where an episode's intro, recap and credits are. For anime it uses AniSkip, by the
MAL id that ARM gives for a Kitsu or AniList id, and by episode number. AniSkip reports each segment with the length of
the file it was measured on:
- per type, the answer whose length is closest to this file's wins, and one more than 10% off is rejected;
- an intro or recap must start in the first half and last at most 3 minutes;
- credits must start in the last 15% of the episode, and nothing may end past it.

Other series go to TheIntroDB (`/v4/media`, by IMDb or TMDB id, season, episode and the file's `duration_ms`, which
picks the closest release cut). A missing start there means the episode's start and a missing end its end. No key is
needed to read; it allows 5,000 requests a day per address. When no source places the credits, an estimate does: the
Up next card's time. The estimate only places the card and is never skipped to.

Found answers, and AniSkip's "nothing known", are kept for 30 days (`sectv.skip.v1`, 300 episodes). TheIntroDB's
"nothing known" is kept for the session only, since episodes get submissions over time. From the TV, ARM, AniSkip and
TheIntroDB each answered in about 0.1 s. Better Call Saul S1E1 has an intro at 6:00 to 6:13 and credits from 52:35.

In the player (`ui/PlayerView.tsx`), segments are asked for once the duration holds still. A "Skip intro" or "Skip
recap" pill shows for the first 10 seconds of the segment, and OK skips it with one seek to its end (AVPlay's seek blocks
the page while it re-buffers, so never more than one). A segment skipped once is not offered again after seeking back
into it. With Settings › Playback "Skip intros and recaps by themselves" on, they are skipped without the pill. Credits
are not offered as a skip. When a source placed them, the Up next card shows where they start, and OK there plays the
next episode.

On the reference TV, Better Call Saul S1E1: after a jump to 5:55 the pill showed at 6:02, and one OK landed at 6:14,
past the intro. The longest frame during the seek was 367 ms.

## Pause panel

Paused and left alone for 4 seconds (any key restarts the wait), the player shows what is playing in place of its
controls (`lib/pausepanel.ts`):
- "You're watching" and the title's logo, decoded before it shows; anime has no logo and shows its name;
- the episode line;
- year, runtime and rating;
- three lines of the episode's synopsis, or the title's;
- the progress bar.

OK resumes. Settings › Playback "Pause panel" turns it off. The data is what the app already has, so the panel lists no
cast. On the reference TV, frames held 17 ms with none over 50 ms while it showed, and only its own smoked surface sat
over the video.

## The island

Short messages show in one glass pill (`lib/island.ts`, `ui/Island.tsx`), which replaced the app's toast. It sits at the
bottom centre, or at the top over the video, out of the controls' way:
- one message at a time for about 4 s;
- errors before other messages;
- at most 6 waiting, the oldest information dropped first;
- a message with the key of one showing or waiting updates it in place.

The pill has a fixed size and grows from its centre by transform, and its text fades in after, so it never relayouts the
page. The detail page sends "<provider> failed" when a search ends with a provider in error, and "Playing your source
from last time" when the source memory picks. The plan's clock pill was left out: every screen already shows the time,
and the top centre of Home holds the section switch.

## Control centre

Holding CH+ opens the control centre (`ui/ControlCentre.tsx`): the time, what is playing (title, resolution, HDR,
codec), and shortcuts to the Playback settings (Start playing after, Remember my source, Skip intros and recaps, Pause
panel, Up next countdown). Up and Down move, OK, Left and Right change a setting, and Back or a short CH+ closes it.

One listener in `app.tsx` takes CH+ before any screen, using the key timing in `docs/lessons.md` (Input):
- the first repeat of a held CH+, about 0.35 s in, opens the control centre;
- a CH+ released with no repeat opens Nest, 0.1 to 0.3 s later than before, since it now waits for the release.

The Hub keeps its own CH+ for when the TV keyboard is open. On the reference TV, the hold opened the control centre over
Home and over a playing film, a setting changed from it was saved, Back closed it with playback still running, and a
short CH+ sent the app to the background for Nest.

## Checking a source before it plays

The player checks each source before AVPlay gets it (`catalog-kit/src/lib/verify.ts`). It resolves a `debrid:` source,
then sends a `GET` for the first kilobyte. The answer is one of:
- **ok**;
- **warning clip:** a file or folder named like a placeholder ("downloading", "not cached", a slate), or under 20 MB;
- **not video:** an HTML, JSON or text type;
- **refused:** any status but 200 or 206;
- **no answer:** within 6 s.

A source that fails is skipped in well under a second, without using one of the player's four tries, instead of
costing AVPlay's 15 s prepare timer.

The leading run of sources that are safe to check ahead is checked three at a time, while the first one is being
tried. Safe means checking adds nothing to a debrid account: Premiumize's direct links and links from providers. The
source that plays is still the first in order that passes, never the fastest to answer. Every other source is checked
only when its turn comes. TorBox sources are the exception, because TorBox adds a torrent to the account even to check
a cached one: they are checked ahead only when Settings › Sources › "Check TorBox sources ahead" is on (off by default).

On the reference TV, three redirector links were checked in parallel in 0.3 s in all (26.3, 19.8 and 4.3 GB). A file
named `downloading.mp4`, a 404 and an HTML page were each turned down in 40 to 150 ms.

## Sources that failed recently

A source that fails to play (its check turns it down, AVPlay refuses it, or prepare times out) is remembered for six
hours with the reason (`catalog-kit/src/lib/deadlinks.ts`, stored under `sectv.dead.v1`, at most 128 entries). A later
success forgets it. The same source is recognised across searches by:
- its provider;
- its service, hash and file for a debrid source;
- for a link, its host, path and lasting query: an episode number stays, while tokens, signatures and expiries go.

The reason is kept in words (`catalog-kit/src/lib/failures.ts`), for example "server refused (403)", "a placeholder
clip, not the film", "took too long to prepare" or "its audio cannot play on this TV". A connection failure does not
say whose fault it was. After one, the link is checked once in the background, and what the check finds (a refusal, an
error page) replaces the vague reason. The sources sheet marks each recent failure, for example "⚠ Failed 12 min ago ·
server refused (403)", in place of its tags.

Autoplay picks only among sources that have not failed recently, unless every one has. Past the first source, the
player passes over a recent failure. A source chosen by hand in the sheet always plays. Entries stamped in the future,
for example after a wrong clock was corrected, are not trusted. Keys hold paths, which can hold debrid keys, so they
stay on the TV and are never logged.

On the reference TV, the slow test repository's three unreachable links all failed their check and were remembered
and marked in the sheet as "⚠ Failed just now · the server did not answer". With the maintainer's repository back on, the
next Play of the same title picked a live 1080p link over the remembered 4K ones, and it played.

## Debrid

There are two kinds of provider stream:
- A plain `https` link, such as a redirector that resolves on its own debrid account. It plays as it is.
- A `magnet:` or `infoHash`. It is checked against the debrid services that have a key, in the user's order
  (`core/src/debrid.ts`: TorBox, Premiumize), and kept as `debrid:<service>:<hash>`.

A `debrid:` stream becomes a CDN link only when it is played or prepared ahead (`catalog-kit/src/lib/playable.ts`), so
browsing never adds anything to a debrid account. The file is chosen with the same rules the server uses
(`core/src/files.ts`).

The keys are entered in Settings › Sources and stored on the TV. A build can also take `TORBOX_API_KEY` and
`PM_API_KEY` from the gitignored `.env` as defaults. Those keys are then inside your `.wgt`, so never share that
package.

## Measured on the reference TV (GU43DU7199UXZG, Tizen 9)

- A Worker fetches manifests, provider code and provider APIs across origins with no CORS block: the app's
  `<access origin="*">` covers Workers too.
- The TV's own User-Agent (`SMART-TV; LINUX; Tizen 9.0`) contains `Tizen`, so a repository that adapts to TVs by User-Agent
  sees a TV.
- Dune with a four-provider repository returned 44 streams. Three providers answered in 0.3 to 0.5 s; one anime-only
  provider took 5 s to return nothing. The first stream, a 4K Dolby Vision redirector link, played and resumed at its
  saved position.
- Game of Thrones S01E01: 29 streams, every provider within 0.9 s. Attack on Titan episode 1 from its Kitsu id,
  mapped through ARM because the catalog places it in season 1: 36 streams. One Piece episode 1000, which has only an
  absolute number, returned nothing, because those providers do not take `kitsu:` ids. The server's addon answers
  that one when the build has one.

## Not done yet

- **Headers:** a Chromium `fetch` cannot set `User-Agent`, `Referer` or `Cookie`, so providers that depend on them get
  nothing. NuvioTVSmart solves this with a packaged Tizen Web Service acting as a local proxy. That needs new
  privileges, so it is a separate step.
- **Modules:** `require("cheerio")` and `require("crypto-js")` are not available. They would have to be lazy chunks
  inside the Worker.
- **Isolation:** providers run as plain JavaScript in the Worker. A QuickJS-WASM sandbox would add memory caps if they
  turn out to be needed.
- **Uncached torrents:** they are dropped. There is no download-then-play.

## Slow test repository

`packages/plugins/test/fixtures/slow-repo` has three providers that answer after 0.3 s, 4 s and 12 s with one fixed link
each, pointing at 192.0.2.0/24 (reserved for documentation), so nothing is played or resolved. A fourth answers at once
with a message row ("Configure this addon"), which must never autoplay. To time how the app waits
for providers, serve it to the TV and add the printed URL in Settings › Sources:

```bash
node packages/plugins/scripts/serve-fixture.mjs
```

