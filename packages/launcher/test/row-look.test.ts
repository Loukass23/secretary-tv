import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPANDED } from "../src/card-style.ts";
import { loadRowLooks, ROW_LOOKS_KEY, ROW_SHAPES, rowShape, saveRowLooks, stepShape, tileBox } from "../src/row-look.ts";

test("no shape is taller than the poster row, and each is a tile apart by its own width", () => {
  for (const s of ROW_SHAPES) {
    const b = tileBox(s);
    assert.ok(b.h <= EXPANDED.h, s);
    assert.equal(b.stride - b.w, EXPANDED.stride - EXPANDED.w, s);
  }
  assert.equal(tileBox("poster").stride, EXPANDED.stride);
  assert.equal(tileBox("ranking").lead > 0, true);
  assert.equal(tileBox("landscape").art, "still");
});

test("the shape steps through the menu's order and wraps", () => {
  assert.equal(stepShape("poster", 1), "landscape");
  assert.equal(stepShape("poster", -1), "ranking");
  assert.equal(stepShape("ranking", 1), "poster");
});

test("looks round-trip per row, default to poster and drop what is unknown", () => {
  const box = new Map<string, string>();
  const store = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) };
  saveRowLooks(store, { "cinema/picks": "ranking", "cinema/My List": "square" });
  assert.equal(rowShape(loadRowLooks(store), "cinema/picks"), "ranking");
  assert.equal(rowShape(loadRowLooks(store), "shows/picks"), "poster");
  box.set(ROW_LOOKS_KEY, JSON.stringify({ a: "poster", b: "circle", c: 4 }));
  assert.deepEqual(loadRowLooks(store), { a: "poster" });
  box.set(ROW_LOOKS_KEY, "not json");
  assert.deepEqual(loadRowLooks(store), {});
});
