import type { StreamMeta } from "@secretary/plugins";
import type { FileHint } from "./episodes.ts";

export interface Stream {
  name: string;
  title: string;
  url: string;
  /** The plugin provider (scraper id) that found it; absent for the server's streams. */
  provider?: string;
  /** A provider's message in a source's place (packages/plugins isNotice): shown in the sheet, never autoplayed. */
  notice?: boolean;
  /** The provider's binge group: the same release across episodes shares it (the source memory follows it). */
  group?: string;
  /** The file's name, when the provider gives it. */
  file?: string;
  /** What the provider worked out about the release (packages/plugins readMeta), read before the text. */
  meta?: StreamMeta;
}

/** Streams so far for one title; `done` once the search is over (the list then never changes). */
export type StreamWatcher = (streams: Stream[], done: boolean) => void;

export interface StreamClient {
  get(id: string, hint?: FileHint, overrideType?: "movie" | "series"): Promise<Stream[]>;
  /** Like get, with partial results while providers are still answering. Returns a function that stops watching. */
  watch(id: string, hint: FileHint | undefined, overrideType: "movie" | "series" | undefined, cb: StreamWatcher): () => void;
  warm(url: string): Promise<void>;
}

export interface ParsedStreamInfo {
  resolution: "4K" | "1080p" | "720p" | "SD";
  hdr?: "DV" | "HDR10+" | "HDR10";
  codec?: "HEVC" | "AVC" | "AV1";
  audio?: "ATMOS" | "TRUEHD" | "DDP 5.1" | "5.1" | "AAC";
  container?: "MP4" | "MKV";
  size?: string;
  badges: string[];
  cleanTitle: string;
}

const resolutionOf = (text: string): ParsedStreamInfo["resolution"] | undefined =>
  /\b(2160p|4k|uhd)\b/i.test(text) ? "4K" : /\b1080p\b/i.test(text) ? "1080p" : /\b720p\b/i.test(text) ? "720p" : undefined;
const hdrOf = (text: string): ParsedStreamInfo["hdr"] =>
  /\b(dovi|dolby\s*vision|dv)\b/i.test(text) ? "DV" : /hdr10\+/i.test(text) ? "HDR10+" : /\bhdr(?:10)?\b/i.test(text) ? "HDR10" : undefined;
const codecOf = (text: string): ParsedStreamInfo["codec"] =>
  /\b(hevc|x265|h\.?265)\b/i.test(text) ? "HEVC" : /\bav1\b/i.test(text) ? "AV1" : /\b(avc|x264|h\.?264)\b/i.test(text) ? "AVC" : undefined;
const audioOf = (text: string): ParsedStreamInfo["audio"] =>
  /\batmos\b/i.test(text)
    ? "ATMOS"
    : /\btruehd\b/i.test(text)
      ? "TRUEHD"
      : /\b(ddp|eac3|dd\+)\b/i.test(text)
        ? "DDP 5.1"
        : /\b(5\.1|ac3|dd5\.1)\b/i.test(text)
          ? "5.1"
          : /\baac\b/i.test(text)
            ? "AAC"
            : undefined;

/** "12.3 GB" from a byte count, as the providers' text writes it. */
const sizeOf = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

/** The HDR format from `_meta`: Dolby Vision first, as the text reading does; `hdr: true` is HDR10. */
function metaHdr(m: StreamMeta): ParsedStreamInfo["hdr"] | null {
  if (m.dv) return "DV";
  if (m.hdr === true) return "HDR10";
  if (typeof m.hdr === "string") return hdrOf(m.hdr) ?? "HDR10";
  return m.hdr === false ? null : undefined;
}

/**
 * Extracts structured technical badges and file size from a Stremio or debrid stream's
 * `name` and `title`, for the detail page's "Will play" line and the sources sheet.
 * A provider's `_meta` (stream.meta) wins field by field; what it leaves out is read from the text.
 */
export function parseStreamInfo(stream: Stream): ParsedStreamInfo {
  const combined = `${stream.name ?? ""} ${stream.title ?? ""}`;
  const m = stream.meta;

  // `_meta` may give the resolution as 2160 or as "2160p".
  const metaRes = m?.resolution != null ? String(m.resolution).replace(/^(\d+)$/, "$1p") : "";
  const resolution: ParsedStreamInfo["resolution"] = resolutionOf(metaRes) ?? resolutionOf(combined) ?? "SD";
  const fromMeta = m ? metaHdr(m) : undefined;
  const hdr: ParsedStreamInfo["hdr"] = fromMeta === null ? undefined : (fromMeta ?? hdrOf(combined));
  const codec = (m?.codec ? codecOf(m.codec) : undefined) ?? codecOf(combined);
  const audio = (m?.audio ? audioOf(m.audio) : undefined) ?? audioOf(combined);

  let container: ParsedStreamInfo["container"];
  if (/\.mp4\b|\bmp4\b/i.test(combined)) container = "MP4";
  else if (/\.mkv\b|\bmkv\b/i.test(combined)) container = "MKV";

  const sizeMatch = combined.match(/(\d+(?:[.,]\d+)?\s*(?:GB|MB))/i);
  const size = m?.sizeBytes ? sizeOf(m.sizeBytes) : sizeMatch ? sizeMatch[1].replace(",", ".").toUpperCase() : undefined;

  const badges: string[] = [resolution];
  if (hdr) badges.push(hdr);
  if (codec) badges.push(codec);
  if (audio) badges.push(audio);
  if (container === "MP4") badges.push("MP4");

  const firstLine = (stream.title || stream.name || "Cached Stream")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0] ?? "Cached Stream";

  return {
    resolution,
    hdr,
    codec,
    audio,
    container,
    size,
    badges,
    cleanTitle: firstLine,
  };
}

const TTL_MS = 4 * 60_000;

/** Adds the episode numbers to a resolve URL as ?s=&e=&a=, which the server uses to pick a file from a batch. */
export function withHint(url: string, hint: FileHint): string {
  const params = [["s", hint.season], ["e", hint.episode], ["a", hint.absolute]]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  if (!params) return url;
  return url + (url.includes("?") ? "&" : "?") + params;
}

/**
 * Talks to packages/server. `id` is a title id ("tt123") or an episode id
 * ("tt123:1:2"). Results are cached per id and shared between callers in
 * flight, so a dwell on Home, the detail page and the Play press make one
 * request between them.
 */
export function createStreamClient(
  base: string,
  defaultType: "movie" | "series",
  f: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const cache = new Map<string, { at: number; p: Promise<Stream[]> }>();

  function get(id: string, hint?: FileHint, overrideType?: "movie" | "series"): Promise<Stream[]> {
    const type = overrideType ?? defaultType;
    const key = hint
      ? `${type}:${id}|${hint.season ?? ""}|${hint.episode ?? ""}|${hint.absolute ?? ""}`
      : `${type}:${id}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.p;
    const p = (async () => {
      const res = await f(`${base}/stream/${type}/${encodeURIComponent(id)}.json`);
      if (!res.ok) throw new Error(`server ${res.status}`);
      const { streams = [] } = (await res.json()) as { streams?: Stream[] };
      return hint ? streams.map((s) => ({ ...s, url: withHint(s.url, hint) })) : streams;
    })();
    cache.set(key, { at: now(), p });
    p.catch(() => cache.delete(key));
    return p;
  }

  /** Makes the server resolve the CDN link now, so the player's open() is fast. Never throws. */
  async function warm(url: string): Promise<void> {
    try {
      await f(url, { redirect: "manual" });
    } catch {
      // Best effort.
    }
  }

  return { get, warm, watch: watchByGet(get) };
}

/** watch() for a client that only has whole answers: the final list, once. */
function watchByGet(get: StreamClient["get"]): StreamClient["watch"] {
  return (id, hint, type, cb) => {
    let live = true;
    get(id, hint, type).then(
      (s) => live && cb(s, true),
      () => live && cb([], true),
    );
    return () => void (live = false);
  };
}

/** What the plugin host answers (packages/plugins); passed in so this file stays free of the Worker build. */
export type FindStreams = (
  id: string,
  type: "movie" | "series",
  hint: FileHint | undefined,
  onPartial: (streams: Stream[]) => void,
) => Promise<{ streams: Stream[] }>;

/**
 * Streams from Nuvio plugins on the TV, with the server client's shape so the detail page, autoplay and
 * prefetch work unchanged. Plugin torrents (debrid:…) carry the episode numbers for the file choice; links from
 * a provider are used as they are. `fallback` answers while no plugin repository is set up, and when the plugins
 * find nothing.
 */
export function createPluginStreamClient(
  find: FindStreams,
  active: () => boolean,
  fallback: StreamClient,
  playable: (url: string) => Promise<string>,
  defaultType: "movie" | "series",
  now: () => number = Date.now,
  /** How long the fallback may take: a server that is down must not leave a search, and a pending Play, open. */
  fallbackMs = 8000,
): StreamClient {
  const fallbackWithin = (id: string, hint: FileHint | undefined, type: "movie" | "series" | undefined) =>
    new Promise<Stream[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), fallbackMs);
      fallback.get(id, hint, type).then(
        (s) => (clearTimeout(timer), resolve(s)),
        () => (clearTimeout(timer), resolve([])),
      );
    });
  // One search per title and episode, shared by every caller; `partial` is the latest snapshot while it runs.
  type Entry = { at: number; p: Promise<Stream[]>; partial: Stream[]; done: boolean; watchers: Set<StreamWatcher> };
  const cache = new Map<string, Entry>();
  const keyOf = (type: string, id: string, hint?: FileHint) =>
    `${type}:${id}|${hint?.season ?? ""}|${hint?.episode ?? ""}|${hint?.absolute ?? ""}`;
  // Plugin torrents carry the episode numbers, for the file choice when they are resolved.
  const withHints = (streams: Stream[], hint?: FileHint) =>
    hint ? streams.map((s) => (s.url.startsWith("debrid:") ? { ...s, url: withHint(s.url, hint) } : s)) : streams;

  function search(id: string, hint: FileHint | undefined, overrideType: "movie" | "series" | undefined): Entry {
    const type = overrideType ?? defaultType;
    const key = keyOf(type, id, hint);
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit;
    const entry: Entry = { at: now(), p: Promise.resolve([]), partial: [], done: false, watchers: new Set() };
    entry.p = find(id, type, hint, (streams) => {
      entry.partial = withHints(streams, hint);
      for (const w of entry.watchers) w(entry.partial, false);
    }).then(({ streams }) =>
      streams.length
        ? withHints(streams, hint)
        : // Nothing from the plugins: a server with an addon, when the build has one, may still know the title.
          fallbackWithin(id, hint, overrideType),
    );
    // A partial list is never kept as the answer: only the final one is cached.
    cache.set(key, entry);
    entry.p.then(
      () => void (entry.done = true),
      () => cache.delete(key),
    );
    return entry;
  }

  function get(id: string, hint?: FileHint, overrideType?: "movie" | "series"): Promise<Stream[]> {
    if (!active()) return fallback.get(id, hint, overrideType);
    return search(id, hint, overrideType).p;
  }

  function watch(
    id: string,
    hint: FileHint | undefined,
    overrideType: "movie" | "series" | undefined,
    cb: StreamWatcher,
  ): () => void {
    if (!active()) return fallback.watch(id, hint, overrideType, cb);
    const entry = search(id, hint, overrideType);
    let live = true;
    const w: StreamWatcher = (s, done) => {
      if (live) cb(s, done);
    };
    entry.watchers.add(w);
    if (entry.partial.length && !entry.done) w(entry.partial, false);
    void entry.p.then(
      (s) => w(s, true),
      () => w([], true),
    );
    return () => {
      live = false;
      entry.watchers.delete(w);
    };
  }

  /** Resolves a debrid link now, or asks a provider's redirector to, so the player's open() is fast. Never throws. */
  async function warm(url: string): Promise<void> {
    try {
      if (url.startsWith("debrid:")) await playable(url);
      else await fetch(url, { redirect: "manual" });
    } catch {
      // Best effort.
    }
  }

  return { get, warm, watch };
}
