// How Nuvio collections look (docs/nuvio-cloud.md, phase 8): the card style of a collection's home row, the view a
// folder opens in, and how its tabs show. Each has a setting with an Automatic choice, and the row and the folder can
// carry their own choice on top (a long OK on the row, the View button in the folder), kept on this TV only.
// Behaviour follows nuvio-native-legacy's row styles, "Exibição" views and tab styles; nothing is copied from it.
import type { TileShape, ViewMode } from "@secretary/nuvio";
import { readJson, writeJson } from "@secretary/tv-kit";
import type { Title } from "./types.ts";

// --- Home row cards ------------------------------------------------------------------------------------------------

/** A card's shape: Nuvio's three, plus the 4:3 "highlight" the legacy app offers. */
export type CardShape = "poster" | "landscape" | "square" | "wide";
export type CardSize = "compact" | "standard" | "large";
export type Auto<T> = T | "auto";

export const CARD_SHAPES: readonly CardShape[] = ["poster", "landscape", "square", "wide"];
export const CARD_SIZES: readonly CardSize[] = ["compact", "standard", "large"];

export const CARD_SHAPE_LABELS: Record<Auto<CardShape>, string> = {
  auto: "Automatic",
  poster: "Poster",
  landscape: "Landscape",
  square: "Square",
  wide: "Highlight 4:3",
};
export const CARD_SIZE_LABELS: Record<Auto<CardSize>, string> = { auto: "Automatic", compact: "Compact", standard: "Standard", large: "Large" };

/** Width and height at the standard size; every shape is 270 high, so rows keep one rhythm. */
const BASE: Record<CardShape, readonly [number, number]> = {
  poster: [180, 270],
  landscape: [480, 270],
  square: [270, 270],
  wide: [360, 270],
};
/** The legacy app's factors; larger would push the row below out of the clip. */
const SCALE: Record<CardSize, number> = { compact: 0.85, standard: 1, large: 1.15 };

export const shapeOfTile = (t: TileShape): CardShape => (t === "POSTER" ? "poster" : t === "LANDSCAPE" ? "landscape" : "square");

export function cardBox(shape: CardShape, size: CardSize): { w: number; h: number } {
  const [w, h] = BASE[shape];
  return { w: Math.round(w * SCALE[size]), h: Math.round(h * SCALE[size]) };
}

export interface RowStyle {
  shape?: CardShape;
  size?: CardSize;
}

const ROW_STYLES = "sectv.collections.rowStyle";

export function loadRowStyles(): Record<string, RowStyle> {
  const v = readJson<Record<string, RowStyle>>(ROW_STYLES);
  return v && typeof v === "object" ? v : {};
}

/** Sets or clears (both Automatic) one row's own style; returns all of them. */
export function saveRowStyle(rowId: string, style: RowStyle): Record<string, RowStyle> {
  const all = { ...loadRowStyles() };
  if (style.shape || style.size) all[rowId] = { ...(style.shape ? { shape: style.shape } : {}), ...(style.size ? { size: style.size } : {}) };
  else delete all[rowId];
  writeJson(ROW_STYLES, all);
  return all;
}

/**
 * The card a row draws: the row's own choice, else the setting, else Automatic — the shape most of the collection's
 * folders have in Nuvio, at the standard size.
 */
export function resolveCard(
  nuvioShape: TileShape,
  setting: { cardShape: Auto<CardShape>; cardSize: Auto<CardSize> },
  own: RowStyle = {},
): { shape: CardShape; size: CardSize } {
  const shape = own.shape ?? (setting.cardShape === "auto" ? shapeOfTile(nuvioShape) : setting.cardShape);
  const size = own.size ?? (setting.cardSize === "auto" ? "standard" : setting.cardSize);
  return { shape, size };
}

// --- Folder views --------------------------------------------------------------------------------------------------

/**
 * How a folder's titles are laid out. Grid and rows are Nuvio's own; the others are the legacy app's: a timeline by
 * year, a cover flow, a ranking with big numerals, a mural of wide art, and rows by decade.
 */
export type FolderView = "grid" | "rows" | "timeline" | "coverflow" | "ranking" | "mural" | "decades";

export const FOLDER_VIEWS: readonly FolderView[] = ["grid", "rows", "timeline", "coverflow", "ranking", "mural", "decades"];
export const FOLDER_VIEW_LABELS: Record<Auto<FolderView>, string> = {
  auto: "Automatic",
  grid: "Grid",
  rows: "Rows",
  timeline: "Timeline",
  coverflow: "Cover flow",
  ranking: "Ranking",
  mural: "Mural",
  decades: "Decades",
};

/** Views that show one source at a time, so they have tabs. Rows show every source at once. */
export const tabbed = (v: FolderView) => v !== "rows";

/**
 * Automatic: the collection's own view mode (tabs over a grid, or rows; "follow the layout" is rows, as our home),
 * except that a folder made only of filmographies reads best as a timeline.
 */
export function autoFolderView(viewMode: ViewMode, filmographies = false): FolderView {
  if (filmographies) return "timeline";
  return viewMode === "TABBED_GRID" ? "grid" : "rows";
}

const FOLDER_VIEWS_KEY = "sectv.collections.folderView";
const folderKey = (collectionId: string, folderId: string) => `${collectionId}/${folderId}`;

export function loadFolderView(collectionId: string, folderId: string): FolderView | null {
  const all = readJson<Record<string, FolderView>>(FOLDER_VIEWS_KEY) ?? {};
  const v = all[folderKey(collectionId, folderId)];
  return v && FOLDER_VIEWS.includes(v) ? v : null;
}

/** A folder's own view; null goes back to the setting. */
export function saveFolderView(collectionId: string, folderId: string, view: FolderView | null): void {
  const all = { ...(readJson<Record<string, FolderView>>(FOLDER_VIEWS_KEY) ?? {}) };
  if (view) all[folderKey(collectionId, folderId)] = view;
  else delete all[folderKey(collectionId, folderId)];
  writeJson(FOLDER_VIEWS_KEY, all);
}

/** The folder's own choice, else the setting, else Automatic. */
export function resolveFolderView(own: FolderView | null, setting: Auto<FolderView>, auto: FolderView): FolderView {
  return own ?? (setting === "auto" ? auto : setting);
}

// --- Tabs ------------------------------------------------------------------------------------------------------------

/** Chips along the top; a dropdown list; a bar centred at the top; or one source per page, Left and Right turning. */
export type TabStyle = "chips" | "dropdown" | "centre" | "pages";

export const TAB_STYLES: readonly TabStyle[] = ["chips", "dropdown", "centre", "pages"];
export const TAB_STYLE_LABELS: Record<Auto<TabStyle>, string> = {
  auto: "Automatic",
  chips: "Chips",
  dropdown: "Dropdown",
  centre: "Centre bar",
  pages: "Pages",
};

/** Chips while they all fit on screen at once, else a dropdown. */
export const AUTO_CHIPS_MAX = 5;

export function resolveTabStyle(setting: Auto<TabStyle>, tabs: number): TabStyle {
  if (setting !== "auto") return setting;
  return tabs <= AUTO_CHIPS_MAX ? "chips" : "dropdown";
}

// --- Ordering ------------------------------------------------------------------------------------------------------

const yearOf = (t: Pick<Title, "year">) => {
  const y = Number.parseInt(t.year, 10);
  return Number.isFinite(y) ? y : null;
};

/** Oldest first; titles without a year keep their order at the end. Stable. */
export function byYear<T extends Pick<Title, "year">>(list: readonly T[]): T[] {
  return list
    .map((t, i) => ({ t, i, y: yearOf(t) }))
    .sort((a, b) => (a.y === null ? (b.y === null ? a.i - b.i : 1) : b.y === null ? -1 : a.y - b.y || a.i - b.i))
    .map((x) => x.t);
}

/** Rows by decade, newest decade first, each in the source's order; titles without a year go last as "Undated". */
export function byDecade<T extends Pick<Title, "year">>(list: readonly T[]): { label: string; items: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const t of list) {
    const y = yearOf(t);
    const d = y === null ? -1 : Math.floor(y / 10) * 10;
    groups.set(d, [...(groups.get(d) ?? []), t]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === -1 ? 1 : b[0] === -1 ? -1 : b[0] - a[0]))
    .map(([d, items]) => ({ label: d === -1 ? "Undated" : `${d}s`, items }));
}
