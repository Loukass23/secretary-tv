# Simkl

Secretary can keep a Simkl account in step with what is watched on the TV. Simkl is a **tracker** beside the sync
backend: Nuvio Cloud (or the home server) still holds Continue watching. Simkl is told what plays and what was
watched, and its history comes back as watched marks.

## Setting it up

1. Create an app at simkl.com/settings/developer, with the redirect `urn:ietf:wg:oauth:2.0:oob`.
2. Put its client id in `.env.tizen` as `SIMKL_CLIENT_ID`, then deploy. A build without one shows Simkl as unavailable.
3. On the TV, go to Settings › Accounts › Simkl and press OK. The preview shows a code and a QR for simkl.com/pin. Enter
   the code on a phone, and the TV connects within a few seconds. The code lasts 15 minutes.

The token is stored on the TV (`sectv.simkl.token`). Simkl tokens do not expire. A 401 answer forgets the token, and
the line goes back to "Not connected".

## What is sent

| When | Call | Where |
| --- | --- | --- |
| Playback starts, pauses or the player closes | `/scrobble/start`, `/scrobble/pause`, `/scrobble/stop` with the percentage watched. Simkl marks it watched at 80 % or more. | `PlayerView` `persist()` → `reportPlayback` (`catalog-kit/src/lib/resume.ts`) |
| A film or episode plays to the end | The scrobble stops at 100 %, or `/sync/history` when nothing was scrobbling | `saveProgress` → `ResumeTracker.finished` |
| A title is marked watched by hand | `/sync/history` | `markTitleWatched` → `ResumeTracker.watched` |
| A sync (each return to the home) | `/sync/all-items`, at most every 15 minutes; Sync now clears the wait | `syncAllResume` → `pullTrackers` |

Ids are the catalog's own: IMDb `tt…` ids go as `imdb`, and `tmdb:`, `kitsu:` and `mal:` ids go as their number.
Titles with any other id are skipped. Unmarking a title as watched stays local: Simkl keeps its history.

## Code

- `packages/simkl`: the client (`createSimkl`), the PIN sign-in (`startPin`, `waitForPin`), and the bodies, scrobble,
  history, all-items and stats (`sync.ts`). These are pure where they can be and are tested with a fake fetch.
- `catalog-kit/src/lib/simkl.ts`: `simklTracker()` implements `ResumeTracker`. Also `simklStats()` (cached for a day,
  for the profile page) and `simklSignOut()`.
- `launcher/src/accounts-settings.tsx`: the Accounts category, the one client, and `startTrackers()`, called once in
  `app.tsx`.
