import { test } from "node:test";
import assert from "node:assert/strict";
import { createSkipFinder, estimateCredits, parseAniSkip, parseIntroDb, plausible } from "../src/lib/skip.ts";

// Written for these tests, in the shape AniSkip answers with.
const ANSWER = {
  found: true,
  results: [
    { interval: { startTime: 47.4, endTime: 137.4 }, skipType: "op", episodeLength: 1540 },
    { interval: { startTime: 75, endTime: 135 }, skipType: "mixed-op", episodeLength: 1420 },
    { interval: { startTime: 1342.8, endTime: 1430.6 }, skipType: "ed", episodeLength: 1447 },
    { interval: { startTime: 24.4, endTime: 114.4 }, skipType: "mixed-ed", episodeLength: 1464 },
    { interval: { startTime: 0, endTime: 40 }, skipType: "recap", episodeLength: 3000 },
  ],
};

test("AniSkip: per type the closest length within 10%, and only plausible segments", () => {
  // The file is 1440 s: the 1420 s opening is closer than the 1540 s one; the 1464 s 'ending' at 24 s is no ending;
  // the recap was measured on a 3000 s file.
  assert.deepEqual(parseAniSkip(ANSWER, 1440), [
    { type: "intro", start: 75, end: 135, source: "aniskip" },
    { type: "credits", start: 1342.8, end: 1430.6, source: "aniskip" },
  ]);
  assert.deepEqual(parseAniSkip(null, 1440), []);
  assert.deepEqual(parseAniSkip(ANSWER, 600), [], "every answer is for a much longer cut");
});

test("plausible: openings in the first half and at most 3 min, credits in the last 15%, inside the episode", () => {
  assert.ok(plausible({ type: "intro", start: 60, end: 150 }, 1440));
  assert.ok(!plausible({ type: "intro", start: 60, end: 300 }, 1440), "too long");
  assert.ok(!plausible({ type: "recap", start: 800, end: 860 }, 1440), "second half");
  assert.ok(plausible({ type: "credits", start: 1300, end: 1440 }, 1440));
  assert.ok(!plausible({ type: "credits", start: 1000, end: 1100 }, 1440), "too early");
  assert.ok(!plausible({ type: "credits", start: 1300, end: 1500 }, 1440), "past the end");
});

test("finder: Kitsu to MAL through ARM, AniSkip by episode, answers and 'none' cached; other ids are not anime", async () => {
  const calls: string[] = [];
  const kv = (() => {
    const m = new Map<string, unknown>();
    return { get: <T>(k: string) => (m.get(k) ?? null) as T | null, set: (k: string, v: unknown) => void m.set(k, structuredClone(v)) };
  })();
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url.replace(/\?.*/, ""));
    if (url.includes("arm.haglund.dev")) return new Response(JSON.stringify({ myanimelist: 16498 }));
    if (url.includes("/skip-times/16498/1?")) return new Response(JSON.stringify(ANSWER));
    if (url.includes("/skip-times/16498/2?")) return new Response(JSON.stringify({ found: false, results: [] }), { status: 404 });
    return new Response("", { status: 500 });
  }) as typeof fetch;
  const finder = createSkipFinder({ fetch: f, kv });
  const one = await finder.find({ id: "kitsu:7442:1", durSec: 1440 });
  assert.deepEqual(one.map((s) => `${s.type}:${s.source}`), ["intro:aniskip", "credits:aniskip"]);
  await finder.find({ id: "kitsu:7442:1", durSec: 1440 });
  // Nothing known: only the credits estimate, for the Up next card.
  assert.deepEqual((await finder.find({ id: "kitsu:7442:2", durSec: 1440 })).map((s) => s.source), ["estimate"]);
  await finder.find({ id: "kitsu:7442:2", durSec: 1440 });
  assert.deepEqual(calls, [
    "https://arm.haglund.dev/api/v2/ids",
    "https://api.aniskip.com/v2/skip-times/16498/1",
    "https://api.aniskip.com/v2/skip-times/16498/2",
  ]);
  assert.deepEqual(await finder.find({ id: "kitsu:7442:3", durSec: 0 }), [], "no duration yet");
  assert.equal(calls.length, 3);
});

test("TheIntroDB: open start and end, the first plausible per type; estimate only when no credits", () => {
  // Written for this test, in the shape TheIntroDB documents.
  const body = { intro: [{ start_ms: null, end_ms: 23000 }], recap: [{ start_ms: 1700000, end_ms: 1760000 }], credits: [{ start_ms: 3155000, end_ms: null }] };
  assert.deepEqual(parseIntroDb(body, 3183), [
    { type: "intro", start: 0, end: 23, source: "theintrodb" },
    { type: "credits", start: 3155, end: 3183, source: "theintrodb" },
  ]);
  assert.deepEqual(estimateCredits(2700), { type: "credits", start: 2655, end: 2700, source: "estimate" });
});

test("finder: TheIntroDB for IMDb and TMDB ids with season, episode and duration; 'none' kept for the session", async () => {
  const calls: string[] = [];
  const kv = (() => {
    const m = new Map<string, unknown>();
    return { get: <T>(k: string) => (m.get(k) ?? null) as T | null, set: (k: string, v: unknown) => void m.set(k, structuredClone(v)) };
  })();
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url.replace("https://api.theintrodb.org/v4/media?", ""));
    if (url.includes("imdb_id=tt3032476&season=1&episode=1&")) {
      return new Response(JSON.stringify({ intro: [{ start_ms: 360500, end_ms: 373620 }], credits: [{ start_ms: 3155000, end_ms: null }] }));
    }
    return new Response(JSON.stringify({ code: "no_submissions" }), { status: 404 });
  }) as typeof fetch;
  const finder = createSkipFinder({ fetch: f, kv });
  const ep1 = await finder.find({ id: "tt3032476:1:1", durSec: 3183 });
  assert.deepEqual(ep1.map((s) => [s.type, s.start, s.source]), [["intro", 360.5, "theintrodb"], ["credits", 3155, "theintrodb"]]);
  assert.equal(calls[0], "imdb_id=tt3032476&season=1&episode=1&duration_ms=3183000");
  await finder.find({ id: "tt3032476:1:1", durSec: 3183 });
  const ep2 = await finder.find({ id: "tt3032476", season: 1, episode: 2, durSec: 2800 });
  assert.deepEqual(ep2.map((s) => s.source), ["estimate"]);
  await finder.find({ id: "tt3032476", season: 1, episode: 2, durSec: 2800 });
  await finder.find({ id: "tmdb:60059:1:3", durSec: 2800 });
  assert.deepEqual(calls, [
    "imdb_id=tt3032476&season=1&episode=1&duration_ms=3183000",
    "imdb_id=tt3032476&season=1&episode=2&duration_ms=2800000",
    "tmdb_id=60059&season=1&episode=3&duration_ms=2800000",
  ]);
});

test("pill: an intro or recap in its first 10 s, never skipped twice, never credits or the estimate", async () => {
  const { creditsStart, pillAt, segmentKey } = await import("../src/lib/skip.ts");
  const intro = { type: "intro" as const, start: 360, end: 374, source: "theintrodb" as const };
  const credits = { type: "credits" as const, start: 3155, end: 3183, source: "theintrodb" as const };
  const estimate = { type: "credits" as const, start: 2655, end: 2700, source: "estimate" as const };
  const none = new Set<string>();
  assert.equal(pillAt([intro, credits], 359, none), null);
  assert.equal(pillAt([intro, credits], 362, none), intro);
  assert.equal(pillAt([intro, credits], 371, none), null, "past its first 10 s");
  assert.equal(pillAt([intro], 362, new Set([segmentKey(intro)])), null, "already skipped");
  assert.equal(pillAt([credits], 3160, none), null);
  assert.equal(creditsStart([intro, credits]), 3155);
  assert.equal(creditsStart([intro, estimate]), null);
});
