// The TV's half of the phone keyboard (server/src/phone-keys.ts): the search screen shows a QR code for Secretary
// Desk's /type/<code> page, and reads what is typed there back while the search is open.
import type { Timers } from "./live-search.ts";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A fresh code for one open search: 16 characters, about 79 bits. */
export function typeCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(16), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** The page the QR code opens on the phone. */
export const phoneUrl = (server: string, code: string) => `${server}/type/${code}`;

export interface PhoneWatch {
  every?: number;
  fetch?: typeof fetch;
  timers?: Timers;
}

/**
 * Asks the server for the phone's text every `every` ms (one request at a time) and calls `onText` each time the phone
 * has written something new. Returns the stop function.
 */
export function watchPhone(server: string, code: string, onText: (text: string) => void, opts: PhoneWatch = {}): () => void {
  const every = opts.every ?? 900;
  const f = opts.fetch ?? fetch;
  const timers: Timers = opts.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const ctrl = new AbortController();
  let rev = 0;
  let timer: unknown = null;
  const tick = async () => {
    timer = null;
    try {
      const res = await f(`${phoneUrl(server, code)}/text`, { signal: ctrl.signal });
      if (res.ok) {
        const t = (await res.json()) as { text?: unknown; rev?: unknown };
        if (typeof t.rev === "number" && t.rev > rev && typeof t.text === "string") {
          rev = t.rev;
          if (!ctrl.signal.aborted) onText(t.text);
        }
      }
    } catch {
      // Offline for a moment: ask again next time.
    }
    if (!ctrl.signal.aborted) timer = timers.set(tick, every);
  };
  timer = timers.set(tick, every);
  return () => {
    ctrl.abort();
    if (timer != null) timers.clear(timer);
  };
}
