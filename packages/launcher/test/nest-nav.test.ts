import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  enter,
  HEADER_BELL,
  HEADER_LENGTH,
  HEADER_PARTY,
  HEADER_PROFILE,
  HEADER_SEARCH,
  HEADER_WEATHER,
  LAUNCH,
  type Layout,
  leave,
  step,
} from "../src/nest-nav.ts";

// Cinema (one poster), Shows (two stacked), Anime (3x2 grid): app cards with a Launch button.
// Then Home (scene buttons), Reminders (2 + Add) and Apps (2-wide, 3) without one.
const full: Layout = {
  weather: true,
  ask: 1,
  cols: [
    { count: 1, across: 1, launch: true },
    { count: 2, across: 1, launch: true },
    { count: 6, across: 3, launch: true },
    { count: 3, across: 1 },
    { count: 3, across: 1 },
    { count: 3, across: 2 },
  ],
  results: 0,
  menu: 0,
};
const card = (col: number) => ({ area: "row" as const, col, i: 0 });
const inside = (col: number, i: number) => ({ area: "row" as const, col, i, inside: true });

test("the header runs profile, weather, then the four buttons", () => {
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Right", full), { area: "header", i: HEADER_WEATHER });
  assert.deepEqual(step({ area: "header", i: HEADER_BELL }, "Right", full), { area: "header", i: HEADER_BELL });
  assert.equal(HEADER_BELL, HEADER_LENGTH - 1);
  const bare = { ...full, weather: false };
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Right", bare), { area: "header", i: HEADER_PARTY });
  assert.deepEqual(step({ area: "header", i: HEADER_PARTY }, "Left", bare), { area: "header", i: HEADER_PROFILE });
});

test("down from the header: the left side to the assistant, the buttons to the cards", () => {
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Down", full), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "header", i: HEADER_SEARCH }, "Down", full), card(0));
  assert.deepEqual(step(card(2), "Up", full), { area: "header", i: HEADER_PARTY });
  assert.deepEqual(step({ area: "ask", i: 0 }, "Up", full), { area: "header", i: HEADER_PROFILE });
});

test("left and right move card by card, whatever is inside them", () => {
  assert.deepEqual(step({ area: "ask", i: 0 }, "Right", full), card(0));
  assert.deepEqual(step(card(0), "Right", full), card(1));
  assert.deepEqual(step(card(2), "Right", full), card(3));
  assert.deepEqual(step(card(5), "Right", full), card(5));
  assert.deepEqual(step(card(3), "Left", full), card(2));
  assert.deepEqual(step(card(0), "Left", full), { area: "ask", i: 0 });
  assert.deepEqual(step(card(1), "Down", full), card(1));
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

test("inside a card, the arrows stay in it", () => {
  assert.deepEqual(step(inside(2, 1), "Down", full), inside(2, 4));
  assert.deepEqual(step(inside(2, 4), "Down", full), inside(2, 4));
  assert.deepEqual(step(inside(2, 4), "Up", full), inside(2, 1));
  assert.deepEqual(step(inside(2, 1), "Up", full), inside(2, LAUNCH));
  assert.deepEqual(step(inside(2, 2), "Right", full), inside(2, 2));
  assert.deepEqual(step(inside(2, 0), "Left", full), inside(2, 0));
  assert.deepEqual(step(inside(2, 4), "Right", full), inside(2, 5));
  assert.deepEqual(step(inside(5, 0), "Down", full), inside(5, 2));
  assert.deepEqual(step(inside(0, LAUNCH), "Right", full), inside(0, LAUNCH));
});

test("empty cards are skipped; an app card with only its Launch button still counts", () => {
  const gaps: Layout = { ...full, cols: [{ count: 1, across: 1 }, { count: 0, across: 1 }, { count: 0, across: 3, launch: true }] };
  assert.deepEqual(step(card(0), "Right", gaps), card(2));
  assert.deepEqual(step(card(2), "Left", gaps), card(0));
  assert.deepEqual(enter(card(2), gaps), inside(2, LAUNCH));
  assert.deepEqual(step(inside(2, LAUNCH), "Down", gaps), inside(2, LAUNCH));
});

test("an answer takes the row's place while shown", () => {
  const shown = { ...full, results: 6 };
  assert.deepEqual(step({ area: "ask", i: 0 }, "Right", shown), { area: "results", i: 0 });
  assert.deepEqual(step({ area: "results", i: 0 }, "Left", shown), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "results", i: 5 }, "Right", shown), { area: "results", i: 5 });
  assert.deepEqual(step({ area: "results", i: 2 }, "Up", shown), { area: "header", i: HEADER_SEARCH });
  assert.deepEqual(step({ area: "header", i: HEADER_BELL }, "Down", shown), { area: "results", i: 0 });
  assert.deepEqual(clamp({ area: "results", i: 4 }, full), card(0));
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
  assert.deepEqual(clamp({ area: "header", i: HEADER_WEATHER }, { ...full, weather: false }), { area: "header", i: HEADER_PROFILE });
  assert.deepEqual(clamp({ area: "menu", i: 2 }, full), card(0));
});
