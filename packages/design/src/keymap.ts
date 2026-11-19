// The desktop keyboard as the TV remote. Each key is re-sent as the keyCode the TV sends, so tv-kit's own
// paths (installBackAdapter's Back debounce, use-keys.ts names) run exactly as on the TV. Arrows, Enter,
// Escape, PageUp/PageDown, F3-F6 and "/" already have names in use-keys.ts and pass through.
import { BACK_KEYCODE } from "@secretary/tv-kit/src/keys.ts";

export interface RemoteKey {
  /** The desktop key (KeyboardEvent.key). */
  key: string;
  /** What the TV sends for it. */
  keyCode: number;
  /** The remote button's name, for the on-screen remote and docs. */
  label: string;
}

export const REMOTE_KEYS: readonly RemoteKey[] = [
  { key: "Backspace", keyCode: BACK_KEYCODE, label: "Back" },
  { key: "1", keyCode: 403, label: "Red" },
  { key: "2", keyCode: 404, label: "Green" },
  { key: "3", keyCode: 405, label: "Yellow" },
  { key: "4", keyCode: 406, label: "Blue" },
  { key: " ", keyCode: 10252, label: "Play/Pause" },
  { key: "[", keyCode: 428, label: "CH-" },
  { key: "]", keyCode: 427, label: "CH+" },
  { key: "i", keyCode: 457, label: "Info" },
];

/** Keys that already reach the views unchanged, for the on-screen remote. */
export const PASS_KEYS: readonly RemoteKey[] = [
  { key: "ArrowUp", keyCode: 38, label: "Up" },
  { key: "ArrowDown", keyCode: 40, label: "Down" },
  { key: "ArrowLeft", keyCode: 37, label: "Left" },
  { key: "ArrowRight", keyCode: 39, label: "Right" },
  { key: "Enter", keyCode: 13, label: "OK" },
];

const BY_KEY = new Map(REMOTE_KEYS.map((k) => [k.key, k.keyCode]));

/** The TV keyCode a desktop key stands for, or null when it passes through as it is. */
export function desktopKeyCode(key: string): number | null {
  return BY_KEY.get(key) ?? null;
}
