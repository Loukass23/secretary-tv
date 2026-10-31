// Client-side helpers for the future TV player overlay. Pure, so they can be imported by path into a Tizen app.
import { targetPos, type Timeline } from "./protocol.ts";

export interface ClockSample {
  rtt: number;
  /** serverTime - localTime. */
  offset: number;
}

/**
 * Server clock estimate from pings. Each pong gives `offset = s + rtt/2 - received`; the sample with the lowest round
 * trip among the recent ones is the least skewed by queueing, so it wins.
 */
export class ServerClock {
  private samples: ClockSample[] = [];
  private readonly keep: number;

  constructor(keep = 8) {
    this.keep = keep;
  }

  /** `c` is the local send time echoed by the pong, `s` the server time, `received` the local receive time. */
  add(c: number, s: number, received: number): ClockSample | null {
    const rtt = received - c;
    if (!(rtt >= 0)) return null;
    const sample = { rtt, offset: s + rtt / 2 - received };
    this.samples.push(sample);
    if (this.samples.length > this.keep) this.samples.shift();
    return sample;
  }

  /** The lowest-RTT sample, or undefined before the first pong. */
  best(): ClockSample | undefined {
    let b: ClockSample | undefined;
    for (const x of this.samples) if (!b || x.rtt < b.rtt) b = x;
    return b;
  }

  /** Local time to server time; uses `fallbackOffset` (from welcome.now) before any pong. */
  toServer(local: number, fallbackOffset = 0): number {
    return local + (this.best()?.offset ?? fallbackOffset);
  }
}

export const DRIFT = {
  /** Drift a member lives with: a seek on the reference TV costs seconds, so small drift is cheaper than fixing it. */
  toleranceSec: 2,
  /** At most one corrective seek in this window. */
  minGapMs: 30_000,
};

export type Correction = { kind: "none" } | { kind: "seek"; to: number };

/**
 * Whether a playing member should correct, and where to. A correction is one reopen at the target plus the time the
 * reopen itself takes (`reopenMs`, measured on the member's last seek), never a playback-rate change.
 */
export function correction(input: {
  tl: Timeline;
  serverNow: number;
  localPos: number;
  lastSeekAt?: number;
  reopenMs: number;
}): Correction {
  const { tl, serverNow, localPos, lastSeekAt, reopenMs } = input;
  if (tl.state !== "playing" || serverNow < tl.t0) return { kind: "none" };
  if (lastSeekAt !== undefined && serverNow - lastSeekAt < DRIFT.minGapMs) return { kind: "none" };
  const target = targetPos(tl, serverNow);
  if (Math.abs(localPos - target) <= DRIFT.toleranceSec) return { kind: "none" };
  return { kind: "seek", to: targetPos(tl, serverNow + reopenMs) };
}
