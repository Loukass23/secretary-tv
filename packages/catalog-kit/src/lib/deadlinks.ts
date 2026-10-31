import type { Stream } from "./streams.ts";

/**
 * Sources that failed to play, remembered for six hours so autoplay goes past them (a source chosen by hand in the
 * sheet still plays). A later success forgets the failure. Keys hold paths, which can hold debrid keys: they are only
 * stored on the TV, never logged.
 */
export interface DeadLink {
  at: number;
  reason: string;
}

export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

const KEY = "sectv.dead.v1";
export const DEAD_TTL_MS = 6 * 3600_000;
const MAX_ENTRIES = 128;
/** Query parameters that change on every link for the same file: signatures, expiries, tokens. */
const VOLATILE = /^(?:token|sig|signature|expires|exp|auth|key-pair-id|x-amz-.*|x-goog-.*)$/i;

/**
 * The same source across searches: its provider, then for a debrid source its service, hash and file, and for a link
 * its host, path and lasting query (an episode number stays, a token goes).
 */
export function sourceKey(s: Pick<Stream, "url" | "provider">): string {
  const who = s.provider ?? "";
  if (s.url.startsWith("debrid:")) return `${who}|${s.url}`;
  try {
    const u = new URL(s.url);
    const kept = [...u.searchParams].filter(([k]) => !VOLATILE.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length ? `?${new URLSearchParams(kept)}` : "";
    return `${who}|${u.host}${u.pathname}${query}`;
  } catch {
    return `${who}|${s.url}`;
  }
}

export function createDeadLinks(kv: KV, now: () => number = Date.now) {
  /** Live entries only: past their six hours, or stamped in the future by a wrong clock, they are gone. */
  const load = (): Record<string, DeadLink> => {
    const all = kv.get<Record<string, DeadLink>>(KEY) ?? {};
    const t = now();
    return Object.fromEntries(Object.entries(all).filter(([, e]) => t - e.at >= 0 && t - e.at < DEAD_TTL_MS));
  };

  return {
    /** Why and when this source last failed, if within six hours. */
    get(s: Pick<Stream, "url" | "provider">): DeadLink | null {
      return load()[sourceKey(s)] ?? null;
    },
    mark(s: Pick<Stream, "url" | "provider">, reason: string): void {
      const entries = Object.entries({ ...load(), [sourceKey(s)]: { at: now(), reason } })
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, MAX_ENTRIES);
      kv.set(KEY, Object.fromEntries(entries));
    },
    clear(s: Pick<Stream, "url" | "provider">): void {
      const all = load();
      if (!(sourceKey(s) in all)) return;
      delete all[sourceKey(s)];
      kv.set(KEY, all);
    },
    /** One read of the memory for a whole list (the sources sheet): the failure for a source, if recent. */
    snapshot(): (s: Pick<Stream, "url" | "provider">) => DeadLink | null {
      const all = load();
      return (s) => all[sourceKey(s)] ?? null;
    },
    /** The list with the sources that failed recently moved to the end, in their order: what autoplay picks from. */
    aliveFirst<T extends Pick<Stream, "url" | "provider">>(list: readonly T[]): T[] {
      const dead = load();
      const isDead = (s: T) => sourceKey(s) in dead;
      return [...list.filter((s) => !isDead(s)), ...list.filter(isDead)];
    },
  };
}

export type DeadLinks = ReturnType<typeof createDeadLinks>;
