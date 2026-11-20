import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOrder, canMove, keepOrder, loadOrder, moveKey, ORDER_KEY, saveOrder } from "../src/card-order.ts";

const row = ["assistant", "weather", "calendar", "cinema", "home", "add"].map((key) => ({ key }));
const keys = (r: readonly { key: string }[]) => r.map((c) => c.key);

test("the Assistant and Add to home cannot move", () => {
  assert.equal(canMove("assistant"), false);
  assert.equal(canMove("add"), false);
  assert.equal(canMove("cinema"), true);
});

test("no saved order leaves the row alone", () => {
  assert.deepEqual(keys(applyOrder(row, [])), keys(row));
});

test("a saved order rearranges the movable cards and keeps the ends", () => {
  const out = applyOrder(row, ["home", "cinema", "calendar", "weather"]);
  assert.deepEqual(keys(out), ["assistant", "home", "cinema", "calendar", "weather", "add"]);
});

test("a new card keeps its place and removed cards in the order are ignored", () => {
  const out = applyOrder(row, ["home", "gone", "weather"]);
  // weather and home swap slots; calendar and cinema are unknown and stay
  assert.deepEqual(keys(out), ["assistant", "home", "calendar", "cinema", "weather", "add"]);
});

test("moveKey swaps with a neighbour and stops at the ends", () => {
  const k = keys(row);
  assert.deepEqual(moveKey(k, "cinema", -1), ["assistant", "weather", "cinema", "calendar", "home", "add"]);
  assert.deepEqual(moveKey(k, "home", 1), k);
  assert.deepEqual(moveKey(k, "weather", -1), k);
  assert.deepEqual(moveKey(k, "assistant", 1), k);
});

test("keepOrder appends the saved keys of removed cards", () => {
  assert.deepEqual(keepOrder(["assistant", "home", "weather", "add"], ["apps", "weather"]), ["home", "weather", "apps"]);
});

test("the order round-trips through storage and bad data reads as empty", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveOrder(store, ["home", "weather"]);
  assert.deepEqual(loadOrder(store), ["home", "weather"]);
  mem.set(ORDER_KEY, "{oops");
  assert.deepEqual(loadOrder(store), []);
  mem.set(ORDER_KEY, JSON.stringify(["a", 3, null]));
  assert.deepEqual(loadOrder(store), ["a"]);
});
