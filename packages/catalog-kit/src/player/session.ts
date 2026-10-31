import { readJson, writeJson } from "@secretary/tv-kit";
import { createDeadLinks } from "../lib/deadlinks.ts";
import { createSkipFinder } from "../lib/skip.ts";
import { createSourcePrefs } from "../lib/sourcepref.ts";
import { playable } from "../lib/plugins.ts";
import { createAvplayPlayer } from "./avplay.ts";
import type { PlayerEvents, TvPlayer } from "./types.ts";
import { webapis } from "./webapis.ts";

/** Sources that failed to play in the last six hours (lib/deadlinks.ts), shared by the detail page and the player. */
export const deadLinks = createDeadLinks({ get: readJson, set: writeJson });
/** Where episodes' intros, recaps and credits are (lib/skip.ts). */
export const skipFinder = createSkipFinder({ kv: { get: readJson, set: writeJson } });

/** The viewer's source per title (lib/sourcepref.ts), shared by the detail page, the player and Next. */
export const sourcePrefs = createSourcePrefs({ get: readJson, set: writeJson });
export const isDead = (s: Parameters<typeof deadLinks.get>[0]) => deadLinks.get(s) != null;

/** Handlers the player calls. Reassigned by whichever view owns the player now. */
export function noopEvents(): PlayerEvents {
  return { onTime() {}, onEnded() {}, onBuffering() {}, onError() {} };
}

export function makeAvplay(events: PlayerEvents): TvPlayer | null {
  const api = webapis();
  if (!api) return null;
  return createAvplayPlayer({ api, events, screen: window.screen, doc: document });
}

/**
 * Prepare-ahead cut OK-to-first-frame from 5.1 s to 0.8 s on the reference TV
 * (docs/performance.md), so it is on unless localStorage sectv.prepareAhead is false.
 */
export const prepareAheadEnabled = () => readJson<boolean>("sectv.prepareAhead") !== false;

interface Preloaded {
  url: string;
  startSec: number;
  player: TvPlayer;
  events: PlayerEvents;
  ready: Promise<void>;
}

let pre: Preloaded | null = null;

/** Opens and prepares `url` behind the detail page. The decoder is held until used or cancelled. */
export function preload(url: string, startSec: number): void {
  if (pre?.url === url && pre.startSec === startSec) return;
  cancelPreload();
  const events = noopEvents();
  const player = makeAvplay(events);
  if (!player) return;
  // A plugin torrent becomes a link here, so preparing ahead also covers the debrid round trip.
  const ready = playable(url).then((link) => player.load(link, startSec));
  const entry: Preloaded = { url, startSec, player, events, ready };
  pre = entry;
  ready.catch(() => {
    if (pre === entry) cancelPreload();
  });
}

/** Hands the prepared player over, or null when `url` or `startSec` was not preloaded. */
export function consumePreload(url: string, startSec?: number): Preloaded | null {
  if (!pre) return null;
  if (pre.url !== url || (startSec !== undefined && pre.startSec !== startSec)) {
    cancelPreload();
    return null;
  }
  const taken = pre;
  pre = null;
  return taken;
}

export function cancelPreload(): void {
  if (!pre) return;
  const old = pre;
  pre = null;
  old.player.stop();
}
