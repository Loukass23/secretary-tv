import { test } from "node:test";
import assert from "node:assert/strict";
import { atEnd, CARD_ACTIONS, cardAt, countdownLabel, countdownSec, durationWatch, prefetchAt, STABLE_MS, stepCard } from "../src/lib/upnext.ts";

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

test("upnext: the end of an episode plays the next only when there is one, it was not cancelled and the countdown is on", () => {
  assert.equal(atEnd({ hasNext: true, cancelled: false, countdown: "5" }), "next");
  assert.equal(atEnd({ hasNext: true, cancelled: true, countdown: "5" }), "exit", "Cancel on the card");
  assert.equal(atEnd({ hasNext: true, cancelled: false, countdown: "off" }), "exit", "Off means no autoplay");
  assert.equal(atEnd({ hasNext: false, cancelled: false, countdown: "10" }), "exit");
  assert.equal(countdownLabel("off"), "Off (no autoplay)");
});

test("upnext: the card's keys move between Play now and Cancel; OK runs the focused one, Back cancels", () => {
  assert.deepEqual(CARD_ACTIONS, ["play", "cancel"]);
  assert.deepEqual(stepCard(0, "Right"), { at: 1 });
  assert.deepEqual(stepCard(1, "Right"), { at: 1 });
  assert.deepEqual(stepCard(1, "Left"), { at: 0 });
  assert.deepEqual(stepCard(0, "Enter"), { run: "play" });
  assert.deepEqual(stepCard(1, "Enter"), { run: "cancel" });
  assert.deepEqual(stepCard(0, "Back"), { run: "cancel" });
  assert.equal(stepCard(0, "PlayPause"), null, "other keys go to the player");
});
