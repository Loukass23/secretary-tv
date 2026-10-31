// Stremio addons (the protocol Nuvio uses): installed by manifest URL, kept on this TV, asked for streams,
// subtitles, meta and catalogs over plain HTTP (docs/addons.md). Backend-agnostic: a sync adapter reads and
// full-replaces the list through synced()/replace().
import type { KV } from "@secretary/plugins";

export interface ManifestResource {
  name: string;
  types?: string[];
  idPrefixes?: string[];
}

export interface AddonCatalog {
  type: string;
  id: string;
  name: string;
  /** The extra properties the catalog takes ("search", "genre", "skip"), and which of them it requires. */
  extra: { name: string; isRequired?: boolean; options?: string[] }[];
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  resources: (string | ManifestResource)[];
  types: string[];
  idPrefixes?: string[];
  catalogs: AddonCatalog[];
}

/** What sync carries: the list, nothing fetched. */
export interface SyncedAddon {
  url: string;
  name: string;
  enabled: boolean;
  sort_order: number;
}

export interface AddonState extends SyncedAddon {
  /** Last manifest read, kept when a refresh fails. */
  manifest: AddonManifest | null;
  fetchedAt: number;
  error?: string;
}

export type Resource = "stream" | "subtitles" | "meta" | "catalog";

const STATE = "sectv.addons";
/** As the plugin repositories: manifests are read again after six hours, the old copy kept if that fails. */
export const ADDON_REFRESH_MS = 6 * 3600_000;
const MAX_ADDONS = 32;
const MAX_CATALOGS = 64;

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

/**
 * "stremio://host/x" or "https://host/x[/manifest.json][?q]" to the manifest's URL. The query (some addons carry
 * their configuration there) stays after manifest.json.
 */
export function addonManifestUrl(input: string): string {
  const raw = input.trim().replace(/^stremio:\/\//i, "https://");
  const q = raw.indexOf("?");
  const path = (q < 0 ? raw : raw.slice(0, q)).replace(/\/+$/, "");
  const query = q < 0 ? "" : raw.slice(q);
  return `${/\/manifest\.json$/i.test(path) ? path : `${path}/manifest.json`}${query}`;
}

/** The URL of one resource: the base (manifest URL minus /manifest.json), the path, then the manifest's query. */
export function resourceUrl(manifestUrl: string, path: string): string {
  const q = manifestUrl.indexOf("?");
  const base = (q < 0 ? manifestUrl : manifestUrl.slice(0, q)).replace(/\/manifest\.json$/i, "");
  return `${base}/${path}${q < 0 ? "" : manifestUrl.slice(q)}`;
}

/** Reads a manifest leniently: bad catalogs and resources are skipped, a manifest without id or resources is an error. */
export function parseAddonManifest(raw: unknown): AddonManifest {
  const m = (raw ?? {}) as Record<string, unknown>;
  const id = typeof m.id === "string" ? m.id.trim() : "";
  if (!id || !Array.isArray(m.resources)) throw new Error("not a Stremio addon manifest");
  const resources = (m.resources as unknown[]).flatMap((r): (string | ManifestResource)[] => {
    if (typeof r === "string") return [r];
    const o = r as Record<string, unknown> | null;
    if (!o || typeof o.name !== "string") return [];
    return [{ name: o.name, types: strings(o.types), idPrefixes: strings(o.idPrefixes) }];
  });
  const catalogs = (Array.isArray(m.catalogs) ? (m.catalogs as Record<string, unknown>[]) : [])
    .slice(0, MAX_CATALOGS)
    .flatMap((c): AddonCatalog[] => {
      if (typeof c?.type !== "string" || typeof c.id !== "string") return [];
      // Old manifests list extraSupported / extraRequired instead of extra.
      const required = strings(c.extraRequired) ?? [];
      const extra = Array.isArray(c.extra)
        ? (c.extra as Record<string, unknown>[]).flatMap((e) =>
            typeof e?.name === "string" ? [{ name: e.name, isRequired: e.isRequired === true, options: strings(e.options) }] : [],
          )
        : (strings(c.extraSupported) ?? []).map((name) => ({ name, isRequired: required.includes(name) }));
      return [{ type: c.type, id: c.id, name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : c.id, extra }];
    });
  return {
    id,
    name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : id,
    version: typeof m.version === "string" ? m.version : "",
    description: typeof m.description === "string" ? m.description : "",
    resources,
    types: strings(m.types) ?? [],
    idPrefixes: strings(m.idPrefixes),
    catalogs,
  };
}

export const hasResource = (m: AddonManifest, resource: Resource) =>
  m.resources.some((r) => (typeof r === "string" ? r : r.name) === resource);

/**
 * Whether an addon answers `resource` for this type and id, as Stremio decides it: the resource listed, by name or
 * in object form with its own types and idPrefixes, else the manifest's. An absent or empty idPrefixes takes any id.
 * Catalogs are matched on the manifest's catalog list instead (catalogFor).
 */
export function supportsResource(m: AddonManifest, resource: Resource, type: string, id?: string): boolean {
  const r = m.resources.find((x) => (typeof x === "string" ? x : x.name) === resource);
  if (!r) return false;
  const obj = typeof r === "string" ? undefined : r;
  if (!(obj?.types ?? m.types).includes(type)) return false;
  if (id == null || resource === "catalog") return true;
  const prefixes = obj?.idPrefixes ?? m.idPrefixes;
  return !prefixes?.length || prefixes.some((p) => id.startsWith(p));
}

/** True when the addon names an id prefix for `resource` and the id has it: the addon is that id's home. */
export function ownsId(m: AddonManifest, resource: Resource, id: string): boolean {
  const r = m.resources.find((x) => (typeof x === "string" ? x : x.name) === resource);
  const prefixes = (typeof r === "object" ? r.idPrefixes : undefined) ?? m.idPrefixes;
  return Boolean(prefixes?.length && prefixes.some((p) => id.startsWith(p)));
}

export interface CatalogExtra {
  search?: string;
  genre?: string;
  skip?: number;
}

/** catalog/<type>/<id>[/search=q|genre=g&skip=N].json; values encoded, keys in Stremio's order. */
export function catalogPath(type: string, id: string, extra: CatalogExtra = {}): string {
  const parts: string[] = [];
  if (extra.search) parts.push(`search=${encodeURIComponent(extra.search)}`);
  if (extra.genre) parts.push(`genre=${encodeURIComponent(extra.genre)}`);
  if (extra.skip) parts.push(`skip=${extra.skip}`);
  return `catalog/${type}/${encodeURIComponent(id)}${parts.length ? `/${parts.join("&")}` : ""}.json`;
}

/** Whether a catalog can be asked with these extras: each one supported, every required one given. */
export function catalogTakes(c: AddonCatalog, extra: CatalogExtra): boolean {
  const given = (Object.keys(extra) as (keyof CatalogExtra)[]).filter((k) => extra[k]);
  const names = c.extra.map((e) => e.name);
  return given.every((k) => names.includes(k)) && c.extra.every((e) => !e.isRequired || given.includes(e.name as keyof CatalogExtra));
}

const blank = (url: string, sort_order: number, name = new URL(url).host, enabled = true): AddonState => ({
  url,
  name,
  enabled,
  sort_order,
  manifest: null,
  fetchedAt: 0,
});

export function createAddonStore({
  kv,
  fetch: f = fetch,
  now = Date.now,
}: {
  kv: KV;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  let addons: AddonState[] = kv.get<AddonState[]>(STATE) ?? [];
  const listeners = new Set<() => void>();
  const save = () => {
    addons = [...addons].sort((a, b) => a.sort_order - b.sort_order);
    addons.forEach((a, i) => (a.sort_order = i));
    kv.set(STATE, addons);
    for (const l of listeners) l();
  };
  const find = (url: string) => addons.find((a) => a.url === url);

  // One read per addon at a time: a sync replace and a screen's refresh can ask together.
  const reading = new Map<AddonState, Promise<void>>();
  const load = (a: AddonState): Promise<void> => {
    const hit = reading.get(a);
    if (hit) return hit;
    const p = read(a).finally(() => reading.delete(a));
    reading.set(a, p);
    return p;
  };

  async function read(a: AddonState): Promise<void> {
    try {
      const res = await f(a.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      a.manifest = parseAddonManifest(await res.json());
      a.name = a.manifest.name;
      a.fetchedAt = now();
      delete a.error;
    } catch (err) {
      a.error = String((err as Error).message ?? err);
      if (!a.manifest) throw err;
    } finally {
      if (find(a.url) === a) save();
    }
  }

  return {
    /** Installed addons in the user's order. */
    list: (): readonly AddonState[] => addons,
    /** Enabled addons with a manifest, in order: the ones requests go to. */
    active: (): AddonState[] => addons.filter((a) => a.enabled && a.manifest),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /** Reads and installs an addon, last in the order; throws with a reason the screen can show. */
    async install(input: string): Promise<AddonState> {
      if (!/^(https?|stremio):\/\//i.test(input.trim())) throw new Error("The address must start with http");
      const url = addonManifestUrl(input);
      if (find(url)) throw new Error("Already installed");
      if (addons.length >= MAX_ADDONS) throw new Error("The list is full");
      const a = blank(url, addons.length);
      await load(a);
      addons.push(a);
      save();
      return a;
    },
    remove(url: string) {
      addons = addons.filter((a) => a.url !== url);
      save();
    },
    setEnabled(url: string, on: boolean) {
      const a = find(url);
      if (a) a.enabled = on;
      save();
    },
    toggle(url: string) {
      const a = find(url);
      if (a) a.enabled = !a.enabled;
      save();
    },
    /** One place earlier (-1) or later (1). */
    move(url: string, dir: -1 | 1) {
      const i = addons.findIndex((a) => a.url === url);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= addons.length) return;
      [addons[i].sort_order, addons[j].sort_order] = [addons[j].sort_order, addons[i].sort_order];
      save();
    },
    /** The list as sync carries it. */
    synced: (): SyncedAddon[] => addons.map(({ url, name, enabled, sort_order }) => ({ url, name, enabled, sort_order })),
    /**
     * Full-replaces the list (a sync pull). Addons already here keep their manifest; new ones are read by the next
     * refresh(), which this starts.
     */
    replace(list: readonly SyncedAddon[]) {
      const next: AddonState[] = [];
      for (const s of [...list].sort((a, b) => a.sort_order - b.sort_order)) {
        let url: string;
        try {
          url = addonManifestUrl(s.url);
          new URL(url);
        } catch {
          continue;
        }
        if (next.some((a) => a.url === url)) continue;
        const old = find(url);
        next.push(old ? { ...old, enabled: s.enabled, sort_order: s.sort_order } : blank(url, s.sort_order, s.name || undefined, s.enabled));
      }
      addons = next.slice(0, MAX_ADDONS);
      save();
      void this.refresh();
    },
    /** Reads manifests older than six hours (all with `force`). Failures keep the old copy. */
    async refresh(force = false): Promise<void> {
      await Promise.allSettled(addons.filter((a) => force || !a.manifest || now() - a.fetchedAt > ADDON_REFRESH_MS).map(load));
    },
  };
}

export type AddonStore = ReturnType<typeof createAddonStore>;

/** A raw Stremio stream; everything optional because addons vary. */
export interface AddonStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: { bingeGroup?: string; filename?: string; proxyHeaders?: { request?: Record<string, string> } };
  [k: string]: unknown;
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
  /** The addon's name, for the subtitle list. */
  addon: string;
}

/** A job for the plugin host (packages/plugins createPluginHost `extra`): one addon's streams for one title. */
export interface AddonJob {
  id: string;
  name: string;
  repo: string;
  run(ms: number): Promise<unknown[]>;
}

/** Stremio resource requests over the store's enabled addons. */
export function createAddonClient(store: Pick<AddonStore, "active">, f: typeof fetch = fetch, timeoutMs = 10_000) {
  async function call<T>(a: AddonState, path: string, ms = timeoutMs): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await f(resourceUrl(a.url, path), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
  const able = (resource: Resource, type: string, id?: string) =>
    store.active().filter((a) => supportsResource(a.manifest!, resource, type, id));
  const path = (resource: Resource, type: string, id: string) => `${resource}/${type}/${encodeURIComponent(id)}.json`;

  return {
    /**
     * One job per addon that serves streams for this id ("tt1", "tt1:1:2", "kitsu:7442:3"), in install order.
     * A stream with proxy headers keeps them as `headers`, which the host drops: AVPlay cannot send them.
     */
    streamJobs(type: string, id: string): AddonJob[] {
      return able("stream", type, id).map((a) => ({
        id: `addon:${a.manifest!.id}`,
        name: a.name,
        repo: a.url,
        async run(ms: number) {
          const { streams = [] } = await call<{ streams?: AddonStream[] }>(a, path("stream", type, id), ms);
          return streams.map((s) => {
            const headers = s.behaviorHints?.proxyHeaders?.request;
            return headers && Object.keys(headers).length ? { ...s, headers } : s;
          });
        },
      }));
    },
    /** Every addon's subtitles for this id, in install order, the same link once. Failing addons are skipped. */
    async subtitles(type: string, id: string): Promise<Subtitle[]> {
      const addons = able("subtitles", type, id);
      const settled = await Promise.allSettled(addons.map((a) => call<{ subtitles?: Partial<Subtitle>[] }>(a, path("subtitles", type, id))));
      const seen = new Set<string>();
      return settled.flatMap((r, i) =>
        r.status === "fulfilled"
          ? (r.value.subtitles ?? []).flatMap((s): Subtitle[] =>
              typeof s.url === "string" && !seen.has(s.url) && seen.add(s.url)
                ? [{ id: String(s.id ?? s.url), url: s.url, lang: String(s.lang ?? "und"), addon: addons[i].name }]
                : [],
            )
          : [],
      );
    },
    /**
     * The first meta an addon gives: addons whose meta idPrefixes match the id first, then the others that take the
     * type, each in install order. Null when none answers; the caller falls back to Cinemeta/Kitsu.
     */
    async meta<T = Record<string, unknown>>(types: readonly string[], id: string): Promise<T | null> {
      const tries = store.active().flatMap((a) => {
        const type = types.find((t) => supportsResource(a.manifest!, "meta", t, id));
        return type ? [{ a, type, own: ownsId(a.manifest!, "meta", id) }] : [];
      });
      for (const { a, type } of [...tries.filter((t) => t.own), ...tries.filter((t) => !t.own)]) {
        try {
          const { meta } = await call<{ meta?: T | null }>(a, path("meta", type, id));
          if (meta) return meta;
        } catch {
          // The next addon.
        }
      }
      return null;
    },
    /** Every catalog of the enabled addons for this type that takes these extras: home rows, search. */
    catalogs(type: string, extra: CatalogExtra = {}): { addon: AddonState; catalog: AddonCatalog }[] {
      return store
        .active()
        .flatMap((addon) =>
          // Each catalog names its own type, so only the resource itself is checked.
          hasResource(addon.manifest!, "catalog")
            ? addon.manifest!.catalogs.filter((c) => c.type === type && catalogTakes(c, extra)).map((catalog) => ({ addon, catalog }))
            : [],
        );
    },
    /** One page of a catalog's metas. */
    async catalog<T = Record<string, unknown>>(addon: AddonState, c: AddonCatalog, extra: CatalogExtra = {}): Promise<T[]> {
      const { metas = [] } = await call<{ metas?: T[] }>(addon, catalogPath(c.type, c.id, extra));
      return metas;
    },
    /** The full URL of a catalog page, for callers that fetch rows themselves (cinemeta.ts fetchRow). */
    catalogUrl: (addon: AddonState, c: AddonCatalog, extra: CatalogExtra = {}) => resourceUrl(addon.url, catalogPath(c.type, c.id, extra)),
  };
}

export type AddonClient = ReturnType<typeof createAddonClient>;

/** A home row read from an addon catalog; `page` builds the URL of a later page when the catalog takes `skip`. */
export interface AddonRowDef {
  id: string;
  title: string;
  url: string;
  origin: string;
  page?: (skip: number) => string;
}

/** Home rows for the catalogs that need no search or genre: one per catalog, in install order. */
export function addonRowDefs(
  list: readonly { addon: AddonState; catalog: AddonCatalog }[],
  url: (addon: AddonState, c: AddonCatalog, extra?: CatalogExtra) => string,
): AddonRowDef[] {
  return list.map(({ addon, catalog: c }) => ({
    id: `addon:${addon.manifest?.id ?? addon.url}:${c.type}:${c.id}`,
    title: c.name,
    url: url(addon, c),
    origin: addon.name,
    ...(c.extra.some((e) => e.name === "skip") ? { page: (skip: number) => url(addon, c, { skip }) } : {}),
  }));
}

/** How near the end of a row focus gets before its next page is read. */
const PAGE_AHEAD = 6;

/**
 * The next page to read for a row near its end, or null. The caller asks each URL once, so a page that adds nothing
 * (the catalog's end) leaves the length, and so the URL, unchanged and is never asked again.
 */
export function nextPage(def: { page?: (skip: number) => string }, length: number, col: number): string | null {
  return def.page && length > 0 && col >= length - PAGE_AHEAD ? def.page(length) : null;
}
