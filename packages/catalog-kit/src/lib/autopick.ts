/** Thrown by an attempt for a source its check already turned down: the next one is tried without using a try. */
export class SkipSource extends Error {}

export interface TryOptions {
  /** How many sources to try before giving up. */
  max: number;
  onTry?: (index: number, total: number) => void;
  /** Checked between attempts; set when the viewer backs out. */
  cancelled?: () => boolean;
}

/**
 * Tries the ranked sources one at a time and returns the index of the first
 * that starts, or null. A failing source costs at most its own timeout; `max`
 * counts real tries, so sources skipped by their check (SkipSource) are free.
 */
export async function tryInOrder<T>(
  items: readonly T[],
  attempt: (item: T, index: number) => Promise<void>,
  { max, onTry, cancelled }: TryOptions,
): Promise<number | null> {
  let tries = 0;
  for (let i = 0; i < items.length && tries < max; i++) {
    if (cancelled?.()) return null;
    onTry?.(i, items.length);
    try {
      await attempt(items[i], i);
      return i;
    } catch (err) {
      if (err instanceof SkipSource) {
        console.info(`[autopick] source ${i + 1}/${items.length} skipped: ${err.message}`);
        continue;
      }
      tries++;
      console.warn(`[autopick] source ${i + 1}/${items.length} failed`, err);
    }
  }
  return null;
}
