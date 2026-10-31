import { test } from "node:test";
import assert from "node:assert/strict";
import { fromLibraryRow, toLibraryRow } from "@secretary/nuvio";
import {
  applyChange,
  clearLocalLibrary,
  inLibrary,
  type LibraryChange,
  type LibraryEntry,
  loadLibrary,
  setLibraryRemote,
  syncLibrary,
  toggleLibrary,
} from "../src/lib/library.ts";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};

const title = (id: string, extra: Record<string, string> = {}) => ({ id, name: `Name ${id}`, year: "2001", rating: "7.5", ...extra });
const entry = (type: LibraryEntry["type"], id: string, addedAt: number): LibraryEntry => ({ type, title: title(id), addedAt });

test("rows: our titles to Nuvio's library fields and back; anime from its Kitsu id", () => {
  const row = toLibraryRow({ type: "anime", title: title("kitsu:9", { poster: "p.jpg" }), addedAt: 5 });
  assert.deepEqual(row, {
    content_id: "kitsu:9",
    content_type: "series",
    name: "Name kitsu:9",
    poster: "p.jpg",
    poster_shape: "POSTER",
    background: null,
    release_info: "2001",
    imdb_rating: 7.5,
    added_at: 5,
  });
  assert.deepEqual(fromLibraryRow(row), { type: "anime", title: { ...title("kitsu:9"), poster: "p.jpg" }, addedAt: 5 });
  assert.equal(toLibraryRow({ type: "movie", title: title("tt1", { rating: "" }), addedAt: 1 }).imdb_rating, null);
});

test("changes: an add goes first and replaces the same title; a removal matches type and id", () => {
  const list = [entry("movie", "a", 1), entry("series", "a", 2)];
  assert.deepEqual(applyChange(list, { op: "add", entry: entry("movie", "a", 9) }).map((e) => [e.type, e.title.id, e.addedAt]), [
    ["movie", "a", 9],
    ["series", "a", 2],
  ]);
  assert.deepEqual(applyChange(list, { op: "remove", type: "series", id: "a" }).map((e) => e.type), ["movie"]);
});

function fakeRemote(cloudList: LibraryEntry[] | null, ok = true) {
  const sent: LibraryChange[][] = [];
  setLibraryRemote({ pull: async () => cloudList, apply: async (c) => (sent.push([...c]), ok) });
  return sent;
}

test("toggle: offline changes wait, survive a pull, and are sent in order once it works", async () => {
  store.clear();
  let sent = fakeRemote([entry("movie", "cloud1", 10), entry("movie", "cloud2", 5)], false);
  assert.equal(toggleLibrary("movie", title("mine"), 20), true);
  await syncLibrary();
  assert.deepEqual(loadLibrary().map((e) => e.title.id), ["mine", "cloud1", "cloud2"]);
  toggleLibrary("movie", title("cloud2"));
  await new Promise((r) => setTimeout(r, 5));
  await syncLibrary();
  assert.deepEqual(loadLibrary().map((e) => e.title.id), ["mine", "cloud1"], "the removal stays applied over the pull");
  assert.ok(!inLibrary("movie", "cloud2"));

  sent = fakeRemote([entry("movie", "cloud1", 10), entry("movie", "cloud2", 5)], true);
  await syncLibrary();
  assert.deepEqual(sent.at(-1)!.map((c) => (c.op === "add" ? `+${c.entry.title.id}` : `-${c.id}`)), ["+mine", "-cloud2"]);
  sent = fakeRemote([entry("movie", "mine", 20), entry("movie", "cloud1", 10)], true);
  await syncLibrary();
  assert.equal(sent.length, 0, "queue empty once sent");
  assert.deepEqual(loadLibrary().map((e) => e.title.id), ["mine", "cloud1"]);
});

test("unreachable cloud keeps the local list; another profile clears it", async () => {
  store.clear();
  fakeRemote(null, false);
  toggleLibrary("series", title("tt5"));
  assert.deepEqual((await syncLibrary()).map((e) => e.title.id), ["tt5"]);
  clearLocalLibrary();
  assert.deepEqual(loadLibrary(), []);
  setLibraryRemote(null);
});
