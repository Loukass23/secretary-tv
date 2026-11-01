// Remote navigation for the Nest home screen (docs/launcher.md). Pure so it can be tested.
//
//   header    profile, weather, then Watch together, Search, Lights and Bell, across the top
//   ask       the Ask Assistant button, under the wave (left)
//   row       the content cards (Cinema, Shows, Anime, Home, Reminders, Apps). Left and Right move from card to card;
//             OK goes inside one (`inside`), where an app card offers its Launch button (i = -1) before its items
//   results   what the assistant found, in place of the row while shown
//   menu      the profile menu, while it is open
export type Area = "header" | "ask" | "row" | "results" | "menu";

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
}

export interface Layout {
  /** The weather is shown (and so focusable). */
  weather: boolean;
  ask: number;
  cols: readonly Column[];
  results: number;
  menu: number;
}

export const HEADER_PROFILE = 0;
export const HEADER_WEATHER = 1;
export const HEADER_PARTY = 2;
export const HEADER_SEARCH = 3;
export const HEADER_LIGHTS = 4;
export const HEADER_BELL = 5;
export const HEADER_LENGTH = 6;
/** The Launch button's index inside an app card. */
export const LAUNCH = -1;

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

/** What lies right of the assistant: the answer when one is shown, else the row. */
function rightOfAsk(len: Layout): Focus | null {
  return len.results > 0 ? { area: "results", i: 0 } : rowStart(len);
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
        let next = i + (key === "Right" ? 1 : -1);
        if (next === HEADER_WEATHER && !len.weather) next += key === "Right" ? 1 : -1;
        return next < 0 || next >= HEADER_LENGTH ? at : header(next);
      }
      if (key === "Down") {
        // The profile and the weather sit over the assistant, the buttons over the cards.
        if (i <= HEADER_WEATHER) return len.ask > 0 ? { area: "ask", i: 0 } : (rightOfAsk(len) ?? at);
        return rightOfAsk(len) ?? (len.ask > 0 ? { area: "ask", i: 0 } : at);
      }
      return at;
    }
    case "ask":
      if (key === "Left") return i > 0 ? { area, i: i - 1 } : at;
      if (key === "Right") return i < len.ask - 1 ? { area, i: i + 1 } : (rightOfAsk(len) ?? at);
      if (key === "Up") return header(HEADER_PROFILE);
      return at;
    case "results":
      if (key === "Left") return i > 0 ? { area, i: i - 1 } : len.ask > 0 ? { area: "ask", i: len.ask - 1 } : at;
      if (key === "Right") return i < len.results - 1 ? { area, i: i + 1 } : at;
      if (key === "Up") return header(HEADER_SEARCH);
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
          if (p >= 0) return card(p);
          return len.ask > 0 ? { area: "ask", i: len.ask - 1 } : at;
        }
        if (key === "Up") return header(HEADER_PARTY);
        return at;
      }
      // Inside: the Launch button, then the items as a stack or a grid; the edges keep focus in the card.
      if (i === LAUNCH) {
        if (key === "Down" && col.count > 0) return { ...at, i: 0 };
        if (key === "Up") return card(c);
        return at;
      }
      const a = col.across;
      const x = i % a;
      if (key === "Down") return i + a < col.count ? { ...at, i: i + a } : at;
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
      return at.i === HEADER_WEATHER && !len.weather ? header(HEADER_PROFILE) : at;
    case "ask":
      if (len.ask > at.i) return at;
      break;
    case "results":
      if (len.results > 0) return at.i < len.results ? at : { area: "results", i: len.results - 1 };
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
