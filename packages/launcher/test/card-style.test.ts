import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapsedShape,
  DEFAULT_STYLES,
  EXPANDED,
  EXPANDED_W,
  expandedScroll,
  loadCardStyles,
  openStyleMenu,
  saveCardStyles,
  MOVE_LINE,
  REMOVE_LINE,
  SIZE_LINE,
  type StyleMenu,
  stepStyleMenu,
  styleFor,
  STYLES_KEY,
} from "../src/card-style.ts";
import { END_RECOMMEND, enter, type Layout, leave, step } from "../src/nest-nav.ts";

test("the default styles keep today's cards", () => {
  assert.deepEqual(collapsedShape(DEFAULT_STYLES.cinema), {
    w: 360,
    h: 540,
    count: 1,
    across: 1,
    boxes: [{ x: 0, y: 0, w: 360, h: 540, art: "poster" }],
  });
  const stills = collapsedShape(DEFAULT_STYLES.shows);
  assert.equal(stills.count, 2);
  assert.equal(stills.w, 436);
  assert.deepEqual(stills.boxes.map((b) => [b.y, b.h, b.art]), [[0, 259, "still"], [281, 259, "still"]]);
  const grid = collapsedShape(DEFAULT_STYLES.anime);
  assert.equal(grid.h, 540);
  assert.equal(grid.count, 6);
  assert.equal(grid.across, 3);
  assert.deepEqual(grid.boxes[4], { x: 191, y: 278, w: 175, h: 262, art: "poster" });
});

test("smaller sizes shrink every layout, and every layout fits the card height", () => {
  for (const layout of ["poster", "stills", "grid", "row"] as const) {
    const l = collapsedShape({ layout, size: "l" });
    const m = collapsedShape({ layout, size: "m" });
    const s = collapsedShape({ layout, size: "s" });
    assert.ok(s.w < m.w && m.w < l.w, layout);
    assert.equal(l.h, 540, layout);
    assert.equal(s.boxes.length, s.count, layout);
    // Every item stays inside the card.
    for (const b of l.boxes) assert.ok(b.y + b.h <= l.h && b.x + b.w <= l.w, layout);
  }
  // At a size, every layout is the same height.
  for (const size of ["s", "m", "l"] as const) {
    const hs = new Set(["poster", "stills", "grid", "row"].map((layout) => collapsedShape({ layout: layout as "poster", size }).h));
    assert.equal(hs.size, 1, size);
  }
  assert.equal(styleFor({}, "unknown").layout, "poster");
  assert.deepEqual(styleFor({ cinema: { layout: "row", size: "s" } }, "cinema"), { layout: "row", size: "s" });
});

test("the opened row scrolls only once focus passes the third title, and stops at the last one", () => {
  // 9 posters of 280px, 306px apart: 2728px, so the row moves 968px at most.
  assert.equal(expandedScroll(0, 9), 0);
  assert.equal(expandedScroll(2, 9), 0);
  assert.equal(expandedScroll(3, 9), EXPANDED.stride);
  assert.equal(expandedScroll(8, 9), 8 * EXPANDED.stride + EXPANDED.w - EXPANDED_W);
  assert.equal(expandedScroll(8, 9), 968);
  // A longer row scrolls one stride per title past the third.
  assert.equal(expandedScroll(4, 13), 2 * EXPANDED.stride);
  assert.equal(expandedScroll(2, 3), 0);
});

test("saved styles round-trip, and anything unreadable is dropped", () => {
  const box = new Map<string, string>();
  const store = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) };
  assert.deepEqual(loadCardStyles(store), {});
  saveCardStyles(store, { cinema: { layout: "stills", size: "m" } });
  assert.deepEqual(loadCardStyles(store), { cinema: { layout: "stills", size: "m" } });
  box.set(STYLES_KEY, JSON.stringify({ cinema: { layout: "huge", size: "m" }, anime: { layout: "row", size: "s" } }));
  assert.deepEqual(loadCardStyles(store), { anime: { layout: "row", size: "s" } });
  box.set(STYLES_KEY, "{not json");
  assert.deepEqual(loadCardStyles(store), {});
});

test("the menu previews each layout, then changes the size on its own line", () => {
  let m: StyleMenu = openStyleMenu("cinema", DEFAULT_STYLES.cinema);
  assert.equal(m.line, 0);
  m = stepStyleMenu(m, "Down") as StyleMenu;
  assert.deepEqual(m.style, { layout: "stills", size: "l" });
  assert.deepEqual(m.orig, DEFAULT_STYLES.cinema);
  m = stepStyleMenu(stepStyleMenu(stepStyleMenu(m, "Down") as StyleMenu, "Down") as StyleMenu, "Down") as StyleMenu;
  assert.equal(m.line, SIZE_LINE);
  assert.equal(m.style.layout, "row");
  m = stepStyleMenu(m, "Left") as StyleMenu;
  assert.equal(m.style.size, "m");
  m = stepStyleMenu(stepStyleMenu(m, "Left") as StyleMenu, "Left") as StyleMenu;
  assert.equal(m.style.size, "s");
  assert.equal(stepStyleMenu(m, "Enter"), "keep");
  assert.equal(stepStyleMenu(m, "Back"), "undo");
});

test("the last line of the menu removes the card from home, and Left and Right leave it alone there", () => {
  let m: StyleMenu = { ...openStyleMenu("cinema", DEFAULT_STYLES.cinema), line: SIZE_LINE };
  m = stepStyleMenu(m, "Down") as StyleMenu;
  assert.equal(m.line, MOVE_LINE);
  assert.equal(stepStyleMenu(m, "Enter"), "move");
  m = stepStyleMenu(m, "Down") as StyleMenu;
  assert.equal(m.line, REMOVE_LINE);
  assert.deepEqual(m.style, DEFAULT_STYLES.cinema);
  assert.equal(stepStyleMenu(m, "Down"), m);
  assert.equal(stepStyleMenu(m, "Right"), m);
  assert.equal(stepStyleMenu(m, "Enter"), "remove");
  assert.equal(stepStyleMenu(m, "Back"), "undo");
  assert.equal((stepStyleMenu(m, "Up") as StyleMenu).line, MOVE_LINE);
});

test("an opened media card is one row: OK lands on the first title, the Open tile is last, Up and Back fold it", () => {
  // Cinema opened on one row of 6, then Shows and Home folded.
  const open: Layout = { ask: 1, cols: [{ count: 6, across: 6, rows: [6] }, { count: 2, across: 1 }, { count: 3, across: 1 }], menu: 0 };
  const card = { area: "row" as const, col: 0, i: 0 };
  const at = (i: number) => ({ area: "row" as const, col: 0, i, inside: true });
  assert.deepEqual(enter(card, open), at(0));
  assert.deepEqual(step(at(0), "Right", open), at(1));
  assert.deepEqual(step(at(5), "Right", open), at(5));
  assert.deepEqual(step(at(0), "Left", open), at(0));
  assert.deepEqual(step(at(3), "Up", open), card);
  assert.deepEqual(step(at(3), "Down", open), at(END_RECOMMEND), "Down from the last row is the end bar, beginning with Recommend me");
  assert.deepEqual(leave(at(4)), card);
});
