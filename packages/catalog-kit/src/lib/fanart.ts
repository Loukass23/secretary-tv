import { backgroundUrl, posterUrl } from "./cinemeta.ts";
import type { ArtworkProviderPref } from "./settings.ts";
import type { CatalogType, Title } from "./types.ts";

declare const __FANART_API_KEY__: string | undefined;
declare const __TMDB_API_KEY__: string | undefined;
declare const __TVDB_API_KEY__: string | undefined;

const FANART_BASE = "https://webservice.fanart.tv/v3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TVDB_BASE = "https://api4.thetvdb.com/v4";
const META_BASE = "https://v3-cinemeta.strem.io";
const KITSU_BASE = "https://anime-kitsu.strem.fun";

let configuredFanartKey = typeof __FANART_API_KEY__ !== "undefined" ? __FANART_API_KEY__ : "";
let configuredTmdbKey = typeof __TMDB_API_KEY__ !== "undefined" ? __TMDB_API_KEY__ : "";
let configuredTvdbKey = typeof __TVDB_API_KEY__ !== "undefined" ? __TVDB_API_KEY__ : "";

export function setFanartKeys(keys: {
  fanartApiKey?: string;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
}): void {
  if (keys.fanartApiKey !== undefined) configuredFanartKey = keys.fanartApiKey;
  if (keys.tmdbApiKey !== undefined) configuredTmdbKey = keys.tmdbApiKey;
  if (keys.tvdbApiKey !== undefined) configuredTvdbKey = keys.tvdbApiKey;
}

export interface FrameArtworkResult {
  /** Ordered list of backdrop/poster URLs: index 0 is primary, remaining are automatic fallbacks on error. */
  urls: string[];
  /** Optional clearlogo from Fanart.tv. */
  logoUrl?: string;
  /** Which tier supplied the primary URL. */
  provider: "Fanart.tv" | "TMDB" | "Addon";
}

interface FanartImageEntry {
  id?: string;
  url?: string;
  lang?: string;
  likes?: string;
}

interface FanartMovieResponse {
  moviebackground?: FanartImageEntry[];
  moviethumb?: FanartImageEntry[];
  hdmovielogo?: FanartImageEntry[];
  movieposter?: FanartImageEntry[];
}

interface FanartTvResponse {
  showbackground?: FanartImageEntry[];
  tvthumb?: FanartImageEntry[];
  hdtvlogo?: FanartImageEntry[];
  tvposter?: FanartImageEntry[];
}

const memoryCache = new Map<string, FrameArtworkResult>();

export function clearFanartCache(): void {
  memoryCache.clear();
}

function sortByLikes(entries?: FanartImageEntry[], preferLang = "en"): string[] {
  if (!Array.isArray(entries) || !entries.length) return [];
  return [...entries]
    .filter((e): e is FanartImageEntry & { url: string } => typeof e?.url === "string" && e.url.startsWith("http"))
    .sort((a, b) => {
      const aLang = a.lang === preferLang || a.lang === "00" || !a.lang ? 1 : 0;
      const bLang = b.lang === preferLang || b.lang === "00" || !b.lang ? 1 : 0;
      if (aLang !== bLang) return bLang - aLang;
      return Number(b.likes ?? 0) - Number(a.likes ?? 0);
    })
    .map((e) => e.url);
}

function dedupe(urls: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (u && u.startsWith("http") && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/** Resolves TVDB series ID for an IMDb or Kitsu ID so Fanart.tv `/v3/tv/{tvdb_id}` can be queried. */
async function resolveTvdbIdForSeries(
  id: string,
  f: typeof fetch,
): Promise<string | null> {
  let imdbId = id.startsWith("tt") ? id : "";

  if (id.startsWith("kitsu:")) {
    try {
      const r = await f(`${KITSU_BASE}/meta/series/${id}.json`);
      if (r.ok) {
        const { meta } = (await r.json()) as { meta?: { tvdb_id?: number | string; imdb_id?: string } };
        if (meta?.tvdb_id) return String(meta.tvdb_id);
        if (meta?.imdb_id?.startsWith("tt")) imdbId = meta.imdb_id;
      }
    } catch {
      // Fall through to Cinemeta/TVDB lookup.
    }
  }

  if (!imdbId) return null;

  // Fast path: Cinemeta series meta includes `tvdb_id` without needing a token handshake.
  try {
    const r = await f(`${META_BASE}/meta/series/${encodeURIComponent(imdbId)}.json`);
    if (r.ok) {
      const { meta } = (await r.json()) as { meta?: { tvdb_id?: number | string } };
      if (meta?.tvdb_id) return String(meta.tvdb_id);
    }
  } catch {
    // Fall through to TVDB v4 API if configured.
  }

  if (configuredTvdbKey) {
    try {
      const loginRes = await f(`${TVDB_BASE}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apikey: configuredTvdbKey }),
      });
      if (loginRes.ok) {
        const { data } = (await loginRes.json()) as { data?: { token?: string } };
        if (data?.token) {
          const sRes = await f(`${TVDB_BASE}/search/remoteid/${encodeURIComponent(imdbId)}`, {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          if (sRes.ok) {
            const sBody = (await sRes.json()) as { data?: { series?: { id?: number } }[] };
            const tvdbId = sBody.data?.find((d) => d.series?.id)?.series?.id;
            if (tvdbId) return String(tvdbId);
          }
        }
      }
    } catch {
      // Ignore TVDB error and fall back to TMDB/Addon.
    }
  }

  return null;
}

async function fetchFanartUrls(
  type: CatalogType,
  id: string,
  fanartKey: string,
  f: typeof fetch,
): Promise<{ urls: string[]; logoUrl?: string }> {
  if (!fanartKey) return { urls: [] };
  try {
    if (type === "movie") {
      if (!id.startsWith("tt")) return { urls: [] };
      const res = await f(
        `${FANART_BASE}/movies/${encodeURIComponent(id)}?api_key=${encodeURIComponent(fanartKey)}`,
      );
      if (!res.ok) return { urls: [] };
      const data = (await res.json()) as FanartMovieResponse;
      const urls = dedupe([
        ...sortByLikes(data.moviebackground),
        ...sortByLikes(data.moviethumb),
        ...sortByLikes(data.movieposter),
      ]);
      const logoUrl = sortByLikes(data.hdmovielogo)[0];
      return { urls, logoUrl };
    }

    // Series and Anime use Fanart.tv's `/v3/tv/{tvdb_id}` endpoint (with fallback to `/v3/movies/{imdb_id}` for anime films).
    const tvdbId = await resolveTvdbIdForSeries(id, f);
    if (tvdbId) {
      const res = await f(
        `${FANART_BASE}/tv/${encodeURIComponent(tvdbId)}?api_key=${encodeURIComponent(fanartKey)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as FanartTvResponse;
        const urls = dedupe([
          ...sortByLikes(data.showbackground),
          ...sortByLikes(data.tvthumb),
          ...sortByLikes(data.tvposter),
        ]);
        const logoUrl = sortByLikes(data.hdtvlogo)[0];
        if (urls.length) return { urls, logoUrl };
      }
    }

    if (id.startsWith("tt")) {
      const movieRes = await f(
        `${FANART_BASE}/movies/${encodeURIComponent(id)}?api_key=${encodeURIComponent(fanartKey)}`,
      );
      if (movieRes.ok) {
        const data = (await movieRes.json()) as FanartMovieResponse;
        const urls = dedupe([
          ...sortByLikes(data.moviebackground),
          ...sortByLikes(data.moviethumb),
        ]);
        const logoUrl = sortByLikes(data.hdmovielogo)[0];
        if (urls.length) return { urls, logoUrl };
      }
    }
  } catch {
    // Fanart.tv frequently drops or times out; silently fall back to TMDB / Addon tiers.
  }
  return { urls: [] };
}

async function fetchTmdbBackdrop(
  id: string,
  tmdbKey: string,
  f: typeof fetch,
): Promise<string[]> {
  if (!tmdbKey || !id.startsWith("tt")) return [];
  try {
    const res = await f(
      `${TMDB_BASE}/find/${encodeURIComponent(id)}?api_key=${encodeURIComponent(tmdbKey)}&external_source=imdb_id`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      movie_results?: { backdrop_path?: string; poster_path?: string }[];
      tv_results?: { backdrop_path?: string; poster_path?: string }[];
    };
    const hit = data.movie_results?.[0] ?? data.tv_results?.[0];
    if (!hit) return [];
    return dedupe([
      hit.backdrop_path ? `https://image.tmdb.org/t/p/w1280${hit.backdrop_path}` : undefined,
      hit.poster_path ? `https://image.tmdb.org/t/p/w780${hit.poster_path}` : undefined,
    ]);
  } catch {
    return [];
  }
}

function addonFallbackUrls(title: Pick<Title, "id" | "poster" | "background">): string[] {
  const metahubBg = title.id.startsWith("tt")
    ? `https://images.metahub.space/background/medium/${title.id}/img`
    : undefined;
  return dedupe([
    title.background,
    metahubBg,
    backgroundUrl(title),
    title.poster,
    posterUrl(title),
  ]);
}

/**
 * Resolves high-resolution Nest dashboard artwork for a Movie, Series, or Anime title.
 * Queries Fanart.tv first (when `preferredProvider === "fanart"`), then layers TMDB and Addon
 * (Metahub/Kitsu/Cinemeta) URLs as fallbacks so the Frame never drops an image.
 */
export async function resolveFrameArtwork(
  type: CatalogType,
  title: Pick<Title, "id" | "name" | "poster" | "background">,
  preferredProvider: ArtworkProviderPref = "fanart",
  f: typeof fetch = fetch,
): Promise<FrameArtworkResult> {
  const cacheKey = `${preferredProvider}:${type}:${title.id}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  const addonUrls = addonFallbackUrls(title);

  if (preferredProvider === "addon") {
    const res: FrameArtworkResult = { urls: addonUrls, provider: "Addon" };
    memoryCache.set(cacheKey, res);
    return res;
  }

  const [fanart, tmdbUrls] = await Promise.all([
    preferredProvider === "fanart"
      ? fetchFanartUrls(type, title.id, configuredFanartKey, f)
      : Promise.resolve({ urls: [] as string[], logoUrl: undefined }),
    fetchTmdbBackdrop(title.id, configuredTmdbKey, f),
  ]);

  if (fanart.urls.length > 0) {
    const res: FrameArtworkResult = {
      urls: dedupe([...fanart.urls, ...tmdbUrls, ...addonUrls]),
      logoUrl: fanart.logoUrl,
      provider: "Fanart.tv",
    };
    memoryCache.set(cacheKey, res);
    return res;
  }

  if (tmdbUrls.length > 0 || title.background?.includes("image.tmdb.org")) {
    const res: FrameArtworkResult = {
      urls: dedupe([...tmdbUrls, ...addonUrls]),
      provider: "TMDB",
    };
    memoryCache.set(cacheKey, res);
    return res;
  }

  const res: FrameArtworkResult = {
    urls: addonUrls,
    provider: "Addon",
  };
  memoryCache.set(cacheKey, res);
  return res;
}
