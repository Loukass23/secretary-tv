// An opened media card's rows (Continue watching or the picks, then My List, the genres and the assistant's picks), and
// what the remote is on in them: which row, which title, what the header calls it. Pure, so it is unit tested;
// cards.tsx draws the rows and app.tsx runs OK, both through these, so the caption, the focused tile, the header and
// what OK opens always name the same title.
import { ratingLabel } from "@secretary/catalog-kit/src/lib/cinemeta.ts";
import type { MediaItem, MoreRow, RowColumn, TileTarget } from "./cards.tsx";
import { atEnd, rowAt } from "./nest-nav.ts";

type MediaColumn = Extract<RowColumn, { kind: "media" }>;

/** The rows under the first one that have titles; an empty row is not drawn and the remote never stops on it. */
export const rowsOf = (c: MediaColumn): MoreRow[] => (c.more ?? []).filter((m) => m.items.length);

/** How many titles each row of the opened card holds, in order: `focus.i` counts across all of them. */
export const expandedRows = (c: MediaColumn): number[] => [c.items.length, ...rowsOf(c).map((m) => m.items.length)];

/** Row `r`'s titles. */
export const rowItems = (c: MediaColumn, r: number): MediaItem[] => (r === 0 ? c.items : (rowsOf(c)[r - 1]?.items ?? []));

/**
 * Where the remote is in an opened card: the row and the title in it. On the end bar the card stays on its last row
 * with no title focused (`x` is -1).
 */
export function onRow(c: MediaColumn, flat: number): { r: number; x: number; end: boolean } {
  const rows = expandedRows(c);
  if (atEnd(flat)) return { r: rows.length - 1, x: -1, end: true };
  const { r, x } = rowAt(rows, Math.max(0, flat));
  return { r, x: Math.min(x, rows[r] - 1), end: false };
}

/** The title the remote is on: the one the focused tile shows, the caption describes and OK opens. */
export function focusedItem(c: MediaColumn, flat: number): MediaItem | undefined {
  const { r, x } = onRow(c, flat);
  return x < 0 ? undefined : rowItems(c, r)[x];
}

/** What the header calls the row the remote is on: the first row's own name, else the row's label. No count. */
export function rowTitle(c: MediaColumn, flat: number): string {
  const { r } = onRow(c, flat);
  return r === 0 ? (c.heading ?? c.label) : rowsOf(c)[r - 1].label;
}

/** The title behind item `i` of an opened media card, for its long-OK menu. */
export function targetAt(c: MediaColumn, i: number): TileTarget | null {
  if (i < 0) return null;
  const { r, x } = rowAt(expandedRows(c), i);
  return (r === 0 ? c.target?.(x) : rowsOf(c)[r - 1]?.target?.(x)) ?? null;
}

/**
 * A tile's key in its row: the title and its art, never its place. When a row's titles change (a pick removed, the
 * day's list refreshed) a title keeps its tile, and a slot never swaps its picture under a caption that already
 * names the next title.
 */
export const tileKey = (it: Pick<MediaItem, "title" | "poster">): string => `${it.title}\u0000${it.poster}`;

/** Every tile's key in a row; a title listed twice gets its place added the second time, so keys stay unique. */
export function tileKeys(items: readonly Pick<MediaItem, "title" | "poster">[]): string[] {
  const seen = new Set<string>();
  return items.map((it, i) => {
    const k = tileKey(it);
    if (!seen.has(k)) {
      seen.add(k);
      return k;
    }
    return `${k}#${i}`;
  });
}

/** The caption's line under a title's name: its line, rating ("★ 7.4", catalog-kit ratingLabel) and its ranking, when known. */
export const captionMeta = (it: MediaItem): string[] => [it.sub ?? "", ratingLabel(it.rating), it.rank ?? ""].filter(Boolean);

/** A catalog's stand-in name for an episode ("Episode 24", "Ep. 3"): it says nothing the number does not. */
const GENERIC_EPISODE = /^\s*(?:episode|ep\.?)\s*\d+\s*$/i;

/** An episode as a tile names it: "S1 · E24", then its own name when it has a real one. */
export function episodeLabel(ep: { season: number; episode: number; name?: string } | undefined): string | undefined {
  if (!ep) return undefined;
  const name = ep.name?.trim() && !GENERIC_EPISODE.test(ep.name) ? ep.name.trim() : "";
  return [`S${ep.season} · E${ep.episode}`, name].filter(Boolean).join(" · ");
}

/** What is left to watch, in words ("23 min left", "1 h 5 min left"); undefined when the length is not known. */
export function timeLeft(posSec: number, durSec: number): string | undefined {
  if (!(durSec > 0) || !(posSec >= 0)) return undefined;
  const min = Math.round(Math.max(0, durSec - posSec) / 60);
  if (min < 1) return "Almost done";
  const h = Math.floor(min / 60);
  return `${h ? `${h} h ` : ""}${h ? min % 60 : min} min left`.replace(" 0 min", "");
}
