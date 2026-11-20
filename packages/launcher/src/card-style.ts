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

export const EXPANDED = { w: 280, h: 420, stride: 308 } as const;
/** The expanded card spans the screen between the 80px insets. */
export const EXPANDED_W = 1920 - 2 * 80;
/** The focused title's caption under the opened row (name, line, a few lines of synopsis), fixed at its left edge. */
export const CAPTION_W = 900;

/** How far the expanded row scrolls so item `i` of `n` (n includes the Open tile) stays in view. */
export function expandedScroll(i: number, n: number): number {
  const max = Math.max(0, n * EXPANDED.stride - EXPANDED.stride + EXPANDED.w - EXPANDED_W);
  return Math.max(0, Math.min(max, (i - 3) * EXPANDED.stride));
}

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

/** The size line comes after the four layouts, then "Remove from home". */
export const SIZE_LINE = LAYOUTS.length;
export const REMOVE_LINE = SIZE_LINE + 1;

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
 * from home"; Left and Right change the size on its line. "keep", "undo" and "remove" close it: OK keeps `style`
 * (or removes the card on the last line), Back puts `orig` back.
 */
export function stepStyleMenu(m: StyleMenu, key: string): StyleMenu | "keep" | "undo" | "remove" {
  if (key === "Enter") return m.line === REMOVE_LINE ? "remove" : "keep";
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
