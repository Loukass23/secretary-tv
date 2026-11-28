import { ratingLabel } from "./cinemeta.ts";
import type { Title, Video } from "./types.ts";

/**
 * The pause panel: paused and left alone for 4 s, the screen says what is playing. Any key counts as activity and
 * restarts the wait, so pausing to change the volume or seek never brings it up.
 */
export const PAUSE_PANEL_MS = 4000;

export function pausePanelShown({
  enabled,
  playing,
  pausedAt,
  lastKeyAt,
  now,
}: {
  enabled: boolean;
  playing: boolean;
  /** When playback paused; null while playing. */
  pausedAt: number | null;
  lastKeyAt: number;
  now: number;
}): boolean {
  if (!enabled || playing || pausedAt == null) return false;
  return now - Math.max(pausedAt, lastKeyAt) >= PAUSE_PANEL_MS;
}

/** The IMDb-id artwork service's logo for a title; anime (Kitsu ids) has none and shows its name. */
export const logoUrl = (id: string) =>
  /^tt\d+$/.test(id) ? `https://images.metahub.space/logo/medium/${id}/img` : null;

/** The synopsis on the pause screen: whole sentences up to about `max` characters, else cut at a word with "…". */
export function shortSynopsis(text: string, max = 240): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  if (out.trim().length >= max / 2) return out.trim();
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,;:.-]+$/, "")}…`;
}

/** "Ends at 21:42" (or "9:42 PM"): when the rest of it ends if play resumes now; nothing without a duration. */
export function endsAtLabel(pos: number, dur: number, now: Date, hour12 = false): string {
  if (!(dur > 0)) return "";
  const end = new Date(now.getTime() + Math.max(0, dur - pos) * 1000);
  const h = end.getHours();
  const mm = String(end.getMinutes()).padStart(2, "0");
  return `Ends at ${hour12 ? `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}` : `${String(h).padStart(2, "0")}:${mm}`}`;
}

/** "47 min", "1 h 52 min": the file's own length, for titles whose details give none. */
const runtimeOf = (dur: number) => {
  const min = Math.round(dur / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

export interface PauseFacts {
  /** "S1E2 · Mijo", or nothing for a film. */
  episodeLine: string;
  /** "2015  ·  ★ 9.0  ·  Crime, Drama": year, rating and up to three genres. */
  facts: string;
  /** The episode's synopsis when it has one, else the title's, shortened (shortSynopsis). */
  synopsis: string;
  /** The title's runtime, else the file's length once known. */
  runtime: string;
}

/** What the pause screen says about what is playing (ui/PauseMenu.tsx). */
export function pauseFacts(title: Title, episode?: Video, dur = 0): PauseFacts {
  const episodeLine = episode
    ? `${episode.season === 0 ? `Special ${episode.episode}` : `S${episode.season}E${episode.episode}`}${episode.name ? ` · ${episode.name}` : ""}`
    : "";
  const genres = (title.genre ?? []).slice(0, 3).join(", ");
  const facts = [title.year, ratingLabel(title.rating), genres].filter(Boolean).join("  ·  ");
  // A show's runtime is per episode in its details; the file's length is the truth for this one.
  const runtime = episode && dur > 0 ? runtimeOf(dur) : title.runtime || (dur > 0 ? runtimeOf(dur) : "");
  return { episodeLine, facts, synopsis: shortSynopsis(episode?.overview || title.description || ""), runtime };
}
