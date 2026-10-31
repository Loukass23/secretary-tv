import { type Debrid, type DebridId, type DeviceCaps, defaultCaps, parseCaps, parseRelease, playsCodec } from "@secretary/core";
import type { EpisodeNumbers, ProviderTarget } from "./ids.ts";
import { inScope, supports } from "./manifest.ts";
import type { Runner } from "./runner.ts";
import type { AppScope, ProviderContext } from "./sandbox.ts";
import type { PluginStore, RepoState } from "./store.ts";

/** What the catalog plays: the same shape the sources sheet always had. */
export interface Stream {
  name: string;
  title: string;
  url: string;
  /** The provider (scraper id) that found it, for the sources sheet's provider tabs. */
  provider?: string;
  /** A message from the provider in a source's place ("configure this addon"): listed, never autoplayed. */
  notice?: boolean;
  /** The provider's binge group: sources of the same release across episodes share it. */
  group?: string;
  /** The file's name, when the provider gives it. */
  file?: string;
  /** What the provider worked out about the release (its `_meta`), when it says: read before the text is. */
  meta?: StreamMeta;
}

/**
 * A provider's `_meta` (nuvio-providers, version 1), checked field by field: a field of the wrong type is left out,
 * the rest kept. Providers that do not send it are read from their text, as always.
 */
export interface StreamMeta {
  /** An exact title and episode match from a trusted source. */
  verified: boolean;
  match?: "exact" | "loose";
  trusted: boolean;
  /** ISO 639 codes, lower case. */
  langs?: { audio: string[]; subs: string[]; multi: boolean };
  /** "2160p", "1080p"… or the number of lines. */
  resolution?: string | number;
  codec?: string;
  /** true, or the format ("hdr10", "hdr10+"). */
  hdr?: boolean | string;
  dv?: boolean;
  audio?: string;
  sizeBytes?: number;
  score?: number;
  group?: string;
}

export interface ProviderStatus {
  repo: string;
  id: string;
  name: string;
  state: "searching" | "ok" | "empty" | "error";
  count: number;
  ms: number;
  error?: string;
}

/** A provider result as Nuvio documents it; everything is optional because providers vary. */
interface RawResult {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  url?: unknown;
  infoHash?: unknown;
  fileIdx?: unknown;
  headers?: unknown;
  behaviorHints?: { bingeGroup?: unknown; filename?: unknown } | null;
  filename?: unknown;
  _meta?: unknown;
}

/** A torrent the debrid services still have to confirm. */
interface Torrent {
  hash: string;
  fileIdx?: number;
  name: string;
  title: string;
  group?: string;
  file?: string;
  meta?: StreamMeta;
}

type Item = ({ stream: Stream } | { torrent: Torrent }) & { key: string; provider?: string };

/** A search so far: what can already be played, and where each provider stands. `done` is the final answer. */
export interface Snapshot {
  streams: Stream[];
  status: ProviderStatus[];
  done: boolean;
}

export interface FindListeners {
  /** Each provider's progress, as soon as it changes. */
  onStatus?: (status: ProviderStatus[]) => void;
  /** The streams found so far, after each provider answers and after each debrid check; last with `done`. */
  onUpdate?: (snapshot: Snapshot) => void;
  /** The app asking: only scrapers whose manifest categories include it run (manifest.ts inScope). */
  scope?: AppScope;
}

/** How long a provider's torrents wait for others' to share one debrid check. */
const CHECK_DEBOUNCE_MS = 150;

/**
 * The playable streams in provider order (providers rank for the device themselves), duplicates dropped by hash or
 * URL, torrents only once a debrid service has them. A codec the TV cannot decode goes last (`caps`, core/caps.ts):
 * AVPlay never leaves prepare for AV1 on the reference TV (docs/lessons.md).
 */
function assemble(found: readonly Item[][], cachedBy: ReadonlyMap<string, DebridId>, caps: DeviceCaps): Stream[] {
  const seen = new Set<string>();
  const streams = found
    .flat()
    .filter((it) => !seen.has(it.key) && seen.add(it.key))
    .flatMap((it): Stream[] => {
      const provider = it.provider ? { provider: it.provider } : {};
      if ("stream" in it) return [{ ...it.stream, ...provider }];
      const svc = cachedBy.get(it.torrent.hash);
      if (!svc) return [];
      const { name, title, hash, fileIdx, group, file, meta } = it.torrent;
      const extra = { ...(group ? { group } : {}), ...(file ? { file } : {}), ...(meta ? { meta } : {}) };
      return [{ name: `⚡ [${svc.toUpperCase()}] ${name}`, title, url: debridUrl(svc, hash, fileIdx), ...extra, ...provider }];
    });
  const plays = (s: Stream) => playsCodec(parseRelease(s.meta?.codec ?? `${s.name} ${s.title}`).codec, caps);
  return [...streams.filter(plays), ...streams.filter((s) => !plays(s))];
}

/**
 * A source outside the plugin repositories (a Stremio addon, catalog-kit/lib/addons.ts): it answers raw results in
 * the provider shape, which then go through the same de-duplication, debrid check and order as a provider's.
 */
export interface ExtraJob {
  id: string;
  name: string;
  repo: string;
  run(ms: number): Promise<unknown[]>;
}

export interface HostOptions {
  store: PluginStore;
  runner: Runner;
  target: (id: string, type: "movie" | "series", hint?: EpisodeNumbers) => Promise<ProviderTarget | null>;
  /** The services with a key, in the user's order; read on every search so Settings changes apply at once. */
  debrid: () => Debrid[];
  tmdbKey?: string;
  /** What providers are told about the TV and the viewer's languages; read on every search, like `debrid`. */
  context?: () => Omit<ProviderContext, "appScope">;
  /** Extra sources for one title, asked with the title's own id and after the providers in the order. */
  extra?: (id: string, type: "movie" | "series") => ExtraJob[];
  perProviderMs?: number;
  roundMs?: number;
  parallel?: number;
  now?: () => number;
}

/** What a real source's text carries: a resolution, a codec or a size. */
const RELEASE_TOKEN = /\b(?:2160p|1080p|720p|576p|480p|4k|uhd|hevc|x26[45]|h\.?26[45]|av1|remux|web-?dl|bluray)\b|\d+(?:[.,]\d+)?\s*(?:GB|MB)\b/i;
/** How a provider's message reads: a short list of our own. */
const MESSAGE =
  /\b(?:donate|donation|support (?:us|the project)|configure|configuration|set ?up|not available|unavailable|no (?:results|streams|sources)|error|failed|expired|invalid|log ?in|sign ?in|subscribe|upgrade|limit reached|rate limited|try again)\b/i;

/**
 * A row that is a message, not a film: no resolution, codec or size anywhere in it, and words that read as a notice.
 * "Error.2023.1080p" names a release, so it is not one.
 */
export function isNotice(name: string, title: string): boolean {
  const text = `${name} ${title}`;
  return !RELEASE_TOKEN.test(text) && MESSAGE.test(text);
}

/** Providers pad names with zero-width characters to steer the official apps' alphabetical sort. */
const INVISIBLE = /[​-‍⁠﻿]/g;
const HASH = /^[0-9a-f]{40}$/i;

/** debrid:<service>:<hash>[/<fileIdx>], resolved to a CDN link only when it is played (catalog-kit/lib/playable.ts). */
export const debridUrl = (svc: DebridId, hash: string, fileIdx?: number) =>
  `debrid:${svc}:${hash}${fileIdx != null ? `/${fileIdx}` : ""}`;

export function toItem(r: RawResult, provider: string): Item | null {
  const url = typeof r.url === "string" ? r.url : typeof (r.url as { url?: unknown })?.url === "string" ? (r.url as { url: string }).url : "";
  // AVPlay cannot send per-stream headers (docs/plugins.md): such a stream would only fail.
  if (r.headers && typeof r.headers === "object" && Object.keys(r.headers).length) return null;
  const name = (typeof r.name === "string" && r.name.trim() ? r.name : provider).replace(INVISIBLE, "").trim();
  const title = String(typeof r.title === "string" ? r.title : typeof r.description === "string" ? r.description : "")
    .replace(INVISIBLE, "")
    .trim();
  // A release's identity across episodes, when the provider says it (Stremio's behaviorHints, or a plain field).
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const group = str(r.behaviorHints?.bingeGroup);
  const file = str(r.behaviorHints?.filename) ?? str(r.filename);
  const meta = readMeta(r._meta);
  const extra = { ...(group ? { group } : {}), ...(file ? { file } : {}), ...(meta ? { meta } : {}) };
  const fromMagnet = /btih:([0-9a-f]{40})/i.exec(url)?.[1];
  const hash = (typeof r.infoHash === "string" && HASH.test(r.infoHash) ? r.infoHash : fromMagnet)?.toLowerCase();
  if (/^https?:\/\//i.test(url)) {
    // A debrid redirector names its torrent in the query; it is the same release as a magnet for that hash.
    const key = hash ?? /[?&]hash=([0-9a-f]{40})/i.exec(url)?.[1]?.toLowerCase() ?? url;
    return { stream: { name, title, url, ...extra, ...(isNotice(name, title) ? { notice: true } : {}) }, key };
  }
  if (!hash) return null;
  const fileIdx = typeof r.fileIdx === "number" ? r.fileIdx : undefined;
  return { torrent: { hash, fileIdx, name, title, ...extra }, key: hash };
}

const LANG = /^[a-z]{2,3}$/;

/** A provider's `_meta` when it is version 1, with only the fields of the documented type; otherwise undefined. */
export function readMeta(raw: unknown): StreamMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  if (m.v !== 1) return undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const codes = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.flatMap((x) => (typeof x === "string" && LANG.test(x.toLowerCase()) ? [x.toLowerCase()] : [])))] : [];
  const l = m.langs && typeof m.langs === "object" ? (m.langs as Record<string, unknown>) : null;
  const fields: Partial<StreamMeta> = {
    match: m.match === "exact" || m.match === "loose" ? m.match : undefined,
    langs: l ? { audio: codes(l.audio), subs: codes(l.subs), multi: l.multi === true } : undefined,
    resolution: str(m.resolution) ?? num(m.resolution),
    codec: str(m.codec)?.toLowerCase(),
    hdr: typeof m.hdr === "boolean" ? m.hdr : str(m.hdr)?.toLowerCase(),
    dv: typeof m.dv === "boolean" ? m.dv : undefined,
    audio: str(m.audio)?.toLowerCase(),
    sizeBytes: num(m.sizeBytes),
    score: num(m.score),
    group: str(m.group),
  };
  const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  return { verified: m.verified === true, trusted: m.trusted === true, ...kept };
}

/**
 * Finds streams for a title the Nuvio way: every enabled provider of every enabled repository, in parallel, each in
 * its own Worker with its own deadline, all within one round. `onUpdate` sees the streams as providers answer, so
 * playback can start before the slowest one; the returned promise is the final answer.
 */
export function createPluginHost({
  store,
  runner,
  target,
  debrid,
  tmdbKey = "",
  context = () => ({}),
  extra = () => [],
  perProviderMs = 20_000,
  roundMs = 30_000,
  parallel = 6,
  now = Date.now,
}: HostOptions) {
  async function find(
    id: string,
    type: "movie" | "series",
    hint?: EpisodeNumbers,
    { onStatus, onUpdate, scope }: FindListeners = {},
  ): Promise<{ streams: Stream[]; status: ProviderStatus[] }> {
    const state = store.get();
    // Providers are asked with the TMDB target; extra sources with the title's own id, even when there is no target.
    type Job = { repo: string; id: string; name: string; run: (ms: () => number) => Promise<unknown[]>; pooled: boolean };
    const jobs: Job[] = [];
    const ctx: ProviderContext = { ...context(), ...(scope ? { appScope: scope } : {}) };
    const caps = ctx.deviceCaps ? parseCaps(ctx.deviceCaps) : defaultCaps;
    if (state.enabled) {
      void store.refresh();
      const t = await target(id, type, hint);
      const anime = t ? /^(kitsu|mal|anilist):/.test(t.tmdbId) : false;
      for (const repo of t ? state.repos : []) {
        if (!repo.enabled || !repo.manifest) continue;
        for (const scraper of repo.manifest.scrapers) {
          if (!store.isScraperOn(repo, scraper.id) || !supports(scraper, t!.mediaType, anime) || !inScope(scraper, scope)) continue;
          jobs.push({
            repo: repo.url,
            id: scraper.id,
            name: scraper.name,
            pooled: true,
            // The deadline is read once the script is in, as the time left in the round.
            run: async (ms) => {
              const code = await store.code(scraper.codeUrl);
              return (await runner({ code, scraperId: scraper.id, tmdbKey, ...t!, context: ctx }, ms())) as unknown[];
            },
          });
        }
      }
    }
    // Addons are a plain HTTP request each: they run at once, outside the Worker pool.
    for (const x of extra(id, type)) jobs.push({ ...x, pooled: false, run: (ms) => x.run(ms()) });
    if (!jobs.length) return { streams: [], status: [] };
    const status: ProviderStatus[] = jobs.map((j) => ({
      repo: j.repo,
      id: j.id,
      name: j.name,
      state: "searching",
      count: 0,
      ms: 0,
    }));
    const found: Item[][] = jobs.map(() => []);
    onStatus?.(status.slice());

    // Torrents are checked with the debrid services as their provider answers, not once at the end, so a partial
    // result can already hold cached torrents. Providers that answer close together share one check.
    const cachedBy = new Map<string, DebridId>();
    const checked = new Set<string>();
    let pending: string[] = [];
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    let checking: Promise<void> = Promise.resolve();
    const snapshot = (done: boolean) => onUpdate?.({ streams: assemble(found, cachedBy, caps), status: status.slice(), done });
    const runCheck = () => {
      checkTimer = undefined;
      const batch = pending;
      pending = [];
      checking = checking.then(async () => {
        for (const [h, svc] of await checkTorrents(batch)) cachedBy.set(h, svc);
        snapshot(false);
      });
    };
    const answered = (i: number) => {
      // A torrent some provider already gave as a playable link needs no check: the link wins the de-duplication.
      const linked = new Set(found.flat().flatMap((it) => ("stream" in it ? [it.key] : [])));
      const fresh = found[i].flatMap((it) =>
        "torrent" in it && !checked.has(it.torrent.hash) && !linked.has(it.key) ? [it.torrent.hash] : [],
      );
      for (const h of fresh) checked.add(h);
      if (!fresh.length) return snapshot(false);
      pending.push(...fresh);
      checkTimer ??= setTimeout(runCheck, CHECK_DEBOUNCE_MS);
    };

    const pooled = jobs.flatMap((j, i) => (j.pooled ? [i] : []));
    let next = 0;
    const started = now();
    const one = async (i: number) => {
      const job = jobs[i];
      const t0 = now();
      try {
        const results = await job.run(() => Math.max(1, Math.min(perProviderMs, roundMs - (now() - started))));
        found[i] = (results as RawResult[]).flatMap((r) => {
          const it = toItem(r, job.name);
          return it ? [{ ...it, provider: job.id }] : [];
        });
        status[i] = { ...status[i], state: found[i].length ? "ok" : "empty", count: found[i].length, ms: now() - t0 };
      } catch (err) {
        status[i] = { ...status[i], state: "error", ms: now() - t0, error: String((err as Error).message ?? err) };
      }
      onStatus?.(status.slice());
      answered(i);
    };
    const work = async () => {
      while (next < pooled.length) await one(pooled[next++]);
    };
    // Whatever has answered when the round ends is used; the rest are already killed by their own deadline.
    let roundTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([
        ...Array.from({ length: Math.min(parallel, pooled.length) }, work),
        ...jobs.flatMap((j, i) => (j.pooled ? [] : [one(i)])),
      ]),
      new Promise((r) => (roundTimer = setTimeout(r, roundMs))),
    ]);
    clearTimeout(roundTimer);
    if (checkTimer) {
      clearTimeout(checkTimer);
      runCheck();
    }
    await checking;
    const streams = assemble(found, cachedBy, caps);
    onUpdate?.({ streams, status: status.slice(), done: true });
    return { streams, status };
  }

  /** The first service, in the user's order, that has each torrent cached. A failing service is skipped. */
  async function checkTorrents(hashes: string[]): Promise<Map<string, DebridId>> {
    const out = new Map<string, DebridId>();
    let left = hashes;
    for (const d of debrid()) {
      if (!left.length) break;
      try {
        const cached = await d.checkCached(left);
        for (const h of left) if (cached.has(h)) out.set(h, d.id);
        left = left.filter((h) => !out.has(h));
      } catch (err) {
        console.warn(`[plugins] ${d.label} cache check failed`, err);
      }
    }
    return out;
  }

  return { find };
}

export type PluginHost = ReturnType<typeof createPluginHost>;
