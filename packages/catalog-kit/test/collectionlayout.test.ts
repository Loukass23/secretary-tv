import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoFolderView,
  byDecade,
  byYear,
  cardBox,
  loadFolderView,
  loadRowStyles,
  resolveCard,
  resolveFolderView,
  resolveTabStyle,
  saveFolderView,
  saveRowStyle,
  tabbed,
} from "../src/lib/collectionlayout.ts";
import { mergeSettings } from "../src/lib/settings.ts";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const auto = { cardShape: "auto", cardSize: "auto" } as const;

test("card: the row's own choice, else the setting, else the collection's shape at the standard size", () => {
  assert.deepEqual(resolveCard("LANDSCAPE", auto), { shape: "landscape", size: "standard" });
  assert.deepEqual(resolveCard("POSTER", auto), { shape: "poster", size: "standard" });
  assert.deepEqual(resolveCard("SQUARE", { cardShape: "wide", cardSize: "compact" }), { shape: "wide", size: "compact" });
  assert.deepEqual(resolveCard("SQUARE", { cardShape: "wide", cardSize: "compact" }, { shape: "poster" }), { shape: "poster", size: "compact" });
  assert.deepEqual(resolveCard("SQUARE", auto, { size: "large" }), { shape: "square", size: "large" });
});

test("card boxes keep one height per size, so rows keep one rhythm", () => {
  assert.deepEqual(cardBox("landscape", "standard"), { w: 480, h: 270 });
  assert.deepEqual(cardBox("poster", "compact"), { w: 153, h: 230 });
  assert.equal(cardBox("wide", "large").h, cardBox("square", "large").h);
  assert.ok(cardBox("poster", "large").h <= 320, "a large card still fits under the row's title");
});

test("a row's own style is kept per row, and Automatic for both clears it", () => {
  saveRowStyle("nuvio-col:a", { shape: "wide" });
  saveRowStyle("nuvio-col:b", { size: "large" });
  assert.deepEqual(loadRowStyles(), { "nuvio-col:a": { shape: "wide" }, "nuvio-col:b": { size: "large" } });
  assert.deepEqual(saveRowStyle("nuvio-col:a", {}), { "nuvio-col:b": { size: "large" } });
});

test("folder view: Automatic follows the collection, filmographies read as a timeline", () => {
  assert.equal(autoFolderView("TABBED_GRID"), "grid");
  assert.equal(autoFolderView("ROWS"), "rows");
  assert.equal(autoFolderView("FOLLOW_LAYOUT"), "rows");
  assert.equal(autoFolderView("TABBED_GRID", true), "timeline");
  assert.equal(resolveFolderView(null, "auto", "rows"), "rows");
  assert.equal(resolveFolderView(null, "coverflow", "rows"), "coverflow");
  assert.equal(resolveFolderView("mural", "coverflow", "rows"), "mural");
  assert.equal(tabbed("rows"), false);
  assert.equal(tabbed("decades"), true);
});

test("a folder's own view is kept per folder; Default clears it", () => {
  assert.equal(loadFolderView("c", "f"), null);
  saveFolderView("c", "f", "ranking");
  assert.equal(loadFolderView("c", "f"), "ranking");
  assert.equal(loadFolderView("c", "g"), null);
  saveFolderView("c", "f", null);
  assert.equal(loadFolderView("c", "f"), null);
});

test("tab style: Automatic is chips while they fit, else a dropdown", () => {
  assert.equal(resolveTabStyle("auto", 3), "chips");
  assert.equal(resolveTabStyle("auto", 5), "chips");
  assert.equal(resolveTabStyle("auto", 20), "dropdown");
  assert.equal(resolveTabStyle("pages", 2), "pages");
});

const t = (id: string, year: string) => ({ id, year });

test("by year: oldest first, undated last, ties in their order", () => {
  assert.deepEqual(
    byYear([t("a", "2001"), t("b", ""), t("c", "1999"), t("d", "2001"), t("e", "1985")]).map((x) => x.id),
    ["e", "c", "a", "d", "b"],
  );
});

test("by decade: newest decade first, undated last", () => {
  assert.deepEqual(
    byDecade([t("a", "2004"), t("b", "1999"), t("c", ""), t("d", "2009"), t("e", "2021")]).map((g) => [g.label, g.items.map((x) => x.id)]),
    [
      ["2020s", ["e"]],
      ["2000s", ["a", "d"]],
      ["1990s", ["b"]],
      ["Undated", ["c"]],
    ],
  );
});

test("settings: the collections section defaults to Automatic and drops unknown values", () => {
  assert.deepEqual(mergeSettings(null).collections, { cardShape: "auto", cardSize: "auto", folderView: "auto", tabStyle: "auto" });
  assert.deepEqual(
    mergeSettings({ collections: { cardShape: "wide", cardSize: "huge", folderView: "coverflow", tabStyle: "pages" } } as never).collections,
    { cardShape: "wide", cardSize: "auto", folderView: "coverflow", tabStyle: "pages" },
  );
});
