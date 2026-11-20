// The My List card on the home row: the profile's Nuvio library, newest first, as a media card (poster layout, the
// card's style menu, OK opens it into all of it). Pure apart from the store it is handed, so it is unit tested.
import type { LibraryItem } from "@secretary/nuvio";
import type { MediaItem } from "./cards.tsx";
import { posterUrl } from "./apps.ts";

export const MYLIST_KEY = "nest.myList";
/** A card holds this many titles; the catalog has the rest. */
export const MYLIST_MAX = 8;

/** The newest `max` titles as the card's items; ones without a name are left out. */
export function mylistItems(list: readonly LibraryItem[], max = MYLIST_MAX): { item: LibraryItem; media: MediaItem }[] {
  return [...list]
    .filter((l) => l.title.name)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, max)
    .map((item) => ({
      item,
      media: {
        poster: posterUrl(item.title),
        still: item.title.background,
        title: item.title.name,
        sub: [item.title.year, item.title.rating ? `★ ${item.title.rating}` : ""].filter(Boolean).join(" · ") || undefined,
        about: item.title.description,
      },
    }));
}

interface Cached {
  owner: string;
  list: readonly LibraryItem[];
}

/** The last pull for this account and profile; another profile's list is not shown. */
export function loadMylist(store: { getItem(k: string): string | null }, owner: string | null): LibraryItem[] {
  try {
    const c = JSON.parse(store.getItem(MYLIST_KEY) ?? "null") as Cached | null;
    return c && owner && c.owner === owner && Array.isArray(c.list) ? [...c.list] : [];
  } catch {
    return [];
  }
}

/** Keeps the newest titles only (a library can hold hundreds; the card shows a few). */
export function saveMylist(store: { setItem(k: string, v: string): void }, owner: string, list: readonly LibraryItem[]): void {
  try {
    const keep = [...list].sort((a, b) => b.addedAt - a.addedAt).slice(0, 24);
    store.setItem(MYLIST_KEY, JSON.stringify({ owner, list: keep } satisfies Cached));
  } catch {
    // the card shows again after the next pull
  }
}
