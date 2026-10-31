import { test } from "node:test";
import assert from "node:assert/strict";
import { type CollectionSource, type NuvioCollection, parseCollections } from "@secretary/nuvio";
import { type AddonState, parseAddonManifest } from "../src/lib/addons.ts";
import {
  addonFor,
  clearLocalNuvioCollections,
  collectionRows,
  collectionsFor,
  interleave,
  loadNuvioCollections,
  loadSourcePage,
  pageRequest,
  resolveSource,
  rowShape,
  setCollectionsRemote,
  sourceKinds,
  sourceUsable,
  syncNuvioCollections,
  tmdbFilters,
  withImdbId,
} from "../src/lib/nuviocollections.ts";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const addonState = (url: string, manifest: unknown): AddonState => ({
  url,
  name: (manifest as { name: string }).name,
  enabled: true,
  sort_order: 0,
  manifest: parseAddonManifest(manifest),
  fetchedAt: 1,
});

const movies = addonState("https://movies.example/cfg/manifest.json?k=1", {
  id: "org.movies",
  name: "Movie Lists",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "popular", name: "Popular", extra: [{ name: "skip" }, { name: "genre" }] },
    { type: "movie", id: "streaming_netflix_movies", name: "streaming_netflix_movies" },
    { type: "series", id: "popular", name: "Popular Shows" },
  ],
});
const kitsu = addonState("https://anime.example/manifest.json", {
  id: "org.kitsu",
  name: "Kitsu",
  resources: ["catalog"],
  types: ["anime"],
  catalogs: [{ type: "anime", id: "trending", name: "Trending", extra: [{ name: "skip" }] }],
});
const active = [movies, kitsu];

const src = {
  movie: { provider: "addon", addonId: "org.movies", type: "movie", catalogId: "popular" },
  series: { provider: "addon", addonId: "org.movies", type: "series", catalogId: "popular" },
  anime: { provider: "addon", addonId: "org.kitsu", type: "anime", catalogId: "trending" },
  missing: { provider: "addon", addonId: "org.gone", type: "movie", catalogId: "x" },
  tmdb: { provider: "tmdb", tmdbSourceType: "COLLECTION", tmdbId: 10, mediaType: "MOVIE" },
  tmdbTv: { provider: "tmdb", tmdbSourceType: "NETWORK", tmdbId: 213, mediaType: "TV" },
  trakt: { provider: "trakt", traktListId: 7, mediaType: "" },
} satisfies Record<string, CollectionSource>;

const sample = (): NuvioCollection[] =>
  parseCollections([
    {
      id: "studios",
      title: "Studios",
      backdropImageUrl: "https://img/studios.jpg",
      folders: [
        { id: "a24", title: "A24", tileShape: "LANDSCAPE", coverImageUrl: "https://img/a24.jpg", catalogSources: [src.movie, src.series] },
        { id: "ghibli", title: "Ghibli", tileShape: "LANDSCAPE", coverEmoji: "🌱", catalogSources: [src.anime] },
        { id: "hbo", title: "HBO", tileShape: "POSTER", heroBackdropUrl: "https://img/hbo.jpg", catalogSources: [src.tmdbTv] },
      ],
    },
    { id: "pinned", title: "Pinned", pinToTop: true, folders: [{ id: "x", title: "X", catalogSources: [src.movie, src.missing] }] },
  ])!;

test("source kinds: addon types, TMDB and Trakt media types", () => {
  assert.deepEqual(sourceKinds(src.movie), ["movie"]);
  assert.deepEqual(sourceKinds({ ...src.series, type: "tv" }), ["series"]);
  assert.deepEqual(sourceKinds(src.anime), ["anime"]);
  assert.deepEqual(sourceKinds({ ...src.movie, type: "channel" }), []);
  assert.deepEqual(sourceKinds(src.tmdbTv), ["series"]);
  assert.deepEqual(sourceKinds(src.trakt), ["movie", "series"]);
});

test("each app sees only the folders and sources of its kind", () => {
  const all = sample();
  const ids = (list: NuvioCollection[]) => list.map((c) => [c.id, c.folders.map((f) => `${f.id}:${f.catalogSources.length}`)]);
  assert.deepEqual(ids(collectionsFor(all, "movie")), [
    ["studios", ["a24:1"]],
    ["pinned", ["x:2"]],
  ]);
  assert.deepEqual(ids(collectionsFor(all, "series")), [["studios", ["a24:1", "hbo:1"]]]);
  assert.deepEqual(ids(collectionsFor(all, "anime")), [["studios", ["ghibli:1"]]]);
  // Only what can be read here: the uninstalled addon goes, TMDB needs a key.
  const usable = sourceUsable("series", active, {});
  assert.deepEqual(ids(collectionsFor(all, "series", usable)), [["studios", ["a24:1"]]]);
  assert.deepEqual(ids(collectionsFor(all, "movie", sourceUsable("movie", active, {}))), [
    ["studios", ["a24:1"]],
    ["pinned", ["x:1"]],
  ]);
});

test("row shape: the folders' majority, a tie goes to the first folder", () => {
  assert.equal(rowShape([{ tileShape: "POSTER" }, { tileShape: "LANDSCAPE" }, { tileShape: "LANDSCAPE" }]), "LANDSCAPE");
  assert.equal(rowShape([{ tileShape: "SQUARE" }, { tileShape: "POSTER" }]), "SQUARE");
  assert.equal(rowShape([{ tileShape: "POSTER" }, { tileShape: "SQUARE" }, { tileShape: "SQUARE" }, { tileShape: "POSTER" }]), "POSTER");
});

test("collection rows: pinned first, folder cards with cover, emoji and art", () => {
  const rows = collectionRows(sample());
  assert.deepEqual(
    rows.map((r) => [r.id, r.rowKind, r.tileShape]),
    [
      ["nuvio-col:pinned", "folders", "SQUARE"],
      ["nuvio-col:studios", "folders", "LANDSCAPE"],
    ],
  );
  const [a24, ghibli, hbo] = rows[1].items;
  assert.equal(a24.poster, "https://img/a24.jpg");
  assert.equal(a24.background, "https://img/studios.jpg", "no hero: the collection's backdrop");
  assert.equal(a24.badge, undefined, "nothing on top of the cover");
  assert.equal(a24.description, "2 catalogs");
  assert.deepEqual(a24.folder, { collectionId: "studios", folderId: "a24", emoji: undefined, hideTitle: false });
  assert.equal(ghibli.folder?.emoji, "🌱");
  assert.equal(ghibli.poster, undefined);
  assert.equal(hbo.background, "https://img/hbo.jpg", "the folder's hero first");
});

test("addon sources resolve by manifest id, else by base URL; names skip id-like ones", () => {
  assert.equal(addonFor({ ...src.missing, addonBaseUrl: "https://movies.example/cfg/" }, active), movies);
  assert.equal(addonFor(src.missing, active), undefined);
  const r = resolveSource(src.movie, "movie", active, {})!;
  assert.equal(r.title, "Popular");
  assert.equal(r.catalog?.id, "popular");
  assert.equal(resolveSource({ ...src.movie, catalogId: "streaming_netflix_movies" }, "movie", active, {})!.title, "Movie Lists");
  assert.equal(resolveSource({ ...src.movie, title: "Netflix" }, "movie", active, {})!.title, "Netflix");
  assert.equal(resolveSource(src.movie, "series", active, {}), null, "another kind");
  assert.equal(resolveSource(src.missing, "movie", active, {}), null);
  assert.equal(resolveSource(src.tmdb, "movie", active, {}), null, "TMDB without a key");
  assert.equal(resolveSource(src.tmdb, "movie", active, { tmdb: "k" })!.title, "Collection");
  assert.equal(resolveSource(src.trakt, "movie", active, {}), null, "Trakt without a key");
  assert.ok(resolveSource(src.trakt, "series", active, { trakt: "t" }));
});

test("page requests: addon skip and genre, TMDB endpoints, Trakt headers", () => {
  const keys = { tmdb: "k", trakt: "t" };
  const addon = resolveSource({ ...src.movie, genre: "Drama" }, "movie", active, keys)!;
  assert.equal(pageRequest(addon, 1, 0, keys)?.url, "https://movies.example/cfg/catalog/movie/popular/genre=Drama.json?k=1");
  assert.equal(pageRequest(addon, 2, 40, keys)?.url, "https://movies.example/cfg/catalog/movie/popular/genre=Drama&skip=40.json?k=1");
  const noSkip = resolveSource(src.series, "series", active, keys)!;
  assert.equal(pageRequest(noSkip, 2, 20, keys), null);

  const coll = resolveSource(src.tmdb, "movie", active, keys)!;
  assert.equal(pageRequest(coll, 1, 0, keys)?.url, "https://api.themoviedb.org/3/collection/10?api_key=k");
  assert.equal(pageRequest(coll, 2, 0, keys), null);
  const net = resolveSource(src.tmdbTv, "series", active, keys)!;
  assert.equal(
    pageRequest(net, 3, 0, keys, new Date("2026-10-30T12:00:00Z"))?.url,
    "https://api.themoviedb.org/3/discover/tv?api_key=k&page=3&sort_by=first_air_date.desc&with_networks=213&first_air_date.lte=2026-10-30&with_status=0|3|4",
  );
  const trakt = resolveSource(src.trakt, "movie", active, keys)!;
  const req = pageRequest(trakt, 2, 0, keys)!;
  assert.equal(req.url, "https://api.trakt.tv/lists/7/items/movies?page=2&limit=20&extended=full");
  assert.equal(req.headers?.["trakt-api-key"], "t");
});

test("discover sources that differ only in their filters are separate sources", () => {
  const base = { provider: "tmdb", tmdbSourceType: "DISCOVER", tmdbId: 0, mediaType: "MOVIE", sortBy: "primary_release_date.desc" } as const;
  const a = resolveSource({ ...base, filters: { withGenres: "28" } }, "movie", active, { tmdb: "k" })!;
  const b = resolveSource({ ...base, filters: { withGenres: "12" } }, "movie", active, { tmdb: "k" })!;
  const c = resolveSource({ ...base }, "movie", active, { tmdb: "k" })!;
  assert.equal(new Set([a.key, b.key, c.key]).size, 3);
});

test("TMDB discover filters", () => {
  assert.equal(
    tmdbFilters({ withGenres: [28, 12], voteAverageGte: 7, year: 2020, withWatchProviders: "8", watchRegion: "FR", nested: { a: 1 }, empty: "" }, false),
    "&with_genres=28%2C12&vote_average.gte=7&primary_release_year=2020&with_watch_providers=8&with_watch_monetization_types=flatrate|free|ads|rent|buy&watch_region=FR",
  );
  assert.equal(tmdbFilters({ releaseDateGte: "2020-01-01" }, true), "&first_air_date.gte=2020-01-01");
  assert.equal(tmdbFilters(undefined, false), "");
});

const fakeFetch = (routes: Record<string, unknown>, calls: string[] = []) =>
  (async (url: string) => {
    calls.push(String(url));
    const hit = Object.entries(routes).find(([k]) => String(url).startsWith(k));
    return hit ? new Response(JSON.stringify(hit[1])) : new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

test("an addon page becomes titles of the app's kind; `more` follows skip", async () => {
  const r = resolveSource(src.movie, "movie", active, {})!;
  const page = await loadSourcePage(
    r,
    1,
    0,
    {},
    fakeFetch({ "https://movies.example/cfg/catalog/movie/popular.json": { metas: [{ id: "tt1", name: "One" }, { id: "x2", name: "Unknown id" }] } }),
  );
  assert.deepEqual(page.items.map((t) => [t.id, t.catalogType]), [["tt1", "movie"]]);
  assert.equal(page.more, true);
  const done = await loadSourcePage(r, 2, 1, {}, fakeFetch({ "https://movies.example": { metas: [] } }));
  assert.deepEqual(done, { items: [], more: false });
});

test("a TMDB page shows at once; titles are matched to IMDb ids when opened, and remembered", async () => {
  const keys = { tmdb: "k" };
  const r = resolveSource({ provider: "tmdb", tmdbSourceType: "DISCOVER", tmdbId: 0, mediaType: "MOVIE" }, "movie", active, keys)!;
  const calls: string[] = [];
  const routes = {
    "https://api.themoviedb.org/3/discover/movie": {
      page: 1,
      total_pages: 2,
      results: [
        { id: 1, title: "First", release_date: "1999-03-31", vote_average: 8.24, poster_path: "/p.jpg" },
        { id: 2, title: "No IMDb" },
      ],
    },
    "https://api.themoviedb.org/3/movie/1/external_ids": { imdb_id: "tt0133093" },
    "https://api.themoviedb.org/3/movie/2/external_ids": { imdb_id: null },
  };
  const page = await loadSourcePage(r, 1, 0, keys, fakeFetch(routes, calls));
  assert.deepEqual(calls.map((u) => u.split("?")[0]), ["https://api.themoviedb.org/3/discover/movie"], "one request for the page");
  assert.deepEqual(page.items, [
    { id: "tmdb:movie:1", name: "First", year: "1999", rating: "8.2", poster: "https://image.tmdb.org/t/p/w342/p.jpg", catalogType: "movie" },
    { id: "tmdb:movie:2", name: "No IMDb", year: "", rating: "", catalogType: "movie" },
  ]);
  assert.equal(page.more, true);

  const opened = await withImdbId(page.items[0], keys, fakeFetch(routes, calls));
  assert.equal(opened?.id, "tt0133093");
  assert.equal(opened?.name, "First");
  assert.equal(await withImdbId(page.items[1], keys, fakeFetch(routes)), null, "no IMDb id: nothing to open");
  const imdb = { id: "tt1", name: "x", year: "", rating: "" };
  assert.equal(await withImdbId(imdb, keys, fakeFetch({})), imdb, "an IMDb title is left as it is");

  calls.length = 0;
  const again = await loadSourcePage(r, 1, 0, keys, fakeFetch(routes, calls));
  assert.equal(again.items[0].id, "tt0133093", "a title matched before comes back with its IMDb id");
  assert.equal(calls.length, 1);
});

test("interleave takes from each source in turn, every title once", () => {
  const t = (id: string) => ({ id, name: id, year: "", rating: "" });
  assert.deepEqual(
    interleave([[t("a"), t("b"), t("c")], [t("x"), t("a")], []]).map((x) => x.id),
    ["a", "x", "b", "c"],
  );
});

test("the cache belongs to one account and profile; a failed pull keeps it", async () => {
  let owner: string | null = "u:3";
  let reply: NuvioCollection[] | null = sample();
  setCollectionsRemote({ owner: () => owner, pull: async () => reply });
  assert.equal((await syncNuvioCollections()).length, 2);
  reply = null;
  assert.equal((await syncNuvioCollections()).length, 2);
  owner = "u:1";
  assert.deepEqual(loadNuvioCollections(), [], "another profile's copy is not shown");
  reply = [];
  assert.deepEqual(await syncNuvioCollections(), [], "an empty list empties the row");
  owner = "u:3";
  assert.deepEqual(loadNuvioCollections(), []);
  clearLocalNuvioCollections();
  setCollectionsRemote(null);
});
