import { useEffect, useRef } from "preact/hooks";
import { isTvImeOpen } from "./keys.ts";

export type KeyHandler = (key: string, e: KeyboardEvent) => boolean | void;

const NAMES: Record<number, string> = {
  13: "Enter",
  27: "Back",
  37: "Left",
  38: "Up",
  39: "Right",
  40: "Down",
  412: "Rewind",
  413: "Stop",
  415: "Play",
  417: "FastForward",
  19: "Pause",
  10252: "PlayPause",
  // The CH+/CH- rocker, Search and the colour keys (tizen.tvinputdevice names and codes).
  427: "ChannelUp",
  428: "ChannelDown",
  10225: "SearchVoice",
  405: "Search",
  403: "Red",
  404: "Green",
  406: "Blue",
  457: "Info",
  // Desktop convenience aliases (F3 = CH+, F4 = CH-, F5 = Search, F6 = Voice Search, PageUp/PageDown)
  114: "ChannelUp",
  115: "ChannelDown",
  116: "Search",
  117: "SearchVoice",
  33: "ChannelUp",
  34: "ChannelDown",
  191: "Search",
};

const KEY_STR_MAP: Record<string, string> = {
  MediaPlayPause: "PlayPause",
  ChannelUp: "ChannelUp",
  ChannelDown: "ChannelDown",
  F3: "ChannelUp",
  F4: "ChannelDown",
  F5: "Search",
  F6: "SearchVoice",
  "/": "Search",
  PageUp: "ChannelUp",
  PageDown: "ChannelDown",
  ColorF0Red: "Red",
  ColorF1Green: "Green",
  ColorF2Yellow: "Search",
  ColorF3Blue: "Blue",
  Info: "Info",
  Search: "SearchVoice",
};

/** Maps a keydown to a name the views use; null for keys nobody handles. */
export function keyName(e: Pick<KeyboardEvent, "keyCode" | "key">): string | null {
  return NAMES[e.keyCode] ?? (e.key ? KEY_STR_MAP[e.key] ?? null : null);
}

/** Calls `handler` for remote keys while `active`. Returning true (or any non-false) consumes the key. */
export function useKeys(active: boolean, handler: KeyHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTvImeOpen()) return;
      const name = keyName(e);
      if (!name) return;
      if (ref.current(name, e) !== false) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
