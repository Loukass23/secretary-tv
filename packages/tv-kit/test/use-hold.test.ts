import { test } from "node:test";
import assert from "node:assert/strict";
import { createOkHold } from "../src/use-hold.ts";

/** Timers run by hand: `fire()` runs the pending one. */
function fakeTimers() {
  let pending: (() => void) | null = null;
  return {
    set: (fn: () => void) => ((pending = fn), 1),
    clear: () => void (pending = null),
    fire: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    get pending() {
      return pending !== null;
    },
  };
}

test("a short OK runs on the keyup, a held one when the timer fires", () => {
  const t = fakeTimers();
  const log: string[] = [];
  const h = createOkHold(() => log.push("short"), () => log.push("long"), 600, t);
  h.down();
  assert.ok(h.holding());
  h.up();
  assert.deepEqual(log, ["short"]);
  assert.equal(t.pending, false);
  assert.equal(h.holding(), false);

  h.down();
  t.fire();
  assert.deepEqual(log, ["short", "long"]);
  // The held press is still down until its keyup: its repeats are not a new press.
  assert.ok(h.holding());
  h.down();
  assert.equal(t.pending, false);
  h.up();
  assert.deepEqual(log, ["short", "long"]);
  assert.equal(h.holding(), false);
});

test("cancel forgets a press", () => {
  const t = fakeTimers();
  const log: string[] = [];
  const h = createOkHold(() => log.push("short"), () => log.push("long"), 600, t);
  h.down();
  h.cancel();
  h.up();
  assert.deepEqual(log, []);
  assert.equal(h.holding(), false);
});
