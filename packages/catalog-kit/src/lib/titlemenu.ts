// The context menu on the detail page (a long OK on an action or an episode): what it offers for what has focus. Pure,
// so it is unit tested; ui/Detail.tsx runs the chosen line through the same code the buttons use.

export type TitleAction = "play" | "restart" | "sources" | "timeline" | "watched" | "mylist";

export interface MenuLine {
  id: TitleAction;
  label: string;
}

export interface TitleMenuState {
  /** A series: the lines speak of the focused episode. */
  series: boolean;
  /** The focused episode's label ("S1 · E3"), when an episode has focus. */
  episode?: string;
  /** There is saved progress for what Play would start. */
  hasProgress: boolean;
  watched: boolean;
  saved: boolean;
  /** The title is in a saga (a timeline to open). */
  saga: boolean;
}

export function titleMenu(s: TitleMenuState): MenuLine[] {
  const what = s.episode ? ` ${s.episode}` : "";
  const lines: MenuLine[] = [{ id: "play", label: `▶ ${s.hasProgress ? "Resume" : "Play"}${what}` }];
  if (s.hasProgress) lines.push({ id: "restart", label: `↺ Start over${what}` });
  lines.push({ id: "sources", label: `☰ Choose a source${what}` });
  if (s.saga) lines.push({ id: "timeline", label: "❖ Open the timeline" });
  lines.push({ id: "watched", label: s.watched ? "☐ Mark not watched" : "✓ Mark watched" });
  lines.push({ id: "mylist", label: s.saved ? "− Remove from My List" : "＋ Add to My List" });
  return lines;
}

/** One key in the menu: the new line, "run" on OK, "close" on Back. */
export function stepTitleMenu(at: number, count: number, key: string): number | "run" | "close" {
  if (key === "Enter") return "run";
  if (key === "Back") return "close";
  if (key === "Up") return Math.max(0, at - 1);
  if (key === "Down") return Math.min(count - 1, at + 1);
  return at;
}
