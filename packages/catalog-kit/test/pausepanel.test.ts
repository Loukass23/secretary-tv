import { test } from "node:test";
import assert from "node:assert/strict";
import { endsAtLabel, logoUrl, pauseFacts, pausePanelShown, shortSynopsis } from "../src/lib/pausepanel.ts";
import type { Title, Video } from "../src/lib/types.ts";

test("pause panel: after 4 s paused with no key; a key restarts the wait; never while playing or switched off", () => {
  const base = { enabled: true, playing: false, pausedAt: 1000, lastKeyAt: 0, now: 4999 };
  assert.equal(pausePanelShown(base), false);
  assert.equal(pausePanelShown({ ...base, now: 5000 }), true);
  assert.equal(pausePanelShown({ ...base, now: 5000, lastKeyAt: 3000 }), false, "a key at 3 s");
  assert.equal(pausePanelShown({ ...base, now: 7000, lastKeyAt: 3000 }), true);
  assert.equal(pausePanelShown({ ...base, now: 9000, playing: true }), false);
  assert.equal(pausePanelShown({ ...base, now: 9000, pausedAt: null }), false);
  assert.equal(pausePanelShown({ ...base, now: 9000, enabled: false }), false);
});

test("pause panel facts: episode line, year · runtime · rating, the episode's synopsis first", () => {
  const title = { id: "tt3032476", name: "Better Call Saul", year: "2015", rating: "9.0", runtime: "50 min", description: "Show." } as Title;
  const ep = { id: "tt3032476:1:2", season: 1, episode: 2, name: "Mijo", overview: "Episode." } as Video;
  assert.deepEqual(pauseFacts(title, ep), { episodeLine: "S1E2 · Mijo", facts: "2015  ·  ★ 9.0", synopsis: "Episode.", runtime: "50 min" });
  assert.deepEqual(pauseFacts(title).synopsis, "Show.");
  // Genres (three at most) join the facts; an episode's runtime is its file's length once known.
  const full = pauseFacts({ ...title, genre: ["Crime", "Drama", "Thriller", "Comedy"] }, ep, 47 * 60 + 10);
  assert.equal(full.facts, "2015  ·  ★ 9.0  ·  Crime, Drama, Thriller");
  assert.equal(full.runtime, "47 min");
  assert.equal(pauseFacts({ ...title, runtime: "" }, undefined, 6720).runtime, "1 h 52 min");
  assert.equal(logoUrl("tt3032476"), "https://images.metahub.space/logo/medium/tt3032476/img");
  assert.equal(logoUrl("kitsu:7442"), null);
});

test("pause screen: the synopsis is kept short, at a sentence when it can, else at a word", () => {
  const long = "A lawyer takes a case. ".repeat(20).trim();
  const short = shortSynopsis(long, 100);
  assert.ok(short.length <= 100 && short.endsWith("case."), short);
  const one = "word ".repeat(80).trim();
  const cut = shortSynopsis(one, 100);
  assert.ok(cut.length <= 101 && cut.endsWith("word…"), cut);
  assert.equal(shortSynopsis("  Two\n lines.  "), "Two lines.");
});

test("pause screen: Ends at reads the clock as Settings does, nothing without a duration", () => {
  const now = new Date(2026, 10, 27, 20, 50, 0);
  assert.equal(endsAtLabel(600, 3600, now), "Ends at 21:40");
  assert.equal(endsAtLabel(600, 3600, now, true), "Ends at 9:40 PM");
  assert.equal(endsAtLabel(0, 600, new Date(2026, 10, 27, 23, 55)), "Ends at 00:05");
  assert.equal(endsAtLabel(0, 600, new Date(2026, 10, 27, 23, 55), true), "Ends at 12:05 AM");
  assert.equal(endsAtLabel(10, 0, now), "");
});
