import assert from "node:assert/strict";
import { test } from "node:test";
import type { NuvioCollection } from "@secretary/nuvio";
import {
  collectionKey,
  collectionLine,
  collectionStyle,
  FOLDER_TITLES,
  FOLDER_TITLES_MAX,
  folderKind,
  folderRowKey,
  folderRows,
  foldersRowKey,
  foldersShape,
  type FolderTitle,
  folderTitlesKey,
  isCollectionKey,
  loadCards,
  loadFolderTitles,
  saveCards,
  saveFolderTitles,
  toCards,
} from "../src/collections.ts";

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

const memStore = () => {
  const mem = new Map<string, string>();
  return { mem, getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
};
const titles = (n: number): FolderTitle[] => Array.from({ length: n }, (_, i) => ({ id: `tt${i}`, name: `Title ${i}`, kind: "movie" as const }));

test("a card keeps each folder's cover shape and sources, for its rows", () => {
  const f = { ...folder("1", [addon("movie")], "https://example.com/c.jpg"), tileShape: "LANDSCAPE" as const };
  const [card] = toCards([col("a", [f])]);
  assert.equal(card.folders[0].shape, "LANDSCAPE");
  assert.deepEqual(card.folders[0].sources, [addon("movie")]);
});

test("the folders row takes most folders' shape, posters on a tie, and the folded card follows it", () => {
  assert.equal(foldersShape([{ shape: "LANDSCAPE" }, { shape: "LANDSCAPE" }, { shape: "POSTER" }]), "landscape");
  assert.equal(foldersShape([{ shape: "SQUARE" }, { shape: "SQUARE" }, { shape: "LANDSCAPE" }]), "square");
  assert.equal(foldersShape([{ shape: "SQUARE" }, { shape: "POSTER" }]), "poster");
  assert.equal(foldersShape([{}, {}]), "poster", "an old cache without shapes");
  assert.equal(foldersShape([]), "poster");
  assert.deepEqual(collectionStyle([{ shape: "LANDSCAPE" }]), { layout: "stills", size: "l" });
  assert.deepEqual(collectionStyle([{ shape: "POSTER" }]), { layout: "grid", size: "l" });
});

test("an opened collection has a row per folder with titles, in folder order, capped", () => {
  const [card] = toCards([col("a", [folder("1", [addon("movie")]), folder("2", [tmdb("TV")]), folder("3", [addon("movie")])])]);
  const rows = folderRows(card, { [folderTitlesKey("a", "3")]: titles(3), [folderTitlesKey("a", "1")]: titles(FOLDER_TITLES + 5), [folderTitlesKey("a", "2")]: [] });
  assert.deepEqual(rows.map((r) => r.folder.id), ["1", "3"], "a folder still loading or empty has no row");
  assert.equal(rows[0].titles.length, FOLDER_TITLES);
  assert.deepEqual(folderRows(card, {}), []);
  assert.equal(foldersRowKey(card), "nuvio:a/folders");
  assert.equal(folderRowKey(card, "2"), "nuvio:a/2");
});

test("the end bar names the collection and its folders", () => {
  assert.deepEqual(collectionLine({ title: "Marathons", folders: [] }), { title: "Marathons", sub: "0 folders · Open collection for every title" });
  const [card] = toCards([col("a", [folder("1", [addon("movie")])])]);
  assert.match(collectionLine(card).sub, /^1 folder ·/);
});

test("folder titles are kept per account, the newest folders the ones to stay", () => {
  const store = memStore();
  const all: Record<string, FolderTitle[]> = {};
  for (let i = 0; i < FOLDER_TITLES_MAX + 3; i++) all[folderTitlesKey("a", `f${i}`)] = titles(FOLDER_TITLES + 2);
  saveFolderTitles(store, "u1:1", all);
  const back = loadFolderTitles(store, "u1:1");
  assert.equal(Object.keys(back).length, FOLDER_TITLES_MAX);
  assert.equal(back[folderTitlesKey("a", "f0")], undefined, "the oldest went");
  assert.equal(back[folderTitlesKey("a", `f${FOLDER_TITLES_MAX + 2}`)].length, FOLDER_TITLES);
  assert.deepEqual(loadFolderTitles(store, "u1:2"), {});
  assert.deepEqual(loadFolderTitles(store, null), {});
  store.mem.set("nest.folderTitles", "{not json");
  assert.deepEqual(loadFolderTitles(store, "u1:1"), {});
});
