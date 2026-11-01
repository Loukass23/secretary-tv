// The Nest home screen: a glass dashboard (docs/launcher.md). Layout only; data and keys live in app.tsx.
import { windowOf } from "@secretary/tv-kit";
import {
  AppChip,
  Avatar,
  Fab,
  Glass,
  Glow,
  IconButton,
  ListCard,
  MediaTile,
  PAGE_H,
  Scroller,
  Segmented,
  VoiceWave,
  type WaveState,
} from "@secretary/tv-kit/src/glass/index.ts";
import { type AppEntry, backdropUrl, badgeFor, posterUrl, type Reminder, type SearchResult, type UnifiedResumeEntry } from "./apps.ts";
import { CHIPS, type Weather } from "./assistant.ts";
import { type Focus, SECTIONS, TOP_BELL, TOP_LIGHTS, TOP_PARTY, TOP_SEARCH } from "./nest-nav.ts";
import { glyphMask } from "./weather.ts";

const PAD = 80;
const COL_X = 1020;
const COL_W = 820;
const APP_W = 150;
const APP_H = 128;
const APP_STRIDE = 164;
const APPS_Y = 196;
const CARD_Y = 364;
const CARD_H = 128;
const CARD_STRIDE = 152;
const HEAD = { x: PAD, y: 96, w: 520, h: 68 };
const ASK = { x: PAD, y: 196, w: 820, h: 388 };
const WAVE = { x: 0, y: 248, w: ASK.w, h: 52 };
const TILE_Y = 652;
const TILE_W = 395;
const TILE_H = 236;
const TILE_STRIDE = 425;
/** Answers take the right column: four posters across it. */
const HIT_Y = 246;
const HIT_W = 190;
const HIT_H = 285;
const HIT_STRIDE = 210;
const SEG = { x: 650, y: 96, w: 600, h: 68 };
const ICON_W = 120;
const ICON_X = [1300, 1440, 1580, 1720];

const SOURCE: Record<Reminder["source"], [string, string]> = {
  companion: ["From Secretary Desk", "#5b7cff"],
  gemini: ["From the assistant", "#7d6bff"],
  local: ["Added on the TV", "#3ccf6e"],
};

/** The Ask Nest panel: the conversation so far, the last answer, and the wave. */
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

/** A card in the Recent row: an answer from the assistant, or something the home reported. */
export type RecentCard =
  | { kind: "answer"; key: string; action: string; prompt: string; reply: string; posters?: string[] }
  | { kind: "alert"; key: string; text: string };

const RECENT_LABEL: Record<string, [string, string]> = {
  watch: ["Watch", "#ff8a3d"],
  reminder_added: ["Reminder", "#3ccf6e"],
  domotics_updated: ["Lights", "#ffc94d"],
  weather: ["Weather", "#4fc3ff"],
  briefing: ["Briefing", "#b78bff"],
  alert: ["Home", "#ff7ad9"],
};

interface Props {
  focus: Focus | null;
  time: string;
  ask: AskView;
  /** What the assistant found, shown in place of the right column; null when closed. */
  results: { query: string; items: readonly SearchResult[] } | null;
  weather: Weather | null;
  /** The forecast sheet is open over the Ask panel. */
  weatherOpen: boolean;
  /** The glow image in the focused tile's artwork colour. */
  glow?: string;
  apps: readonly AppEntry[];
  reminders: readonly Reminder[];
  recent: readonly RecentCard[];
  continueItems: readonly UnifiedResumeEntry[];
  status: string;
  /** The Nuvio profile on this TV; null without Nuvio. */
  me: { name: string; color?: string; img?: string } | null;
  /** What the empty Continue Watching row says. */
  emptyContinue: string;
}

const day = (iso: string, k: number) =>
  k === 0 ? "Today" : new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

function Glyph({ of, size }: { of: Weather["glyph"]; size: number }) {
  if (!of) return null;
  return <i class="nest-glyph" style={{ width: `${size}px`, height: `${size}px`, WebkitMaskImage: glyphMask(of), maskImage: glyphMask(of) }} />;
}

/** The forecast over the Ask panel: now, the next six hours, today and the next three days. */
function WeatherSheet({ w }: { w: Weather }) {
  return (
    <Glass {...ASK} class="nest-forecast">
      <div class="nest-ask-head">
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

function Recent({ card, x, page, focused }: { card: RecentCard; x: number; page: [number, number]; focused: boolean }) {
  const [label, color] = RECENT_LABEL[card.kind === "alert" ? "alert" : card.action] ?? ["Ask Nest", "#b78bff"];
  return (
    <Glass x={x} y={0} w={TILE_W} h={TILE_H} page={page} focused={focused} class="nest-recent-card">
      <span class="nest-kicker" style={{ color }}>
        {label}
      </span>
      {card.kind === "alert" ? (
        <p>{card.text}</p>
      ) : (
        <>
          <b>“{card.prompt}”</b>
          {card.posters?.length ? (
            <div class="nest-recent-posters">
              {card.posters.slice(0, 3).map((src) => (
                <img key={src} src={src} alt="" decoding="async" />
              ))}
            </div>
          ) : (
            <p>{card.reply}</p>
          )}
        </>
      )}
    </Glass>
  );
}

export function Home({ focus, time, ask, results, weather, weatherOpen, glow, apps, reminders, recent, continueItems, status, me, emptyContinue }: Props) {
  const on = (area: Focus["area"], i: number) => focus?.area === area && focus.i === i;
  const now = new Date();
  const open = reminders.filter((r) => !r.completed).length;

  // Scroll offsets: the app strip keeps the focused chip in view, the cards keep one card above it.
  const appAt = focus?.area === "apps" ? focus.i : 0;
  const appScroll = Math.max(0, Math.min(apps.length * APP_STRIDE - COL_W - 14, appAt * APP_STRIDE - 2 * APP_STRIDE));
  const cardAt = focus?.area === "cards" ? focus.i : 0;
  const cardScroll = Math.max(0, cardAt - 1) * CARD_STRIDE;
  const [rFrom, rTo] = windowOf(cardAt, reminders.length, 2, 6);
  // The bottom row is Recent (the assistant's latest answers) and then Continue Watching.
  const rowLength = recent.length + continueItems.length;
  const tileAt = focus?.area === "continue" ? focus.i : 0;
  const tileScroll = Math.max(0, tileAt - 1) * TILE_STRIDE;
  const [cFrom, cTo] = windowOf(tileAt, rowLength, 2, 3);
  const hitAt = focus?.area === "results" ? focus.i : 0;
  const hitScroll = Math.max(0, hitAt - 2) * HIT_STRIDE;
  const [hFrom, hTo] = windowOf(hitAt, results?.items.length ?? 0, 3, 5);
  const hit = results?.items[hitAt];
  const glowAt =
    focus?.area === "continue" && tileAt >= recent.length
      ? { x: PAD + tileAt * TILE_STRIDE - tileScroll, y: TILE_Y, w: TILE_W, h: TILE_H }
      : focus?.area === "results"
        ? { x: COL_X + hitAt * HIT_STRIDE - hitScroll, y: HIT_Y, w: HIT_W, h: HIT_H }
        : null;

  return (
    <>
      {/* The header, quiet like the reference: a line icon, the temperature, then the time over the date. */}
      <div class={`nest-head${on("weather", 0) ? " is-focus" : ""}`} style={{ left: `${HEAD.x}px`, top: `${HEAD.y}px`, height: `${HEAD.h}px` }}>
        {weather && (
          <div class="nest-weather">
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

      <Segmented {...SEG} items={SECTIONS} picked={0} focusIndex={focus?.area === "top" && focus.i < SECTIONS.length ? focus.i : -1} />
      <IconButton x={ICON_X[0]} y={SEG.y} w={ICON_W} h={SEG.h} icon="👥" focused={on("top", TOP_PARTY)} />
      <IconButton x={ICON_X[1]} y={SEG.y} w={ICON_W} h={SEG.h} icon="⌕" focused={on("top", TOP_SEARCH)} />
      <IconButton x={ICON_X[2]} y={SEG.y} w={ICON_W} h={SEG.h} icon="💡" focused={on("top", TOP_LIGHTS)} />
      <IconButton x={ICON_X[3]} y={SEG.y} w={ICON_W} h={SEG.h} icon="🔔" badge={open} focused={on("top", TOP_BELL)} />

      {weatherOpen && weather ? (
        <WeatherSheet w={weather} />
      ) : (
        <Glass {...ASK} class="nest-ask">
          <div class="nest-ask-head">
            <span class="nest-kicker">Ask Nest</span>
            <small>{ask.status}</small>
          </div>
          <div class="nest-ask-stack">
            {ask.history.map((p, k) => (
              <small key={`${k}:${p}`} class={`nest-ask-old is-${ask.history.length - k}`}>
                “{p}”
              </small>
            ))}
          </div>
          <div class="nest-ask-log" key={ask.turnId}>
            <b>{ask.prompt ? `“${ask.prompt}”` : "How can I help?"}</b>
            <p>{ask.reply}</p>
          </div>
          <VoiceWave {...WAVE} state={ask.wave} />
          <div class="nest-chips">
            {CHIPS.map((c, i) => (
              <span key={c.label} class={`nest-chip${on("ask", i) ? " is-focus" : ""}`}>
                {c.label}
              </span>
            ))}
          </div>
        </Glass>
      )}

      <Glow at={glowAt} src={glow} />

      <div class="nest-label" style={{ left: `${PAD}px`, top: `${TILE_Y - 50}px` }}>
        {recent.length ? "Recent" : "Continue watching"}
      </div>
      {rowLength ? (
        <Scroller x={PAD} y={TILE_Y} w={ASK.w} h={TILE_H} axis="x" offset={tileScroll}>
          {Array.from({ length: cTo - cFrom }, (_, k) => {
            const c = cFrom + k;
            if (c < recent.length) return (
                <Recent
                  key={recent[c].key}
                  card={recent[c]}
                  x={c * TILE_STRIDE}
                  page={[PAD + c * TILE_STRIDE - tileScroll, TILE_Y]}
                  focused={on("continue", c)}
                />
              );
            const entry = continueItems[c - recent.length];
            return (
              <MediaTile
                key={`${entry.type}:${entry.title.id}`}
                x={c * TILE_STRIDE}
                y={0}
                w={TILE_W}
                h={TILE_H}
                src={backdropUrl(entry)}
                badge={badgeFor(entry)}
                title={entry.title.name}
                sub={entry.episode?.name}
                progress={entry.durSec > 0 ? entry.posSec / entry.durSec : undefined}
                focused={on("continue", c)}
              />
            );
          })}
        </Scroller>
      ) : (
        <Glass x={PAD} y={TILE_Y} w={ASK.w} h={TILE_H} class="nest-empty">
          <small>{emptyContinue}</small>
        </Glass>
      )}

      <Avatar
        x={PAD}
        y={936}
        name={me?.name ?? "Secretary Nest"}
        sub={status}
        color={me?.color}
        img={me?.img}
        focused={on("me", 0)}
      />

      {results ? (
        // The answer takes the stage next to the assistant, where the apps and reminders were.
        <>
          <div class="nest-label" style={{ left: `${COL_X}px`, top: `${APPS_Y}px` }}>
            {results.query || "Ask Nest"} <span class="nest-label-hint">Back closes</span>
          </div>
          {results.items.length ? (
            <>
              <Scroller x={COL_X} y={HIT_Y} w={COL_W} h={HIT_H} axis="x" offset={hitScroll}>
                {results.items.slice(hFrom, hTo).map((r, k) => {
                  const c = hFrom + k;
                  return (
                    <MediaTile
                      key={`${r.type}:${r.title.id}`}
                      x={c * HIT_STRIDE}
                      y={0}
                      w={HIT_W}
                      h={HIT_H}
                      src={posterUrl(r.title)}
                      focused={on("results", c)}
                    />
                  );
                })}
              </Scroller>
              {hit && (
                <div
                  class={`nest-result-cap${focus?.area === "results" ? " is-on" : ""}`}
                  style={{
                    left: 0,
                    top: 0,
                    transform: `translate3d(${COL_X + hitAt * HIT_STRIDE - hitScroll}px,${HIT_Y + HIT_H + 14}px,0)`,
                  }}
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
            <Glass x={COL_X} y={HIT_Y} w={COL_W} h={TILE_H} class="nest-empty">
              <small>Nothing found. Try another title or genre.</small>
            </Glass>
          )}
        </>
      ) : (
        <>
          <Scroller x={COL_X} y={APPS_Y} w={COL_W} h={APP_H} axis="x" offset={appScroll}>
            {apps.map((app, i) => (
              <AppChip
                key={app.id}
                x={i * APP_STRIDE}
                y={0}
                w={APP_W}
                h={APP_H}
                page={[COL_X + i * APP_STRIDE - appScroll, APPS_Y]}
                icon={app.iconPath}
                // "Secretary Cinema" reads as "Cinema" in a 150px chip.
                label={app.name.replace(/^Secretary\s+/, "")}
                focused={on("apps", i)}
              />
            ))}
          </Scroller>

          {reminders.length ? (
            <Scroller x={COL_X} y={CARD_Y} w={COL_W} h={PAGE_H - CARD_Y} axis="y" offset={cardScroll}>
              {reminders.slice(rFrom, rTo).map((r, k) => {
                const i = rFrom + k;
                const y = CARD_Y + i * CARD_STRIDE - cardScroll;
                const below = (y - CARD_Y) / CARD_STRIDE;
                const [from, color] = SOURCE[r.source] ?? SOURCE.local;
                return (
                  <ListCard
                    key={r.id}
                    x={0}
                    y={i * CARD_STRIDE}
                    w={COL_W}
                    h={CARD_H}
                    page={[COL_X, y]}
                    class={r.completed ? "is-done" : undefined}
                    opacity={below > 3 ? 0.35 : below < -0.5 ? 0 : r.completed ? 0.55 : 1}
                    title={r.text}
                    sub={on("cards", i) ? `${from} · OK: ${r.completed ? "reopen" : "done"}` : from}
                    meta={r.completed ? "✓ done" : r.due ? `⏰ ${r.due}` : undefined}
                    color={r.completed ? "#6d6c68" : color}
                    focused={on("cards", i)}
                  />
                );
              })}
            </Scroller>
          ) : (
            <Glass x={COL_X} y={CARD_Y} w={COL_W} h={CARD_H} class="nest-empty">
              <small>No reminders. Press + or ask Nest to add one.</small>
            </Glass>
          )}
        </>
      )}

      <Fab x={1752} y={952} focused={on("fab", 0)} />
    </>
  );
}
