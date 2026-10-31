// Collections from the Nuvio profile (docs/nuvio-cloud.md, phase 8): each one is a home row of folder cards, and a
// folder opens a page of its catalogs. Kept apart from the app's own curated sagas (lib/collections.ts). The last
// pull is cached per account and profile; editing stays on nuvio.tv.
import type { AddonSource, CollectionFolder, CollectionSource, NuvioCollection, TileShape, TmdbSource } from "@secretary/nuvio";
import { readJson, writeJson } from "@secretary/tv-kit";
import { type AddonCatalog, type AddonState, catalogPath, resourceUrl } from "./addons.ts";
import { toTitle, type RawMeta } from "./cinemeta.ts";
import type { CatalogType, HomeRow, Title } from "./types.ts";

export interface CollectionsRemote {
  /** "user:profile" of the signed-in profile, or null. */
  owner(): string | null;
  /** The profile's collections, or null when they cannot be read. */
  pull(): Promise<NuvioCollection[] | null>;
}

interface Cached {
  owner: string;
  collections: NuvioCollection[];
}

const CACHE = "sectv.nuvio.collections";
let remote: CollectionsRemote | null = null;

export function setCollectionsRemote(r: CollectionsRemote | null): void {
  remote = r;
}

/** The cached collections of the signed-in profile; another profile's copy is not shown. */
export function loadNuvioCollections(): NuvioCollection[] {
  const c = readJson<Cached>(CACHE);
  const owner = remote?.owner();
  return c && owner && c.owner === owner && Array.isArray(c.collections) ? c.collections : [];
}

/** Pulls the profile's collections; a failed pull keeps the cached copy. */
export async function syncNuvioCollections(): Promise<NuvioCollection[]> {
  const owner = remote?.owner();
  if (!remote || !owner) return [];
  const got = await remote.pull();
  if (got) writeJson(CACHE, { owner, collections: got } satisfies Cached);
  return loadNuvioCollections();
}

export function clearLocalNuvioCollections(): void {
  writeJson(CACHE, null);
}

// --- Kinds -------------------------------------------------------------------------------------------------------

/** The app kinds a source can fill. Nuvio itself knows movie and series; anime comes from addons' "anime" catalogs. */
export function sourceKinds(s: CollectionSource): CatalogType[] {
  if (s.provider === "addon") {
    const t = s.type.toLowerCase();
    return t === "movie" ? ["movie"] : t === "series" || t === "tv" ? ["series"] : t === "anime" ? ["anime"] : [];
  }
  if (s.mediaType === "MOVIE") return ["movie"];
  if (s.mediaType === "TV") return ["series"];
  // A Trakt list of both.
  return ["movie", "series"];
}

const fits = (kind: CatalogType) => (s: CollectionSource) => sourceKinds(s).includes(kind);

/**
 * The collections as this app shows them: each folder keeps only the sources of its kind that `usable` accepts
 * (installed addons, TMDB with a key), a folder with none is hidden, and so is a collection with no folder left.
 */
export function collectionsFor(
  list: readonly NuvioCollection[],
  kind: CatalogType,
  usable: (s: CollectionSource) => boolean = () => true,
): NuvioCollection[] {
  return list.flatMap((c) => {
    const folders = c.folders.flatMap((f): CollectionFolder[] => {
      const catalogSources = f.catalogSources.filter((s) => fits(kind)(s) && usable(s));
      return catalogSources.length ? [{ ...f, catalogSources }] : [];
    });
    return folders.length ? [{ ...c, folders }] : [];
  });
}

// --- Home rows ---------------------------------------------------------------------------------------------------

/** A row has one card size, so it takes its folders' most common shape (a tie goes to the first folder's). */
export function rowShape(folders: readonly Pick<CollectionFolder, "tileShape">[]): TileShape {
  const counts = new Map<TileShape, number>();
  for (const f of folders) counts.set(f.tileShape, (counts.get(f.tileShape) ?? 0) + 1);
  let best: TileShape = folders[0]?.tileShape ?? "LANDSCAPE";
  for (const f of folders) if ((counts.get(f.tileShape) ?? 0) > (counts.get(best) ?? 0)) best = f.tileShape;
  return best;
}

/** The art behind a focused folder, in the web app's order: its hero, the collection's backdrop, its cover. */
export const folderBackdrop = (c: Pick<NuvioCollection, "backdropImageUrl">, f: Pick<CollectionFolder, "heroBackdropUrl" | "coverImageUrl">) =>
  f.heroBackdropUrl ?? c.backdropImageUrl ?? f.coverImageUrl;

export const collectionRowId = (c: Pick<NuvioCollection, "id">) => `nuvio-col:${c.id}`;

/** One home row per collection, the pinned ones first. */
export function collectionRows(list: readonly NuvioCollection[]): HomeRow[] {
  const ordered = [...list.filter((c) => c.pinToTop), ...list.filter((c) => !c.pinToTop)];
  return ordered.map((c) => ({
    id: collectionRowId(c),
    title: c.title,
    rowKind: "folders",
    tileShape: rowShape(c.folders),
    originLabel: "Nuvio · collection",
    items: c.folders.map((f) => ({
      id: `nuvio-folder:${c.id}/${f.id}`,
      name: f.title,
      year: "",
      rating: "",
      ...(f.coverImageUrl ? { poster: f.coverImageUrl } : {}),
      ...(folderBackdrop(c, f) ? { background: folderBackdrop(c, f) } : {}),
      // In the info panel, not on the card: covers are artwork, and a badge sits on top of it.
      description: `${f.catalogSources.length} ${f.catalogSources.length === 1 ? "catalog" : "catalogs"}`,
      folder: { collectionId: c.id, folderId: f.id, emoji: f.coverEmoji, hideTitle: f.hideTitle },
    })),
  }));
}

export function findFolder(list: readonly NuvioCollection[], collectionId: string, folderId: string) {
  const collection = list.find((c) => c.id === collectionId);
  const folder = collection?.folders.find((f) => f.id === folderId);
  return collection && folder ? { collection, folder } : null;
}

// --- Sources -----------------------------------------------------------------------------------------------------

export interface SourceKeys {
  tmdb?: string;
  trakt?: string;
}

/** A source this TV can read: its tab name, the kind its titles open as, and how to ask for a page. */
export interface ResolvedSource {
  key: string;
  title: string;
  kind: CatalogType;
  source: CollectionSource;
  /** Addon sources: the addon and catalog the requests go to. */
  addon?: AddonState;
  catalog?: AddonCatalog;
}

const baseOf = (url: string) => url.split("?")[0].replace(/\/manifest\.json$/i, "").replace(/\/+$/, "").toLowerCase();

/** The installed, enabled addon a source names: by manifest id, else by its base URL. */
export function addonFor(s: AddonSource, active: readonly AddonState[]): AddonState | undefined {
  return (
    (s.addonId ? active.find((a) => a.manifest?.id === s.addonId) : undefined) ??
    (s.addonBaseUrl ? active.find((a) => baseOf(a.url) === baseOf(s.addonBaseUrl!)) : undefined)
  );
}

/** A catalog's id as an editor would show it ("streaming_netflix_movies") is no name for a tab. */
const idLike = (s: string) => /_/.test(s) && !/\s/.test(s);

const TMDB_NAMES: Record<TmdbSource["tmdbSourceType"], string> = {
  LIST: "TMDB list",
  COLLECTION: "Collection",
  PERSON: "Filmography",
  DIRECTOR: "Director",
  COMPANY: "Studio",
  NETWORK: "Network",
  DISCOVER: "Discover",
};

/** The source as this app can read it, or null (addon not installed, no key for TMDB or Trakt, another kind). */
export function resolveSource(s: CollectionSource, kind: CatalogType, active: readonly AddonState[], keys: SourceKeys): ResolvedSource | null {
  if (!fits(kind)(s)) return null;
  if (s.provider === "addon") {
    const addon = addonFor(s, active);
    if (!addon?.manifest) return null;
    const catalog = addon.manifest.catalogs.find((c) => c.type === s.type && c.id === s.catalogId);
    const named = [s.title, catalog?.name].find((n) => n && n !== s.catalogId && !idLike(n));
    return {
      key: `addon:${addon.manifest.id}:${s.type}:${s.catalogId}:${s.genre ?? ""}`,
      title: named ?? (s.genre || addon.name),
      kind,
      source: s,
      addon,
      ...(catalog ? { catalog } : {}),
    };
  }
  if (s.provider === "tmdb") {
    if (!keys.tmdb) return null;
    // Discover sources often differ only in their filters (one per genre), so the filters are part of the key.
    const key = `tmdb:${s.tmdbSourceType}:${s.mediaType}:${s.tmdbId}:${s.sortBy ?? ""}:${JSON.stringify(s.filters ?? {})}`;
    return { key, title: s.title ?? TMDB_NAMES[s.tmdbSourceType], kind, source: s };
  }
  if (!keys.trakt) return null;
  return { key: `trakt:${s.traktListId}:${s.mediaType}:${s.sortBy ?? ""}:${s.sortHow ?? ""}`, title: s.title ?? "Trakt list", kind, source: s };
}

/** Whether a source can be read here, for collectionsFor. */
export const sourceUsable = (kind: CatalogType, active: readonly AddonState[], keys: SourceKeys) => (s: CollectionSource) =>
  resolveSource(s, kind, active, keys) !== null;

// --- Requests ----------------------------------------------------------------------------------------------------

const TMDB = "https://api.themoviedb.org/3";
const TRAKT = "https://api.trakt.tv";
export const TRAKT_PAGE = 20;

export interface PageRequest {
  url: string;
  headers?: Record<string, string>;
}

const snake = (k: string) =>
  k
    .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    .replace(/_(gte|lte)$/, ".$1");

/** The editor's discover filters as TMDB query parameters. */
export function tmdbFilters(filters: Record<string, unknown> | undefined, tv: boolean): string {
  if (!filters) return "";
  const q: string[] = [];
  const add = (k: string, v: unknown) => q.push(`${k}=${encodeURIComponent(Array.isArray(v) ? v.join(",") : String(v))}`);
  let region = "";
  for (const [k, v] of Object.entries(filters)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v))) continue;
    if (k === "watchRegion") region = String(v);
    else if (k === "year") add(tv ? "first_air_date_year" : "primary_release_year", v);
    else if (k === "releaseDateGte") add(tv ? "first_air_date.gte" : "primary_release_date.gte", v);
    else if (k === "releaseDateLte") add(tv ? "first_air_date.lte" : "primary_release_date.lte", v);
    else if (k === "withWatchProviders") {
      add("with_watch_providers", v);
      q.push("with_watch_monetization_types=flatrate|free|ads|rent|buy");
    } else if (/^[a-z][a-zA-Z.]*$/.test(k)) add(k.includes(".") || k.includes("_") ? k : snake(k), v);
  }
  if (q.some((p) => p.includes("watch_providers="))) q.push(`watch_region=${encodeURIComponent(region || "US")}`);
  return q.length ? `&${q.join("&")}` : "";
}

/**
 * The request for one page of a source (`page` from 1; `have` titles already read, for addons' `skip`), or null
 * when the source has no such page: an addon catalog without `skip`, a TMDB collection or filmography, past page 1.
 */
export function pageRequest(r: ResolvedSource, page: number, have: number, keys: SourceKeys, today = new Date()): PageRequest | null {
  const s = r.source;
  if (s.provider === "addon") {
    const pages = r.catalog?.extra.some((e) => e.name === "skip") ?? false;
    if (page > 1 && !pages) return null;
    const genre = s.genre;
    return { url: resourceUrl(r.addon!.url, catalogPath(s.type, s.catalogId, { ...(genre ? { genre } : {}), ...(page > 1 ? { skip: have } : {}) })) };
  }
  if (s.provider === "tmdb") {
    const key = `api_key=${encodeURIComponent(keys.tmdb ?? "")}`;
    const tv = s.mediaType === "TV";
    if (s.tmdbSourceType === "COLLECTION") return page > 1 ? null : { url: `${TMDB}/collection/${s.tmdbId}?${key}` };
    if (s.tmdbSourceType === "PERSON" || s.tmdbSourceType === "DIRECTOR") {
      return page > 1 ? null : { url: `${TMDB}/person/${s.tmdbId}/${tv ? "tv" : "movie"}_credits?${key}` };
    }
    if (s.tmdbSourceType === "LIST") return { url: `${TMDB}/list/${s.tmdbId}?${key}&page=${page}` };
    let q = `&sort_by=${encodeURIComponent(s.sortBy ?? (tv ? "first_air_date.desc" : "popularity.desc"))}${tmdbFilters(s.filters, tv)}`;
    if (s.tmdbId > 0 && s.tmdbSourceType === "NETWORK") {
      // As the web app: only what has aired, without cancelled pilots.
      q += `&with_networks=${s.tmdbId}&first_air_date.lte=${today.toISOString().slice(0, 10)}&with_status=0|3|4`;
    } else if (s.tmdbId > 0) q += `&${tv ? "with_networks" : "with_companies"}=${s.tmdbId}`;
    return { url: `${TMDB}/discover/${tv ? "tv" : "movie"}?${key}&page=${page}${q}` };
  }
  const type = s.mediaType === "MOVIE" || (s.mediaType === "" && r.kind === "movie") ? "movies" : "shows";
  const sort = s.sortBy ? `/${encodeURIComponent(s.sortBy)}/${s.sortHow ?? "asc"}` : "";
  return {
    url: `${TRAKT}/lists/${s.traktListId}/items/${type}${sort}?page=${page}&limit=${TRAKT_PAGE}&extended=full`,
    headers: { "trakt-api-version": "2", "trakt-api-key": keys.trakt ?? "", "content-type": "application/json" },
  };
}

interface TmdbItem {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  job?: string;
}

interface TraktItem {
  movie?: { title?: string; year?: number; overview?: string; rating?: number; ids?: { imdb?: string } };
  show?: TraktItem["movie"];
}

/** A page's titles; `more` is false at the source's end. */
export interface SourcePage {
  items: Title[];
  more: boolean;
}

const IMDB_CACHE = "sectv.tmdb.imdb";
const IMDB_CACHE_MAX = 3000;

/** A TMDB title not yet matched to its IMDb id: "tmdb:movie:603". The match is made when it is opened. */
export const isTmdbId = (id: string) => id.startsWith("tmdb:");
const tmdbKey = (tv: boolean, id: number) => `${tv ? "tv" : "movie"}:${id}`;

function cachedImdb(): Record<string, string> {
  return readJson<Record<string, string>>(IMDB_CACHE) ?? {};
}

/**
 * The IMDb id of a "tmdb:" title (the id streams are found by), asked for once and remembered across runs; null when
 * TMDB has none. Other titles are returned as they are. Asked only when a title is opened: a page of 20 titles would
 * otherwise cost 20 more requests before it shows.
 */
export async function withImdbId(t: Title, keys: SourceKeys, f: typeof fetch = fetch): Promise<Title | null> {
  if (!isTmdbId(t.id)) return t;
  const [, kind, raw] = t.id.split(":");
  const cache = cachedImdb();
  let imdb: string | undefined = cache[`${kind}:${raw}`];
  if (!imdb) {
    const res = await f(`${TMDB}/${kind === "tv" ? "tv" : "movie"}/${raw}/external_ids?api_key=${encodeURIComponent(keys.tmdb ?? "")}`);
    if (!res.ok) throw new Error(`tmdb ${res.status}`);
    const { imdb_id } = (await res.json()) as { imdb_id?: string | null };
    if (!imdb_id?.startsWith("tt")) return null;
    imdb = imdb_id;
    cache[`${kind}:${raw}`] = imdb;
    const all = Object.keys(cache);
    writeJson(IMDB_CACHE, all.length > IMDB_CACHE_MAX ? Object.fromEntries(all.slice(-IMDB_CACHE_MAX).map((k) => [k, cache[k]])) : cache);
  }
  return { ...t, id: imdb };
}

const tmdbTitle = (it: TmdbItem, id: string): Title => ({
  id,
  name: it.title ?? it.name ?? "",
  year: (it.release_date ?? it.first_air_date ?? "").slice(0, 4),
  rating: it.vote_average ? it.vote_average.toFixed(1) : "",
  ...(it.overview ? { description: it.overview } : {}),
  ...(it.poster_path ? { poster: `https://image.tmdb.org/t/p/w342${it.poster_path}` } : {}),
  ...(it.backdrop_path ? { background: `https://image.tmdb.org/t/p/w1280${it.backdrop_path}` } : {}),
});

/** One page of a source's titles, each tagged with the kind it opens as. Throws when the request fails. */
export async function loadSourcePage(r: ResolvedSource, page: number, have: number, keys: SourceKeys, f: typeof fetch = fetch): Promise<SourcePage> {
  const req = pageRequest(r, page, have, keys);
  if (!req) return { items: [], more: false };
  const res = await f(req.url, req.headers ? { headers: req.headers } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const s = r.source;
  let items: Title[];
  let more: boolean;
  if (s.provider === "addon") {
    items = ((body.metas as RawMeta[] | undefined) ?? []).map((m) => toTitle({ ...m, videos: undefined })).filter((t): t is Title => t !== null);
    more = items.length > 0 && Boolean(pageRequest(r, page + 1, have + items.length, keys));
  } else if (s.provider === "tmdb") {
    const tv = s.mediaType === "TV";
    let raw = ((body.results ?? body.items ?? body.parts ?? (s.tmdbSourceType === "DIRECTOR" ? body.crew : body.cast)) as TmdbItem[] | undefined) ?? [];
    if (s.tmdbSourceType === "DIRECTOR") raw = raw.filter((it) => it.job === "Director");
    // A list mixes movies and shows; only this source's kind is kept.
    raw = raw.filter((it) => !it.media_type || it.media_type === (tv ? "tv" : "movie"));
    // Titles already matched keep their IMDb id; the others are matched when opened (withImdbId).
    const known = cachedImdb();
    items = raw.flatMap((it) => (it.id ? [tmdbTitle(it, known[tmdbKey(tv, it.id)] ?? `tmdb:${tmdbKey(tv, it.id)}`)] : []));
    const pages = typeof body.total_pages === "number" ? body.total_pages : page;
    more = raw.length > 0 && page < pages && Boolean(pageRequest(r, page + 1, 0, keys));
  } else {
    const list = Array.isArray(body) ? (body as TraktItem[]) : [];
    items = list.flatMap((it) => {
      const m = it.movie ?? it.show;
      const id = m?.ids?.imdb;
      return m?.title && id?.startsWith("tt")
        ? [{ id, name: m.title, year: m.year ? String(m.year) : "", rating: m.rating ? m.rating.toFixed(1) : "", ...(m.overview ? { description: m.overview } : {}) }]
        : [];
    });
    more = list.length >= TRAKT_PAGE;
  }
  return { items: items.map((t) => ({ ...t, catalogType: r.kind })), more };
}

// --- Folder page -------------------------------------------------------------------------------------------------

/** Several sources' titles as one list: taken in turn from each, every title once. */
export function interleave(lists: readonly (readonly Title[])[]): Title[] {
  const out: Title[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const l of lists) {
      const t = l[i];
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}
