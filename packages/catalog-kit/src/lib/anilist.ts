import { type AniListClient, type AniListStats, recordWatched, stats, viewer, watchedEntries } from "@secretary/anilist";
import { readJson, writeJson } from "@secretary/tv-kit";
import type { ResumeTracker } from "./resume.ts";

/** Kitsu, AniList and IMDb ids of one anime (the same mapping service the skip times use). */
const ARM = "https://arm.haglund.dev/api/v2";
const IDS = "sectv.anilist.ids";
const IDS_MAX = 400;
const LAST_PULL = "sectv.anilist.lastPull";
const LAST_SYNC = "sectv.anilist.lastSync";
const VIEWER = "sectv.anilist.viewer";
const STATS = "sectv.anilist.stats";
/** At most one full list pull this often; the sync runs on every return to the home. */
const PULL_EVERY_MS = 15 * 60_000;
/** List entries mapped back to catalog ids per pull (each one a mapping lookup the first time). */
const PULL_MAX = 200;

interface ArmIds {
  anilist?: number | null;
  kitsu?: number | null;
  imdb?: string | null;
}

type IdCache = Record<string, number | string | null>;

/**
 * Catalog ids to AniList ids and back, kept on the TV: `kitsu:7442` → 16498 under "c:kitsu:7442", and 16498 → the
 * catalog id under "a:16498". Null records a miss so it is not asked again.
 */
export function createIdMap({ fetch: f = fetch }: { fetch?: typeof fetch } = {}) {
  const load = () => readJson<IdCache>(IDS) ?? {};
  const save = (k: string, v: number | string | null) => {
    const all = { ...load(), [k]: v };
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - IDS_MAX))) delete all[old];
    writeJson(IDS, all);
  };
  async function arm(source: string, id: string): Promise<ArmIds | null> {
    // IMDb ids have their own endpoint, answering a list (one entry per season the service knows).
    const url = source === "imdb" ? `${ARM}/imdb?id=${encodeURIComponent(id)}` : `${ARM}/ids?source=${source}&id=${encodeURIComponent(id)}`;
    const res = await f(url);
    if (!res.ok) return null;
    const b = (await res.json()) as ArmIds | ArmIds[] | null;
    return Array.isArray(b) ? (b.find((x) => x?.anilist) ?? b[0] ?? null) : b;
  }
  return {
    /** The AniList id for a catalog id, or null for titles AniList does not list. */
    async toAniList(catalogId: string): Promise<number | null> {
      const key = `c:${catalogId}`;
      const hit = load()[key];
      if (hit !== undefined) return typeof hit === "number" ? hit : null;
      const m = /^(kitsu|anilist|mal):(\d+)/.exec(catalogId) ?? (/^tt\d+/.test(catalogId) ? ["", "imdb", catalogId.split(":")[0]] : null);
      if (!m) return null;
      if (m[1] === "anilist") return Number(m[2]);
      const ids = await arm(m[1] === "mal" ? "myanimelist" : m[1], m[2]).catch(() => undefined);
      if (ids === undefined) return null;
      const out = ids?.anilist ?? null;
      save(key, out);
      return out;
    },
    /** The catalog id for an AniList id: Kitsu first (the anime catalog's own), then IMDb. */
    async toCatalog(anilistId: number): Promise<string | null> {
      const key = `a:${anilistId}`;
      const hit = load()[key];
      if (hit !== undefined) return typeof hit === "string" ? hit : null;
      const ids = await arm("anilist", String(anilistId)).catch(() => undefined);
      if (ids === undefined) return null;
      const out = ids?.kitsu ? `kitsu:${ids.kitsu}` : ids?.imdb || null;
      save(key, out);
      return out;
    },
  };
}

export type IdMap = ReturnType<typeof createIdMap>;

async function inBatches<T, R>(items: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * AniList as a watch tracker for anime (docs/anilist.md). AniList has no scrobbling: an episode watched to the end
 * moves the list's progress forward, a title marked watched completes it, and the lists come back as watched marks.
 */
export function anilistTracker(c: AniListClient, ids: IdMap = createIdMap(), { now = Date.now }: { now?: () => number } = {}): ResumeTracker {
  const isAnime = (id: string, type?: string) => type === "anime" || id.startsWith("kitsu:") || id.startsWith("anilist:") || id.startsWith("mal:");
  return {
    progress() {
      // Nothing to send while playing: AniList counts finished episodes.
    },
    async finished(type, title, episode) {
      if (!c.signedIn() || !isAnime(title.id, type)) return;
      const media = await ids.toAniList(title.id);
      if (!media) return;
      if (await recordWatched(c, media, episode?.episode ?? null)) writeJson(LAST_SYNC, now());
    },
    async watched(id, watched, type) {
      if (!c.signedIn() || !watched || !isAnime(id, type)) return;
      const media = await ids.toAniList(id);
      if (!media) return;
      if (await recordWatched(c, media, null)) writeJson(LAST_SYNC, now());
    },
    async pullWatched() {
      if (!c.signedIn()) return null;
      if (now() - (readJson<number>(LAST_PULL) ?? 0) < PULL_EVERY_MS) return null;
      try {
        let me = readJson<{ id: number }>(VIEWER);
        if (!me?.id) {
          me = await viewer(c);
          writeJson(VIEWER, me);
        }
        const entries = (await watchedEntries(c, me.id)).slice(0, PULL_MAX);
        const mapped = await inBatches(entries, 4, async (e) => ({ e, id: await ids.toCatalog(e.mediaId) }));
        const titles: string[] = [];
        const episodes: Record<string, string[]> = {};
        for (const { e, id } of mapped) {
          if (!id) continue;
          if (e.status === "COMPLETED") titles.push(id);
          // Kitsu titles number their episodes from 1 in one season; IMDb ones split seasons AniList does not know.
          const n = e.status === "COMPLETED" && e.episodes ? e.episodes : e.progress;
          if (id.startsWith("kitsu:") && n > 0) episodes[id] = Array.from({ length: n }, (_, k) => `1:${k + 1}`);
        }
        writeJson(LAST_PULL, now());
        writeJson(LAST_SYNC, now());
        return { titles, episodes };
      } catch {
        return null;
      }
    },
  };
}

/** Makes the next sync pull the lists again (Settings › Accounts › Sync now). */
export function anilistPullSoon(): void {
  writeJson(LAST_PULL, 0);
}

export function anilistLastSync(): number {
  return readJson<number>(LAST_SYNC) ?? 0;
}

/** The viewer's AniList numbers for the profile page, kept for a day; the cached ones while offline. */
export async function anilistStats(c: AniListClient, { now = Date.now }: { now?: () => number } = {}): Promise<AniListStats | null> {
  if (!c.signedIn()) return null;
  const cached = readJson<{ at: number; stats: AniListStats }>(STATS);
  if (cached && now() - cached.at < 86_400_000) return cached.stats;
  try {
    const s = await stats(c);
    writeJson(STATS, { at: now(), stats: s });
    return s;
  } catch {
    return cached?.stats ?? null;
  }
}

/** Checks a pasted token with AniList and keeps it when it works; the viewer's name, or null when refused. */
export async function anilistSignIn(c: AniListClient, token: string): Promise<string | null> {
  try {
    const me = await viewer(c, token);
    c.setToken(token);
    writeJson(VIEWER, { id: me.id });
    anilistPullSoon();
    return me.name || "AniList";
  } catch {
    return null;
  }
}

export function anilistSignOut(c: AniListClient): void {
  c.setToken(null);
  writeJson(VIEWER, null);
  writeJson(STATS, null);
  writeJson(LAST_PULL, 0);
  writeJson(LAST_SYNC, 0);
}
