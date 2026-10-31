import { readJson, whenIdle, writeJson } from "@secretary/tv-kit";
import type { CatalogType, HomeRow, Title } from "./types.ts";

const MAX_PER_ROW = 30;
const keyFor = (type: CatalogType) => `sectv.${type}.home.v1`;

/** Only what the first frame needs: ids, names and the poster URL when the catalog gave one (IMDb ids derive theirs). */
const slim = (m: Title): Title => ({ id: m.id, name: m.name, year: m.year, rating: m.rating, poster: m.poster });

export function loadHome(type: CatalogType): HomeRow[] {
  const rows = readJson<HomeRow[]>(keyFor(type));
  return Array.isArray(rows) ? rows : [];
}

export function saveHome(type: CatalogType, rows: HomeRow[]): void {
  const snapshot = rows.map((r) => ({ ...r, items: r.items.slice(0, MAX_PER_ROW).map(slim) }));
  whenIdle(() => writeJson(keyFor(type), snapshot));
}
