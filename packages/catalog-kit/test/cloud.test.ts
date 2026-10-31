import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeLaunch, decodeLaunch, kindOf, progressKey, toItems, toRow, watchedTitleIds, withMeta } from "@secretary/nuvio";
import { cloud, takeLaunch } from "../src/lib/cloud.ts";
import {
  clearLocalResume,
  loadResume,
  loadWatchedIds,
  markTitleWatched,
  mergeWithCloud,
  type ResumeEntry,
  type ResumeRemote,
  saveProgress,
  setResumeRemote,
  syncAllResume,
  type UnifiedResumeEntry,
} from "../src/lib/resume.ts";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};

const title = (id: string, name = id) => ({ id, name, year: "2020", rating: "8" });
const entry = (id: string, updated: number, extra: Partial<ResumeEntry> = {}): ResumeEntry => ({
  title: title(id),
  posSec: 60,
  durSec: 600,
  updated,
  ...extra,
});

test("rows: seconds to ms, ids and keys; anime comes back from its Kitsu id", () => {
  const ep = { id: "kitsu:1376:3", season: 1, episode: 3, name: "Three" };
  assert.deepEqual(toRow({ type: "anime", title: title("kitsu:1376"), episode: ep, posSec: 420.4, durSec: 1440, updated: 7 }), {
    content_id: "kitsu:1376",
    content_type: "series",
    video_id: "kitsu:1376:3",
    season: 1,
    episode: 3,
    position: 420400,
    duration: 1440000,
    last_watched: 7,
  });
  assert.deepEqual(toRow({ type: "movie", title: title("tt1"), posSec: 0, durSec: 0, updated: 1 }).video_id, "tt1");
  assert.equal(kindOf({ content_id: "kitsu:1", content_type: "series" }), "anime");
  assert.equal(kindOf({ content_id: "tt1", content_type: "series" }), "series");
  assert.equal(progressKey("tt4574334", 1, 2), "tt4574334_s1e2");
  assert.equal(progressKey("tt1"), "tt1");
});

test("rows to items: one per title, newest episode, newest first, known titles kept", () => {
  const items = toItems(
    [
      { content_id: "tt9", content_type: "series", video_id: "tt9:1:1", season: 1, episode: 1, position: 1000, duration: 2000, last_watched: 10 },
      { content_id: "tt9", content_type: "series", video_id: "tt9:1:2", season: 1, episode: 2, position: 0, duration: 0, last_watched: 30 },
      { content_id: "tt5", content_type: "movie", video_id: "tt5", position: 60000, duration: 600000, last_watched: 20 },
    ],
    (id) => (id === "tt5" ? title("tt5", "Known film") : undefined),
  );
  assert.deepEqual(items.map((i) => [i.title.id, i.type, i.episode?.episode, i.posSec, i.title.name]), [
    ["tt9", "series", 2, 0, ""],
    ["tt5", "movie", undefined, 60, "Known film"],
  ]);
});

test("meta: bare titles filled from Cinemeta and Kitsu, cached; offline keeps them bare", async () => {
  const kvMap = new Map<string, unknown>();
  const kv = { get: (k: string) => (kvMap.get(k) ?? null) as never, set: (k: string, v: unknown) => void kvMap.set(k, v) };
  const asked: string[] = [];
  const f = (async (u: RequestInfo | URL) => {
    asked.push(String(u));
    const id = String(u).match(/(tt\d+|kitsu:\d+)/)![1];
    return new Response(JSON.stringify({ meta: { name: `Name ${id}`, releaseInfo: "2001–2003", poster: "p.jpg" } }));
  }) as typeof fetch;
  const bare = toItems([
    { content_id: "tt1", content_type: "series", video_id: "tt1:1:4", season: 1, episode: 4, position: 0, duration: 0, last_watched: 2 },
    { content_id: "kitsu:7", content_type: "series", video_id: "kitsu:7:1", season: 1, episode: 1, position: 0, duration: 0, last_watched: 1 },
  ]);
  const filled = await withMeta(bare, kv, f);
  assert.deepEqual(filled.map((i) => [i.title.name, i.title.year, i.episode?.name]), [
    ["Name tt1", "2001–2003", "Episode 4"],
    ["Name kitsu:7", "2001–2003", "Episode 1"],
  ]);
  assert.ok(asked[0].startsWith("https://v3-cinemeta.strem.io/meta/series/tt1"));
  assert.ok(asked[1].startsWith("https://anime-kitsu.strem.fun/meta/series/kitsu:7"));
  await withMeta(bare, kv, f);
  assert.equal(asked.length, 2, "second time from the cache");
  const offline = await withMeta(toItems([{ content_id: "tt2", content_type: "movie", video_id: "tt2", position: 0, duration: 0, last_watched: 1 }]), kv, (async () => {
    throw new Error("offline");
  }) as typeof fetch);
  assert.equal(offline[0].title.name, "");
});

test("watched rows: movies and whole series only", () => {
  assert.deepEqual(
    watchedTitleIds([
      { content_id: "tt1", content_type: "movie", watched_at: 1 },
      { content_id: "tt2", content_type: "series", season: 1, episode: 1, watched_at: 1 },
      { content_id: "tt3", content_type: "series", watched_at: 1 },
      { content_id: "tt1", content_type: "movie", watched_at: 2 },
    ]),
    ["tt1", "tt3"],
  );
});

test("merge: the cloud is the truth up to the last sync; newer local saves win", () => {
  const merged = mergeWithCloud(
    [entry("gone", 5), entry("mine", 50, { posSec: 99 }), entry("both", 60, { posSec: 1 })],
    [entry("both", 40, { posSec: 2 }), entry("other", 30)],
    20,
  );
  assert.deepEqual(merged.map((e) => [e.title.id, e.posSec]), [
    ["both", 1],
    ["mine", 99],
    ["other", 60],
  ]);
});

function fakeRemote(cloudItems: UnifiedResumeEntry[], watched: string[] = []) {
  const log: string[] = [];
  const r: ResumeRemote = {
    pull: async (known) => cloudItems.map((e) => ({ ...e, title: known(e.title.id) ?? e.title })),
    push: async (entries) => (log.push(`push ${entries.map((e) => `${e.title.id}@${e.posSec}`).join(",")}`), true),
    finished: async (type, t, ep) => void log.push(`finished ${type} ${t.id}${ep ? ` s${ep.season}e${ep.episode}` : ""}`),
    watched: async (id, w) => void log.push(`watched ${id} ${w}`),
    pullWatched: async () => watched,
  };
  return { r, log };
}

test("sync with the cloud: kinds land in their own lists, unsynced saves are pushed, watched ids join", async () => {
  store.clear();
  const { r, log } = fakeRemote(
    [
      { ...entry("kitsu:1", 300), type: "anime" },
      { ...entry("tt7", 200), type: "series" },
    ],
    ["tt99"],
  );
  setResumeRemote(r);
  store.set("sectv.movie.resume.v2", JSON.stringify([entry("tt5", 250)]));
  const all = await syncAllResume();
  assert.deepEqual(all.map((e) => [e.type, e.title.id]), [
    ["anime", "kitsu:1"],
    ["movie", "tt5"],
    ["series", "tt7"],
  ]);
  assert.deepEqual(log, ["push tt5@60"]);
  assert.deepEqual(loadWatchedIds(), ["tt99"]);
  log.length = 0;
  await syncAllResume();
  assert.deepEqual(log, ["push "], "nothing new to push");
  assert.deepEqual(loadResume("movie"), [], "tt5 is not in the cloud any more after the last sync");
  setResumeRemote(null);
});

test("saveProgress with the cloud: the next episode first, then the finished one is recorded", async () => {
  store.clear();
  const { r, log } = fakeRemote([]);
  setResumeRemote(r);
  const v = (s: number, e: number) => ({ id: `tt1:${s}:${e}`, season: s, episode: e, name: `E${e}` });
  saveProgress("series", title("tt1"), v(1, 1), 3590, 3600, v(1, 2));
  saveProgress("movie", title("tt2"), undefined, 5990, 6000);
  saveProgress("movie", title("tt3"), undefined, 100, 6000);
  await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual([...log].sort(), ["finished movie tt2", "finished series tt1 s1e1", "push tt1@0", "push tt3@100"]);
  assert.ok(log.indexOf("push tt1@0") < log.indexOf("finished series tt1 s1e1"), "next episode before the finished one");
  assert.deepEqual(loadWatchedIds(), ["tt2"]);
  log.length = 0;
  markTitleWatched("tt4", true);
  markTitleWatched("tt2", false);
  assert.deepEqual(log, ["watched tt4 true", "watched tt2 false"]);
  setResumeRemote(null);
});

test("launch: a grant for another profile takes over and resets the lists; the same payload applies once", () => {
  store.clear();
  store.set("sectv.movie.resume.v2", JSON.stringify([entry("old", 1)]));
  const session = { access: "a", refresh: "r", exp: Date.now() + 3600_000, userId: "u1", anonymous: false };
  const raw = encodeLaunch({ at: 100, grant: { session, profile: 3 }, open: { type: "movie", title: title("tt5"), autoPlay: true } });
  let resets = 0;
  const open = takeLaunch(() => (resets++, clearLocalResume()), () => decodeLaunch(raw));
  assert.deepEqual(open, { type: "movie", title: title("tt5"), autoPlay: true });
  assert.deepEqual([cloud.session.get()?.userId, cloud.session.profile(), resets], ["u1", 3, 1]);
  assert.deepEqual(loadResume("movie"), []);
  assert.equal(takeLaunch(() => resets++, () => decodeLaunch(raw)), null, "already applied");

  const again = encodeLaunch({ at: 101, grant: { session: { ...session, access: "b" }, profile: 3 } });
  takeLaunch(() => resets++, () => decodeLaunch(again));
  assert.equal(cloud.session.get()?.access, "a", "same account and profile keeps its own session");
  assert.equal(resets, 1);
});
