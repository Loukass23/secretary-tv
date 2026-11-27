import type { SimklClient } from "./client.ts";

export type Kind = "movie" | "show" | "anime";

/** Simkl's ids for a title, from the catalog's own id (IMDb `tt…`, `tmdb:…`, `kitsu:…`, `mal:…`). */
export type SimklIds = Partial<Record<"imdb" | "tmdb" | "kitsu" | "mal" | "simkl", string | number>>;

export function toIds(id: string): SimklIds | null {
  if (/^tt\d+$/.test(id)) return { imdb: id };
  const m = /^(tmdb|kitsu|mal|simkl):(\d+)$/.exec(id);
  if (!m) return null;
  return { [m[1]]: Number(m[2]) } as SimklIds;
}

/** The catalog id back from Simkl's ids, in the order the catalog prefers. */
export function fromIds(ids: SimklIds | undefined, kind: Kind): string | null {
  if (!ids) return null;
  if (kind === "anime" && ids.kitsu) return `kitsu:${ids.kitsu}`;
  if (ids.imdb && /^tt\d+$/.test(String(ids.imdb))) return String(ids.imdb);
  if (ids.tmdb) return `tmdb:${ids.tmdb}`;
  if (ids.kitsu) return `kitsu:${ids.kitsu}`;
  return null;
}

export interface Played {
  id: string;
  kind: Kind;
  title?: string;
  season?: number;
  episode?: number;
}

/** The body Simkl's history and scrobble calls take for one movie or episode. */
export function itemBody(p: Played): Record<string, unknown> | null {
  const ids = toIds(p.id);
  if (!ids) return null;
  if (p.kind === "movie") return { movie: { title: p.title, ids } };
  const show = { title: p.title, ids };
  if (p.season == null || p.episode == null) return { show };
  return { show, episode: { season: p.season, number: p.episode } };
}

/** History add/remove bodies group by kind: movies, shows (with seasons and episodes). */
export function historyBody(items: readonly Played[], at = new Date()): Record<string, unknown[]> {
  const movies: unknown[] = [];
  const shows = new Map<string, { title?: string; ids: SimklIds; seasons: Map<number, number[]> }>();
  const watched_at = at.toISOString();
  for (const p of items) {
    const ids = toIds(p.id);
    if (!ids) continue;
    if (p.kind === "movie") {
      movies.push({ title: p.title, ids, watched_at });
      continue;
    }
    const s = shows.get(p.id) ?? { title: p.title, ids, seasons: new Map() };
    shows.set(p.id, s);
    if (p.season != null && p.episode != null) s.seasons.set(p.season, [...(s.seasons.get(p.season) ?? []), p.episode]);
  }
  const out: Record<string, unknown[]> = {};
  if (movies.length) out.movies = movies;
  if (shows.size) {
    out.shows = [...shows.values()].map((s) =>
      s.seasons.size
        ? { title: s.title, ids: s.ids, seasons: [...s.seasons].map(([number, eps]) => ({ number, episodes: eps.map((n) => ({ number: n, watched_at })) })) }
        : { title: s.title, ids: s.ids, watched_at },
    );
  }
  return out;
}

export const addHistory = (c: SimklClient, items: readonly Played[]) => c.call("/sync/history", { method: "POST", body: historyBody(items) });
export const removeHistory = (c: SimklClient, items: readonly Played[]) => c.call("/sync/history/remove", { method: "POST", body: historyBody(items) });

export type ScrobbleState = "start" | "pause" | "stop";

/** Tells Simkl what is playing; `stop` at 80 % or more marks it watched there. */
export async function scrobble(c: SimklClient, state: ScrobbleState, p: Played, progress: number): Promise<void> {
  const body = itemBody(p);
  if (!body) return;
  await c.call(`/scrobble/${state}`, { method: "POST", body: { ...body, progress: Math.round(Math.max(0, Math.min(100, progress)) * 100) / 100 } });
}

interface AllItemsEntry {
  status?: string;
  movie?: { ids?: SimklIds };
  show?: { ids?: SimklIds };
  seasons?: { number?: number; episodes?: { number?: number }[] }[];
}

export interface WatchedPull {
  titles: string[];
  episodes: Record<string, string[]>;
}

/** Titles watched whole and episodes watched (`season:episode` by title), from Simkl's all-items lists. Pure. */
export function watchedFrom(lists: Partial<Record<"movies" | "shows" | "anime", AllItemsEntry[]>>): WatchedPull {
  const titles = new Set<string>();
  const episodes: Record<string, string[]> = {};
  for (const e of lists.movies ?? []) {
    const id = fromIds(e.movie?.ids, "movie");
    if (id && e.status === "completed") titles.add(id);
  }
  for (const [key, kind] of [["shows", "show"], ["anime", "anime"]] as const) {
    for (const e of lists[key] ?? []) {
      const id = fromIds(e.show?.ids, kind);
      if (!id) continue;
      if (e.status === "completed") titles.add(id);
      const keys = (e.seasons ?? []).flatMap((s) => (s.episodes ?? []).filter((x) => x.number != null).map((x) => `${s.number ?? 1}:${x.number}`));
      if (keys.length) episodes[id] = [...new Set([...(episodes[id] ?? []), ...keys])];
    }
  }
  return { titles: [...titles], episodes };
}

export async function pullWatched(c: SimklClient): Promise<WatchedPull> {
  const lists = await c.call<Partial<Record<"movies" | "shows" | "anime", AllItemsEntry[]>>>("/sync/all-items/?extended=full&episode_watched_at=yes");
  return watchedFrom(lists ?? {});
}

export interface SimklStats {
  name?: string;
  avatar?: string;
  /** Minutes watched, all kinds. */
  minutes: number;
  movies: number;
  episodes: number;
  shows: number;
}

interface StatsAnswer {
  total_mins?: number;
  movies?: { total_mins?: number; completed?: { count?: number } };
  tv?: { total_mins?: number; completed?: { count?: number }; watching?: { count?: number; watched_episodes_count?: number } };
  anime?: { total_mins?: number; completed?: { count?: number }; watching?: { count?: number; watched_episodes_count?: number } };
}

/** Pure: Simkl's stats answer summed into the numbers the profile page shows. */
export function statsFrom(a: StatsAnswer, user?: { name?: string; avatar?: string }): SimklStats {
  const n = (x?: number) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return {
    name: user?.name,
    avatar: user?.avatar,
    minutes: n(a.total_mins) || n(a.movies?.total_mins) + n(a.tv?.total_mins) + n(a.anime?.total_mins),
    movies: n(a.movies?.completed?.count),
    episodes: n(a.tv?.watching?.watched_episodes_count) + n(a.anime?.watching?.watched_episodes_count),
    shows: n(a.tv?.completed?.count) + n(a.tv?.watching?.count) + n(a.anime?.completed?.count) + n(a.anime?.watching?.count),
  };
}

export async function stats(c: SimklClient): Promise<SimklStats> {
  const me = await c.call<{ user?: { name?: string; avatar?: string }; account?: { id?: number } }>("/users/settings", { method: "POST" });
  const id = me?.account?.id;
  if (!id) return statsFrom({}, me?.user);
  return statsFrom((await c.call<StatsAnswer>(`/users/${id}/stats`, { method: "POST" })) ?? {}, me?.user);
}
