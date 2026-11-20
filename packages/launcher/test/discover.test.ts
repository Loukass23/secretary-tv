import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchResult } from "../src/apps.ts";
import { DISCOVER, discoverLabel, isDiscoverKey, loadDiscover, refreshDiscover } from "../src/discover.ts";

const memory = () => {
  const mem = new Map<string, string>();
  return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
};
const hit = (id: string): SearchResult => ({ type: "movie", title: { id, name: id, year: "", rating: "" } });

test("the rows have distinct keys and labels", () => {
  assert.equal(new Set(DISCOVER.map((d) => d.key)).size, DISCOVER.length);
  assert.equal(isDiscoverKey(DISCOVER[0].key), true);
  assert.equal(isDiscoverKey("cinema"), false);
  assert.equal(discoverLabel(DISCOVER[0].key), "Action films");
});

test("a pull is kept for a day and a failed row keeps its old list", async () => {
  const store = memory();
  let calls = 0;
  const ok = async (_k: string, g: string) => (calls++, [hit(`${g}1`), hit(`${g}2`)]);
  const first = await refreshDiscover(store, ok, 1000);
  assert.equal(Object.keys(first).length, DISCOVER.length);
  const n = calls;
  await refreshDiscover(store, ok, 2000);
  assert.equal(calls, n, "fresh: no second pull");
  const later = 1000 + 25 * 60 * 60 * 1000;
  assert.equal(loadDiscover(store, later).fresh, false);
  const down = async () => {
    throw new Error("offline");
  };
  const kept = await refreshDiscover(store, down, later);
  assert.equal(Object.keys(kept).length, DISCOVER.length);
});
