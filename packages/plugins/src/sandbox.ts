// Runs one provider script the way the Nuvio apps do: CommonJS (module/exports), a require that offers nothing
// beyond the allowed modules, and the SCRAPER_ID / SCRAPER_SETTINGS / TMDB_API_KEY globals, plus the host's context
// (DEVICE_PROFILE / DEVICE_CAPS / LANG_PREF / APP_SCOPE) that providers read with `typeof X !== "undefined"`. Used inside a Worker on
// the TV and directly in the tests. A provider is trusted code from a repository the user added; the Worker is
// what keeps it away from the page (no DOM, no app storage) and what lets a hung one be killed.

/** "anime" for Secretary Anime, "general" for the others: scrapers declare theirs in the manifest (`categories`). */
export type AppScope = "anime" | "general";

/** What the TV tells providers about itself; a field left out stays undefined in the provider, as in the Nuvio apps. */
export interface ProviderContext {
  deviceProfile?: "tv" | "mobile" | "default";
  /** "hevc,hdr10,hdr10+,4k,eac3" (catalog-kit/lib/device.ts). */
  deviceCaps?: string;
  /** "fr,en;subs=fr": audio languages, most wanted first, then subtitle ones (catalog-kit/lib/settings.ts). */
  langPref?: string;
  appScope?: AppScope;
}

export interface ProviderJob {
  code: string;
  scraperId: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  season: number | null;
  episode: number | null;
  tmdbKey: string;
  settings?: Record<string, unknown>;
  context?: ProviderContext;
}

const MAX_RESULTS = 150;

/** The context's globals, in the order they follow TMDB_API_KEY in the provider's scope. */
const CONTEXT_GLOBALS = [
  ["DEVICE_PROFILE", "deviceProfile"],
  ["DEVICE_CAPS", "deviceCaps"],
  ["LANG_PREF", "langPref"],
  ["APP_SCOPE", "appScope"],
] as const;

/**
 * Older Nuvio workers prepend `var DEVICE_PROFILE = "tv";`-style lines to every provider, guessed from the request. A
 * `var` would overwrite what the host passes, so those leading lines go for each global the host sets; the rest of
 * the prelude (DEBRID_CHECK_URL…) stays. Newer workers guard theirs (`typeof X !== "undefined" && X ? X : …`): those
 * lines do not match, stay, and keep the host's value.
 */
export function dropPrelude(code: string, names: readonly string[]): string {
  if (!names.length) return code;
  const lines = code.split("\n");
  let i = 0;
  const out: string[] = [];
  for (; i < lines.length; i++) {
    const m = /^var ([A-Z_]+) = (?:"(?:[^"\\]|\\.)*"|[\w.]+);\s*$/.exec(lines[i]);
    if (!m) break;
    if (!names.includes(m[1])) out.push(lines[i]);
  }
  return i ? [...out, ...lines.slice(i)].join("\n") : code;
}

/** fetch whose Response.json() resolves null on a bad body, as the Nuvio runtimes do; providers rely on it. */
export function lenientFetch(f: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await f(input, init);
    const json = res.json.bind(res);
    Object.defineProperty(res, "json", { value: () => json().catch(() => null) });
    return res;
  }) as typeof fetch;
}

export async function runProvider(job: ProviderJob, f: typeof fetch): Promise<unknown[]> {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    throw new Error(`module not available: ${name}`);
  };
  // A provider may also declare a global getStreams instead of exporting it.
  // Only the globals the host sets are declared: one it leaves out stays undefined to a provider's `typeof` check.
  const ctx = job.context ?? {};
  const set = CONTEXT_GLOBALS.filter(([, k]) => ctx[k] != null);
  const code = dropPrelude(job.code, set.map(([name]) => name));
  const body = `${code}\n;return typeof getStreams === "function" ? getStreams : undefined;`;
  const declared = new Function(
    "module",
    "exports",
    "require",
    "fetch",
    "SCRAPER_ID",
    "SCRAPER_SETTINGS",
    "TMDB_API_KEY",
    ...set.map(([name]) => name),
    body,
  )(module, module.exports, require, lenientFetch(f), job.scraperId, job.settings ?? {}, job.tmdbKey, ...set.map(([, k]) => ctx[k])) as unknown;
  const exported = module.exports as { getStreams?: unknown; default?: { getStreams?: unknown } };
  const fn = [exported.getStreams, exported.default?.getStreams, declared].find((x) => typeof x === "function") as
    | ((...a: unknown[]) => unknown)
    | undefined;
  if (!fn) throw new Error("provider has no getStreams");
  const out = await fn(job.tmdbId, job.mediaType, job.season, job.episode);
  // Plain data only: the results cross from the Worker by structured clone.
  return Array.isArray(out) ? (JSON.parse(JSON.stringify(out.slice(0, MAX_RESULTS))) as unknown[]) : [];
}
