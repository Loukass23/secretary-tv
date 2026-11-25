import { test } from "node:test";
import assert from "node:assert/strict";
import { continueFor, type UnifiedResumeEntry } from "../src/lib/resume.ts";

const entry = (type: UnifiedResumeEntry["type"], id: string, name: string): UnifiedResumeEntry => ({
  type,
  title: { id, name, year: "", rating: "" } as UnifiedResumeEntry["title"],
  posSec: 600,
  durSec: 1800,
  updated: 1,
});

test("catalog home: Continue watching lists only the kind of the card it was opened from", () => {
  const all = [entry("anime", "kitsu:1", "Example Anime"), entry("series", "tt0000001", "Example Talk Show"), entry("movie", "tt0000002", "Example Film")];
  assert.deepEqual(continueFor(all, "anime").map((e) => e.title.name), ["Example Anime"]);
  assert.deepEqual(continueFor(all, "series").map((e) => e.title.name), ["Example Talk Show"]);
  assert.deepEqual(continueFor(all, "movie").map((e) => e.title.name), ["Example Film"]);
  assert.deepEqual(continueFor([], "anime"), []);
});
