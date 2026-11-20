import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMeta, mergeMeta } from "../src/lib/cinemeta.ts";
import { clipText, isFinished, saveProgress, loadResume, toContinueTitle } from "../src/lib/resume.ts";
import type { Title } from "../src/lib/types.ts";

const base: Title = { id: "tt1", name: "Heat", year: "1995", rating: "8.3", description: "A thief and a cop.", genre: ["Crime"] };

test("mergeMeta never erases known fields with empty ones", () => {
  const m = mergeMeta(base, { ...base, description: undefined, year: "", genre: [], runtime: "170 min" });
  assert.equal(m.description, "A thief and a cop.");
  assert.equal(m.year, "1995");
  assert.deepEqual(m.genre, ["Crime"]);
  assert.equal(m.runtime, "170 min");
});

test("clipText cuts at a word with an ellipsis and leaves short text alone", () => {
  assert.equal(clipText("short text", 50), "short text");
  const c = clipText("alpha beta gamma delta epsilon", 18);
  assert.equal(c, "alpha beta gamma…");
});

test("isFinished counts the credits roll of a long film", () => {
  assert.equal(isFinished(7000, 7200), true); // 97%
  assert.equal(isFinished(6000, 7200), false);
  assert.equal(isFinished(100, 120), true); // last 30 s
  assert.equal(isFinished(50, 0), false);
});

test("toContinueTitle draws no bar for a barely started title", () => {
  const t = toContinueTitle({ type: "movie", title: base, posSec: 3, durSec: 7000, updated: 1 });
  assert.equal(t.progressPct, undefined);
});

test("fetchMeta fills a missing synopsis from Cinemeta", async () => {
  const f = (async (url: string) => {
    const body = String(url).includes("tt777")
      ? { meta: { id: "tt777", imdb_id: "tt777", name: "Quiet", description: "From the fallback.", runtime: "90 min", genre: ["Drama"], year: "2020" } }
      : { meta: null };
    return { ok: true, json: async () => body };
  }) as unknown as typeof fetch;
  const t = await fetchMeta("movie", "tt777", f);
  assert.equal(t?.description, "From the fallback.");
  assert.equal(t?.runtime, "90 min");
});
