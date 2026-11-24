import type { Video } from "./types.ts";

/** Real seasons ascending, specials (season 0) last. */
export function seasonsOf(videos: readonly Video[]): number[] {
  const all = [...new Set(videos.map((v) => v.season))].sort((a, b) => a - b);
  return [...all.filter((s) => s > 0), ...all.filter((s) => s === 0)];
}

export function episodesOf(videos: readonly Video[], season: number): Video[] {
  return videos.filter((v) => v.season === season).sort((a, b) => a.episode - b.episode);
}

/** Episodes without a release date count as aired; only a future date means "not yet". */
export function hasAired(v: Video, now: number = Date.now()): boolean {
  if (!v.released) return true;
  const t = Date.parse(v.released);
  return Number.isNaN(t) || t <= now;
}

/** Season order with specials last, then episode order: the order "next" follows. */
function ordered(videos: readonly Video[]): Video[] {
  return seasonsOf(videos).flatMap((s) => episodesOf(videos, s));
}

/** The episode after `current` among aired episodes, skipping specials unless `current` is one. */
export function nextEpisode(videos: readonly Video[], current: string, now: number = Date.now()): Video | null {
  const all = ordered(videos);
  const i = all.findIndex((v) => v.id === current);
  if (i < 0) return null;
  const here = all[i];
  for (const v of all.slice(i + 1)) {
    if (v.season === 0 && here.season !== 0) return null;
    if (hasAired(v, now)) return v;
  }
  return null;
}

/**
 * Where Play starts, the "up next": the remembered episode if it still exists; else the first aired regular episode not
 * yet watched after the furthest one watched (`watched` holds `season:episode` keys), so a show caught up from season
 * 12 does not open on S1E1; else the first one not watched; else the first aired regular one.
 */
export function defaultEpisode(
  videos: readonly Video[],
  rememberedId?: string,
  now: number = Date.now(),
  watched: ReadonlySet<string> = new Set(),
): Video | null {
  const remembered = rememberedId ? videos.find((v) => v.id === rememberedId) : undefined;
  if (remembered) return remembered;
  const all = ordered(videos);
  const regular = all.filter((v) => v.season > 0 && hasAired(v, now));
  const seen = (v: Video) => watched.has(`${v.season}:${v.episode}`);
  let furthest = -1;
  regular.forEach((v, i) => {
    if (seen(v)) furthest = i;
  });
  return regular.slice(furthest + 1).find((v) => !seen(v)) ?? regular.find((v) => !seen(v)) ?? regular[0] ?? all.find((v) => hasAired(v, now)) ?? null;
}

export const episodeLabel = (v: Pick<Video, "season" | "episode">) =>
  v.season === 0 ? `Special ${v.episode}` : `S${v.season}E${v.episode}`;

/** What the server needs to pick the right file out of an anime batch: IMDb-style numbers and the running number. */
export interface FileHint {
  season?: number;
  episode?: number;
  absolute?: number;
  /** The title's year, for the id mapper to tell two shows of one name apart. Never sent in a resolve URL. */
  year?: number;
  /** Whether the opened title is anime, which picks the provider scope. Never sent in a resolve URL. */
  anime?: boolean;
}

/** Kitsu ids need season/episode/absolute; IMDb-style anime ids ("tt…:1:2") only need the running episode number added. */
export function fileHintFor(v: Video): FileHint | undefined {
  if (v.id.startsWith("kitsu:")) {
    return {
      season: v.imdbSeason,
      episode: v.imdbEpisode,
      absolute: v.absoluteEpisode ?? v.episode,
    };
  }
  if (v.absoluteEpisode != null) {
    return { absolute: v.absoluteEpisode };
  }
  return undefined;
}

