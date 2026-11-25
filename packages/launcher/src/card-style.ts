// How a media card on Nest's home row looks (Cinema, Shows, Anime), and the long-OK menu that changes it
// (docs/launcher.md, "Card styles"). Pure, so the shapes and the menu are unit tested; cards.tsx draws them.

export const LAYOUTS = ["poster", "stills", "grid", "row"] as const;
export type CardLayout = (typeof LAYOUTS)[number];
export const SIZES = ["s", "m", "l"] as const;
export type CardSize = (typeof SIZES)[number];

export interface CardStyle {
  layout: CardLayout;
  size: CardSize;
}

export const LAYOUT_LABEL: Record<CardLayout, string> = { poster: "Poster", stills: "Stills", grid: "Grid", row: "Row" };
export const SIZE_LABEL: Record<CardSize, string> = { s: "Small", m: "Medium", l: "Large" };

/** Today's look: one poster for Cinema, two stills for Shows, a grid for Anime. */
export const DEFAULT_STYLES: Record<string, CardStyle> = {
  cinema: { layout: "poster", size: "l" },
  shows: { layout: "stills", size: "l" },
  anime: { layout: "grid", size: "l" },
};
const FALLBACK: CardStyle = { layout: "poster", size: "l" };

export const styleFor = (styles: Record<string, CardStyle>, key: string): CardStyle =>
  styles[key] ?? DEFAULT_STYLES[key] ?? FALLBACK;

/** Card height at Large: the tallest layout fills it, the others sit at its top. Same as CARD_H in cards.tsx. */
const FULL_H = 540;
const SCALE: Record<CardSize, number> = { s: 0.7, m: 0.85, l: 1 };

export interface ItemBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which art the box shows: a portrait poster or a landscape still. */
  art: "poster" | "still";
}

export interface CardShape {
  w: number;
  h: number;
  /** Items the card shows (it may hold fewer). */
  count: number;
  /** Items to a line, for the remote. */
  across: number;
  boxes: ItemBox[];
}

/** Where each item of a collapsed media card sits, for a style. Every layout fills the same height at a size. */
export function collapsedShape(style: CardStyle): CardShape {
  const k = SCALE[style.size];
  const H = Math.round(FULL_H * k);
  const poster = (h: number) => Math.round((h * 2) / 3);
  switch (style.layout) {
    case "poster": {
      const w = poster(H);
      return { w, h: H, count: 1, across: 1, boxes: [{ x: 0, y: 0, w, h: H, art: "poster" }] };
    }
    case "stills": {
      const h = Math.floor((H - Math.round(22 * k)) / 2);
      const gap = H - 2 * h;
      const w = Math.round(436 * k);
      return { w, h: H, count: 2, across: 1, boxes: [0, 1].map((i) => ({ x: 0, y: i * (h + gap), w, h, art: "still" as const })) };
    }
    case "grid": {
      const h = Math.floor((H - Math.round(16 * k)) / 2);
      const gap = H - 2 * h;
      const w = poster(h);
      return {
        w: 3 * w + 2 * gap,
        h: H,
        count: 6,
        across: 3,
        boxes: Array.from({ length: 6 }, (_, i) => ({ x: (i % 3) * (w + gap), y: Math.floor(i / 3) * (h + gap), w, h, art: "poster" as const })),
      };
    }
    case "row": {
      const w = poster(H);
      const gap = Math.round(18 * k);
      return { w: 3 * w + 2 * gap, h: H, count: 3, across: 3, boxes: [0, 1, 2].map((i) => ({ x: i * (w + gap), y: 0, w, h: H, art: "poster" as const })) };
    }
  }
}

// --- the expanded card: every item in one row, as the Ask answer row shows titles, then the app's Open tile ---

/** A poster in an opened card's rows: larger than the folded card's, so the opened card fills the screen down to its peek. */
export const EXPANDED = { w: 280, h: 420, stride: 306 } as const;
/**
 * Continue watching in an opened card: a landscape thumb with the title's logo on it, then a thick progress bar and a
 * line with the episode and the time left under it. Episodes (Shows, Anime) take the bigger tile.
 */
export const CONTINUE = { episodes: 600, films: 520, gap: 32, below: 84 } as const;
/** The expanded card spans the screen between the 80px insets. */
export const EXPANDED_W = 1920 - 2 * 80;
/** The focused title's caption under the opened row (name, line, a few lines of synopsis), fixed at its left edge. */
export const CAPTION_W = 900;

/** The caption under a row of an opened card: its gap from the tiles, and the room it keeps for a name, a line and three of synopsis. */
export const CAPTION = { top: 44, h: 176 } as const;
/**
 * The rows under the first in an opened card (My List, the genres) are the first row again: same tiles, a label over
 * each, the same caption under. Every row takes one block, so only the top of the next row (about 60px of its tiles)
 * peeks in at the bottom of the screen, whatever the row's look.
 */
export const MORE = { labelH: 52, gap: 72 } as const;
/**
 * Where extra row `k` (0-based) starts in the opened card: under the first row (`firstH` tall: a Continue watching row
 * is taller than a poster row) and its caption, then a block apiece.
 */
export const moreTop = (k: number, firstH: number = EXPANDED.h): number =>
  firstH + CAPTION.top + CAPTION.h + MORE.gap + k * (MORE.labelH + EXPANDED.h + CAPTION.top + CAPTION.h + MORE.gap);
/** How far a row of `n` tiles (`stride` apart, `w` wide) scrolls so tile `i` stays in view, a few in from the left. */
export function rowScroll(i: number, n: number, stride: number, w: number): number {
  const max = Math.max(0, n * stride - stride + w - EXPANDED_W);
  const lead = Math.max(1, Math.floor(EXPANDED_W / stride / 2));
  return Math.max(0, Math.min(max, (i - lead) * stride));
}

/** The same for the poster row. */
export const expandedScroll = (i: number, n: number): number => rowScroll(i, n, EXPANDED.stride, EXPANDED.w);

// --- saved choices ---

export const STYLES_KEY = "nest.cardStyles";

const isStyle = (v: unknown): v is CardStyle =>
  typeof v === "object" &&
  v !== null &&
  LAYOUTS.includes((v as CardStyle).layout) &&
  SIZES.includes((v as CardStyle).size);

/** The styles the TV keeps, by card key; anything unreadable is dropped. */
export function loadCardStyles(store: { getItem(k: string): string | null }): Record<string, CardStyle> {
  try {
    const raw = JSON.parse(store.getItem(STYLES_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, CardStyle] => isStyle(e[1])));
  } catch {
    return {};
  }
}

export function saveCardStyles(store: { setItem(k: string, v: string): void }, styles: Record<string, CardStyle>): void {
  try {
    store.setItem(STYLES_KEY, JSON.stringify(styles));
  } catch {
    // the style still holds until the next start
  }
}

// --- the long-OK menu ---

/** The size line comes after the four layouts, then "Move", then "Remove from home". */
export const SIZE_LINE = LAYOUTS.length;
export const MOVE_LINE = SIZE_LINE + 1;
export const REMOVE_LINE = SIZE_LINE + 2;

export interface StyleMenu {
  /** The card it styles. */
  key: string;
  /** The style the card had when the menu opened: Back puts it back. */
  orig: CardStyle;
  style: CardStyle;
  line: number;
}

export function openStyleMenu(key: string, style: CardStyle): StyleMenu {
  return { key, orig: style, style, line: LAYOUTS.indexOf(style.layout) };
}

/**
 * One key in the menu. Up and Down walk the layouts (each one shows on the card at once), the size line and "Remove
 * from home"; Left and Right change the size on its line. "keep", "undo", "move" and "remove" close it: OK keeps `style`
 * (starts moving the card on the Move line, removes it on the last), Back puts `orig` back.
 */
export function stepStyleMenu(m: StyleMenu, key: string): StyleMenu | "keep" | "undo" | "remove" | "move" {
  if (key === "Enter") return m.line === REMOVE_LINE ? "remove" : m.line === MOVE_LINE ? "move" : "keep";
  if (key === "Back") return "undo";
  if (key === "Up" || key === "Down") {
    const line = Math.max(0, Math.min(REMOVE_LINE, m.line + (key === "Up" ? -1 : 1)));
    if (line === m.line) return m;
    return line >= SIZE_LINE ? { ...m, line } : { ...m, line, style: { ...m.style, layout: LAYOUTS[line] } };
  }
  if ((key === "Left" || key === "Right") && m.line === SIZE_LINE) {
    const i = SIZES.indexOf(m.style.size) + (key === "Left" ? -1 : 1);
    if (i < 0 || i >= SIZES.length) return m;
    return { ...m, style: { ...m.style, size: SIZES[i] } };
  }
  return m;
}
