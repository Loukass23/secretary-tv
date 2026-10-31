// Choosing which file of a torrent to play. Kept apart from the HTTP code so it can be tested on its own.

export const VIDEO = /\.(mkv|mp4|m4v|avi|mov|ts|webm)$/i;

/**
 * Which episode a stream is for. `season` and `episode` are the S01E02 numbering; `absolute` is the
 * running number anime releases use (" - 05"). Anime ids ("kitsu:7442:3") carry neither season nor
 * absolute number, so the app adds them to the resolve URL from the episode's metadata.
 */
export interface EpisodeHint {
  season?: number;
  episode?: number;
  absolute?: number;
}

/** "tt0944947:1:2" is season 1 episode 2. Movies and plain ids have no hint. */
export function episodeHint(id: string): EpisodeHint | null {
  const m = /^tt\d+:(\d+):(\d+)$/.exec(id);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}

/** True when a file name carries this season and episode: S01E02, s1e2, 1x02 or the anime style "S1 - 02". */
export function matchesEpisode(name: string, season: number, episode: number): boolean {
  const re = new RegExp(
    String.raw`(?:\bs0*${season}[ ._-]?e0*${episode}(?!\d)|\b0*${season}x0*${episode}(?!\d)|\bs(?:eason)?[ ._]*0*${season}[ ._]*-[ ._]*0*${episode}(?!\d))`,
    "i",
  );
  return re.test(name);
}

/**
 * True when a file name carries this running episode number, as anime releases write it:
 * "[Group] Title - 05 [1080p].mkv". Bracketed tags, resolutions, codecs and "2.0" style
 * channel counts are dropped first so they cannot match, and the number must stand alone.
 */
export function matchesAbsolute(name: string, n: number): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(?:2160|1080|720|480)p\b|\bx26[45]\b|\bh\.?26[45]\b|\b\d+bit\b|\b\d\.\d\b|\bv\d\b/gi, " ")
    .replace(/\.[a-z0-9]{2,4}$/i, "");
  return new RegExp(String.raw`(?<!\d)0*${n}(?!\d)`).test(cleaned);
}

/** Folders and names that hold something other than a regular episode. */
const NON_EPISODE =
  /\b(?:movies?|ovas?|oads?|specials?|extras?|creditless|ncop|nced|pv|trailers?|previews?|recaps?|samples?|junior high)\b/i;

/** The parts of a path below the torrent's root folder, whose own name often lists "OVA+Movies". */
const below = (name: string) => {
  const parts = name.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(1) : parts;
};

/** The season a folder such as "Season 2" or "S02" names, if any folder on the way does. */
function folderSeason(name: string): number | null {
  for (const part of below(name).slice(0, -1)) {
    const m = /\b(?:season|s)[ ._-]?0*(\d+)\b/i.exec(part);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * How well a file fits the wanted episode, or null when it names neither the season and episode nor
 * the running number. A batch can hold the same number in several places (a movie 03, an OVA 03, season
 * 2's episode 03), so the folder decides between them: the right season folder wins, extras lose.
 */
export function episodeScore(name: string, hint: EpisodeHint): number | null {
  const sxe = hint.season != null && hint.episode != null && matchesEpisode(name, hint.season, hint.episode);
  const abs = hint.absolute != null && matchesAbsolute(name, hint.absolute);
  if (!sxe && !abs) return null;
  let score = (sxe ? 100 : 0) + (abs ? 50 : 0);
  if (below(name).some((part) => NON_EPISODE.test(part))) score -= 1000;
  const folder = folderSeason(name);
  if (folder != null && hint.season != null) score += folder === hint.season ? 20 : -20;
  return score;
}

/**
 * Picks the file to play. An episode hint wins (a season pack holds many videos), then the upstream
 * index when it lands on a video, then the largest video.
 */
export function pickFile<T extends { id: number; name: string; size: number }>(
  files: readonly T[],
  fileIdx: number | undefined,
  hint: EpisodeHint | null,
): T | undefined {
  const videos = files.filter((x) => VIDEO.test(x.name));
  const pool = videos.length ? videos : files;
  const bySize = (a: T, b: T) => b.size - a.size;
  if (hint) {
    const scored = pool
      .map((x) => ({ x, score: episodeScore(x.name, hint) }))
      .filter((r): r is { x: T; score: number } => r.score != null && r.score > -500)
      .sort((a, b) => b.score - a.score || bySize(a.x, b.x));
    if (scored.length) return scored[0].x;
  }
  return pool.find((x) => x.id === fileIdx) ?? [...pool].sort(bySize)[0];
}
