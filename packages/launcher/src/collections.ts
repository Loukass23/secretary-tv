// The profile's Nuvio collections as home cards (docs/nuvio-cloud.md, phase 8): one card per collection, its folders as
// cover tiles; OK on a folder opens it in the catalog app. Read only, as in the apps: editing stays on nuvio.tv. Pure
// apart from the store it is handed, so it is unit tested.
import type { CollectionFolder, NuvioCollection } from "@secretary/nuvio";
import type { CatalogKind } from "./apps.ts";

export const COLLECTIONS_KEY = "nest.nuvioCollections";
export const COLLECTION_PREFIX = "nuvio:";
/** A card shows this many folders (two rows of two); the app has the rest. */
export const CARD_FOLDERS = 4;

export const collectionKey = (id: string) => `${COLLECTION_PREFIX}${id}`;
export const isCollectionKey = (key: string) => key.startsWith(COLLECTION_PREFIX);

export interface FolderCard {
  id: string;
  title: string;
  cover?: string;
  /** The app that opens it: the first kind its sources fill. */
  kind: CatalogKind;
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
