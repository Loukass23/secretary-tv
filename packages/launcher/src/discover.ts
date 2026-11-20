// Genre rows on the home row, after My List: each is a media card of what the catalogs list for that genre. Fetched from
// the TV once a day; pure apart from the store it is handed, so it is unit tested.
import type { CatalogKind, SearchResult } from "./apps.ts";

export const DISCOVER_KEY = "nest.discover.1";
export const DISCOVER_PREFIX = "genre:";
export const DISCOVER_TTL_MS = 24 * 60 * 60 * 1000;

export interface DiscoverDef {
  key: string;
  kind: CatalogKind;
  /** The catalog's genre name. */
  genre: string;
  label: string;
}

const def = (kind: CatalogKind, genre: string, label: string): DiscoverDef => ({
  key: `${DISCOVER_PREFIX}${kind}:${genre.toLowerCase()}`,
  kind,
  genre,
  label,
});

export const DISCOVER: readonly DiscoverDef[] = [
  def("movie", "Action", "Action films"),
  def("movie", "Comedy", "Comedy films"),
  def("movie", "Sci-Fi", "Sci-Fi films"),
  def("series", "Drama", "Drama shows"),
  def("series", "Comedy", "Comedy shows"),
  def("anime", "Action", "Action anime"),
];

export const isDiscoverKey = (key: string) => key.startsWith(DISCOVER_PREFIX);
export const discoverLabel = (key: string) => DISCOVER.find((d) => d.key === key)?.label ?? key;

export type DiscoverData = Record<string, SearchResult[]>;

export function loadDiscover(store: { getItem(k: string): string | null }, now = Date.now()): { data: DiscoverData; fresh: boolean } {
  try {
    const c = JSON.parse(store.getItem(DISCOVER_KEY) ?? "null") as { at: number; data: DiscoverData } | null;
    return c && typeof c.data === "object" && c.data ? { data: c.data, fresh: now - c.at < DISCOVER_TTL_MS } : { data: {}, fresh: false };
  } catch {
    return { data: {}, fresh: false };
  }
}

/** Reads every row (a failed one keeps its cached list) and keeps the result. */
export async function refreshDiscover(
  store: { getItem(k: string): string | null; setItem(k: string, v: string): void },
  fetchRow: (kind: CatalogKind, genre: string) => Promise<SearchResult[]>,
  now = Date.now(),
): Promise<DiscoverData> {
  const have = loadDiscover(store, now);
  if (have.fresh) return have.data;
  const data: DiscoverData = { ...have.data };
  await Promise.all(
    DISCOVER.map(async (d) => {
      const rows = await fetchRow(d.kind, d.genre).catch(() => []);
      if (rows.length) data[d.key] = rows.slice(0, 12);
    }),
  );
  try {
    store.setItem(DISCOVER_KEY, JSON.stringify({ at: now, data }));
  } catch {
    // the rows read again next start
  }
  return data;
}
