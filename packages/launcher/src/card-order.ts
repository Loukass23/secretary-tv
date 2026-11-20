// The order of the home row, as the viewer set it (a long OK on a card, "Move", then Left and Right). The Assistant card
// always leads and "Add to home" always ends the row; everything between can be moved. Pure, so it is unit tested;
// app.tsx applies it to the row it builds.

export const ORDER_KEY = "nest.cardOrder";

const FIRST = "assistant";
const LAST = "add";

/** Whether a card can be moved: the Assistant and "Add to home" keep their places. */
export const canMove = (key: string): boolean => key !== FIRST && key !== LAST;

/** The saved order; anything unreadable is dropped. */
export function loadOrder(store: { getItem(k: string): string | null }): string[] {
  try {
    const raw = JSON.parse(store.getItem(ORDER_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function saveOrder(store: { setItem(k: string, v: string): void }, order: readonly string[]): void {
  try {
    store.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // the order holds until the next start
  }
}

/**
 * The row in the saved order. Cards the order does not know (new ones) stay where the row put them: the saved keys
 * fill, in their saved order, the places the known cards had. Saved keys that are not on the row (removed cards) are ignored.
 */
export function applyOrder<T extends { key: string }>(row: readonly T[], order: readonly string[]): T[] {
  const rank = new Map<string, number>();
  order.forEach((k, i) => {
    if (!rank.has(k)) rank.set(k, i);
  });
  const slots: number[] = [];
  const known: T[] = [];
  row.forEach((c, i) => {
    if (canMove(c.key) && rank.has(c.key)) {
      slots.push(i);
      known.push(c);
    }
  });
  known.sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
  const out = [...row];
  slots.forEach((at, i) => {
    out[at] = known[i];
  });
  return out;
}

/** The row's keys with `key` swapped one place toward `dir`; it stops at the Assistant and at "Add to home". */
export function moveKey(keys: readonly string[], key: string, dir: -1 | 1): string[] {
  const at = keys.indexOf(key);
  const to = at + dir;
  if (at < 0 || !canMove(key) || to < 0 || to >= keys.length || !canMove(keys[to])) return [...keys];
  const out = [...keys];
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}

/** The order to keep after the row is `keys`: those, then the saved keys of cards that are off the row (so a card put back finds its place). */
export function keepOrder(keys: readonly string[], saved: readonly string[]): string[] {
  return [...keys.filter(canMove), ...saved.filter((k) => !keys.includes(k))];
}
