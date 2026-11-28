import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkPin,
  createSimkl,
  fromIds,
  historyBody,
  itemBody,
  type KV,
  scrobble,
  startPin,
  statsFrom,
  toIds,
  waitForPin,
  watchedFrom,
} from "../src/index.ts";

function memKv(): KV {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string) => (m.has(k) ? (m.get(k) as T) : null), set: (k, v) => void m.set(k, v) };
}

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeFetch(answer: (c: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = {
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    const a = answer(c);
    return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

test("ids: IMDb, prefixed numbers, and back with anime preferring Kitsu", () => {
  assert.deepEqual(toIds("tt0111161"), { imdb: "tt0111161" });
  assert.deepEqual(toIds("kitsu:1376"), { kitsu: 1376 });
  assert.deepEqual(toIds("tmdb:550"), { tmdb: 550 });
  assert.equal(toIds("something-else"), null);
  assert.equal(fromIds({ imdb: "tt1", kitsu: 9 }, "anime"), "kitsu:9");
  assert.equal(fromIds({ imdb: "tt1", tmdb: 2 }, "show"), "tt1");
  assert.equal(fromIds({ tmdb: 2 }, "movie"), "tmdb:2");
  assert.equal(fromIds({ simkl: 5 }, "movie"), null);
});

test("bodies: a film, an episode, and history grouped by show and season", () => {
  assert.deepEqual(itemBody({ id: "tt1", kind: "movie", title: "A" }), { movie: { title: "A", ids: { imdb: "tt1" } } });
  assert.deepEqual(itemBody({ id: "tt2", kind: "show", season: 1, episode: 3 }), { show: { title: undefined, ids: { imdb: "tt2" } }, episode: { season: 1, number: 3 } });
  const at = new Date("2026-11-27T20:00:00Z");
  const h = historyBody(
    [
      { id: "tt1", kind: "movie" },
      { id: "tt2", kind: "show", season: 1, episode: 1 },
      { id: "tt2", kind: "show", season: 1, episode: 2 },
      { id: "nope", kind: "movie" },
    ],
    at,
  );
  assert.equal(h.movies.length, 1);
  assert.deepEqual(h.shows, [
    { title: undefined, ids: { imdb: "tt2" }, seasons: [{ number: 1, episodes: [{ number: 1, watched_at: at.toISOString() }, { number: 2, watched_at: at.toISOString() }] }] },
  ]);
});

test("device sign-in: code, pending, then the token is stored and sent", async () => {
  let polls = 0;
  const { f, calls } = fakeFetch((c) => {
    if (c.url.includes("/oauth2/device")) {
      return { body: { device_code: "dev", user_code: "AB-CD", verification_uri: "https://simkl.com/pin", verification_uri_complete: "https://simkl.com/pin?user_code=AB-CD", expires_in: 900, interval: 5 } };
    }
    if (c.url.includes("/oauth2/token")) {
      return ++polls < 2 ? { status: 400, body: { error: "authorization_pending" } } : { body: { access_token: "tok", refresh_token: "ref", expires_in: 3600 } };
    }
    return { body: {} };
  });
  const c = createSimkl({ clientId: "cid", clientSecret: "sec", kv: memKv(), fetch: f, now: () => 1 });
  const code = await startPin(c, 0);
  assert.equal(code.userCode, "AB-CD");
  assert.equal(code.deviceCode, "dev");
  assert.equal(code.urlWithCode, "https://simkl.com/pin?user_code=AB-CD");
  assert.equal(await checkPin(c, code, 1), "wait");
  assert.deepEqual(calls.at(-1)!.body, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: "dev", client_id: "cid", client_secret: "sec" });
  assert.equal(await checkPin(c, { ...code, expires: 0 }, 1), "expired");
  assert.equal(await waitForPin(c, code, { sleep: async () => {}, now: () => 1 }), true);
  assert.ok(c.signedIn());
  await scrobble(c, "start", { id: "tt1", kind: "movie" }, 12.3456);
  const last = calls.at(-1)!;
  assert.ok(last.url.startsWith("https://api.simkl.com/scrobble/start"));
  assert.equal(last.headers.Authorization, "Bearer tok");
  assert.equal(last.headers["simkl-api-key"], "cid");
  assert.deepEqual(last.body, { movie: { ids: { imdb: "tt1" } }, progress: 12.35 });
});

test("an older app falls back to the PIN", async () => {
  const { f } = fakeFetch((c) => {
    if (c.url.includes("/oauth2/device")) return { status: 400, body: { error: "unauthorized_client" } };
    if (c.url.includes("/oauth/pin/ABCD")) return { body: { result: "OK", access_token: "old" } };
    if (c.url.includes("/oauth/pin")) return { body: { user_code: "ABCD", verification_url: "https://simkl.com/pin", expires_in: 900, interval: 5 } };
    return { body: {} };
  });
  const c = createSimkl({ clientId: "cid", kv: memKv(), fetch: f });
  const code = await startPin(c, 0);
  assert.equal(code.deviceCode, undefined);
  assert.equal(await checkPin(c, code, 1), "done");
  assert.ok(c.signedIn());
});

test("slow_down waits longer, a refused code stops", async () => {
  const answers = [{ error: "slow_down" }, { error: "access_denied" }];
  const { f } = fakeFetch(() => ({ status: 400, body: answers.shift() }));
  const c = createSimkl({ clientId: "cid", kv: memKv(), fetch: f });
  const waits: number[] = [];
  const code = { userCode: "X", url: "u", urlWithCode: "u", expires: 10, interval: 5, deviceCode: "d" };
  assert.equal(await waitForPin(c, code, { sleep: async (ms) => void waits.push(ms), now: () => 1 }), false);
  assert.deepEqual(waits, [5000, 10000]);
});

test("a token about to run out is refreshed once before the call", async () => {
  let t = 1_000_000;
  const kv = memKv();
  const { f, calls } = fakeFetch((c) => (c.url.includes("/oauth2/token") ? { body: { access_token: "new", refresh_token: "ref2", expires_in: 3600 } } : { body: {} }));
  const c = createSimkl({ clientId: "cid", clientSecret: "sec", kv, fetch: f, now: () => t });
  c.setToken({ access: "old", refresh: "ref", exp: t + 30_000 });
  await Promise.all([scrobble(c, "start", { id: "tt1", kind: "movie" }, 1), scrobble(c, "pause", { id: "tt1", kind: "movie" }, 2)]);
  assert.equal(calls.filter((x) => x.url.includes("/oauth2/token")).length, 1);
  assert.equal((calls.find((x) => x.url.includes("/oauth2/token"))!.body as { grant_type: string }).grant_type, "refresh_token");
  assert.ok(calls.filter((x) => x.url.includes("/scrobble/")).every((x) => x.headers.Authorization === "Bearer new"));
});

test("a 401 forgets the token", async () => {
  const kv = memKv();
  const { f } = fakeFetch(() => ({ status: 401 }));
  const c = createSimkl({ clientId: "cid", kv, fetch: f });
  c.setToken("old");
  await assert.rejects(() => scrobble(c, "stop", { id: "tt1", kind: "movie" }, 90));
  assert.equal(c.signedIn(), false);
});

test("watched history: completed titles and episode keys", () => {
  const w = watchedFrom({
    movies: [
      { status: "completed", movie: { ids: { imdb: "tt1" } } },
      { status: "plantowatch", movie: { ids: { imdb: "tt9" } } },
    ],
    shows: [{ status: "watching", show: { ids: { imdb: "tt2" } }, seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }] }] }],
    anime: [{ status: "completed", show: { ids: { kitsu: 7, imdb: "tt3" } }, seasons: [{ number: 1, episodes: [{ number: 5 }] }] }],
  });
  assert.deepEqual(w.titles.sort(), ["kitsu:7", "tt1"]);
  assert.deepEqual(w.episodes, { tt2: ["1:1", "1:2"], "kitsu:7": ["1:5"] });
});

test("stats: summed over kinds, zeros for what is missing", () => {
  const s = statsFrom(
    {
      total_mins: 6000,
      movies: { completed: { count: 40 } },
      tv: { completed: { count: 3 }, watching: { count: 2, watched_episodes_count: 120 } },
      anime: { watching: { watched_episodes_count: 30 } },
    },
    { name: "Viewer" },
  );
  assert.deepEqual(s, { name: "Viewer", avatar: undefined, minutes: 6000, movies: 40, episodes: 150, shows: 5 });
  assert.deepEqual(statsFrom({}), { name: undefined, avatar: undefined, minutes: 0, movies: 0, episodes: 0, shows: 0 });
});
