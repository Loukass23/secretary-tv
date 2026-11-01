import { test } from "node:test";
import assert from "node:assert/strict";
import { addRecent, current, cycleRepeat, inOrder, jumpTo, next, prev, shuffled, startQueue, toggleShuffle } from "../src/queue.ts";
import type { Track } from "../src/youtube.ts";

const t = (id: string): Track => ({ id, title: id, artist: "", thumb: "", cover: "", durSec: 100 });
const five = ["a", "b", "c", "d", "e"].map(t);
const ids = (xs: readonly Track[]) => xs.map((x) => x.id).join("");

/** A seeded generator, so shuffles are repeatable. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test("shuffled is a permutation with the chosen first", () => {
  for (let s = 1; s < 20; s++) {
    const order = shuffled(7, 3, seeded(s));
    assert.equal(order[0], 3);
    assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5, 6]);
  }
  assert.deepEqual(shuffled(0, 0, Math.random), []);
});

test("a queue starts on the chosen track", () => {
  const q = startQueue(five, 2);
  assert.equal(current(q)?.id, "c");
  assert.equal(ids(inOrder(q)), "abcde");
  const s = startQueue(five, 2, { shuffle: true }, seeded(4));
  assert.equal(current(s)?.id, "c");
  assert.equal(s.pos, 0);
  assert.equal(inOrder(s).length, 5);
});

test("next moves on and stops at the end without repeat", () => {
  let q = startQueue(five, 3);
  q = next(q, true)!;
  assert.equal(current(q)?.id, "e");
  assert.equal(next(q, true), null);
  assert.equal(next(q, false), null);
});

test("repeat all wraps; repeat one replays only when the track ends", () => {
  const all = { ...startQueue(five, 4), repeat: "all" as const };
  assert.equal(current(next(all, true)!)?.id, "a");
  const one = { ...startQueue(five, 1), repeat: "one" as const };
  assert.equal(next(one, true), one);
  assert.equal(current(next(one, false)!)?.id, "c");
});

test("previous restarts after 3 s, otherwise goes back", () => {
  const q = startQueue(five, 2);
  assert.deepEqual(prev(q, 10), { queue: q, restart: true });
  const back = prev(q, 1);
  assert.equal(back.restart, false);
  assert.equal(current(back.queue)?.id, "b");
  const first = startQueue(five, 0);
  assert.equal(prev(first, 0).restart, true);
  assert.equal(current(prev({ ...first, repeat: "all" }, 0).queue)?.id, "e");
});

test("shuffle keeps the playing track, and turning it off returns to list order on it", () => {
  const q = startQueue(five, 3);
  const on = toggleShuffle(q, seeded(9));
  assert.equal(on.shuffle, true);
  assert.equal(current(on)?.id, "d");
  assert.equal(on.order[0], 3);
  const moved = next(on, false)!;
  const off = toggleShuffle(moved);
  assert.equal(off.shuffle, false);
  assert.equal(ids(inOrder(off)), "abcde");
  assert.equal(current(off)?.id, current(moved)?.id);
});

test("repeat cycles off, all, one", () => {
  assert.equal(cycleRepeat("off"), "all");
  assert.equal(cycleRepeat("all"), "one");
  assert.equal(cycleRepeat("one"), "off");
});

test("jumping picks a track in play order", () => {
  const q = jumpTo(startQueue(five, 0), 3);
  assert.equal(current(q)?.id, "d");
  assert.equal(current(jumpTo(q, 99))?.id, "e");
});

test("an empty queue plays nothing", () => {
  const q = startQueue([], 0);
  assert.equal(current(q), undefined);
  assert.equal(next(q, false), null);
});

test("recent plays: newest first, once each, capped", () => {
  let r: Track[] = [];
  for (const x of ["a", "b", "a", "c"]) r = addRecent(r, t(x), 3);
  assert.equal(ids(r), "cab");
  r = addRecent(r, t("d"), 3);
  assert.equal(ids(r), "dca");
});
