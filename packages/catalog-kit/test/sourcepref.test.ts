import { test } from "node:test";
import assert from "node:assert/strict";
import { audioLanguages, createSourcePrefs, matchPref, PREF_TTL_MS, prefOf, releaseKey, titleKey } from "../src/lib/sourcepref.ts";
import type { Stream } from "../src/lib/streams.ts";

const st = (name: string, title: string, extra: Partial<Stream> = {}): Stream => ({ name, title, url: `https://x.example/${name}/${title}`, ...extra });
const memory = () => {
  const map = new Map<string, unknown>();
  return { get: <T>(k: string) => (map.has(k) ? (structuredClone(map.get(k)) as T) : null), set: (k: string, v: unknown) => void map.set(k, structuredClone(v)) };
};

test("keys: the show for an episode, the release name without its episode", () => {
  assert.equal(titleKey("tt0944947:1:2"), "tt0944947");
  assert.equal(titleKey("kitsu:7442:5"), "kitsu:7442");
  assert.equal(titleKey("tmdb:1399:2:5"), "tmdb:1399");
  assert.equal(titleKey("tt0133093"), "tt0133093");
  assert.equal(releaseKey({ title: "Show.S01E06.1080p.WEB-DL-GRP.mkv" }), "show.");
  assert.equal(releaseKey({ title: "Show 1x06 HDTV" }), "show ");
  assert.equal(releaseKey({ title: "Film.1280x720.mkv" }), undefined);
  assert.equal(releaseKey({ title: "x", file: "Show.S02E10.mkv" }), "show.");
});

test("audio languages from flags and words", () => {
  assert.deepEqual(audioLanguages(st("⚡ [PM] 1080p • 🇫🇷/🇬🇧 MULTI", "")), ["en", "fr", "multi"]);
  assert.deepEqual(audioLanguages(st("1080p • 🇬🇧 EN", "")), ["en"]);
  assert.deepEqual(audioLanguages(st("Film.TRUEFRENCH.1080p", "")), ["fr"]);
});

test("matching: group wins, then provider and fingerprint, then provider and audio; a lost dub never matches", () => {
  const picked = st("⚡ [PM] 1080p • 🇫🇷/🇬🇧 MULTI", "Show.S01E01.1080p.WEB-DL.HEVC-GRP.mkv", { provider: "fast" });
  const pref = prefOf(picked, 1);
  const next = [
    st("⚡ [PM] 2160p • 🇬🇧 EN", "Show.S01E02.2160p.WEB-DL.HEVC-OTHER.mkv", { provider: "fast" }),
    st("⚡ [PM] 1080p • 🇫🇷/🇬🇧 MULTI", "Show.S01E02.1080p.WEB-DL.HEVC-GRP.mkv", { provider: "fast" }),
    st("⚡ [PM] 1080p • 🇫🇷/🇬🇧 MULTI", "Show.S01E02.1080p.WEB-DL.HEVC-GRP.mkv", { provider: "deep" }),
  ];
  assert.equal(matchPref(pref, next), 1, "same provider and fingerprint");
  // The English-only one would lose the French audio: never a match, even alone.
  assert.equal(matchPref(pref, [next[0]]), -1);
  // Another provider with the same release is no match without a group.
  assert.equal(matchPref(pref, [next[2]]), -1);
  // A binge group beats everything.
  const grouped = prefOf({ ...picked, group: "fast|grp" }, 1);
  const withGroup = [next[1], { ...next[2], group: "fast|grp" }];
  assert.equal(matchPref(grouped, withGroup), 1);
  // Same provider and audio, other release details: still the viewer's kind of source.
  const sameVoice = st("⚡ [PM] 720p • 🇫🇷/🇬🇧 MULTI", "Show.S01E02.720p.HDTV-XYZ.mkv", { provider: "fast" });
  assert.equal(matchPref(pref, [next[0], sameVoice]), 1);
  // Notices are never the remembered source.
  assert.equal(matchPref(pref, [{ ...next[1], notice: true }]), -1);
});

test("memory: manual wins over auto and clears it, 180 days, a wrong clock still counts, 200 titles", () => {
  let t = 10 * PREF_TTL_MS;
  const kv = memory();
  const prefs = createSourcePrefs(kv, () => t);
  const a = st("A 1080p", "A.S01E01.mkv", { provider: "p" });
  const b = st("B 2160p", "B.S01E01.mkv", { provider: "p" });
  prefs.remember("auto", "tt1:1:1", a);
  assert.equal(prefs.recall("tt1:1:5")?.name, "A 1080p");
  prefs.remember("manual", "tt1:1:2", b);
  assert.equal(prefs.recall("tt1")?.name, "B 2160p");
  assert.equal(kv.get<{ auto: Record<string, unknown> }>("sectv.sourcepref.v1")!.auto.tt1, undefined);
  t += PREF_TTL_MS + 1;
  assert.equal(prefs.recall("tt1"), null, "expired");
  prefs.remember("auto", "tt2", a);
  t -= 5 * PREF_TTL_MS;
  assert.ok(prefs.recall("tt2"), "stamped in the future: kept");
  for (let i = 0; i < 210; i++) {
    t += 1;
    prefs.remember("manual", `tt${100 + i}`, a);
  }
  assert.equal(Object.keys(kv.get<{ manual: Record<string, unknown> }>("sectv.sourcepref.v1")!.manual).length, 200);
});

test("matching never lands on a source that failed recently", () => {
  const a = st("⚡ [PM] 2160p • 🇬🇧 EN (👤 9)", "Show 5.3 GB HEVC", { provider: "fast" });
  const b = st("⚡ [PM] 2160p • 🇬🇧 EN (👤 3)", "Show 1.4 GB HEVC", { provider: "fast" });
  const pref = prefOf(st("⚡ [PM] 2160p • 🇬🇧 EN (👤 5)", "Show 1.6 GB HEVC", { provider: "fast" }), 1);
  assert.equal(matchPref(pref, [a, b]), 0);
  assert.equal(matchPref(pref, [a, b], (s) => s === a), 1);
});
