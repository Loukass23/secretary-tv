import { keyName } from "@secretary/tv-kit";
import { Glass, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { type DashboardSettings, SETTING_ITEMS, type SettingItemDef } from "../lib/settings.ts";

/** What the player is showing, for the control centre's "Now playing" line; set by ui/PlayerView.tsx. */
export interface NowPlaying {
  title: string;
  badges: string[];
}

let nowPlaying: NowPlaying | null = null;
const listeners = new Set<() => void>();
export function setNowPlaying(next: NowPlaying | null): void {
  nowPlaying = next;
  for (const l of listeners) l();
}

/** The Playback settings the control centre offers as shortcuts; the rest stay in Settings. */
const SHORTCUTS = [
  "playback.startAfter",
  "playback.rememberSource",
  "playback.autoSkip",
  "playback.pausePanel",
  "playback.upNextCountdown",
];
const ITEMS: SettingItemDef[] = SHORTCUTS.flatMap((id) => SETTING_ITEMS.filter((i) => i.id === id));

const W = 620;
const ROW_H = 74;
const HEAD_H = 170;

/**
 * Holding CH+ opens it (app.tsx): the time, what is playing, and the Playback settings as shortcuts. It takes every key
 * while open: Up and Down move, OK, Left and Right change the setting, Back or a short CH+ closes. Smoked glass with no
 * frost, so it works the same over the video. It grows down from the top by transform.
 */
export function ControlCentre({
  open,
  settings,
  clock,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: DashboardSettings;
  clock: string;
  onChange(next: DashboardSettings): void;
  onClose(): void;
}) {
  const [row, setRow] = useState(0);
  const rowRef = useRef(0);
  rowRef.current = row;
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  // Each opening starts on the first row; a setting changed from here keeps the row.
  useEffect(() => {
    if (open) setRow(0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Before every view's own keys (capture), so nothing behind it moves while it is open.
    const onKey = (e: KeyboardEvent) => {
      const name = keyName(e);
      if (!name || name === "ChannelUp") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (name === "Back") return onClose();
      if (name === "Up") setRow((r) => Math.max(0, r - 1));
      else if (name === "Down") setRow((r) => Math.min(ITEMS.length - 1, r + 1));
      else if (name === "Enter" || name === "Right" || name === "Left") {
        onChange(ITEMS[rowRef.current].cycle(settings, name === "Left" ? -1 : 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, settings]);

  const h = HEAD_H + ITEMS.length * ROW_H + 20;
  return (
    <GlassRoot mode="flat" class="cc-root">
      <Glass x={1920 - 80 - W} y={40} w={W} h={h} frost={false} class={`cc${open ? " is-open" : ""}`}>
        <div class="cc-head">
          <span class="cc-clock">{clock}</span>
          <span class="cc-now">
            {nowPlaying ? (
              <>
                <b>Now playing</b> {nowPlaying.title}
                {nowPlaying.badges.length ? ` · ${nowPlaying.badges.join(" · ")}` : ""}
              </>
            ) : (
              <b>Control centre · Back closes</b>
            )}
          </span>
        </div>
        {ITEMS.map((item, i) => (
          <div key={item.id} class={`cc-row${open && i === row ? " is-focus" : ""}`} style={{ top: `${HEAD_H + i * ROW_H}px` }}>
            <span>{item.label}</span>
            <span class="cc-val">{item.getValue(settings)}</span>
          </div>
        ))}
      </Glass>
    </GlassRoot>
  );
}
