import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultEpisode, episodeLabel, episodesOf, hasAired, nextEpisode, seasonsOf } from "../src/lib/episodes.ts";
import { isFinished, saveProgress, upsert, type ResumeEntry } from "../src/lib/resume.ts";
import type { Video } from "../src/lib/types.ts";

const v = (season: number, episode: number, released?: string): Video => ({
  id: `tt1:${season}:${episode}`,
  season,
  episode,
  name: `E${episode}`,
  released,
});

const NOW = Date.parse("2026-06-01T00:00:00Z");
const videos = [v(0, 1), v(1, 2), v(1, 1), v(2, 1), v(2, 2, "2026-12-01T00:00:00Z")];

test("seasons ascend with specials last; episodes sort within a season", () => {
  assert.deepEqual(seasonsOf(videos), [1, 2, 0]);
  assert.deepEqual(episodesOf(videos, 1).map((e) => e.episode), [1, 2]);
});

test("next episode crosses seasons, skips unaired ones and never leaves a season for specials", () => {
  assert.equal(nextEpisode(videos, "tt1:1:1", NOW)?.id, "tt1:1:2");
  assert.equal(nextEpisode(videos, "tt1:1:2", NOW)?.id, "tt1:2:1");
  assert.equal(nextEpisode(videos, "tt1:2:1", NOW), null);
  assert.equal(nextEpisode(videos, "nope", NOW), null);
});

test("play starts at the remembered episode, else the first aired regular one", () => {
  assert.equal(defaultEpisode(videos, "tt1:2:1", NOW)?.id, "tt1:2:1");
  assert.equal(defaultEpisode(videos, undefined, NOW)?.id, "tt1:1:1");
  assert.equal(defaultEpisode(videos, "gone", NOW)?.id, "tt1:1:1");
  assert.equal(defaultEpisode([v(0, 1)], undefined, NOW)?.id, "tt1:0:1");
  assert.equal(defaultEpisode([], undefined, NOW), null);
});

test("aired: no date counts as aired, a future date does not", () => {
  assert.ok(hasAired(v(1, 1), NOW));
  assert.ok(hasAired(v(1, 1, "2026-01-01T00:00:00Z"), NOW));
  assert.ok(!hasAired(v(1, 1, "2026-12-01T00:00:00Z"), NOW));
});

test("labels", () => {
  assert.equal(episodeLabel(v(3, 7)), "S3E7");
  assert.equal(episodeLabel(v(0, 2)), "Special 2");
});

const entry = (id: string): ResumeEntry => ({
  title: { id, name: id, year: "", rating: "" },
  posSec: 10,
  durSec: 100,
  updated: 0,
});

test("resume: finished means within 30 s of the end; upsert drops or moves to the front", () => {
  assert.ok(isFinished(95, 100));
  assert.ok(!isFinished(10, 100));
  assert.ok(!isFinished(10, 0));
  const list = upsert(upsert([], entry("a"), false), entry("b"), false);
  assert.deepEqual(list.map((e) => e.title.id), ["b", "a"]);
  assert.deepEqual(upsert(list, entry("a"), false).map((e) => e.title.id), ["a", "b"]);
  assert.deepEqual(upsert(list, entry("b"), true).map((e) => e.title.id), ["a"]);
});

test("saveProgress: a finished episode moves the entry to the next episode at 0:00", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, val: string) => void store.set(k, val),
  };
  const title = { id: "tt1", name: "Show", year: "2020", rating: "8" };
  saveProgress("series", title, v(1, 1), 3590, 3600, v(1, 2));
  const saved = JSON.parse([...store.values()][0]) as ResumeEntry[];
  assert.equal(saved[0].episode?.id, "tt1:1:2");
  assert.equal(saved[0].posSec, 0);
  saveProgress("series", title, v(1, 2), 3590, 3600, null);
  assert.deepEqual(JSON.parse([...store.values()][0]), []);
});
