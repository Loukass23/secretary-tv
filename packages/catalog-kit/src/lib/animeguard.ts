import { fetchRow, rowsFor } from "./cinemeta.ts";
import type { CatalogType, Title } from "./types.ts";

/**
 * Cinemeta's series and movie lists hold anime too (they are IMDb titles), so Shows and Cinema listed them beside the
 * Anime app's own. The anime catalogs know which IMDb ids are anime; a title is dropped from Shows or Cinema when it is
 * an animation and one of those. Animation alone is not enough: western cartoons belong in Shows.
 */
let known: Promise<Set<string>> | null = null;

/** IMDb ids of the anime in the Anime app's own rows, read once; an unreachable catalog adds nothing. */
export function animeImdbIds(f: typeof fetch = fetch): Promise<Set<string>> {
  known ??= Promise.all(rowsFor("anime").map((r) => fetchRow(r.url, f).catch(() => [] as Title[]))).then((rows) => {
    const ids = new Set<string>();
    for (const row of rows) for (const t of row) if (t.id.startsWith("tt")) ids.add(t.id);
    // An empty answer means the catalogs were unreachable: ask again next time.
    if (!ids.size) known = null;
    return ids;
  });
  return known;
}

const isAnimation = (t: Title) => t.genre?.some((g) => /^(animation|anime)$/i.test(g)) ?? false;

/** `titles` without the anime, for the Shows and Cinema apps; the Anime app's rows pass through. */
export async function withoutAnime(type: CatalogType, titles: Title[], f?: typeof fetch): Promise<Title[]> {
  if (type === "anime" || !titles.some((t) => t.id.startsWith("tt") && isAnimation(t))) return titles;
  const anime = await animeImdbIds(f);
  return anime.size ? titles.filter((t) => !(isAnimation(t) && anime.has(t.id))) : titles;
}

/** For the tests. */
export function resetAnimeGuard(): void {
  known = null;
}
