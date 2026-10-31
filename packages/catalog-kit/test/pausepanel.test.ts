import { test } from "node:test";
import assert from "node:assert/strict";
import { logoUrl, pauseFacts, pausePanelShown } from "../src/lib/pausepanel.ts";
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
  assert.deepEqual(pauseFacts(title, ep), { episodeLine: "S1E2 · Mijo", facts: "2015  ·  50 min  ·  IMDb 9.0", synopsis: "Episode." });
  assert.deepEqual(pauseFacts(title).synopsis, "Show.");
  assert.equal(logoUrl("tt3032476"), "https://images.metahub.space/logo/medium/tt3032476/img");
  assert.equal(logoUrl("kitsu:7442"), null);
});
