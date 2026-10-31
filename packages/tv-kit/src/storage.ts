// localStorage can throw (private windows, quota) and is synchronous: callers
// treat a miss as "no data" and never write while the user is moving focus.
export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or unavailable: the cache is an optimisation only.
  }
}

/** Runs `fn` when the main thread is idle, falling back to a short timeout. */
export function whenIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(fn);
  else setTimeout(fn, 200);
}
