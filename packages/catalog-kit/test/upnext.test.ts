import { test } from "node:test";
import assert from "node:assert/strict";
import { cardAt, countdownSec, durationWatch, prefetchAt, STABLE_MS } from "../src/lib/upnext.ts";

test("card time: credits when known, 45 s before the end, 15 s for short episodes; none for films or a moving duration", () => {
  const ep = { durSec: 2700, stableMs: STABLE_MS, isMovie: false };
  assert.equal(cardAt(ep), 2655);
  assert.equal(cardAt({ ...ep, creditsSec: 2580 }), 2580);
  assert.equal(cardAt({ ...ep, creditsSec: 2800 }), 2655, "a marker past the end is ignored");
  assert.equal(cardAt({ ...ep, durSec: 420 }), 405);
  assert.equal(cardAt({ ...ep, isMovie: true }), null);
  assert.equal(cardAt({ ...ep, stableMs: 1000 }), null);
  assert.equal(cardAt({ ...ep, durSec: 0 }), null);
  assert.equal(prefetchAt(2655), 2565);
  assert.equal(prefetchAt(30), 0);
  assert.equal(countdownSec("off"), null);
  assert.equal(countdownSec("10"), 10);
});

test("duration watch: time since the duration last changed", () => {
  let t = 0;
  const watch = durationWatch(() => t);
  assert.equal(watch(100), 0);
  t = 2000;
  assert.equal(watch(100.4), 2000, "rounding noise is no change");
  t = 2500;
  assert.equal(watch(140), 0);
  t = 6000;
  assert.equal(watch(140), 3500);
});
