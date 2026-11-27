// The pause menu over paused video (PlayerView.tsx, lib/pausemenu.ts): the whole screen, with no box. A smoke layer of
// flat stepped bands (no gradient, its own layer) darkens the frame; the title's logo sits large at the top left, and
// what is playing, where it is and the row of buttons at the bottom left. It replaces the old pause card and the bare
// progress bar while Settings › Watching › Pause panel is on. The video is a plane behind the page, so nothing here
// frosts (GlassRoot "flat"), and the buttons show focus by opacity and transform only (tv-kit Button).
import { ButtonRow, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { type PauseAction, timeLeftLabel } from "../lib/pausemenu.ts";
import "./player.css";

const LABEL: Record<PauseAction, string> = {
  play: "Play",
  restart: "Restart",
  next: "Next episode",
  subs: "Subtitles",
  audio: "Audio",
  sources: "Sources",
  picture: "Picture",
};

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** The smoke's bands, top to bottom: a little behind the logo, clear through the middle, darkest under the text. */
const BANDS = [
  { top: 0, h: 380, a: 0.42 },
  { top: 380, h: 140, a: 0.28 },
  { top: 520, h: 120, a: 0.46 },
  { top: 640, h: 120, a: 0.6 },
  { top: 760, h: 320, a: 0.74 },
] as const;

/**
 * The smoke on its own: the player keeps it mounted from the first frame, invisible, and pausing only fades it in, so
 * the full-screen layer is never rasterised at the moment of the pause (measured on the TV: docs/performance.md).
 */
export function PauseSmoke({ on }: { on: boolean }) {
  return (
    <div class={`ply-smoke${on ? " is-on" : ""}`} aria-hidden="true">
      {BANDS.map((b) => (
        <i key={b.top} style={{ top: `${b.top}px`, height: `${b.h}px`, opacity: b.a }} />
      ))}
    </div>
  );
}

export interface PauseMenuProps {
  /** The title's logo once decoded, else its name in the display face. */
  logo?: string | null;
  name: string;
  /** "S1E5 · The Long Night" for an episode. */
  episodeLine?: string;
  /** "2015  ·  ★ 9.0  ·  Crime, Drama" (lib/pausepanel.ts pauseFacts). */
  facts?: string;
  /** "50 min". */
  runtime?: string;
  /** The episode's synopsis, short. */
  synopsis?: string;
  /** "Ends at 21:42" (lib/pausepanel.ts endsAtLabel). */
  endsAt?: string;
  pos: number;
  dur: number;
  actions: readonly PauseAction[];
  /** The focused button. */
  at: number;
  /** What a button says now: the subtitles shown, the picture's fit. */
  values?: Partial<Record<PauseAction, string>>;
  /** The release's badges (4K, HDR, Atmos), small, beside the time. */
  badges?: readonly string[];
  /** Draws its own smoke (the workbench); the player passes false and keeps a PauseSmoke mounted instead. */
  smoke?: boolean;
}

export function PauseMenu({
  logo,
  name,
  episodeLine,
  facts,
  runtime,
  synopsis,
  endsAt,
  pos,
  dur,
  actions,
  at,
  values = {},
  badges = [],
  smoke = true,
}: PauseMenuProps) {
  const pct = dur > 0 ? Math.min(1, pos / dur) : 0;
  const left = timeLeftLabel(pos, dur);
  const line = [facts, runtime].filter(Boolean).join("  ·  ");
  return (
    <GlassRoot mode="flat" class="ply-pause-root">
      {smoke && <PauseSmoke on />}
      <div class="ply-pf-top">
        <span class="ply-state">Paused</span>
        {logo ? <img class="ply-pause-logo" src={logo} alt={name} /> : <h1 class="ply-pm-name">{name}</h1>}
      </div>
      <div class="ply-pf-info">
        {episodeLine && <span class="ply-pf-ep">{episodeLine}</span>}
        {line && <span class="ply-pf-facts">{line}</span>}
        {synopsis && <p class="ply-pf-plot">{synopsis}</p>}
        <span class="ply-bar">
          <i style={{ transform: `scaleX(${pct})` }} />
        </span>
        <div class="ply-pm-time">
          <span>
            {clock(pos)} / {clock(dur)}
          </span>
          {left && <b>{left}</b>}
          {endsAt && <span>{endsAt}</span>}
          {badges.map((b) => (
            <span key={b} class="ply-badge">
              {b}
            </span>
          ))}
        </div>
        <ButtonRow
          items={actions.map((a) => ({
            id: a,
            label: values[a] ? `${LABEL[a]} · ${values[a]}` : LABEL[a],
            primary: a === "play",
          }))}
          focusIndex={at}
        />
      </div>
    </GlassRoot>
  );
}
