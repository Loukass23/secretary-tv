import { test } from "node:test";
import assert from "node:assert/strict";
import { clampLights, type LightsFocus, type LightsMemo, stepLights } from "../src/lights-nav.ts";

// Six effects; on the right, seven routines over three lines of lights (two, two, one).
const FX = 6;
const GRID = [7, 2, 2, 1];
const fresh = (): LightsMemo => ({ fx: 0, grid: { row: 0, col: 0 } });

test("lights nav: Up and Down go along the effects, Up from the first goes into the header", () => {
  let at: LightsFocus | "header" = { area: "fx", i: 0 };
  assert.equal(stepLights(at, "Up", FX, GRID, fresh()), "header");
  at = stepLights(at, "Down", FX, GRID, fresh());
  assert.deepEqual(at, { area: "fx", i: 1 });
  const last: LightsFocus = { area: "fx", i: 5 };
  assert.equal(stepLights(last, "Down", FX, GRID, fresh()), last);
  assert.equal(stepLights(last, "Left", FX, GRID, fresh()), last);
});

test("lights nav: Right leaves the effects for where the right side was left, Left at a row's start comes back", () => {
  const memo: LightsMemo = { fx: 3, grid: { row: 2, col: 1 } };
  assert.deepEqual(stepLights({ area: "fx", i: 3 }, "Right", FX, GRID, memo), { area: "grid", row: 2, col: 1 });
  assert.deepEqual(stepLights({ area: "grid", row: 2, col: 0 }, "Left", FX, GRID, memo), { area: "fx", i: 3 });
  // Inside a row, Left is the row's own.
  assert.deepEqual(stepLights({ area: "grid", row: 0, col: 4 }, "Left", FX, GRID, memo), { area: "grid", row: 0, col: 3 });
  // With nothing on the right (no routines, no lights yet), Right stays.
  const fx: LightsFocus = { area: "fx", i: 2 };
  assert.equal(stepLights(fx, "Right", FX, [], memo), fx);
});

test("lights nav: on the right, Up from the routines goes into the header, Down through the lines keeps the column in range", () => {
  assert.equal(stepLights({ area: "grid", row: 0, col: 5 }, "Up", FX, GRID, fresh()), "header");
  assert.deepEqual(stepLights({ area: "grid", row: 0, col: 5 }, "Down", FX, GRID, fresh()), { area: "grid", row: 1, col: 1 });
  assert.deepEqual(stepLights({ area: "grid", row: 2, col: 1 }, "Down", FX, GRID, fresh()), { area: "grid", row: 3, col: 0 });
  const end: LightsFocus = { area: "grid", row: 3, col: 0 };
  assert.equal(stepLights(end, "Down", FX, GRID, fresh()), end);
});

test("lights nav: a grid that shrank keeps focus on a place that is still there", () => {
  assert.deepEqual(clampLights({ area: "grid", row: 3, col: 0 }, FX, [7, 2]), { area: "grid", row: 1, col: 0 });
  assert.deepEqual(clampLights({ area: "grid", row: 0, col: 6 }, FX, [3]), { area: "grid", row: 0, col: 2 });
  assert.deepEqual(clampLights({ area: "grid", row: 1, col: 1 }, FX, []), { area: "fx", i: 0 });
  assert.deepEqual(clampLights({ area: "fx", i: 9 }, FX, GRID), { area: "fx", i: 5 });
});
