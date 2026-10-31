import type { Stream } from "./streams.ts";

/**
 * Checking a source before AVPlay gets it: a ranged GET of its first kilobyte (docs/lessons.md, Network). A bad source
 * (an error page, a "not cached yet" clip, a host that refuses) then costs a fraction of a second, not AVPlay's 15 s
 * prepare timer. Network only: nothing here opens a decoder.
 */
export type Verdict = "ok" | "warning clip" | "not video" | "refused" | "no answer";

export interface Check {
  verdict: Verdict;
  /** The URL AVPlay should open: the resolved link for a debrid source. */
  url: string;
  ms: number;
  status?: number;
  /** The whole file's size in bytes, from Content-Range. */
  size?: number;
}

const PROBE_TIMEOUT_MS = 6000;
/** Under this a "video" is a placeholder: real releases start in the hundreds of megabytes. */
const MIN_VIDEO_BYTES = 20 * 1024 * 1024;
/**
 * Placeholder clips debrid services and addons play instead of a film ("downloading", "not cached", a slate): a folder
 * or file named for it, so a release that merely has such a word in its title still passes.
 */
const WARNING_NAME = /^(?:slate|placeholder|downloading|not[-_]?cached|uncached|warning|error)(?:[-_][a-z0-9]+)*$/i;
const isWarningPath = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .some((seg) => WARNING_NAME.test(seg.replace(/\.[a-z0-9]{2,4}$/i, "")));
const NOT_VIDEO = /^(?:text\/|application\/(?:json|xml|xhtml))/i;

/** The verdict for one answer, from what its headers say. */
export function classify(res: { status: number; url: string; headers: { get(name: string): string | null } }): {
  verdict: Verdict;
  size?: number;
} {
  if (res.status !== 200 && res.status !== 206) return { verdict: "refused" };
  const total = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1];
  const length = res.status === 200 ? res.headers.get("content-length") : null;
  const size = total ? Number(total) : length ? Number(length) : undefined;
  if (NOT_VIDEO.test(res.headers.get("content-type") ?? "")) return { verdict: "not video", size };
  let path = res.url;
  try {
    path = new URL(res.url).pathname;
  } catch {}
  if (isWarningPath(path) || (size != null && size < MIN_VIDEO_BYTES)) return { verdict: "warning clip", size };
  return { verdict: "ok", size };
}

/** Resolves (for a debrid source) and probes one URL. Never throws. */
export async function checkSource(
  url: string,
  playable: (url: string) => Promise<string>,
  f: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Check> {
  const t0 = now();
  let link = url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    link = await playable(url);
    const res = await f(link, { headers: { Range: "bytes=0-1023" }, signal: ctrl.signal });
    try {
      await res.body?.cancel();
    } catch {}
    return { ...classify(res), url: link, ms: now() - t0, status: res.status };
  } catch {
    return { verdict: "no answer", url: link, ms: now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sources whose check adds nothing to a debrid account: Premiumize's direct links, and links from providers, except
 * those a provider resolves on TorBox (TorBox adds a torrent even to check a cached one). TorBox sources are safe only
 * when Settings › Sources › "Check TorBox sources ahead" is on.
 */
export const safeToCheck =
  (torboxAhead: boolean) =>
  (s: Stream): boolean => {
    const torbox = s.url.startsWith("debrid:tb:") || /\[TB\]|[?&]service=tb\b/i.test(`${s.name} ${s.url}`);
    if (torbox) return torboxAhead;
    return s.url.startsWith("debrid:pm:") || /^https?:\/\//i.test(s.url);
  };

export interface VerifyOptions {
  check: (url: string) => Promise<Check>;
  /** Sources that may be checked ahead: checking them adds nothing to a debrid account. */
  safe: (s: Stream) => boolean;
  /** How many of them are checked at once. */
  parallel?: number;
  /** No new check ahead starts after this; the rest are checked when their turn comes. */
  deadlineMs?: number;
  now?: () => number;
}

/**
 * Checks for a list of sources in queue order. The leading run of sources that are safe to check ahead is checked at
 * once, a few at a time, while the first ones are tried; every other source is checked only when its turn comes, so a
 * TorBox torrent is resolved (and added to the account) only if it is about to play. `get(i)` is the check for
 * source i, so the source that plays is still the first in order that passes, never just the fastest to answer.
 */
export function createVerifier(
  streams: readonly Stream[],
  { check, safe, parallel = 3, deadlineMs = 20_000, now = Date.now }: VerifyOptions,
) {
  const checks = new Map<number, Promise<Check>>();
  const started = now();
  let ahead = 0;
  while (ahead < streams.length && safe(streams[ahead])) ahead++;
  let next = 0;
  let running = 0;

  const run = (i: number) => {
    let p = checks.get(i);
    if (!p) {
      p = check(streams[i].url);
      checks.set(i, p);
    }
    return p;
  };
  // Keeps up to `parallel` checks of the leading safe run going, in order, until the deadline.
  const pump = () => {
    while (running < parallel && next < ahead && now() - started < deadlineMs) {
      const i = next++;
      if (checks.has(i)) continue;
      running++;
      void run(i).finally(() => {
        running--;
        pump();
      });
    }
  };
  pump();

  return {
    /** How many sources are checked ahead (the leading safe run). */
    ahead,
    get(i: number): Promise<Check> {
      return run(i);
    },
    /** Started checks, for tests and the debug handle. */
    startedCount: () => checks.size,
  };
}
