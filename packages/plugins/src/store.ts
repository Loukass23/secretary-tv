import { type Manifest, parseManifest } from "./manifest.ts";

/** Synchronous key-value storage (localStorage on the TV, a Map in tests). */
export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

export interface RepoState {
  url: string;
  enabled: boolean;
  /** Last manifest read, kept when a refresh fails. */
  manifest: Manifest | null;
  fetchedAt: number;
  error?: string;
  /** The user's toggles by scraper id; a missing id follows the manifest's default. */
  scrapers: Record<string, boolean>;
}

export interface PluginState {
  enabled: boolean;
  repos: RepoState[];
  /** Provider (scraper) ids in the order the user wants them; providers not listed follow, in listing order. */
  providerOrder?: string[];
}

const STATE = "sectv.plugins";
const CODE = "sectv.plugin.code:";
/** As the Nuvio apps: manifests and code are read again after six hours, the old copy kept if that fails. */
export const REFRESH_MS = 6 * 3600_000;
const MAX_REPOS = 24;
const MAX_CODE = 2 * 1024 * 1024;

/** "https://host/repo" or ".../manifest.json" to the manifest's URL. */
export function manifestUrl(input: string): string {
  const url = input.trim().replace(/\/+$/, "");
  return /\.json(\?|$)/.test(url) ? url : `${url}/manifest.json`;
}

const blank = (url: string): RepoState => ({ url, enabled: true, manifest: null, fetchedAt: 0, scrapers: {} });

export function createPluginStore({
  kv,
  fetch: f = fetch,
  now = Date.now,
  defaults = [],
}: {
  kv: KV;
  fetch?: typeof fetch;
  now?: () => number;
  /** Repositories added on first run (a build's own, from its gitignored env). */
  defaults?: readonly string[];
}) {
  let state: PluginState = kv.get<PluginState>(STATE) ?? { enabled: true, repos: defaults.map((u) => blank(manifestUrl(u))) };
  const listeners = new Set<() => void>();
  const save = () => {
    state = { ...state, repos: [...state.repos] };
    kv.set(STATE, state);
    for (const l of listeners) l();
  };
  const repo = (url: string) => state.repos.find((r) => r.url === url);

  async function load(r: RepoState): Promise<void> {
    try {
      const res = await f(r.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      r.manifest = parseManifest(await res.json(), r.url);
      r.fetchedAt = now();
      delete r.error;
    } catch (err) {
      r.error = String((err as Error).message ?? err);
      if (!r.manifest) throw err;
    } finally {
      save();
    }
  }

  return {
    get: () => state,
    /** Called after every change, for screens that show the list. */
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    setEnabled(on: boolean) {
      state.enabled = on;
      save();
    },
    /** Adds and reads a repository; throws with a reason the screen can show. */
    async add(input: string): Promise<RepoState> {
      if (!/^https?:\/\//i.test(input.trim())) throw new Error("The address must start with http");
      const url = manifestUrl(input);
      if (repo(url)) throw new Error("Already added");
      if (state.repos.length >= MAX_REPOS) throw new Error("The list is full");
      const r = blank(url);
      await load(r);
      state.repos.push(r);
      save();
      return r;
    },
    remove(url: string) {
      state.repos = state.repos.filter((r) => r.url !== url);
      save();
    },
    toggleRepo(url: string) {
      const r = repo(url);
      if (r) r.enabled = !r.enabled;
      save();
    },
    toggleScraper(url: string, id: string) {
      const r = repo(url);
      const s = r?.manifest?.scrapers.find((x) => x.id === id);
      if (!r || !s) return;
      r.scrapers = { ...r.scrapers, [id]: !(r.scrapers[id] ?? s.enabled) };
      save();
    },
    /** Every provider id in the user's order: the saved order, then the rest as the repositories list them. */
    providerOrder(): string[] {
      const all = state.repos.flatMap((r) => r.manifest?.scrapers.map((s) => s.id) ?? []);
      const saved = (state.providerOrder ?? []).filter((id) => all.includes(id));
      return [...saved, ...all.filter((id) => !saved.includes(id))];
    },
    /** Moves a provider one place earlier (-1) or later (1) in the order. */
    moveProvider(id: string, dir: -1 | 1) {
      const order = this.providerOrder();
      const i = order.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      state.providerOrder = order;
      save();
    },
    isScraperOn(r: RepoState, id: string): boolean {
      const s = r.manifest?.scrapers.find((x) => x.id === id);
      return s != null && (r.scrapers[id] ?? s.enabled);
    },
    /** The repositories as sync carries them (Nuvio Cloud's plugin list); per-scraper toggles stay on the TV. */
    synced: () =>
      state.repos.map((r, i) => ({ url: r.url, name: r.manifest?.name ?? "", enabled: r.enabled, sort_order: i })),
    /**
     * Full-replaces the repositories (a sync pull). Ones already here keep their manifest and scraper toggles; new
     * ones are read by the refresh this starts.
     */
    replace(list: readonly { url: string; enabled: boolean; sort_order: number }[]) {
      const next: RepoState[] = [];
      for (const s of [...list].sort((a, b) => a.sort_order - b.sort_order)) {
        const url = manifestUrl(s.url);
        if (!/^https?:\/\//i.test(url) || next.some((r) => r.url === url)) continue;
        const old = repo(url);
        next.push(old ? { ...old, enabled: s.enabled } : { ...blank(url), enabled: s.enabled });
      }
      state.repos = next.slice(0, MAX_REPOS);
      save();
      void this.refresh();
    },
    /** Reads manifests older than six hours (all of them with `force`). Failures keep the old copy. */
    async refresh(force = false): Promise<void> {
      await Promise.allSettled(
        state.repos.filter((r) => force || !r.manifest || now() - r.fetchedAt > REFRESH_MS).map(load),
      );
    },
    /** A provider's script, from the cache while it is fresh, the stale copy when reading it again fails. */
    async code(url: string): Promise<string> {
      const hit = kv.get<{ at: number; code: string }>(CODE + url);
      if (hit && now() - hit.at < REFRESH_MS) return hit.code;
      try {
        const res = await f(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const code = await res.text();
        if (code.length > MAX_CODE) throw new Error("provider too large");
        kv.set(CODE + url, { at: now(), code });
        return code;
      } catch (err) {
        if (hit) return hit.code;
        throw err;
      }
    },
  };
}

export type PluginStore = ReturnType<typeof createPluginStore>;
