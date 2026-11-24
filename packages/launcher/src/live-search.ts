// Search as you type, without a request per keystroke (search.tsx). Requests are throttled: at most one every `wait` ms
// while the viewer types, and always one for the last thing typed. Starting a request aborts the one before it, and an
// answer that comes back after a newer request started is dropped, so the results never jump back to an older query.
// A few answers are kept, so Delete back to an earlier query shows its results again at once.

export interface LiveSearchState<T> {
  /** What the viewer has typed, trimmed. */
  query: string;
  /** The latest answer: for `answered`, which can trail `query` while a newer request runs. */
  results: readonly T[];
  /** The query `results` answer. */
  answered: string;
  /** A request for `query` is waiting or running. */
  searching: boolean;
  /** The request for `answered` failed. */
  failed: boolean;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LiveSearchOptions<T> {
  find(query: string, signal: AbortSignal): Promise<readonly T[]>;
  onChange(state: LiveSearchState<T>): void;
  /** At most one request per this many ms while typing. Default 300. */
  wait?: number;
  /** Shorter queries ask nothing and show no results. Default 2. */
  min?: number;
  /** Answers kept by query. Default 24. */
  keep?: number;
  timers?: Timers;
  now?: () => number;
}

export interface LiveSearch {
  /** The text in the field; call it on every change. */
  set(query: string): void;
  /** Stops the timer and aborts what is running. */
  dispose(): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function liveSearch<T>(opts: LiveSearchOptions<T>): LiveSearch {
  const wait = opts.wait ?? 300;
  const min = opts.min ?? 2;
  const keep = opts.keep ?? 24;
  const timers = opts.timers ?? realTimers;
  const now = opts.now ?? (() => Date.now());
  const cache = new Map<string, readonly T[]>();

  let query = "";
  let shown: { results: readonly T[]; answered: string; failed: boolean } = { results: [], answered: "", failed: false };
  let timer: unknown = null;
  let lastFire = -Infinity;
  /** Bumped by every request and every cancel: an answer counts only while its number is still the latest. */
  let seq = 0;
  let running: { q: string; ctrl: AbortController } | null = null;
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    const searching = query.length >= min && (shown.answered !== query || timer != null || running?.q === query);
    opts.onChange({ query, ...shown, searching });
  };

  const cancel = () => {
    seq++;
    running?.ctrl.abort();
    running = null;
  };
  const stopTimer = () => {
    if (timer != null) timers.clear(timer);
    timer = null;
  };

  const remember = (q: string, results: readonly T[]) => {
    cache.delete(q);
    cache.set(q, results);
    if (cache.size > keep) cache.delete(cache.keys().next().value as string);
  };

  const fire = () => {
    timer = null;
    const q = query;
    if (q.length < min || cache.has(q)) return;
    if (running?.q === q) return;
    cancel();
    const mine = seq;
    const ctrl = new AbortController();
    running = { q, ctrl };
    lastFire = now();
    let answer: Promise<readonly T[]>;
    try {
      answer = opts.find(q, ctrl.signal);
    } catch (e) {
      answer = Promise.reject(e);
    }
    answer.then(
      (results) => {
        if (mine !== seq) return;
        running = null;
        remember(q, results);
        shown = { results, answered: q, failed: false };
        emit();
      },
      () => {
        if (mine !== seq) return;
        running = null;
        shown = { results: [], answered: q, failed: true };
        emit();
      },
    );
    emit();
  };

  return {
    set(raw) {
      if (disposed) return;
      const q = raw.trim().replace(/\s+/g, " ");
      if (q === query) return;
      query = q;
      if (q.length < min) {
        stopTimer();
        cancel();
        shown = { results: [], answered: q, failed: false };
        return emit();
      }
      const hit = cache.get(q);
      if (hit) {
        stopTimer();
        cancel();
        shown = { results: hit, answered: q, failed: false };
        return emit();
      }
      // One timer at a time: a key pressed while it waits only changes what it will ask for.
      if (timer == null) timer = timers.set(fire, Math.max(0, lastFire + wait - now()));
      emit();
    },
    dispose() {
      disposed = true;
      stopTimer();
      cancel();
    },
  };
}
