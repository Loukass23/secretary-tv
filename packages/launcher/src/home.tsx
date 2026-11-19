// The Nest home screen, laid out like the concept (docs/launcher.md): the person top left; the weather, the time and
// quiet buttons top right; the assistant on the wallpaper at the left with its wave; and a row of content cards, one per
// app, running off the right edge. Layout only; data and keys live in app.tsx.
import { windowOf } from "@secretary/tv-kit";
import { useRef } from "preact/hooks";
import { Avatar, Glass, Glow, Icon, IconButton, type IconName, MediaTile, Scroller, VoiceWave, type WaveState } from "@secretary/tv-kit/src/glass/index.ts";
import { badgeFor, posterUrl, type SearchResult } from "./apps.ts";
import type { Weather } from "./assistant.ts";
import { type CardStyle, LAYOUT_LABEL, LAYOUTS, SIZE_LABEL, SIZE_LINE, type StyleMenu } from "./card-style.ts";
import { CARD_H, columnShape, expands, itemBox, LABEL_H, RowCard, type RowColumn, rowLayout } from "./cards.tsx";
import { type Focus, HEADER_BELL, HEADER_LIGHTS, HEADER_PARTY, HEADER_PROFILE, HEADER_SEARCH, HEADER_WEATHER } from "./nest-nav.ts";

const PAD = 80;
const HEAD_Y = 44;
/** Party, Search, Lights and Bell, right to left from the edge. */
const ICON = { w: 88, h: 78, gap: 16 };
const ICONS_X = 1920 - PAD - 4 * ICON.w - 3 * ICON.gap;
/** The assistant's column, on the wallpaper. */
const ASK = { x: PAD, y: 236, w: 500 };
/** Starts at the text column's edge: at rest the ribbons draw into the orb there. */
const WAVE = { x: PAD, y: 690, w: ASK.w, h: 72 };
/** The content row starts right of the assistant; it scrolls across the whole screen, taking the assistant with it. */
const ROW = { x: 640, y: 236, h: LABEL_H + CARD_H };
/** The right edge a focused card is kept inside of. */
const VIEW_RIGHT = 1920 - 60;
const HIT_W = 240;
const HIT_H = 360;
const HIT_STRIDE = 264;
const MENU = { x: PAD, y: 150, w: 480, item: 76 };
const SHEET = { x: 880, y: 150, w: 960, h: 470 };

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
  /** The card style menu (a long OK on a media card), while it is open. */
  styleMenu?: StyleMenu | null;
}

const STYLE_W = 460;
const STYLE_LINE = 72;

/** The long-OK menu beside a media card: its layouts, then its size. The card shows each choice as it is picked. */
function CardStyleMenu({ m, x, y, name }: { m: StyleMenu; x: number; y: number; name: string }) {
  const lines = [...LAYOUTS.map((l) => LAYOUT_LABEL[l]), `Size  ‹ ${SIZE_LABEL[m.style.size]} ›`];
  return (
    <Glass x={x} y={y} w={STYLE_W} h={96 + lines.length * STYLE_LINE + 64} class="nest-menu nest-style">
      <span class="nest-kicker nest-style-head">{name} · card style</span>
      {lines.map((label, i) => (
        <span
          key={i}
          class={`nest-menu-item${m.line === i ? " is-focus" : ""}${i < SIZE_LINE && LAYOUTS[i] === m.style.layout ? " is-picked" : ""}`}
          style={{ top: `${76 + i * STYLE_LINE}px` }}
        >
          {label}
        </span>
      ))}
      <small class="nest-style-hint" style={{ top: `${88 + lines.length * STYLE_LINE}px` }}>
        OK keeps · Back undoes
      </small>
    </Glass>
  );
}

/** The style a card shows: the menu's while it is open on that card. */
export const shownStyle = (m: StyleMenu | null | undefined, key: string, saved: CardStyle): CardStyle => (m?.key === key ? m.style : saved);

const day = (iso: string, k: number) =>
  k === 0 ? "Today" : new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

function Glyph({ of, size }: { of: Weather["glyph"]; size: number }) {
  return of ? <Icon name={of} size={size} /> : null;
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
        <Glyph of={w.glyph} size={78} />
        <b>{w.tempC}°</b>
        <small>{w.label}</small>
      </div>
      <div class="nest-forecast-row">
        {(w.hours ?? []).map((h) => (
          <div key={h.hour}>
            <small>{h.hour}h</small>
            <Glyph of={h.glyph} size={42} />
            <b>{h.tempC}°</b>
          </div>
        ))}
      </div>
      <div class="nest-forecast-row is-days">
        {(w.days ?? []).map((d, k) => (
          <div key={d.date}>
            <small>{day(d.date, k)}</small>
            <Glyph of={d.glyph} size={42} />
            <b>
              {d.maxC}° <span>{d.minC}°</span>
            </b>
          </div>
        ))}
      </div>
    </Glass>
  );
}

export function Home({ focus, time, ask, results, weather, weatherOpen, menu, glow, columns, open, status, me, styleMenu }: Props) {
  const on = (area: Focus["area"], i: number) => focus?.area === area && focus.i === i;
  const now = new Date();

  // A media card is open while the remote is inside it; the row scrolls just enough to keep the focused column whole.
  const openCol = focus?.area === "row" && focus.inside && expands(columns[focus.col ?? 0]) ? (focus.col ?? 0) : -1;
  const layout = rowLayout(columns, openCol);
  // The row and the assistant scroll as one strip: a card past the right edge brings the row left, and the assistant
  // slides off and fades. The header keeps the scroll it was reached from; the assistant itself scrolls back to 0.
  const lastCol = useRef(0);
  if (focus?.area === "row") lastCol.current = focus.col ?? 0;
  else if (focus?.area !== "header") lastCol.current = 0;
  const colAt = lastCol.current;
  const left = ROW.x + (layout.x[colAt] ?? 0);
  const rowScroll = Math.max(0, Math.min(left - PAD, left + (layout.w[colAt] ?? 0) - VIEW_RIGHT));
  const hitAt = focus?.area === "results" ? focus.i : 0;
  const hitScroll = Math.max(0, hitAt - 3) * HIT_STRIDE;
  const [hFrom, hTo] = windowOf(hitAt, results?.items.length ?? 0, 3, 7);
  const hit = results?.items[hitAt];
  const inside = focus?.area === "row" && focus.inside;
  const focusBox = inside && columns[colAt] && focus.i >= 0 ? itemBox(columns[colAt], focus.i, colAt === openCol) : null;
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
            <Glyph of={weather.glyph} size={56} />
            <div>
              <b>{weather.tempC}°</b>
              <small>{weather.place ? `${weather.place} · ${weather.label}` : weather.label}</small>
            </div>
          </div>
        )}
        <div class="nest-time">
          <b>{time}</b>
          <small>{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</small>
        </div>
      </div>
      {(["party", "search", "lights", "bell"] as const satisfies readonly IconName[]).map((icon, k) => (
        <IconButton
          key={icon}
          x={ICONS_X + k * (ICON.w + ICON.gap)}
          y={HEAD_Y}
          w={ICON.w}
          h={ICON.h}
          class="nest-quiet"
          icon={<Icon name={icon} />}
          badge={k === 3 ? open : undefined}
          focused={on("header", [HEADER_PARTY, HEADER_SEARCH, HEADER_LIGHTS, HEADER_BELL][k])}
        />
      ))}

      {/* The assistant, on the wallpaper: no card, like the reference. It scrolls away with the row. */}
      <div
        class="nest-assist"
        style={{ transform: `translate3d(${-rowScroll}px,0,0)`, opacity: Math.max(0, 1 - rowScroll / (ROW.x - PAD)) }}
      >
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
      <span class={`nest-chip nest-ask-button${on("ask", 0) ? " is-focus" : ""}`} style={{ left: `${ASK.x}px`, top: `${WAVE.y + WAVE.h + 30}px` }}>
        Ask Assistant
      </span>
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
              <Scroller x={ROW.x} y={ROW.y + LABEL_H} w={1920 - ROW.x} h={HIT_H} axis="x" offset={hitScroll}>
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
                  style={{ left: 0, top: 0, transform: `translate3d(${ROW.x + hitAt * HIT_STRIDE - hitScroll}px,${ROW.y + LABEL_H + HIT_H + 30}px,0)` }}
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
        <Scroller x={0} y={ROW.y} w={1920} h={ROW.h} axis="x" offset={rowScroll}>
          {/* Seven cards at most, all drawn: with the assistant gone the whole width shows them, the first ones included. */}
          {columns.map((col, c) => {
            return (
              <RowCard
                key={col.key}
                col={col}
                x={ROW.x + layout.x[c]}
                page={[ROW.x + layout.x[c] - rowScroll, ROW.y + LABEL_H]}
                picked={focus?.area === "row" && !inside && colAt === c}
                focus={inside && colAt === c ? focus!.i : null}
                dim={(openCol >= 0 && openCol !== c) || (styleMenu != null && styleMenu.key !== col.key)}
              />
            );
          })}
        </Scroller>
      )}

      {weatherOpen && weather && <WeatherSheet w={weather} />}
      {styleMenu && (() => {
        const c = columns.findIndex((k) => k.key === styleMenu.key);
        if (c < 0) return null;
        const cardX = ROW.x + layout.x[c] - rowScroll;
        const right = cardX + columnShape(columns[c]).w + 28;
        return <CardStyleMenu m={styleMenu} x={right + STYLE_W > 1920 - PAD ? cardX - STYLE_W - 28 : right} y={ROW.y + LABEL_H} name={(() => { const k = columns[c]; return k.kind === "media" ? k.name : k.label; })()} />;
      })()}
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
