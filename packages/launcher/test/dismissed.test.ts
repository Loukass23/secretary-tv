import assert from "node:assert/strict";
import { test } from "node:test";
import { DISMISSED_KEY, DISMISSED_MAX, dismiss, loadDismissed, saveDismissed } from "../src/dismissed.ts";

const memory = (init?: string) => {
  let v = init ?? null;
  return { getItem: () => v, setItem: (_: string, x: string) => void (v = x) };
};

test("dismissing adds a title once and keeps the newest", () => {
  assert.deepEqual(dismiss(["a", "b"], "a"), ["b", "a"]);
  const many = Array.from({ length: DISMISSED_MAX }, (_, i) => `t${i}`);
  const out = dismiss(many, "new");
  assert.equal(out.length, DISMISSED_MAX);
  assert.equal(out.at(-1), "new");
  assert.equal(out[0], "t1");
});

test("the list survives a save and drops what is unreadable", () => {
  const s = memory();
  saveDismissed(s, ["x", "y"]);
  assert.deepEqual(loadDismissed(s), ["x", "y"]);
  assert.deepEqual(loadDismissed(memory("not json")), []);
  assert.deepEqual(loadDismissed(memory(JSON.stringify(["a", 3, null]))), ["a"]);
  assert.equal(typeof DISMISSED_KEY, "string");
});
