import { test } from "node:test";
import assert from "node:assert/strict";
import { lightCount, lightsOnLabel } from "../src/light-count.ts";

const d = (id: string, kind: string, on?: boolean) => ({ id, kind: kind as "light", on });

// The review's home: five lights in rooms, one on, plus devices that switch but are not lights.
const HOME = [
  d("bed", "light", false),
  d("desk", "light", true),
  d("neon", "light", false),
  d("entry", "light", false),
  d("kitchen", "light", false),
  d("amp", "audio", true),
  d("tv", "tv", true),
  d("sensor", "lightSensor"),
  d("phone", "phone"),
];

test("only lights count, whatever else is on", () => {
  assert.deepEqual(lightCount(HOME), { on: 1, total: 5 });
});

test("a light with no reported state is off", () => {
  assert.deepEqual(lightCount([d("a", "light"), d("b", "light", true)]), { on: 1, total: 2 });
});

test("switches not yet confirmed by a poll count as switched", () => {
  assert.deepEqual(lightCount(HOME, { bed: true, desk: false }), { on: 1, total: 5 });
  assert.deepEqual(lightCount(HOME, { bed: true, neon: true }), { on: 3, total: 5 });
  // A pending switch on something that is not a light changes nothing.
  assert.deepEqual(lightCount(HOME, { amp: false, tv: false }), { on: 1, total: 5 });
});

test("the Home card's line and the panel read the same count", () => {
  assert.equal(lightsOnLabel(lightCount(HOME)), "1 light on");
  assert.equal(lightsOnLabel(lightCount(HOME, { bed: true, neon: true })), "3 lights on");
  assert.equal(lightsOnLabel(lightCount([d("a", "light", false)])), "No lights on");
});
