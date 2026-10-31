import { readJson, writeJson } from "@secretary/tv-kit";
import type { CatalogType, Title, Video } from "./types.ts";

const EDGE_SEC = 5;
const MAX = 20;
/** Within this many seconds of the end counts as finished. */
const FINISHED_SEC = EDGE_SEC * 6;
const ALL_TYPES: readonly CatalogType[] = ["movie", "series", "anime"];
const WATCHED_KEY = "sectv.watched.v1";

const keyFor = (type: CatalogType) => `sectv.${type}.resume.v2`;

export interface ResumeEntry {
  title: Title;
  /** Series only: the episode to continue with. */
  episode?: Pick<Video, "id" | "season" | "episode" | "name">;
  posSec: number;
  durSec: number;
  updated: number;
}

export interface UnifiedResumeEntry extends ResumeEntry {
  type: CatalogType;
}

export function loadWatchedIds(): string[] {
  const list = readJson<string[]>(WATCHED_KEY);
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

export function isTitleWatched(id: string): boolean {
  return loadWatchedIds().includes(id);
}

function setWatchedLocal(id: string, watched: boolean): void {
  const current = new Set(loadWatchedIds());
  if (watched) current.add(id);
  else current.delete(id);
  writeJson(WATCHED_KEY, [...current]);
}

export function markTitleWatched(id: string, watched = true): boolean {
  if (!id) return false;
  setWatchedLocal(id, watched);
  void remote?.watched(id, watched);
  return watched;
}

export function toggleTitleWatched(id: string): boolean {
  return markTitleWatched(id, !isTitleWatched(id));
}

export function badgeForResume(entry: {
  type: CatalogType;
  episode?: ResumeEntry["episode"];
  title?: Pick<Title, "year">;
  posSec?: number;
}): string {
  const kind = entry.type === "movie" ? "Movie" : entry.type === "series" ? "Series" : "Anime";
  if (entry.episode) {
    const s = String(entry.episode.season).padStart(2, "0");
    const e = String(entry.episode.episode).padStart(2, "0");
    if (entry.posSec === 0) return `Next · S${s}E${e}`;
    return `${kind} · S${s}E${e}`;
  }
  if (entry.title?.year) return `${kind} · ${entry.title.year}`;
  return kind;
}

export function toContinueTitle(entry: UnifiedResumeEntry): Title {
  const pct =
    entry.durSec > 0 ? Math.min(100, Math.max(4, Math.round((entry.posSec / entry.durSec) * 100))) : 0;
  return {
    ...entry.title,
    catalogType: entry.type,
    badge: badgeForResume(entry),
    progressPct: pct > 0 ? pct : undefined,
  };
}

export function loadResume(type: CatalogType): ResumeEntry[] {
  const all = readJson<ResumeEntry[]>(keyFor(type));
  return Array.isArray(all) ? all : [];
}

/** Reads and merges local watch progress across Movies, Series, and Anime, newest first. */
export function loadAllResume(): UnifiedResumeEntry[] {
  const byKey = new Map<string, UnifiedResumeEntry>();
  for (const type of ALL_TYPES) {
    for (const entry of loadResume(type)) {
      if (!entry?.title?.id) continue;
      const nameKey = `${type}:${(entry.title.name || entry.title.id).trim().toLowerCase()}`;
      const prev = byKey.get(nameKey);
      if (!prev || (entry.updated ?? 0) >= (prev.updated ?? 0)) {
        byKey.set(nameKey, { ...entry, type });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)).slice(0, MAX);
}

/** Where to start: nothing in the first or last seconds, or when the duration is unknown. */
export function resumeStart(posSec: number, durSec: number): number {
  if (!(durSec > 0) || posSec <= EDGE_SEC || posSec >= durSec - EDGE_SEC) return 0;
  return posSec;
}

export const isFinished = (posSec: number, durSec: number) => durSec > 0 && posSec >= durSec - FINISHED_SEC;

/** "16% watched · 38 min left" (or "1 h 51 min left") above a Resume button; empty when there is nothing to resume. */
export function resumeLabel(posSec: number, durSec: number): string {
  if (!resumeStart(posSec, durSec)) return "";
  const pct = Math.max(1, Math.min(99, Math.round((posSec / durSec) * 100)));
  const leftMin = Math.max(1, Math.round((durSec - posSec) / 60));
  const left = leftMin >= 60 ? `${Math.floor(leftMin / 60)} h ${leftMin % 60} min` : `${leftMin} min`;
  return `${pct}% watched · ${left} left`;
}

/** Newest first, one entry per title, finished titles dropped. Pure so it can be tested. */
export function upsert(list: readonly ResumeEntry[], entry: ResumeEntry, drop: boolean): ResumeEntry[] {
  const rest = list.filter((e) => e.title.id !== entry.title.id);
  return (drop ? rest : [entry, ...rest]).slice(0, MAX);
}

const slim = (t: Title): Title => ({
  id: t.id,
  name: t.name,
  year: t.year,
  rating: t.rating,
  poster: t.poster,
  background: t.background,
});
const slimEpisode = (v: Video) => ({ id: v.id, season: v.season, episode: v.episode, name: v.name });

let serverBase = "";

/**
 * Where watch progress syncs when it is not the home server: Nuvio Cloud (lib/cloud.ts). One title per entry here;
 * the remote maps to and from its own rows.
 */
export interface ResumeRemote {
  /** Everything in progress on the profile, all kinds, newest first; null when it cannot be read. `known` gives
   *  the title fields this TV already has for an id. */
  pull(known: (id: string) => Title | undefined): Promise<UnifiedResumeEntry[] | null>;
  /** Saves entries; false when they did not reach it (they are sent again on the next sync). */
  push(entries: UnifiedResumeEntry[]): Promise<boolean>;
  /** A movie or episode was watched to the end: record it and clear its progress. */
  finished(type: CatalogType, title: Title, episode?: Pick<Video, "season" | "episode">): Promise<void>;
  watched(id: string, watched: boolean): Promise<void>;
  /** Titles watched whole, or null when they cannot be read. */
  pullWatched(): Promise<string[] | null>;
}

let remote: ResumeRemote | null = null;
const LAST_SYNC = "sectv.resume.lastSync";

export function setResumeRemote(r: ResumeRemote | null): void {
  remote = r;
}

/** Another account or profile took over this TV's app: its lists start from the cloud, not from the last one's. */
export function clearLocalResume(): void {
  for (const type of ALL_TYPES) writeJson(keyFor(type), []);
  writeJson(WATCHED_KEY, []);
  writeJson(LAST_SYNC, 0);
}

/**
 * The cloud's list is the truth for everything up to the last sync; entries saved here since then (not yet known to
 * have reached it) win when they are newer. Pure so it can be tested.
 */
export function mergeWithCloud(
  local: readonly ResumeEntry[],
  cloudList: readonly ResumeEntry[],
  lastSync: number,
): ResumeEntry[] {
  return mergeResume(local.filter((e) => (e.updated ?? 0) > lastSync), cloudList);
}

export function setResumeServer(url: string): void {
  serverBase = url.replace(/\/$/, "");
}

/** Merges local and server resume lists by title name/id, keeping the newer `updated` timestamp. */
export function mergeResume(local: readonly ResumeEntry[], remote: readonly ResumeEntry[]): ResumeEntry[] {
  const byKey = new Map<string, ResumeEntry>();
  for (const e of [...remote, ...local]) {
    if (!e?.title?.id) continue;
    const key = (e.title.name || e.title.id).trim().toLowerCase() || e.title.id;
    const prev = byKey.get(key);
    if (!prev || (e.updated ?? 0) >= (prev.updated ?? 0)) byKey.set(key, e);
  }
  return [...byKey.values()].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)).slice(0, MAX);
}

export async function pushResume(
  type: CatalogType,
  list: readonly ResumeEntry[],
  base = serverBase,
  f: typeof fetch = fetch,
): Promise<void> {
  if (!base) return;
  try {
    await f(`${base}/resume/${type}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(list),
    });
  } catch {
    // Offline or server unreachable; localStorage still holds the state.
  }
}

export async function syncResume(
  type: CatalogType,
  base = serverBase,
  f: typeof fetch = fetch,
): Promise<ResumeEntry[]> {
  const local = loadResume(type);
  if (!base) return local;
  try {
    const res = await f(`${base}/resume/${type}`);
    if (!res.ok) return local;
    const { items = [] } = (await res.json()) as { items?: ResumeEntry[] };
    const merged = mergeResume(local, items);
    writeJson(keyFor(type), merged);
    if (local.length > 0 && JSON.stringify(merged) !== JSON.stringify(items)) {
      void pushResume(type, merged, base, f);
    }
    return merged;
  } catch {
    return local;
  }
}

/**
 * Syncs watch progress across all categories (movie, series, anime) with `/resume` on the server,
 * persists each category locally, and returns the unified cross-category list sorted by `updated`.
 */
export async function syncAllResume(
  base = serverBase,
  f: typeof fetch = fetch,
): Promise<UnifiedResumeEntry[]> {
  if (remote) return syncWithRemote(remote);
  if (!base) return loadAllResume();
  try {
    const res = await f(`${base}/resume`);
    if (!res.ok) return loadAllResume();
    const { items = [] } = (await res.json()) as { items?: UnifiedResumeEntry[] };
    for (const type of ALL_TYPES) {
      const remoteOfType = items
        .filter((e) => e?.type === type)
        .map(({ type: _t, ...rest }) => rest);
      const local = loadResume(type);
      const merged = mergeResume(local, remoteOfType);
      writeJson(keyFor(type), merged);
      if (local.length > 0 && JSON.stringify(merged) !== JSON.stringify(remoteOfType)) {
        void pushResume(type, merged, base, f);
      }
    }
    return loadAllResume();
  } catch {
    return loadAllResume();
  }
}

async function syncWithRemote(r: ResumeRemote): Promise<UnifiedResumeEntry[]> {
  const startedAt = Date.now();
  const lastSync = readJson<number>(LAST_SYNC) ?? 0;
  const known = new Map<string, Title>();
  for (const type of ALL_TYPES) for (const e of loadResume(type)) if (e?.title?.id) known.set(e.title.id, e.title);
  const items = await r.pull((id) => known.get(id));
  if (!items) return loadAllResume();
  const pending: UnifiedResumeEntry[] = [];
  for (const type of ALL_TYPES) {
    const local = loadResume(type);
    pending.push(...local.filter((e) => (e.updated ?? 0) > lastSync).map((e) => ({ ...e, type })));
    const fromCloud = items.filter((e) => e.type === type).map(({ type: _t, ...rest }) => rest);
    writeJson(keyFor(type), mergeWithCloud(local, fromCloud, lastSync));
  }
  const watched = await r.pullWatched();
  if (watched) writeJson(WATCHED_KEY, [...new Set([...loadWatchedIds(), ...watched])]);
  if (await r.push(pending)) writeJson(LAST_SYNC, startedAt);
  return loadAllResume();
}

export interface HandoffResult {
  title: Title;
  autoPlay: boolean;
}

export async function consumeHandoff(
  type: CatalogType,
  base = serverBase,
  f: typeof fetch = fetch,
): Promise<HandoffResult | null> {
  if (!base) return null;
  try {
    const res = await f(`${base}/handoff/${type}`);
    if (!res.ok) return null;
    const { title = null, autoPlay = false } = (await res.json()) as {
      title?: Title | null;
      autoPlay?: boolean;
    };
    return title?.id ? { title, autoPlay: Boolean(autoPlay) } : null;
  } catch {
    return null;
  }
}

/**
 * Saves where the viewer is. A finished movie is dropped and marked watched; a finished episode
 * moves the entry to `next` at 0:00 (or drops & marks watched when it was the last one).
 */
export function saveProgress(
  type: CatalogType,
  title: Title,
  episode: Video | undefined,
  posSec: number,
  durSec: number,
  next?: Video | null,
): void {
  const list = loadResume(type);
  const finished = isFinished(posSec, durSec);
  let entry: ResumeEntry = {
    title: slim(title),
    episode: episode && slimEpisode(episode),
    posSec,
    durSec,
    updated: Date.now(),
  };
  let drop = false;
  if (finished) {
    if (episode && next) {
      entry = { ...entry, episode: slimEpisode(next), posSec: 0, durSec: 0 };
    } else {
      drop = true;
      setWatchedLocal(title.id, true);
    }
  }
  const nextList = upsert(list, entry, drop);
  writeJson(keyFor(type), nextList);
  if (!remote) return void pushResume(type, nextList);
  // The next episode first, so the title never drops out of Continue Watching on other devices.
  const r = remote;
  void (async () => {
    if (!drop) await r.push([{ ...entry, type }]);
    if (finished) await r.finished(type, slim(title), episode);
  })();
}
