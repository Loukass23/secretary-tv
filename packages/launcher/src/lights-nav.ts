// Moving around the Lights panel (lights.tsx): the light effects as a list on the left, and on the right the routines
// (one row) over the lights by room (rows of up to two). Plain data, so it is tested without a DOM.
import { type Dir, move } from "@secretary/tv-kit/src/grid.ts";

export type LightsFocus = { area: "fx"; i: number } | { area: "grid"; row: number; col: number };

/** Where each side was last, so Left and Right come back to the same place. */
export interface LightsMemo {
  fx: number;
  grid: { row: number; col: number };
}

/**
 * One arrow key. Up and Down go along the effects; Right leaves them for the right side, Left at a row's start comes
 * back. "header" is Up from the top of either side; `at` is returned unchanged when nothing moves.
 */
export function stepLights(at: LightsFocus, key: string, fxCount: number, lengths: readonly number[], memo: LightsMemo): LightsFocus | "header" {
  if (at.area === "fx") {
    if (key === "Up") return at.i > 0 ? { area: "fx", i: at.i - 1 } : "header";
    if (key === "Down") return at.i < fxCount - 1 ? { area: "fx", i: at.i + 1 } : at;
    if (key === "Right" && lengths.length) {
      const row = Math.min(memo.grid.row, lengths.length - 1);
      return { area: "grid", row, col: Math.min(memo.grid.col, lengths[row] - 1) };
    }
    return at;
  }
  if (key === "Left" && at.col === 0) return { area: "fx", i: Math.min(memo.fx, fxCount - 1) };
  if (key === "Up" && at.row === 0) return "header";
  const dir = ({ Left: "left", Right: "right", Up: "up", Down: "down" } as Record<string, Dir>)[key];
  if (!dir) return at;
  const next = move(lengths, { row: at.row, col: at.col }, dir);
  return next.row === at.row && next.col === at.col ? at : { area: "grid", row: next.row, col: next.col };
}

/** A focus kept inside a grid that changed shape (rooms arriving, a device gone). */
export function clampLights(at: LightsFocus, fxCount: number, lengths: readonly number[]): LightsFocus {
  if (at.area === "fx") return { area: "fx", i: Math.max(0, Math.min(at.i, fxCount - 1)) };
  if (!lengths.length) return { area: "fx", i: 0 };
  const row = Math.min(at.row, lengths.length - 1);
  return { area: "grid", row, col: Math.min(at.col, lengths[row] - 1) };
}
