// How a row of an opened media card is drawn (a long OK on a title, the "Row look" line). The shapes are the catalog
// apps' card shapes (catalog-kit collectionlayout: poster, landscape, square, the 4:3 highlight) plus a ranking with
// big numerals, the idea of Nuvio Legacy's ranking view; each row keeps its own choice on this TV. Pure, so it is unit
// tested; cards.tsx draws what these boxes say.
import { EXPANDED } from "./card-style.ts";

export const ROW_SHAPES = ["poster", "landscape", "square", "wide", "ranking"] as const;
export type RowShape = (typeof ROW_SHAPES)[number];

export const ROW_SHAPE_LABEL: Record<RowShape, string> = {
  poster: "Poster",
  landscape: "Landscape",
  square: "Square",
  wide: "Highlight 4:3",
  ranking: "Ranking",
};

export const ROW_LOOKS_KEY = "nest.rowLooks";

export interface TileBox {
  /** The tile's width, the ranking numeral's room included. */
  w: number;
  h: number;
  /** From one tile's left edge to the next. */
  stride: number;
  /** Which art it shows: the portrait poster, or the landscape still (poster when a title has none). */
  art: "poster" | "still";
  /** Room on the left for a ranking numeral. */
  lead: number;
}

const GAP = EXPANDED.stride - EXPANDED.w;
const LEAD = 96;

/** Every row is as tall as the poster row; shorter shapes sit on its bottom edge, so the caption stays close. */
export function tileBox(shape: RowShape): TileBox {
  const H = EXPANDED.h;
  const box = (w: number, h: number, art: TileBox["art"], lead = 0): TileBox => ({ w: w + lead, h, stride: w + lead + GAP, art, lead });
  switch (shape) {
    case "poster":
      return box(EXPANDED.w, H, "poster");
    case "landscape":
      return box(560, 315, "still");
    case "square":
      return box(340, 340, "poster");
    case "wide":
      return box(450, 338, "still");
    case "ranking":
      return box(EXPANDED.w, H, "poster", LEAD);
  }
}

const isShape = (v: unknown): v is RowShape => ROW_SHAPES.includes(v as RowShape);

/** The looks the TV keeps, by row key (`<card>/<row>`); anything unreadable is dropped. */
export function loadRowLooks(store: { getItem(k: string): string | null }): Record<string, RowShape> {
  try {
    const raw = JSON.parse(store.getItem(ROW_LOOKS_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, RowShape] => isShape(e[1])));
  } catch {
    return {};
  }
}

export function saveRowLooks(store: { setItem(k: string, v: string): void }, looks: Record<string, RowShape>): void {
  try {
    store.setItem(ROW_LOOKS_KEY, JSON.stringify(looks));
  } catch {
    // the look holds until the next start
  }
}

export const rowShape = (looks: Record<string, RowShape>, key: string): RowShape => looks[key] ?? "poster";

/** The next shape in the menu's order, wrapping at both ends. */
export function stepShape(cur: RowShape, dir: 1 | -1): RowShape {
  return ROW_SHAPES[(ROW_SHAPES.indexOf(cur) + dir + ROW_SHAPES.length) % ROW_SHAPES.length];
}
