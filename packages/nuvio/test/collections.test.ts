import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTION_CAPS,
  type NuvioClient,
  collectionsArray,
  parseCollections,
  pullCollections,
  pushCollections,
  tileShapeOf,
} from "../src/index.ts";

const folder = (id: string, sources: unknown[], extra: Record<string, unknown> = {}) => ({ id, title: `Folder ${id}`, catalogSources: sources, ...extra });
const addon = (catalogId: string, type = "movie") => ({ addonId: "org.example", type, catalogId });
const collection = (id: string, folders: unknown[], extra: Record<string, unknown> = {}) => ({ id, title: `Collection ${id}`, folders, ...extra });

/** Only rpc is used by the collection calls. */
const fakeClient = (reply: unknown, calls: { name: string; args?: Record<string, unknown> }[] = []) =>
  ({
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      return reply;
    },
  }) as unknown as NuvioClient;

test("collectionsArray reads rows, objects, arrays and JSON strings", () => {
  const list = [collection("a", [])];
  assert.deepEqual(collectionsArray(list), list);
  assert.deepEqual(collectionsArray({ collections: list }), list);
  assert.deepEqual(collectionsArray([{ profile_id: 3, collections_json: list, updated_at: "x" }]), list);
  assert.deepEqual(collectionsArray([{ collections_json: JSON.stringify(list) }]), list);
  assert.deepEqual(collectionsArray(JSON.stringify({ collections: list })), list);
  assert.equal(collectionsArray('[{"id":"a"'), null, "a cut reply is not an empty list");
  assert.equal(collectionsArray(null), null);
  assert.deepEqual(collectionsArray([]), []);
});

test("parseCollections keeps the known fields and ignores the rest", () => {
  const [c] = parseCollections([
    collection(
      "c1",
      [
        folder("f1", [{ ...addon("top"), title: "Top", genre: "None", somethingNew: 1 }], {
          coverImageUrl: "https://img/c.jpg",
          tileShape: "WIDE",
          hideTitle: true,
          heroBackdropUrl: "https://img/h.jpg",
          focusGifUrl: "https://img/g.gif",
        }),
        folder("f2", [addon("x")], { coverEmoji: "🎬", posterShape: "POSTER" }),
      ],
      { backdropImageUrl: "https://img/b.jpg", pinToTop: true, viewMode: "rows", showAllTab: false, extra: { a: 1 } },
    ),
  ])!;
  assert.equal(c.id, "c1");
  assert.equal(c.backdropImageUrl, "https://img/b.jpg");
  assert.equal(c.pinToTop, true);
  assert.equal(c.viewMode, "ROWS");
  assert.equal(c.showAllTab, false);
  assert.deepEqual(c.folders[0], {
    id: "f1",
    title: "Folder f1",
    coverImageUrl: "https://img/c.jpg",
    tileShape: "LANDSCAPE",
    hideTitle: true,
    heroBackdropUrl: "https://img/h.jpg",
    catalogSources: [{ provider: "addon", addonId: "org.example", type: "movie", catalogId: "top", title: "Top" }],
  });
  assert.equal(c.folders[1].coverEmoji, "🎬");
  assert.equal(c.folders[1].tileShape, "POSTER");
});

test("defaults: tabbed grid with an All tab, square tiles", () => {
  const [c] = parseCollections([collection("c", [folder("f", [addon("a")])], { viewMode: "SOMETHING" })])!;
  assert.equal(c.viewMode, "TABBED_GRID");
  assert.equal(c.showAllTab, true);
  assert.equal(c.pinToTop, false);
  assert.equal(c.folders[0].tileShape, "SQUARE");
  assert.equal(tileShapeOf(undefined), "SQUARE");
  assert.equal(tileShapeOf("landscape"), "LANDSCAPE");
});

test("TMDB and Trakt sources, the old `sources` key and catalog_id", () => {
  const [c] = parseCollections([
    collection("c", [
      {
        id: "f",
        title: "Mixed",
        sources: [
          { provider: "tmdb", tmdbSourceType: "collection", tmdbId: "10", mediaType: "MOVIE", title: "Star Wars" },
          { provider: "TMDB", tmdbSourceType: "NETWORK", tmdbId: 213, sortBy: "popularity.desc", filters: { year: 2020 } },
          { provider: "tmdb", mediaType: "TV" },
          { provider: "tmdb", tmdbSourceType: "PERSON" },
          { provider: "trakt", traktListId: 55, mediaType: "shows", sortHow: "DESC" },
          { provider: "trakt", traktListId: 0 },
          { provider: "letterboxd", id: 1 },
          { addonBaseUrl: "https://addon.example", type: "series", catalog_id: "pop" },
          { addonId: "org.x", type: "movie" },
        ],
      },
    ]),
  ])!;
  assert.deepEqual(c.folders[0].catalogSources, [
    { provider: "tmdb", tmdbSourceType: "COLLECTION", tmdbId: 10, mediaType: "MOVIE", title: "Star Wars" },
    { provider: "tmdb", tmdbSourceType: "NETWORK", tmdbId: 213, mediaType: "TV", sortBy: "popularity.desc", filters: { year: 2020 } },
    { provider: "tmdb", tmdbSourceType: "DISCOVER", tmdbId: 0, mediaType: "TV" },
    { provider: "trakt", traktListId: 55, mediaType: "TV", sortHow: "desc" },
    { provider: "addon", addonId: "", addonBaseUrl: "https://addon.example", type: "series", catalogId: "pop" },
  ]);
});

test("a folder with an empty catalogSources beside a full sources list keeps the sources", () => {
  const [c] = parseCollections([
    collection("c", [{ id: "f", title: "Netflix", catalogSources: [], sources: [{ id: "src-1", name: "Top", provider: "tmdb", tmdbSourceType: "LIST", tmdbId: 8679739, mediaType: "MOVIE" }] }]),
  ])!;
  assert.equal(c.folders[0].catalogSources.length, 1);
});

test("folders without a source and collections without folders are skipped", () => {
  const got = parseCollections([
    collection("empty", [folder("f", [{ provider: "letterboxd" }])]),
    collection("ok", [folder("f", [addon("a")]), { id: "no-title", catalogSources: [addon("b")] }]),
    { title: "no id", folders: [folder("f", [addon("a")])] },
    "junk",
  ])!;
  assert.deepEqual(
    got.map((c) => [c.id, c.folders.map((f) => f.id)]),
    [["ok", ["f"]]],
  );
});

test("a collection past the caps is left out whole, later ones still fit", () => {
  const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => folder(`${prefix}${i}`, [addon(`c${i}`)]));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const got = parseCollections([
      collection("a", many(COLLECTION_CAPS.folders - 5, "a")),
      collection("big", many(10, "b")),
      collection("small", many(5, "s")),
      collection("wide", [folder("w", Array.from({ length: COLLECTION_CAPS.sourcesPerFolder + 1 }, (_, i) => addon(`w${i}`)))]),
    ])!;
    assert.deepEqual(
      got.map((c) => [c.id, c.folders.length]),
      [
        ["a", COLLECTION_CAPS.folders - 5],
        ["small", 5],
      ],
    );
  } finally {
    console.warn = warn;
  }
});

test("pullCollections: rows, no row, and an unreadable reply", async () => {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const list = [collection("c", [folder("f", [addon("a")])])];
  const got = await pullCollections(fakeClient([{ profile_id: 3, collections_json: list, updated_at: "2026-10-30T10:00:00Z" }], calls), 3);
  assert.deepEqual(calls, [{ name: "sync_pull_collections", args: { p_profile_id: 3 } }]);
  assert.equal(got?.collections[0].id, "c");
  assert.equal(got?.updatedAt, "2026-10-30T10:00:00Z");
  assert.deepEqual(got?.raw, list);

  assert.deepEqual(await pullCollections(fakeClient([]), 3), { collections: [], raw: [], updatedAt: null });
  assert.equal(await pullCollections(fakeClient([{ collections_json: "{oops" }]), 3), null);
});

test("pushCollections sends the whole list", async () => {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const all = [collection("c", [])];
  await pushCollections(fakeClient(null, calls), 3, all);
  assert.deepEqual(calls, [{ name: "sync_push_collections", args: { p_profile_id: 3, p_collections_json: all } }]);
  await assert.rejects(pushCollections(fakeClient(null), 3, null as never));
});
