// What a title page's panel says (ui/Detail.tsx), kept apart from the screen so the rules are tested: on a show, the
// panel follows the focused episode; with spoiler protection on, an unwatched episode's still and synopsis are blurred
// (Blur) or left out (Hide).
import { episodeLabel, hasAired } from "./episodes.ts";
import type { SpoilerMode } from "./settings.ts";
import type { Title, Video } from "./types.ts";

/** `season:episode`, as lib/resume.ts keys watched episodes. */
const keyOf = (v: Pick<Video, "season" | "episode">) => `${v.season}:${v.episode}`;

export interface SpoilerState {
  /** Settings › Watching "Spoiler protection" (lib/settings.ts `spoilerProtection`). */
  mode: SpoilerMode;
  /** Episodes watched to the end, `season:episode` (lib/resume.ts `watchedEpisodes`). */
  watched: ReadonlySet<string>;
  /** The episode in progress (Resume): started, so not a spoiler any more. */
  resumeId?: string;
  /** The whole show is marked watched. */
  titleWatched?: boolean;
}

/**
 * An episode counts as unwatched, and so is protected, when spoiler protection is on and it is neither watched to the
 * end, nor the one in progress, nor part of a show marked watched as a whole. Unaired episodes count as unwatched.
 */
export function isSpoiler(v: Pick<Video, "id" | "season" | "episode">, s: SpoilerState): boolean {
  return s.mode !== "off" && !s.titleWatched && v.id !== s.resumeId && !s.watched.has(keyOf(v));
}

/** How an episode's still and synopsis show: as they are, blurred, or not at all (its number and title only). */
export type EpisodeLook = "clear" | "blur" | "hide";

export function episodeLook(v: Pick<Video, "id" | "season" | "episode">, s: SpoilerState): EpisodeLook {
  return isSpoiler(v, s) ? (s.mode as Exclude<SpoilerMode, "off">) : "clear";
}

/** "S1 · E3", or "Special 2": an episode's place, on its tile and over the panel. */
export const episodeTag = (v: Pick<Video, "season" | "episode">) => episodeLabel(v).replace(/^S(\d+)E(\d+)$/, "S$1 · E$2");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aired 12 Mar 2024", or "Airs 3 Dec 2026" for an episode still to come; nothing without a date. */
export function airLine(v: Pick<Video, "released">, now = Date.now()): string | undefined {
  const t = v.released ? Date.parse(v.released) : NaN;
  if (Number.isNaN(t)) return undefined;
  const d = new Date(t);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${hasAired(v as Video, now) ? "Aired" : "Airs"} ${date}`;
}

export interface PanelText {
  title: string;
  /** The line under the title, in parts joined with " · ". */
  meta: string[];
  about?: string;
  /** The synopsis is the show's, because the episode has none. */
  aboutIsShow: boolean;
  /** The synopsis is protected (the episode's own, of an unwatched episode): shown blurred, or left out with Hide. */
  hidden: boolean;
}

/**
 * The panel of a show's page for `ep` (the focused episode, else the one Play would start): the episode's own title,
 * line and synopsis, falling back to the show's synopsis when the episode has none. Without an episode, the show's.
 * Only the episode's own synopsis is ever hidden: the show's says nothing an episode would spoil.
 */
export function episodePanel(show: Pick<Title, "name" | "description" | "runtime">, ep: Video | undefined, spoilers?: SpoilerState, now = Date.now()): PanelText {
  if (!ep) return { title: show.name, meta: [], about: show.description, aboutIsShow: true, hidden: false };
  const own = ep.overview?.trim();
  const air = airLine(ep, now);
  return {
    title: ep.name,
    meta: [episodeTag(ep), show.runtime ?? "", air ?? ""].filter(Boolean),
    about: own || show.description,
    aboutIsShow: !own,
    hidden: Boolean(own) && !!spoilers && isSpoiler(ep, spoilers),
  };
}

/** How many seasons a show has: specials (season 0) are not a season. */
export const seasonCount = (videos: readonly Pick<Video, "season">[]): number => new Set(videos.map((v) => v.season).filter((s) => s > 0)).size;

/** "1 season", "3 seasons", for a show's kicker; empty when it has none (specials only, or no episodes yet). */
export function seasonsLabel(videos: readonly Pick<Video, "season">[]): string {
  const n = seasonCount(videos);
  return n ? `${n} season${n === 1 ? "" : "s"}` : "";
}

/** A film's people for its page: "Director" and "Starring" lines, the first few names each; empty when unknown. */
export function creditLines(t: Pick<Title, "cast" | "director">, maxCast = 5): { label: string; names: string }[] {
  const out: { label: string; names: string }[] = [];
  if (t.director?.length) out.push({ label: t.director.length > 1 ? "Directors" : "Director", names: t.director.slice(0, 2).join(", ") });
  if (t.cast?.length) out.push({ label: "Starring", names: t.cast.slice(0, maxCast).join(", ") });
  return out;
}
