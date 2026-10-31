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

/** What the panel says: the episode line, the facts line and the synopsis (the episode's when it has one). */
export function pauseFacts(title: Title, episode?: Video): { episodeLine: string; facts: string; synopsis: string } {
  const episodeLine = episode
    ? `${episode.season === 0 ? `Special ${episode.episode}` : `S${episode.season}E${episode.episode}`}${episode.name ? ` · ${episode.name}` : ""}`
    : "";
  const facts = [title.year, title.runtime, title.rating && `IMDb ${title.rating}`].filter(Boolean).join("  ·  ");
  return { episodeLine, facts, synopsis: episode?.overview || title.description || "" };
}
