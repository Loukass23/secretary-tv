import type { NuvioClient } from "./http.ts";

// The profile's collections (docs/nuvio-cloud.md, phase 8): folders of catalogs that the nuvio.tv editor builds, one
// JSON blob per profile. The TV reads them; editing stays on nuvio.tv. A push replaces the whole blob, so it always
// carries the complete list as it was pulled.

export type TileShape = "POSTER" | "LANDSCAPE" | "SQUARE";
export type ViewMode = "TABBED_GRID" | "ROWS" | "FOLLOW_LAYOUT";
export type TmdbSourceType = "LIST" | "COLLECTION" | "PERSON" | "DIRECTOR" | "COMPANY" | "NETWORK" | "DISCOVER";

/** One catalog of an installed Stremio addon, named by the manifest id. */
export interface AddonSource {
  provider: "addon";
  addonId: string;
  /** Some exports name the addon's base URL as well (or instead). */
  addonBaseUrl?: string;
  type: string;
  catalogId: string;
  title?: string;
  genre?: string;
}

/** A TMDB list, collection, person, company, network or discover query, as the web editor writes it. */
export interface TmdbSource {
  provider: "tmdb";
  tmdbSourceType: TmdbSourceType;
  /** 0 for a plain discover. */
  tmdbId: number;
  mediaType: "MOVIE" | "TV";
  sortBy?: string;
  filters?: Record<string, unknown>;
  title?: string;
}

/** A public Trakt list. */
export interface TraktSource {
  provider: "trakt";
  traktListId: number;
  mediaType: "MOVIE" | "TV" | "";
  sortBy?: string;
  sortHow?: "asc" | "desc";
  title?: string;
}

export type CollectionSource = AddonSource | TmdbSource | TraktSource;

export interface CollectionFolder {
  id: string;
  title: string;
  coverImageUrl?: string;
  coverEmoji?: string;
  tileShape: TileShape;
  hideTitle: boolean;
  heroBackdropUrl?: string;
  catalogSources: CollectionSource[];
}

export interface NuvioCollection {
  id: string;
  title: string;
  backdropImageUrl?: string;
  pinToTop: boolean;
  viewMode: ViewMode;
  showAllTab: boolean;
  folders: CollectionFolder[];
}

/**
 * Safety caps, far above a real account (the largest known has ~300 folders and ~600 sources; the owner's one
 * collection has 22 folders of up to 51 sources, 743 in all). A collection that would pass one is left out whole;
 * the ones after it still get their chance.
 */
export const COLLECTION_CAPS = { folders: 600, sources: 2000, sourcesPerFolder: 128 } as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/** The web editor's rule: POSTER, LANDSCAPE (or WIDE), and anything else, absent included, is SQUARE. */
export function tileShapeOf(v: unknown): TileShape {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  if (s === "POSTER") return "POSTER";
  if (s === "LANDSCAPE" || s === "WIDE") return "LANDSCAPE";
  return "SQUARE";
}

const VIEW_MODES: readonly ViewMode[] = ["TABBED_GRID", "ROWS", "FOLLOW_LAYOUT"];
const TMDB_TYPES: readonly TmdbSourceType[] = ["LIST", "COLLECTION", "PERSON", "DIRECTOR", "COMPANY", "NETWORK", "DISCOVER"];

function parseSource(raw: unknown): CollectionSource | null {
  const s = obj(raw);
  if (!s) return null;
  const provider = (str(s.provider) ?? "addon").toLowerCase();
  const title = str(s.title) ?? str(s.catalogName);
  if (provider === "tmdb") {
    const kind = (str(s.tmdbSourceType) ?? "DISCOVER").toUpperCase() as TmdbSourceType;
    const tmdbId = num(s.tmdbId);
    const sourceType = TMDB_TYPES.includes(kind) ? kind : "DISCOVER";
    // Everything but a discover names one TMDB object.
    if (sourceType !== "DISCOVER" && sourceType !== "COMPANY" && sourceType !== "NETWORK" && tmdbId <= 0) return null;
    return {
      provider: "tmdb",
      tmdbSourceType: sourceType,
      tmdbId,
      mediaType: sourceType === "NETWORK" || (str(s.mediaType) ?? "").toUpperCase() === "TV" ? "TV" : "MOVIE",
      ...(str(s.sortBy) ? { sortBy: str(s.sortBy) } : {}),
      ...(obj(s.filters) ? { filters: obj(s.filters)! } : {}),
      ...(title ? { title } : {}),
    };
  }
  if (provider === "trakt") {
    const traktListId = num(s.traktListId);
    if (traktListId <= 0) return null;
    const media = (str(s.mediaType) ?? "").toUpperCase();
    const how = (str(s.sortHow) ?? "").toLowerCase();
    return {
      provider: "trakt",
      traktListId,
      mediaType: media === "TV" || media === "SHOWS" || media === "SHOW" ? "TV" : media === "MOVIE" || media === "MOVIES" ? "MOVIE" : "",
      ...(str(s.sortBy) ? { sortBy: str(s.sortBy) } : {}),
      ...(how === "asc" || how === "desc" ? { sortHow: how } : {}),
      ...(title ? { title } : {}),
    };
  }
  if (provider !== "addon") return null;
  const addonId = str(s.addonId) ?? "";
  const addonBaseUrl = str(s.addonBaseUrl) ?? str(s.addon_base_url);
  const type = str(s.type);
  const catalogId = str(s.catalogId) ?? str(s.catalog_id);
  if ((!addonId && !addonBaseUrl) || !type || !catalogId) return null;
  const genre = str(s.genre);
  return {
    provider: "addon",
    addonId,
    ...(addonBaseUrl ? { addonBaseUrl } : {}),
    type,
    catalogId,
    ...(title ? { title } : {}),
    // The editor writes "None" for no genre.
    ...(genre && genre !== "None" ? { genre } : {}),
  };
}

function parseFolder(raw: unknown): CollectionFolder | null {
  const f = obj(raw);
  const id = str(f?.id);
  const title = str(f?.title);
  if (!f || !id || !title) return null;
  // The editor writes both keys, one of them often empty (measured: `catalogSources: []` beside a full `sources`).
  const list = [f.sources, f.catalogSources].find((v): v is unknown[] => Array.isArray(v) && v.length > 0) ?? [];
  const catalogSources = list.map(parseSource).filter((s): s is CollectionSource => s !== null);
  if (!catalogSources.length) return null;
  const cover = str(f.coverImageUrl);
  const emoji = str(f.coverEmoji);
  const hero = str(f.heroBackdropUrl);
  return {
    id,
    title,
    ...(cover ? { coverImageUrl: cover } : {}),
    ...(emoji ? { coverEmoji: emoji } : {}),
    tileShape: tileShapeOf(f.tileShape ?? f.posterShape),
    hideTitle: f.hideTitle === true,
    ...(hero ? { heroBackdropUrl: hero } : {}),
    catalogSources,
  };
}

function parseCollection(raw: unknown): NuvioCollection | null {
  const c = obj(raw);
  const id = str(c?.id);
  const title = str(c?.title);
  if (!c || !id || !title || !Array.isArray(c.folders)) return null;
  const folders = c.folders.map(parseFolder).filter((f): f is CollectionFolder => f !== null);
  if (!folders.length) return null;
  const mode = (str(c.viewMode) ?? "").toUpperCase() as ViewMode;
  const backdrop = str(c.backdropImageUrl);
  return {
    id,
    title,
    ...(backdrop ? { backdropImageUrl: backdrop } : {}),
    pinToTop: c.pinToTop === true,
    viewMode: VIEW_MODES.includes(mode) ? mode : "TABBED_GRID",
    showAllTab: c.showAllTab !== false,
    folders,
  };
}

/**
 * The collections array out of whatever shape came back: the RPC's rows ({collections_json}), an object
 * {collections}, the array itself, or any of those as a JSON string. Null when there is none to read (a cut or
 * empty reply), which is not the same as an empty list.
 */
export function collectionsArray(raw: unknown, depth = 0): unknown[] | null {
  if (depth > 3) return null;
  if (typeof raw === "string") {
    try {
      return collectionsArray(JSON.parse(raw), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) {
    const row = obj(raw[0]);
    if (row && "collections_json" in row) return collectionsArray(row.collections_json, depth + 1);
    return raw;
  }
  const o = obj(raw);
  if (o && "collections_json" in o) return collectionsArray(o.collections_json, depth + 1);
  if (o && Array.isArray(o.collections)) return o.collections;
  return null;
}

/**
 * Reads collections leniently: unknown fields are ignored, a folder without a usable source or a collection without
 * folders is skipped, and a collection that would pass the caps is left out whole.
 */
export function parseCollections(raw: unknown): NuvioCollection[] | null {
  const list = collectionsArray(raw);
  if (!list) return null;
  const out: NuvioCollection[] = [];
  let folders = 0;
  let sources = 0;
  for (const item of list) {
    const c = parseCollection(item);
    if (!c) continue;
    const n = c.folders.reduce((t, f) => t + f.catalogSources.length, 0);
    const tooWide = c.folders.some((f) => f.catalogSources.length > COLLECTION_CAPS.sourcesPerFolder);
    if (tooWide || folders + c.folders.length > COLLECTION_CAPS.folders || sources + n > COLLECTION_CAPS.sources) {
      console.warn(`[collections] "${c.title}" left out: ${c.folders.length} folders and ${n} sources pass the caps`);
      continue;
    }
    folders += c.folders.length;
    sources += n;
    out.push(c);
  }
  return out;
}

export interface PulledCollections {
  collections: NuvioCollection[];
  /** The blob as stored, for a push that must not lose what this client does not read. */
  raw: unknown[];
  updatedAt: string | null;
}

/** The profile's collections; null when the reply cannot be read (keep the last copy). */
export async function pullCollections(c: NuvioClient, profile: number): Promise<PulledCollections | null> {
  const rows = await c.rpc<{ collections_json?: unknown; updated_at?: string }[] | null>("sync_pull_collections", {
    p_profile_id: profile,
  });
  // No row: the profile never saved any collections.
  if (Array.isArray(rows) && !rows.length) return { collections: [], raw: [], updatedAt: null };
  const raw = collectionsArray(rows);
  const collections = raw && parseCollections(raw);
  if (!raw || !collections) return null;
  return { collections, raw, updatedAt: (Array.isArray(rows) ? rows[0]?.updated_at : undefined) ?? null };
}

/** Replaces the profile's collections with `all`, which must be the complete list (a pull's `raw`, edited). */
export async function pushCollections(c: NuvioClient, profile: number, all: readonly unknown[]): Promise<void> {
  if (!Array.isArray(all)) throw new Error("collections push needs the whole list");
  await c.rpc("sync_push_collections", { p_profile_id: profile, p_collections_json: all });
}
