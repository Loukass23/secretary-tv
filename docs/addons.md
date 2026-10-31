# Stremio addons

The catalog apps install Stremio addons, the protocol Nuvio also uses, next to the Nuvio plugin repositories
(`plugins.md`). An addon is a manifest URL. The apps ask it over plain HTTP for streams, subtitles, meta and catalogs.
Everything is local to the TV for now. The list has the shape Nuvio Cloud syncs (`addons` table, `sync_push_addons`),
so a sync adapter can be added later without touching the rest.

Code: `catalog-kit/src/lib/addons.ts` (store, URLs, manifest checks, resource client), wired up in
`catalog-kit/src/lib/plugins.ts`. Tests: `catalog-kit/test/addons.test.ts`, plus the host test in
`plugins/test/plugins.test.ts`.

## Store

`createAddonStore({ kv })` uses the same injected `KV` as the plugin store (`readJson`/`writeJson` on the TV, a Map in
tests). It is saved under `sectv.addons` as an array in the user's order:

```ts
{ url, name, enabled, sort_order, manifest, fetchedAt, error? }
```

- `install(input)` reads the manifest first and refuses an address that is not an addon, one that is already
  installed, or a 33rd addon. The input can be `https://…`, `stremio://…`, with or without `/manifest.json`, with a
  query.
- `toggle` / `setEnabled`, `move(url, ±1)`, `remove`. Every change renumbers `sort_order` 0…n-1.
- `refresh(force?)` reads manifests older than 6 h again, like the plugin repositories. A failed read keeps the old
  manifest and records `error`, so an addon whose host is down for a moment keeps working. Reads of the same addon
  share one request.
- **Sync seam:** `synced()` returns `{url, name, enabled, sort_order}[]`. `replace(list)` full-replaces the list from
  that shape: addons already installed keep their manifest, new ones are read by the `refresh()` that `replace`
  starts, and bad or duplicate URLs are dropped. A Nuvio adapter only needs `synced()` for a push, `replace()` for a
  pull, and `subscribe()` to know when to push.

## URLs

The base is the manifest URL without `/manifest.json`. Any query string (some addons carry their configuration
there) goes back on after the resource path:

```
https://host/cfg/manifest.json?token=1  →  https://host/cfg/stream/series/tt1%3A1%3A2.json?token=1
```

Resources: `stream/<type>/<id>.json`, `subtitles/<type>/<id>.json`, `meta/<type>/<id>.json`, and
`catalog/<type>/<id>[/<extra>].json`. The extra is `search=q`, `genre=g` and `skip=N`, joined by `&` in that order,
with values URL-encoded. Episode ids are `tt…:S:E`, and anime ids are `kitsu:…:E`.

## Which addon is asked

`supportsResource(manifest, resource, type, id)` follows Stremio:

- the resource must be listed, either as a string or in object form;
- the object form's `types` and `idPrefixes` replace the manifest's when it has them;
- an absent or empty `idPrefixes` accepts any id;
- catalogs are matched on the manifest's `catalogs` list (each catalog names its own type), and a catalog is asked
  only with the extras it declares, including all the required ones (`catalogTakes`). Old manifests with
  `extraSupported`/`extraRequired` are read too.

## Streams

Addons do not get a stream path of their own. The plugin host (`plugins/src/host.ts`) gained an `extra` option: one
job per enabled addon that serves the id, built by `addons.streamJobs(type, id)`. Each job's results go through the
same pipeline as a provider's:

- `toItem` turns them into items, and links with proxy headers are dropped (AVPlay cannot send headers; an addon's
  `behaviorHints.proxyHeaders` becomes `headers` for that check);
- duplicates are dropped by hash or URL;
- `infoHash` torrents go through the shared debrid check in the user's debrid order;
- AV1 goes last;
- each addon gets a per-source status line on the detail page (`ProviderStatus` with `id: "addon:<manifest id>"` and
  `repo: <manifest url>`).

Order: plugin providers first, then addons in install order. Addon jobs are one HTTP request each, so they run at
once, outside the Worker pool of six. They are cut at the same per-provider and round deadlines.

Addons use the title's own id, not the TMDB target, so they still run when plugins are off or when the id cannot be
mapped to TMDB. `pluginsActive()` is true when any enabled addon serves streams. `createPluginStreamClient` is
unchanged: it caches, sends partial lists to `watch`, and falls back to the server's addon only when plugins and
addons together found nothing.

## Meta

`fetchMeta` (`cinemeta.ts`) asks the addons first, through `setAddonMeta`:

1. addons whose meta `idPrefixes` match the id;
2. then other addons whose meta resource takes the type (no prefixes, or prefixes that match);
3. each group in install order, where the first meta that comes back wins;
4. if no addon answers, the existing chain runs: TVDB/TMDB when keys are set, then Cinemeta/Kitsu.

Anime asks types `anime` then `series`. An addon meta still goes through `toTitle`, so only `tt…` and `kitsu:…` ids
become titles; other ids fall through to the chain. Artwork from other hosts is replaced by metahub's, as for
Cinemeta.

Note: a user who installs Cinemeta as an addon gets Cinemeta's meta ahead of TMDB's. That is the order this design
asks for, and it matches Nuvio, but it loses the TMDB collection link on the detail page.

## Subtitles

`addons.subtitles(type, id)` asks every enabled addon that serves subtitles for the id, in parallel. It merges their
answers in install order, keeps each link once, skips addons that fail, and returns `{id, url, lang, addon}[]`.

**Not connected to the player yet:** the player has no subtitle list today, and `docs/lessons.md` forbids
`setSelectTrack("TEXT", …)`. Showing external subtitles means AVPlay's `setExternalSubtitlePath` plus
`onsubtitlechange`, drawn by the page over the video. That has to be measured on the TV first: whether it is safe
with prepare-ahead, whether it survives reopening to seek, and what it costs per frame. That is the next step.

## Settings › Addons

In the Hub's Settings, after Sources (`ui/sources.ts` `addonRows`, `ui/HubOverlay.tsx`). Each addon is a glass list
card:

- OK turns it on or off;
- ‹ › moves it in the order;
- a Remove row under it needs a second OK to confirm;
- the card shows what the addon gives (streams, subtitles, details, catalogs), its types, its row count and its last
  read error.

The last two rows are "Install an addon", which opens the TV keyboard for the manifest URL, and "Read addons again".

## Home rows

Each enabled addon catalog that needs no search or genre becomes a home row after the built-in `rowsFor()` rows, with
the addon's name as the row's origin label (`addonRowDefs`). Catalogs that declare `skip` load more as focus gets
within six cards of the row's end (`nextPage`). Each page URL is asked once, so the catalog's last page (one that
adds nothing) stops the paging. Pages are de-duplicated by id. The rows are read again only when the set of addon
catalogs changes, not on every manifest read. Rows stay windowed, so a long row costs nothing extra on screen.

## Budget

The whole feature adds 3.0 KB gzip per app: 56.3 KB to 59.3 KB of the 300 KB budget, measured with `check-budget.mjs`
on all three apps.

## Not done yet

- Subtitles in the player (above).
- Addon catalogs in the Hub's search (`addons.catalogs(type, { search })` and `catalogUrl` are ready).
- Genre rows (`genre` options are parsed, but no UI picks them).
- Configurable addons (`behaviorHints.configurable`): the user pastes the configured manifest URL instead.
- Not tried on the TV yet: installing a real addon, its streams in the sources sheet, and paging a real catalog.
