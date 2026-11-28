// Pure remote-control navigation for the full-screen Conversation view and the bottom Assistant Dock.
// Tested without a DOM in test/conversation.test.ts.

export type ConversationZone = "results" | "chips" | "controls";

export interface ConversationFocus {
  zone: ConversationZone;
  /** Index inside `chips` or `controls`, or column index inside `results[row]`. */
  i: number;
  /** Row index among conversation turns that carry inline media recommendations (0 = oldest, length - 1 = newest). */
  row?: number;
}

export interface ConversationShape {
  /** Number of inline recommendation posters in each turn that has results (oldest to newest). */
  resultRows: readonly number[];
  /** Number of clickable suggestion/answer chips above the wave. */
  chips: number;
  /** Number of action buttons in the bottom control bar (Speak, Type, Spoken replies). */
  controls: number;
}

export function clampConversation(at: ConversationFocus, shape: ConversationShape): ConversationFocus {
  const nonEmptyRows = shape.resultRows.filter((n) => n > 0);
  if (at.zone === "results") {
    if (!nonEmptyRows.length) {
      return shape.chips > 0 ? { zone: "chips", i: 0 } : { zone: "controls", i: 0 };
    }
    const row = Math.max(0, Math.min(shape.resultRows.length - 1, at.row ?? shape.resultRows.length - 1));
    const len = shape.resultRows[row] ?? 0;
    if (len > 0) return { zone: "results", row, i: Math.max(0, Math.min(len - 1, at.i)) };
    for (let r = shape.resultRows.length - 1; r >= 0; r--) {
      if (shape.resultRows[r] > 0) return { zone: "results", row: r, i: 0 };
    }
    return shape.chips > 0 ? { zone: "chips", i: 0 } : { zone: "controls", i: 0 };
  }
  if (at.zone === "chips") {
    if (shape.chips <= 0) return { zone: "controls", i: 0 };
    return { zone: "chips", i: Math.max(0, Math.min(shape.chips - 1, at.i)) };
  }
  const controls = Math.max(1, shape.controls);
  return { zone: "controls", i: Math.max(0, Math.min(controls - 1, at.i)) };
}

function prevResultRow(rows: readonly number[], from: number): number {
  for (let r = from - 1; r >= 0; r--) if (rows[r] > 0) return r;
  return -1;
}

function nextResultRow(rows: readonly number[], from: number): number {
  for (let r = from + 1; r < rows.length; r++) if (rows[r] > 0) return r;
  return -1;
}

export function stepConversation(at: ConversationFocus, key: string, shape: ConversationShape): ConversationFocus {
  const cur = clampConversation(at, shape);
  const newestRow = prevResultRow(shape.resultRows, shape.resultRows.length);

  if (cur.zone === "controls") {
    if (key === "Left") return cur.i > 0 ? { zone: "controls", i: cur.i - 1 } : cur;
    if (key === "Right") return cur.i < shape.controls - 1 ? { zone: "controls", i: cur.i + 1 } : cur;
    if (key === "Up") {
      if (shape.chips > 0) return { zone: "chips", i: Math.min(cur.i, shape.chips - 1) };
      if (newestRow >= 0) return { zone: "results", row: newestRow, i: 0 };
    }
    return cur;
  }

  if (cur.zone === "chips") {
    if (key === "Left") return cur.i > 0 ? { zone: "chips", i: cur.i - 1 } : cur;
    if (key === "Right") return cur.i < shape.chips - 1 ? { zone: "chips", i: cur.i + 1 } : cur;
    if (key === "Down") return { zone: "controls", i: 0 };
    if (key === "Up" && newestRow >= 0) {
      return { zone: "results", row: newestRow, i: Math.min(cur.i, shape.resultRows[newestRow] - 1) };
    }
    return cur;
  }

  // cur.zone === "results"
  const row = cur.row ?? newestRow;
  const len = shape.resultRows[row] ?? 0;
  if (key === "Left") return cur.i > 0 ? { zone: "results", row, i: cur.i - 1 } : cur;
  if (key === "Right") return cur.i < len - 1 ? { zone: "results", row, i: cur.i + 1 } : cur;
  if (key === "Up") {
    const prev = prevResultRow(shape.resultRows, row);
    return prev >= 0 ? { zone: "results", row: prev, i: Math.min(cur.i, shape.resultRows[prev] - 1) } : cur;
  }
  if (key === "Down") {
    const next = nextResultRow(shape.resultRows, row);
    if (next >= 0) return { zone: "results", row: next, i: Math.min(cur.i, shape.resultRows[next] - 1) };
    return shape.chips > 0
      ? { zone: "chips", i: Math.min(cur.i, shape.chips - 1) }
      : { zone: "controls", i: 0 };
  }
  return cur;
}

/** Items in the bottom Assistant Dock: 0 = Speak, 1..N = dock suggestion chips, N + 1 = Conversation. */
export const dockItemCount = (chipCount: number): number => 2 + Math.max(0, chipCount);

export function stepDock(index: number, key: string, chipCount: number): number | "leave" {
  const total = dockItemCount(chipCount);
  const clamped = Math.max(0, Math.min(total - 1, index));
  if (key === "Up") return "leave";
  if (key === "Left") return Math.max(0, clamped - 1);
  if (key === "Right") return Math.min(total - 1, clamped + 1);
  return clamped;
}
