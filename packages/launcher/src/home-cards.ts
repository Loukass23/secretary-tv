// Which elements the home row holds, and which the viewer took off it (a long OK on a card, "Remove from home"). The
// last card, "Add to home", lists the removed ones and puts them back. Pure, so it is unit tested; app.tsx builds the row.

export const HIDDEN_KEY = "nest.hiddenCards";

/** The elements the viewer can remove and add back, in row order. */
export const ELEMENTS = [
  { key: "weather", label: "Weather" },
  { key: "calendar", label: "Calendar" },
  { key: "recent", label: "Recent" },
  { key: "cinema", label: "Cinema" },
  { key: "shows", label: "Shows" },
  { key: "anime", label: "Anime" },
  { key: "youtube", label: "YouTube" },
  { key: "home", label: "Home" },
  { key: "reminders", label: "Reminders" },
  { key: "apps", label: "Apps" },
] as const;

/** The Assistant card (the way into the chat) and the "Add to home" card (the way back for the rest) always stay.
 *  A Nuvio collection card (`nuvio:<id>`, src/collections.ts) can come off too. */
export const canRemove = (key: string): boolean => ELEMENTS.some((e) => e.key === key) || key.startsWith("nuvio:");

export const labelOf = (key: string): string => ELEMENTS.find((e) => e.key === key)?.label ?? key;

/** The removed elements the TV keeps; anything unreadable or unknown is dropped. */
export function loadHidden(store: { getItem(k: string): string | null }): string[] {
  try {
    const raw = JSON.parse(store.getItem(HIDDEN_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string" && canRemove(k)) : [];
  } catch {
    return [];
  }
}

export function saveHidden(store: { setItem(k: string, v: string): void }, hidden: readonly string[]): void {
  try {
    store.setItem(HIDDEN_KEY, JSON.stringify(hidden));
  } catch {
    // the choice holds until the next start
  }
}

/** The elements to offer on the "Add to home" card: the removed ones, in row order, then removed collections (`named`: their labels). */
export const removed = (hidden: readonly string[], named: readonly { key: string; label: string }[] = []): { key: string; label: string }[] => [
  ...ELEMENTS.filter((e) => hidden.includes(e.key)),
  ...named.filter((n) => hidden.includes(n.key)),
];
