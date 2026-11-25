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
