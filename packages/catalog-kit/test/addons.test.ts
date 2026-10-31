import { test } from "node:test";
import assert from "node:assert/strict";
import type { KV } from "@secretary/plugins";
import {
  ADDON_REFRESH_MS,
  addonManifestUrl,
  addonRowDefs,
  catalogPath,
  catalogTakes,
  createAddonClient,
  createAddonStore,
  nextPage,
  ownsId,
  parseAddonManifest,
  resourceUrl,
  supportsResource,
} from "../src/lib/addons.ts";
import { addonRows } from "../src/ui/sources.ts";

// Made-up addons: only the shapes the Stremio protocol uses, no real service.
const STREAMS = "https://streams.example/cfg=abc/manifest.json?token=1";
const ANIME = "https://anime.example/manifest.json";
const SUBS = "https://subs.example/manifest.json";
const streamsManifest = {
  id: "example.streams",
  name: "Example Streams",
  version: "1.0.0",
  resources: ["stream", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};
const animeManifest = {
  id: "example.anime",
  name: "Example Anime",
  resources: [
    "catalog",
    { name: "meta", types: ["anime", "series"], idPrefixes: ["kitsu:"] },
    { name: "stream", types: ["series"], idPrefixes: ["kitsu:"] },
  ],
  types: ["anime"],
  catalogs: [
    { type: "anime", id: "trending", name: "Trending", extra: [{ name: "skip" }] },
    { type: "anime", id: "search", name: "Search", extra: [{ name: "search", isRequired: true }] },
    { type: "anime", id: "old", extraSupported: ["genre", "skip"] },
    { id: "broken" },
  ],
};
const subsManifest = { id: "example.subs", name: "Example Subs", resources: ["subtitles"], types: ["movie", "series"], catalogs: [] };

const memoryKv = (): KV & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>();
  return { map, get: (k) => (map.has(k) ? (structuredClone(map.get(k)) as never) : null), set: (k, v) => void map.set(k, structuredClone(v)) };
};

function fakeFetch(routes: Record<string, () => Response>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = routes[url];
    return hit ? hit() : new Response("not found", { status: 404 });
  }) as typeof fetch;
}
const json = (v: unknown) => () => new Response(JSON.stringify(v));

test("URLs: manifest URL from what the user types, the base keeps the query after the resource path", () => {
  assert.equal(addonManifestUrl(" https://a.example/x/ "), "https://a.example/x/manifest.json");
  assert.equal(addonManifestUrl("stremio://a.example/x/manifest.json"), "https://a.example/x/manifest.json");
  assert.equal(addonManifestUrl("https://a.example/x?key=1"), "https://a.example/x/manifest.json?key=1");
  assert.equal(resourceUrl(STREAMS, "stream/series/tt1%3A1%3A2.json"), "https://streams.example/cfg=abc/stream/series/tt1%3A1%3A2.json?token=1");
  assert.equal(resourceUrl(ANIME, "meta/anime/kitsu%3A1.json"), "https://anime.example/meta/anime/kitsu%3A1.json");
});

test("manifest: object resources, old extraSupported catalogs, bad catalogs skipped; not an addon throws", () => {
  const m = parseAddonManifest(animeManifest);
  assert.equal(m.name, "Example Anime");
  assert.deepEqual(m.catalogs.map((c) => [c.id, c.name, c.extra.map((e) => e.name)]), [
    ["trending", "Trending", ["skip"]],
    ["search", "Search", ["search"]],
    ["old", "old", ["genre", "skip"]],
  ]);
  assert.throws(() => parseAddonManifest({ name: "x" }), /not a Stremio addon/);
  assert.throws(() => parseAddonManifest({ scrapers: [] }), /not a Stremio addon/);
});

test("support: resource, types and idPrefixes, the per-resource form winning over the manifest's", () => {
  const s = parseAddonManifest(streamsManifest);
  const a = parseAddonManifest(animeManifest);
  assert.ok(supportsResource(s, "stream", "series", "tt1:1:2"));
  assert.ok(!supportsResource(s, "stream", "series", "kitsu:1:2"));
  assert.ok(!supportsResource(s, "stream", "anime", "tt1"));
  assert.ok(!supportsResource(s, "subtitles", "movie", "tt1"));
  // The anime addon's manifest types say "anime" only, but its stream resource names "series".
  assert.ok(supportsResource(a, "stream", "series", "kitsu:7442:3"));
  assert.ok(!supportsResource(a, "stream", "anime", "kitsu:7442:3"));
  assert.ok(!supportsResource(a, "stream", "series", "tt1"));
  assert.ok(supportsResource(a, "meta", "anime", "kitsu:1"));
  // No idPrefixes anywhere: any id.
  assert.ok(supportsResource(parseAddonManifest(subsManifest), "subtitles", "movie", "anything"));
  assert.ok(ownsId(a, "meta", "kitsu:1") && ownsId(s, "meta", "tt1"));
  assert.ok(!ownsId(parseAddonManifest(subsManifest), "subtitles", "tt1"));
});

test("catalog paths: extras in order and encoded; a required extra must be given, an unknown one is refused", () => {
  assert.equal(catalogPath("movie", "top"), "catalog/movie/top.json");
  assert.equal(catalogPath("movie", "top", { skip: 100 }), "catalog/movie/top/skip=100.json");
  assert.equal(catalogPath("movie", "top", { search: "dune part two" }), "catalog/movie/top/search=dune%20part%20two.json");
  assert.equal(catalogPath("series", "g", { genre: "Sci-Fi & Fantasy", skip: 20 }), "catalog/series/g/genre=Sci-Fi%20%26%20Fantasy&skip=20.json");
  const [trending, search, old] = parseAddonManifest(animeManifest).catalogs;
  assert.ok(catalogTakes(trending, {}) && catalogTakes(trending, { skip: 100 }));
  assert.ok(!catalogTakes(trending, { search: "x" }));
  assert.ok(!catalogTakes(search, {}) && catalogTakes(search, { search: "x" }));
  assert.ok(catalogTakes(old, { genre: "Action", skip: 50 }));
});

test("store: install, refuse twice, toggle, reorder, remove; the list survives a reload", async () => {
  const kv = memoryKv();
  const f = fakeFetch({ [STREAMS]: json(streamsManifest), [ANIME]: json(animeManifest), [SUBS]: json(subsManifest) });
  const store = createAddonStore({ kv, fetch: f });
  let changes = 0;
  store.subscribe(() => changes++);
  await store.install("https://streams.example/cfg=abc/manifest.json?token=1");
  await store.install("https://anime.example");
  await store.install(SUBS);
  await assert.rejects(store.install(`${ANIME}`), /Already installed/);
  await assert.rejects(store.install("ftp://x"), /must start with http/);
  await assert.rejects(store.install("https://nothing.example"), /HTTP 404/);
  assert.equal(store.list().length, 3);
  store.move(SUBS, -1);
  store.move(STREAMS, -1); // already first: nothing
  assert.deepEqual(store.list().map((a) => [a.name, a.sort_order]), [["Example Streams", 0], ["Example Subs", 1], ["Example Anime", 2]]);
  store.toggle(ANIME);
  assert.deepEqual(store.active().map((a) => a.name), ["Example Streams", "Example Subs"]);
  store.remove(SUBS);
  assert.ok(changes > 0);
  const again = createAddonStore({ kv, fetch: f });
  assert.deepEqual(again.list().map((a) => [a.name, a.enabled, a.sort_order]), [["Example Streams", true, 0], ["Example Anime", false, 1]]);
  assert.equal(again.list()[0].manifest?.id, "example.streams");
});

test("store: refresh after six hours, keeping the old manifest when the read fails", async () => {
  const kv = memoryKv();
  let t = 1_000;
  let up = true;
  const calls: string[] = [];
  const f = fakeFetch({ [ANIME]: () => (up ? json(animeManifest)() : new Response("down", { status: 503 })) }, calls);
  const store = createAddonStore({ kv, fetch: f, now: () => t });
  await store.install(ANIME);
  await store.refresh();
  assert.equal(calls.length, 1, "fresh: not read again");
  t += ADDON_REFRESH_MS + 1;
  up = false;
  await store.refresh();
  assert.equal(calls.length, 2);
  const [a] = store.list();
  assert.equal(a.error, "HTTP 503");
  assert.equal(a.manifest?.id, "example.anime");
  assert.equal(store.active().length, 1, "a stale copy still serves");
  up = true;
  await store.refresh(true);
  assert.equal(store.list()[0].error, undefined);
});

test("sync: the list out as {url,name,enabled,sort_order}; a full replace keeps known manifests and reads new ones", async () => {
  const kv = memoryKv();
  const calls: string[] = [];
  const f = fakeFetch({ [STREAMS]: json(streamsManifest), [ANIME]: json(animeManifest), [SUBS]: json(subsManifest) }, calls);
  const store = createAddonStore({ kv, fetch: f });
  await store.install(STREAMS);
  await store.install(ANIME);
  assert.deepEqual(store.synced(), [
    { url: STREAMS, name: "Example Streams", enabled: true, sort_order: 0 },
    { url: ANIME, name: "Example Anime", enabled: true, sort_order: 1 },
  ]);
  calls.length = 0;
  store.replace([
    { url: SUBS, name: "Subs", enabled: true, sort_order: 4 },
    { url: ANIME, name: "Example Anime", enabled: false, sort_order: 1 },
    { url: "not a url", name: "bad", enabled: true, sort_order: 2 },
    { url: "https://anime.example/", name: "dupe", enabled: true, sort_order: 3 },
  ]);
  // Before the new one is read: the known one keeps its manifest, the new one has its synced name.
  assert.deepEqual(store.synced(), [
    { url: ANIME, name: "Example Anime", enabled: false, sort_order: 0 },
    { url: SUBS, name: "Subs", enabled: true, sort_order: 1 },
  ]);
  assert.equal(store.list()[0].manifest?.id, "example.anime");
  await store.refresh();
  assert.deepEqual(calls, [SUBS]);
  assert.equal(store.list()[1].name, "Example Subs");
});

async function installed(routes: Record<string, () => Response>, calls: string[] = []) {
  const f = fakeFetch({ [STREAMS]: json(streamsManifest), [ANIME]: json(animeManifest), [SUBS]: json(subsManifest), ...routes }, calls);
  const store = createAddonStore({ kv: memoryKv(), fetch: f });
  for (const u of [STREAMS, ANIME, SUBS]) await store.install(u);
  return { store, client: createAddonClient(store, f) };
}

test("streams: one job per addon that takes the id, in install order; proxy headers kept so the host drops them", async () => {
  const calls: string[] = [];
  const { store, client } = await installed(
    {
      "https://streams.example/cfg=abc/stream/series/tt1%3A1%3A2.json?token=1": json({
        streams: [
          { name: "A", url: "https://cdn.example/a.mkv" },
          { name: "B", url: "https://cdn.example/b.m3u8", behaviorHints: { proxyHeaders: { request: { Referer: "x" } } } },
          { name: "C", infoHash: "c".repeat(40), fileIdx: 2 },
        ],
      }),
    },
    calls,
  );
  const jobs = client.streamJobs("series", "tt1:1:2");
  assert.deepEqual(jobs.map((j) => [j.id, j.name]), [["addon:example.streams", "Example Streams"]]);
  const got = (await jobs[0].run(1000)) as { name: string; headers?: unknown }[];
  assert.deepEqual(got.map((s) => [s.name, Boolean(s.headers)]), [["A", false], ["B", true], ["C", false]]);
  assert.deepEqual(client.streamJobs("series", "kitsu:7442:3").map((j) => j.id), ["addon:example.anime"]);
  store.toggle(STREAMS);
  assert.deepEqual(client.streamJobs("series", "tt1:1:2"), []);
});

test("subtitles: every addon that serves them, the same link once, a failing one skipped", async () => {
  const { client } = await installed({
    "https://subs.example/subtitles/movie/tt1.json": json({
      subtitles: [
        { id: "1", url: "https://s.example/en.srt", lang: "eng" },
        { id: "2", url: "https://s.example/en.srt", lang: "eng" },
        { url: "https://s.example/fr.srt", lang: "fre" },
        { lang: "no-url" },
      ],
    }),
  });
  assert.deepEqual(await client.subtitles("movie", "tt1"), [
    { id: "1", url: "https://s.example/en.srt", lang: "eng", addon: "Example Subs" },
    { id: "https://s.example/fr.srt", url: "https://s.example/fr.srt", lang: "fre", addon: "Example Subs" },
  ]);
  assert.deepEqual(await client.subtitles("series", "tt9"), []);
});

test("meta: the addon that owns the id prefix first, then the others taking the type, null when none answers", async () => {
  const calls: string[] = [];
  const { client } = await installed(
    {
      "https://anime.example/meta/anime/kitsu%3A1.json": json({ meta: { id: "kitsu:1", name: "From anime" } }),
      "https://streams.example/cfg=abc/meta/series/tt5.json?token=1": json({ meta: null }),
    },
    calls,
  );
  calls.length = 0;
  assert.deepEqual(await client.meta(["anime", "series"], "kitsu:1"), { id: "kitsu:1", name: "From anime" });
  assert.deepEqual(calls, ["https://anime.example/meta/anime/kitsu%3A1.json"]);
  calls.length = 0;
  assert.equal(await client.meta(["series"], "tt5"), null);
  assert.deepEqual(calls, ["https://streams.example/cfg=abc/meta/series/tt5.json?token=1"]);
  // The streams addon takes only tt ids: it is never asked for another.
  calls.length = 0;
  assert.equal(await client.meta(["movie"], "tmdb:1"), null);
  assert.deepEqual(calls, []);
});

test("catalogs: home rows for the ones needing no search, paging by skip near a row's end", async () => {
  const { client } = await installed({
    "https://anime.example/catalog/anime/trending.json": json({ metas: [{ id: "kitsu:1", name: "One" }] }),
  });
  const list = client.catalogs("anime");
  assert.deepEqual(list.map((x) => x.catalog.id), ["trending", "old"]);
  assert.deepEqual(client.catalogs("anime", { search: "x" }).map((x) => x.catalog.id), ["search"]);
  assert.deepEqual(client.catalogs("movie"), []);
  assert.deepEqual(await client.catalog(list[0].addon, list[0].catalog), [{ id: "kitsu:1", name: "One" }]);
  const defs = addonRowDefs(list, client.catalogUrl);
  assert.deepEqual(defs.map((d) => [d.id, d.title, d.url, d.origin]), [
    ["addon:example.anime:anime:trending", "Trending", "https://anime.example/catalog/anime/trending.json", "Example Anime"],
    ["addon:example.anime:anime:old", "old", "https://anime.example/catalog/anime/old.json", "Example Anime"],
  ]);
  assert.equal(nextPage(defs[0], 100, 10), null, "far from the end");
  assert.equal(nextPage(defs[0], 100, 95), "https://anime.example/catalog/anime/trending/skip=100.json");
  assert.equal(nextPage({ url: "x" } as never, 100, 99), null, "a catalog without skip never pages");
});

test("Settings › Addons rows: each addon with its order and Remove (confirm on the second OK), then install and read", async () => {
  const { store } = await installed({});
  const rows = addonRows(store.list(), ANIME);
  assert.deepEqual(rows.map((r) => r.action.kind), ["addon", "addonRemove", "addon", "addonRemove", "addon", "addonRemove", "addonAdd", "addonRefresh"]);
  assert.match(rows[0].sub, /#1 in order.*streams, details · movie, series/);
  assert.equal(rows[3].meta, "Confirm");
  assert.equal(rows[1].meta, "OK");
});
