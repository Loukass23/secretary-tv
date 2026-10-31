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

/** The slice of a row worth rendering: the focused card plus a margin each side. */
export function windowOf(col: number, length: number, before = 3, after = 9): [number, number] {
  return [Math.max(0, col - before), Math.min(length, col + after)];
}
