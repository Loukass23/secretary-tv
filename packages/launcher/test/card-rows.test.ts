import { test } from "node:test";
import assert from "node:assert/strict";
import type { MediaItem, RowColumn } from "../src/cards.tsx";
import { captionMeta, episodeLabel, expandedRows, focusedItem, onRow, rowItems, rowTitle, targetAt, tileKey, tileKeys, timeLeft } from "../src/card-rows.ts";
import { END_ALL, END_RECOMMEND, END_TOP } from "../src/nest-nav.ts";

type Media = Extract<RowColumn, { kind: "media" }>;
const item = (title: string, extra: Partial<MediaItem> = {}): MediaItem => ({ poster: `https://example.com/${encodeURIComponent(title)}.jpg`, title, about: `About ${title}.`, ...extra });

const card = (over: Partial<Media> = {}): Media => ({
  kind: "media",
  key: "cinema",
  label: "Continue · Cinema",
  name: "Cinema",
  unit: "films",
  heading: "Continue watching",
  style: { layout: "poster", size: "l" },
  run: () => {},
  items: [item("Harbour Lights", { resume: true }), item("The Long Field", { resume: true })],
  more: [
    { label: "Tonight's picks", items: [item("North Road"), item("Glass Orchard"), item("Low Tide")], run: () => {} },
    { label: "Empty genre", items: [], run: () => {} },
    { label: "My List", items: [item("Quiet Hours")], run: () => {} },
  ],
  ...over,
});

test("the caption names the focused tile's title on every row (screen 7)", () => {
  const c = card();
  const all = [0, 1, 2, 3].flatMap((r) => rowItems(c, r));
  assert.equal(all.length, expandedRows(c).reduce((s, n) => s + n, 0));
  all.forEach((it, flat) => {
    const { r, x } = onRow(c, flat);
    assert.equal(rowItems(c, r)[x], it, `tile ${flat}`);
    assert.equal(focusedItem(c, flat), it, `caption under tile ${flat}`);
    assert.equal(focusedItem(c, flat)?.about, `About ${it.title}.`);
  });
  assert.deepEqual(expandedRows(c), [2, 3, 1], "an empty row is skipped");
});

test("the first pick's caption is the first pick, not a title from the row before", () => {
  const c = card();
  assert.equal(focusedItem(c, 2)?.title, "North Road");
  assert.equal(focusedItem(c, 1)?.title, "The Long Field");
});

test("on the end bar no title is focused, and the header names the last row without a count", () => {
  const c = card();
  for (const end of [END_TOP, END_RECOMMEND, END_ALL]) {
    assert.deepEqual(onRow(c, end), { r: 2, x: -1, end: true });
    assert.equal(focusedItem(c, end), undefined);
    assert.equal(rowTitle(c, end), "My List");
  }
  assert.equal(rowTitle(c, 0), "Continue watching");
  assert.equal(rowTitle(c, 3), "Tonight's picks");
  assert.equal(rowTitle(card({ heading: undefined }), 0), "Continue · Cinema");
});

test("a tile keeps its key when the row's titles shift, so its picture never lags another title's caption", () => {
  const before = card().more![0].items;
  const after = before.slice(1); // the first pick removed from the suggestions
  const keys = new Map(before.map((it) => [tileKey(it), it.title]));
  for (const it of after) assert.equal(keys.get(tileKey(it)), it.title, "same title, same tile");
  assert.notEqual(tileKey(after[0]), tileKey(before[0]), "the slot that now holds another title gets a new tile");
  assert.notEqual(tileKey(item("A", { poster: "p" })), tileKey(item("B", { poster: "p" })));
  const twice = tileKeys([item("A"), item("B"), item("A")]);
  assert.equal(new Set(twice).size, 3, "a title listed twice still gets its own tile");
  assert.equal(twice[0], tileKey(item("A")));
});

test("targets follow the same rows", () => {
  const c = card({ target: (i) => ({ type: "movie", title: { id: `t${i}`, name: "", year: "", rating: "" }, resume: true, row: "cinema/continue" }) });
  assert.equal(targetAt(c, 1)?.title.id, "t1");
  assert.equal(targetAt(c, 2), null, "the picks row has no target here");
  assert.equal(targetAt(c, END_TOP), null);
});

test("the caption's line carries the rating and the ranking when known", () => {
  assert.deepEqual(captionMeta(item("X", { sub: "2026", rating: "7.4", rank: "No. 1 in Popular films" })), ["2026", "★ 7.4", "No. 1 in Popular films"]);
  assert.deepEqual(captionMeta(item("X", { sub: "S1 · E2" })), ["S1 · E2"]);
  assert.deepEqual(captionMeta(item("X", { rating: "8" })), ["★ 8.0"], "one rating format (catalog-kit ratingLabel)");
});

test("an episode is named by its number, and by its own name only when it has a real one", () => {
  assert.equal(episodeLabel({ season: 1, episode: 24, name: "Episode 24" }), "S1 · E24");
  assert.equal(episodeLabel({ season: 2, episode: 3, name: "Ep. 3" }), "S2 · E3");
  assert.equal(episodeLabel({ season: 1, episode: 5, name: "The Long Night" }), "S1 · E5 · The Long Night");
  assert.equal(episodeLabel({ season: 1, episode: 5, name: "" }), "S1 · E5");
  assert.equal(episodeLabel(undefined), undefined);
});

test("time left is said in minutes, then hours", () => {
  assert.equal(timeLeft(600, 2400), "30 min left");
  assert.equal(timeLeft(0, 5100), "1 h 25 min left");
  assert.equal(timeLeft(0, 3600), "1 h left");
  assert.equal(timeLeft(2390, 2400), "Almost done");
  assert.equal(timeLeft(100, 0), undefined, "no length, nothing said");
});
