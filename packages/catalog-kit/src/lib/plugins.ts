import { type DebridId, debridServices } from "@secretary/core";
import {
  createIdMapper,
  createPluginHost,
  createPluginStore,
  type ProviderStatus,
  type Runner,
  workerRunner,
} from "@secretary/plugins";
import { readJson, writeJson } from "@secretary/tv-kit";
import PluginWorker from "@secretary/plugins/src/worker.ts?worker&inline";
import { createAddonClient, createAddonStore, hasResource } from "./addons.ts";
import { type RawMeta, setAddonMeta } from "./cinemeta.ts";
import { deviceCaps } from "./device.ts";
import { createPlayable } from "./playable.ts";
import { langPref, loadSettings } from "./settings.ts";
import { checkSource } from "./verify.ts";

// Streams come from Nuvio plugin repositories run on the TV (docs/plugins.md). A build can carry its owner's
// repository and debrid keys from the gitignored env; Settings › Sources changes them on the TV.
declare const __PLUGIN_REPOS__: string | undefined;
declare const __TORBOX_API_KEY__: string | undefined;
declare const __PM_API_KEY__: string | undefined;
declare const __TMDB_API_KEY__: string | undefined;

const built = (v: string | undefined) => (typeof v === "string" ? v : "");

export interface DebridSettings {
  keys: Partial<Record<DebridId, string>>;
  /** Which service is asked first; a torrent plays from the first one that has it. */
  order: DebridId[];
  /** Check TorBox sources before their turn too (it adds them to the account, so off by default; lib/verify.ts). */
  torboxAhead?: boolean;
}

const DEBRID_KEY = "sectv.debrid";

export function loadDebrid(): DebridSettings {
  const saved = readJson<DebridSettings>(DEBRID_KEY);
  return {
    keys: {
      tb: saved?.keys.tb ?? built(typeof __TORBOX_API_KEY__ !== "undefined" ? __TORBOX_API_KEY__ : ""),
      pm: saved?.keys.pm ?? built(typeof __PM_API_KEY__ !== "undefined" ? __PM_API_KEY__ : ""),
    },
    order: saved?.order?.length ? saved.order : ["tb", "pm"],
    torboxAhead: saved?.torboxAhead ?? false,
  };
}

export function saveDebrid(next: DebridSettings): DebridSettings {
  writeJson(DEBRID_KEY, next);
  return next;
}

export const debrids = () => {
  const d = loadDebrid();
  return debridServices(d.keys, d.order);
};

const defaults = built(typeof __PLUGIN_REPOS__ !== "undefined" ? __PLUGIN_REPOS__ : "")
  .split(/[\s,]+/)
  .filter(Boolean);

export const pluginStore = createPluginStore({ kv: { get: readJson, set: writeJson }, defaults });

/** Stremio addons installed on this TV (lib/addons.ts, docs/addons.md): streams, subtitles, meta, catalogs. */
export const addonStore = createAddonStore({ kv: { get: readJson, set: writeJson } });
export const addons = createAddonClient(addonStore);
// Addon meta first in fetchMeta, Cinemeta/Kitsu after; anime metas are "anime" or "series" depending on the addon.
setAddonMeta((type, id) => addons.meta<RawMeta>(type === "anime" ? ["anime", "series"] : [type], id));

/** Workers where the platform has them; the tests and a desktop preview without them run providers inline. */
const runner: Runner = workerRunner(() => new PluginWorker());

const hostOptions = {
  runner,
  target: createIdMapper({ tmdbKey: built(typeof __TMDB_API_KEY__ !== "undefined" ? __TMDB_API_KEY__ : "") }),
  debrid: debrids,
  tmdbKey: built(typeof __TMDB_API_KEY__ !== "undefined" ? __TMDB_API_KEY__ : ""),
  // Read on every search, so a language changed in Settings applies to the next one.
  context: () => ({ deviceProfile: "tv" as const, deviceCaps: deviceCaps(), langPref: langPref(loadSettings().playback) }),
};

export const pluginHost = createPluginHost({ ...hostOptions, store: pluginStore, extra: (id, type) => addons.streamJobs(type, id) });

/**
 * For the CDP scripts: a host over one repository kept in memory, to try a repository on the TV without adding it to
 * the saved list, which is synced with the Nuvio profile. Same runner, debrid services, caps and languages.
 */
async function trial(manifest: string) {
  const mem = new Map<string, unknown>();
  const store = createPluginStore({ kv: { get: (k) => (mem.get(k) ?? null) as never, set: (k, v) => void mem.set(k, v) }, defaults: [manifest] });
  await store.refresh();
  return createPluginHost({ ...hostOptions, store });
}

/** Stream URL to what AVPlay opens: plugin torrents are resolved on the debrid service here, once per link. */
export const playable = createPlayable(debrids);

/** True when searching should go to plugins or installed addons rather than the server's single addon. */
export const pluginsActive = () => {
  const s = pluginStore.get();
  return (s.enabled && s.repos.some((r) => r.enabled)) || addonStore.active().some((a) => hasResource(a.manifest!, "stream"));
};

// The latest search's per-plugin progress, for the detail page's status line.
let lastStatus: ProviderStatus[] = [];
const statusListeners = new Set<(s: ProviderStatus[]) => void>();

export function publishStatus(s: ProviderStatus[]): void {
  lastStatus = s;
  for (const l of statusListeners) l(s);
}

export function onPluginStatus(fn: (s: ProviderStatus[]) => void): () => void {
  statusListeners.add(fn);
  fn(lastStatus);
  return () => void statusListeners.delete(fn);
}

/** "Example Provider (Source A + Source B)" to "Example Provider": what the provider is, without its sources. */
export const shortName = (p: Pick<ProviderStatus, "name">) => p.name.replace(/\s*\(.*\)\s*/g, "").trim() || p.name;

/** "Alpha 12 · Beta searching · Gamma failed" */
export function statusLine(s: readonly ProviderStatus[]): string {
  return s
    .map((p) =>
      p.state === "searching" ? `${shortName(p)} searching` : p.state === "error" ? `${shortName(p)} failed` : `${shortName(p)} ${p.count}`,
    )
    .join(" · ");
}

// Debug handle for the CDP scripts, next to the player's (ui/PlayerView.tsx).
const dbg = globalThis as unknown as { __sectv?: Record<string, unknown> };
dbg.__sectv ??= {};
dbg.__sectv.plugins = { host: pluginHost, store: pluginStore, addons: addonStore, playable, debrid: loadDebrid, check: (url: string) => checkSource(url, playable), device: deviceCaps, trial };
