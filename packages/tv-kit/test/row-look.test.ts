import assert from "node:assert/strict";
import { test } from "node:test";
import { rowColumn } from "../src/grid.ts";
import { autoLook, lookBox, RANKING_MAX, ROW_LOOKS, SPOTLIGHT_SCALE, stepLook } from "../src/row-look.ts";

const POSTER = { w: 180, h: 270, gap: 22 };

test("looks: as tall as the poster (the spotlight taller), as wide as their art, a gap apart", () => {
  for (const look of ROW_LOOKS) {
    const b = lookBox(look, POSTER);
    assert.equal(b.stride - b.w, POSTER.gap, look);
    assert.equal(b.h, look === "spotlight" ? Math.round(POSTER.h * SPOTLIGHT_SCALE) : POSTER.h, look);
  }
  assert.deepEqual(lookBox("poster", POSTER), { w: 180, h: 270, stride: 202, art: "poster", lead: 0, caption: false });
  assert.equal(lookBox("landscape", POSTER).w, 480);
  assert.equal(lookBox("wide", POSTER).w, 360);
  assert.equal(lookBox("square", POSTER).w, 270);
});

test("ranking leaves room for its numeral; the spotlight writes the title on a large still", () => {
  const r = lookBox("ranking", POSTER);
  assert.ok(r.lead > 100, "room for a two-digit numeral");
  assert.equal(r.w, 180 + r.lead);
  assert.equal(lookBox("ranking", { ...POSTER, lead: 96 }).lead, 96);
  const s = lookBox("spotlight", POSTER);
  assert.equal(s.art, "still");
  assert.ok(s.caption);
  assert.ok(Math.abs(s.w / s.h - 16 / 9) < 0.01);
  assert.ok(s.h <= 320, "still fits under the row's title");
  assert.equal(RANKING_MAX, 10);
});

test("sizes scale every look but the spotlight", () => {
  assert.equal(lookBox("poster", POSTER, 0.85).h, 230);
  assert.equal(lookBox("spotlight", POSTER, 0.85).h, lookBox("spotlight", POSTER).h);
});

test("automatic look: the first collection a spotlight, a chart a Top 10, wide collections as stills", () => {
  assert.equal(autoLook({ title: "Featured", tileShape: "SQUARE", lead: true }), "spotlight");
  assert.equal(autoLook({ title: "Top films" }), "ranking");
  assert.equal(autoLook({ title: "Trending now" }), "ranking");
  assert.equal(autoLook({ title: "Popular · Shows" }), "ranking");
  assert.equal(autoLook({ title: "Stopwatch thrillers" }), "poster", "a word inside another word is not a chart");
  assert.equal(autoLook({ title: "Directors", tileShape: "LANDSCAPE" }), "landscape");
  assert.equal(autoLook({ title: "Studios", tileShape: "SQUARE" }), "square");
  assert.equal(autoLook({ title: "Continue watching" }), "poster");
});

test("looks step through the menu's order and wrap", () => {
  assert.equal(stepLook("poster", 1), "landscape");
  assert.equal(stepLook("poster", -1), "spotlight");
  assert.equal(stepLook("spotlight", 1), "poster");
});

test("a vertical move lands where the row was left, else in the same on-screen slot", () => {
  assert.equal(rowColumn(5, 2, 20), 5, "a visited row comes back where it was");
  assert.equal(rowColumn(9, 2, 4), 3, "clamped to a row that shrank");
  assert.equal(rowColumn(undefined, 7, 20), 1, "a new row: the second slot, where the focused card sits");
  assert.equal(rowColumn(undefined, 0, 20), 0);
  assert.equal(rowColumn(undefined, 7, 1), 0);
  assert.equal(rowColumn(undefined, 3, 0), 0);
});
