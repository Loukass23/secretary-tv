// The buttons of Secretary's one header (tv-kit Header), shared by the home screen and the search screen so both draw
// the same header. nest-nav.ts numbers them; HEADER_ORDER is their order on screen, left to right.
import type { HeaderButton, IconName } from "@secretary/tv-kit/src/glass/index.ts";
import { HEADER_BELL, HEADER_LIGHTS, HEADER_PARTY, HEADER_PICTURE, HEADER_SEARCH, HEADER_SETTINGS, HEADER_SOUND } from "./nest-nav.ts";

export const HEADER_ORDER = [HEADER_PARTY, HEADER_SEARCH, HEADER_LIGHTS, HEADER_PICTURE, HEADER_SOUND, HEADER_SETTINGS, HEADER_BELL];

/** The picture button shows the mode the TV is on: a sun for Dynamic, a moon for Eco, a screen for anything else. */
function pictureIcon(mode: string | undefined): IconName {
  const m = (mode ?? "").toLowerCase();
  return m.startsWith("dynamic") ? "clear" : m.startsWith("eco") ? "clear-night" : "partly";
}

export interface HeaderState {
  pictureMode?: string;
  soundOn?: boolean;
  /** Open reminders, for the bell's count. */
  open: number;
}

export function headerButtons({ pictureMode, soundOn, open }: HeaderState): HeaderButton[] {
  return (["party", "search", "lights", pictureIcon(pictureMode), soundOn === false ? "hifi-off" : "hifi", "settings", "bell"] as const satisfies readonly IconName[]).map((icon, k) => ({
    key: String(k),
    icon,
    badge: k === 6 ? open : undefined,
  }));
}
