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
const ASK = { x: PAD, y: 318, w: 820, h: 266 };
const WAVE = { x: 0, y: 146, w: ASK.w, h: 52 };
const TILE_Y = 652;
const TILE_W = 395;
const TILE_H = 236;
const TILE_STRIDE = 425;
const POSTER_W = 142;
const POSTER_H = 213;
const POSTER_STRIDE = 158;
const SEG = { x: 650, y: 96, w: 600, h: 68 };
const ICON_W = 120;
const ICON_X = [1300, 1440, 1580, 1720];

const SOURCE: Record<Reminder["source"], [string, string]> = {
  companion: ["From Secretary Desk", "#5b7cff"],
  gemini: ["From the assistant", "#7d6bff"],
  local: ["Added on the TV", "#3ccf6e"],
};

/** The Ask Nest panel: the last prompt and answer, and the wave. */
export interface AskView {
  wave: WaveState;
  /** "Listening…", "Thinking…", or empty. */
  status: string;
  prompt?: string;
  reply: string;
  /** Changes with each new answer, so the text fades in again. */
  turnId: number;
  /** Server needed: without one the chips are hidden. */
  online: boolean;
}

interface Props {
  focus: Focus | null;
  time: string;
  ask: AskView;
  /** What the assistant found, shown in place of Continue Watching; null when closed. */
  results: { query: string; items: readonly SearchResult[] } | null;
  weather: Weather | null;
  /** The glow image in the focused tile's artwork colour. */
  glow?: string;
  apps: readonly AppEntry[];
  reminders: readonly Reminder[];
  continueItems: readonly UnifiedResumeEntry[];
  serverOnline: boolean;
  status: string;
  /** The Nuvio profile on this TV; null without Nuvio. */
  me: { name: string; color?: string; img?: string } | null;
  /** What the empty Continue Watching row says. */
  emptyContinue: string;
}

export function Home({ focus, time, ask, results, weather, glow, apps, reminders, continueItems, serverOnline, status, me, emptyContinue }: Props) {
  const on = (area: Focus["area"], i: number) => focus?.area === area && focus.i === i;
  const now = new Date();
  const open = reminders.filter((r) => !r.completed).length;

  // Scroll offsets: the app strip keeps the focused chip in view, the cards keep one card above it.
  const appAt = focus?.area === "apps" ? focus.i : 0;
  const appScroll = Math.max(0, Math.min(apps.length * APP_STRIDE - COL_W - 14, appAt * APP_STRIDE - 2 * APP_STRIDE));
  const cardAt = focus?.area === "cards" ? focus.i : 0;
  const cardScroll = Math.max(0, cardAt - 1) * CARD_STRIDE;
  const [rFrom, rTo] = windowOf(cardAt, reminders.length, 2, 6);
  const tileAt = focus?.area === "continue" ? focus.i : 0;
  const tileScroll = Math.max(0, tileAt - 1) * TILE_STRIDE;
  const [cFrom, cTo] = windowOf(tileAt, continueItems.length, 2, 3);
  const hitAt = focus?.area === "results" ? focus.i : 0;
  const hitScroll = Math.max(0, hitAt - 2) * POSTER_STRIDE;
  const [hFrom, hTo] = windowOf(hitAt, results?.items.length ?? 0, 3, 6);
  const hit = results?.items[hitAt];
  const glowAt =
    focus?.area === "continue"
      ? { x: PAD + tileAt * TILE_STRIDE - tileScroll, y: TILE_Y, w: TILE_W, h: TILE_H }
      : focus?.area === "results"
        ? { x: PAD + hitAt * POSTER_STRIDE - hitScroll, y: TILE_Y, w: POSTER_W, h: POSTER_H }
        : null;

  return (
    <>
      <div class="nest-clock" style={{ left: `${PAD}px`, top: "72px" }}>
        {time}
      </div>
      <div class="nest-date" style={{ left: `${PAD}px`, top: "212px" }}>
        {now.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
        <small>{now.toLocaleDateString("en-GB", { weekday: "long" })}</small>
      </div>

      <Segmented {...SEG} items={SECTIONS} picked={0} focusIndex={focus?.area === "top" && focus.i < SECTIONS.length ? focus.i : -1} />
      <IconButton x={ICON_X[0]} y={SEG.y} w={ICON_W} h={SEG.h} icon="👥" focused={on("top", TOP_PARTY)} />
      <IconButton x={ICON_X[1]} y={SEG.y} w={ICON_W} h={SEG.h} icon="⌕" focused={on("top", TOP_SEARCH)} />
      <IconButton x={ICON_X[2]} y={SEG.y} w={ICON_W} h={SEG.h} icon="💡" focused={on("top", TOP_LIGHTS)} />
      <IconButton x={ICON_X[3]} y={SEG.y} w={ICON_W} h={SEG.h} icon="🔔" badge={open} focused={on("top", TOP_BELL)} />

      {weather && (
        <div class="nest-weather" style={{ left: "470px", top: "222px" }}>
          <span class="nest-weather-icon">{weather.icon}</span>
          <div>
            <b>{weather.tempC}°</b>
            <small>{weather.label}</small>
          </div>
        </div>
      )}

      <Glass {...ASK} class="nest-ask">
        <div class="nest-ask-head">
          <span class="nest-kicker">Ask Nest</span>
          <small>{ask.status}</small>
        </div>
        <div class="nest-ask-log" key={ask.turnId}>
          <small>{ask.prompt ? `“${ask.prompt}”` : "How can I help?"}</small>
          <p>{ask.reply}</p>
        </div>
        <VoiceWave {...WAVE} state={ask.wave} />
        <div class="nest-chips">
          {ask.online ? (
            CHIPS.map((c, i) => (
              <span key={c.label} class={`nest-chip${on("ask", i) ? " is-focus" : ""}`}>
                {c.label}
              </span>
            ))
          ) : (
            <small>Ask Nest needs Secretary Server.</small>
          )}
        </div>
      </Glass>

      <Glow at={glowAt} src={glow} />

      <div class="nest-label" style={{ left: `${PAD}px`, top: `${TILE_Y - 50}px` }}>
        {results ? (
          <>
            Ask Nest · {results.query} <span class="nest-label-hint">Back closes</span>
          </>
        ) : (
          "Continue watching"
        )}
      </div>
      {results ? (
        results.items.length ? (
          <>
            <Scroller x={PAD} y={TILE_Y} w={ASK.w} h={POSTER_H} axis="x" offset={hitScroll}>
              {results.items.slice(hFrom, hTo).map((r, k) => {
                const c = hFrom + k;
                return (
                  <MediaTile
                    key={`${r.type}:${r.title.id}`}
                    x={c * POSTER_STRIDE}
                    y={0}
                    w={POSTER_W}
                    h={POSTER_H}
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
                  transform: `translate3d(${PAD + hitAt * POSTER_STRIDE - hitScroll}px,${TILE_Y + POSTER_H + 12}px,0)`,
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
          <Glass x={PAD} y={TILE_Y} w={ASK.w} h={TILE_H} class="nest-empty">
            <small>Nothing found. Try another title or genre.</small>
          </Glass>
        )
      ) : continueItems.length ? (
        <Scroller x={PAD} y={TILE_Y} w={ASK.w} h={TILE_H} axis="x" offset={tileScroll}>
          {continueItems.slice(cFrom, cTo).map((entry, k) => {
            const c = cFrom + k;
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
          <small>{serverOnline ? "No reminders. Press + to add one." : "Reminders need Secretary Server."}</small>
        </Glass>
      )}

      <Fab x={1752} y={952} focused={on("fab", 0)} />
    </>
  );
}
