import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  HEADER_BELL,
  HEADER_LENGTH,
  HEADER_PARTY,
  HEADER_PROFILE,
  HEADER_SEARCH,
  HEADER_WEATHER,
  type Layout,
  step,
} from "../src/nest-nav.ts";

// Cinema (one poster), Shows (two stacked), Anime (3x2 grid), Home (scene buttons), Reminders (2 + Add), Apps (2-wide, 3).
const full: Layout = {
  weather: true,
  ask: 4,
  cols: [
    { count: 1, across: 1 },
    { count: 2, across: 1 },
    { count: 6, across: 3 },
    { count: 3, across: 1 },
    { count: 3, across: 1 },
    { count: 3, across: 2 },
  ],
  results: 0,
  menu: 0,
};
const row = (col: number, i: number) => ({ area: "row" as const, col, i });

test("the header runs profile, weather, then the four buttons", () => {
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Right", full), { area: "header", i: HEADER_WEATHER });
  assert.deepEqual(step({ area: "header", i: HEADER_BELL }, "Right", full), { area: "header", i: HEADER_BELL });
  assert.equal(HEADER_BELL, HEADER_LENGTH - 1);
  // No weather: it is skipped both ways.
  const bare = { ...full, weather: false };
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Right", bare), { area: "header", i: HEADER_PARTY });
  assert.deepEqual(step({ area: "header", i: HEADER_PARTY }, "Left", bare), { area: "header", i: HEADER_PROFILE });
});

test("down from the header: the left side to the assistant, the buttons to the cards", () => {
  assert.deepEqual(step({ area: "header", i: HEADER_PROFILE }, "Down", full), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "header", i: HEADER_SEARCH }, "Down", full), row(0, 0));
  assert.deepEqual(step(row(2, 1), "Up", full), { area: "header", i: HEADER_PARTY });
  assert.deepEqual(step({ area: "ask", i: 2 }, "Up", full), { area: "header", i: HEADER_PROFILE });
});

test("the chips lead right into the first card, and back", () => {
  assert.deepEqual(step({ area: "ask", i: 3 }, "Right", full), row(0, 0));
  assert.deepEqual(step(row(0, 0), "Left", full), { area: "ask", i: 3 });
});

test("across the row: stacks keep their line, grids move cell by cell", () => {
  assert.deepEqual(step(row(0, 0), "Right", full), row(1, 0));
  assert.deepEqual(step(row(1, 1), "Right", full), row(2, 3));
  assert.deepEqual(step(row(2, 3), "Right", full), row(2, 4));
  assert.deepEqual(step(row(2, 5), "Right", full), row(3, 1));
  assert.deepEqual(step(row(3, 1), "Left", full), row(2, 5));
  assert.deepEqual(step(row(2, 3), "Left", full), row(1, 1));
  assert.deepEqual(step(row(5, 2), "Right", full), row(5, 2));
});

test("up and down inside a column", () => {
  assert.deepEqual(step(row(2, 1), "Down", full), row(2, 4));
  assert.deepEqual(step(row(2, 4), "Down", full), row(2, 4));
  assert.deepEqual(step(row(2, 4), "Up", full), row(2, 1));
  assert.deepEqual(step(row(4, 0), "Down", full), row(4, 1));
  assert.deepEqual(step(row(5, 1), "Down", full), row(5, 1));
  assert.deepEqual(step(row(5, 0), "Down", full), row(5, 2));
});

test("empty columns are skipped", () => {
  const gaps: Layout = { ...full, cols: [{ count: 1, across: 1 }, { count: 0, across: 1 }, { count: 6, across: 3 }] };
  assert.deepEqual(step(row(0, 0), "Right", gaps), row(2, 0));
  assert.deepEqual(step(row(2, 0), "Left", gaps), row(0, 0));
  const empty: Layout = { ...full, cols: [{ count: 0, across: 1 }, { count: 2, across: 1 }] };
  assert.deepEqual(step({ area: "ask", i: 3 }, "Right", empty), row(1, 0));
});

test("an answer takes the row's place while shown", () => {
  const shown = { ...full, results: 6 };
  assert.deepEqual(step({ area: "ask", i: 3 }, "Right", shown), { area: "results", i: 0 });
  assert.deepEqual(step({ area: "results", i: 0 }, "Left", shown), { area: "ask", i: 3 });
  assert.deepEqual(step({ area: "results", i: 5 }, "Right", shown), { area: "results", i: 5 });
  assert.deepEqual(step({ area: "results", i: 2 }, "Up", shown), { area: "header", i: HEADER_SEARCH });
  assert.deepEqual(step({ area: "header", i: HEADER_BELL }, "Down", shown), { area: "results", i: 0 });
  assert.deepEqual(clamp({ area: "results", i: 4 }, full), row(0, 0));
});

test("the profile menu runs up and down", () => {
  const menu = { ...full, menu: 4 };
  assert.deepEqual(step({ area: "menu", i: 0 }, "Down", menu), { area: "menu", i: 1 });
  assert.deepEqual(step({ area: "menu", i: 3 }, "Down", menu), { area: "menu", i: 3 });
  assert.deepEqual(step({ area: "menu", i: 0 }, "Up", menu), { area: "menu", i: 0 });
  assert.deepEqual(step({ area: "menu", i: 1 }, "Left", menu), { area: "menu", i: 1 });
});

test("clamp follows a shrinking column and leaves an empty one", () => {
  const fewer: Layout = { ...full, cols: full.cols.map((c, k) => (k === 4 ? { count: 1, across: 1 } : c)) };
  assert.deepEqual(clamp(row(4, 2), fewer), row(4, 0));
  const gone: Layout = { ...full, cols: full.cols.map((c, k) => (k === 4 ? { count: 0, across: 1 } : c)) };
  assert.deepEqual(clamp(row(4, 0), gone), row(5, 0));
  assert.deepEqual(clamp({ area: "header", i: HEADER_WEATHER }, { ...full, weather: false }), { area: "header", i: HEADER_PROFILE });
  assert.deepEqual(clamp({ area: "menu", i: 2 }, full), row(0, 0));
});
