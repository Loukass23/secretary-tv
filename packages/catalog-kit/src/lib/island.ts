/**
 * The island's messages: short lines at the top of the screen ("Example Provider failed", "Playing your source from last
 * time"). One shows at a time for about 4 s; errors go before the rest; a message with the key of one showing or
 * waiting updates it in place. Pure, with an injected clock, so the tests and ui/Island.tsx share it.
 */

export interface IslandMessage {
  /** Messages with the same key replace each other. */
  key: string;
  text: string;
  level: "error" | "info";
  /** How long it shows; 4 s when not given. */
  ms?: number;
}

export const ISLAND_MS = 4000;
const MAX_WAITING = 6;

export function createIsland(now: () => number = Date.now) {
  let showing: (IslandMessage & { until: number }) | null = null;
  let waiting: IslandMessage[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of listeners) l();
  };

  /** Moves on when the message showing has had its time. */
  function advance(): void {
    if (showing && now() < showing.until) return;
    const next = waiting.shift();
    showing = next ? { ...next, until: now() + (next.ms ?? ISLAND_MS) } : null;
  }

  return {
    push(m: IslandMessage): void {
      if (showing?.key === m.key) {
        // The same subject again: the new text in place, and its time starts over.
        showing = { ...m, until: now() + (m.ms ?? ISLAND_MS) };
      } else {
        const at = waiting.findIndex((w) => w.key === m.key);
        if (at >= 0) waiting[at] = m;
        else if (m.level === "error") {
          // Before every waiting info, after the errors already waiting.
          const firstInfo = waiting.findIndex((w) => w.level !== "error");
          waiting.splice(firstInfo < 0 ? waiting.length : firstInfo, 0, m);
        } else waiting.push(m);
        // Too many: the oldest waiting info goes, then the oldest error.
        while (waiting.length > MAX_WAITING) {
          const info = waiting.findIndex((w) => w.level !== "error");
          waiting.splice(info >= 0 ? info : 0, 1);
        }
      }
      advance();
      changed();
    },
    /** The message to show now, if any. */
    current(): IslandMessage | null {
      advance();
      return showing;
    },
    /** When the message showing ends, for the view's timer. */
    endsAt: () => showing?.until ?? null,
    waitingCount: () => waiting.length,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export type Island = ReturnType<typeof createIsland>;
