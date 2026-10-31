import type { NuvioClient } from "./http.ts";
import type { KV } from "./session.ts";

// Watch progress and watched history (docs/nuvio-cloud.md). Nuvio keeps one row per movie or episode, in ms, with
// content_type "movie" or "series"; the apps keep one entry per title in seconds, with anime as a kind of its own.

export type Kind = "movie" | "series" | "anime";

export interface ProgressRow {
  content_id: string;
  content_type: "movie" | "series";
  video_id: string;
  season?: number | null;
  episode?: number | null;
  /** ms */
  position: number;
  /** ms */
  duration: number;
  /** Epoch ms. */
  last_watched: number;
  progress_key?: string;
}

export interface WatchedRow {
  content_id: string;
  content_type: "movie" | "series";
  title?: string;
  season?: number | null;
  episode?: number | null;
  watched_at: number;
}

/** The title fields the apps keep on a resume entry. */
export interface SlimTitle {
  id: string;
  name: string;
  year: string;
  rating: string;
  poster?: string;
  background?: string;
}

/** One title in progress, as the apps and Nest show it. */
export interface ResumeItem {
  type: Kind;
  title: SlimTitle;
  episode?: { id: string; season: number; episode: number; name: string };
  posSec: number;
  durSec: number;
  updated: number;
}

/** Nuvio has no anime type: anime is a series, told apart by its Kitsu id when it comes back. */
export const kindOf = (row: Pick<ProgressRow, "content_id" | "content_type">): Kind =>
  row.content_type === "movie" ? "movie" : row.content_id.startsWith("kitsu:") ? "anime" : "series";

/** The server's progress key: the content id, plus _sSeE for an episode. */
export const progressKey = (contentId: string, season?: number | null, episode?: number | null) =>
  season != null && episode != null ? `${contentId}_s${season}e${episode}` : contentId;

export function toRow(item: ResumeItem): ProgressRow {
  const ep = item.episode;
  return {
    content_id: item.title.id,
    content_type: item.type === "movie" ? "movie" : "series",
    video_id: ep?.id ?? item.title.id,
    ...(ep ? { season: ep.season, episode: ep.episode } : {}),
    position: Math.max(0, Math.round(item.posSec * 1000)),
    duration: Math.max(0, Math.round(item.durSec * 1000)),
    last_watched: item.updated,
  };
}

/**
 * Rows to one entry per title (the newest episode wins), newest first. `known` supplies title fields the device
 * already has; the rest get a bare title that `withMeta` fills in.
 */
export function toItems(rows: readonly ProgressRow[], known: (id: string) => SlimTitle | undefined = () => undefined): ResumeItem[] {
  const byTitle = new Map<string, ProgressRow>();
  for (const r of rows) {
    if (!r?.content_id) continue;
    const prev = byTitle.get(r.content_id);
    if (!prev || r.last_watched > prev.last_watched) byTitle.set(r.content_id, r);
  }
  return [...byTitle.values()]
    .sort((a, b) => b.last_watched - a.last_watched)
    .map((r) => {
      const ep = r.season != null && r.episode != null ? r : null;
      return {
        type: kindOf(r),
        title: known(r.content_id) ?? { id: r.content_id, name: "", year: "", rating: "" },
        ...(ep ? { episode: { id: r.video_id, season: ep.season!, episode: ep.episode!, name: "" } } : {}),
        posSec: r.position / 1000,
        durSec: r.duration / 1000,
        updated: r.last_watched,
      };
    });
}

/** The latest progress rows of a profile (the server keeps the newest 200). */
export async function pullProgress(c: NuvioClient, profile: number): Promise<ProgressRow[]> {
  return (await c.rpc<ProgressRow[] | null>("sync_pull_watch_progress", { p_profile_id: profile })) ?? [];
}

export async function pushProgress(c: NuvioClient, profile: number, rows: readonly ProgressRow[]): Promise<void> {
  if (rows.length) await c.rpc("sync_push_watch_progress", { p_profile_id: profile, p_entries: rows });
}

export async function deleteProgress(c: NuvioClient, profile: number, keys: readonly string[]): Promise<void> {
  if (keys.length) await c.rpc("sync_delete_watch_progress", { p_profile_id: profile, p_keys: keys });
}

export async function pullWatched(c: NuvioClient, profile: number): Promise<WatchedRow[]> {
  return (await c.rpc<WatchedRow[] | null>("sync_pull_watched_items", { p_profile_id: profile, p_page: 1, p_page_size: 2000 })) ?? [];
}

export async function pushWatched(c: NuvioClient, profile: number, rows: readonly WatchedRow[]): Promise<void> {
  if (rows.length) await c.rpc("sync_push_watched_items", { p_profile_id: profile, p_items: rows });
}

export async function deleteWatched(
  c: NuvioClient,
  profile: number,
  keys: readonly { content_id: string; season?: number; episode?: number }[],
): Promise<void> {
  if (keys.length) await c.rpc("sync_delete_watched_items", { p_profile_id: profile, p_keys: keys });
}

/** Titles the profile has watched whole: movies, and series marked without an episode. */
export const watchedTitleIds = (rows: readonly WatchedRow[]): string[] => [
  ...new Set(rows.filter((r) => r.content_id && (r.content_type === "movie" || r.season == null)).map((r) => r.content_id)),
];

const CINEMETA = "https://v3-cinemeta.strem.io";
const KITSU = "https://anime-kitsu.strem.fun";
const META_CACHE = "sectv.nuvio.meta";
const META_MAX = 120;

/**
 * Fills in name and art for items that came from another device, from Cinemeta (IMDb ids) or the Kitsu addon,
 * with a small persistent cache so Nest's Continue Watching does not ask again on every wake.
 */
export async function withMeta(items: readonly ResumeItem[], kv: KV, f: typeof fetch = fetch): Promise<ResumeItem[]> {
  const cache = kv.get<Record<string, SlimTitle>>(META_CACHE) ?? {};
  let changed = false;
  const out = await Promise.all(
    items.map(async (item) => {
      if (item.title.name) return item;
      const id = item.title.id;
      let title = cache[id];
      if (!title) {
        try {
          const kitsu = id.startsWith("kitsu:");
          const url = kitsu ? `${KITSU}/meta/series/${id}.json` : `${CINEMETA}/meta/${item.type === "movie" ? "movie" : "series"}/${id}.json`;
          const res = await f(url);
          const meta = res.ok ? ((await res.json()) as { meta?: Record<string, unknown> }).meta : undefined;
          if (meta?.name) {
            title = {
              id,
              name: String(meta.name),
              year: String(meta.releaseInfo ?? meta.year ?? "").slice(0, 9),
              rating: String(meta.imdbRating ?? ""),
              poster: typeof meta.poster === "string" ? meta.poster : undefined,
              background: typeof meta.background === "string" ? meta.background : undefined,
            };
            cache[id] = title;
            changed = true;
          }
        } catch {
          // Offline: the item keeps its bare title and the id-based artwork.
        }
      }
      if (!title) return item;
      const ep = item.episode;
      return { ...item, title, ...(ep ? { episode: { ...ep, name: ep.name || `Episode ${ep.episode}` } } : {}) };
    }),
  );
  if (changed) {
    const keys = Object.keys(cache);
    for (const k of keys.slice(0, Math.max(0, keys.length - META_MAX))) delete cache[k];
    kv.set(META_CACHE, cache);
  }
  return out;
}
