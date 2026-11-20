// The YouTube home card: what is popular now, as three thumbnails, read from the YouTube Data API with a key of the
// viewer's own (NEST_YOUTUBE_API_KEY in .env.tizen). OK on one opens it in the TV's YouTube app; without a key the card
// is a plain way into the app. Pure apart from the store and fetch it is handed, so it is unit tested.

export const YOUTUBE_KEY = "nest.youtube";
/** How long a pull is good for. */
export const YOUTUBE_TTL_MS = 60 * 60 * 1000;
/** A card shows this many videos. */
export const CARD_VIDEOS = 3;

export interface Video {
  id: string;
  title: string;
  channel: string;
  thumb: string;
}

interface ApiItem {
  id?: unknown;
  snippet?: { title?: unknown; channelTitle?: unknown; thumbnails?: Record<string, { url?: unknown } | undefined> };
}

/** The videos of a `videos.list` reply; items without an id, a title or a picture are dropped. */
export function parseVideos(body: unknown): Video[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: Video[] = [];
  for (const raw of items as ApiItem[]) {
    const t = raw?.snippet?.thumbnails;
    const thumb = [t?.maxres, t?.standard, t?.high, t?.medium, t?.default].map((x) => x?.url).find((u): u is string => typeof u === "string" && u !== "");
    if (typeof raw?.id !== "string" || !raw.id || typeof raw.snippet?.title !== "string" || !thumb) continue;
    out.push({ id: raw.id, title: raw.snippet.title, channel: typeof raw.snippet.channelTitle === "string" ? raw.snippet.channelTitle : "", thumb });
  }
  return out;
}

/** "GB" from "en-GB"; the API needs a region for its most-popular chart. */
export const regionOf = (language: string | undefined): string => /^[a-z]{2,3}-([A-Za-z]{2})$/.exec(language ?? "")?.[1].toUpperCase() ?? "US";

export const popularUrl = (key: string, region: string, count = CARD_VIDEOS): string =>
  `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&maxResults=${count}&regionCode=${region}&key=${encodeURIComponent(key)}`;

interface Cached {
  at: number;
  videos: Video[];
}

export function loadVideos(store: { getItem(k: string): string | null }, now = Date.now()): { videos: Video[]; fresh: boolean } {
  try {
    const c = JSON.parse(store.getItem(YOUTUBE_KEY) ?? "null") as Cached | null;
    return c && Array.isArray(c.videos) ? { videos: c.videos, fresh: now - c.at < YOUTUBE_TTL_MS } : { videos: [], fresh: false };
  } catch {
    return { videos: [], fresh: false };
  }
}

/** Pulls the popular videos and keeps them; a failed pull keeps the last copy (returned as is). */
export async function refreshVideos(
  store: { getItem(k: string): string | null; setItem(k: string, v: string): void },
  key: string,
  region: string,
  f: typeof fetch = fetch,
  now = Date.now(),
): Promise<Video[]> {
  const have = loadVideos(store, now);
  if (!key || have.fresh) return have.videos;
  try {
    const res = await f(popularUrl(key, region));
    if (!res.ok) return have.videos;
    const videos = parseVideos(await res.json());
    if (!videos.length) return have.videos;
    store.setItem(YOUTUBE_KEY, JSON.stringify({ at: now, videos } satisfies Cached));
    return videos;
  } catch {
    return have.videos;
  }
}

/** The address a video opens at in the YouTube app. */
export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
