import type { AniListClient } from "./client.ts";

export interface Viewer {
  id: number;
  name: string;
  avatar?: string;
}

export interface AniListStats {
  name?: string;
  avatar?: string;
  /** Anime on the list, episodes and minutes watched. */
  titles: number;
  episodes: number;
  minutes: number;
}

const VIEWER = `query { Viewer { id name avatar { medium } statistics { anime { count episodesWatched minutesWatched } } } }`;

interface ViewerAnswer {
  Viewer?: {
    id?: number;
    name?: string;
    avatar?: { medium?: string };
    statistics?: { anime?: { count?: number; episodesWatched?: number; minutesWatched?: number } };
  };
}

/** Who the token belongs to; `token` checks a pasted token before it is kept. */
export async function viewer(c: AniListClient, token?: string): Promise<Viewer> {
  const v = (await c.query<ViewerAnswer>(VIEWER, {}, token)).Viewer;
  if (!v?.id) throw new Error("AniList gave no viewer");
  return { id: v.id, name: v.name ?? "", avatar: v.avatar?.medium };
}

export function statsFrom(a: ViewerAnswer): AniListStats {
  const s = a.Viewer?.statistics?.anime;
  const n = (x?: number) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { name: a.Viewer?.name, avatar: a.Viewer?.avatar?.medium, titles: n(s?.count), episodes: n(s?.episodesWatched), minutes: n(s?.minutesWatched) };
}

export const stats = async (c: AniListClient): Promise<AniListStats> => statsFrom(await c.query<ViewerAnswer>(VIEWER));

export type ListStatus = "CURRENT" | "COMPLETED" | "PLANNING" | "DROPPED" | "PAUSED" | "REPEATING";

const ENTRY = `query ($id: Int) { Media(id: $id, type: ANIME) { id episodes mediaListEntry { progress status } } }`;
const SAVE = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) { id progress status }
}`;

/** What to write for an episode watched to the end, or null when the list already has it. Pure. */
export function nextEntry(
  watchedEpisode: number | null,
  current: { progress?: number | null; status?: ListStatus | null } | null,
  episodes: number | null,
): { progress?: number; status: ListStatus } | null {
  if (current?.status === "COMPLETED") return null;
  // A film, or a whole title marked watched: completed.
  if (watchedEpisode == null) return { status: "COMPLETED", ...(episodes ? { progress: episodes } : {}) };
  const progress = current?.progress ?? 0;
  if (watchedEpisode <= progress) return null;
  return { progress: watchedEpisode, status: episodes && watchedEpisode >= episodes ? "COMPLETED" : "CURRENT" };
}

/** Records an episode (or, without one, the whole title) as watched; progress only ever moves forward. */
export async function recordWatched(c: AniListClient, mediaId: number, episode: number | null): Promise<boolean> {
  const m = (await c.query<{ Media?: { episodes?: number | null; mediaListEntry?: { progress?: number; status?: ListStatus } | null } }>(ENTRY, { id: mediaId })).Media;
  const next = nextEntry(episode, m?.mediaListEntry ?? null, m?.episodes ?? null);
  if (!next) return false;
  await c.query(SAVE, { mediaId, ...next });
  return true;
}

const LISTS = `query ($userId: Int) {
  MediaListCollection(userId: $userId, type: ANIME) { lists { entries { progress status media { id episodes } } } }
}`;

export interface ListEntry {
  mediaId: number;
  progress: number;
  status: ListStatus;
  episodes: number | null;
}

/** Every anime on the viewer's lists that has been started or finished. */
export async function watchedEntries(c: AniListClient, userId: number): Promise<ListEntry[]> {
  const a = await c.query<{ MediaListCollection?: { lists?: { entries?: { progress?: number; status?: ListStatus; media?: { id?: number; episodes?: number | null } }[] }[] } }>(LISTS, { userId });
  const out: ListEntry[] = [];
  for (const l of a.MediaListCollection?.lists ?? []) {
    for (const e of l.entries ?? []) {
      if (!e.media?.id || !e.status) continue;
      if (e.status === "PLANNING") continue;
      if (!(e.progress ?? 0) && e.status !== "COMPLETED") continue;
      out.push({ mediaId: e.media.id, progress: e.progress ?? 0, status: e.status, episodes: e.media.episodes ?? null });
    }
  }
  return out;
}
