import { test } from "node:test";
import assert from "node:assert/strict";
import { canRemove, ELEMENTS, HIDDEN_KEY, labelOf, loadHidden, removed, saveHidden } from "../src/home-cards.ts";

const memory = (init?: string) => {
  const data = new Map<string, string>(init === undefined ? [] : [[HIDDEN_KEY, init]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test("every element but the Assistant and Add to home can be removed", () => {
  for (const e of ELEMENTS) assert.equal(canRemove(e.key), true);
  assert.equal(canRemove("assistant"), false);
  assert.equal(canRemove("add"), false);
  assert.equal(labelOf("weather"), "Weather");
});

test("the removed elements are kept, and anything unreadable or unknown is dropped", () => {
  const s = memory();
  assert.deepEqual(loadHidden(s), []);
  saveHidden(s, ["calendar", "cinema"]);
  assert.deepEqual(loadHidden(s), ["calendar", "cinema"]);
  assert.deepEqual(loadHidden(memory("not json")), []);
  assert.deepEqual(loadHidden(memory('{"a":1}')), []);
  assert.deepEqual(loadHidden(memory('["cinema","assistant",4,"apps"]')), ["cinema", "apps"]);
});

test("Add to home offers the removed elements in row order", () => {
  assert.deepEqual(removed(["apps", "weather"]).map((e) => e.key), ["weather", "apps"]);
  assert.deepEqual(removed([]), []);
});
