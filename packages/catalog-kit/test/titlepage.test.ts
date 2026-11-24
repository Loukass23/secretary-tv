import { test } from "node:test";
import assert from "node:assert/strict";
import { airLine, creditLines, episodePanel, isSpoiler, type SpoilerState } from "../src/lib/titlepage.ts";
import { peopleOf, toTitle } from "../src/lib/cinemeta.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/lib/settings.ts";
import type { Video } from "../src/lib/types.ts";

const NOW = Date.parse("2026-06-01T00:00:00Z");
const ep = (season: number, episode: number, extra: Partial<Video> = {}): Video => ({
  id: `tt1:${season}:${episode}`,
  season,
  episode,
  name: `Episode ${episode}`,
  ...extra,
});
const show = { name: "Example Show", description: "The show's own synopsis.", runtime: "52 min" };

test("the panel follows the focused episode: its own title, line and synopsis", () => {
  const p = episodePanel(show, ep(1, 3, { name: "The Third", overview: "What happens in three.", released: "2024-03-12T00:00:00Z" }), undefined, NOW);
  assert.equal(p.title, "The Third");
  assert.deepEqual(p.meta, ["S1 · E3", "52 min", "Aired 12 Mar 2024"]);
  assert.equal(p.about, "What happens in three.");
  assert.equal(p.aboutIsShow, false);
  assert.equal(p.hidden, false);
});

test("an episode without a synopsis falls back to the show's; no episode shows the show", () => {
  const blank = episodePanel(show, ep(2, 1, { overview: "   " }), undefined, NOW);
  assert.equal(blank.title, "Episode 1");
  assert.equal(blank.about, "The show's own synopsis.");
  assert.equal(blank.aboutIsShow, true);
  const none = episodePanel(show, undefined, undefined, NOW);
  assert.equal(none.title, "Example Show");
  assert.equal(none.about, "The show's own synopsis.");
  assert.deepEqual(none.meta, []);
});

test("specials and episodes still to come read as such", () => {
  assert.deepEqual(episodePanel(show, ep(0, 2), undefined, NOW).meta, ["Special 2", "52 min"]);
  assert.equal(airLine({ released: "2026-12-03T00:00:00Z" }, NOW), "Airs 3 Dec 2026");
  assert.equal(airLine({}, NOW), undefined);
  assert.equal(airLine({ released: "soon" }, NOW), undefined);
});

test("spoilers: unwatched episodes count, watched, in progress and a show marked watched do not", () => {
  const s: SpoilerState = { on: true, watched: new Set(["1:1", "1:2"]), resumeId: "tt1:1:3" };
  assert.equal(isSpoiler(ep(1, 1), s), false, "watched to the end");
  assert.equal(isSpoiler(ep(1, 3), s), false, "in progress");
  assert.equal(isSpoiler(ep(1, 4), s), true, "not watched yet");
  assert.equal(isSpoiler(ep(2, 1), s), true, "a later season");
  assert.equal(isSpoiler(ep(0, 1), s), true, "a special not watched");
  assert.equal(isSpoiler(ep(1, 9, { released: "2027-01-01T00:00:00Z" }), s), true, "not aired yet");
  assert.equal(isSpoiler(ep(1, 4), { ...s, titleWatched: true }), false, "the whole show marked watched");
  assert.equal(isSpoiler(ep(1, 4), { ...s, on: false }), false, "protection off");
});

test("spoilers hide only the episode's own synopsis, never the show's fallback", () => {
  const s: SpoilerState = { on: true, watched: new Set() };
  assert.equal(episodePanel(show, ep(1, 4, { overview: "A twist." }), s, NOW).hidden, true);
  assert.equal(episodePanel(show, ep(1, 4), s, NOW).hidden, false);
  // The title always stays readable.
  assert.equal(episodePanel(show, ep(1, 4, { name: "The Twist", overview: "A twist." }), s, NOW).title, "The Twist");
});

test("spoiler protection is a setting, off by default, kept when saved on", () => {
  assert.equal(DEFAULT_SETTINGS.playback.spoilerProtection, false);
  assert.equal(mergeSettings({}).playback.spoilerProtection, false);
  assert.equal(mergeSettings({ playback: { ...DEFAULT_SETTINGS.playback, spoilerProtection: true } }).playback.spoilerProtection, true);
});

test("a film's people: from the meta's fields or its links, as Director and Starring lines", () => {
  assert.deepEqual(peopleOf({ cast: ["A One", "B Two"], director: "C Three" }), { cast: ["A One", "B Two"], director: ["C Three"] });
  assert.deepEqual(
    peopleOf({ links: [{ name: "A One", category: "Cast" }, { name: "D Four", category: "Directors" }, { name: "Drama", category: "Genres" }] }),
    { cast: ["A One"], director: ["D Four"] },
  );
  assert.deepEqual(peopleOf({}), {});
  const t = toTitle({ id: "tt0000001", name: "Example Film", cast: ["A", "B", "C", "D", "E", "F"], director: ["G", "H"] });
  assert.deepEqual(creditLines(t!), [
    { label: "Directors", names: "G, H" },
    { label: "Starring", names: "A, B, C, D, E" },
  ]);
  assert.deepEqual(creditLines({}), []);
});
