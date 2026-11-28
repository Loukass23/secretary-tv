import { test } from "node:test";
import assert from "node:assert/strict";
import { SHEET_START, stepSheet, switchedStreams } from "../src/lib/playersources.ts";
import type { Stream } from "../src/lib/streams.ts";

const size = { rows: 3, chips: 4 };

test("player sources: Up and Down along the list, Up from the first source to the chips, OK picks", () => {
  assert.deepEqual(stepSheet(SHEET_START, "Down", size), { nav: { row: 1, chip: null } });
  assert.deepEqual(stepSheet({ row: 2, chip: null }, "Down", size), { nav: { row: 2, chip: null } }, "stops at the last");
  assert.deepEqual(stepSheet({ row: 2, chip: null }, "Up", size), { nav: { row: 1, chip: null } });
  assert.deepEqual(stepSheet(SHEET_START, "Up", size), { nav: { row: 0, chip: 0 } });
  assert.deepEqual(stepSheet({ row: 1, chip: null }, "Enter", size), { pick: 1 });
  assert.deepEqual(stepSheet({ row: 1, chip: null }, "Back", size), { close: true });
  assert.equal(stepSheet(SHEET_START, "Left", size), null);
});

test("player sources: the chips move with Left and Right, OK turns one, Down goes back; an empty list's OK shows all", () => {
  assert.deepEqual(stepSheet({ row: 0, chip: 0 }, "Right", size), { nav: { row: 0, chip: 1 } });
  assert.deepEqual(stepSheet({ row: 0, chip: 3 }, "Right", size), { nav: { row: 0, chip: 3 } });
  assert.deepEqual(stepSheet({ row: 0, chip: 0 }, "Left", size), { nav: { row: 0, chip: 0 } });
  assert.deepEqual(stepSheet({ row: 0, chip: 2 }, "Enter", size), { toggle: 2 });
  assert.deepEqual(stepSheet({ row: 0, chip: 2 }, "Down", size), { nav: { row: 0, chip: null } });
  assert.deepEqual(stepSheet({ row: 0, chip: 2 }, "Back", size), { close: true });
  assert.deepEqual(stepSheet(SHEET_START, "Enter", { rows: 0, chips: 4 }), { showAll: true });
  assert.equal(stepSheet(SHEET_START, "Up", { rows: 2, chips: 0 }), null, "no chips to go to");
});

test("player sources: the player reopens with the pick first and the rest after it for failover, the pick once", () => {
  const s = (url: string): Stream => ({ name: "Example", title: url, url });
  const a = s("https://cdn.example/a.mkv");
  const b = s("https://cdn.example/b.mkv");
  const c = s("https://cdn.example/c.mkv");
  assert.deepEqual(switchedStreams(b, [a, b, c]), [b, a, c]);
  assert.deepEqual(switchedStreams({ ...b }, [a, b, c]).map((x) => x.url), [b.url, a.url, c.url], "matched by link too");
});
