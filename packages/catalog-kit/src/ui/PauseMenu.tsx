// The pause menu over paused video (PlayerView.tsx, lib/pausemenu.ts): what is playing, where it is, and a row of
// buttons. It replaces the old pause card and the bare progress bar while Settings › Watching › Pause panel is on.
// The video is a plane behind the page, so this is flat smoked glass with no frost (GlassRoot "flat"), and the buttons
// show focus by opacity and transform only (tv-kit Button).
import { ButtonRow, Glass, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { type PauseAction, timeLeftLabel } from "../lib/pausemenu.ts";
import "./player.css";

const LABEL: Record<PauseAction, string> = {
  play: "Play",
  restart: "Restart",
  next: "Next episode",
  subs: "Subtitles",
  audio: "Audio",
  picture: "Picture",
};

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export interface PauseMenuProps {
  /** The title's logo once decoded, else its name in the display face. */
  logo?: string | null;
  name: string;
  /** "S1E5 · The Long Night" for an episode. */
  episodeLine?: string;
  pos: number;
  dur: number;
  actions: readonly PauseAction[];
  /** The focused button. */
  at: number;
  /** What a button says now: the subtitles shown, the picture's fit. */
  values?: Partial<Record<PauseAction, string>>;
  /** The release's badges (4K, HDR, Atmos), small, beside the time. */
  badges?: readonly string[];
}

export function PauseMenu({ logo, name, episodeLine, pos, dur, actions, at, values = {}, badges = [] }: PauseMenuProps) {
  const pct = dur > 0 ? Math.min(1, pos / dur) : 0;
  const left = timeLeftLabel(pos, dur);
  return (
    <GlassRoot mode="flat" class="ply-pause-root">
      <Glass x={80} y={600} w={1760} h={420} class="ply-pm">
        <span class="ply-state">Paused</span>
        {logo ? <img class="ply-pause-logo" src={logo} alt={name} /> : <h1 class="ply-pm-name">{name}</h1>}
        {episodeLine && <span class="ply-title">{episodeLine}</span>}
        <span class="ply-bar">
          <i style={{ transform: `scaleX(${pct})` }} />
        </span>
        <div class="ply-pm-time">
          <span>
            {clock(pos)} / {clock(dur)}
          </span>
          {left && <b>{left}</b>}
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
      </Glass>
    </GlassRoot>
  );
}
