# Nuvio Cloud

Nest and the catalog apps are moving their accounts and sync from `@secretary/server` to Nuvio Cloud. Nuvio Cloud is the
Supabase-compatible API behind the official Nuvio apps, at `https://api.nuvio.tv`. Signing in to the same account and profile
shares Continue Watching, watched history, the library, addons and plugin repositories with the official apps. The server
stays in the repo as a dev and test backend (`SYNC_BACKEND=secretary`).

The client is `packages/nuvio` (`@secretary/nuvio`). It is plain TypeScript with an injectable `fetch`, and it does not use
`@supabase/supabase-js` because of the 300 KB budget.

## What is documented and what is not

nuvio.tv/docs (v1.3) documents these:
- auth/v1: password, refresh, logout, user
- profiles
- addons
- library, with delta cursors
- watch progress and watched history, with deltas and deletes
- settings blobs and collections
- the avatar catalog
- `get_sync_overview` and `health_ping`

The official TV apps also use calls the docs do not list. Each of them is called from exactly one function in
`@secretary/nuvio`, and every one fails soft:

| Call | Used for | Function |
|---|---|---|
| `POST auth/v1/signup {data:{tv_client}}` (falls back to `grant_type=anonymous`) | The anonymous session that the QR RPCs run under | `ensureSession` |
| `rpc/start_tv_login_session {p_device_nonce, p_redirect_base_url, p_device_name}` | Opens a TV login (gives a code and the QR URL) | `startQrLogin` |
| `rpc/poll_tv_login_session {p_code, p_device_nonce}` | `pending` / `approved` / `expired` / `cancelled` / `used` | `pollQrLogin` |
| `functions/v1/tv-logins-exchange {code, device_nonce}` | Trades an approved code for the account's tokens | `exchangeQrLogin` |
| `rpc/verify_profile_pin {p_profile_id, p_pin}` | Profile PIN | `verifyPin` |
| `GET rest/v1/plugins`, `rpc/sync_push_plugins` | Plugin repositories (phase 5) | — |

## Session rules
- The session (`sectv.nuvio.session`) and the chosen profile (`sectv.nuvio.profile`) persist, so the TV stays signed in.
  Signing in to a different account resets the profile to 1.
- The access token is renewed 30 s before it expires, one renewal at a time, and a 401 gets one renewal and one retry.
- Only a refresh rejected as invalid (a 4xx, or `invalid_grant` / `refresh_token_not_found`) signs the TV out. A 5xx or
  no network keeps the session for the next try.
- **Two apps never share a refresh token.** Refresh tokens rotate, and reusing one can revoke the whole session. Each Tizen
  app is its own package with its own localStorage, so each holds its own session (see phase 0).

## Mapping (phase 3)
- Positions are stored in ms; ours are in seconds.
- Movie: `content_type:"movie"`, `content_id:"tt…"`, `video_id` = `content_id`.
- Series: `content_type:"series"`, `video_id:"tt…:S:E"`.
- Anime: `content_type:"series"` with `content_id:"kitsu:N"`. Nest picks the Anime app from the `kitsu:` prefix.
- Progress rows carry no name or art. Those come from the library row, or from a cached Cinemeta/Kitsu meta lookup.

## Phase 0: checks on the reference TV (2026-10-30)
Run from the Movies app's webview on the reference TV (GU43DU7199UXZG) through `tv-kit/scripts/cdp.mjs`. The maintainer
approved the QR code on their phone. Every write went to profile 3 ("Frenchie"), which is kept for testing.

- [x] **QR sign-in works from Tizen.**
  - The anonymous `signup` needs only the `apikey` header; a bearer is optional.
  - `start_tv_login_session` returns `{code (32 hex), web_url, expires_at (~20 min), poll_interval_seconds: 3}`.
  - The poll goes `pending` → `approved`, and `tv-logins-exchange` returns 200.
  - The exchange body is flat: `{access_token, refresh_token, token_type, expires_in}`. It has **no `user`**, so the
    user id comes from the JWT `sub`, which `toSession` already does.
- [x] **Option A works: Nest signs the apps in.**
  - nuvio.tv/tv-login approves with `rpc/approve_tv_login_session {p_code}`, called with the signed-in user's token. The
    answer is `[{success: true, message: "TV login approved"}]`.
  - A second anonymous session started its own login, and Nest's session approved it. The poll then said `approved`
    and the exchange gave a session for the same user with a **different `session_id`**.
  - Both refresh tokens then renewed independently (200 / 200), and Nest's session kept working.
  - Plan: each catalog app opens its own login on first run and hands the code to Nest; Nest approves it.
- [x] `start_device_login_session` exists too. It returns `{device_code, user_code (6 chars, e.g. 9G84RX),
      verification_uri: https://nuvio.tv/link, verification_uri_complete, expires_at}`. The site approves it with
      `approve_device_login_session {p_user_code}` and reads it with `get_device_login_session {p_user_code}`. The short
      code is easier to type than a 32-hex one.
- [x] **Avatars:** `get_avatar_catalog` returns 42 entries, and `storage_path` has no bucket, e.g.
      `animals/bram-v1.png`. The image is at `storage/v1/object/public/avatars/<storage_path>` (200, image/png).
- [x] **Profiles:** `sync_pull_profiles` works. The `profiles` table also has `uses_primary_plugins`, plus
      `profile_background_id/url`.
- [x] **Overview:** `get_sync_overview` also counts `plugins` per profile, which is useful for the empty-list guard.
- [x] **Plugins:**
  - `sync_push_plugins {p_profile_id, p_plugins:[{url, name, enabled, sort_order, repo_type:"NUVIO_JS"}],
    p_origin_client_id}` → 204. Rows read back from `GET rest/v1/plugins` with the same fields.
  - An empty push (`[]`) is accepted and clears the profile (→ 0 rows). This is exactly why the guard is needed.
- [x] **Addons:**
  - `sync_push_addons` → 204, and order and `enabled` are kept. Profile 3 was restored exactly afterwards.
  - Stored URLs are **as typed**: one row is `https://opensubtitles-v3.strem.io` with no `/manifest.json`. The sync
    adapter must normalise them when reading and push back the stored form.
- [x] **Watch progress:**
  - These pushed with 204: a movie (`tt0111161`), a next-episode row at **position 0 / duration 0**
    (`tt4574334:1:2`), and an anime row with `content_id: "kitsu:1376"`.
  - The server keyed them `tt0111161`, `tt4574334_s1e2` and `kitsu:1376_s1e3`.
  - The delta cursor started at 0, and the delta returned three `upsert` events.
- [x] The official app shows all three rows correctly in Continue Watching, including the position-0 next episode and
      the `kitsu:` anime. So "Up next" can be a position-0 row, with no need to derive it from watched history. The test
      rows were then deleted with `sync_delete_watch_progress {p_profile_id: 3, p_keys}` (204).

## Nest (phase 2)
- First run opens the sign-in screen (`launcher/src/account.tsx`): a QR code drawn with `uqr`, plus email and password
  on the TV keyboard. "Not now" goes home and is remembered (`sectv.nuvio.skipped`). An expired code is replaced by a
  new one.
- After sign-in comes "Who's watching?". It shows the profiles with their catalog avatars, asks for a PIN through the
  TV keyboard on locked profiles, and has a Sign out tile. The avatar in the bottom-left of the home screen (focus area
  `me`) opens it again.
- Launching Cinema, Shows or Anime from Nest goes through `launchCatalogApp` (`launcher/src/cloud.ts`). The first
  launch for an account and profile mints the app a session of its own (`mintAppSession`), and that session goes in
  the app-control payload `secretary` (`encodeLaunch`). `sectv.nuvio.grants` remembers which app got which
  `user:profile`, so later launches are plain launches.
- **Reinstall rule** (`needsGrant`): a grant also records the app's install time (`tizen.application.getAppInfo(id)
  .installDate`). Reinstalling an app wipes its storage, session included. When the install time no longer matches,
  Nest mints a new session on the next launch.
  - This needs nothing from the app, and no refresh token is shared: each grant is a new session from
    `mintAppSession`.
  - Fail-soft: when Tizen gives no install time, the grant stands as before. A grant recorded before this rule (a
    plain `user:profile` string) is replaced once.
  - An update that keeps the app's storage also changes the install time. The app keeps its own session for the
    same account and profile (`takeLaunch`), so the new one goes unused until it expires. The version is no help:
    every build is 0.0.1.
  - Checked on the TV (profile 3, 2026-10-30): Movies got a session, and the grant recorded its install time.
    Redeploying Movies wiped its session and moved the install time on. The next launch from Nest re-minted, and
    Movies was signed in again with a new `session_id`. Deploying an app wipes its storage, Nest included: after a
    Nest deploy, sign Nest in again.
  - Not covered: an app that loses its session some other way (a refresh rejected as invalid) stays signed out until
    a sign-out or profile switch in Nest.
- Checked on the TV: the session and profile 3 arrived in Movies with their own `session_id`. The apps read the
  payload in phase 3.
- `SYNC_BACKEND=secretary` in `.env.tizen` turns all of this off (dev and tests against the home server).

## Watch sync (phase 3)
- Each catalog app has its own client (`catalog-kit/src/lib/cloud.ts`). On start and on every wake, `takeLaunch` reads
  Nest's payload once (by its `at`).
  - A grant for another account or profile replaces the app's session and clears the local lists
    (`clearLocalResume`).
  - An `open` title goes straight to its detail page, playing when `autoPlay`. With Nuvio this replaces the server's
    `/handoff`, and Nest no longer posts there.
  - An `open.room` (a watch-party code, from Nest's 👥 Watch together) also joins that room, which then opens its own
    episode and release (`docs/watch-party.md`, "The TV client").
- `resume.ts` syncs through a `ResumeRemote` (`nuvioRemote`). Without one it keeps the home server path.
  - **Sync rule** (`mergeWithCloud`): the cloud's list is the truth up to the last successful sync
    (`sectv.resume.lastSync`). Entries saved on the TV since then win when they are newer, and are pushed again, so
    a save made offline is not lost.
  - **A finished episode** first pushes the next one at position 0, then pushes a watched item and deletes the
    finished episode's progress key. **A finished movie** pushes a watched item and deletes its key.
  - **Watched ids:** marking a title watched or unwatched pushes or deletes a watched item. Pulled movies and whole
    series join the local list.
- Nest's Continue Watching is the profile's progress (`pullProgress` → `toItems`). Name and art come from Cinemeta or
  the Kitsu addon (`withMeta`, cached in `sectv.nuvio.meta`). An item opens in the app for its kind.
- **Limit:** Nuvio only knows movie and series, so only `kitsu:` ids come back as anime. An anime saved with an IMDb
  id shows in Nest as a series and opens in Shows.
- **Checked on the TV (profile 3):**
  - Nest gave Movies its session.
  - Nest's payload opened and played The Shawshank Redemption in Movies. Stopping saved 72 s locally.
  - Nest's Continue Watching then showed it from Nuvio (60 s; the server may skip small changes).
  - Tizen fires no event at all when a running app is relaunched while it is already in front. In real use Nest is
    in front, so the app wakes on `visibilitychange`.

## My List (phase 4)
- The detail page has a "＋ My List" / "✓ My List" button. The home screen shows a "My List" row of the titles saved
  for the app's kind, under Continue Watching.
- `catalog-kit/src/lib/library.ts` keeps the list per app (`sectv.library.v1`). Each add or removal also goes in a
  queue (`sectv.library.pending`) until the cloud has it.
- On sync, the cloud's library is pulled, the queue is applied on top, and the queue is sent in order. An offline
  change is therefore neither lost nor undone by the next pull.
- `nuvioLibrary` (`lib/cloud.ts`) uses `sync_pull_library` (paged by 500), `sync_push_library_items` and
  `sync_delete_library_items`. Writes carry a per-install `p_origin_client_id`.
- Anime comes back as anime only for `kitsu:` ids, as with progress. Another account or profile clears the local list.
- A title saved without a poster URL (shown with IMDb-id artwork) gets the metahub poster address, so the official
  apps have art for it too.
- **Checked on the TV (profile 3):**
  - Five detail buttons fit on one line.
  - "＋ My List" saved The Shawshank Redemption to Nuvio's library (name, year, rating, poster), and the home row showed
    it.
  - A fresh install of Movies pulled it back from the cloud.
  - Removing it cleared it from Nuvio, and adding it again restored it.

## Plugins and addons (phase 5)
- `catalog-kit/src/lib/listsync.ts` keeps a TV list and the profile's cloud list the same. Both are full-replace on
  the server. The rules are:
  - **First sync ever on the TV:** merge the two lists, the cloud's first, and send the result. Nothing set up
    before is lost.
  - **Another account or profile:** take its cloud list as it is.
  - **Otherwise:** take the cloud's list, unless the TV's list changed since the last agreed one (kept in
    `sectv.nuvio.pluginSync` / `sectv.nuvio.addonSync`). In that case the TV's list is sent.
  - **Empty cloud list:** it only empties the TV once `get_sync_overview` counts 0.
  - Changes on the TV are pushed 1.5 s after they stop. Manifest refreshes don't count as changes.
- URLs are compared normalised (`…/manifest.json`) but pushed back in the form the cloud stored them, so the official
  apps' rows keep their identity (`md5(url)`).
- **Plugins:**
  - Only `NUVIO_JS` rows are ours. Other kinds (Android DEX, `.cs3`) are kept and sent back untouched in every push.
  - Per-scraper toggles and the provider order stay on the TV.
  - `pluginStore.synced()` / `replace()` are the seam.
- **Addons** use the addon store's existing `synced()` / `replace()`.
- **Sharing profile 1's lists:** a profile with `uses_primary_plugins` / `uses_primary_addons` reads profile 1's list
  and never writes it.
- All three apps read the same profile lists, so a repository added in one app reaches the others on their next wake.
- **Checked on the TV (profile 3, which has `uses_primary_plugins: true`):**
  - Movies and Shows both showed profile 1's plugin repository and wrote nothing to it.
  - Frenchie's two addons came down to both apps.
  - Switching an addon off on the TV reached the cloud about 4 s later, and switching it on again restored it. The
    OpenSubtitles row kept its stored URL (no `/manifest.json`).
  - The `plugins` table has no `url_template` column (NuvioTVSmart reads one defensively), and selecting it fails
    the whole query.

## Collections (phase 8)
- Nuvio collections are folders of catalogs built in the nuvio.tv editor, one JSON blob per profile. The TV only
  reads them. Editing stays on nuvio.tv.
- `@secretary/nuvio` (`collections.ts`):
  - `sync_pull_collections {p_profile_id}` → `[{profile_id, collections_json, updated_at}]`. No row means the profile
    has no collections.
  - `sync_push_collections {p_profile_id, p_collections_json}` replaces the whole blob. `pushCollections` takes the
    complete list (a pull's `raw`, edited), never a partial one. The TV does not call it today.
  - `collectionsArray` accepts the rows, `{collections}`, the bare array, and any of them as a JSON string. A reply
    that cannot be read (cut, malformed) is `null`, and the cached copy stays.
  - Parsing is lenient. Unknown fields are ignored. A folder without a usable source is skipped, and so is a
    collection without folders. `tileShape` (or `posterShape`): `POSTER`, `LANDSCAPE`/`WIDE`, anything else
    `SQUARE`. `viewMode` defaults to `TABBED_GRID`, and `showAllTab` to true.
  - Sources (`catalogSources`, or the older `sources`):
    - addon: `{addonId, type, catalogId}`, optionally `addonBaseUrl`, `genre` (`"None"` means none) and `title`.
    - `provider:"tmdb"`: `tmdbSourceType` (LIST, COLLECTION, PERSON, DIRECTOR, COMPANY, NETWORK, or a discover),
      `tmdbId`, `mediaType` MOVIE/TV, `sortBy`, `filters`.
    - `provider:"trakt"`: `traktListId`, `mediaType`, `sortBy`, `sortHow`.
  - **Safety caps** (`COLLECTION_CAPS`): 600 folders, 2000 sources, 128 sources per folder (a real folder has 51). A collection that would
    pass one is left out whole, never cut halfway, and the log names it. The ones after it still get their chance.
- `catalog-kit/src/lib/nuviocollections.ts`:
  - The last pull is cached per account and profile (`sectv.nuvio.collections`, keyed by `owner()`). It is pulled on
    start and on every wake, next to the library and lists. Another profile's copy is never shown, and a grant for
    another profile clears it.
  - **Kinds:** an addon source fits the app of its type (`movie`, `series`/`tv`, `anime`). TMDB and Trakt fit by
    `mediaType` (MOVIE → Cinema, TV → Shows; a Trakt list of both fits both). A folder shows the sources of the
    app's kind that this TV can read. A folder with none is hidden, and so is a collection with no folder left.
  - **Readable sources:** an addon source needs an installed, enabled addon whose manifest `id` is the `addonId`
    (or whose base URL is the `addonBaseUrl`). TMDB needs a TMDB key. Trakt needs `TRAKT_CLIENT_ID` at build time
    and is skipped without it.
  - **Home rows:** one per collection, after My List, the pinned ones (`pinToTop`) first. The app's own curated
    sagas no longer have home rows: they are `lib/sagas.ts` and `ui/SagaTimeline.tsx` now, kept for the upcoming
    Discover page, and the detail page still links a title to its saga.
    - A card shows its cover image, else its emoji, else its title. `hideTitle` hides the name over a cover, and
      the catalog count is in the info panel, not on the card.
    - The focused art is the folder's `heroBackdropUrl`, else the collection's `backdropImageUrl`, else the cover.
  - **Looks** (`lib/collectionlayout.ts`, Settings › Collections; each setting has Automatic). The choices follow
    nuvio-native-legacy's row styles, folder views and tab styles, with nothing copied from it.
    - **Card shape and size:** Poster, Landscape, Square or Highlight 4:3, at Compact, Standard or Large (×0.85,
      ×1, ×1.15; every shape is 270 high at Standard, so rows keep one rhythm).
      - Automatic is the shape most of the collection's folders have (a tie goes to the first folder's), at
        Standard.
      - A long OK on a row (the first key repeat) opens its style menu beside the info panel: a line per shape,
        then the size.
      - Each step shows on the row at once. OK keeps it, Back puts the old style back.
      - The row's own style is kept on this TV (`sectv.collections.rowStyle`) and wins over the setting.
    - **Folder view:** Grid, Rows, Timeline (oldest first, the year on the line where it changes), Cover flow,
      Ranking (a big numeral beside each poster), Mural (wide art, four to a line) or Decades (a row per decade,
      newest first).
      - Automatic follows the collection: `TABBED_GRID` is Grid, `ROWS` and `FOLLOW_LAYOUT` are Rows. A folder made
        only of filmographies opens as Timeline.
      - The View button (top right; Up from the tabs) sets that folder's own view (`sectv.collections.folderView`).
        "Default" goes back to the setting.
    - **Tabs** (every view but Rows has them): Chips, Dropdown (OK opens the list), Centre bar or Pages.
      - Pages: Left and Right on the pill turn the page, and so do Left from the first column and Right from the
        last.
      - Automatic is Chips up to 5 tabs, else Dropdown.
    - "All" comes first when `showAllTab` is set and there is more than one source. It takes titles from each
      source in turn, every title once.
  - **Folder page** (`ui/NuvioFolder.tsx`), opened with OK:
    - Pages are read as focus nears the end. Addons page with `skip` when the catalog lists it. TMDB pages by `page`
      up to `total_pages`; collections and filmographies are one page. Trakt pages by 20. A page that adds nothing
      ends the source.
    - Only the focused row reads further pages; the rows around it read their first page only. Decades are cut from
      everything read so far, and more is read as focus reaches the last decade.
    - Back returns to the home (from the tabs or the View button, first to the titles). A title opened from the
      folder returns to the folder.
  - **TMDB results** carry TMDB ids, but streams are found by IMDb id.
    - A TMDB title shows at once as `tmdb:movie:603`, with TMDB's poster and art.
    - OK matches it to its IMDb id (`/{movie|tv}/{id}/external_ids`), cached in `sectv.tmdb.imdb` (up to 3000), and
      then opens the detail page. A title TMDB has no IMDb id for says so and does not open.
    - A title matched before comes back with its IMDb id on the next page read.
    - Measured on the TV (2026-10-31): mapping every title up front cost 214 lookups to open the Netflix folder.
      Mapping on OK costs one request per row.
- Debug hooks for `cdp.mjs`: `__sectv.collections()` lists what the app shows, and `__sectv.openFolder(collectionId,
  folderId)` opens one.
- **Measured on the maintainer's account (profile 1):**
  - Every folder carries `catalogSources: []` beside a full `sources` list, so the parser takes whichever has entries.
  - Its one collection ("Streaming Services") has 22 folders of up to 51 sources, 743 in all. Every source is TMDB
    (LIST, DISCOVER) or Trakt, with discover filters such as `withWatchProviders: "8|1796"` and `withoutGenres`.
  - `sync_push_collections` takes `p_collections_json` as the bare array (204).
- **The maintainer's builds have no TMDB key** (`TMDB_API_KEY` unset) and no `TRAKT_CLIENT_ID`. So that collection
  shows nothing on the TV until one of them is set.
- **Checked on the TV (2026-10-30, profile 3):**
  - Sworm's collection was copied to Frenchie and pulled into Movies (218 KB cache). It was hidden as expected, with
    no key.
  - A test collection on the installed "Nuvio Catalog Addon" was then pushed to Frenchie:
    - The pinned row came right after My List, with landscape 480×270 cards: a cover with its title hidden, an
      emoji card and a title-only card. The focused folder's hero filled the backdrop.
    - A tabbed folder opened as a grid and paged with `skip=20`, then `skip=40`.
    - In Shows, a folder with two series catalogs showed "All", then one tab per catalog. "All" mixed both, and
      switching tabs changed the grid.
    - A ROWS folder showed one row per catalog.
    - OK opened the detail page, Back returned to the folder at the same title, and Back again went home.
  - Frenchie's collections were set back to empty afterwards.
- **Checked on the TV with the maintainer's real collections (2026-10-31, Frenchie, TMDB key set):**
  - Cinema showed "Streaming Services" (21 folders), "Anime" (3) and "Discover" (3). Shows showed 20, 6 and 2;
    "Top Streaming Series" is Trakt-only, so it is hidden without a Trakt client id.
  - The rows use landscape covers, with the folder hero behind and the catalog count in the info panel.
  - Rows folders (Netflix, an Anime folder) open with one request per row, and the focused row reads page 2 at
    its end.
  - A tabbed folder (Discover, 19 catalogs) loads one first page per catalog for "All", and each tab shows its own
    catalog.
  - OK on a TMDB title makes one `external_ids` lookup, then opens the detail page: a movie (17 sources) and a
    series (Bleach).
  - Found and fixed in this check:
    - Opening a folder cost 226 requests.
    - The rows below the focused one read pages nobody looked at.
    - Discover sources that differ only by filters shared one key, so "All" and every tab showed one catalog.
    - Long tab names were cut at both ends.
- **Reinstalling an app wipes its storage, session included,** and Nest still thinks it granted one. So the app
  stays signed out until Nest's grants are cleared (`sectv.nuvio.grants`) or the profile changes.
