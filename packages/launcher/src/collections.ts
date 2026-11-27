// The profile's Nuvio collections as home cards (docs/nuvio-cloud.md, phase 8; docs/launcher.md "Collection cards"):
// one card per collection. Folded, it shows its folders' covers in the card style the viewer picked, as a media card
// does; OK opens it in place, the folders as the first row and each folder's titles as a row under it, and the end
// bar's "Open collection" opens the folder page in the catalog. Read only, as in the apps: editing stays on nuvio.tv.
// Pure apart from the store it is handed, so it is unit tested.
import type { CollectionFolder, CollectionSource, NuvioCollection, TileShape } from "@secretary/nuvio";
import type { CatalogKind } from "./apps.ts";
import type { RowShape } from "./row-look.ts";

export const COLLECTIONS_KEY = "nest.nuvioCollections";
export const COLLECTION_PREFIX = "nuvio:";
/** A folder row under the first one in an opened collection card holds this many titles; the folder page has the rest. */
export const FOLDER_TITLES = 20;

export const collectionKey = (id: string) => `${COLLECTION_PREFIX}${id}`;
export const isCollectionKey = (key: string) => key.startsWith(COLLECTION_PREFIX);

export interface FolderCard {
  id: string;
  title: string;
  cover?: string;
  /** The app that opens it: the first kind its sources fill. */
  kind: CatalogKind;
  /** How Nuvio draws its cover; the card's first row takes this shape unless the viewer picked a look. */
  shape?: TileShape;
  /** Where its titles come from, for its row in the opened card (catalog-kit lib/folder-titles.ts). */
  sources?: CollectionSource[];
}

export interface CollectionCard {
  /** `nuvio:<collection id>`: the card's key on the home row. */
  key: string;
  id: string;
  title: string;
  folders: FolderCard[];
}

/** The app a folder opens in (as the catalog's sourceKinds): films first, then series, then anime. */
export function folderKind(f: Pick<CollectionFolder, "catalogSources">): CatalogKind {
  const kinds = new Set<CatalogKind>();
  for (const s of f.catalogSources) {
    if (s.provider === "addon") {
      const t = s.type.toLowerCase();
      if (t === "movie") kinds.add("movie");
      else if (t === "series" || t === "tv") kinds.add("series");
      else if (t === "anime") kinds.add("anime");
    } else if (s.mediaType === "MOVIE") kinds.add("movie");
    else if (s.mediaType === "TV") kinds.add("series");
    else {
      kinds.add("movie");
      kinds.add("series");
    }
  }
  return kinds.has("movie") ? "movie" : kinds.has("series") ? "series" : kinds.has("anime") ? "anime" : "movie";
}

/** The collections that have a folder, pinned ones first (as the apps order them), as cards. */
export function toCards(list: readonly NuvioCollection[]): CollectionCard[] {
  const ordered = [...list.filter((c) => c.pinToTop), ...list.filter((c) => !c.pinToTop)];
  return ordered
    .filter((c) => c.folders.length > 0)
    .map((c) => ({
      key: collectionKey(c.id),
      id: c.id,
      title: c.title,
      folders: c.folders.map((f) => ({
        id: f.id,
        title: f.title,
        ...(f.coverImageUrl ? { cover: f.coverImageUrl } : {}),
        kind: folderKind(f),
        shape: f.tileShape,
        sources: f.catalogSources,
      })),
    }));
}

interface Cached {
  owner: string;
  cards: readonly CollectionCard[];
}

/** The last pull for this account and profile; another profile's copy is not shown. */
export function loadCards(store: { getItem(k: string): string | null }, owner: string | null): CollectionCard[] {
  try {
    const c = JSON.parse(store.getItem(COLLECTIONS_KEY) ?? "null") as Cached | null;
    return c && owner && c.owner === owner && Array.isArray(c.cards) ? c.cards : [];
  } catch {
    return [];
  }
}

export function saveCards(store: { setItem(k: string, v: string): void }, owner: string, cards: readonly CollectionCard[]): void {
  try {
    store.setItem(COLLECTIONS_KEY, JSON.stringify({ owner, cards } satisfies Cached));
  } catch {
    // the cards show again after the next pull
  }
}

// --- the card on the home row ---

/** The look of an opened collection card's first row (its folders): most folders' Nuvio shape, posters on a tie. */
export function foldersShape(folders: readonly Pick<FolderCard, "shape">[]): RowShape {
  const n = { POSTER: 0, LANDSCAPE: 0, SQUARE: 0 };
  for (const f of folders) n[f.shape ?? "POSTER"]++;
  if (n.LANDSCAPE > n.POSTER && n.LANDSCAPE >= n.SQUARE) return "landscape";
  if (n.SQUARE > n.POSTER && n.SQUARE > n.LANDSCAPE) return "square";
  return "poster";
}

/** Where a collection card's rows keep their look (row-look.ts): `<card>/folders`, then `<card>/<folder id>`. */
export const foldersRowKey = (c: Pick<CollectionCard, "key">) => `${c.key}/folders`;
export const folderRowKey = (c: Pick<CollectionCard, "key">, folderId: string) => `${c.key}/${folderId}`;

/** A title in a folder's row, as the launcher keeps it. */
export interface FolderTitle {
  id: string;
  name: string;
  poster?: string;
  background?: string;
  year?: string;
  rating?: string;
  description?: string;
  /** The kind it opens as (its source's). */
  kind: CatalogKind;
}

/**
 * The rows under the folders, in folder order: each folder that has titles, with its titles. A folder still loading
 * or empty has no row, so the remote never stops on one.
 */
export function folderRows(c: CollectionCard, titles: Readonly<Record<string, readonly FolderTitle[]>>): { folder: FolderCard; titles: readonly FolderTitle[] }[] {
  return c.folders.flatMap((f) => {
    const t = titles[folderTitlesKey(c.id, f.id)] ?? [];
    return t.length ? [{ folder: f, titles: t.slice(0, FOLDER_TITLES) }] : [];
  });
}

/** What the end bar says beside "Open collection": the collection and how many folders it holds. */
export function collectionLine(c: Pick<CollectionCard, "title" | "folders">): { title: string; sub: string } {
  const n = c.folders.length;
  return { title: c.title, sub: `${n} folder${n === 1 ? "" : "s"} · Open collection for every title` };
}

// --- each folder's first titles, kept so an opened card shows them on its first frame ---

export const FOLDER_TITLES_KEY = "nest.folderTitles";
/** Folders kept at most, the last loaded first; older ones load again when their card opens. */
export const FOLDER_TITLES_MAX = 40;

export const folderTitlesKey = (collectionId: string, folderId: string) => `${collectionId}/${folderId}`;

interface CachedTitles {
  owner: string;
  folders: Record<string, FolderTitle[]>;
}

export function loadFolderTitles(store: { getItem(k: string): string | null }, owner: string | null): Record<string, FolderTitle[]> {
  try {
    const c = JSON.parse(store.getItem(FOLDER_TITLES_KEY) ?? "null") as CachedTitles | null;
    return c && owner && c.owner === owner && c.folders && typeof c.folders === "object" ? c.folders : {};
  } catch {
    return {};
  }
}

/** Keeps the newest `FOLDER_TITLES_MAX` folders (insertion order: the last written last). */
export function saveFolderTitles(store: { setItem(k: string, v: string): void }, owner: string, folders: Record<string, FolderTitle[]>): void {
  const keys = Object.keys(folders).slice(-FOLDER_TITLES_MAX);
  const kept = Object.fromEntries(keys.map((k) => [k, folders[k].slice(0, FOLDER_TITLES)]));
  try {
    store.setItem(FOLDER_TITLES_KEY, JSON.stringify({ owner, folders: kept } satisfies CachedTitles));
  } catch {
    // they load again when the card opens
  }
}

/** A collection card's folded look until the viewer picks one: stills for landscape covers, else a grid of covers. */
export const collectionStyle = (folders: readonly Pick<FolderCard, "shape">[]): { layout: "stills" | "grid"; size: "l" } =>
  foldersShape(folders) === "landscape" ? { layout: "stills", size: "l" } : { layout: "grid", size: "l" };
