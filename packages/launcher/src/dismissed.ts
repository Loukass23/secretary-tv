// The suggestions the viewer removed from a media card's picks (the title menu's "Remove from suggestions"). Pure, so it
// is unit tested; app.tsx filters tonight's picks with it and the next trending title takes the place.

export const DISMISSED_KEY = "nest.dismissedPicks";
/** The most the TV keeps: the oldest go first. */
export const DISMISSED_MAX = 300;

export function loadDismissed(store: { getItem(k: string): string | null }): string[] {
  try {
    const raw = JSON.parse(store.getItem(DISMISSED_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string").slice(-DISMISSED_MAX) : [];
  } catch {
    return [];
  }
}

export function saveDismissed(store: { setItem(k: string, v: string): void }, ids: readonly string[]): void {
  try {
    store.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // the choice holds until the next start
  }
}

/** `ids` with `id` added (once, newest last, capped). */
export const dismiss = (ids: readonly string[], id: string): string[] => [...ids.filter((k) => k !== id), id].slice(-DISMISSED_MAX);
