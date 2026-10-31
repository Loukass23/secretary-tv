import { test } from "node:test";
import assert from "node:assert/strict";
import type { Debrid } from "@secretary/core";
import {
  createIdMapper,
  createPluginHost,
  createPluginStore,
  dropPrelude,
  inlineRunner,
  inScope,
  manifestUrl,
  parseManifest,
  readMeta,
  runProvider,
  supports,
  toItem,
  type KV,
} from "../src/index.ts";

// A made-up repository: no real indexer, only the shapes a Nuvio provider returns.
const REPO = "https://plugins.example/repo";
const MANIFEST = {
  name: "Example Providers",
  scrapers: [
    { id: "alpha", name: "Alpha", filename: "providers/alpha.js", supportedTypes: ["movie", "tv"], enabled: true },
    { id: "beta", name: "Beta", filename: "https://cdn.example/beta.js", supportedTypes: ["movie"], enabled: false },
    { id: "", name: "broken", filename: "x.js" },
  ],
};
const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);
const ALPHA = `
var BASE = "https://api.example";
function getStreams(tmdbId, mediaType, season, episode) {
  return fetch(BASE + "/" + mediaType + "/" + tmdbId).then(function (r) { return r.json(); }).then(function (body) {
    if (!body) return [{ name: "\\u200b\\u200bAlpha 1080p", title: "Bad body " + SCRAPER_ID, url: "https://cdn.example/x.mp4" }];
    return [
      { name: "Alpha 2160p", title: "Film.2160p.HEVC\\n12 GB", url: "https://resolve.example/r?hash=${HASH_A}" },
      { name: "Alpha 1080p", title: "Film.1080p", url: "magnet:?xt=urn:btih:${HASH_A}" },
      { name: "Alpha 1080p", title: "Film.1080p.x265", url: "magnet:?xt=urn:btih:${HASH_B}", infoHash: "${HASH_B}" },
      { name: "Alpha 720p", title: "Needs headers", url: "https://host.example/v.m3u8", headers: { Referer: "https://host.example" } },
      { name: "Alpha 1080p AV1", title: "Film.1080p.AV1", url: "https://cdn.example/av1.mkv" },
    ];
  });
}
module.exports = { getStreams: getStreams };`;

const memoryKv = (): KV & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>();
  return { map, get: (k) => (map.has(k) ? (structuredClone(map.get(k)) as never) : null), set: (k, v) => void map.set(k, structuredClone(v)) };
};

function fakeFetch(routes: Record<string, () => Response>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    return hit ? hit[1]() : new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const json = (v: unknown) => () => new Response(JSON.stringify(v));

test("manifest: scrapers resolve against the manifest URL, bad entries are skipped", () => {
  const m = parseManifest(MANIFEST, `${REPO}/manifest.json`);
  assert.equal(m.name, "Example Providers");
  assert.deepEqual(m.scrapers.map((s) => [s.id, s.codeUrl, s.enabled]), [
    ["alpha", "https://plugins.example/repo/providers/alpha.js", true],
    ["beta", "https://cdn.example/beta.js", false],
  ]);
  assert.throws(() => parseManifest({ name: "x" }, REPO), /no scrapers/);
  assert.equal(manifestUrl(`${REPO}/`), `${REPO}/manifest.json`);
  assert.equal(manifestUrl(`${REPO}/manifest.json?v=2`), `${REPO}/manifest.json?v=2`);
  assert.ok(supports(m.scrapers[0], "tv"));
  assert.ok(!supports(m.scrapers[1], "tv"));
});

test("sandbox: CommonJS, Nuvio globals, json() null on a bad body, no modules", async () => {
  const job = { code: ALPHA, scraperId: "alpha", tmdbId: "603", mediaType: "movie" as const, season: null, episode: null, tmdbKey: "" };
  const bad = await runProvider(job, fakeFetch({ "https://api.example": () => new Response("<html>") }));
  assert.equal((bad[0] as { title: string }).title, "Bad body alpha");
  const global = await runProvider(
    { ...job, code: "function getStreams(id){ return Promise.resolve([{ url: 'https://x.example/' + id + TMDB_API_KEY }]); }", tmdbKey: "k" },
    fetch,
  );
  assert.deepEqual(global, [{ url: "https://x.example/603k" }]);
  await assert.rejects(runProvider({ ...job, code: "require('fs')" }, fetch), /module not available: fs/);
});

test("results: zero-width padding dropped, header streams skipped, magnets become torrents", () => {
  assert.deepEqual(toItem({ name: "​‌A 1080p", title: "T", url: { url: "https://x.example/a" } as never }, "P"), {
    stream: { name: "A 1080p", title: "T", url: "https://x.example/a" },
    key: "https://x.example/a",
  });
  assert.equal(toItem({ url: "https://x.example/v", headers: { Referer: "r" } }, "P"), null);
  assert.deepEqual(toItem({ url: `magnet:?xt=urn:btih:${HASH_A.toUpperCase()}`, fileIdx: 2 }, "P"), {
    torrent: { hash: HASH_A, fileIdx: 2, name: "P", title: "" },
    key: HASH_A,
  });
  assert.equal(toItem({ url: "ftp://x" }, "P"), null);
});

test("ids: IMDb to TMDB through /find with a key, Cinemeta without; anime passes through with the absolute episode", async () => {
  const calls: string[] = [];
  const f = fakeFetch(
    {
      "https://api.themoviedb.org/3/find/tt0133093": json({ movie_results: [{ id: 603 }] }),
      "https://v3-cinemeta.strem.io/meta/series/tt0944947.json": json({ meta: { moviedb_id: 1399 } }),
      "https://arm.haglund.dev/api/v2/ids?source=kitsu&id=7442": json({ themoviedb: 1429 }),
    },
    calls,
  );
  const withKey = createIdMapper({ fetch: f, tmdbKey: "k" });
  assert.deepEqual(await withKey("tt0133093", "movie"), { tmdbId: "603", mediaType: "movie", season: null, episode: null });
  await withKey("tt0133093", "movie");
  assert.equal(calls.length, 1, "cached");
  const keyless = createIdMapper({ fetch: f });
  assert.deepEqual(await keyless("tt0944947:1:2", "series"), { tmdbId: "1399", mediaType: "tv", season: 1, episode: 2 });
  assert.deepEqual(await keyless("kitsu:7442:3", "series", { absolute: 28 }), { tmdbId: "kitsu:7442", mediaType: "tv", season: null, episode: 28 });
  assert.deepEqual(await keyless("kitsu:7442:3", "series", { season: 2, episode: 3, absolute: 28 }), { tmdbId: "1429", mediaType: "tv", season: 2, episode: 3 });
  assert.deepEqual(await keyless("tmdb:1399:2:5", "series"), { tmdbId: "1399", mediaType: "tv", season: 2, episode: 5 });
  assert.equal(await keyless("tt0000001", "movie"), null);
});

test("store: defaults, toggles, refresh keeps the old manifest, code cached six hours", async () => {
  let up = true;
  let t = 0;
  const kv = memoryKv();
  const calls: string[] = [];
  const f = fakeFetch(
    {
      [`${REPO}/manifest.json`]: () => (up ? new Response(JSON.stringify(MANIFEST)) : new Response("", { status: 500 })),
      [`${REPO}/providers/alpha.js`]: () => (up ? new Response(ALPHA) : new Response("", { status: 500 })),
    },
    calls,
  );
  const store = createPluginStore({ kv, fetch: f, now: () => t, defaults: [REPO] });
  await store.refresh();
  const repo = store.get().repos[0];
  assert.equal(repo.manifest?.scrapers.length, 2);
  assert.ok(store.isScraperOn(repo, "alpha") && !store.isScraperOn(repo, "beta"));
  store.toggleScraper(repo.url, "beta");
  assert.ok(store.isScraperOn(store.get().repos[0], "beta"));
  await assert.rejects(store.add(REPO), /Already added/);
  await assert.rejects(store.add("plugins.example"), /must start with http/);

  const code = await store.code(`${REPO}/providers/alpha.js`);
  up = false;
  t += 7 * 3600_000;
  assert.equal(await store.code(`${REPO}/providers/alpha.js`), code, "stale copy when the refresh fails");
  await store.refresh();
  assert.equal(store.get().repos[0].manifest?.name, "Example Providers");
  assert.match(store.get().repos[0].error ?? "", /500/);

  // A new store on the same storage sees the user's toggles, not the defaults again.
  const again = createPluginStore({ kv, fetch: f, now: () => t, defaults: ["https://other.example"] });
  assert.equal(again.get().repos.length, 1);
  assert.ok(again.isScraperOn(again.get().repos[0], "beta"));
});

test("host: providers in parallel, torrents through debrid in the user's order, uncached dropped, AV1 last", async () => {
  const kv = memoryKv();
  const f = fakeFetch({
    [`${REPO}/manifest.json`]: json(MANIFEST),
    [`${REPO}/providers/alpha.js`]: () => new Response(ALPHA),
    "https://api.example/movie/603": json({ ok: true }),
  });
  const store = createPluginStore({ kv, fetch: f, defaults: [REPO] });
  await store.refresh();
  const checked: string[] = [];
  const service = (id: "tb" | "pm", cached: string[]): Debrid => ({
    id,
    label: id,
    async checkCached(h) {
      checked.push(`${id}:${h.length}`);
      return new Set(h.filter((x) => cached.includes(x)));
    },
    resolve: async () => null,
  });
  const statuses: string[] = [];
  const host = createPluginHost({
    store,
    runner: inlineRunner(f),
    target: async () => ({ tmdbId: "603", mediaType: "movie", season: null, episode: null }),
    debrid: () => [service("pm", []), service("tb", [HASH_B])],
  });
  const { streams, status } = await host.find("tt0133093", "movie", undefined, { onStatus: (s) => statuses.push(s[0].state) });
  assert.deepEqual(statuses, ["searching", "ok"]);
  assert.equal(status[0].count, 4);
  assert.deepEqual(streams.map((s) => s.url), [
    `https://resolve.example/r?hash=${HASH_A}`,
    `debrid:tb:${HASH_B}`,
    "https://cdn.example/av1.mkv",
  ]);
  assert.equal(streams[1].name, "⚡ [TB] Alpha 1080p");
  // Hash A came as a redirector first, so only B was asked about, PM first, then TB for what PM lacked.
  assert.deepEqual(checked, ["pm:1", "tb:1"]);
});

test("host: a provider that never answers is cut at its deadline; the others still count", async () => {
  const kv = memoryKv();
  const manifest = { scrapers: [
    { id: "slow", filename: "slow.js" },
    { id: "fast", filename: "fast.js" },
  ] };
  const f = fakeFetch({
    [`${REPO}/manifest.json`]: json(manifest),
    [`${REPO}/slow.js`]: () => new Response("module.exports={getStreams:function(){return new Promise(function(){})}}"),
    [`${REPO}/fast.js`]: () => new Response("module.exports={getStreams:function(){return Promise.resolve([{url:'https://x.example/f'}])}}"),
  });
  const store = createPluginStore({ kv, fetch: f, defaults: [REPO] });
  await store.refresh();
  const host = createPluginHost({
    store,
    runner: inlineRunner(f),
    target: async () => ({ tmdbId: "1", mediaType: "movie", season: null, episode: null }),
    debrid: () => [],
    perProviderMs: 50,
  });
  const { streams, status } = await host.find("tmdb:1", "movie");
  assert.deepEqual(streams.map((s) => s.url), ["https://x.example/f"]);
  assert.deepEqual(status.map((s) => [s.id, s.state, s.error]), [["slow", "error", "timed out"], ["fast", "ok", undefined]]);
});

test("host: snapshots in provider order as providers answer, torrents once their shared check is back", async () => {
  const kv = memoryKv();
  const later = (ms: number, result: string) =>
    `module.exports={getStreams:function(){return new Promise(function(r){setTimeout(function(){r(${result})},${ms})})}}`;
  const manifest = { scrapers: [
    { id: "a", filename: "a.js" },
    { id: "b", filename: "b.js" },
    { id: "c", filename: "c.js" },
  ] };
  const f = fakeFetch({
    [`${REPO}/manifest.json`]: json(manifest),
    [`${REPO}/a.js`]: () => new Response(later(0, "[{name:'A',url:'https://x.example/a'}]")),
    [`${REPO}/b.js`]: () => new Response(later(40, `[{name:'B',infoHash:'${HASH_B}'}]`)),
    [`${REPO}/c.js`]: () => new Response(later(80, "[{name:'C',url:'https://x.example/c'}]")),
  });
  const store = createPluginStore({ kv, fetch: f, defaults: [REPO] });
  await store.refresh();
  let checks = 0;
  const host = createPluginHost({
    store,
    runner: inlineRunner(f),
    target: async () => ({ tmdbId: "1", mediaType: "movie", season: null, episode: null }),
    debrid: () => [{ id: "tb", label: "tb", checkCached: async (h) => (checks++, new Set(h)), resolve: async () => null }],
  });
  const seen: string[] = [];
  const final = await host.find("tmdb:1", "movie", undefined, {
    onUpdate: (s) => seen.push(`${s.done ? "done " : ""}${s.streams.map((x) => x.name.replace("⚡ [TB] ", "tb:")).join(",")}`),
  });
  // C answers before B's debrid check is back: B shows up in its provider's place once it is.
  assert.deepEqual(seen, ["A", "A,C", "A,tb:B,C", "done A,tb:B,C"]);
  assert.equal(checks, 1);
  assert.deepEqual(final.streams.map((s) => s.name), ["A", "⚡ [TB] B", "C"]);
});

test("the slow test repository is a valid repository whose providers answer as labelled", async () => {
  const { readFileSync } = await import("node:fs");
  const dir = new URL("./fixtures/slow-repo/", import.meta.url);
  const m = parseManifest(JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")), "http://pc.example/manifest.json");
  assert.deepEqual(m.scrapers.map((s) => s.id), ["quick", "steady", "late", "notice"]);
  const code = readFileSync(new URL("providers/quick.js", dir), "utf8");
  const t0 = Date.now();
  const out = await runProvider({ code, scraperId: "quick", tmdbId: "603", mediaType: "movie", season: null, episode: null, tmdbKey: "" }, fetch);
  assert.ok(Date.now() - t0 >= 250);
  assert.equal((out[0] as { url: string }).url, "https://192.0.2.10/fixture/quick/603.mkv");
});

test("store: provider order is the listing until the user moves one, and survives a reload", async () => {
  const kv = memoryKv();
  const f = fakeFetch({ [`${REPO}/manifest.json`]: json(MANIFEST) });
  const store = createPluginStore({ kv, fetch: f, defaults: [REPO] });
  await store.refresh();
  assert.deepEqual(store.providerOrder(), ["alpha", "beta"]);
  store.moveProvider("beta", -1);
  assert.deepEqual(store.providerOrder(), ["beta", "alpha"]);
  store.moveProvider("beta", -1);
  assert.deepEqual(store.providerOrder(), ["beta", "alpha"], "already first");
  assert.deepEqual(createPluginStore({ kv, fetch: f }).providerOrder(), ["beta", "alpha"]);
});

test("notices: a provider's message is flagged, a release named like one is not", async () => {
  const { isNotice } = await import("../src/host.ts");
  assert.ok(isNotice("Configure this addon", "Open settings to add your key"));
  assert.ok(isNotice("⚠ Debrid key expired", ""));
  assert.ok(isNotice("Support the project", "Donate to keep it running"));
  assert.ok(isNotice("Nothing", "No results for this title"));
  assert.ok(!isNotice("Error.2023.1080p.WEB-DL", "Error 2023"));
  assert.ok(!isNotice("Fast 2160p", "📦 14 GB"));
  assert.ok(!isNotice("Some provider", "Film.Title.mkv"));
  assert.deepEqual(toItem({ name: "Configure this addon", url: "https://x.example/configure" }, "P"), {
    stream: { name: "Configure this addon", title: "", url: "https://x.example/configure", notice: true },
    key: "https://x.example/configure",
  });
});

test("results keep the binge group and file name, for links and for torrents through debrid", async () => {
  assert.deepEqual(
    toItem({ name: "A 1080p", url: "https://x.example/a", behaviorHints: { bingeGroup: "grp|1080p", filename: "Show.S01E02.mkv" } }, "P"),
    { stream: { name: "A 1080p", title: "", url: "https://x.example/a", group: "grp|1080p", file: "Show.S01E02.mkv" }, key: "https://x.example/a" },
  );
  assert.deepEqual(toItem({ name: "B", infoHash: HASH_B, filename: "B.mkv" }, "P"), {
    torrent: { hash: HASH_B, fileIdx: undefined, name: "B", title: "", file: "B.mkv" },
    key: HASH_B,
  });
  const kv = memoryKv();
  const f = fakeFetch({
    [`${REPO}/manifest.json`]: json({ scrapers: [{ id: "g", filename: "g.js" }] }),
    [`${REPO}/g.js`]: () =>
      new Response(`module.exports={getStreams:function(){return Promise.resolve([{name:'T 2160p',infoHash:'${HASH_A}',behaviorHints:{bingeGroup:'g|4k'}}])}}`),
  });
  const store = createPluginStore({ kv, fetch: f, defaults: [REPO] });
  await store.refresh();
  const host = createPluginHost({
    store,
    runner: inlineRunner(f),
    target: async () => ({ tmdbId: "1", mediaType: "tv", season: 1, episode: 2 }),
    debrid: () => [{ id: "pm", label: "pm", checkCached: async (h) => new Set(h), resolve: async () => null }],
  });
  const { streams } = await host.find("tmdb:1:1:2", "series");
  assert.equal(streams[0].group, "g|4k");
  assert.equal(streams[0].provider, "g");
});

test("host: extra sources (addons) after the providers, through the same debrid check and AV1-last; asked with no target too", async () => {
  const kv = memoryKv();
  const f = fakeFetch({
    [`${REPO}/manifest.json`]: json({ scrapers: [{ id: "a", filename: "a.js" }] }),
    [`${REPO}/a.js`]: () => new Response("module.exports={getStreams:function(){return Promise.resolve([{name:'A',url:'https://x.example/a'}])}}"),
  });
  const store = createPluginStore({ kv, fetch: f, defaults: [REPO] });
  await store.refresh();
  const asked: string[] = [];
  const extra = (id: string) => [
    {
      id: "addon:one",
      name: "One",
      repo: "https://one.example/manifest.json",
      run: async () => (asked.push(id), [{ name: "One AV1", title: "Film.1080p.AV1", url: "https://x.example/av1" }, { name: "One", infoHash: HASH_A }, { name: "One", infoHash: HASH_B }]),
    },
    { id: "addon:two", name: "Two", repo: "https://two.example/manifest.json", run: async () => Promise.reject(new Error("HTTP 500")) },
  ];
  let target: { tmdbId: string; mediaType: "movie"; season: null; episode: null } | null = { tmdbId: "1", mediaType: "movie", season: null, episode: null };
  const host = createPluginHost({
    store,
    runner: inlineRunner(f),
    target: async () => target,
    debrid: () => [{ id: "tb", label: "tb", checkCached: async () => new Set([HASH_B]), resolve: async () => null }],
    extra,
  });
  const { streams, status } = await host.find("tt1:1:2", "series");
  assert.deepEqual(streams.map((s) => [s.url, s.provider]), [
    ["https://x.example/a", "a"],
    [`debrid:tb:${HASH_B}`, "addon:one"],
    ["https://x.example/av1", "addon:one"],
  ]);
  assert.deepEqual(status.map((s) => [s.id, s.state]), [["a", "ok"], ["addon:one", "ok"], ["addon:two", "error"]]);
  // No TMDB target, plugins off: the addons still answer, with the title's own id.
  target = null;
  store.setEnabled(false);
  const alone = await host.find("tt1:1:2", "series");
  assert.deepEqual(alone.streams.map((s) => s.provider), ["addon:one", "addon:one"]);
  assert.deepEqual(asked, ["tt1:1:2", "tt1:1:2"]);
});

test("store: synced() carries the repositories in order; replace() keeps known ones' toggles and reads new ones", async () => {
  const kv = memoryKv();
  const store = createPluginStore({ kv, fetch: fakeFetch({ [REPO]: json(MANIFEST), "https://other.example/": json(MANIFEST) }) });
  await store.add(REPO);
  store.toggleScraper(`${REPO}/manifest.json`, "alpha");
  assert.deepEqual(store.synced(), [{ url: `${REPO}/manifest.json`, name: "Example Providers", enabled: true, sort_order: 0 }]);
  store.replace([
    { url: "https://other.example/", enabled: false, sort_order: 0 },
    { url: `${REPO}/manifest.json`, enabled: true, sort_order: 1 },
    { url: "ftp://nope", enabled: true, sort_order: 2 },
  ]);
  assert.deepEqual(store.get().repos.map((r) => [r.url, r.enabled]), [
    ["https://other.example/manifest.json", false],
    [`${REPO}/manifest.json`, true],
  ]);
  assert.equal(store.get().repos[1].scrapers.alpha, false, "the scraper toggle stays");
});

test("manifest: categories scope a scraper to apps; a scraper without them runs in every app", () => {
  const m = parseManifest(
    {
      scrapers: [
        { id: "animeprov", filename: "animeprov.js", categories: ["Anime"] },
        { id: "deep", filename: "deep.js", categories: ["general"] },
        { id: "fast", filename: "fast.js", categories: ["general", "anime", 3] },
        { id: "plain", filename: "plain.js" },
      ],
    },
    `${REPO}/manifest.json`,
  );
  assert.deepEqual(m.scrapers.map((s) => s.categories), [["anime"], ["general"], ["general", "anime"], []]);
  const ids = (scope: "anime" | "general" | undefined) => m.scrapers.filter((s) => inScope(s, scope)).map((s) => s.id);
  assert.deepEqual(ids("anime"), ["animeprov", "fast", "plain"]);
  assert.deepEqual(ids("general"), ["deep", "fast", "plain"]);
  assert.deepEqual(ids(undefined), ["animeprov", "deep", "fast", "plain"]);
  // A manifest saved by an older build has no categories at all.
  assert.ok(inScope({ categories: undefined as never }, "anime"));
});

test("sandbox: the host's context is passed as globals; one it leaves out stays undeclared", async () => {
  const job = { scraperId: "ctx", tmdbId: "1", mediaType: "movie" as const, season: null, episode: null, tmdbKey: "" };
  const code = `
function getStreams() {
  return Promise.resolve([{ url: "https://x.example/",
    profile: typeof DEVICE_PROFILE !== "undefined" ? DEVICE_PROFILE : null,
    caps: typeof DEVICE_CAPS !== "undefined" ? DEVICE_CAPS : null,
    lang: typeof LANG_PREF !== "undefined" ? LANG_PREF : null,
    scope: typeof APP_SCOPE !== "undefined" ? APP_SCOPE : null }]);
}`;
  const context = { deviceProfile: "tv" as const, deviceCaps: "hevc,4k", langPref: "fr,en;subs=fr", appScope: "anime" as const };
  assert.deepEqual(await runProvider({ ...job, code, context }, fetch), [
    { url: "https://x.example/", profile: "tv", caps: "hevc,4k", lang: "fr,en;subs=fr", scope: "anime" },
  ]);
  // No context: exactly what a provider saw before.
  assert.deepEqual(await runProvider({ ...job, code }, fetch), [{ url: "https://x.example/", profile: null, caps: null, lang: null, scope: null }]);
  // The Nuvio worker's prelude guesses the profile and language: what the host sets wins, the rest of it stays.
  const prelude = `var DEBRID_CHECK_URL = "https://w.example/debrid/check";\nvar DEVICE_PROFILE = "mobile";\nvar LANG_PREF = "en";\n`;
  const withDebrid = code.replace('url: "https://x.example/"', "url: DEBRID_CHECK_URL");
  assert.deepEqual(await runProvider({ ...job, code: prelude + withDebrid, context: { langPref: "es" } }, fetch), [
    { url: "https://w.example/debrid/check", profile: "mobile", caps: null, lang: "es", scope: null },
  ]);
  assert.equal(dropPrelude(`${prelude}var x = 1;`, []), `${prelude}var x = 1;`);
  // Only the leading lines are the prelude: the same name further down is the provider's own.
  assert.equal(
    dropPrelude(`var LANG_PREF = "en";\nvar OTHER = 1;\nfoo();\nvar LANG_PREF = "x";`, ["LANG_PREF"]),
    `var OTHER = 1;\nfoo();\nvar LANG_PREF = "x";`,
  );
});

test("results: a provider's _meta (v1) is kept field by field; anything else is ignored", () => {
  const meta = {
    v: 1,
    verified: true,
    match: "exact",
    trusted: true,
    langs: { audio: ["FR", "en", "fr", "not a code"], subs: ["fr"], multi: true },
    resolution: "2160p",
    codec: "HEVC",
    hdr: "HDR10+",
    dv: false,
    audio: "eac3",
    sizeBytes: 12_000_000_000,
    score: 812,
    group: "GRP",
  };
  assert.deepEqual(readMeta(meta), {
    verified: true,
    match: "exact",
    trusted: true,
    langs: { audio: ["fr", "en"], subs: ["fr"], multi: true },
    resolution: "2160p",
    codec: "hevc",
    hdr: "hdr10+",
    dv: false,
    audio: "eac3",
    sizeBytes: 12_000_000_000,
    score: 812,
    group: "GRP",
  });
  assert.deepEqual(readMeta({ v: 1, verified: "yes", match: "maybe", resolution: 1080, sizeBytes: "12 GB", langs: "fr" }), {
    verified: false,
    trusted: false,
    resolution: 1080,
  });
  assert.equal(readMeta({ ...meta, v: 2 }), undefined);
  assert.equal(readMeta("verified"), undefined);
  assert.equal(readMeta(undefined), undefined);
  const link = toItem({ name: "A", title: "Film.2160p", url: "https://x.example/a", _meta: meta }, "P");
  assert.ok(link && "stream" in link && link.stream.meta?.verified);
  const torrent = toItem({ name: "A", infoHash: HASH_A, _meta: { v: 1, verified: false, trusted: true } }, "P");
  assert.deepEqual(torrent && "torrent" in torrent && torrent.torrent.meta, { verified: false, trusted: true });
  // A provider without _meta: the same item as before.
  assert.deepEqual(toItem({ name: "A", title: "T", url: "https://x.example/a" }, "P"), {
    stream: { name: "A", title: "T", url: "https://x.example/a" },
    key: "https://x.example/a",
  });
});

test("host: the app's scope picks scrapers by category, the context reaches them, the caps order the codecs", async () => {
  const kv = memoryKv();
  const said = `(typeof APP_SCOPE !== "undefined" ? APP_SCOPE : "-") + " " + (typeof LANG_PREF !== "undefined" ? LANG_PREF : "-")`;
  const echo = (id: string) => `module.exports = { getStreams: function () { return Promise.resolve([
    { name: "${id} AV1", title: "Film.1080p.AV1 " + ${said}, url: "https://x.example/${id}/av1" },
    { name: "${id}", title: "Film.1080p.x264", url: "https://x.example/${id}/h264", _meta: { v: 1, verified: true, trusted: true } },
  ]); } };`;
  const f = fakeFetch({
    [`${REPO}/manifest.json`]: json({
      scrapers: [
        { id: "animeprov", filename: "animeprov.js", categories: ["anime"] },
        { id: "deep", filename: "deep.js", categories: ["general"] },
        { id: "plain", filename: "plain.js" },
      ],
    }),
    [`${REPO}/animeprov.js`]: () => new Response(echo("animeprov")),
    [`${REPO}/deep.js`]: () => new Response(echo("deep")),
    [`${REPO}/plain.js`]: () => new Response(echo("plain")),
  });
  const store = createPluginStore({ kv, fetch: f, defaults: [REPO] });
  await store.refresh();
  let caps = "hevc,4k";
  const host = createPluginHost({
    store,
    runner: inlineRunner(f),
    target: async () => ({ tmdbId: "1", mediaType: "movie", season: null, episode: null }),
    debrid: () => [],
    context: () => ({ deviceProfile: "tv", deviceCaps: caps, langPref: "ja;subs=en" }),
  });
  const anime = await host.find("tt1", "movie", undefined, { scope: "anime" });
  assert.deepEqual(anime.status.map((s) => s.id), ["animeprov", "plain"]);
  // AV1 after everything else without the cap; its text says what the provider was told.
  assert.deepEqual(anime.streams.map((s) => s.url), [
    "https://x.example/animeprov/h264",
    "https://x.example/plain/h264",
    "https://x.example/animeprov/av1",
    "https://x.example/plain/av1",
  ]);
  assert.equal(anime.streams[2].title, "Film.1080p.AV1 anime ja;subs=en");
  assert.equal(anime.streams[0].meta?.verified, true);
  assert.deepEqual((await host.find("tt1", "movie", undefined, { scope: "general" })).status.map((s) => s.id), ["deep", "plain"]);
  // No scope (a host that does not say): every scraper, as before; a TV that decodes AV1 keeps the providers' order.
  caps = "hevc,av1";
  const all = await host.find("tt1", "movie");
  assert.deepEqual(all.status.map((s) => s.id), ["animeprov", "deep", "plain"]);
  assert.equal(all.streams[0].url, "https://x.example/animeprov/av1");
  assert.equal(all.streams[0].title, "Film.1080p.AV1 - ja;subs=en");
});
