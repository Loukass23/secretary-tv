# AniList

AniList keeps anime lists. Secretary treats it as a second watch tracker beside Simkl (`docs/simkl.md`), for anime
only. AniList has no scrobbling, so playing does nothing there. When an episode plays to the end, the list's progress
moves forward. Marking a title watched completes it, and the lists come back as watched marks on each sync.

## Setting it up

1. Create an app at anilist.co/settings/developer with the redirect `https://anilist.co/api/v2/oauth/pin`.
2. Put its client id in `.env.tizen` as `ANILIST_CLIENT_ID`, then deploy. The secret is not used: the sign-in is
   AniList's implicit grant, which hands out the token directly.
3. On the TV, go to Settings › Accounts › AniList and press OK. The preview shows two QR codes:
   1. The first opens AniList's sign-in. After it, AniList's pin page shows a long token: copy it.
   2. The second opens Secretary Desk's phone keyboard (`launcher/src/phone-keys.ts`). Paste the token there.

   The TV checks the token with AniList (`Viewer`) and keeps it only if AniList accepts it. A whole redirect URL with
   `#access_token=…` works as well.

Pasting needs Secretary Desk (the home server) to answer. Without it, OK opens the TV keyboard, which is only practical
for a token sent to the TV some other way. AniList tokens last a year; an expired token, or a 401, signs out.

## What is sent

| When | What | Where |
| --- | --- | --- |
| An anime episode plays to the end | `SaveMediaListEntry` with that episode as progress, read first so progress never moves back; the last episode completes it | `ResumeTracker.finished` |
| An anime title is marked watched | `SaveMediaListEntry` as completed | `ResumeTracker.watched` |
| A sync (each return to the home) | `MediaListCollection` for the viewer, at most every 15 minutes; planned titles are skipped | `ResumeTracker.pullWatched` |

Films and shows that are not anime are left alone. Catalog ids are matched to AniList ids through the same id mapping
service the skip times use: Kitsu ids directly, IMDb ids through its IMDb endpoint. Each match is kept on the TV
(`sectv.anilist.ids`, about 400 entries). Coming back, Kitsu titles get their episodes 1 to N marked watched. IMDb
titles only get a completed mark, because AniList does not know their seasons.

## Code

- `packages/anilist`: the GraphQL client (`createAniList`), `authorizeUrl`, `tokenFromText`, `tokenExpiry`,
  `viewer`, `stats`, `recordWatched` (with the pure `nextEntry`) and `watchedEntries`.
- `catalog-kit/src/lib/anilist.ts`: `anilistTracker()` implements `ResumeTracker`, plus the id map,
  `anilistSignIn`, `anilistStats` (cached for a day, for the profile page) and `anilistSignOut`.
- `launcher/src/anilist-account.tsx`: the Accounts lines and the two-QR preview.
