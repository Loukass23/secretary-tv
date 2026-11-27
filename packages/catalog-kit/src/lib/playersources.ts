// The sources sheet inside the player (ui/PlayerSources.tsx), opened by the pause menu's Sources: the title page's sheet
// (ui/sheet.ts) over the paused video, where OK reopens the player on another source at the same second. Pure, so the
// keys and the new source order are tested.
import type { Stream } from "./streams.ts";

/** Where the remote is: a source in the list, or a filter chip above it (`chip` set). */
export interface SheetNav {
  /** The focused source, among the sheet's focusable rows. */
  row: number;
  /** The focused chip, or null while the list has focus. */
  chip: number | null;
}

export const SHEET_START: SheetNav = { row: 0, chip: null };

export type SheetStep =
  | { nav: SheetNav }
  | { pick: number }
  | { toggle: number }
  | { showAll: true }
  | { close: true };

/**
 * One key in the sheet. The list: Up and Down move (Up from the first source goes to the chips), OK picks. The chips:
 * Left and Right move, OK turns one on or off, Down goes back to the list. Back closes from anywhere; OK on an empty
 * list (everything hidden by the chips) shows all again.
 */
export function stepSheet(nav: SheetNav, key: string, size: { rows: number; chips: number }): SheetStep | null {
  if (key === "Back") return { close: true };
  if (nav.chip != null) {
    if (key === "Left" || key === "Right") {
      const chip = Math.max(0, Math.min(size.chips - 1, nav.chip + (key === "Left" ? -1 : 1)));
      return { nav: { ...nav, chip } };
    }
    if (key === "Down") return { nav: { ...nav, chip: null } };
    if (key === "Enter") return { toggle: nav.chip };
    return null;
  }
  if (key === "Up") return nav.row === 0 || !size.rows ? (size.chips ? { nav: { ...nav, chip: 0 } } : null) : { nav: { ...nav, row: nav.row - 1 } };
  if (key === "Down") return { nav: { ...nav, row: Math.min(Math.max(0, size.rows - 1), nav.row + 1) } };
  if (key === "Enter") return size.rows ? { pick: nav.row } : { showAll: true };
  return null;
}

/** The list the player reopens with: the pick first, then the others in their order, so failover still has them. */
export const switchedStreams = (picked: Stream, all: readonly Stream[]): Stream[] => [
  picked,
  ...all.filter((s) => s !== picked && s.url !== picked.url),
];
