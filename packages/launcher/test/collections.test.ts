import assert from "node:assert/strict";
import { test } from "node:test";
import type { NuvioCollection } from "@secretary/nuvio";
import { collectionKey, folderKind, isCollectionKey, loadCards, saveCards, toCards } from "../src/collections.ts";

type Folder = NuvioCollection["folders"][number];
const folder = (id: string, sources: Folder["catalogSources"], cover?: string): Folder => ({
  id,
  title: `Folder ${id}`,
  tileShape: "POSTER",
  hideTitle: false,
  catalogSources: sources,
  ...(cover ? { coverImageUrl: cover } : {}),
});
const addon = (type: string) => ({ provider: "addon" as const, addonId: "a", type, catalogId: "top" });
const tmdb = (mediaType: "MOVIE" | "TV") => ({ provider: "tmdb" as const, tmdbSourceType: "DISCOVER" as const, tmdbId: 0, mediaType });
const col = (id: string, folders: Folder[], pinToTop = false): NuvioCollection => ({
  id,
  title: `Collection ${id}`,
  pinToTop,
  viewMode: "ROWS",
  showAllTab: false,
  folders,
});

test("a folder opens in the app of its first kind: films, then series, then anime", () => {
  assert.equal(folderKind({ catalogSources: [addon("series"), addon("movie")] }), "movie");
  assert.equal(folderKind({ catalogSources: [tmdb("TV")] }), "series");
  assert.equal(folderKind({ catalogSources: [addon("anime")] }), "anime");
  assert.equal(folderKind({ catalogSources: [] }), "movie");
});

test("collections become cards, pinned first, and an empty one is left out", () => {
  const cards = toCards([col("b", [folder("1", [addon("movie")])]), col("c", []), col("a", [folder("2", [tmdb("TV")], "https://example.com/c.jpg")], true)]);
  assert.deepEqual(cards.map((c) => c.key), ["nuvio:a", "nuvio:b"]);
  assert.equal(cards[0].folders[0].cover, "https://example.com/c.jpg");
  assert.equal(cards[0].folders[0].kind, "series");
  assert.equal(isCollectionKey(collectionKey("x")), true);
  assert.equal(isCollectionKey("cinema"), false);
});

test("the cache belongs to one account and profile", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const cards = toCards([col("a", [folder("1", [addon("movie")])])]);
  saveCards(store, "u1:1", cards);
  assert.deepEqual(loadCards(store, "u1:1"), cards);
  assert.deepEqual(loadCards(store, "u1:2"), []);
  assert.deepEqual(loadCards(store, null), []);
});
