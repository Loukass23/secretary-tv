// The content cards on Nest's home row (docs/launcher.md): one column per app, each laid out for what it holds, like
// the concept's "Playing Music", "Searching Places" and "Playing Netflix" cards. Layout only; app.tsx builds the columns
// and runs OK. Built on tv-kit glass, with hairlines and opacity/transform focus (docs/performance.md).
//
// A media card (Cinema, Shows, Anime) has a style the viewer picks with a long OK (card-style.ts). OK opens it in place
// into its rows (card-rows.ts) across the screen; the other cards fade out while it is open. The weather card opens the
// same way, into its forecast.
import {
  AppChip,
  Button,
  Glass,
  Icon,
  type IconName,
  InfoPanel,
  Kicker,
  LANDSCAPE,
  LandscapeTile,
  ListCard,
  MediaTile,
  Scroller,
} from "@secretary/tv-kit/src/glass/index.ts";
import type { Weather } from "./assistant.ts";
import type { CatalogKind, SlimTitle } from "./apps.ts";
import { CAPTION, CAPTION_W, type CardStyle, collapsedShape, EXPANDED, EXPANDED_W, MORE, moreTop, rowScroll } from "./card-style.ts";
import { captionMeta, expandedRows, focusedItem, onRow, rowItems, rowsOf, rowTitle, targetAt, tileKey, tileKeys } from "./card-rows.ts";
import { recLine, type RecState } from "./recommend.ts";
import { type RowShape, type TileBox, tileBox } from "./row-look.ts";
import { Component } from "preact";
import { type Column, END_ALL, END_RECOMMEND, END_TOP, rowAt } from "./nest-nav.ts";

export { expandedRows, rowTitle, targetAt };

/** A title on a media card. */
export interface MediaItem {
  /** Portrait art, for posters, grids and the expanded row. */
  poster: string;
  /** Landscape art for the stills layout; the poster stands in without it. */
  still?: string;
  title: string;
  sub?: string;
  /** In progress: OK resumes it. */
  resume?: boolean;
  /** A label for titles not in progress ("Top film"). */
  badge?: string;
  /** Watched fraction, 0..1. */
  progress?: number;
  /** A few lines about it, shown under the title while it is focused in the opened card. */
  about?: string;
  /** Its rating out of ten ("7.4"), shown as "★ 7.4" in the opened card's caption. */
  rating?: string;
  /** Where it ranks and on whose list, when known ("No. 3 in Popular films"). */
  rank?: string;
}

/** A row under the first one in an opened media card (My List, a genre): `run(i)` opens its item `i`. */
export interface MoreRow {
  label: string;
  items: MediaItem[];
  run: (i: number) => void;
  /** How the row draws its tiles (row-look.ts); without one, `wide` rows draw landscape stills and the rest posters. */
  shape?: RowShape;
  /** Continue watching: landscape stills with the title on the art, unless the viewer picked another look. */
  wide?: boolean;
  /** The title behind item `i`, for its long-OK menu. */
  target?: (i: number) => TileTarget | null;
}

export interface ListItem {
  title: string;
  sub?: string;
  meta?: string;
  color?: string;
  done?: boolean;
}

/** A title in an opened media card: what the long-OK menu acts on. */
export interface TileTarget {
  type: CatalogKind;
  title: SlimTitle;
  /** In progress: Play resumes it. */
  resume: boolean;
  /** The row it sits in (`<card>/<row>`), where its look is kept. */
  row: string;
  /** A suggestion of tonight's picks: the menu can remove it from the row. */
  suggestion?: boolean;
}

/** One card of the row; `run(i)` is what OK does on its item `i`. */
export type RowColumn = { key: string; label: string; run: (i: number) => void } & (
  | {
      kind: "media";
      /** "Cinema", and what its titles are ("films"), for the expanded card's label. */
      name: string;
      unit: string;
      /** The first row of the opened card. */
      items: MediaItem[];
      /** What the folded card shows, when it is more than the first row (Continue watching, then the picks). */
      small?: MediaItem[];
      style: CardStyle;
      /** The first row's own name once the card is open ("Continue watching", "Tonight's picks"). */
      heading?: string;
      /** How the first row draws its tiles (row-look.ts). */
      shape?: RowShape;
      /** The first row is Continue watching: landscape stills unless `shape` says otherwise. */
      wide?: boolean;
      /** What the assistant understood and did, shown beside the label while the card holds its suggestions. */
      note?: { prompt: string; reply: string };
      /** Rows under the first once the card is opened (Down): the picks, My List, the genres, the assistant's picks. */
      more?: MoreRow[];
      /** The title behind tile `i` of the opened card's first row, for its long-OK menu. */
      target?: (i: number) => TileTarget | null;
      /** Recommend me on the bar under the last row: asks the assistant for picks of this kind (recommend.ts). */
      recommend?: () => void;
      /** Where that request is; once it has picks they are a row of `more`, put there by the host. */
      recs?: RecState;
      /** See all on the bar: the catalog home of this kind. */
      seeAll?: () => void;
    }
  | { kind: "home"; title: string; sub: string; actions: { icon: IconName; label: string }[] }
  // The assistant's own card, first in the row: what it has for the day. OK opens the full chat.
  | { kind: "assistant"; greeting: string; lines: string[] }
  // Now on the card; OK opens the forecast across the screen.
  | { kind: "weather"; weather: Weather | null }
  // The month; its events come later.
  | { kind: "calendar"; date: Date }
  | { kind: "list"; items: ListItem[]; add?: string }
  | { kind: "apps"; apps: { icon?: string; label: string }[] }
  // A Nuvio collection (collections.ts): its folders as cover tiles, two across.
  | { kind: "folders"; folders: { title: string; cover?: string }[] }
  // The YouTube card (youtube.ts): what is popular, as wide thumbnails stacked.
  | { kind: "videos"; videos: { title: string; channel: string; thumb: string }[] }
);

/** Card height: the tallest layout fills it, the others sit at its top. */
export const CARD_H = 540;
/** Room for the column's label above its card. */
export const LABEL_H = 54;
const GAP = 48;
const LIST = { w: 420, h: 136 };
const ADD_H = 76;
const APP = { w: 176, h: 160, gap: 18, across: 2 };
const VIDEO = { w: 420, h: 166, gap: 18 };
const FOLDER = { w: 210, h: 250, gap: 20, across: 2 };
const HOME_W = 380;
/** The Home card's buttons (Cinema, Warm, Off, Music): four under its title and the bulb. */
const ACTION_H = 60;
const ASSIST_W = 440;
const PANEL_W = 460;

type MediaColumn = Extract<RowColumn, { kind: "media" }>;

/** A Continue watching still: LandscapeTile's size. */
const WIDE_BOX: TileBox = { w: LANDSCAPE.w, h: LANDSCAPE.h, stride: LANDSCAPE.w + LANDSCAPE.gap, art: "still", lead: 0, caption: true };
/** How a row draws its tiles: the look the viewer picked, else stills for Continue watching, else posters. */
const rowBox = (shape: RowShape | undefined, wide: boolean | undefined): TileBox => (shape ? tileBox(shape) : wide ? WIDE_BOX : tileBox("poster"));
const rowLook = (c: MediaColumn, r: number): { shape?: RowShape; wide?: boolean } => (r === 0 ? { shape: c.shape, wide: c.wide } : (rowsOf(c)[r - 1] ?? {}));
/** What the folded card shows. */
const smallItems = (c: MediaColumn): MediaItem[] => c.small ?? c.items;

/** How wide a column is and how its items run for the remote; an expanded media card is one long row. */
export function columnShape(c: RowColumn, expanded = false): { w: number } & Column {
  switch (c.kind) {
    case "media": {
      if (expanded) {
        const rows = expandedRows(c);
        return { w: EXPANDED_W, count: rows.reduce((s, n) => s + n, 0), across: rows[0], rows };
      }
      const s = collapsedShape(c.style);
      return { w: s.w, count: Math.min(smallItems(c).length, s.count), across: s.across };
    }
    case "home":
      return { w: HOME_W, count: c.actions.length, across: 1 };
    case "assistant":
      return { w: ASSIST_W, count: 1, across: 1 };
    case "weather":
      // Opened, the forecast takes the width and keeps the remote until Back or Up.
      return expanded ? { w: EXPANDED_W, count: 1, across: 1, hold: true } : { w: PANEL_W, count: 1, across: 1 };
    case "calendar":
      return { w: PANEL_W, count: 1, across: 1 };
    case "list":
      return { w: LIST.w, count: c.items.length + (c.add ? 1 : 0), across: 1 };
    case "apps":
      return { w: APP.across * APP.w + (APP.across - 1) * APP.gap, count: c.apps.length, across: APP.across };
    case "videos":
      return { w: VIDEO.w, count: c.videos.length, across: 1 };
    case "folders":
      return { w: FOLDER.across * FOLDER.w + (FOLDER.across - 1) * FOLDER.gap, count: c.folders.length, across: FOLDER.across };
  }
}

/** Where each column starts in the row, and its shape for the remote; `expanded` is the open card, or -1. */
export function rowLayout(cols: readonly RowColumn[], expanded = -1): { x: number[]; w: number[]; nav: Column[]; width: number } {
  const x: number[] = [];
  const w: number[] = [];
  const nav: Column[] = [];
  let at = 0;
  cols.forEach((c, k) => {
    const s = columnShape(c, k === expanded);
    x.push(at);
    w.push(s.w);
    nav.push({ count: s.count, across: s.across, ...(s.rows ? { rows: s.rows } : {}), ...(s.hold ? { hold: true } : {}) });
    at += s.w + GAP;
  });
  return { x, w, nav, width: Math.max(0, at - GAP) };
}

/** Whether a column opens across the screen on OK: the media cards and the weather. */
export const expands = (c: RowColumn | undefined): boolean => c?.kind === "media" || c?.kind === "weather";

/** How tall a column's card is, for the ring around it while it is picked. */
export function columnHeight(c: RowColumn): number {
  switch (c.kind) {
    case "media":
      return collapsedShape(c.style).h;
    case "list":
      return c.items.length * (LIST.h + 18) + (c.add ? ADD_H : -18);
    case "apps":
      return Math.ceil(c.apps.length / APP.across) * (APP.h + APP.gap) - APP.gap;
    case "videos":
      return Math.max(1, c.videos.length) * (VIDEO.h + VIDEO.gap) - VIDEO.gap;
    case "folders":
      return Math.max(1, Math.ceil(c.folders.length / FOLDER.across)) * (FOLDER.h + FOLDER.gap) - FOLDER.gap;
    default:
      return CARD_H;
  }
}

/** Where item `i` of a column sits inside it, scroll included, for the glow behind a focused picture. */
export function itemBox(c: RowColumn, i: number, expanded = false): { x: number; y: number; w: number; h: number } | null {
  if (c.kind !== "media" || i < 0) return null;
  if (expanded) {
    const { r, x } = rowAt(expandedRows(c), i);
    const look = rowLook(c, r);
    const b = rowBox(look.shape, look.wide);
    const n = rowItems(c, r).length;
    // Each row's tiles sit at the top of its block, under its label (the first row's name is in the header).
    return { x: x * b.stride + b.lead - rowScroll(x, n, b.stride, b.w), y: r === 0 ? 0 : MORE.labelH, w: b.w - b.lead, h: b.h };
  }
  const s = collapsedShape(c.style);
  if (i >= Math.min(smallItems(c).length, s.count)) return null;
  const b = s.boxes[i];
  return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
}

interface ColumnProps {
  col: RowColumn;
  x: number;
  /** The on-screen position of the column's card (under its label), for the frost of glass surfaces inside it. */
  page: [number, number];
  /** The remote is on this card as a whole (left and right move between cards). */
  picked: boolean;
  /** Inside the card: the focused item; null when the remote is elsewhere. */
  focus: number | null;
  /** A menu is open on another card: this one steps back. */
  dim?: boolean;
  /** Another card is open across the screen: this one fades out, so no sliver of it shows at the edges. */
  away?: boolean;
  /** This card is being moved: lifted a little while Left and Right slide it along the row. */
  lifted?: boolean;
}

const dayName = (iso: string, k: number) =>
  k === 0 ? "Today" : new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" });

/** The weather card: now, and today's high and low. OK opens the forecast (WeatherDetail). */
function WeatherCard({ w, page, focused, out }: { w: Weather | null; page: [number, number]; focused: boolean; out: boolean }) {
  const today = w?.days?.[0];
  return (
    <div class={`nest-fold${out ? " is-out" : ""}`}>
      <Glass x={0} y={0} w={PANEL_W} h={CARD_H} page={page} focused={focused} class="nest-weather-card">
        {w ? (
          <>
            <div class="nest-wc-now">
              {w.glyph && <Icon name={w.glyph} size={96} />}
              <b>{w.tempC}°</b>
            </div>
            <div class="nest-wc-say">
              <b>{w.label}</b>
              {w.place && <small>{w.place}</small>}
              {today && (
                <small>
                  High {today.maxC}° · Low {today.minC}°
                </small>
              )}
            </div>
            <small class="nest-wc-hint">OK for the forecast</small>
          </>
        ) : (
          <small class="nest-wc-none">No weather yet</small>
        )}
      </Glass>
    </div>
  );
}

const WD = { now: 520, pad: 48 } as const;

/** The weather card opened: now on the left, the next hours and the next days beside it, on one glass panel. */
function WeatherDetail({ w, page }: { w: Weather | null; page: [number, number] }) {
  const hours = w?.hours ?? [];
  const days = w?.days ?? [];
  return (
    <div class="nest-rise">
      <Glass x={0} y={0} w={EXPANDED_W} h={CARD_H} page={page} class="nest-weather-detail">
        {w ? (
          <>
            <div class="nest-wd-now" style={{ width: `${WD.now}px` }}>
              {w.glyph && <Icon name={w.glyph} size={120} />}
              <b>{w.tempC}°</b>
              <span>{w.label}</span>
              {w.place && <small>{w.place}</small>}
            </div>
            <div class="nest-wd-side" style={{ left: `${WD.now + WD.pad}px` }}>
              <Kicker>Next hours</Kicker>
              <div class="nest-wd-hours">
                {hours.map((h) => (
                  <div key={h.hour}>
                    <small>{h.hour}h</small>
                    <Icon name={h.glyph} size={44} />
                    <b>{h.tempC}°</b>
                  </div>
                ))}
                {!hours.length && <small>No hourly forecast</small>}
              </div>
              <Kicker>Next days</Kicker>
              <div class="nest-wd-days">
                {days.map((d, k) => (
                  <div key={d.date}>
                    <small>{dayName(d.date, k)}</small>
                    <Icon name={d.glyph} size={44} />
                    <b>
                      {d.maxC}° <span>{d.minC}°</span>
                    </b>
                  </div>
                ))}
                {!days.length && <small>No daily forecast</small>}
              </div>
            </div>
          </>
        ) : (
          <small class="nest-wc-none">No weather yet</small>
        )}
      </Glass>
    </div>
  );
}

/** The calendar card: today's date and its month, Monday first, today marked. */
function CalendarCard({ date, page, focused }: { date: Date; page: [number, number]; focused: boolean }) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array.from({ length: lead }, () => 0), ...Array.from({ length: days }, (_, k) => k + 1)];
  return (
    <Glass x={0} y={0} w={PANEL_W} h={CARD_H} page={page} focused={focused} class="nest-calendar-card">
      <b>{date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</b>
      <small>{date.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</small>
      <div class="nest-cal-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, k) => (
          <i key={k} class="nest-cal-dow">
            {d}
          </i>
        ))}
        {cells.map((n, k) => (
          <i key={k} class={n === date.getDate() ? "nest-cal-today" : undefined}>
            {n || ""}
          </i>
        ))}
      </div>
    </Glass>
  );
}

/** The badge a media item shows: resuming says so (short on small tiles), others their own label. */
const badgeOf = (it: MediaItem, small: boolean) => (it.resume ? (small ? "▶" : "▶ Resume") : it.badge);

/** A media card folded: the items its style shows, as today's posters, stills or grid. */
function MediaSmall({ col, out }: { col: MediaColumn; out: boolean }) {
  const s = collapsedShape(col.style);
  const small = s.boxes[0] ? s.boxes[0].w < 200 : false;
  const keys = tileKeys(smallItems(col).slice(0, s.count));
  return (
    <div class={`nest-media-small${out ? " is-out" : ""}`}>
      {smallItems(col)
        .slice(0, s.count)
        .map((it, i) => {
          const b = s.boxes[i];
          const still = b.art === "still";
          return (
            <MediaTile
              key={keys[i]}
              x={b.x}
              y={b.y}
              w={b.w}
              h={b.h}
              src={still ? (it.still ?? it.poster) : it.poster}
              title={still ? it.title : undefined}
              sub={still ? it.sub : undefined}
              badge={badgeOf(it, small)}
              progress={it.progress}
            />
          );
        })}
    </div>
  );
}

/**
 * One row's tiles in the shape it is drawn in: the window in view, each rising in a beat after the one before it. Each
 * tile is keyed by its title (card-rows.ts tileKey), so a slot never shows one title's picture under another's caption.
 */
function Tiles({ items, box: b, scroll, at }: { items: MediaItem[]; box: TileBox; scroll: number; at: number }) {
  const from = Math.max(0, Math.floor(scroll / b.stride) - 1);
  const to = Math.min(items.length, from + Math.ceil(EXPANDED_W / b.stride) + 2);
  const keys = tileKeys(items);
  return (
    <>
      {Array.from({ length: to - from }, (_, k) => {
        const i = from + k;
        const it = items[i];
        const x = i * b.stride;
        return (
          <div key={keys[i]} class="nest-rise" style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}>
            {b.lead > 0 && (
              <span class={`nest-rank${at === i ? " is-focus" : ""}`} style={{ left: `${x}px`, top: 0, width: `${b.lead}px`, height: `${b.h}px` }}>
                {i + 1}
              </span>
            )}
            {b === WIDE_BOX ? (
              <LandscapeTile x={x} y={0} src={it.still ?? it.poster} title={it.title} sub={it.sub} badge={badgeOf(it, false)} progress={it.progress} focused={at === i} />
            ) : (
              <MediaTile
                x={x + b.lead}
                y={0}
                w={b.w - b.lead}
                h={b.h}
                src={b.art === "still" ? (it.still ?? it.poster) : it.poster}
                badge={badgeOf(it, false)}
                progress={it.progress}
                focused={at === i}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** The focused title's caption, fixed at the row's left edge under its tiles so the eye does not chase the focus. */
function Caption({ hit, top }: { hit: MediaItem; top: number }) {
  return <InfoPanel x={0} y={top} w={CAPTION_W} h={CAPTION.h} title={hit.title} meta={captionMeta(hit)} about={hit.about} />;
}

interface MoreBlockProps {
  label: string;
  items: MediaItem[];
  box: TileBox;
  top: number;
  gone: boolean;
  /** The row just under the focused one: shown dimmed as a peek of what Down reaches. */
  peek: boolean;
  /** The focused item of this row, or -1. */
  at: number;
  scroll: number;
}

/**
 * One row under the first, drawn as the first is: the same tiles, rising in when the row is reached, and the focused
 * title's caption under them. The row below the focused one is drawn dimmed, so the top of it shows under the caption.
 * Each key press re-renders the card, so a row repaints only when its own focus, scroll, place or titles changed
 * (docs/performance.md).
 */
class MoreBlock extends Component<MoreBlockProps> {
  shouldComponentUpdate(next: MoreBlockProps): boolean {
    const p = this.props;
    return (
      p.at !== next.at ||
      p.scroll !== next.scroll ||
      p.top !== next.top ||
      p.gone !== next.gone ||
      p.peek !== next.peek ||
      p.box !== next.box ||
      p.label !== next.label ||
      p.items.length !== next.items.length ||
      p.items.some((it, i) => it !== next.items[i] && (tileKey(it) !== tileKey(next.items[i]) || it.about !== next.items[i].about || it.sub !== next.items[i].sub))
    );
  }
  render({ label, items, box, top, gone, peek, at, scroll }: MoreBlockProps) {
    const hit = at >= 0 ? items[at] : undefined;
    return (
      <div class={`nest-more${gone ? " is-gone" : ""}${peek ? " is-peek" : ""}`} style={{ top: `${top}px` }}>
        <span class="nest-more-label">{label}</span>
        <Scroller x={0} y={MORE.labelH} w={EXPANDED_W} h={box.h} axis="x" offset={scroll}>
          <Tiles items={items} box={box} scroll={scroll} at={at} />
        </Scroller>
        {hit && <Caption hit={hit} top={MORE.labelH + box.h + CAPTION.top} />}
      </div>
    );
  }
}

/** A media card opened: its first row, then the rows under it as Down reaches them, then the end bar. */
function MediaRow({ col, focus: flat }: { col: MediaColumn; focus: number }) {
  const rows = expandedRows(col);
  // On the end bar the stack stays on the last row, with the bar under it where the next row would peek.
  const { r: on, x: onX, end } = onRow(col, flat);
  // Down moves to the rows under the first: the whole stack slides up by transform until that row is at the top.
  const offY = on === 0 ? 0 : moreTop(on - 1);
  const b = rowBox(col.shape, col.wide);
  const at = on === 0 ? onX : -1;
  const scroll = rowScroll(Math.max(0, at), col.items.length, b.stride, b.w);
  // The caption and the focused tile are the same title (card-rows.ts focusedItem).
  const hit = on === 0 ? focusedItem(col, flat) : undefined;
  const more = rowsOf(col);
  return (
    <div class="nest-stack" style={{ transform: `translate3d(0,${-offY}px,0)` }}>
      {/* The first row fades out as the stack slides up past it (opacity only). */}
      <div class={`nest-row0${on > 0 ? " is-gone" : ""}`}>
        <Scroller x={0} y={0} w={EXPANDED_W} h={b.h} axis="x" offset={scroll}>
          <Tiles items={col.items} box={b} scroll={scroll} at={at} />
        </Scroller>
        {hit && <Caption hit={hit} top={b.h + CAPTION.top} />}
      </div>
      {more.map((m, k) => {
        const r = k + 1;
        // The focused row, the one just left and the one just below (a peek) are drawn; a row is mounted as it
        // comes into view, so it rises in.
        if (r < on - 1 || r > on + 1) return null;
        const bm = rowBox(m.shape, m.wide);
        return (
          <MoreBlock
            key={m.label}
            label={m.label}
            items={m.items}
            box={bm}
            top={moreTop(k)}
            gone={r < on}
            peek={r > on}
            at={r === on ? onX : -1}
            scroll={rowScroll(r === on ? Math.max(0, onX) : 0, m.items.length, bm.stride, bm.w)}
          />
        );
      })}
      {on === rows.length - 1 && (
        <EndBar
          col={col}
          top={moreTop(on)}
          // Focused, the bar rises into the caption's place under the last row (no title is focused there); otherwise it
          // peeks where the next row would.
          lift={end ? moreTop(on) - (on === 0 ? 0 : moreTop(on - 1) + MORE.labelH) - rowBox(rowLook(col, on).shape, rowLook(col, on).wide).h - CAPTION.top : 0}
          focus={end ? flat : null}
          peek={!end}
        />
      )}
    </div>
  );
}

/** Under an opened card's last row: the end, with Back to top, Recommend me and See all, so Down never leaves the card. */
function EndBar({ col, top, lift, focus, peek }: { col: MediaColumn; top: number; lift: number; focus: number | null; peek: boolean }) {
  const line = recLine(col.recs, col.unit);
  const loading = col.recs?.status === "loading";
  return (
    <div class={`nest-end${peek ? " is-peek" : ""}${loading ? " is-loading" : ""}`} style={{ top: `${top}px`, transform: `translate3d(0,${-lift}px,0)` }}>
      <div class="nest-end-text">
        <b>{line.title}</b>
        <small>{line.sub}</small>
      </div>
      <Button label="↑ Back to top" focused={focus === END_TOP} />
      <Button label={loading ? "Asking…" : "✦ Recommend me"} primary focused={focus === END_RECOMMEND} />
      <span class="nest-end-small">
        <Button label="See all" focused={focus === END_ALL} />
      </span>
    </div>
  );
}

/** An opened card's header names where the remote is: the card and the row ("Cinema › My List"). */
function OpenHeader({ col, flat }: { col: RowColumn; flat: number }) {
  const where = col.kind === "media" ? rowTitle(col, flat) : col.kind === "weather" ? (col.weather?.place ?? "Forecast") : "";
  return (
    <>
      {col.kind === "media" ? col.name : col.label}
      {where && (
        <>
          <i class="nest-crumb">›</i>
          {where}
        </>
      )}
    </>
  );
}

export function RowCard({ col, x, page, picked, focus: inside, dim, away, lifted }: ColumnProps) {
  const at = (dx: number, dy: number): [number, number] => [page[0] + dx, page[1] + dy];
  const focus = inside ?? -2;
  const open = expands(col) && inside !== null;
  const w = columnShape(col).w;
  return (
    <div
      class={`nest-col nest-kind-${col.kind}${dim ? " is-dim" : ""}${away ? " is-away" : ""}${lifted ? " is-lifted" : ""}`}
      style={{ transform: `translate3d(${x}px,0,0)` }}
    >
      <span class={`nest-col-label${open ? " is-answer" : ""}`}>{open ? <OpenHeader col={col} flat={focus} /> : col.label}</span>
      {open && col.kind === "media" && !col.note && <span class="nest-col-hint">Hold OK on a title for options · Back to close</span>}
      {open && col.kind === "weather" && <span class="nest-col-hint">Back to close</span>}
      {open && col.kind === "media" && col.note && (
        <span class="nest-col-note">
          <b>“{col.note.prompt}”</b> {col.note.reply}
        </span>
      )}
      <div class="nest-col-body">
        {/* The whole card picked: a ring faded in on its own layer, nothing moves. */}
        <i class={`nest-col-ring${picked ? " is-on" : ""}`} style={{ width: `${w}px`, height: `${columnHeight(col)}px` }} />
        {col.kind === "media" && <MediaSmall col={col} out={open} />}
        {col.kind === "media" && open && <MediaRow col={col} focus={focus} />}
        {col.kind === "home" && (
          <Glass x={0} y={0} w={HOME_W} h={CARD_H} page={page} class="nest-home-card">
            <i class="nest-home-bulb" />
            <b>{col.title}</b>
            <small>{col.sub}</small>
            {col.actions.map((a, i) => (
              <span
                key={a.label}
                class={`nest-home-action${focus === i ? " is-focus" : ""}`}
                style={{ top: `${CARD_H - (col.actions.length - i) * (ACTION_H + 8) - 16}px` }}
              >
                <Icon name={a.icon} size={30} />
                {a.label}
              </span>
            ))}
          </Glass>
        )}
        {col.kind === "assistant" && (
          <Glass x={0} y={0} w={ASSIST_W} h={CARD_H} page={page} class="nest-assist-card">
            <b>{col.greeting}</b>
            {col.lines.map((l, k) => (
              <small key={k}>{l}</small>
            ))}
            <span class="nest-ac-hint">OK to talk</span>
          </Glass>
        )}
        {col.kind === "weather" && <WeatherCard w={col.weather} page={page} focused={false} out={open} />}
        {col.kind === "weather" && open && <WeatherDetail w={col.weather} page={page} />}
        {col.kind === "calendar" && <CalendarCard date={col.date} page={page} focused={focus === 0} />}
        {col.kind === "list" && (
          <>
            {col.items.map((it, i) => (
              <ListCard
                key={i}
                x={0}
                y={i * (LIST.h + 18)}
                w={LIST.w}
                h={LIST.h}
                page={at(0, i * (LIST.h + 18))}
                class={it.done ? "is-done" : undefined}
                title={it.title}
                sub={it.sub}
                meta={it.meta}
                color={it.color}
                focused={focus === i}
              />
            ))}
            {col.add && (
              <Glass
                x={0}
                y={col.items.length * (LIST.h + 18)}
                w={LIST.w}
                h={ADD_H}
                page={at(0, col.items.length * (LIST.h + 18))}
                focused={focus === col.items.length}
                class="nest-add"
              >
                <span>{col.add}</span>
              </Glass>
            )}
          </>
        )}
        {col.kind === "videos" &&
          col.videos.map((v, i) => (
            <MediaTile key={i} x={0} y={i * (VIDEO.h + VIDEO.gap)} w={VIDEO.w} h={VIDEO.h} src={v.thumb} title={v.title} sub={v.channel} focused={focus === i} />
          ))}
        {col.kind === "folders" &&
          col.folders.map((f, i) => (
            <MediaTile
              key={i}
              x={(i % FOLDER.across) * (FOLDER.w + FOLDER.gap)}
              y={Math.floor(i / FOLDER.across) * (FOLDER.h + FOLDER.gap)}
              w={FOLDER.w}
              h={FOLDER.h}
              src={f.cover ?? ""}
              title={f.title}
              focused={focus === i}
            />
          ))}
        {col.kind === "apps" &&
          col.apps.map((a, i) => {
            const ax = (i % APP.across) * (APP.w + APP.gap);
            const ay = Math.floor(i / APP.across) * (APP.h + APP.gap);
            return <AppChip key={i} x={ax} y={ay} w={APP.w} h={APP.h} page={at(ax, ay)} icon={a.icon} label={a.label} focused={focus === i} />;
          })}
      </div>
    </div>
  );
}
