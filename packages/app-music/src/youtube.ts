// YouTube Data API v3 for browsing (docs/music.md): trending music, search, playlists. Parsing is pure and tested;
// the fetches cache in localStorage because a search costs 100 of the key's 10,000 daily units.

export interface Track {
  /** YouTube video id. */
  id: string;
  title: string;
  artist: string;
  /** 16:9 thumbnail for tiles. */
  thumb: string;
  /** The largest thumbnail, for the now-playing card. */
  cover: string;
  /** 0 when unknown. */
  durSec: number;
}

export interface Playlist {
  id: string;
  title: string;
  channel: string;
  thumb: string;
  count?: number;
}

const API = "https://www.googleapis.com/youtube/v3";

type Thumbs = Partial<Record<"default" | "medium" | "high" | "standard" | "maxres", { url?: string }>>;
interface Snippet {
  title?: string;
  channelTitle?: string;
  videoOwnerChannelTitle?: string;
  thumbnails?: Thumbs;
  resourceId?: { videoId?: string };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#039": "'" };

/** search.list returns titles HTML-escaped ("Rock &amp; Roll"); videos.list does not. */
export const unescapeHtml = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#0?39|#x([0-9a-f]+)|#(\d+));/gi, (m, name: string, hex?: string, dec?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[name.toLowerCase()] ?? m,
  );

/** ISO 8601 durations as YouTube sends them ("PT3M12S", "PT1H2M", "P1DT2S"); 0 for anything else. */
export function parseDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

export const formatTime = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

/** "Adele - Topic", "AdeleVEVO", "Adele Official" → "Adele". */
export const cleanChannel = (c: string): string =>
  c
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .replace(/\s+(?:official|music)(?:\s+(?:channel|music))?$/i, "")
    .trim();

// Bracketed noise in music video titles: "(Official Music Video)", "[4K]", "(Lyrics)", "(Visualizer)".
const NOISE = /\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|4k|mv|remaster(?:ed)?|music)\b[^)\]]*)[)\]]/gi;

/**
 * Splits a video title into song and artist. "Artist - Song (Official Video)" gives both; otherwise the song is the
 * title and the artist the channel, cleaned of " - Topic" and "VEVO".
 */
export function splitTitle(raw: string, channel: string): { title: string; artist: string } {
  const text = unescapeHtml(raw).replace(NOISE, "").replace(/\s{2,}/g, " ").trim();
  const dash = /\s+[-–—|]\s+/.exec(text);
  if (dash && dash.index > 0) {
    const artist = text.slice(0, dash.index).trim();
    const title = text.slice(dash.index + dash[0].length).trim();
    if (artist && title) return { title, artist };
  }
  return { title: text || unescapeHtml(raw), artist: cleanChannel(unescapeHtml(channel)) };
}

const pick = (t: Thumbs | undefined, order: (keyof Thumbs)[]): string | undefined => {
  for (const k of order) if (t?.[k]?.url) return t[k]!.url;
  return undefined;
};

function toTrack(id: string, sn: Snippet, durSec = 0): Track {
  const { title, artist } = splitTitle(sn.title ?? "", sn.videoOwnerChannelTitle ?? sn.channelTitle ?? "");
  return {
    id,
    title,
    artist,
    thumb: pick(sn.thumbnails, ["medium", "high", "default"]) ?? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    cover: pick(sn.thumbnails, ["maxres", "standard", "high", "medium"]) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    durSec,
  };
}

interface VideoItem {
  id?: string;
  snippet?: Snippet;
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
}

/** videos.list: drops what cannot be embedded (status.embeddable false) and live streams with no duration. */
export function parseVideos(json: unknown): Track[] {
  const items = (json as { items?: VideoItem[] })?.items ?? [];
  return items.flatMap((v) => {
    if (!v.id || !v.snippet || v.status?.embeddable === false) return [];
    const dur = parseDuration(v.contentDetails?.duration);
    if (v.contentDetails && dur === 0) return [];
    return [toTrack(v.id, v.snippet, dur)];
  });
}

interface SearchItem {
  id?: { kind?: string; videoId?: string; playlistId?: string };
  snippet?: Snippet;
}

/** search.list for type=video: tracks without durations (fillDurations adds them). */
export function parseSearchVideos(json: unknown): Track[] {
  const items = (json as { items?: SearchItem[] })?.items ?? [];
  return items.flatMap((it) => (it.id?.videoId && it.snippet ? [toTrack(it.id.videoId, it.snippet)] : []));
}

/** search.list for type=playlist. */
export function parseSearchPlaylists(json: unknown): Playlist[] {
  const items = (json as { items?: SearchItem[] })?.items ?? [];
  return items.flatMap((it) =>
    it.id?.playlistId && it.snippet
      ? [
          {
            id: it.id.playlistId,
            title: unescapeHtml(it.snippet.title ?? ""),
            channel: cleanChannel(unescapeHtml(it.snippet.channelTitle ?? "")),
            thumb: pick(it.snippet.thumbnails, ["medium", "high", "default"]) ?? "",
          },
        ]
      : [],
  );
}

const GONE = /^(?:deleted|private) video$/i;

/** playlistItems.list: the videos in order, without deleted and private ones. */
export function parsePlaylistItems(json: unknown): Track[] {
  const items = (json as { items?: { snippet?: Snippet; status?: { privacyStatus?: string } }[] })?.items ?? [];
  return items.flatMap((it) => {
    const sn = it.snippet;
    const id = sn?.resourceId?.videoId;
    if (!sn || !id || GONE.test(sn.title ?? "") || it.status?.privacyStatus === "private") return [];
    return [toTrack(id, sn)];
  });
}

/** videos.list with part=contentDetails,status: the duration of every video that can be embedded and is not live. */
export function parseDetails(json: unknown): Map<string, number> {
  const items = (json as { items?: VideoItem[] })?.items ?? [];
  const out = new Map<string, number>();
  for (const v of items) {
    const dur = parseDuration(v.contentDetails?.duration);
    if (v.id && v.status?.embeddable !== false && dur > 0) out.set(v.id, dur);
  }
  return out;
}

/** Keeps `tracks` in order with their durations, dropping the ones `details` left out. */
export const mergeDetails = (tracks: readonly Track[], details: Map<string, number>): Track[] =>
  tracks.flatMap((t) => (details.has(t.id) ? [{ ...t, durSec: details.get(t.id)! }] : []));

/** An API error body ({ error: { message, errors: [{ reason }] } }) as one line. */
export function apiError(json: unknown, status: number): string {
  const e = (json as { error?: { message?: string; errors?: { reason?: string }[] } })?.error;
  const reason = e?.errors?.[0]?.reason;
  if (reason === "quotaExceeded") return "The YouTube key has used up today's quota.";
  if (reason === "keyInvalid" || status === 400) return "The YouTube key was refused.";
  return e?.message ? unescapeHtml(e.message) : `YouTube answered ${status}.`;
}

export interface Cache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/** localStorage with a time to live per entry; memory when the TV refuses storage. */
export function storageCache(prefix = "music.cache.", now = () => Date.now()): Cache {
  const mem = new Map<string, string>();
  const read = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return mem.get(k) ?? null;
    }
  };
  const write = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      mem.set(k, v);
    }
  };
  return {
    get(key) {
      const raw = read(prefix + key);
      if (!raw) return undefined;
      try {
        const { exp, value } = JSON.parse(raw) as { exp: number; value: unknown };
        return exp > now() ? value : undefined;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      const ttl = key.startsWith("trending") ? 3600_000 : 12 * 3600_000;
      write(prefix + key, JSON.stringify({ exp: now() + ttl, value }));
    },
  };
}

export interface YouTube {
  trending(region: string): Promise<Track[]>;
  searchTracks(q: string): Promise<Track[]>;
  searchPlaylists(q: string): Promise<Playlist[]>;
  playlistTracks(id: string): Promise<Track[]>;
}

export function createYouTube(key: string, cache: Cache, f: typeof fetch = fetch): YouTube {
  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams({ ...params, key }).toString();
    const res = await f(`${API}/${path}?${qs}`);
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(apiError(json, res.status));
    return json;
  }
  async function cached<T>(id: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(id) as T | undefined;
    if (hit !== undefined) return hit;
    const value = await load();
    cache.set(id, value);
    return value;
  }
  const details = async (tracks: Track[]) =>
    tracks.length
      ? mergeDetails(tracks, parseDetails(await get("videos", { part: "contentDetails,status", id: tracks.map((t) => t.id).join(",") })))
      : tracks;

  return {
    trending: (region) =>
      cached(`trending:${region}`, async () =>
        parseVideos(
          await get("videos", {
            part: "snippet,contentDetails,status",
            chart: "mostPopular",
            videoCategoryId: "10",
            regionCode: region,
            maxResults: "30",
          }),
        ),
      ),
    searchTracks: (q) =>
      cached(`tracks:${q.toLowerCase()}`, async () =>
        details(
          parseSearchVideos(
            await get("search", {
              part: "snippet",
              type: "video",
              videoCategoryId: "10",
              videoEmbeddable: "true",
              maxResults: "25",
              q,
            }),
          ),
        ),
      ),
    searchPlaylists: (q) =>
      cached(`playlists:${q.toLowerCase()}`, async () =>
        parseSearchPlaylists(await get("search", { part: "snippet", type: "playlist", maxResults: "15", q })),
      ),
    playlistTracks: (id) =>
      cached(`playlist:${id}`, async () =>
        details(parsePlaylistItems(await get("playlistItems", { part: "snippet,status", playlistId: id, maxResults: "50" }))),
      ),
  };
}

/** The country for trending charts: "de-DE" → "DE"; "US" when the language names none. */
export const regionOf = (lang: string | undefined): string => /[-_]([A-Za-z]{2})\b/.exec(lang ?? "")?.[1]?.toUpperCase() ?? "US";
