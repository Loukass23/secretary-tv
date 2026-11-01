// Remote navigation for the Nest home screen (docs/launcher.md). Pure so it can be tested.
//
//   header    profile, weather, then Watch together, Search, Lights and Bell, across the top
//   ask       the Ask Nest chips, under the wave (left)
//   row       the content cards (Cinema, Shows, Anime, Home, Reminders, Apps): columns of stacked or grid items
//   results   what the assistant found, in place of the row while shown
//   menu      the profile menu, while it is open
export type Area = "header" | "ask" | "row" | "results" | "menu";

export interface Focus {
  area: Area;
  i: number;
  /** The column, for the row. */
  col?: number;
}

/** A column of the row: how many items it has, laid out `across` to a line (1 for a stack, 3 for a 3-wide grid). */
export interface Column {
  count: number;
  across: number;
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

const header = (i: number): Focus => ({ area: "header", i });

/** The first column with items, from `from` towards `dir`; -1 when none. */
function columnFrom(cols: readonly Column[], from: number, dir: 1 | -1): number {
  for (let c = from; c >= 0 && c < cols.length; c += dir) if (cols[c].count > 0) return c;
  return -1;
}

/** The first focusable spot of the row, or null when it is empty. */
function rowStart(len: Layout): Focus | null {
  const c = columnFrom(len.cols, 0, 1);
  return c < 0 ? null : { area: "row", col: c, i: 0 };
}

/** What lies right of the assistant: the answer when one is shown, else the row. */
function rightOfAsk(len: Layout): Focus | null {
  return len.results > 0 ? { area: "results", i: 0 } : rowStart(len);
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
      const a = col.across;
      const line = Math.floor(i / a);
      const x = i % a;
      if (key === "Down") return i + a < col.count ? { area, col: c, i: i + a } : at;
      if (key === "Up") return i - a >= 0 ? { area, col: c, i: i - a } : header(HEADER_PARTY);
      if (key === "Right") {
        if (x < a - 1 && i + 1 < col.count) return { area, col: c, i: i + 1 };
        const n = columnFrom(len.cols, c + 1, 1);
        if (n < 0) return at;
        const next = len.cols[n];
        // The same line in the next column, its first item.
        const l = Math.min(line, Math.ceil(next.count / next.across) - 1);
        return { area, col: n, i: Math.min(l * next.across, next.count - 1) };
      }
      if (key === "Left") {
        if (x > 0) return { area, col: c, i: i - 1 };
        const p = columnFrom(len.cols, c - 1, -1);
        if (p < 0) return len.ask > 0 ? { area: "ask", i: len.ask - 1 } : at;
        const prev = len.cols[p];
        // The same line in the previous column, its last item.
        const l = Math.min(line, Math.ceil(prev.count / prev.across) - 1);
        return { area, col: p, i: Math.min(l * prev.across + prev.across - 1, prev.count - 1) };
      }
      return at;
    }
  }
}

/** Keeps focus valid when an area shrinks or empties (reminders done, results closed, a column emptied). */
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
      if (col && col.count > 0) return at.i < col.count ? at : { area: "row", col: c, i: col.count - 1 };
      // The column emptied: the nearest one with items, right first.
      const n = columnFrom(len.cols, c, 1);
      const p = columnFrom(len.cols, c, -1);
      const to = n >= 0 ? n : p;
      if (to >= 0) return { area: "row", col: to, i: 0 };
      break;
    }
  }
  return rowStart(len) ?? (len.ask > 0 ? { area: "ask", i: 0 } : header(HEADER_PROFILE));
}
