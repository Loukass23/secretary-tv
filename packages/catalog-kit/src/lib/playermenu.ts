// The player's options menu as data and key rules, kept apart from ui/PlayerMenu.tsx so they can be tested.

export interface MenuRow {
  id: string;
  label: string;
  /** What the row is set to, shown at its right edge. */
  value?: string;
  /** The row is the one in use, in a list of choices. */
  checked?: boolean;
  /** Enter opens this page instead of choosing the row. */
  go?: string;
  /** Left and Right change the value in place (a cycle), as well as Enter. */
  cycles?: boolean;
}

export interface MenuPage {
  id: string;
  title: string;
  rows: MenuRow[];
  /** One line under the rows when there are none. */
  empty?: string;
}

export interface MenuState {
  /** The pages opened so far, the first being the top one. */
  stack: string[];
  row: number;
}

export type MenuKey = "Up" | "Down" | "Left" | "Right" | "Enter" | "Back";

export interface MenuStep {
  state: MenuState;
  /** A row was chosen (Enter) or cycled (Left/Right, with its direction). */
  pick?: { page: string; row: MenuRow; dir: -1 | 0 | 1 };
  close?: boolean;
}

export const TOP_PAGE = "top";
export const startMenu = (): MenuState => ({ stack: [TOP_PAGE], row: 0 });

/** The row a page opens on: the one in use for a list of choices, the first otherwise. */
export const openingRow = (page: MenuPage | undefined): number => Math.max(0, page?.rows.findIndex((r) => r.checked) ?? 0);

/**
 * One key in the menu. Up and Down stop at the ends, Enter opens a page or chooses a row, Left and Right cycle a row that
 * allows it, Back goes up a page and closes from the top one.
 */
export function stepMenu(state: MenuState, key: MenuKey, pageOf: (id: string) => MenuPage | undefined): MenuStep {
  const id = state.stack[state.stack.length - 1];
  const page = pageOf(id);
  const rows = page?.rows ?? [];
  if (key === "Back") {
    if (state.stack.length <= 1) return { state, close: true };
    const stack = state.stack.slice(0, -1);
    const up = pageOf(stack[stack.length - 1]);
    // Back from a page lands on the row that opened it.
    const row = Math.max(0, up?.rows.findIndex((r) => r.go === id) ?? 0);
    return { state: { stack, row } };
  }
  if (key === "Up") return { state: { ...state, row: Math.max(0, state.row - 1) } };
  if (key === "Down") return { state: { ...state, row: Math.max(0, Math.min(rows.length - 1, state.row + 1)) } };
  const row = rows[state.row];
  if (!row) return { state };
  if (key === "Left" || key === "Right") {
    return row.cycles ? { state, pick: { page: id, row, dir: key === "Left" ? -1 : 1 } } : { state };
  }
  if (row.go) {
    const next = pageOf(row.go);
    return { state: { stack: [...state.stack, row.go], row: openingRow(next) } };
  }
  return { state, pick: { page: id, row, dir: row.cycles ? 1 : 0 } };
}

/** At most `size` rows, around the focused one, so a long list never renders in full. */
export function windowRows<T>(rows: readonly T[], focus: number, size: number): { from: number; rows: T[] } {
  const from = Math.max(0, Math.min(rows.length - size, focus - Math.floor(size / 2)));
  return { from, rows: rows.slice(from, from + size) };
}

/** What the room can do from the player; absent parts are not offered. Built by app.tsx from the home grant Nest sent. */
export interface PlayerRoom {
  /** The side lights, when playback already runs them (Settings › Lights while playing). */
  lights: boolean;
  /** The movie and restore scenes Nest picked. */
  scenes: boolean;
  softLights(): void;
  darkLights(): void;
  movieScene(): void;
  restoreScene(): void;
}

/** The menu opened straight on one page (the pause menu's Subtitles or Audio): Back from it closes the menu. */
export const menuAt = (page: string, pageOf: (id: string) => MenuPage | undefined): MenuState =>
  page === TOP_PAGE ? startMenu() : { stack: [page], row: openingRow(pageOf(page)) };
