import { defaultCaps, playsCodec } from "@secretary/core";
import type { ProviderStatus } from "@secretary/plugins";
import { inLimits, inScope, pickIndex, type Rules } from "./rules.ts";
import { parseStreamInfo, type Stream } from "./streams.ts";

/** Settings › Playback "Start playing after": how long Play may wait for slower providers. */
export type StartAfter = "instant" | "3" | "5" | "10" | "all";

export const START_AFTER: readonly StartAfter[] = ["instant", "3", "5", "10", "all"];

export const startAfterLabel = (v: StartAfter) =>
  v === "instant" ? "Instantly" : v === "all" ? "When every provider has answered" : `${v} seconds`;

/** The wait in ms, or null to wait for every provider. */
export const waitMs = (v: StartAfter): number | null => (v === "all" ? null : v === "instant" ? 0 : Number(v) * 1000);

/** A 4K source the TV decodes can start before the wait is over: nothing found later can beat it. */
const isTop = (s: Stream, rules: Rules) => {
  const p = parseStreamInfo(s);
  return p.resolution === "4K" && playsCodec(p.codec, rules.caps ?? defaultCaps);
};

export interface DecideInput {
  /** Sources found so far, in list order. */
  candidates: readonly Stream[];
  /** Where each plugin provider stands; empty when the sources do not come from plugins. */
  status: readonly ProviderStatus[];
  /** The search is over: the list is final. */
  done: boolean;
  /** Since the search started. */
  elapsedMs: number;
  /** From the setting: null waits for every provider. */
  waitMs: number | null;
  /** A source the viewer chose before for this title (phase 3); played as soon as it is found. */
  remembered?: { url: string; provider?: string };
  /** What the pick prefers (lib/rules.ts): recent failures last, size limits, provider order. */
  rules?: Rules;
}

/** `sheet`: sources were found but none matches Require, so the viewer picks one. */
export type Decision = { go: number; reason: string } | { wait: string } | { none: string } | { sheet: string };

/**
 * Whether autoplay can start now, and with which source. In order: nothing found yet waits (or gives up once the
 * search is over); a finished search plays its best; a remembered source plays as soon as it is there, and is waited
 * for while its provider is still searching; once the wait from the setting has run out the best so far plays;
 * before that, only a source nothing can beat (4K, inside the size limits) starts early, unless the setting waits for
 * every provider. "Best" is the first of lib/rules.ts rankSources.
 */
export function decide({ candidates, status, done, elapsedMs, waitMs, remembered, rules = {} }: DecideInput): Decision {
  if (!candidates.length) return done ? { none: "no sources" } : { wait: "nothing found yet" };
  const best = pickIndex(candidates, rules);
  // The ranking puts sources that match Require first: when even the first does not, none does.
  const scoped = inScope(candidates[best], rules);
  if (done) return scoped ? { go: best, reason: "every provider answered" } : { sheet: "nothing autoplay may pick" };
  const waitOver = waitMs != null && elapsedMs >= waitMs;
  if (remembered) {
    const at = candidates.findIndex((s) => s.url === remembered.url);
    if (at >= 0) return { go: at, reason: "the remembered source is here" };
    const searching = status.some((p) => p.id === remembered.provider && p.state === "searching");
    if (searching && !waitOver) return { wait: "the remembered source's provider is still searching" };
  }
  if (waitOver) {
    return scoped
      ? { go: best, reason: `waited ${Math.round(elapsedMs / 100) / 10} s` }
      : { wait: "waiting for a source autoplay may pick" };
  }
  // "When every provider has answered" means exactly that, even with a 4K source in hand.
  if (waitMs == null) return { wait: "waiting for every provider" };
  const top = candidates[best];
  if (scoped && isTop(top, rules) && inLimits(top, rules) && !rules.isDead?.(top)) return { go: best, reason: "a 4K source is here" };
  return { wait: "waiting for a better source" };
}
