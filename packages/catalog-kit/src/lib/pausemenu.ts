// The pause menu (ui/PauseMenu.tsx): what paused playback offers, in the order the buttons run. Pure, so it is tested.
import { pausePanelShown } from "./pausepanel.ts";

export type PauseAction = "play" | "restart" | "next" | "subs" | "audio" | "picture";

export interface PauseOffer {
  /** The episode after this one, when there is one. */
  next: boolean;
  /** The player can switch the picture's fit (AVPlay). */
  picture: boolean;
}

/** The buttons: Play, Restart, Next episode (a show with one after), Subtitles, Audio, Picture (where it can change). */
export function pauseActions(o: PauseOffer): PauseAction[] {
  return ["play", "restart", ...(o.next ? (["next"] as const) : []), "subs", "audio", ...(o.picture ? (["picture"] as const) : [])];
}

/** "42 min left", "1 h 5 min left", or nothing without a duration. */
export function timeLeftLabel(pos: number, dur: number): string {
  if (!(dur > 0)) return "";
  const min = Math.max(0, Math.round((dur - pos) / 60));
  if (min < 1) return "Less than a minute left";
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
}

/**
 * Whether the pause menu shows: paused after playback started, with Settings › Watching › Pause panel on, and not
 * watching together (the room decides). It shows at once; the panel's old 4 s wait is for the info card only.
 */
export const pauseMenuShown = (s: { enabled: boolean; started: boolean; playing: boolean; together: boolean }) =>
  s.enabled && s.started && !s.playing && !s.together;

/** One key in the row: the new focus, or the action OK runs. */
export function stepPause(at: number, count: number, key: string): { at: number } | { run: number } | null {
  if (key === "Left") return { at: Math.max(0, at - 1) };
  if (key === "Right") return { at: Math.min(count - 1, at + 1) };
  if (key === "Enter") return { run: at };
  return null;
}

export { pausePanelShown };
