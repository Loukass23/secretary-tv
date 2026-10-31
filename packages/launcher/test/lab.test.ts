import { test } from "node:test";
import assert from "node:assert/strict";
import { DAYS, EVENTS, step } from "../src/lab/nav.ts";

test("cards scroll down and clamp at the last one", () => {
  let at = { area: "cards" as const, i: 0 } as Parameters<typeof step>[0];
  for (let n = 0; n < EVENTS.length + 3; n++) at = step(at, "Down");
  assert.deepEqual(at, { area: "cards", i: EVENTS.length - 1 });
});

test("up from the first card reaches the date strip, then the icon buttons", () => {
  const dates = step({ area: "cards", i: 0 }, "Up");
  assert.deepEqual(dates, { area: "dates", i: 3 });
  assert.deepEqual(step(dates, "Up"), { area: "top", i: 4 });
});

test("weather and tiles lead right into the cards", () => {
  assert.deepEqual(step({ area: "weather", i: 6 }, "Right"), { area: "cards", i: 0 });
  assert.deepEqual(step({ area: "tiles", i: 1 }, "Right"), { area: "cards", i: 0 });
  assert.deepEqual(step({ area: "cards", i: 4 }, "Left"), { area: "weather", i: 3 });
});

test("the date strip clamps at both ends", () => {
  assert.deepEqual(step({ area: "dates", i: 0 }, "Left"), { area: "dates", i: 0 });
  assert.deepEqual(step({ area: "dates", i: DAYS.length - 1 }, "Right"), { area: "dates", i: DAYS.length - 1 });
});
