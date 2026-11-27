// What Secretary lends the catalog screens it hosts, beyond EmbeddedHost's basics (app.tsx).
import type { HeaderAt, HeaderButton, HeaderPerson } from "@secretary/tv-kit/src/glass/index.ts";

/**
 * Secretary's one header (tv-kit `Header`), for the catalog screens to draw as theirs: a title page shows it collapsed
 * to the clock and expands it when Up leaves the top of the page. Secretary keeps it current (the clock, the picture
 * and sound icons, the reminder count) and acts on OK; the screen owns `expanded` and the focus.
 */
export interface HostHeader {
  time: string;
  person?: HeaderPerson;
  /** Left to right, as on Secretary's home. */
  buttons: readonly HeaderButton[];
  /** OK on the person or a button. Most leave the catalog for Secretary (search, settings, lights...). */
  press(at: HeaderAt): void;
}

/** An app the TV has, as Settings › Apps lists it for the Apps card (Secretary's `visibleApps`, without its own places). */
export interface HostApp {
  id: string;
  name: string;
  /** A line under the name, e.g. that it has a card of its own. */
  note?: string;
}

/** One line of a category Secretary adds to Settings: shown and previewed like Settings' own. */
export interface HostSettingRow {
  key: string;
  title: string;
  /** What it does, in one short line. */
  sub: string;
  /** Its current value. */
  value: string;
  /** A switch that is on: its dot lit. */
  on?: boolean;
  /** What the preview beside the list shows for this line; without it, the line's text. */
  preview?: import("preact").ComponentChildren;
  /** OK, Left or Right on the line. Settings draws the lines again after it, so `rows()` gives the new state. */
  act?(key: "Enter" | "Left" | "Right"): void;
}

/** A category Secretary adds to Settings (SmartThings): read each time Settings draws, so it shows the TV's state now. */
export interface HostSettingsTab {
  name: string;
  /** The line under "Settings" while the category is shown. */
  blurb: string;
  rows(): readonly HostSettingRow[];
  /** Calls `redraw` when the rows change on their own (a sign-in finishing on the phone); returns the unsubscribe. */
  subscribe?(redraw: () => void): () => void;
}

/** Whether this TV build has keys for voice input (`listen`) and spoken replies (`speak`), shown in Settings › Home screen. */
export interface HostVoice {
  listen: boolean;
  speak: boolean;
}
