import { test } from "node:test";
import assert from "node:assert/strict";
import { effective, LIGHT_FX_DEFAULT, parseLightFx } from "../src/light-fx.ts";

test("defaults: effects on, side-light sync off", () => {
  assert.deepEqual(parseLightFx(null), LIGHT_FX_DEFAULT);
  assert.equal(LIGHT_FX_DEFAULT.enabled, true);
  assert.equal(LIGHT_FX_DEFAULT.sync, false);
});

test("stored values are read and wrong types fall back per field", () => {
  assert.deepEqual(parseLightFx({ enabled: true, mood: false, sync: true, splash: "no" }), { enabled: true, mood: false, sync: true, splash: true, dance: true });
  assert.deepEqual(parseLightFx("junk"), LIGHT_FX_DEFAULT);
});

test("the master switch turns every effect off", () => {
  const off = effective({ enabled: false, splash: true, mood: true, sync: true, dance: true });
  assert.deepEqual(off, { enabled: false, splash: false, mood: false, sync: false, dance: false });
  const on = { enabled: true, splash: true, mood: false, sync: true, dance: false };
  assert.deepEqual(effective(on), on);
});
