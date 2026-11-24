# The catalog inside Secretary

Secretary (`packages/launcher`) is the only TV app. Films, shows and anime are browsed and played inside it: the
catalog screens of `packages/catalog-kit` (home rows, title pages, collection folders, the Hub with its
settings, saga timelines, and the AVPlay player with the island and the control centre) mount as one view of
Secretary. There is no app switch, and no other app to fall back to.

Until November 2026 the catalog was three separate Tizen apps, Secretary Cinema, Shows and Anime, which the home
screen launched. PR #9 (2026-11-20) moved the catalog and the player inside and made that the default build. The
apps were then retired, and their packages and launch fallbacks were deleted on 2026-11-24.

## How it is put together

- **One chunk.** `launcher/src/catalog-host.tsx` loads `import("@secretary/catalog-kit")` the first time a catalog
  screen opens, so Secretary's own start does not pay for it. It mounts `CatalogApp` with an `EmbeddedHost`
  (`catalog-kit/src/app.tsx`).
- **Ways in** (`browse()` in `launcher/src/app.tsx`):
  - a title from a card, Continue watching, a search hit or the assistant opens its page (`open`; Resume plays at
    once);
  - a Nuvio collection folder opens the folder (`folder`);
  - the header's Settings button opens the Hub on Settings (`hub`);
  - **Browse all** on the end bar of an opened Cinema, Shows or Anime card opens the catalog home for that kind.
- **Search.** The catalog has no search of its own: CH-, the Search keys and its search buttons call
  `EmbeddedHost.onSearch`, and Secretary's one search (`launcher/src/search.tsx`) takes the screen. A result opens its
  page in the catalog again; Back with nothing typed reopens the catalog screen Secretary had opened.
- **Ways out.** Back at the catalog's home, Back from a page that Secretary opened, CH+, and the Home pill all call
  `EmbeddedHost.onExit`. Secretary then shows its home again and reads Continue watching, My List and the collections
  again (`refreshCloud`).
- **The player** runs in Secretary's page:
  - `<object type="application/avplayer">` stays mounted for the catalog's life, and prepare-ahead is on;
  - while a title plays, Secretary's root is hidden under `html.avplay`, with the page transparent over the video
    plane (`docs/lessons.md`, AVPlay).
- **One Nuvio client.** Secretary passes its own client (`EmbeddedHost.cloud`, `shareCloud` in
  `catalog-kit/src/lib/cloud.ts`): one session in memory, one refresh, one profile. Each time it opens, the catalog
  checks that its local lists belong to the signed-in profile (`checkOwner`), and drops them if they don't.
- **Cinema lights.** Secretary writes its SmartThings grant to `sectv.home` as the catalog opens, and every 20 minutes
  while it is open. The movie scene then runs when a film starts, and the restore scene when it ends.
- **Watch together.** Secretary's header looks up a room code and opens the room's title in the catalog
  (`CatalogConfig.open.room`), which joins the room.
- **Keys and config.**
  - The catalog's keys (metadata services, plugin repositories, the debrid keys from `.env`) are built into
    Secretary's `.wgt` (`launcher/vite.config.ts`), so never share a package you built.
  - The launcher template has the catalog's privileges as well (`productinfo` for the panel's capabilities).
- **Budget.** `packages/launcher/budget.json`: 160 KB gzip of JS and 3 MB, the catalog chunk counted.

## Measured on the TV

`docs/performance.md` keeps the numbers. In short:
- From OK on Continue watching to AVPlay playing takes about 5 s, the source search included.
- Back from the player to the page, and again to the home, takes about 370 ms.
- Play/Back cycles release the decoder every time, with a heap of 6-11 MB.
- The first open of the catalog (the chunk load) takes about 680 ms, and later opens 55-350 ms.
- Secretary's home walk has 0-2 frames over 50 ms. Walking an opened card is heavier; see the 2026-11-24 section.

## Still open

- The retired apps' own settings, debrid keys and addon lists were never migrated; Secretary has one shared set.
- The catalog's "Boot animation" setting also drives Secretary's boot.
- The player has no subtitle or audio-track menu.
- A 30-minute soak through home, catalog and player has not been run since the apps were retired.
- `nuvio/src/handoff.ts` still holds the launch-payload format that the retired apps read. Secretary no longer sends
  it; it can go once nothing else reads it.
