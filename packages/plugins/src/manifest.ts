// Nuvio plugin repositories: a manifest.json whose `scrapers` each name a provider script. Same fields and limits
// as the Nuvio apps read, so any Nuvio repository installs here unchanged (docs/plugins.md).

import type { AppScope } from "./sandbox.ts";

export type MediaType = "movie" | "tv";

export interface Scraper {
  id: string;
  name: string;
  description: string;
  /** Absolute URL of the provider script, resolved against the manifest's URL. */
  codeUrl: string;
  supportedTypes: string[];
  /** Which apps the scraper is for ("general", "anime"); empty, as in most repositories, is every app. */
  categories: string[];
  /** The repository's default; the user's toggle wins. */
  enabled: boolean;
}

export interface Manifest {
  name: string;
  scrapers: Scraper[];
}

const MAX_SCRAPERS = 160;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : []);

/** Reads a manifest leniently: a bad entry is skipped, a manifest without scrapers is an error. */
export function parseManifest(raw: unknown, manifestUrl: string): Manifest {
  const m = (raw ?? {}) as { name?: unknown; scrapers?: unknown };
  if (!Array.isArray(m.scrapers)) throw new Error("not a Nuvio plugin manifest (no scrapers)");
  const seen = new Set<string>();
  const scrapers: Scraper[] = [];
  for (const s of m.scrapers.slice(0, MAX_SCRAPERS) as Record<string, unknown>[]) {
    const id = typeof s?.id === "string" ? s.id.trim() : "";
    const file = typeof s?.filename === "string" ? s.filename.trim() : "";
    if (!id || !file || seen.has(id)) continue;
    let codeUrl: string;
    try {
      codeUrl = new URL(file, manifestUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/.test(codeUrl)) continue;
    seen.add(id);
    scrapers.push({
      id,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : id,
      description: typeof s.description === "string" ? s.description : "",
      codeUrl,
      supportedTypes: strings(s.supportedTypes),
      categories: strings(s.categories).map((c) => c.toLowerCase()),
      enabled: s.enabled !== false,
    });
  }
  return { name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : new URL(manifestUrl).host, scrapers };
}

/** "series" and "anime" titles are "tv" for providers; an empty list means every type. */
export function supports(s: Scraper, type: MediaType, anime = false): boolean {
  if (!s.supportedTypes.length) return true;
  const t = s.supportedTypes.map((x) => x.toLowerCase());
  if (type === "movie") return t.includes("movie");
  return t.includes("tv") || t.includes("series") || (anime && t.includes("anime"));
}

/** A scraper without categories runs in every app; one with them, only in the apps they name. */
export function inScope(s: Pick<Scraper, "categories">, scope: AppScope | undefined): boolean {
  return !scope || !s.categories?.length || s.categories.includes(scope);
}
