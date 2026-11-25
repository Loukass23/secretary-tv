// One artwork lookup per title (titleArt): Fanart.tv first, then the metadata's own logo, then the art the catalog
// gave (cinemeta.ts posterUrl / backgroundUrl). Each image is asked for at the size it is shown (ArtSize).
import { readJson, whenIdle, writeJson } from "@secretary/tv-kit";
import { backgroundUrl, posterUrl } from "./cinemeta.ts";
import type { CatalogType, Title } from "./types.ts";

declare const __FANART_API_KEY__: string | undefined;

const FANART = "https://webservice.fanart.tv/v3";
const META = "https://v3-cinemeta.strem.io";
const KITSU = "https://anime-kitsu.strem.fun";

let fanartKey = typeof __FANART_API_KEY__ !== "undefined" ? __FANART_API_KEY__ : "";

export function setFanartKeys(keys: { fanartApiKey?: string }): void {
  if (keys.fanartApiKey !== undefined) fanartKey = keys.fanartApiKey;
}

/**
 * Where an image is shown. `card`: a poster or landscape tile in a row (home cards, Continue watching tiles), logos
 * and clear art from Fanart.tv's small preview, film backdrops from TMDB at 780 px. `hero`: a full-screen backdrop
 * and its logo (title page, catalog home hero), at full size (Fanart.tv backgrounds are 1920 x 1080).
 */
export type ArtSize = "card" | "hero";

/** A title's artwork, every field a URL to show at the size asked for. */
export interface TitleArt {
  /** Stylized title logo (transparent PNG), else the metadata's logo; none when neither has one: show the name. */
  logo?: string;
  /** Clear art (a character cut-out, transparent PNG), Fanart.tv only. */
  clearArt?: string;
  /** Landscape 16:9 still for a tile: Fanart.tv's thumb, else the backdrop. */
  thumb: string;
  /** Full-page backdrop. */
  background: string;
  /** Portrait poster, as the catalog gives it (Fanart.tv posters are no better and much larger). */
  poster: string;
}

/** What Fanart.tv had for a title, full-size URLs. Empty when it had nothing (or no key): cached too. */
interface Found {
  logo?: string;
  clearArt?: string;
  thumb?: string;
  background?: string;
}

interface FanartEntry {
  url?: string;
  lang?: string;
  likes?: string;
}
type FanartResponse = Record<string, FanartEntry[] | undefined>;

/** The best image of a list: English or language-free first, then the most liked. */
function best(...lists: (FanartEntry[] | undefined)[]): string | undefined {
  for (const list of lists) {
    const ok = (list ?? []).filter((e) => e?.url?.startsWith("http"));
    const plain = (e: FanartEntry) => (!e.lang || e.lang === "en" || e.lang === "00" ? 1 : 0);
    ok.sort((a, b) => plain(b) - plain(a) || Number(b.likes ?? 0) - Number(a.likes ?? 0));
    if (ok[0]) return ok[0].url;
  }
  return undefined;
}

const getJson = async <T>(f: typeof fetch, url: string): Promise<T | null> => {
  const res = await f(url);
  return res.ok ? ((await res.json()) as T) : null;
};

/** Fanart.tv files shows by TVDB id: the series meta has it (Kitsu's for kitsu ids, Cinemeta's for IMDb ids). */
async function tvdbIdOf(id: string, f: typeof fetch): Promise<string | null> {
  const meta = (url: string) => getJson<{ meta?: { tvdb_id?: number | string; imdb_id?: string } }>(f, url).then((b) => b?.meta);
  let imdb = id;
  if (id.startsWith("kitsu:")) {
    const m = await meta(`${KITSU}/meta/series/${id}.json`);
    if (m?.tvdb_id) return String(m.tvdb_id);
    imdb = m?.imdb_id ?? "";
  }
  if (!imdb.startsWith("tt")) return null;
  const m = await meta(`${META}/meta/series/${encodeURIComponent(imdb)}.json`);
  return m?.tvdb_id ? String(m.tvdb_id) : null;
}

async function lookup(type: CatalogType, id: string, f: typeof fetch): Promise<Found> {
  if (!fanartKey) return {};
  const ask = (path: string) => getJson<FanartResponse>(f, `${FANART}/${path}?api_key=${encodeURIComponent(fanartKey)}`);
  const movie = async (): Promise<Found> => {
    const d = id.startsWith("tt") ? await ask(`movies/${encodeURIComponent(id)}`) : null;
    return d
      ? {
          logo: best(d.hdmovielogo, d.movielogo),
          clearArt: best(d.hdmovieclearart, d.movieart),
          thumb: best(d.moviethumb),
          background: best(d.moviebackground),
        }
      : {};
  };
  try {
    if (type === "movie") return await movie();
    const tvdb = await tvdbIdOf(id, f);
    const d = tvdb ? await ask(`tv/${encodeURIComponent(tvdb)}`) : null;
    const show: Found = d
      ? { logo: best(d.hdtvlogo, d.clearlogo), clearArt: best(d.hdclearart, d.clearart), thumb: best(d.tvthumb), background: best(d.showbackground) }
      : {};
    // An anime film is listed as anime but filed by Fanart.tv as a movie.
    return show.logo || show.background ? show : await movie();
  } catch {
    // Fanart.tv drops or times out now and then: the catalog's own art stands in.
    return {};
  }
}

/**
 * The cache, on the TV: at most ART_MAX titles (least recently used out first), kept in localStorage so a restart does
 * not look them up again. An entry is a few URLs (about 350 bytes), so the whole cache stays near 100 KB in the heap and
 * in storage. What Fanart.tv had is kept 14 days, an empty answer 1 day (art gets added).
 */
export const ART_MAX = 300;
const ART_KEY = "sectv.art.v1";
const HIT_MS = 14 * 864e5;
const MISS_MS = 864e5;

type Stored = [key: string, found: Found, at: number];
let cache: Map<string, { found: Found; at: number }> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function store(): Map<string, { found: Found; at: number }> {
  if (!cache) {
    cache = new Map();
    const saved = readJson<Stored[]>(ART_KEY);
    if (Array.isArray(saved)) for (const [k, found, at] of saved.slice(-ART_MAX)) if (typeof k === "string" && found) cache.set(k, { found, at });
  }
  return cache;
}

function remember(key: string, found: Found, now: number): void {
  const c = store();
  c.delete(key);
  c.set(key, { found, at: now });
  while (c.size > ART_MAX) c.delete(c.keys().next().value as string);
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    // Written when the screen is idle, not while focus moves (tv-kit storage.ts).
    whenIdle(() => writeJson(ART_KEY, [...store()].map(([k, v]): Stored => [k, v.found, v.at])));
  }, 1000);
}

function fresh(key: string, now: number): Found | undefined {
  const c = store();
  const hit = c.get(key);
  if (!hit) return undefined;
  const empty = !hit.found.logo && !hit.found.background && !hit.found.thumb;
  if (now - hit.at > (empty ? MISS_MS : HIT_MS)) return undefined;
  // Used again: it moves to the back of the line.
  c.delete(key);
  c.set(key, hit);
  return hit.found;
}

/** For the tests: forget the cache, in memory and stored. */
export function clearArtCache(): void {
  cache = new Map();
  writeJson(ART_KEY, []);
}

const keyOf = (type: CatalogType, id: string) => `${type === "movie" ? "movie" : "tv"}:${id}`;

/** A Fanart.tv image at the size asked for: `card` takes its preview (a few hundred pixels wide). */
const fanartAt = (url: string | undefined, size: ArtSize) =>
  url && size === "card" ? url.replace("assets.fanart.tv/fanart/", "assets.fanart.tv/preview/") : url;

/** A TMDB image at the size asked for (a 200 px card never needs the 1280 px backdrop). */
const tmdbAt = (url: string, size: ArtSize) =>
  url.replace(/(image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(?=\/)/, `$1${size === "card" ? "w780" : "w1280"}`);

export type ArtTitle = Pick<Title, "id" | "poster" | "background" | "logo">;

function sized(t: ArtTitle, found: Found, size: ArtSize): TitleArt {
  const backdrop = tmdbAt(backgroundUrl(t), size);
  return {
    logo: fanartAt(found.logo, size) ?? t.logo,
    clearArt: fanartAt(found.clearArt, size),
    // Fanart.tv thumbs are 1000 x 562: right for a card; backgrounds are 1920 x 1080: right for a hero only.
    thumb: found.thumb ?? (size === "hero" ? found.background : undefined) ?? backdrop,
    background: (size === "hero" ? found.background : undefined) ?? found.thumb ?? backdrop,
    poster: posterUrl(t),
  };
}

/**
 * The art there is for a title right now, without waiting: what the cache holds, else the catalog's own art. For the
 * first render; `titleArt` then brings the rest.
 */
export const cachedTitleArt = (type: CatalogType, t: ArtTitle, size: ArtSize, now = Date.now()): TitleArt =>
  sized(t, fresh(keyOf(type, t.id), now) ?? {}, size);

/** At most this many Fanart.tv lookups at once, so a home of fifty cards does not open fifty requests. */
const PARALLEL = 3;
let busy = 0;
const waiting: (() => void)[] = [];
const pending = new Map<string, Promise<Found>>();

async function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  if (busy >= PARALLEL) await new Promise<void>((go) => waiting.push(go));
  busy++;
  try {
    return await job();
  } finally {
    busy--;
    waiting.shift()?.();
  }
}

/**
 * A title's artwork (logo, clear art, landscape thumb, background, poster) at `size`. Fanart.tv first, then the
 * metadata's logo field (`Title.logo`), then the catalog's art, so every field but the logo and clear art always has a
 * URL. Looked up once per title and cached (ART_MAX); never rejects.
 */
export async function titleArt(type: CatalogType, t: ArtTitle, size: ArtSize, f: typeof fetch = fetch, now = Date.now()): Promise<TitleArt> {
  const key = keyOf(type, t.id);
  let found = fresh(key, now);
  if (!found) {
    let p = pending.get(key);
    if (!p) {
      p = oneAtATime(() => lookup(type, t.id, f));
      pending.set(key, p);
    }
    found = await p;
    pending.delete(key);
    remember(key, found, now);
  }
  return sized(t, found, size);
}
