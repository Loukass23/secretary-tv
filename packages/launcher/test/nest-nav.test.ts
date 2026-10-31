import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, type Lengths, step, TOP_BELL, TOP_LENGTH, TOP_LIGHTS, TOP_PARTY, TOP_SEARCH } from "../src/nest-nav.ts";

const full: Lengths = { top: TOP_LENGTH, apps: 8, cards: 4, ask: 0, results: 0, continue: 3, fab: 1, me: 1 };

test("apps lead up to Search and down into the reminders", () => {
  assert.deepEqual(step({ area: "apps", i: 5 }, "Up", full), { area: "top", i: TOP_SEARCH });
  assert.deepEqual(step({ area: "apps", i: 5 }, "Down", full), { area: "cards", i: 0 });
});

test("the last reminder leads to the add button, and back up to the last reminder", () => {
  const fab = step({ area: "cards", i: 3 }, "Down", full);
  assert.deepEqual(fab, { area: "fab", i: 0 });
  assert.deepEqual(step(fab, "Up", full), { area: "cards", i: 3 });
});

test("Continue Watching runs right into the reminders and up to the section pill", () => {
  assert.deepEqual(step({ area: "continue", i: 2 }, "Right", full), { area: "cards", i: 0 });
  assert.deepEqual(step({ area: "continue", i: 1 }, "Up", full), { area: "top", i: 0 });
  assert.deepEqual(step({ area: "cards", i: 2 }, "Left", full), { area: "continue", i: 0 });
});

test("empty areas are skipped", () => {
  const bare: Lengths = { ...full, cards: 0, continue: 0 };
  assert.deepEqual(step({ area: "apps", i: 0 }, "Down", bare), { area: "fab", i: 0 });
  assert.deepEqual(step({ area: "fab", i: 0 }, "Left", bare), { area: "me", i: 0 });
  assert.deepEqual(step({ area: "fab", i: 0 }, "Left", { ...bare, me: 0 }), { area: "fab", i: 0 });
  assert.deepEqual(step({ area: "top", i: 0 }, "Down", { ...bare, apps: 0 }), { area: "top", i: 0 });
});

test("rows clamp at both ends", () => {
  assert.deepEqual(step({ area: "apps", i: 0 }, "Left", full), { area: "apps", i: 0 });
  assert.deepEqual(step({ area: "top", i: TOP_LENGTH - 1 }, "Right", full), { area: "top", i: TOP_LENGTH - 1 });
});

test("clamp follows a shrinking area and leaves an empty one", () => {
  assert.deepEqual(clamp({ area: "cards", i: 3 }, { ...full, cards: 2 }), { area: "cards", i: 1 });
  assert.deepEqual(clamp({ area: "continue", i: 0 }, { ...full, continue: 0 }), { area: "apps", i: 0 });
});

test("the account avatar sits under Continue Watching, next to the add button", () => {
  assert.deepEqual(step({ area: "continue", i: 2 }, "Down", full), { area: "me", i: 0 });
  assert.deepEqual(step({ area: "me", i: 0 }, "Up", full), { area: "continue", i: 0 });
  assert.deepEqual(step({ area: "me", i: 0 }, "Up", { ...full, continue: 0 }), { area: "top", i: 0 });
  assert.deepEqual(step({ area: "me", i: 0 }, "Right", full), { area: "fab", i: 0 });
  assert.deepEqual(step({ area: "continue", i: 0 }, "Down", { ...full, me: 0 }), { area: "continue", i: 0 });
});

const ask: Lengths = { ...full, ask: 4 };

test("Ask Nest sits between the section pill and Continue Watching", () => {
  assert.deepEqual(step({ area: "top", i: 1 }, "Down", ask), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "top", i: TOP_SEARCH }, "Down", ask), { area: "apps", i: 0 });
  assert.deepEqual(step({ area: "ask", i: 2 }, "Up", ask), { area: "top", i: 0 });
  assert.deepEqual(step({ area: "ask", i: 2 }, "Down", ask), { area: "continue", i: 0 });
  assert.deepEqual(step({ area: "continue", i: 1 }, "Up", ask), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "ask", i: 3 }, "Right", ask), { area: "cards", i: 0 });
  assert.deepEqual(step({ area: "ask", i: 0 }, "Left", ask), { area: "ask", i: 0 });
});

test("results take Continue Watching's place while shown", () => {
  const shown: Lengths = { ...ask, results: 6, continue: 0 };
  assert.deepEqual(step({ area: "ask", i: 1 }, "Down", shown), { area: "results", i: 0 });
  assert.deepEqual(step({ area: "results", i: 5 }, "Right", shown), { area: "cards", i: 0 });
  assert.deepEqual(step({ area: "results", i: 3 }, "Up", shown), { area: "ask", i: 0 });
  assert.deepEqual(step({ area: "cards", i: 1 }, "Left", shown), { area: "results", i: 0 });
  assert.deepEqual(step({ area: "me", i: 0 }, "Up", shown), { area: "results", i: 0 });
  assert.deepEqual(clamp({ area: "results", i: 4 }, { ...ask, results: 0 }), { area: "apps", i: 0 });
});

test("the bell is the last button across the top", () => {
  assert.equal(TOP_BELL, TOP_LENGTH - 1);
  assert.deepEqual(step({ area: "top", i: TOP_LIGHTS }, "Right", ask), { area: "top", i: TOP_BELL });
});

test("the top buttons (Watch together to the bell) lead down into the right column, the pill into the left", () => {
  const both: Lengths = { ...full, ask: 1 };
  assert.deepEqual(step({ area: "top", i: TOP_PARTY }, "Down", both), { area: "apps", i: 0 });
  assert.deepEqual(step({ area: "top", i: TOP_BELL }, "Down", both), { area: "apps", i: 0 });
  assert.deepEqual(step({ area: "top", i: 0 }, "Down", both), { area: "ask", i: 0 });
});
