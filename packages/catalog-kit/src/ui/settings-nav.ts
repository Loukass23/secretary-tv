// Moving around Settings (HubOverlay.tsx): Secretary's header on top, the category tabs under it, then the current
// category's lines. Plain data, so it is tested without a DOM.
import { type HeaderAt, headerStart, stepHeader } from "@secretary/tv-kit/src/glass/header-nav.ts";

export type SettingsFocus = { area: "head"; at: HeaderAt } | { area: "tabs" } | { area: "list"; i: number };

export interface SettingsPlace {
  focus: SettingsFocus;
  /** The category shown (its tab is picked). */
  tab: number;
}

export interface SettingsShape {
  tabs: number;
  /** Lines in the category shown. */
  rows: number;
  /** Secretary's header, when the host lends it: whether it has a person, and its buttons. */
  header?: { person: boolean; buttons: number } | null;
}

/** Settings open on the tabs, so Left and Right go through the categories at once. */
export const SETTINGS_START: SettingsPlace = { focus: { area: "tabs" }, tab: 0 };

/**
 * One arrow key or Back. Left and Right on the tabs show the next category; Down goes into its lines, Up from the first
 * line back to the tabs, and Up from the tabs into the header. "close" is Back anywhere but the header; `place` is
 * returned unchanged for keys this does not move on (OK, Left and Right on a line: the line's own).
 */
export function stepSettings(place: SettingsPlace, key: string, shape: SettingsShape): SettingsPlace | "close" {
  const { focus, tab } = place;
  if (focus.area === "head") {
    const r = stepHeader(focus.at, key, Boolean(shape.header?.person), shape.header?.buttons ?? 0);
    if (r === "leave") return { focus: { area: "tabs" }, tab };
    return r === focus.at ? place : { focus: { area: "head", at: r }, tab };
  }
  if (key === "Back") return "close";
  if (focus.area === "tabs") {
    if (key === "Left" || key === "Right") {
      const next = Math.max(0, Math.min(shape.tabs - 1, tab + (key === "Right" ? 1 : -1)));
      return next === tab ? place : { focus, tab: next };
    }
    if (key === "Down") return shape.rows > 0 ? { focus: { area: "list", i: 0 }, tab } : place;
    if (key === "Up") {
      const at = shape.header ? headerStart(shape.header.person, shape.header.buttons) : null;
      return at == null ? place : { focus: { area: "head", at }, tab };
    }
    return place;
  }
  if (key === "Up") return focus.i === 0 ? { focus: { area: "tabs" }, tab } : { focus: { area: "list", i: focus.i - 1 }, tab };
  if (key === "Down") return focus.i + 1 < shape.rows ? { focus: { area: "list", i: focus.i + 1 }, tab } : place;
  return place;
}

/** The lines drawn around the focused one (long categories, such as Apps or Sources, never draw them all). */
export function rowWindow(focused: number, rows: number, before = 3, after = 6): { from: number; to: number } {
  const from = Math.max(0, focused - before);
  return { from, to: Math.min(rows, from + before + after + 1) };
}
