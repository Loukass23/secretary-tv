// How a row of an opened media card is drawn (a long OK on a title, the "Row look" line). The shapes are the catalog
// apps' card shapes (catalog-kit collectionlayout: poster, landscape, square, the 4:3 highlight) plus a ranking with
// big numerals, the idea of Nuvio Legacy's ranking view; each row keeps its own choice on this TV. Pure, so it is unit
// tested; cards.tsx draws what these boxes say.
import { lookBox, type LookBox, ROW_LOOK_LABEL } from "@secretary/tv-kit/src/row-look.ts";
import { EXPANDED } from "./card-style.ts";

/** The shared looks (tv-kit/src/row-look.ts) an opened card can take; the spotlight is taller than the card allows. */
export const ROW_SHAPES = ["poster", "landscape", "square", "wide", "ranking"] as const;
export type RowShape = (typeof ROW_SHAPES)[number];

export const ROW_SHAPE_LABEL: Record<RowShape, string> = {
  poster: ROW_LOOK_LABEL.poster,
  landscape: ROW_LOOK_LABEL.landscape,
  square: ROW_LOOK_LABEL.square,
  wide: ROW_LOOK_LABEL.wide,
  ranking: ROW_LOOK_LABEL.ranking,
};

export const ROW_LOOKS_KEY = "nest.rowLooks";

export type TileBox = LookBox;

const GAP = EXPANDED.stride - EXPANDED.w;
const LEAD = 96;

/** Every shape is as tall as the poster, and as wide as its art needs (16:9 stills, 4:3, square), so the image fits whole. */
export const tileBox = (shape: RowShape): TileBox => lookBox(shape, { w: EXPANDED.w, h: EXPANDED.h, gap: GAP, lead: LEAD });

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
