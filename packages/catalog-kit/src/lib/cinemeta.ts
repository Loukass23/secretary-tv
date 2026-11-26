import type { CatalogType, Title, Video } from "./types.ts";

declare const __TMDB_API_KEY__: string | undefined;
declare const __TVDB_API_KEY__: string | undefined;

const CATALOGS = "https://cinemeta-catalogs.strem.io";
const META = "https://v3-cinemeta.strem.io";
const KITSU = "https://anime-kitsu.strem.fun";
const TMDB = "https://api.themoviedb.org/3";
const TVDB = "https://api4.thetvdb.com/v4";

let configuredTmdbKey = typeof __TMDB_API_KEY__ !== "undefined" ? __TMDB_API_KEY__ : "";
let configuredTvdbKey = typeof __TVDB_API_KEY__ !== "undefined" ? __TVDB_API_KEY__ : "";
const tvdbTokens = new Map<string, Promise<string | null>>();

export function setMetaKeys(keys: { tmdbApiKey?: string; tvdbApiKey?: string }): void {
  if (keys.tmdbApiKey !== undefined) configuredTmdbKey = keys.tmdbApiKey;
  if (keys.tvdbApiKey !== undefined) configuredTvdbKey = keys.tvdbApiKey;
}

/** Installed addons' meta (lib/addons.ts), asked before every other source; null when none answers. */
let addonMeta: ((type: CatalogType, id: string) => Promise<RawMeta | null>) | null = null;

export function setAddonMeta(fn: typeof addonMeta): void {
  addonMeta = fn;
}

export function getTmdbKey(): string {
  return configuredTmdbKey;
}

/** The home rows for a catalog type. Movies and series come from Cinemeta, anime from the Kitsu addon. */
export function rowsFor(type: CatalogType) {
  const genre = (id: string, name: string, title = name) => ({ id: `genre-${id}`, title, url: `${META}/catalog/${type}/top/genre=${encodeURIComponent(name)}.json` });
  if (type === "anime") {
    const anime = (name: string) => ({ id: `genre-${name.toLowerCase()}`, title: name, url: `${KITSU}/catalog/anime/kitsu-anime-popular/genre=${encodeURIComponent(name)}.json` });
    return [
      { id: "trending", title: "Trending", url: `${KITSU}/catalog/anime/kitsu-anime-trending.json` },
      { id: "airing", title: "Airing now", url: `${KITSU}/catalog/anime/kitsu-anime-airing.json` },
      { id: "popular", title: "Popular", url: `${KITSU}/catalog/anime/kitsu-anime-popular.json` },
      { id: "rated", title: "Top rated", url: `${KITSU}/catalog/anime/kitsu-anime-rating.json` },
      anime("Action"),
      anime("Comedy"),
    ] as const;
  }
  return [
    { id: "top", title: "Popular", url: `${CATALOGS}/top/catalog/${type}/top.json` },
    { id: "rated", title: "Top rated", url: `${CATALOGS}/imdbRating/catalog/${type}/imdbRating.json` },
    { id: "new", title: "New releases", url: `${CATALOGS}/year/catalog/${type}/year.json` },
    // Genre rows: reached by pressing Down through the home, like the rows above.
    ...(type === "movie" ? [genre("action", "Action"), genre("comedy", "Comedy"), genre("scifi", "Sci-Fi"), genre("thriller", "Thriller")] : [genre("drama", "Drama"), genre("comedy", "Comedy"), genre("crime", "Crime")]),
  ] as const;
}

/** Kitsu serves `small` posters (284 px wide) beside the `medium` ones its catalog links to. */
const smallPoster = (url: string) =>
  url.replace("/medium.", "/small.").replace("/poster/medium/", "/poster/small/");

type Art = Pick<Title, "id" | "poster" | "background">;

export const posterUrl = (t: Art) =>
  t.poster ? smallPoster(t.poster) : `https://images.metahub.space/poster/small/${t.id}/img`;
export const backgroundUrl = (t: Art) =>
  t.background ?? `https://images.metahub.space/background/medium/${t.id}/img`;

export interface RawVideo {
  id?: string;
  season?: number;
  episode?: number;
  number?: number;
  name?: string;
  title?: string;
  released?: string;
  thumbnail?: string;
  overview?: string;
  description?: string;
  imdbSeason?: number;
  imdbEpisode?: number;
  absoluteEpisode?: number;
}

export interface RawMeta {
  imdb_id?: string;
  id?: string;
  name?: string;
  year?: string;
  releaseInfo?: string;
  imdbRating?: string;
  description?: string;
  genre?: string[];
  genres?: string[];
  runtime?: string;
  poster?: string;
  background?: string;
  logo?: string;
  /** "Japan", or "Japan, United States". */
  country?: string;
  videos?: RawVideo[];
  cast?: string[];
  director?: string[] | string;
  writer?: string[] | string;
  /** An ISO date ("2026-11-20T00:00:00.000Z"). */
  released?: string;
  awards?: string;
  /** Newer metas carry the people as links, `category` "Cast" or "Directors". */
  links?: { name?: string; category?: string }[];
}

const names = (list: unknown): string[] | undefined => {
  const arr = typeof list === "string" ? list.split(",") : Array.isArray(list) ? list : [];
  const out = arr.filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter(Boolean);
  return out.length ? [...new Set(out)] : undefined;
};

/** The cast and the directors of a meta: its own fields, else its links. */
export function peopleOf(m: Pick<RawMeta, "cast" | "director" | "links">): { cast?: string[]; director?: string[] } {
  const linked = (cat: string) => names(m.links?.filter((l) => l.category?.toLowerCase() === cat).map((l) => l.name));
  const cast = names(m.cast) ?? linked("cast");
  const director = names(m.director) ?? linked("directors");
  // Only the fields there are, so a title without people stays as it was.
  return { ...(cast ? { cast } : {}), ...(director ? { director } : {}) };
}

/** What a film page lists about a title beyond its people (Detail.tsx About): only the fields the meta has. */
export function factsOf(m: Pick<RawMeta, "writer" | "released" | "country" | "awards">): Pick<Title, "writer" | "released" | "country" | "awards"> {
  const writer = names(m.writer);
  const released = typeof m.released === "string" && /^\d{4}-\d{2}-\d{2}/.test(m.released) ? m.released.slice(0, 10) : undefined;
  const country = typeof m.country === "string" && m.country.trim() ? m.country.trim() : undefined;
  const awards = typeof m.awards === "string" && m.awards.trim() && !/^n\/?a$/i.test(m.awards.trim()) ? m.awards.trim() : undefined;
  return { ...(writer ? { writer } : {}), ...(released ? { released } : {}), ...(country ? { country } : {}), ...(awards ? { awards } : {}) };
}

export function toVideo(v: RawVideo): Video | null {
  const episode = v.episode ?? v.number;
  if (!v.id || v.season == null || episode == null) return null;
  return {
    id: v.id,
    season: v.season,
    episode,
    name: v.name ?? v.title ?? `Episode ${episode}`,
    released: v.released,
    thumbnail: v.thumbnail,
    overview: v.overview ?? v.description,
    imdbSeason: v.imdbSeason,
    imdbEpisode: v.imdbEpisode,
    absoluteEpisode: v.absoluteEpisode,
  };
}

/**
 * A rating as every surface shows it: one decimal out of ten ("7.0", never "7" or "7.35"), empty when unknown or 0.
 * Ratings stored by older builds go through it too, so it takes what they held.
 */
export function ratingOf(v: unknown): string {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return n > 0 && n <= 10 ? n.toFixed(1) : "";
}

/** The rating's label on a card or page: "★ 7.0" (not "IMDb": TMDB rates too). Empty when there is none. */
export const ratingLabel = (v: unknown): string => {
  const r = ratingOf(v);
  return r && `★ ${r}`;
};

/**
 * The box-office line some catalogs lead a synopsis with, one piece at a time: an emoji, "Currently in theaters" (or
 * "Now playing in cinemas", "In theaters now"), "Released 6 days ago" (or today, yesterday), and what separates them.
 * "Released" only goes with a time, so a synopsis that starts "Released from prison, …" keeps its first word.
 */
const BOX_OFFICE =
  /^[\s\p{Extended_Pictographic}\uFE0F\u200D]*(?:(?:currently|now)\s+(?:playing\s+)?(?:in|at)\s+(?:the\s+)?(?:theat(?:er|re)s?|cinemas?)|in\s+(?:theat(?:er|re)s?|cinemas?)\s+now|released\s+(?:\d+\s+(?:days?|weeks?|months?)\s+ago|today|yesterday))[\s.!:|·•\-–—]*/iu;

/** A synopsis without the box-office line some catalogs lead with ("🎬 Currently in theaters - Released 6 days ago"). */
export function cleanSynopsis(text: string | undefined): string | undefined {
  let t = text ?? "";
  for (let i = 0; i < 4 && BOX_OFFICE.test(t); i++) t = t.replace(BOX_OFFICE, "");
  return t.trim() || undefined;
}

/** The metadata gives Japan as the country (lib/animeguard.ts decides what that means). */
const fromJapan = (country?: string) => (country && /\bjapan\b/i.test(country) ? { japanese: true } : {});

/** IMDb ids ("tt…") for movies and series, Kitsu ids ("kitsu:…") for ungrouped anime fallback. */
const isKnownId = (id: string) => id.startsWith("tt") || id.startsWith("kitsu:");

/** Strips season/cour suffixes so grouped anime seasons display as one series title. */
export function stripSeasonSuffix(name: string): string {
  return name
    .replace(/\s*[:\-–]?\s*(?:The\s+)?Final\s+Season(?:\s+Part\s+\d+)?$/i, "")
    .replace(/\s*[:\-–]?\s*(?:Season\s+\d+|\d+(?:st|nd|rd|th)\s+Season)(?:\s+Part\s+\d+)?$/i, "")
    .replace(/\s+Part\s+\d+$/i, "")
    .replace(/\s+[2-9]$/, "")
    .trim();
}

/**
 * Collapses multiple Kitsu season entries that share the same IMDb series id into a single
 * series entry while preserving the first appearance's rank in the row.
 */
export function groupAnimeMetas(metas: readonly RawMeta[]): RawMeta[] {
  const groups = new Map<string, RawMeta[]>();
  for (const m of metas) {
    const key = m.imdb_id?.startsWith("tt") ? m.imdb_id : m.id;
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  const out: RawMeta[] = [];
  for (const [key, list] of groups) {
    // Pick the entry whose name is already the base series name (or earliest year) for artwork/year.
    const base =
      list.find((m) => m.name && stripSeasonSuffix(m.name) === m.name) ??
      [...list].sort((a, b) =>
        (a.year ?? a.releaseInfo ?? "9999").localeCompare(b.year ?? b.releaseInfo ?? "9999"),
      )[0];
    out.push({
      ...base,
      id: key,
      imdb_id: key.startsWith("tt") ? key : base.imdb_id,
      name: base.name ? stripSeasonSuffix(base.name) : base.name,
    });
  }
  return out;
}

export function toTitle(m: RawMeta): Title | null {
  const id = m.id?.startsWith("kitsu:") ? m.id : (m.imdb_id ?? m.id);
  if (!id || !m.name || !isKnownId(id)) return null;
  const videos = m.videos?.map(toVideo).filter((v): v is Video => v !== null);
  const keepArt =
    id.startsWith("kitsu:") ||
    Boolean(m.poster && (m.poster.includes("kitsu.") || m.poster.includes("thetvdb.") || m.poster.includes("tmdb.")));
  return {
    id,
    name: m.name,
    year: m.year ?? m.releaseInfo?.slice(0, 4) ?? "",
    rating: ratingOf(m.imdbRating),
    description: cleanSynopsis(m.description),
    genre: m.genre ?? m.genres,
    runtime: m.runtime,
    poster: keepArt ? m.poster : undefined,
    background: keepArt ? m.background : undefined,
    ...(m.logo?.startsWith("http") ? { logo: m.logo } : {}),
    ...fromJapan(m.country),
    videos: videos?.length ? videos : undefined,
    ...peopleOf(m),
    ...factsOf(m),
  };
}

export async function fetchRow(url: string, f: typeof fetch = fetch): Promise<Title[]> {
  const res = await f(url);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const { metas = [] } = (await res.json()) as { metas?: RawMeta[] };
  const list = url.includes("kitsu") ? groupAnimeMetas(metas) : metas;
  // A catalog row never needs episodes; the detail page asks for the meta.
  return list.map((m) => toTitle({ ...m, videos: undefined })).filter((m): m is Title => m !== null);
}

async function getTvdbToken(apiKey: string, f: typeof fetch): Promise<string | null> {
  const cached = tvdbTokens.get(apiKey);
  if (cached) return cached;
  const p = (async () => {
    try {
      const res = await f(`${TVDB}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apikey: apiKey }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { token?: string } };
      return body.data?.token ?? null;
    } catch {
      return null;
    }
  })();
  tvdbTokens.set(apiKey, p);
  p.then((tok) => {
    if (!tok) tvdbTokens.delete(apiKey);
  });
  return p;
}

interface TvdbRemoteHit {
  series?: { id?: number; name?: string; slug?: string; image?: string; year?: string; firstAired?: string };
  movie?: { id?: number; name?: string; slug?: string; image?: string; year?: string; runtime?: number };
}

interface TvdbSeriesExtended {
  id?: number;
  name?: string;
  slug?: string;
  image?: string;
  firstAired?: string;
  year?: string;
  averageRuntime?: number;
  overview?: string;
  originalCountry?: string;
  genres?: { name?: string }[];
  translations?: {
    nameTranslations?: { name?: string; language?: string; isAlias?: boolean }[];
    overviewTranslations?: { overview?: string; language?: string }[];
  };
}

interface TvdbEpisode {
  id?: number;
  seasonNumber?: number;
  number?: number;
  absoluteNumber?: number;
  name?: string;
  aired?: string;
  image?: string;
  overview?: string;
}

const humanizeSlug = (slug?: string) =>
  slug
    ? slug
        .split("-")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
        .join(" ")
    : "";

export async function fetchTvdbAnimeMeta(
  id: string,
  tvdbKey: string,
  f: typeof fetch = fetch,
): Promise<Title | null> {
  if (!tvdbKey) return null;
  let imdbId = id.startsWith("tt") ? id : "";
  if (!imdbId && id.startsWith("kitsu:")) {
    try {
      const r = await f(`${KITSU}/meta/series/${id}.json`);
      if (r.ok) {
        const { meta } = (await r.json()) as { meta?: RawMeta };
        if (meta?.imdb_id?.startsWith("tt")) imdbId = meta.imdb_id;
      }
    } catch {
      // Fall through to Kitsu fallback in fetchMeta.
    }
  }
  if (!imdbId) return null;

  const token = await getTvdbToken(tvdbKey, f);
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` };

  const searchRes = await f(`${TVDB}/search/remoteid/${encodeURIComponent(imdbId)}`, { headers });
  if (!searchRes.ok) return null;
  const searchBody = (await searchRes.json()) as { data?: TvdbRemoteHit[] };
  const seriesHit = searchBody.data?.find((d) => d.series?.id)?.series;
  const movieHit = !seriesHit ? searchBody.data?.find((d) => d.movie?.id)?.movie : undefined;

  if (movieHit?.id) {
    // Anime feature film in the catalog: enrich via TMDB if available, or build a single playable entry.
    const tmdbMovie = configuredTmdbKey ? await fetchTmdbMeta("movie", imdbId, configuredTmdbKey, f) : null;
    const name = tmdbMovie?.name ?? (humanizeSlug(movieHit.slug) || movieHit.name || imdbId);
    const year = tmdbMovie?.year ?? (movieHit.year ?? "").slice(0, 4);
    return {
      id: imdbId,
      name,
      year,
      rating: tmdbMovie?.rating ?? "",
      description: tmdbMovie?.description,
      genre: tmdbMovie?.genre,
      runtime: tmdbMovie?.runtime ?? (movieHit.runtime ? `${movieHit.runtime} min` : undefined),
      poster: tmdbMovie?.poster ?? movieHit.image,
      background: tmdbMovie?.background ?? `https://images.metahub.space/background/medium/${imdbId}/img`,
      videos: [
        {
          id: imdbId,
          season: 1,
          episode: 1,
          name,
          released: year ? `${year}-01-01` : undefined,
          thumbnail: tmdbMovie?.background,
          overview: tmdbMovie?.description,
        },
      ],
    };
  }

  if (!seriesHit?.id) return null;
  const tvdbId = seriesHit.id;

  const [extRes, epsRes] = await Promise.all([
    f(`${TVDB}/series/${tvdbId}/extended?meta=translations&short=true`, { headers }),
    f(`${TVDB}/series/${tvdbId}/episodes/official/eng?page=0`, { headers }),
  ]);
  if (!extRes.ok || !epsRes.ok) return null;

  const { data: ext } = (await extRes.json()) as { data?: TvdbSeriesExtended };
  const { data: epsData } = (await epsRes.json()) as { data?: { episodes?: TvdbEpisode[] } };
  if (!ext || !epsData?.episodes?.length) return null;

  const nameTr = ext.translations?.nameTranslations ?? [];
  const engName =
    nameTr.find((t) => t.language === "eng" && !t.isAlias)?.name ??
    nameTr.find((t) => t.language === "eng")?.name ??
    (humanizeSlug(ext.slug) || ext.name || "");
  const engOverview =
    ext.translations?.overviewTranslations?.find((t) => t.language === "eng")?.overview ?? ext.overview;

  const videos: Video[] = [];
  for (const ep of epsData.episodes) {
    if (ep.seasonNumber == null || ep.number == null) continue;
    videos.push({
      id: `${imdbId}:${ep.seasonNumber}:${ep.number}`,
      season: ep.seasonNumber,
      episode: ep.number,
      name: ep.name || `Episode ${ep.number}`,
      released: ep.aired || undefined,
      thumbnail: ep.image
        ? ep.image.startsWith("http")
          ? ep.image
          : `https://artworks.thetvdb.com${ep.image}`
        : undefined,
      overview: ep.overview || undefined,
      imdbSeason: ep.seasonNumber,
      imdbEpisode: ep.number,
      absoluteEpisode: ep.absoluteNumber || undefined,
    });
  }
  if (!videos.length) return null;

  return {
    id: imdbId,
    name: engName,
    year: (ext.firstAired ?? ext.year ?? "").slice(0, 4),
    rating: "",
    description: engOverview,
    genre: ext.genres?.map((g) => g.name).filter((n): n is string => Boolean(n)),
    runtime: ext.averageRuntime ? `${ext.averageRuntime} min` : undefined,
    poster: ext.image || undefined,
    background: `https://images.metahub.space/background/medium/${imdbId}/img`,
    ...(ext.originalCountry === "jpn" ? { japanese: true } : {}),
    videos,
  };
}

interface TmdbFindResponse {
  movie_results?: { id?: number; title?: string; release_date?: string }[];
  tv_results?: { id?: number; name?: string; first_air_date?: string }[];
}

interface TmdbMovieDetail {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  vote_average?: number;
  overview?: string;
  runtime?: number;
  poster_path?: string;
  backdrop_path?: string;
  genres?: { name?: string }[];
  belongs_to_collection?: { id?: number; name?: string } | null;
  original_language?: string;
  /** With `append_to_response=credits`. */
  credits?: { cast?: { name?: string }[]; crew?: { name?: string; job?: string }[] };
}

interface TmdbEpisode {
  season_number?: number;
  episode_number?: number;
  name?: string;
  air_date?: string;
  still_path?: string;
  overview?: string;
}

interface TmdbTvDetail {
  id?: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  vote_average?: number;
  overview?: string;
  episode_run_time?: number[];
  poster_path?: string;
  backdrop_path?: string;
  genres?: { name?: string }[];
  seasons?: { season_number?: number }[];
  original_language?: string;
  origin_country?: string[];
  [seasonKey: `season/${number}`]: { episodes?: TmdbEpisode[] } | undefined;
}

export async function fetchTmdbMeta(
  type: "movie" | "series",
  id: string,
  tmdbKey: string,
  f: typeof fetch = fetch,
): Promise<Title | null> {
  if (!tmdbKey || !id.startsWith("tt")) return null;
  const findRes = await f(
    `${TMDB}/find/${encodeURIComponent(id)}?api_key=${encodeURIComponent(tmdbKey)}&external_source=imdb_id`,
  );
  if (!findRes.ok) return null;
  const findData = (await findRes.json()) as TmdbFindResponse;

  if (type === "movie") {
    const hit = findData.movie_results?.[0];
    if (!hit?.id) return null;
    const res = await f(`${TMDB}/movie/${hit.id}?api_key=${encodeURIComponent(tmdbKey)}&append_to_response=credits`);
    if (!res.ok) return null;
    const m = (await res.json()) as TmdbMovieDetail;
    const name = m.title || m.original_title || hit.title;
    if (!name) return null;
    return {
      id,
      name,
      year: (m.release_date ?? hit.release_date ?? "").slice(0, 4),
      rating: m.vote_average ? m.vote_average.toFixed(1) : "",
      description: m.overview || undefined,
      genre: m.genres?.map((g) => g.name).filter((n): n is string => Boolean(n)),
      runtime: m.runtime ? `${m.runtime} min` : undefined,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : undefined,
      background: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : undefined,
      cast: names(m.credits?.cast?.slice(0, 12).map((c) => c.name)),
      director: names(m.credits?.crew?.filter((c) => c.job === "Director").map((c) => c.name)),
      writer: names(m.credits?.crew?.filter((c) => c.job === "Screenplay" || c.job === "Writer").map((c) => c.name)),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(m.release_date ?? "") ? { released: m.release_date } : {}),
      ...(m.original_language === "ja" ? { japanese: true } : {}),
      tmdbCollection:
        m.belongs_to_collection?.id && m.belongs_to_collection?.name
          ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name }
          : undefined,
    };
  }

  const hit = findData.tv_results?.[0];
  if (!hit?.id) return null;
  const baseRes = await f(`${TMDB}/tv/${hit.id}?api_key=${encodeURIComponent(tmdbKey)}`);
  if (!baseRes.ok) return null;
  const tv = (await baseRes.json()) as TmdbTvDetail;
  const name = tv.name || tv.original_name || hit.name;
  if (!name) return null;

  const seasonNums = (tv.seasons ?? [])
    .map((s) => s.season_number)
    .filter((n): n is number => typeof n === "number" && n >= 0);

  const videos: Video[] = [];
  for (let i = 0; i < seasonNums.length; i += 20) {
    const batch = seasonNums.slice(i, i + 20);
    const append = batch.map((n) => `season/${n}`).join(",");
    const sRes = await f(
      `${TMDB}/tv/${hit.id}?api_key=${encodeURIComponent(tmdbKey)}&append_to_response=${encodeURIComponent(append)}`,
    );
    if (!sRes.ok) continue;
    const sData = (await sRes.json()) as TmdbTvDetail;
    for (const n of batch) {
      const eps = sData[`season/${n}`]?.episodes ?? [];
      for (const ep of eps) {
        if (ep.season_number == null || ep.episode_number == null) continue;
        videos.push({
          id: `${id}:${ep.season_number}:${ep.episode_number}`,
          season: ep.season_number,
          episode: ep.episode_number,
          name: ep.name || `Episode ${ep.episode_number}`,
          released: ep.air_date || undefined,
          thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : undefined,
          overview: ep.overview || undefined,
        });
      }
    }
  }
  if (!videos.length) return null;

  return {
    id,
    name,
    year: (tv.first_air_date ?? hit.first_air_date ?? "").slice(0, 4),
    rating: tv.vote_average ? tv.vote_average.toFixed(1) : "",
    description: tv.overview || undefined,
    genre: tv.genres?.map((g) => g.name).filter((n): n is string => Boolean(n)),
    runtime: tv.episode_run_time?.[0] ? `${tv.episode_run_time[0]} min` : undefined,
    poster: tv.poster_path ? `https://image.tmdb.org/t/p/w342${tv.poster_path}` : undefined,
    background: tv.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}` : undefined,
    ...(tv.original_language === "ja" || tv.origin_country?.includes("JP") ? { japanese: true } : {}),
    videos,
  };
}

async function fetchCinemetaMeta(type: CatalogType, id: string, f: typeof fetch): Promise<Title | null> {
  const isKitsu = id.startsWith("kitsu:");
  const url = isKitsu ? `${KITSU}/meta/series/${id}.json` : `${META}/meta/${type === "anime" ? "series" : type}/${id}.json`;
  const res = await f(url);
  if (!res.ok) return null;
  const { meta } = (await res.json()) as { meta?: RawMeta };
  return meta ? toTitle({ ...meta, id: meta.id ?? id, imdb_id: isKitsu ? undefined : (meta.imdb_id ?? id) }) : null;
}

async function fetchMetaFirst(type: CatalogType, id: string, f: typeof fetch): Promise<Title | null> {
  const fromAddon = await addonMeta?.(type, id).catch(() => null);
  const title = fromAddon ? toTitle({ ...fromAddon, id: fromAddon.id ?? id }) : null;
  if (title) return title;
  if (type === "anime") {
    try {
      const tvdb = await fetchTvdbAnimeMeta(id, configuredTvdbKey, f);
      if (tvdb) return tvdb;
    } catch {
      // Fall back to TMDB / Cinemeta / Kitsu below.
    }
    if (id.startsWith("tt") && configuredTmdbKey) {
      try {
        const tmdb = await fetchTmdbMeta("series", id, configuredTmdbKey, f);
        if (tmdb) return tmdb;
      } catch {
        // Fall back to Cinemeta below.
      }
    }
    return fetchCinemetaMeta(type, id, f);
  }

  if (configuredTmdbKey) {
    try {
      const tmdb = await fetchTmdbMeta(type, id, configuredTmdbKey, f);
      if (tmdb) return tmdb;
    } catch {
      // Fall back to Cinemeta below.
    }
  }
  return fetchCinemetaMeta(type, id, f);
}

/**
 * Direct client-side unified search across Movies, Series (Cinemeta), and Anime (Kitsu),
 * used as an instant fallback when the LAN server is unreachable or on a different subnet.
 */
export async function searchCatalogsClient(
  query: string,
  f: typeof fetch = fetch,
): Promise<{ type: CatalogType; title: Title }[]> {
  const q = query.trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const endpoints: { type: CatalogType; url: string }[] = [
    { type: "movie", url: `${META}/catalog/movie/top/search=${enc}.json` },
    { type: "series", url: `${META}/catalog/series/top/search=${enc}.json` },
    { type: "anime", url: `${KITSU}/catalog/anime/kitsu-anime-list/search=${enc}.json` },
  ];

  const settled = await Promise.allSettled(
    endpoints.map(async ({ type, url }) => {
      const titles = await fetchRow(url, f);
      return titles.slice(0, 12).map((title) => ({ type, title }));
    }),
  );

  const raw: { type: CatalogType; title: Title }[] = [];
  for (const res of settled) {
    if (res.status === "fulfilled") raw.push(...res.value);
  }

  const lower = q.toLowerCase();
  const seen = new Set<string>();
  return raw
    .filter((hit) => {
      const key = `${hit.type}:${hit.title.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aName = a.title.name.toLowerCase();
      const bName = b.title.name.toLowerCase();
      const aScore = aName === lower ? 3 : aName.startsWith(lower) ? 2 : aName.includes(lower) ? 1 : 0;
      const bScore = bName === lower ? 3 : bName.startsWith(lower) ? 2 : bName.includes(lower) ? 1 : 0;
      return bScore - aScore;
    })
    .slice(0, 24);
}

const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Layers `over` onto `base`, skipping fields `over` leaves empty so a known synopsis, year or genre is never erased.
 * The name is the one exception: a title keeps the name it was opened with (its card's), so a card and its page never
 * show two names for one title when the page's metadata comes from another provider.
 */
export function mergeMeta<T extends object>(base: T, over: Partial<T> | null | undefined): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over ?? {})) if (!empty(v) && !(k === "name" && !empty(out.name))) out[k] = v;
  return out as T;
}

const metaCache = new Map<string, Title>();
const META_TIMEOUT_MS = 12000;

const withTimeout = <T>(p: Promise<T>): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), META_TIMEOUT_MS))]);

/** Metadata for a title. The first provider wins, but any missing synopsis, runtime or genre is filled from Cinemeta. */
export async function fetchMeta(type: CatalogType, id: string, f: typeof fetch = fetch): Promise<Title | null> {
  const key = `${type}:${id}`;
  const hit = f === fetch ? metaCache.get(key) : undefined;
  if (hit) return hit;
  let title = await withTimeout(fetchMetaFirst(type, id, f));
  if (title && (empty(title.description) || empty(title.runtime) || empty(title.genre) || (type === "movie" && empty(title.cast)))) {
    const extra = await withTimeout(fetchCinemetaMeta(type, id, f).catch(() => null));
    if (extra) {
      title = {
        ...title,
        description: empty(title.description) ? extra.description : title.description,
        runtime: empty(title.runtime) ? extra.runtime : title.runtime,
        genre: empty(title.genre) ? extra.genre : title.genre,
        year: empty(title.year) ? extra.year : title.year,
        cast: empty(title.cast) ? extra.cast : title.cast,
        director: empty(title.director) ? extra.director : title.director,
      };
    }
  }
  // Every provider's answer in one format: the rating, and the synopsis without a box-office lead-in.
  if (title) title = { ...title, rating: ratingOf(title.rating), description: cleanSynopsis(title.description) };
  if (title && f === fetch) metaCache.set(key, title);
  return title;
}

/** The catalog that lists a genre, for "More like this" on a film's page (series and anime have their episodes there). */
export const similarUrl = (type: CatalogType, genre: string): string =>
  type === "anime"
    ? `${KITSU}/catalog/anime/kitsu-anime-popular/genre=${encodeURIComponent(genre)}.json`
    : `${META}/catalog/${type}/top/genre=${encodeURIComponent(genre)}.json`;

/** Up to `max` titles of the list that are not the page's own, those with a poster first. */
export function pickSimilar(list: readonly Title[], excludeId: string, max = 12): Title[] {
  const rest = list.filter((t) => t.id !== excludeId);
  return [...rest.filter((t) => t.poster), ...rest.filter((t) => !t.poster)].slice(0, max);
}
