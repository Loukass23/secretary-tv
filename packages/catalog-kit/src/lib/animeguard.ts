import { fetchRow, rowsFor } from "./cinemeta.ts";
import type { CatalogType, Title } from "./types.ts";

/**
 * The anime rule: a title the catalog knows is anime appears only under Anime, never under Shows or Cinema. This file
 * is the one place that decides "is this title anime"; every surface asks `isAnime` / `kindFor`:
 *
 * - Shows and Cinema rows in the catalog (`withoutAnime`), and Secretary's Shows and Cinema cards (picks, genre rows,
 *   My List).
 * - Continue watching, in the catalog home (`loadAllResume` in resume.ts) and in Secretary's opened cards: an anime
 *   entry saved or synced as a series moves to Anime (`asAnimeKind`).
 * - The type label on a title page ("Anime", not "Show").
 *
 * Cinemeta's series and movie lists hold anime too (they are IMDb titles). A title is anime when it has a Kitsu id,
 * when its IMDb id is one the anime catalogs list, or when it is animation its metadata says is Japanese
 * (`Title.japanese`, lib/cinemeta.ts). Animation alone is not enough: western cartoons belong in Shows. A title whose
 * genres are known and include neither Animation nor Anime is never anime, whatever the id lists say.
 *
 * A list asked for one kind (`onlyKind`) holds each title once: an anime synced as a series and saved as anime is one
 * entry, not two.
 */
let known: Promise<Set<string>> | null = null;
/** The ids learnt so far, for the surfaces that decide at once (a render). Only grows. */
const learnt = new Set<string>();

/** IMDb ids of the anime in the Anime catalog's own rows, read once; an unreachable catalog adds nothing. */
export function animeImdbIds(f: typeof fetch = fetch): Promise<Set<string>> {
  known ??= Promise.all(rowsFor("anime").map((r) => fetchRow(r.url, f).catch(() => [] as Title[]))).then((rows) => {
    const ids = new Set<string>();
    for (const row of rows) for (const t of row) if (t.id.startsWith("tt")) ids.add(t.id);
    // An empty answer means the catalogs were unreachable: ask again next time.
    if (!ids.size) known = null;
    noteAnime(ids);
    return ids;
  });
  return known;
}

/** Ids another anime list gave (Secretary's Anime picks and genre rows, an anime page that was opened). */
export function noteAnime(ids: Iterable<string>): void {
  for (const id of ids) if (id.startsWith("tt")) learnt.add(id);
}

/** Every IMDb id known to be anime so far. */
export const knownAnime = (): ReadonlySet<string> => learnt;

const isAnimation = (t: Pick<Title, "genre">) => t.genre?.some((g) => /^(animation|anime)$/i.test(g)) ?? false;

/** Whether the catalog knows `t` is anime. Pure given `ids`. */
type Kinded = Pick<Title, "id" | "genre" | "japanese">;

export function isAnime(t: Kinded, ids: ReadonlySet<string> = learnt): boolean {
  if (t.id.startsWith("kitsu:")) return true;
  if (t.japanese && isAnimation(t)) return true;
  if (!t.id.startsWith("tt") || !ids.has(t.id)) return false;
  return !t.genre?.length || isAnimation(t);
}

/** The catalog a title belongs under: `type`, unless the title is anime. */
export const kindFor = (type: CatalogType, t: Kinded, ids: ReadonlySet<string> = learnt): CatalogType =>
  type === "anime" || isAnime(t, ids) ? "anime" : type;

/** Continue watching (or any typed list) with anime entries moved to Anime. Entries already right are kept as they are. */
export function asAnimeKind<E extends { type: CatalogType; title: Kinded }>(
  list: readonly E[],
  ids: ReadonlySet<string> = learnt,
): E[] {
  return list.map((e) => {
    const type = kindFor(e.type, e.title, ids);
    return type === e.type ? e : { ...e, type };
  });
}

/** The entries of a typed list that belong under `kind` (a Secretary card's Continue watching, picks or My List). */
export const onlyKind = <E extends { type: CatalogType; title: Kinded }>(
  kind: CatalogType,
  list: readonly E[],
  ids: ReadonlySet<string> = learnt,
): E[] => {
  const seen = new Set<string>();
  return asAnimeKind(list, ids).filter((e) => e.type === kind && !seen.has(e.title.id) && !!seen.add(e.title.id));
};

/** The word a title page shows for its kind. */
export const typeLabel = (type: CatalogType, t: Kinded, ids: ReadonlySet<string> = learnt): string =>
  type === "movie" ? "Film" : kindFor(type, t, ids) === "anime" ? "Anime" : "Show";

/** `titles` without the anime, for the Shows and Cinema rows; the Anime rows pass through. */
export async function withoutAnime(type: CatalogType, titles: Title[], f?: typeof fetch): Promise<Title[]> {
  if (type === "anime") {
    noteAnime(titles.map((t) => t.id));
    return titles;
  }
  if (!titles.some((t) => t.id.startsWith("kitsu:") || (t.id.startsWith("tt") && (isAnimation(t) || learnt.has(t.id) || t.japanese)))) return titles;
  const anime = new Set([...learnt, ...(await animeImdbIds(f))]);
  return titles.filter((t) => !isAnime(t, anime));
}

/** For the tests. */
export function resetAnimeGuard(): void {
  known = null;
  learnt.clear();
}
