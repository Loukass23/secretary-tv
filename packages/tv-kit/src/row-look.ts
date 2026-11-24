// How a row of titles is drawn, shared by the catalog apps' home rows (catalog-kit collectionlayout) and Secretary
// Nest's opened cards (launcher row-look). The shapes follow Nuvio's tile shapes (poster, landscape, square) plus the
// presets the apps add on top: a 4:3 highlight, a Top 10 ranking with big numerals, and a spotlight of large stills
// with the title on the art. Pure, so it is unit tested; each app draws what these boxes say.

export const ROW_LOOKS = ["poster", "landscape", "square", "wide", "ranking", "spotlight"] as const;
export type RowLook = (typeof ROW_LOOKS)[number];

export const ROW_LOOK_LABEL: Record<RowLook, string> = {
  poster: "Poster",
  landscape: "Stills",
  square: "Square",
  wide: "Highlight 4:3",
  ranking: "Top 10 ranking",
  spotlight: "Spotlight",
};

/** A ranking row shows this many titles: a Top 10. */
export const RANKING_MAX = 10;
/** Spotlight cards are this much taller than the row's poster, so the art and its title read from the sofa. */
export const SPOTLIGHT_SCALE = 1.15;

export const isRowLook = (v: unknown): v is RowLook => ROW_LOOKS.includes(v as RowLook);

export interface LookBox {
  /** The tile's width, the ranking numeral's room included. */
  w: number;
  h: number;
  /** From one tile's left edge to the next. */
  stride: number;
  /** Which art it shows: the portrait poster, or the landscape still (the poster when a title has none). */
  art: "poster" | "still";
  /** Room on the left of the art for a ranking numeral. */
  lead: number;
  /** The title is written on the art (spotlight). */
  caption: boolean;
}

export interface LookBase {
  /** The row's poster at its standard size. */
  w: number;
  h: number;
  /** Space between two tiles. */
  gap: number;
  /** The ranking numeral's room; about half a poster's height by default. */
  lead?: number;
}

/**
 * The tile a look draws on a row whose poster is `base`, at `scale` (a size setting). Every look but the spotlight is
 * as tall as the poster, and as wide as its art needs (16:9 stills, 4:3, square), so the image fits whole.
 */
export function lookBox(look: RowLook, base: LookBase, scale = 1): LookBox {
  const h = Math.round(base.h * (look === "spotlight" ? SPOTLIGHT_SCALE : scale));
  const box = (w: number, art: LookBox["art"], lead = 0, caption = false): LookBox => ({
    w: w + lead,
    h,
    stride: w + lead + base.gap,
    art,
    lead,
    caption,
  });
  switch (look) {
    case "poster":
      return box(Math.round((base.w * h) / base.h), "poster");
    case "landscape":
      return box(Math.round((h * 16) / 9), "still");
    case "square":
      return box(h, "poster");
    case "wide":
      return box(Math.round((h * 4) / 3), "still");
    case "ranking":
      return box(Math.round((base.w * h) / base.h), "poster", Math.round((base.lead ?? base.h * 0.48) * (h / base.h)));
    case "spotlight":
      return box(Math.round((h * 16) / 9), "still", 0, true);
  }
}

/** Row titles that read as a chart: these open as a Top 10 when their look is Automatic. */
const CHART = /\b(top|trending|popular|best|most watched|charts?)\b/i;

export interface LookHints {
  /** The row's title. */
  title: string;
  /** Nuvio's tile shape for a collection row, when it is one. */
  tileShape?: "POSTER" | "LANDSCAPE" | "SQUARE";
  /** The first collection row on the page (pinned ones come first): it is shown as a spotlight. */
  lead?: boolean;
}

/**
 * The Automatic look of a row, from what the row is: the page's first collection a spotlight, a collection of wide
 * art as stills, a chart (Top, Trending, Popular…) as a Top 10 ranking, and posters for everything else.
 */
export function autoLook(h: LookHints): RowLook {
  if (h.tileShape && h.lead) return "spotlight";
  if (CHART.test(h.title)) return "ranking";
  if (h.tileShape === "LANDSCAPE") return "landscape";
  if (h.tileShape === "SQUARE") return "square";
  return "poster";
}

/** The next look in the menu's order, wrapping at both ends. */
export function stepLook(cur: RowLook, dir: 1 | -1, order: readonly RowLook[] = ROW_LOOKS): RowLook {
  const i = Math.max(0, order.indexOf(cur));
  return order[(i + dir + order.length) % order.length];
}
