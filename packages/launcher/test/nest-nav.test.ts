import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  enter,
  HEADER_BELL,
  HEADER_SETTINGS,
  HEADER_LENGTH,
  HEADER_PARTY,
  HEADER_PICTURE,
  HEADER_PROFILE,
  HEADER_SEARCH,
  HEADER_SOUND,
  headerItems,
  END_ALL,
  END_RECOMMEND,
  END_TOP,
  LAUNCH,
  type Column,
  type Layout,
  leave,
  rowAt,
  step,
} from "../src/nest-nav.ts";

// Cinema (one poster), Shows (two stacked), Anime (3x2 grid): app cards with a Launch button.
// Then Home (scene buttons), Reminders (2 + Add) and Apps (2-wide, 3) without one.
const full: Layout = {
  ask: 1,
  cols: [
    { count: 1, across: 1, launch: true },
    { count: 2, across: 1, launch: true },
    { count: 6, across: 3, launch: true },
    { count: 3, across: 1 },
    { count: 3, across: 1 },
    { count: 3, across: 2 },
  ],
  menu: 0,
};
const card = (col: number) => ({ area: "row" as const, col, i: 0 });
const inside = (col: number, i: number) => ({ area: "row" as const, col, i, inside: true });

test("the header runs profile, then the six buttons", () => {
  assert.deepEqual(step({ area: "header", i: HEADER_PICTURE }, "Right", full), { area: "header", i: HEADER_SOUND });
  assert.deepEqual(step({ area: "header", i: HEADER_SOUND }, "Right", full), { area: "header", i: HEADER_SETTINGS });
  assert.deepEqual(step({ area: "header", i: HEADER_SETTINGS }, "Right", full), { area: "header", i: HEADER_BELL });
  assert.deepEqual(step({ area: "header", i: HEADER_SOUND }, "Left", full), { area: "header", i: HEADER_PICTURE });
  assert.deepEqual(step({ area: "header", i: HEADER_PICTURE }, "Left", full), { area: "header", i: HEADER_PICTURE - 1 });
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Right", full), { area: "header", i: HEADER_PARTY });
  assert.deepEqual(step({ area: "header", i: HEADER_BELL }, "Right", full), { area: "header", i: HEADER_BELL });
  assert.equal(HEADER_BELL, HEADER_LENGTH - 1);
  assert.deepEqual(step({ area: "header", i: HEADER_PARTY }, "Left", full), { area: "header", i: HEADER_PROFILE });
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Left", full), { area: "header", i: HEADER_PROFILE });
});

test("down from the header goes to the first card (the Assistant), up from the assistant under the cards goes back to it", () => {
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Down", full), card(0));
  assert.deepEqual(step({ area: "header", i: HEADER_SEARCH }, "Down", full), card(0));
  assert.deepEqual(step(card(2), "Up", full), { area: "header", i: HEADER_PARTY });
  assert.deepEqual(step({ area: "ask", i: 0 }, "Up", full), card(0));
});

test("left and right move card by card, whatever is inside them", () => {
  assert.deepEqual(step({ area: "ask", i: 0 }, "Right", full), { area: "ask", i: 0 });
  assert.deepEqual(step(card(0), "Right", full), card(1));
  assert.deepEqual(step(card(2), "Right", full), card(3));
  assert.deepEqual(step(card(5), "Right", full), card(5));
  assert.deepEqual(step(card(3), "Left", full), card(2));
  assert.deepEqual(step(card(0), "Left", full), card(0));
  assert.deepEqual(step(card(1), "Down", full), { area: "ask", i: 0 });
});

test("OK goes inside: the Launch button first on app cards, the first item on the others", () => {
  assert.deepEqual(enter(card(0), full), inside(0, LAUNCH));
  assert.deepEqual(enter(card(4), full), inside(4, 0));
  assert.deepEqual(step(inside(0, LAUNCH), "Down", full), inside(0, 0));
  assert.deepEqual(step(inside(0, 0), "Up", full), inside(0, LAUNCH));
  assert.deepEqual(step(inside(0, LAUNCH), "Up", full), card(0));
  assert.deepEqual(step(inside(4, 0), "Up", full), card(4));
  assert.deepEqual(leave(inside(2, 4)), card(2));
  assert.deepEqual(leave(card(2)), card(2));
});

test("inside a card, the arrows move within it, and past a side edge to the card beside it", () => {
  assert.deepEqual(step(inside(2, 1), "Down", full), inside(2, 4));
  assert.deepEqual(step(inside(2, 4), "Down", full), { area: "ask", i: 0 });
  assert.deepEqual(step(inside(2, 4), "Up", full), inside(2, 1));
  assert.deepEqual(step(inside(2, 1), "Up", full), inside(2, LAUNCH));
  assert.deepEqual(step(inside(2, 4), "Right", full), inside(2, 5));
  assert.deepEqual(step(inside(2, 2), "Right", full), card(3), "the right edge goes on to the next card");
  assert.deepEqual(step(inside(2, 0), "Left", full), card(1), "the left edge goes back to the card before");
  assert.deepEqual(step(inside(5, 0), "Down", full), inside(5, 2));
  assert.deepEqual(step(inside(5, 1), "Right", full), inside(5, 1), "the last card keeps its right edge");
  assert.deepEqual(step(inside(0, LAUNCH), "Right", full), card(1));
  assert.deepEqual(step(inside(0, LAUNCH), "Left", full), inside(0, LAUNCH), "the first card keeps its left edge");
});

test("the bell lands inside Reminders, and Left leaves it without Back", () => {
  // Reminders is card 4, a stack of three: Left goes to the card before, Right to the one after.
  assert.deepEqual(step(inside(4, 1), "Left", full), card(3));
  assert.deepEqual(step(inside(4, 1), "Right", full), card(5));
  assert.deepEqual(step(inside(4, 1), "Down", full), inside(4, 2));
});

test("an opened card that holds the remote keeps its sides", () => {
  const held: Layout = { ...full, cols: [{ count: 1, across: 1 }, { count: 1, across: 1, hold: true }, { count: 1, across: 1 }] };
  assert.deepEqual(step(inside(1, 0), "Left", held), inside(1, 0));
  assert.deepEqual(step(inside(1, 0), "Right", held), inside(1, 0));
});

test("empty cards are skipped; an app card with only its Launch button still counts", () => {
  const gaps: Layout = { ...full, cols: [{ count: 1, across: 1 }, { count: 0, across: 1 }, { count: 0, across: 3, launch: true }] };
  assert.deepEqual(step(card(0), "Right", gaps), card(2));
  assert.deepEqual(step(card(2), "Left", gaps), card(0));
  assert.deepEqual(enter(card(2), gaps), inside(2, LAUNCH));
  assert.deepEqual(step(inside(2, LAUNCH), "Down", gaps), { area: "ask", i: 0 });
});

test("the full chat keeps every arrow to itself and survives a clamp", () => {
  const chat = { area: "chat" as const, i: 0 };
  for (const key of ["Left", "Right", "Up", "Down"]) assert.deepEqual(step(chat, key, full), chat);
  assert.deepEqual(clamp(chat, full), chat);
});

test("the assistant under the cards is reached by Down from a card and leaves by Up", () => {
  assert.deepEqual(step(card(3), "Down", full), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "ask", i: 0 }, "Down", full), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "ask", i: 0 }, "Up", { ...full, cols: [] }), { area: "header", i: HEADER_PROFILE });
});

test("the profile menu runs up and down", () => {
  const menu = { ...full, menu: 4 };
  assert.deepEqual(step({ area: "menu", i: 0 }, "Down", menu), { area: "menu", i: 1 });
  assert.deepEqual(step({ area: "menu", i: 3 }, "Down", menu), { area: "menu", i: 3 });
  assert.deepEqual(step({ area: "menu", i: 0 }, "Up", menu), { area: "menu", i: 0 });
});

test("clamp follows a shrinking card and leaves an empty one", () => {
  const fewer: Layout = { ...full, cols: full.cols.map((c, k) => (k === 4 ? { count: 1, across: 1 } : c)) };
  assert.deepEqual(clamp(inside(4, 2), fewer), inside(4, 0));
  assert.deepEqual(clamp(card(4), fewer), card(4));
  const gone: Layout = { ...full, cols: full.cols.map((c, k) => (k === 4 ? { count: 0, across: 1 } : c)) };
  assert.deepEqual(clamp(inside(4, 0), gone), card(5));
  const launchOnly: Layout = { ...full, cols: full.cols.map((c, k) => (k === 1 ? { count: 0, across: 1, launch: true } : c)) };
  assert.deepEqual(clamp(inside(1, 1), launchOnly), inside(1, LAUNCH));
  assert.deepEqual(clamp({ area: "menu", i: 2 }, full), card(0));
});

test("an opened card of several rows: Down and Up move between rows, the sides stay in a row", () => {
  // Cinema opened: 8 picks and Open (9), then My List (5) and a genre (7).
  const cols: Column[] = [{ count: 21, across: 9, rows: [9, 5, 7] }];
  const len: Layout = { ask: 1, cols, menu: 0 };
  assert.deepEqual(rowAt([9, 5, 7], 0), { r: 0, x: 0, start: 0 });
  assert.deepEqual(rowAt([9, 5, 7], 9), { r: 1, x: 0, start: 9 });
  assert.deepEqual(rowAt([9, 5, 7], 20), { r: 2, x: 6, start: 14 });
  assert.deepEqual(step(inside(0, 3), "Down", len), inside(0, 12), "same place in the next row");
  assert.deepEqual(step(inside(0, 8), "Down", len), inside(0, 13), "clamped to the shorter row");
  assert.deepEqual(step(inside(0, 12), "Down", len), inside(0, 17));
  assert.deepEqual(step(inside(0, 19), "Down", len), inside(0, END_RECOMMEND), "Down from the last row reaches Recommend me, not the assistant");
  assert.deepEqual(step(inside(0, END_RECOMMEND), "Down", len), inside(0, END_RECOMMEND), "the end bar is the end");
  assert.deepEqual(step(inside(0, END_RECOMMEND), "Right", len), inside(0, END_ALL));
  assert.deepEqual(step(inside(0, END_ALL), "Right", len), inside(0, END_TOP), "Back to top is last");
  assert.deepEqual(step(inside(0, END_TOP), "Right", len), inside(0, END_TOP));
  assert.deepEqual(step(inside(0, END_TOP), "Left", len), inside(0, END_ALL));
  assert.deepEqual(step(inside(0, END_ALL), "Left", len), inside(0, END_RECOMMEND));
  assert.deepEqual(step(inside(0, END_RECOMMEND), "Left", len), inside(0, END_RECOMMEND), "the opened card keeps its sides");
  assert.deepEqual(step(inside(0, END_ALL), "Up", len), inside(0, 14), "Up goes back to the last row");
  assert.deepEqual(clamp(inside(0, END_TOP), len), inside(0, END_TOP), "the end bar survives a layout change");
  assert.deepEqual(step(inside(0, 19), "Up", len), inside(0, 13), "clamped to the shorter row above");
  assert.deepEqual(step(inside(0, 12), "Up", len), inside(0, 3));
  assert.deepEqual(step(inside(0, 3), "Up", len), card(0), "Up from the picks folds the card");
  assert.deepEqual(step(inside(0, 12), "Right", len), inside(0, 13));
  assert.deepEqual(step(inside(0, 13), "Right", len), inside(0, 13), "the end of a row stays");
  assert.deepEqual(step(inside(0, 13), "Left", len), inside(0, 12));
  assert.deepEqual(step(inside(0, 9), "Left", len), inside(0, 9), "the sides stay in their row");
});

test("an opened weather card keeps the remote: Down stays, Up folds it", () => {
  const len: Layout = { ask: 1, cols: [{ count: 1, across: 1, hold: true }], menu: 0 };
  assert.deepEqual(step(inside(0, 0), "Down", len), inside(0, 0));
  assert.deepEqual(step(inside(0, 0), "Up", len), card(0));
  assert.deepEqual(step(inside(0, 0), "Down", { ...len, cols: [{ count: 1, across: 1 }] }), { area: "ask", i: 0 }, "a folded card still goes to the assistant");
});

test("with Watch together hidden, the header skips it and Up from the row lands on Search", () => {
  const items = headerItems(false);
  assert.deepEqual(items, [HEADER_PROFILE, HEADER_SEARCH, 3, HEADER_PICTURE, HEADER_SOUND, HEADER_SETTINGS, HEADER_BELL]);
  const len: Layout = { ...full, header: items };
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Right", len), { area: "header", i: HEADER_SEARCH });
  assert.deepEqual(step({ area: "header", i: HEADER_SEARCH }, "Left", len), { area: "header", i: HEADER_PROFILE });
  assert.deepEqual(step({ area: "header", i: HEADER_BELL }, "Right", len), { area: "header", i: HEADER_BELL });
  assert.deepEqual(step(card(2), "Up", len), { area: "header", i: HEADER_SEARCH });
  assert.deepEqual(headerItems(true).length, HEADER_LENGTH);
});

test("the mood strip: Left and Right along its stops, and closed it gives the lights button back", async () => {
  const { HEADER_LIGHTS } = await import("../src/nest-nav.ts");
  const open: Layout = { ...full, moods: 5 };
  const at = { area: "moods" as const, i: 0 };
  assert.deepEqual(step(at, "Left", open), at);
  assert.deepEqual(step(at, "Right", open), { area: "moods", i: 1 });
  assert.deepEqual(step({ area: "moods", i: 4 }, "Right", open), { area: "moods", i: 4 }, "\"more\" is the last stop");
  // Up, Down and Back close it (app.tsx); the step leaves them alone.
  assert.deepEqual(step(at, "Down", open), at);
  assert.deepEqual(clamp({ area: "moods", i: 7 }, open), { area: "moods", i: 4 });
  assert.deepEqual(clamp({ area: "moods", i: 2 }, full), { area: "header", i: HEADER_LIGHTS });
});
