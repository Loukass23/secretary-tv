import { test } from "node:test";
import assert from "node:assert/strict";
import { createSimkl, type KV } from "@secretary/simkl";
import { simklPullSoon, simklTracker } from "../src/lib/simkl.ts";
import { loadWatchedIds, reportPlayback, saveProgress, setResumeTrackers, syncAllResume, watchedEpisodes } from "../src/lib/resume.ts";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

function memKv(): KV {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string) => (m.has(k) ? (m.get(k) as T) : null), set: (k, v) => void m.set(k, v) };
}

function setup(answer: (path: string) => unknown = () => ({})) {
  const sent: { path: string; body?: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    sent.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer(path)), { status: 200 });
  }) as typeof fetch;
  const c = createSimkl({ clientId: "cid", kv: memKv(), fetch: f });
  c.setToken("tok");
  return { c, sent };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const T = (id: string, name: string) => ({ id, name, year: "2020", rating: "8" });
const show = T("tt2", "Show");

test("scrobbles once per state change, and stops the last item when another starts", async () => {
  const { c, sent } = setup();
  const t = simklTracker(c);
  t.progress("series", show, { season: 1, episode: 1 }, 60, 600, "playing");
  t.progress("series", show, { season: 1, episode: 1 }, 120, 600, "playing");
  t.progress("series", show, { season: 1, episode: 1 }, 130, 600, "paused");
  t.progress("series", show, { season: 1, episode: 2 }, 10, 600, "playing");
  await flush();
  assert.deepEqual(
    sent.map((s) => s.path),
    ["/scrobble/start", "/scrobble/pause", "/scrobble/stop", "/scrobble/start"],
  );
  assert.equal(sent[2].body?.progress, 21.67);
  assert.deepEqual(sent[3].body?.episode, { season: 1, number: 2 });
});

test("a pause before anything played sends nothing; signed out sends nothing", async () => {
  const { c, sent } = setup();
  const t = simklTracker(c);
  t.progress("movie", T("tt1", "Film"), undefined, 0, 0, "paused");
  c.setToken(null);
  t.progress("movie", T("tt1", "Film"), undefined, 10, 100, "playing");
  await flush();
  assert.equal(sent.length, 0);
});

test("finished while scrobbling stops at 100 %; otherwise it goes to the history", async () => {
  const { c, sent } = setup();
  setResumeTrackers([simklTracker(c)]);
  reportPlayback("movie", T("tt1", "Film"), undefined, 10, 100, "playing");
  saveProgress("movie", T("tt1", "Film"), undefined, 100, 100);
  await flush();
  assert.deepEqual(sent.map((s) => s.path), ["/scrobble/start", "/scrobble/stop"]);
  assert.equal(sent[1].body?.progress, 100);
  saveProgress("movie", T("tt5", "Other"), undefined, 100, 100);
  await flush();
  assert.equal(sent.at(-1)?.path, "/sync/history");
  setResumeTrackers([]);
});

test("sync pulls the history into this TV's watched lists, at most every 15 minutes", async () => {
  const { c, sent } = setup((path) =>
    path.startsWith("/sync/all-items")
      ? { movies: [{ status: "completed", movie: { ids: { imdb: "tt7" } } }], shows: [{ status: "watching", show: { ids: { imdb: "tt8" } }, seasons: [{ number: 2, episodes: [{ number: 4 }] }] }] }
      : {},
  );
  simklPullSoon();
  setResumeTrackers([simklTracker(c)]);
  await syncAllResume("");
  assert.ok(loadWatchedIds().includes("tt7"));
  assert.ok(watchedEpisodes("tt8").has("2:4"));
  await syncAllResume("");
  assert.equal(sent.filter((s) => s.path.startsWith("/sync/all-items")).length, 1);
  setResumeTrackers([]);
});
