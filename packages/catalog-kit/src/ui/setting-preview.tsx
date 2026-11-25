// What a setting does, beside Settings' list (HubOverlay.tsx): a small live mock of its effect, its one line, and its
// values with the one set lit. Plain DOM and flat fills only, no images: the mocks cost a few nodes each and move only
// by transform and opacity (hub.css), and nothing moves under Reduce motion (`data-sg-motion="reduced"`).
import { TEXT_SIZES, type TextSize, TYPE_STYLES, type TypeStyle } from "@secretary/tv-kit/src/glass/tokens.ts";
import type { ComponentChildren, JSX } from "preact";
import { ACCENT_THEMES, type DashboardSettings, type SpoilerMode } from "../lib/settings.ts";

export interface PreviewLine {
  /** The setting's id (lib/settings.ts SETTING_ITEMS), or a line of Sources, Apps or Advanced. */
  key: string;
  title: string;
  /** What it does, in one short line. */
  sub: string;
  /** Its current value. */
  value: string;
  on?: boolean;
  choices?: { items: readonly string[]; at: number };
}

const SHOW = "The Quiet Harbour";

/** The faces of one type style, on this element only: its tokens as `--sg-*` custom properties. */
function typeVars(style: TypeStyle): JSX.CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(TYPE_STYLES[style].tokens)) out[`--sg-${k}`] = v;
  return out as JSX.CSSProperties;
}

/** A title's caption as the screens set it: kicker, name, numbers and a button, in the faces of the page or of `style`. */
function Caption({ style, size }: { style?: TypeStyle; size?: TextSize }) {
  // A text size is shown at its own scale, beside the other one, so its sizes are set here rather than by the page.
  const f = size ? TEXT_SIZES[size].factor : 0;
  const px = (n: number) => (f ? { fontSize: `${Math.round(n * f)}px` } : undefined);
  return (
    <div class="set-cap" style={style ? typeVars(style) : undefined}>
      <span class="set-cap-kicker" style={px(21)}>Drama · Show</span>
      <b class="set-cap-title" style={px(38)}>{SHOW}</b>
      <span class="set-cap-num" style={px(24)}>8.4 · 2019 · 3 seasons</span>
      <span class="set-cap-btn" style={px(24)}>Play</span>
    </div>
  );
}

/** A 16:9 still drawn in flat shapes: sky, sun and hill. */
function Still({ tone }: { tone: number }) {
  return (
    <i class={`set-still set-tone-${tone}`}>
      <i class="set-still-sun" />
      <i class="set-still-hill" />
    </i>
  );
}

/** An episode tile as a show's page draws it under spoiler protection (lib/titlepage.ts episodeLook). */
function Episode({ n, name, look, tone }: { n: number; name: string; look: "clear" | "blur" | "hide"; tone: number }) {
  return (
    <div class={`set-ep is-${look}`}>
      {look === "hide" ? <i class="set-still set-still-none">{n}</i> : look === "blur" ? <i class={`set-still set-still-soft set-tone-${tone}`} /> : <Still tone={tone} />}
      <b>
        E{n} · {name}
      </b>
      {look === "clear" && <small>A storm keeps the ferry in port for the night.</small>}
      {look === "blur" && (
        <small class="set-ep-bars">
          <i />
          <i />
        </small>
      )}
    </div>
  );
}

/** A player frame, for the settings that act while a title plays. */
function Player({ children }: { children?: ComponentChildren }) {
  return (
    <div class="set-player">
      <Still tone={2} />
      {children}
    </div>
  );
}

function Stage({ line, s }: { line: PreviewLine; s: DashboardSettings }) {
  const g = s.general;
  switch (line.key) {
    case "general.typeStyle":
      return (
        <div class="set-cols">
          {(Object.keys(TYPE_STYLES) as TypeStyle[]).map((t) => (
            <div key={t} class={`set-col${t === g.typeStyle ? " is-on" : ""}`}>
              <Caption style={t} />
              <em>{TYPE_STYLES[t].label}</em>
            </div>
          ))}
        </div>
      );
    case "general.textSize":
      return (
        <div class="set-cols">
          {(Object.keys(TEXT_SIZES) as TextSize[]).map((t) => (
            <div key={t} class={`set-col${t === g.textSize ? " is-on" : ""}`}>
              <Caption size={t} />
              <em>{TEXT_SIZES[t].label}</em>
            </div>
          ))}
        </div>
      );
    case "general.reduceMotion":
      // A row of cards with focus walking along it: each pushes in as focus reaches it, unless motion is reduced.
      return (
        <div class={`set-row${g.reduceMotion ? " is-calm" : ""}`}>
          {[0, 1, 2, 3].map((k) => (
            <i key={k} class={`set-card set-tone-${k}`} style={{ animationDelay: `${k * 1.2}s` }} />
          ))}
          <em>{g.reduceMotion ? "Focus shows by its ring; nothing grows or slides" : "Cards push in as focus reaches them"}</em>
        </div>
      );
    case "playback.spoilerProtection": {
      const mode: SpoilerMode = s.playback.spoilerProtection;
      const look = mode === "off" ? "clear" : mode;
      return (
        <div class="set-eps">
          <Episode n={1} name="Landfall" look="clear" tone={1} />
          <Episode n={2} name="The Long Night" look={look} tone={2} />
          <Episode n={3} name="Low Tide" look={look} tone={3} />
          <em>Episode 1 watched; 2 and 3 not yet</em>
        </div>
      );
    }
    case "general.accentTheme":
      return (
        <div class="set-accent">
          <span class="set-cap-btn is-lit">Play</span>
          <i class="set-bar">
            <i />
          </i>
          <span class="set-badge">4K</span>
          <div class="set-swatches">
            {Object.entries(ACCENT_THEMES).map(([k, a]) => (
              <i key={k} class={k === g.accentTheme ? "is-on" : ""} style={{ background: a.hex }} />
            ))}
          </div>
        </div>
      );
    case "general.clockFormat":
      return (
        <div class="set-clock">
          <b>{g.clockFormat === "24h" ? "21:45" : "9:45 PM"}</b>
          <em>In the header, at the right</em>
        </div>
      );
    case "general.bootAnimation":
      return (
        <div class={`set-boot is-${g.bootAnimation}`}>
          {g.bootAnimation === "instant" ? <em>Opens straight on the home screen</em> : <b class="set-boot-mark">Secretary</b>}
        </div>
      );
    case "domotics.moodBackground":
      return (
        <div class={`set-mood${s.domotics.moodBackground ? " is-on" : ""}`}>
          <i class="set-card set-tone-3" />
          <em>{s.domotics.moodBackground ? "The background takes the poster's colour" : "The background stays neutral"}</em>
        </div>
      );
    case "playback.autoSkip":
      return <Player>{s.playback.autoSkip ? <span class="set-toast">Intro skipped</span> : <span class="set-pill">Skip intro</span>}</Player>;
    case "playback.pausePanel":
      return (
        <Player>
          {s.playback.pausePanel ? (
            <div class="set-pause">
              <b>{SHOW}</b>
              <small>S1 · E3 · 18 min left</small>
            </div>
          ) : (
            <span class="set-pill">❚❚</span>
          )}
        </Player>
      );
    case "playback.upNextCountdown":
      return (
        <Player>
          <div class="set-upnext">
            <small>Up next</small>
            <b>E4 · Low Tide</b>
            <small>{line.value === "Off" ? "OK starts it" : `Starts in ${line.value}`}</small>
          </div>
        </Player>
      );
    default:
      return (
        <div class="set-plain">
          <b>{line.title}</b>
          <em class={line.on ? "is-lit" : ""}>{line.value}</em>
        </div>
      );
  }
}

/** The preview panel's content for one line. */
export function SettingPreview({ line, settings }: { line: PreviewLine; settings: DashboardSettings }) {
  const choices = line.choices ?? (line.on != null ? { items: ["Off", "On"], at: line.on ? 1 : 0 } : undefined);
  return (
    <div class="set-pv">
      <div class="set-stage">
        <Stage line={line} s={settings} />
      </div>
      <b class="set-pv-title">{line.title}</b>
      {line.sub && <small class="set-pv-sub">{line.sub}</small>}
      {choices ? (
        <div class="set-chips">
          {choices.items.map((c, i) => (
            <span key={c} class={`set-chip${i === choices.at ? " is-on" : ""}`}>
              {c}
            </span>
          ))}
        </div>
      ) : (
        line.value && <span class="set-chips set-value">{line.value}</span>
      )}
    </div>
  );
}
