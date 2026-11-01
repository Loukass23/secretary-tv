// The Nest home screen, laid out like the concept (docs/launcher.md): the person top left; the weather, the time and
// quiet buttons top right; the assistant on the wallpaper at the left with its wave; and a row of content cards, one per
// app, running off the right edge. Layout only; data and keys live in app.tsx.
import { windowOf } from "@secretary/tv-kit";
import { Avatar, Glass, Glow, IconButton, MediaTile, Scroller, VoiceWave, type WaveState } from "@secretary/tv-kit/src/glass/index.ts";
import { badgeFor, posterUrl, type SearchResult } from "./apps.ts";
import { CHIPS, type Weather } from "./assistant.ts";
import { CARD_H, itemBox, LABEL_H, RowCard, type RowColumn, rowLayout } from "./cards.tsx";
import { type Focus, HEADER_BELL, HEADER_LIGHTS, HEADER_PARTY, HEADER_PROFILE, HEADER_SEARCH, HEADER_WEATHER } from "./nest-nav.ts";
import { glyphMask } from "./weather.ts";

const PAD = 80;
const HEAD_Y = 56;
/** Party, Search, Lights and Bell, right to left from the edge. */
const ICON = { w: 72, h: 64, gap: 14 };
const ICONS_X = 1920 - PAD - 4 * ICON.w - 3 * ICON.gap;
/** The assistant's column, on the wallpaper. */
const ASK = { x: PAD, y: 300, w: 480 };
const WAVE = { x: PAD - 10, y: 640, w: ASK.w + 20, h: 60 };
/** The content row: from right of the assistant to past the screen's edge. */
const ROW = { x: 620, y: 300, w: 1920 - 620, h: LABEL_H + CARD_H };
/** How much of the row is in view before it scrolls. */
const ROW_VIEW = ROW.w - 60;
const HIT_W = 190;
const HIT_H = 285;
const HIT_STRIDE = 210;
const MENU = { x: PAD, y: 150, w: 400, item: 64 };
const SHEET = { x: 1000, y: 150, w: 820, h: 388 };

/** The assistant on the left: the conversation so far, the last answer, and the wave. */
export interface AskView {
  wave: WaveState;
  /** "Listening…", "Thinking…", or empty. */
  status: string;
  /** Earlier prompts, oldest first (three at most): they fade as they rise. */
  history: string[];
  prompt?: string;
  reply: string;
  /** Changes with each new answer, so the text fades in again. */
  turnId: number;
}

interface Props {
  focus: Focus | null;
  time: string;
  ask: AskView;
  /** What the assistant found, shown in place of the row; null when closed. */
  results: { query: string; items: readonly SearchResult[] } | null;
  weather: Weather | null;
  /** The forecast drops down under the weather. */
  weatherOpen: boolean;
  /** The profile menu's items while it is open. */
  menu: readonly string[] | null;
  /** The glow image in the focused picture's artwork colour. */
  glow?: string;
  columns: readonly RowColumn[];
  /** Open reminders, for the bell's count. */
  open: number;
  status: string;
  /** The Nuvio profile on this TV; null without Nuvio. */
  me: { name: string; color?: string; img?: string } | null;
}

const day = (iso: string, k: number) =>
  k === 0 ? "Today" : new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

function Glyph({ of, size }: { of: Weather["glyph"]; size: number }) {
  if (!of) return null;
  return <i class="nest-glyph" style={{ width: `${size}px`, height: `${size}px`, WebkitMaskImage: glyphMask(of), maskImage: glyphMask(of) }} />;
}

/** The forecast under the weather: now, the next six hours, today and the next three days. */
function WeatherSheet({ w }: { w: Weather }) {
  return (
    <Glass {...SHEET} class="nest-forecast">
      <div class="nest-forecast-head">
        <span class="nest-kicker">Weather{w.place ? ` · ${w.place}` : ""}</span>
        <small>Back closes</small>
      </div>
      <div class="nest-forecast-now">
        <Glyph of={w.glyph} size={64} />
        <b>{w.tempC}°</b>
        <small>{w.label}</small>
      </div>
      <div class="nest-forecast-row">
        {(w.hours ?? []).map((h) => (
          <div key={h.hour}>
            <small>{h.hour}h</small>
            <Glyph of={h.glyph} size={34} />
            <b>{h.tempC}°</b>
          </div>
        ))}
      </div>
      <div class="nest-forecast-row is-days">
        {(w.days ?? []).map((d, k) => (
          <div key={d.date}>
            <small>{day(d.date, k)}</small>
            <Glyph of={d.glyph} size={34} />
            <b>
              {d.maxC}° <span>{d.minC}°</span>
            </b>
          </div>
        ))}
      </div>
    </Glass>
  );
}

export function Home({ focus, time, ask, results, weather, weatherOpen, menu, glow, columns, open, status, me }: Props) {
  const on = (area: Focus["area"], i: number) => focus?.area === area && focus.i === i;
  const now = new Date();

  // The row scrolls just enough to keep the focused column whole.
  const layout = rowLayout(columns);
  const colAt = focus?.area === "row" ? (focus.col ?? 0) : 0;
  const rowScroll = Math.max(0, Math.min(layout.x[colAt] ?? 0, (layout.x[colAt] ?? 0) + (layout.w[colAt] ?? 0) - ROW_VIEW));
  const [kFrom, kTo] = windowOf(colAt, columns.length, 3, 7);
  const hitAt = focus?.area === "results" ? focus.i : 0;
  const hitScroll = Math.max(0, hitAt - 3) * HIT_STRIDE;
  const [hFrom, hTo] = windowOf(hitAt, results?.items.length ?? 0, 3, 7);
  const hit = results?.items[hitAt];
  const focusBox = focus?.area === "row" && columns[colAt] ? itemBox(columns[colAt], focus.i) : null;
  const glowAt = focusBox
    ? { x: ROW.x + layout.x[colAt] - rowScroll + focusBox.x, y: ROW.y + LABEL_H + focusBox.y, w: focusBox.w, h: focusBox.h }
    : focus?.area === "results"
      ? { x: ROW.x + hitAt * HIT_STRIDE - hitScroll, y: ROW.y + LABEL_H, w: HIT_W, h: HIT_H }
      : null;

  return (
    <>
      <Avatar x={PAD} y={HEAD_Y} name={me?.name ?? "Secretary Nest"} sub={status} color={me?.color} img={me?.img} focused={on("header", HEADER_PROFILE)} />

      {/* Top right, quiet like the reference: the weather, the time over the date, then the buttons. */}
      <div class="nest-head" style={{ right: `${1920 - ICONS_X + 36}px`, top: `${HEAD_Y}px` }}>
        {weather && (
          <div class={`nest-weather${on("header", HEADER_WEATHER) ? " is-focus" : ""}`}>
            <Glyph of={weather.glyph} size={46} />
            <div>
              <b>{weather.tempC}°</b>
              <small>{weather.label}</small>
            </div>
          </div>
        )}
        <div class="nest-time">
          <b>{time}</b>
          <small>{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</small>
        </div>
      </div>
      {(["👥", "⌕", "💡", "🔔"] as const).map((icon, k) => (
        <IconButton
          key={icon}
          x={ICONS_X + k * (ICON.w + ICON.gap)}
          y={HEAD_Y}
          w={ICON.w}
          h={ICON.h}
          class="nest-quiet"
          icon={icon}
          badge={k === 3 ? open : undefined}
          focused={on("header", [HEADER_PARTY, HEADER_SEARCH, HEADER_LIGHTS, HEADER_BELL][k])}
        />
      ))}

      {/* The assistant, on the wallpaper: no card, like the reference. */}
      <div class="nest-ask" style={{ left: `${ASK.x}px`, top: `${ASK.y}px`, width: `${ASK.w}px` }}>
        <small class="nest-ask-status">{ask.status}</small>
        <div class="nest-ask-stack">
          {ask.history.map((p, k) => (
            <small key={`${k}:${p}`} class={`nest-ask-old is-${ask.history.length - k}`}>
              {p}
            </small>
          ))}
        </div>
        <div class="nest-ask-log" key={ask.turnId}>
          <b>{ask.prompt ?? "How can I help you"}</b>
          <p>{ask.reply}</p>
        </div>
      </div>
      <VoiceWave {...WAVE} state={ask.wave} />
      <div class="nest-chips" style={{ left: `${ASK.x}px`, top: `${WAVE.y + WAVE.h + 24}px`, width: `${ASK.w + 40}px` }}>
        {CHIPS.map((c, i) => (
          <span key={c.label} class={`nest-chip${on("ask", i) ? " is-focus" : ""}`}>
            {c.label}
          </span>
        ))}
      </div>

      <Glow at={glowAt} src={glow} />

      {results ? (
        // The answer takes the row, as the reference swaps its cards for the music it found.
        <>
          <div class="nest-col-label is-answer" style={{ left: `${ROW.x}px`, top: `${ROW.y}px` }}>
            Ask Nest · {results.query} <span class="nest-label-hint">Back closes</span>
          </div>
          {results.items.length ? (
            <>
              <Scroller x={ROW.x} y={ROW.y + LABEL_H} w={ROW.w} h={HIT_H} axis="x" offset={hitScroll}>
                {results.items.slice(hFrom, hTo).map((r, k) => {
                  const c = hFrom + k;
                  return (
                    <MediaTile key={`${r.type}:${r.title.id}`} x={c * HIT_STRIDE} y={0} w={HIT_W} h={HIT_H} src={posterUrl(r.title)} focused={on("results", c)} />
                  );
                })}
              </Scroller>
              {hit && (
                <div
                  class={`nest-result-cap${focus?.area === "results" ? " is-on" : ""}`}
                  style={{ left: 0, top: 0, transform: `translate3d(${ROW.x + hitAt * HIT_STRIDE - hitScroll}px,${ROW.y + LABEL_H + HIT_H + 14}px,0)` }}
                >
                  <b>{hit.title.name}</b>
                  <small>
                    {badgeFor({ type: hit.type, title: hit.title })}
                    {hit.title.rating ? ` · ★ ${hit.title.rating}` : ""}
                  </small>
                </div>
              )}
            </>
          ) : (
            <Glass x={ROW.x} y={ROW.y + LABEL_H} w={820} h={200} class="nest-empty">
              <small>Nothing found. Try another title or genre.</small>
            </Glass>
          )}
        </>
      ) : (
        <Scroller x={ROW.x} y={ROW.y} w={ROW.w} h={ROW.h} axis="x" offset={rowScroll}>
          {columns.slice(kFrom, kTo).map((col, k) => {
            const c = kFrom + k;
            return (
              <RowCard
                key={col.key}
                col={col}
                x={layout.x[c]}
                page={[ROW.x + layout.x[c] - rowScroll, ROW.y + LABEL_H]}
                focus={focus?.area === "row" && colAt === c ? focus.i : -1}
              />
            );
          })}
        </Scroller>
      )}

      {weatherOpen && weather && <WeatherSheet w={weather} />}
      {menu && (
        <Glass x={MENU.x} y={MENU.y} w={MENU.w} h={menu.length * MENU.item + 24} class="nest-menu">
          {menu.map((m, i) => (
            <span key={m} class={`nest-menu-item${on("menu", i) ? " is-focus" : ""}`} style={{ top: `${12 + i * MENU.item}px` }}>
              {m}
            </span>
          ))}
        </Glass>
      )}
    </>
  );
}
