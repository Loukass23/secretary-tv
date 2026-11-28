# Simkl

Secretary can keep a Simkl account in step with what is watched on the TV. Simkl is a **tracker** beside the sync
backend: Nuvio Cloud (or the home server) still holds Continue watching. Simkl is told what plays and what was
watched, and its history comes back as watched marks.

## Setting it up

1. Create an app at simkl.com/settings/developer. New apps are OAuth 2.0 apps.
2. Put its client id in `.env.tizen` as `SIMKL_CLIENT_ID` (64 characters) and its secret as `SIMKL_CLIENT_SECRET`, then
   deploy. A build without an id shows Simkl as unavailable.
3. On the TV, go to Settings › Accounts › Simkl and press OK. The preview shows a code, and a QR for simkl.com/pin with
   the code filled in. Confirm on a phone, and the TV connects within a few seconds. The code lasts 15 minutes.

The sign-in is the OAuth 2.0 device flow: `POST /oauth2/device` gives the code, and `POST /oauth2/token` (with the
client secret) answers `authorization_pending` until the phone confirms. `slow_down` adds 5 s between checks. An app
made before OAuth 2.0 is refused at `/oauth2/device` and falls back to the older `/oauth/pin`.

The token is stored on the TV (`sectv.simkl.token`). An OAuth 2.0 token is renewed with its refresh token a minute
before it runs out, once at a time. A 401 answer, or a refresh Simkl refuses, forgets the token, and the line goes back
to "Not connected".

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

- `packages/simkl`: the client (`createSimkl`), the sign-in (`startPin`, `checkPin`, `waitForPin`) and the token refresh, and the bodies, scrobble,
  history, all-items and stats (`sync.ts`). These are pure where they can be and are tested with a fake fetch.
- `catalog-kit/src/lib/simkl.ts`: `simklTracker()` implements `ResumeTracker`. Also `simklStats()` (cached for a day,
  for the profile page) and `simklSignOut()`.
- `launcher/src/accounts-settings.tsx`: the Accounts category, the one client, and `startTrackers()`, called once in
  `app.tsx`.
