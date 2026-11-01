// The play queue: pure, so shuffle and repeat are tested without a player.
import type { Track } from "./youtube.ts";

export type Repeat = "off" | "all" | "one";

export interface Queue {
  tracks: readonly Track[];
  /** Play order: indexes into `tracks`. Identity unless shuffled. */
  order: readonly number[];
  /** Where in `order` playback is. */
  pos: number;
  shuffle: boolean;
  repeat: Repeat;
}

export type Rng = () => number;

/** 0..n-1 in a random order with `first` at the front (Fisher-Yates over the rest). */
export function shuffled(n: number, first: number, rng: Rng): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < n ? [first, ...rest] : rest;
}

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

/** A queue over `tracks` starting at `start`, keeping the listener's shuffle and repeat choices. */
export function startQueue(
  tracks: readonly Track[],
  start: number,
  opts: { shuffle?: boolean; repeat?: Repeat } = {},
  rng: Rng = Math.random,
): Queue {
  const at = Math.min(Math.max(0, start), Math.max(0, tracks.length - 1));
  const shuffle = Boolean(opts.shuffle);
  return {
    tracks,
    order: shuffle ? shuffled(tracks.length, at, rng) : identity(tracks.length),
    pos: shuffle ? 0 : at,
    shuffle,
    repeat: opts.repeat ?? "off",
  };
}

export const current = (q: Queue): Track | undefined => q.tracks[q.order[q.pos]];

/** The tracks in play order, as the list shows them. */
export const inOrder = (q: Queue): Track[] => q.order.map((i) => q.tracks[i]);

/**
 * The queue after this track. `ended` is the track running out (repeat one plays it again); a press of Next always
 * moves on. Past the end, repeat all wraps and anything else stops (null).
 */
export function next(q: Queue, ended: boolean): Queue | null {
  if (!q.tracks.length) return null;
  if (ended && q.repeat === "one") return q;
  if (q.pos + 1 < q.order.length) return { ...q, pos: q.pos + 1 };
  return q.repeat === "off" ? null : { ...q, pos: 0 };
}

/** Previous: more than 3 s in restarts the track (same queue); otherwise the one before, wrapping on repeat all. */
export function prev(q: Queue, posSec: number): { queue: Queue; restart: boolean } {
  if (posSec > 3 || q.tracks.length < 2) return { queue: q, restart: true };
  if (q.pos > 0) return { queue: { ...q, pos: q.pos - 1 }, restart: false };
  if (q.repeat === "all") return { queue: { ...q, pos: q.order.length - 1 }, restart: false };
  return { queue: q, restart: true };
}

/** Shuffle on: the playing track first, the rest random. Off: back to the list's order, still on the same track. */
export function toggleShuffle(q: Queue, rng: Rng = Math.random): Queue {
  const playing = q.order[q.pos] ?? 0;
  if (q.shuffle) return { ...q, shuffle: false, order: identity(q.tracks.length), pos: playing };
  return { ...q, shuffle: true, order: shuffled(q.tracks.length, playing, rng), pos: 0 };
}

export const REPEATS: readonly Repeat[] = ["off", "all", "one"];
export const cycleRepeat = (r: Repeat): Repeat => REPEATS[(REPEATS.indexOf(r) + 1) % REPEATS.length];

/** Plays the `i`th track in play order. */
export const jumpTo = (q: Queue, i: number): Queue => ({ ...q, pos: Math.min(Math.max(0, i), q.order.length - 1) });

/** Recently played, newest first, each track once. */
export function addRecent(list: readonly Track[], t: Track, max = 24): Track[] {
  return [t, ...list.filter((x) => x.id !== t.id)].slice(0, max);
}
