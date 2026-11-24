// The search screen's remote navigation (search.tsx): the header, the keyboard panel on the right, and on the left
// either the results grid or, before anything is typed, the recent searches.

/** Six keys a row, letters then digits; the last row is Space, Delete and Clear, each two keys wide. */
export const KEY_ROWS: readonly (readonly string[])[] = [
  ["a", "b", "c", "d", "e", "f"],
  ["g", "h", "i", "j", "k", "l"],
  ["m", "n", "o", "p", "q", "r"],
  ["s", "t", "u", "v", "w", "x"],
  ["y", "z", "1", "2", "3", "4"],
  ["5", "6", "7", "8", "9", "0"],
  ["space", "delete", "clear"],
];
export const KEY_COLS = 6;
const ACTIONS = KEY_ROWS.length - 1;

/** Result tiles a row. */
export const RESULT_COLS = 4;

export type SearchFocus =
  | { area: "header"; i: number }
  | { area: "keys"; row: number; col: number }
  | { area: "recent"; i: number }
  | { area: "results"; i: number };

export interface SearchLens {
  results: number;
  /** Recent searches shown, the "Clear" line included; 0 when hidden. */
  recent: number;
  /** Header items: -1 is the person, then the buttons 0..buttons-1. */
  buttons: number;
  /** The search button's index: Up from the keyboard lands there. */
  home: number;
  /** Where the remote last was on the keyboard and in the results, to come back to. */
  lastKey: { row: number; col: number };
  lastResult: number;
}

export const START: SearchFocus = { area: "keys", row: 0, col: 0 };

/** The key under the remote, as typed ("a", "space"), or null. */
export function keyAt(f: SearchFocus): string | null {
  return f.area === "keys" ? (KEY_ROWS[f.row]?.[f.col] ?? null) : null;
}

/** Applies one key to the field's text. */
export function typeKey(text: string, key: string): string {
  if (key === "space") return text && !text.endsWith(" ") ? `${text} ` : text;
  if (key === "delete") return text.slice(0, -1);
  if (key === "clear") return "";
  return text + key;
}

const keys = (row: number, col: number): SearchFocus => ({ area: "keys", row, col });

/** A column moving into or out of the wide last row. */
function keyCol(from: number, to: number, col: number): number {
  if (to === ACTIONS && from !== ACTIONS) return Math.min(KEY_ROWS[ACTIONS].length - 1, Math.floor(col / 2));
  if (from === ACTIONS && to !== ACTIONS) return col * 2;
  return col;
}

/** Into the keyboard from its left edge, on the row the remote was last on. */
const keysFromLeft = (lens: SearchLens): SearchFocus => keys(lens.lastKey.row, 0);

export function step(f: SearchFocus, key: string, lens: SearchLens): SearchFocus {
  switch (f.area) {
    case "header": {
      if (key === "Left") return f.i > -1 ? { area: "header", i: f.i - 1 } : f;
      if (key === "Right") return f.i < lens.buttons - 1 ? { area: "header", i: f.i + 1 } : f;
      if (key === "Down") return keys(lens.lastKey.row, lens.lastKey.col);
      return f;
    }
    case "keys": {
      const width = KEY_ROWS[f.row].length;
      if (key === "Right") return f.col < width - 1 ? keys(f.row, f.col + 1) : f;
      if (key === "Up") return f.row > 0 ? keys(f.row - 1, keyCol(f.row, f.row - 1, f.col)) : { area: "header", i: lens.home };
      if (key === "Down") return f.row < KEY_ROWS.length - 1 ? keys(f.row + 1, keyCol(f.row, f.row + 1, f.col)) : f;
      if (key === "Left") {
        if (f.col > 0) return keys(f.row, f.col - 1);
        if (lens.results > 0) {
          // The rightmost tile of the row the remote was last on.
          const at = Math.min(lens.lastResult, lens.results - 1);
          const rowStart = at - (at % RESULT_COLS);
          return { area: "results", i: Math.min(lens.results - 1, rowStart + RESULT_COLS - 1) };
        }
        if (lens.recent > 0) return { area: "recent", i: Math.min(f.row, lens.recent - 1) };
      }
      return f;
    }
    case "recent": {
      if (key === "Up") return f.i > 0 ? { area: "recent", i: f.i - 1 } : { area: "header", i: lens.home };
      if (key === "Down") return f.i < lens.recent - 1 ? { area: "recent", i: f.i + 1 } : f;
      if (key === "Right") return keysFromLeft(lens);
      return f;
    }
    case "results": {
      const col = f.i % RESULT_COLS;
      if (key === "Left") return col > 0 ? { area: "results", i: f.i - 1 } : f;
      if (key === "Right") return col < RESULT_COLS - 1 && f.i + 1 < lens.results ? { area: "results", i: f.i + 1 } : keysFromLeft(lens);
      if (key === "Up") return f.i >= RESULT_COLS ? { area: "results", i: f.i - RESULT_COLS } : { area: "header", i: lens.home };
      if (key === "Down") {
        if (f.i + RESULT_COLS < lens.results) return { area: "results", i: f.i + RESULT_COLS };
        // A shorter last row: its last tile.
        const lastRow = Math.floor((lens.results - 1) / RESULT_COLS);
        return Math.floor(f.i / RESULT_COLS) < lastRow ? { area: "results", i: lens.results - 1 } : f;
      }
      return f;
    }
  }
}

/** Keeps a focus valid after the results or recent searches change under it. */
export function clamp(f: SearchFocus, lens: SearchLens): SearchFocus {
  if (f.area === "results") {
    if (lens.results > 0) return f.i < lens.results ? f : { area: "results", i: lens.results - 1 };
    return lens.recent > 0 ? { area: "recent", i: 0 } : keysFromLeft(lens);
  }
  if (f.area === "recent") {
    if (lens.recent > 0) return f.i < lens.recent ? f : { area: "recent", i: lens.recent - 1 };
    return lens.results > 0 ? { area: "results", i: 0 } : keysFromLeft(lens);
  }
  return f;
}
