export interface Focus {
  row: number;
  col: number;
}

export type Dir = "left" | "right" | "up" | "down";

/**
 * Moves focus across rows of different lengths. Vertical moves keep the column,
 * clamped to the new row; empty rows are skipped. Returns the same object when
 * nothing moves, so callers can skip a re-render.
 */
export function move(lengths: readonly number[], at: Focus, dir: Dir): Focus {
  const rowLen = lengths[at.row] ?? 0;
  if (dir === "left") return at.col > 0 ? { row: at.row, col: at.col - 1 } : at;
  if (dir === "right") return at.col < rowLen - 1 ? { row: at.row, col: at.col + 1 } : at;
  const step = dir === "up" ? -1 : 1;
  for (let r = at.row + step; r >= 0 && r < lengths.length; r += step) {
    if (lengths[r] > 0) return { row: r, col: Math.min(at.col, lengths[r] - 1) };
  }
  return at;
}

/**
 * The column a vertical move lands on in a row of `length`: where that row was left (`remembered`), else the same
 * on-screen slot as now. Rows scroll so the focused card sits in the second slot, and a row not visited yet is not
 * scrolled, so that slot is column 1 (or 0): the row never sweeps sideways as focus arrives on it.
 */
export function rowColumn(remembered: number | undefined, col: number, length: number): number {
  const last = Math.max(0, length - 1);
  if (remembered != null) return Math.min(remembered, last);
  return Math.min(col, 1, last);
}

/** The slice of a row worth rendering: the focused card plus a margin each side. */
export function windowOf(col: number, length: number, before = 3, after = 9): [number, number] {
  return [Math.max(0, col - before), Math.min(length, col + after)];
}
