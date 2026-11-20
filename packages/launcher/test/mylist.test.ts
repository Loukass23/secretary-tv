import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryItem } from "@secretary/nuvio";
import { loadMylist, mylistItems, saveMylist } from "../src/mylist.ts";

const item = (id: string, addedAt: number, extra: Partial<LibraryItem["title"]> = {}, type: LibraryItem["type"] = "movie"): LibraryItem => ({
  type,
  addedAt,
  title: { id, name: `Title ${id}`, year: "2024", rating: "7.1", ...extra },
});

test("the card takes the newest titles first and skips unnamed ones", () => {
  const out = mylistItems([item("a", 1), item("b", 3), item("c", 2, { name: "" }), item("d", 2)], 2);
  assert.deepEqual(out.map((o) => o.item.title.id), ["b", "d"]);
  assert.equal(out[0].media.title, "Title b");
  assert.equal(out[0].media.sub, "2024 · ★ 7.1");
});

test("the list is cached per profile and trimmed", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const many = Array.from({ length: 40 }, (_, i) => item(`t${i}`, i));
  saveMylist(store, "u:1", many);
  const got = loadMylist(store, "u:1");
  assert.equal(got.length, 24);
  assert.equal(got[0].title.id, "t39");
  assert.deepEqual(loadMylist(store, "u:2"), []);
  assert.deepEqual(loadMylist(store, null), []);
});
