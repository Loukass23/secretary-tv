// A short and a long OK on the same thing. The remote sends no key repeats for a held OK, so a hold is a timer
// from the keydown, cancelled by the keyup (the catalog's collection rows do the same, catalog-kit ui/Home.tsx).
import { useEffect, useRef } from "preact/hooks";

export const HOLD_MS = 600;

type Timers = { set(fn: () => void, ms: number): unknown; clear(t: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export interface OkHold {
  /** OK went down. Repeats and a second press while one is held are ignored. */
  down(): void;
  /** OK came up: a short press if the timer had not fired yet. */
  up(): void;
  /** OK is down (or was held and its keyup has not come yet): its keydowns and keyup are not a new choice. */
  holding(): boolean;
  cancel(): void;
}

/**
 * `onChange` hears the hold begin (the time it began) and end (null: released, cancelled or it fired), so a hold
 * indicator can show while OK is down (HoldPill in tv-kit/glass).
 */
export function createOkHold(
  onShort: () => void,
  onLong: () => void,
  holdMs = HOLD_MS,
  timers: Timers = realTimers,
  onChange?: (since: number | null) => void,
): OkHold {
  let timer: unknown = null;
  let held = false;
  return {
    down() {
      if (timer !== null || held) return;
      timer = timers.set(() => {
        timer = null;
        held = true;
        onLong();
      }, holdMs);
      onChange?.(Date.now());
    },
    up() {
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
        onChange?.(null);
        onShort();
        return;
      }
      if (held) onChange?.(null);
      held = false;
    },
    holding: () => held || timer !== null,
    cancel() {
      if (timer !== null) {
        timers.clear(timer);
      }
      if (timer !== null || held) onChange?.(null);
      timer = null;
      held = false;
    },
  };
}

/**
 * While `active`, OK is split into `onShort` (on the keyup) and `onLong` (after `holdMs` held). The caller's
 * useKeys must ignore Enter while `active`. The keyup is always watched, so a hold that outlives `active`
 * (it opened a menu) still ends.
 */
export function useOkHold(
  active: boolean,
  onShort: () => void,
  onLong: () => void,
  holdMs = HOLD_MS,
  onChange?: (since: number | null) => void,
): OkHold {
  const cb = useRef({ onShort, onLong, onChange });
  cb.current = { onShort, onLong, onChange };
  const hold = useRef<OkHold | null>(null);
  hold.current ??= createOkHold(() => cb.current.onShort(), () => cb.current.onLong(), holdMs, realTimers, (s) => cb.current.onChange?.(s));
  const on = useRef(active);
  on.current = active;
  useEffect(() => {
    const h = hold.current!;
    const down = (e: KeyboardEvent) => {
      if (e.keyCode === 13 && on.current && !e.repeat) h.down();
    };
    const up = (e: KeyboardEvent) => {
      if (e.keyCode === 13) h.up();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      h.cancel();
    };
  }, []);
  return hold.current;
}
