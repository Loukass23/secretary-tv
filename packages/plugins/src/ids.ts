// Catalog ids to what providers take: getStreams(tmdbId, "movie" | "tv", season, episode).

export interface ProviderTarget {
  tmdbId: string;
  mediaType: "movie" | "tv";
  season: number | null;
  episode: number | null;
}

export interface IdOptions {
  fetch?: typeof fetch;
  /** TMDB's /find maps IMDb ids; without a key Cinemeta's meta (its moviedb_id) does. */
  tmdbKey?: string;
}

export interface EpisodeNumbers {
  season?: number;
  episode?: number;
  absolute?: number;
}

const ARM = "https://arm.haglund.dev/api/v2";
const TMDB = "https://api.themoviedb.org/3";
const CINEMETA = "https://v3-cinemeta.strem.io";
const ANIME = new Set(["kitsu", "mal", "anilist"]);

/**
 * "tt123" / "tt123:1:2" / "tmdb:603" / "kitsu:7442:5". IMDb ids are mapped to TMDB (cached). An anime episode the
 * catalog has placed in a TMDB-style season (`hint.season` and `hint.episode`, from its IMDb numbering) is mapped
 * through ARM to that show's TMDB id; otherwise it passes through as "kitsu:7442" with the absolute episode and no
 * season, as the official Nuvio apps do, and only providers that know anime answer it.
 */
export function createIdMapper({ fetch: f = fetch, tmdbKey = "" }: IdOptions = {}) {
  const cache = new Map<string, Promise<string | null>>();

  async function lookup(imdb: string, mediaType: "movie" | "tv"): Promise<string | null> {
    if (tmdbKey) {
      const res = await f(`${TMDB}/find/${imdb}?external_source=imdb_id&api_key=${encodeURIComponent(tmdbKey)}`);
      if (res.ok) {
        const body = (await res.json()) as { movie_results?: { id: number }[]; tv_results?: { id: number }[] };
        const hit = (mediaType === "movie" ? body.movie_results : body.tv_results)?.[0];
        if (hit) return String(hit.id);
      }
    }
    // ARM only knows anime; Cinemeta lists the TMDB id of every title it has.
    const res = await f(`${CINEMETA}/meta/${mediaType === "movie" ? "movie" : "series"}/${imdb}.json`);
    if (!res.ok) return null;
    const body = (await res.json()) as { meta?: { moviedb_id?: number | string | null } } | null;
    const id = body?.meta?.moviedb_id;
    return id ? String(id) : null;
  }

  /** Kitsu, MAL or AniList id to the TMDB show ARM lists for it. */
  async function animeLookup(source: string, id: string): Promise<string | null> {
    const res = await f(`${ARM}/ids?source=${source === "mal" ? "myanimelist" : source}&id=${id}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { themoviedb?: number | null } | null;
    return body?.themoviedb ? String(body.themoviedb) : null;
  }

  function cached(key: string, load: () => Promise<string | null>): Promise<string | null> {
    let p = cache.get(key);
    if (!p) {
      p = load();
      cache.set(key, p);
      // Misses and failures are asked again next time.
      p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
    }
    return p;
  }

  function imdbToTmdb(imdb: string, mediaType: "movie" | "tv"): Promise<string | null> {
    return cached(`${mediaType}:${imdb}`, () => lookup(imdb, mediaType));
  }

  return async function target(
    id: string,
    type: "movie" | "series",
    hint?: EpisodeNumbers,
  ): Promise<ProviderTarget | null> {
    const mediaType = type === "movie" ? "movie" : "tv";
    const num = (x: string | undefined) => (x != null && /^\d+$/.test(x) ? Number(x) : null);
    const parts = id.split(":");
    if (ANIME.has(parts[0])) {
      if (hint?.season != null && hint.episode != null) {
        const tmdbId = await cached(`${parts[0]}:${parts[1]}`, () => animeLookup(parts[0], parts[1])).catch(() => null);
        if (tmdbId) return { tmdbId, mediaType: "tv", season: hint.season, episode: hint.episode };
      }
      const episode = hint?.absolute ?? hint?.episode ?? num(parts[2]);
      return { tmdbId: `${parts[0]}:${parts[1]}`, mediaType, season: null, episode };
    }
    // "tmdb:603:1:2" reads like "603:1:2".
    const [base, a, b] = parts[0] === "tmdb" ? parts.slice(1) : parts;
    const ep =
      mediaType === "tv"
        ? { season: hint?.season ?? num(a), episode: hint?.episode ?? num(b) }
        : { season: null, episode: null };
    if (base && /^\d+$/.test(base)) return { tmdbId: base, mediaType, ...ep };
    if (base && /^tt\d+$/.test(base)) {
      const tmdbId = await imdbToTmdb(base, mediaType);
      return tmdbId ? { tmdbId, mediaType, ...ep } : null;
    }
    return null;
  };
}
