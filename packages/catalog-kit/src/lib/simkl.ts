import { readJson, writeJson } from "@secretary/tv-kit";
import {
  addHistory,
  type Kind,
  type Played,
  pullWatched,
  scrobble,
  type ScrobbleState,
  type SimklClient,
  type SimklStats,
  stats,
} from "@secretary/simkl";
import type { ResumeTracker } from "./resume.ts";
import type { CatalogType } from "./types.ts";

/** At most one full history pull this often; the sync runs on every return to the home. */
const PULL_EVERY_MS = 15 * 60_000;
const LAST_PULL = "sectv.simkl.lastPull";
const STATS = "sectv.simkl.stats";
const LAST_SYNC = "sectv.simkl.lastSync";

const kindOf = (type: CatalogType): Kind => (type === "movie" ? "movie" : type === "anime" ? "anime" : "show");

const percent = (pos: number, dur: number) => (dur > 0 ? (pos / dur) * 100 : 0);

const same = (a: Played | null, b: Played) => !!a && a.id === b.id && a.season === b.season && a.episode === b.episode;

/**
 * Simkl as a watch tracker (docs/simkl.md): scrobbles what plays (start, pause, stop; Simkl marks it watched past
 * 80 %), adds finished titles and toggled ones to the history, and brings the history back on sync.
 */
export function simklTracker(c: SimklClient, { now = Date.now }: { now?: () => number } = {}): ResumeTracker {
  let current: Played | null = null;
  let sent: ScrobbleState | null = null;
  let lastPct = 0;
  const send = (state: ScrobbleState, p: Played, pct: number) => {
    sent = state;
    void scrobble(c, state, p, pct).catch(() => {});
  };
  return {
    progress(type, title, episode, posSec, durSec, state) {
      if (!c.signedIn()) return;
      const p: Played = { id: title.id, kind: kindOf(type), title: title.name, season: episode?.season, episode: episode?.episode };
      const pct = percent(posSec, durSec);
      if (!same(current, p)) {
        if (current && sent !== "stop") send("stop", current, lastPct);
        current = p;
        sent = null;
      }
      lastPct = pct;
      const want: ScrobbleState = state === "playing" ? "start" : state === "paused" ? "pause" : "stop";
      if (want !== sent && !(want === "pause" && sent === null)) send(want, p, pct);
      if (want === "stop") current = null;
    },
    async finished(type, title, episode) {
      if (!c.signedIn()) return;
      const p: Played = { id: title.id, kind: kindOf(type), title: title.name, season: episode?.season, episode: episode?.episode };
      // Playing to the end: the scrobble's stop at 100 % records it, so it is not added twice.
      if (same(current, p)) {
        send("stop", p, 100);
        current = null;
        return;
      }
      await addHistory(c, [p]);
      writeJson(LAST_SYNC, now());
    },
    async watched(id, watched, type) {
      if (!c.signedIn() || !watched) return;
      // Without the kind, an IMDb id may be a film or a show: Simkl ignores the list it is not on.
      const kinds: Kind[] = type ? [kindOf(type)] : id.startsWith("kitsu:") ? ["anime"] : ["movie", "show"];
      await addHistory(c, kinds.map((kind) => ({ id, kind })));
      writeJson(LAST_SYNC, now());
    },
    async pullWatched() {
      if (!c.signedIn()) return null;
      const last = readJson<number>(LAST_PULL) ?? 0;
      if (now() - last < PULL_EVERY_MS) return null;
      try {
        const w = await pullWatched(c);
        writeJson(LAST_PULL, now());
        writeJson(LAST_SYNC, now());
        return w;
      } catch {
        return null;
      }
    },
  };
}

/** Makes the next sync pull the history again (Settings › Accounts › Sync now). */
export function simklPullSoon(): void {
  writeJson(LAST_PULL, 0);
}

export function simklLastSync(): number {
  return readJson<number>(LAST_SYNC) ?? 0;
}

/** The viewer's Simkl numbers for the profile page, kept for a day; the cached ones while offline. */
export async function simklStats(c: SimklClient, { now = Date.now }: { now?: () => number } = {}): Promise<SimklStats | null> {
  const cached = readJson<{ at: number; stats: SimklStats }>(STATS);
  if (!c.signedIn()) return null;
  if (cached && now() - cached.at < 86_400_000) return cached.stats;
  try {
    const s = await stats(c);
    writeJson(STATS, { at: now(), stats: s });
    return s;
  } catch {
    return cached?.stats ?? null;
  }
}

/** Signing out forgets the token and what this TV kept from the account. */
export function simklSignOut(c: SimklClient): void {
  c.setToken(null);
  writeJson(LAST_PULL, 0);
  writeJson(LAST_SYNC, 0);
  writeJson(STATS, null);
}
