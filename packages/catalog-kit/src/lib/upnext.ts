/**
 * When the "Up next" card appears over an episode, and when the next episode's sources are looked up. Pure, so the
 * player and the tests share it.
 */

/** Settings › Playback "Up next countdown": how long the card counts down before the next episode starts. */
export type Countdown = "off" | "5" | "10" | "15";
export const COUNTDOWNS: readonly Countdown[] = ["off", "5", "10", "15"];
export const countdownLabel = (c: Countdown) => (c === "off" ? "Off (plays at the end)" : `${c} seconds`);
export const countdownSec = (c: Countdown) => (c === "off" ? null : Number(c));

/** A duration that has not changed for this long is trusted: some streams report a growing one at first. */
export const STABLE_MS = 3000;
const SHORT_EPISODE_SEC = 10 * 60;
const LEAD_SEC = 45;
const SHORT_LEAD_SEC = 15;
/** The next episode's sources are looked up this long before the card, so they are fresh when it shows. */
export const PREFETCH_LEAD_SEC = 90;

export interface CardInput {
  durSec: number;
  /** Since the duration last changed. */
  stableMs: number;
  /** Films get no card. */
  isMovie: boolean;
  /** Where the credits start, when known (skip markers); the card shows there. */
  creditsSec?: number | null;
}

/** The playback second the card appears at, or null when there is none (a film, no duration yet, or still moving). */
export function cardAt({ durSec, stableMs, isMovie, creditsSec }: CardInput): number | null {
  if (isMovie || !(durSec > 0) || stableMs < STABLE_MS) return null;
  if (creditsSec != null && creditsSec > 0 && creditsSec < durSec) return creditsSec;
  return Math.max(0, durSec - (durSec < SHORT_EPISODE_SEC ? SHORT_LEAD_SEC : LEAD_SEC));
}

/** The playback second to look the next episode's sources up at. */
export const prefetchAt = (card: number) => Math.max(0, card - PREFETCH_LEAD_SEC);

/** Tracks how long the reported duration has stayed the same. */
export function durationWatch(now: () => number = Date.now) {
  let last = -1;
  let since = now();
  return (durSec: number): number => {
    if (Math.round(durSec) !== last) {
      last = Math.round(durSec);
      since = now();
    }
    return now() - since;
  };
}
