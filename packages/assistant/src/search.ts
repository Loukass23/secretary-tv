import type { CatalogKind, SearchResult, SlimTitle } from "./types.ts";

const CINEMETA = "https://v3-cinemeta.strem.io";
const KITSU = "https://anime-kitsu.strem.fun";
const MAX_RESULTS = 24;

interface RawSearchMeta {
  id?: string;
  imdb_id?: string;
  name?: string;
  year?: string;
  releaseInfo?: string;
  imdbRating?: string;
  poster?: string;
  background?: string;
  description?: string;
}

function stripSeasonSuffix(name: string): string {
  return name
    .replace(/\s*[:\-–]?\s*(?:The\s+)?Final\s+Season(?:\s+Part\s+\d+)?$/i, "")
    .replace(/\s*[:\-–]?\s*(?:Season\s+\d+|\d+(?:st|nd|rd|th)\s+Season)(?:\s+Part\s+\d+)?$/i, "")
    .replace(/\s+Part\s+\d+$/i, "")
    .replace(/\s+[2-9]$/, "")
    .trim();
}

function groupAnimeSearch(metas: readonly RawSearchMeta[]): SlimTitle[] {
  const groups = new Map<string, RawSearchMeta[]>();
  for (const m of metas) {
    const key = m.imdb_id?.startsWith("tt") ? m.imdb_id : m.id?.startsWith("kitsu:") ? m.id : null;
    if (!key || !m.name) continue;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  const out: SlimTitle[] = [];
  for (const [key, list] of groups) {
    const base =
      list.find((m) => m.name && stripSeasonSuffix(m.name) === m.name) ??
      [...list].sort((a, b) =>
        (a.year ?? a.releaseInfo ?? "9999").localeCompare(b.year ?? b.releaseInfo ?? "9999"),
      )[0];
    if (!base.name) continue;
    out.push({
      id: key,
      name: stripSeasonSuffix(base.name),
      year: base.year ?? base.releaseInfo?.slice(0, 4) ?? "",
      rating: base.imdbRating ?? "",
      poster: base.poster?.replace("/medium.", "/small."),
      background: base.background,
      ...(about(base.description) ? { description: about(base.description) } : {}),
    });
  }
  return out;
}

function toSlimTitle(m: RawSearchMeta): SlimTitle | null {
  const id = m.imdb_id ?? m.id;
  if (!id || !m.name || !id.startsWith("tt")) return null;
  const desc = about(m.description);
  return {
    id,
    name: m.name,
    year: m.year ?? m.releaseInfo?.slice(0, 4) ?? "",
    rating: m.imdbRating ?? "",
    ...(desc ? { description: desc } : {}),
  };
}

/**
 * Ranks and interleaves search results across movie, series, and anime catalogs.
 * Exact and prefix title matches bubble to the top while preserving cross-type variety.
 */
export function rankSearch(
  query: string,
  groups: readonly { type: CatalogKind; items: readonly SlimTitle[] }[],
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { result: SearchResult; rankScore: number }[] = [];
  const maxLen = Math.max(0, ...groups.map((g) => g.items.length));

  for (let i = 0; i < maxLen; i++) {
    for (const g of groups) {
      const item = g.items[i];
      if (!item) continue;
      const name = item.name.toLowerCase();
      let bonus = 0;
      if (name === q) bonus = 300;
      else if (name.startsWith(q)) bonus = 200;
      else if (name.includes(q)) bonus = 100;
      scored.push({
        result: { type: g.type, title: item },
        rankScore: bonus - i * 5,
      });
    }
  }

  return scored
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, MAX_RESULTS)
    .map((s) => s.result);
}

/** No catalog answered a search: offline, timed out, or every catalog failed. Not thrown for a search that was cancelled. */
export class SearchUnavailable extends Error {
  constructor(message = "The catalogs are not answering") {
    super(message);
    this.name = "SearchUnavailable";
  }
}

export interface CatalogSearchOptions {
  fetch?: typeof fetch;
  /** Cancels the search: every catalog request is aborted and the promise rejects with an AbortError (or the signal's reason). */
  signal?: AbortSignal;
  /** Gives up on a catalog that has not answered after this many ms. Default 8000. */
  timeout?: number;
}

const SEARCH_TIMEOUT_MS = 8000;

/** Why a signal fired; older TV browsers have no `reason`. */
const abortReason = (s: AbortSignal): unknown => s.reason ?? new DOMException("The search was cancelled", "AbortError");

/**
 * Searches the film, series and anime catalogs at once, straight from where it runs (the TV, or the server's /search
 * while it lasts). Each catalog request is aborted when `signal` fires or after `timeout`; a catalog that fails or times
 * out counts as no results, unless every catalog does: then it throws SearchUnavailable, so the screen can say search
 * is not answering instead of "nothing found".
 */
export async function findCatalogs(query: string, opts: CatalogSearchOptions = {}): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const f = opts.fetch ?? fetch;
  const { signal } = opts;
  if (signal?.aborted) throw abortReason(signal);
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal?.addEventListener("abort", stop);
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? SEARCH_TIMEOUT_MS);
  const enc = encodeURIComponent(q);
  const sources: { type: CatalogKind; url: string }[] = [
    { type: "movie", url: `${CINEMETA}/catalog/movie/top/search=${enc}.json` },
    { type: "series", url: `${CINEMETA}/catalog/series/top/search=${enc}.json` },
    { type: "anime", url: `${KITSU}/catalog/anime/kitsu-anime-list/search=${enc}.json` },
  ];
  // A fetch that ignores its signal still loses the race to the abort.
  const aborted = new Promise<never>((_, reject) => {
    ctrl.signal.addEventListener("abort", () => reject(new SearchUnavailable("The catalogs took too long")));
  });
  aborted.catch(() => {});
  try {
    const settled = await Promise.allSettled(
      sources.map(({ type, url }) =>
        Promise.race([
          aborted,
          (async () => {
            const res = await f(url, { signal: ctrl.signal });
            if (!res.ok) throw new SearchUnavailable(`HTTP ${res.status}`);
            const { metas = [] } = (await res.json()) as { metas?: RawSearchMeta[] };
            const items =
              type === "anime" ? groupAnimeSearch(metas) : metas.map(toSlimTitle).filter((t): t is SlimTitle => t !== null);
            return { type, items };
          })(),
        ]),
      ),
    );
    if (signal?.aborted) throw abortReason(signal);
    if (settled.every((r) => r.status === "rejected")) throw new SearchUnavailable();
    const groups = settled.map((res, idx) => (res.status === "fulfilled" ? res.value : { type: sources[idx].type, items: [] }));
    return rankSearch(q, groups);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

/** findCatalogs, with "no catalog answered" read as no results (the assistant's watch prompts). */
export async function searchCatalogs(query: string, f: typeof fetch = fetch): Promise<SearchResult[]> {
  try {
    return await findCatalogs(query, { fetch: f });
  } catch (e) {
    if (e instanceof SearchUnavailable) return [];
    throw e;
  }
}

const DISCOVER_RESULTS = 18;

/** Top titles of a kind, optionally in a genre: what "show me a comedy" browses when nothing is named. */
export async function discoverCatalog(
  kind: CatalogKind | undefined,
  genre: string | undefined,
  f: typeof fetch = fetch,
): Promise<SearchResult[]> {
  const g = genre ? `/genre=${encodeURIComponent(genre)}` : "";
  const kinds: CatalogKind[] = kind ? [kind] : ["movie", "series"];
  const settled = await Promise.allSettled(
    kinds.map(async (type) => {
      const url =
        type === "anime"
          ? `${KITSU}/catalog/anime/${genre ? "kitsu-anime-popular" : "kitsu-anime-trending"}${g}.json`
          : `${CINEMETA}/catalog/${type}/top${g}.json`;
      const res = await f(url);
      if (!res.ok) return [] as SearchResult[];
      const { metas = [] } = (await res.json()) as { metas?: RawSearchMeta[] };
      const items =
        type === "anime"
          ? groupAnimeSearch(metas)
          : metas.map((m) => withArt(toSlimTitle(m), m)).filter((t): t is SlimTitle => t !== null);
      return items.map((title) => ({ type, title }));
    }),
  );
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  // Interleaved so "something for tonight" shows films and series side by side.
  const out: SearchResult[] = [];
  for (let i = 0; out.length < DISCOVER_RESULTS && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (l[i] && out.length < DISCOVER_RESULTS) out.push(l[i]);
  }
  return out;
}

/** A catalog's description, trimmed to what fits under a title on the TV. */
export const about = (d: string | undefined): string | undefined => {
  const t = d?.replace(/\s+/g, " ").trim();
  return t ? (t.length > 320 ? `${t.slice(0, 317).replace(/\s\S*$/, "")}…` : t) : undefined;
};

function withArt(t: SlimTitle | null, m: RawSearchMeta): SlimTitle | null {
  if (!t) return null;
  return { ...t, poster: m.poster?.replace("/medium/", "/small/"), background: m.background, ...(about(m.description) ? { description: about(m.description) } : {}) };
}
