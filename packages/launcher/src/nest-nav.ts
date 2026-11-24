// Remote navigation for the Nest home screen (docs/launcher.md). Pure so it can be tested.
//
//   header    profile, then Watch together, Search, Lights, Picture mode, Sound and Bell, across the top
//   ask       the assistant under the cards (the compact mode), fixed at the bottom centre; Down from a card or the last
//             line inside one goes straight to it, except in an opened media card, whose rows end on a bar of their
//             own (Back to top, Recommend me, See all), and an opened weather card keeps it. What it is asked moves
//             focus to the card concerned
//   chat      the full-screen assistant, opened with OK on the Assistant card (the first card); Back leaves it
//   row       the content cards (Assistant, At a glance, Recent, Cinema, Shows, Anime, Home, Reminders, Apps). Left and
//             Right move from card to card;
//             OK goes inside one (`inside`), where an app card offers its Launch button (i = -1) before its items
//   menu      the profile menu, while it is open
export type Area = "header" | "ask" | "chat" | "row" | "menu";

export interface Focus {
  area: Area;
  i: number;
  /** The card, for the row. */
  col?: number;
  /** Inside the card (on its Launch button or items) rather than on the card as a whole. */
  inside?: boolean;
}

/** A card of the row: how many items it has, laid out `across` to a line, and whether it has a Launch button. */
export interface Column {
  count: number;
  across: number;
  launch?: boolean;
  /**
   * An opened card of several rows (Cinema, Shows, Anime: the picks and Open, then My List and the genres): how many
   * items each row has, in order. `i` then counts across all of them; Up and Down move between rows.
   */
  rows?: readonly number[];
  /** An opened card that keeps the remote (the weather's detail): Down stays in it rather than going to the assistant. */
  hold?: boolean;
}

/** Which row item `i` is on and where in it, for a column with `rows`. */
export function rowAt(rows: readonly number[], i: number): { r: number; x: number; start: number } {
  let start = 0;
  for (let r = 0; r < rows.length; r++) {
    if (i < start + rows[r] || r === rows.length - 1) return { r, x: Math.max(0, i - start), start };
    start += rows[r];
  }
  return { r: 0, x: 0, start: 0 };
}

export interface Layout {
  ask: number;
  cols: readonly Column[];
  menu: number;
}

export const HEADER_PROFILE = 0;
export const HEADER_PARTY = 1;
export const HEADER_SEARCH = 2;
export const HEADER_LIGHTS = 3;
export const HEADER_PICTURE = 4;
export const HEADER_SOUND = 5;
export const HEADER_SETTINGS = 6;
export const HEADER_BELL = 7;
export const HEADER_LENGTH = 8;
/** The Launch button's index inside an app card. */
export const LAUNCH = -1;
/** The bar under an opened media card's last row, left to right: Back to top, Recommend me, See all. */
export const END_TOP = -3;
export const END_RECOMMEND = -4;
export const END_ALL = -5;
export const END_BUTTONS = [END_TOP, END_RECOMMEND, END_ALL] as const;
export const atEnd = (i: number) => (END_BUTTONS as readonly number[]).includes(i);

const header = (i: number): Focus => ({ area: "header", i });
const card = (col: number): Focus => ({ area: "row", col, i: 0 });
const has = (c: Column | undefined) => Boolean(c && (c.count > 0 || c.launch));

/** The first card with something in it, from `from` towards `dir`; -1 when none. */
function columnFrom(cols: readonly Column[], from: number, dir: 1 | -1): number {
  for (let c = from; c >= 0 && c < cols.length; c += dir) if (has(cols[c])) return c;
  return -1;
}

/** The first card of the row, or null when it is empty. */
function rowStart(len: Layout): Focus | null {
  const c = columnFrom(len.cols, 0, 1);
  return c < 0 ? null : card(c);
}

/** OK on a card: inside it, on its Launch button when it has one, else on its first item. */
export function enter(at: Focus, len: Layout): Focus {
  const col = len.cols[at.col ?? 0];
  if (at.area !== "row" || at.inside || !col) return at;
  return { area: "row", col: at.col, i: col.launch ? LAUNCH : 0, inside: true };
}

/** Back inside a card: the card again. */
export function leave(at: Focus): Focus {
  return at.area === "row" && at.inside ? card(at.col ?? 0) : at;
}

export function step(at: Focus, key: string, len: Layout): Focus {
  const { area, i } = at;
  switch (area) {
    case "header": {
      if (key === "Left" || key === "Right") {
        const next = i + (key === "Right" ? 1 : -1);
        return next < 0 || next >= HEADER_LENGTH ? at : header(next);
      }
      if (key === "Down") return rowStart(len) ?? (len.ask > 0 ? { area: "ask", i: 0 } : at);
      return at;
    }
    case "ask":
      // Fixed at the bottom of the screen: Up goes back to the cards above it.
      if (key === "Left") return i > 0 ? { area, i: i - 1 } : at;
      if (key === "Right") return i < len.ask - 1 ? { area, i: i + 1 } : at;
      if (key === "Up") return rowStart(len) ?? header(HEADER_PROFILE);
      return at;
    case "chat":
      // The full-screen assistant keeps the arrows to itself; Back leaves it (app.tsx).
      return at;
    case "menu":
      if (key === "Up") return i > 0 ? { area, i: i - 1 } : at;
      if (key === "Down") return i < len.menu - 1 ? { area, i: i + 1 } : at;
      return at;
    case "row": {
      const c = at.col ?? 0;
      const col = len.cols[c];
      if (!col) return at;
      if (!at.inside) {
        // Card by card.
        if (key === "Right") {
          const n = columnFrom(len.cols, c + 1, 1);
          return n < 0 ? at : card(n);
        }
        if (key === "Left") {
          const p = columnFrom(len.cols, c - 1, -1);
          return p >= 0 ? card(p) : at;
        }
        if (key === "Up") return header(HEADER_PARTY);
        if (key === "Down" && len.ask > 0) return { area: "ask", i: 0 };
        return at;
      }
      // Inside: the Launch button, then the items as a stack or a grid; the sides keep focus in the card, and Down
      // from the last line goes to the assistant.
      const toAsk: Focus = len.ask > 0 && !col.hold ? { area: "ask", i: 0 } : at;
      if (i === LAUNCH) {
        if (key === "Down") return col.count > 0 ? { ...at, i: 0 } : toAsk;
        if (key === "Up") return card(c);
        return at;
      }
      if (col.rows) {
        // The end bar: its buttons side by side; Up goes back to the start of the last row, Down stays.
        if (atEnd(i)) {
          const b = END_BUTTONS.indexOf(i as (typeof END_BUTTONS)[number]);
          if (key === "Left") return b > 0 ? { ...at, i: END_BUTTONS[b - 1] } : at;
          if (key === "Right") return b < END_BUTTONS.length - 1 ? { ...at, i: END_BUTTONS[b + 1] } : at;
          if (key === "Up") return { ...at, i: col.rows.slice(0, -1).reduce((s, n) => s + n, 0) };
          return at;
        }
        const { r, x, start } = rowAt(col.rows, i);
        const len = col.rows[r];
        if (key === "Down") return r + 1 < col.rows.length ? { ...at, i: start + len + Math.min(x, col.rows[r + 1] - 1) } : { ...at, i: END_TOP };
        if (key === "Up") return r > 0 ? { ...at, i: start - col.rows[r - 1] + Math.min(x, col.rows[r - 1] - 1) } : col.launch ? { ...at, i: LAUNCH } : card(c);
        if (key === "Right") return x < len - 1 ? { ...at, i: i + 1 } : at;
        if (key === "Left") return x > 0 ? { ...at, i: i - 1 } : at;
        return at;
      }
      const a = col.across;
      const x = i % a;
      if (key === "Down") return i + a < col.count ? { ...at, i: i + a } : toAsk;
      if (key === "Up") return i - a >= 0 ? { ...at, i: i - a } : col.launch ? { ...at, i: LAUNCH } : card(c);
      if (key === "Right") return x < a - 1 && i + 1 < col.count ? { ...at, i: i + 1 } : at;
      if (key === "Left") return x > 0 ? { ...at, i: i - 1 } : at;
      return at;
    }
  }
}

/** Keeps focus valid when an area shrinks or empties (reminders done, results closed, a card emptied). */
export function clamp(at: Focus, len: Layout): Focus {
  switch (at.area) {
    case "header":
    case "chat":
      return at;
    case "ask":
      if (len.ask > at.i) return at;
      break;
    case "menu":
      if (len.menu > 0) return at.i < len.menu ? at : { area: "menu", i: len.menu - 1 };
      break;
    case "row": {
      const c = at.col ?? 0;
      const col = len.cols[c];
      if (has(col)) {
        if (!at.inside) return at.i === 0 ? at : card(c);
        if (at.i === LAUNCH) return col!.launch ? at : col!.count > 0 ? { ...at, i: 0 } : card(c);
        if (at.i < col!.count) return at;
        return col!.count > 0 ? { ...at, i: col!.count - 1 } : col!.launch ? { ...at, i: LAUNCH } : card(c);
      }
      // The card emptied: the nearest one with something in it, right first.
      const n = columnFrom(len.cols, c, 1);
      const p = columnFrom(len.cols, c, -1);
      const to = n >= 0 ? n : p;
      if (to >= 0) return card(to);
      break;
    }
  }
  return rowStart(len) ?? (len.ask > 0 ? { area: "ask", i: 0 } : header(HEADER_PROFILE));
}
