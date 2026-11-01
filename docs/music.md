# Secretary Music

`packages/app-music` (**Secretary Music**) is a music app for the TV with YouTube as its catalogue: trending music,
search, playlists and a now-playing screen in the glass style. It is a thin Tizen shell like the catalog apps, built on
`tv-kit/src/glass`, and it tells Nest what it is playing for a "Playing Music" card.

## Setup

1. **A YouTube Data API v3 key** for browsing and search. In the Google Cloud console, enable "YouTube Data API v3"
   for a project, create an API key, and restrict it to that API (no application restriction: the TV sends no Referer
   or package name the console could check). Put it in `.env.tizen`:

   ```
   YOUTUBE_API_KEY=...
   ```

   The key ships inside the `.wgt`, like `NEST_GEMINI_API_KEY`, so never share a package you built. The free quota is
   10,000 units a day: trending costs 1, a search 101 (videos and their durations) plus 100 for playlists, a playlist
   2. The app caches answers in `localStorage` (trending for an hour, searches and playlists for 12 hours), so a day
   of normal use stays far below it. Without a key the home screen says so and nothing can be browsed.

2. **The player page.** YouTube will not play in an embed whose page sends no Referer (error 153), and a Tizen web
   app runs from `file://`, which sends none. So the app frames a small static page served over https,
   `packages/app-music/player/index.html`, which hosts YouTube's IFrame player; the app drives it with `postMessage`.
   It needs no server: the page is published on Cloudflare Pages at `https://secretary-music-player.pages.dev/`, the
   app's default. To publish it (once, and again when the page changes), signed in with `npx wrangler login`:

   ```bash
   pnpm --filter @secretary/app-music player
   ```

   `MUSIC_PLAYER_URL` in `.env.tizen` points the app at another copy instead (any https host; the page has no key and
   no state, and loads only YouTube's own script).

3. **A package id**, exactly 10 letters or digits, in `.env.tizen`:

   ```
   SECRETARY_TV_MUSIC_ID=ScrtMusics
   ```

4. Deploy from the app folder, with the server running:

   ```bash
   cd packages/app-music
   node ../tv-kit/scripts/tizen.mjs deploy
   ```

`SECRETARY_TV_LAUNCHER_ID` makes Back at the root return to Nest, as in the other apps.

## Screens and keys

| Screen | What is on it | OK does |
| --- | --- | --- |
| Home | Now playing card (the player, title, artist, progress) on the left; Trending music (the country from the TV's language), Recently played and Playlists (for the last search, "top hits" before one) on the right | plays from that track in its row, opens a playlist, opens Now playing from the card |
| Search | The search field, the player top right, Songs and Playlists rows | the field opens the TV keyboard; a result plays or opens |
| Now playing | The player large on the left with title, artist, progress and shuffle / previous / play-pause / next / repeat under it; the queue on the right with the current track in green | a control; a track in the queue plays it |

The pill at the top moves between Home, Search and Now playing. Remote keys work on every screen:

| Key | Does |
| --- | --- |
| Play/Pause, Play, Pause | play or pause |
| Fast forward, Rewind | 10 s forward or back |
| CH+ / CH- | next track / previous (more than 3 s in, previous restarts the track) |
| Search | opens Search (and the keyboard when there are no results yet) |
| Back | Now playing → the screen before it; Search → Home; Home → Nest |

Repeat cycles off, all, one; shuffle keeps the playing track and shuffles the rest. Both choices are kept for the next
queue (`localStorage["music.modes"]`). Recent plays are kept in `localStorage["music.recent"]` (24). A track YouTube
will not play here (removed, or embedding turned off by its owner, errors 100/101/150) shows a note and the queue moves
on after 1.5 s. Search asks only for videos that can be embedded (`videoEmbeddable=true`), and trending and playlist
tracks are checked with `videos.list` (`status.embeddable`), so these are rare.

YouTube's terms require its player to stay visible while it plays, so the video is always on screen: in the card on
Home, top right on Search, large on Now playing. It is one `<iframe>` for the app's life that moves between those
places when the screen changes. YouTube's own title bar and captions show inside it; the app does not hide them.

## What Nest can read

What is playing travels over a **Tizen message port**, because each Tizen app has its own storage and the catalog
apps' ways of sharing (Nuvio Cloud, the server's `/resume`, launch payloads) either need a server or only go from Nest
to an app. The record and both sides of the exchange are in `packages/tv-kit/src/now-playing.ts`:

```ts
interface NowPlaying {
  v: 1;
  title: string;
  artist: string;
  cover: string; // https artwork
  posSec: number; // at `updated`; positionAt(record, Date.now()) moves it on while playing
  durSec: number;
  state: "playing" | "paused" | "buffering" | "stopped";
  updated: number; // epoch ms
}
```

- The music app opens the local port `SecretaryNowPlaying` (`serveNowPlaying`) and answers every ask with the current
  record. It remembers who asked and pushes each change to them: a new track, play, pause, an error, and every 10 s
  of playback.
- Nest calls `watchNowPlaying("<SECRETARY_TV_MUSIC_ID>.Music", onRecord)` when its home screen shows. It opens its own
  port `SecretaryNowPlayingReply`, asks once, and gets the record and every change after that. `false` means the music
  app is not running, so nothing is playing; an empty record (`null`) means it runs with nothing loaded.
- Nothing is stored and nothing needs a server. When the music app exits the record is simply gone.

The music app has `background-support="enable"` for this: with it disabled, Tizen suspends a hidden app, and the port
never answered while Nest was in front (checked on the reference TV). YouTube itself pauses playback while the app is
hidden, so with Nest in front the record says `paused`; the app plays on when it comes back to the front, if it was
playing before.

Nest does not use this yet: the "Playing Music" column comes with the home layout rework. Opening the music app from
that card is a plain `launchApp("<id>.Music")`.

## Checked on the reference TV (GU43DU7199UXZG, Tizen 9), 2026-11-01

- YouTube's embed straight from the app's `file://` page: the player loads, then error 153 for every video. The same
  embed inside a page served over http from the LAN plays (state playing, position moving, the duration reported).
- The app with the player page served over http from a computer on the LAN (before it moved to Cloudflare Pages): OK on a trending tile plays and opens Now playing;
  Play/Pause, CH+ (next), CH- (restart, then previous), shuffle, repeat all and one, and choosing a track in the queue
  all work. A track that does not exist showed "can't be played outside YouTube" and the queue moved on. Back from
  Now playing kept the music playing in the Home card. Search through the keyboard field returned songs and
  playlists, and a playlist opened as a 5-track queue.
- Leaving for Nest and coming back: playback paused while hidden and resumed on return.
- Nest (in front, inspector) asked the music app (hidden) over the message port and got the record back within the
  same second: title, artist, cover, position 3.0 s, duration, state `paused`.
- With the page on Cloudflare Pages and a real key, no server running: trending music and playlists loaded, a trending
  track played, a search returned songs and playlists, and a playlist opened as a 10-track queue and played.
- CDP screenshots show the video area black or blank (the TV draws video on its own plane), as with AVPlay.

Frame numbers are in `docs/performance.md` ("Secretary Music"). In short: the screens alone walk at a 17 ms median
with no frame over 50 ms; while YouTube plays, its player adds about 5 frames a second of 80-130 ms in the shared
renderer, whatever the screen does.

Size: 15.9 KB of JS gzipped, 55 KB `dist/` (budget 40 KB and 128 KB).
