// The content cards on Nest's home row (docs/launcher.md): one column per app, each laid out for what it holds, like
// the concept's "Playing Music", "Searching Places" and "Playing Netflix" cards. Layout only; app.tsx builds the columns
// and runs OK. Built on tv-kit glass, with hairlines and opacity/transform focus (docs/performance.md).
//
// A media card (Cinema, Shows, Anime) has a style the viewer picks with a long OK (card-style.ts). OK expands it in
// place into one row of all its titles and the app's Open tile; the cards after it slide aside by transform.
import { AppChip, Glass, Icon, type IconName, ListCard, MediaTile, Scroller } from "@secretary/tv-kit/src/glass/index.ts";
import type { Weather } from "./assistant.ts";
import type { CatalogKind, SlimTitle } from "./apps.ts";
import { CAPTION, CAPTION_W, type CardStyle, collapsedShape, EXPANDED, EXPANDED_W, MORE, moreTop, rowScroll } from "./card-style.ts";
import { type RowShape, tileBox } from "./row-look.ts";
import { Component } from "preact";
import { atEnd, type Column, END_BROWSE, END_TOP, rowAt } from "./nest-nav.ts";

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
}

/** A row under the picks in an opened media card (My List, a genre): `run(i)` opens its item `i`. */
export interface MoreRow {
  label: string;
  items: MediaItem[];
  run: (i: number) => void;
  /** How the row draws its tiles (row-look.ts). */
  shape?: RowShape;
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
      items: MediaItem[];
      style: CardStyle;
      /** The first row's own name once the card is open ("Continue watching", "Tonight's picks"). */
      heading?: string;
      /** How the first row draws its tiles (row-look.ts). */
      shape?: RowShape;
      /** What the assistant understood and did, shown beside the label while the card holds its suggestions. */
      note?: { prompt: string; reply: string };
      /** Rows under the picks once the card is opened (Down): My List, then the genres. */
      more?: MoreRow[];
      /** The title behind tile `i` of the opened card, for its long-OK menu; null for the Open tile and the rows under. */
      target?: (i: number) => TileTarget | null;
      /** Browse all on the bar under the last row: the whole catalog of this kind. */
      browseAll?: () => void;
    }
  | { kind: "home"; title: string; sub: string; actions: { icon: IconName; label: string }[] }
  // The assistant's own card, first in the row: what it has for the day. OK opens the full chat.
  | { kind: "assistant"; greeting: string; lines: string[] }
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

/** How wide a column is and how its items run for the remote; an expanded media card is one long row. */
export function columnShape(c: RowColumn, expanded = false): { w: number } & Column {
  switch (c.kind) {
    case "media": {
      if (expanded) {
        const rows = expandedRows(c);
        return { w: EXPANDED_W, count: rows.reduce((s, n) => s + n, 0), across: rows[0], rows };
      }
      const s = collapsedShape(c.style);
      return { w: s.w, count: Math.min(c.items.length, s.count), across: s.across };
    }
    case "home":
      return { w: HOME_W, count: c.actions.length, across: 1 };
    case "assistant":
      return { w: ASSIST_W, count: 1, across: 1 };
    case "weather":
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

/** An opened media card's rows: the picks and the Open tile, then each extra row's items. */
export const expandedRows = (c: Extract<RowColumn, { kind: "media" }>): number[] => [c.items.length, ...(c.more ?? []).filter((m) => m.items.length).map((m) => m.items.length)];

type MediaColumn = Extract<RowColumn, { kind: "media" }>;
const rowsOf = (c: MediaColumn): MoreRow[] => (c.more ?? []).filter((m) => m.items.length);

/** The title behind item `i` of an opened media card (a pick, or a title in a row under them). */
export function targetAt(c: MediaColumn, i: number): TileTarget | null {
  if (i < 0) return null;
  const { r, x } = rowAt(expandedRows(c), i);
  return (r === 0 ? c.target?.(x) : rowsOf(c)[r - 1]?.target?.(x)) ?? null;
}

/** What an opened card calls the row it is on, for the header: the picks' own name, else the extra row's label. */
export function rowTitle(c: MediaColumn, r: number): { title: string; count: number } {
  return r === 0 ? { title: c.heading ?? c.label, count: c.items.length } : { title: rowsOf(c)[r - 1].label, count: rowsOf(c)[r - 1].items.length };
}

/** Where each column starts in the row, and its shape for the remote; `expanded` is the open media card, or -1. */
export function rowLayout(cols: readonly RowColumn[], expanded = -1): { x: number[]; w: number[]; nav: Column[]; width: number } {
  const x: number[] = [];
  const w: number[] = [];
  const nav: Column[] = [];
  let at = 0;
  cols.forEach((c, k) => {
    const s = columnShape(c, k === expanded);
    x.push(at);
    w.push(s.w);
    nav.push({ count: s.count, across: s.across, ...(s.rows ? { rows: s.rows } : {}) });
    at += s.w + GAP;
  });
  return { x, w, nav, width: Math.max(0, at - GAP) };
}

/** Whether a column expands on OK. */
export const expands = (c: RowColumn | undefined): boolean => c?.kind === "media";

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
    const row = r === 0 ? { shape: c.shape, n: c.items.length } : { shape: rowsOf(c)[r - 1].shape, n: rowsOf(c)[r - 1].items.length };
    const b = tileBox(row.shape ?? "poster");
    return { x: x * b.stride + b.lead - rowScroll(x, row.n, b.stride, b.w), y: (r === 0 ? 0 : MORE.labelH) + EXPANDED.h - b.h, w: b.w - b.lead, h: b.h };
  }
  if (i >= c.items.length) return null;
  const b = collapsedShape(c.style).boxes[i];
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
  /** Another card is open: this one steps back. */
  dim?: boolean;
  /** This card is being moved: lifted a little while Left and Right slide it along the row. */
  lifted?: boolean;
}

const dayName = (iso: string, k: number) =>
  k === 0 ? "Today" : new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

/** The weather card: now, the next hours and the next days. */
function WeatherCard({ w, page, focused }: { w: Weather | null; page: [number, number]; focused: boolean }) {
  return (
    <Glass x={0} y={0} w={PANEL_W} h={CARD_H} page={page} focused={focused} class="nest-weather-card">
      {w ? (
        <>
          <div class="nest-wc-now">
            {w.glyph && <Icon name={w.glyph} size={84} />}
            <b>{w.tempC}°</b>
            <div>
              <small>{w.label}</small>
              {w.place && <small>{w.place}</small>}
            </div>
          </div>
          <div class="nest-wc-hours">
            {(w.hours ?? []).slice(0, 5).map((h) => (
              <div key={h.hour}>
                <small>{h.hour}h</small>
                {h.glyph && <Icon name={h.glyph} size={36} />}
                <b>{h.tempC}°</b>
              </div>
            ))}
          </div>
          <div class="nest-wc-days">
            {(w.days ?? []).slice(0, 4).map((d, k) => (
              <div key={d.date}>
                <small>{dayName(d.date, k)}</small>
                {d.glyph && <Icon name={d.glyph} size={34} />}
                <b>
                  {d.maxC}° <span>{d.minC}°</span>
                </b>
              </div>
            ))}
          </div>
        </>
      ) : (
        <small class="nest-wc-none">No weather yet</small>
      )}
    </Glass>
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
function MediaSmall({ col, focus, out }: { col: Extract<RowColumn, { kind: "media" }>; focus: number; out: boolean }) {
  const s = collapsedShape(col.style);
  const small = s.boxes[0] ? s.boxes[0].w < 200 : false;
  return (
    <div class={`nest-media-small${out ? " is-out" : ""}`}>
      {col.items.slice(0, s.count).map((it, i) => {
        const b = s.boxes[i];
        const still = b.art === "still";
        return (
          <MediaTile
            key={i}
            x={b.x}
            y={b.y}
            w={b.w}
            h={b.h}
            src={still ? (it.still ?? it.poster) : it.poster}
            title={still ? it.title : undefined}
            sub={still ? it.sub : undefined}
            badge={badgeOf(it, small)}
            progress={it.progress}
            focused={focus === i}
          />
        );
      })}
    </div>
  );
}

interface MoreBlockProps {
  label: string;
  items: MediaItem[];
  shape: RowShape;
  top: number;
  gone: boolean;
  /** The row just under the focused one: shown dimmed as a peek of what Down reaches. */
  peek: boolean;
  /** The focused item of this row, or -1. */
  at: number;
  scroll: number;
}

/** One row's tiles in the shape it is drawn in: the window in view, each rising in a beat after the one before it. */
function Tiles({ items, shape, scroll, at }: { items: MediaItem[]; shape: RowShape; scroll: number; at: number }) {
  const b = tileBox(shape);
  const from = Math.max(0, Math.floor(scroll / b.stride) - 1);
  const to = Math.min(items.length, from + Math.ceil(EXPANDED_W / b.stride) + 2);
  return (
    <>
      {Array.from({ length: to - from }, (_, k) => {
        const i = from + k;
        const it = items[i];
        const x = i * b.stride;
        const y = EXPANDED.h - b.h;
        return (
          <div key={i} class="nest-rise" style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}>
            {b.lead > 0 && (
              <span class={`nest-rank${at === i ? " is-focus" : ""}`} style={{ left: `${x}px`, top: `${y}px`, width: `${b.lead}px`, height: `${b.h}px` }}>
                {i + 1}
              </span>
            )}
            <MediaTile
              x={x + b.lead}
              y={y}
              w={b.w - b.lead}
              h={b.h}
              src={b.art === "still" ? (it.still ?? it.poster) : it.poster}
              badge={badgeOf(it, false)}
              progress={it.progress}
              focused={at === i}
            />
          </div>
        );
      })}
    </>
  );
}

/** The focused title's caption, a fixed panel at the row's left edge so the eye does not chase the focus. */
function Caption({ hit, top }: { hit: MediaItem; top: number }) {
  return (
    <div class="nest-result-cap nest-media-cap is-on" style={{ left: 0, top: `${top}px`, width: `${CAPTION_W}px`, height: `${CAPTION.h}px` }}>
      <b>{hit.title}</b>
      {hit.sub && <small>{hit.sub}</small>}
      {hit.about && <p>{hit.about}</p>}
    </div>
  );
}

/**
 * One row under the picks, drawn as the picks row is: the same tiles, rising in when the row is reached, and the
 * focused title's caption under them. The row below the focused one is drawn dimmed, so the top of it shows under the
 * caption. Each key press re-renders the card, so a row repaints only when its own focus, scroll, place or titles
 * changed (docs/performance.md).
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
      p.shape !== next.shape ||
      p.label !== next.label ||
      p.items.length !== next.items.length ||
      p.items.some((it, i) => it.poster !== next.items[i].poster || it.title !== next.items[i].title)
    );
  }
  render({ label, items, shape, top, gone, peek, at, scroll }: MoreBlockProps) {
    const hit = at >= 0 ? items[at] : undefined;
    return (
      <div class={`nest-more${gone ? " is-gone" : ""}${peek ? " is-peek" : ""}`} style={{ top: `${top}px` }}>
        <span class="nest-more-label">
          {label}
          <em>{items.length}</em>
        </span>
        <Scroller x={0} y={MORE.labelH} w={EXPANDED_W} h={EXPANDED.h} axis="x" offset={scroll}>
          <Tiles items={items} shape={shape} scroll={scroll} at={at} />
        </Scroller>
        {hit && <Caption hit={hit} top={MORE.labelH + EXPANDED.h + CAPTION.top} />}
      </div>
    );
  }
}

/** A media card opened: every title in one row; they rise in one after another. Down reaches the rows under them. */
function MediaRow({ col, focus: flat }: { col: Extract<RowColumn, { kind: "media" }>; focus: number }) {
  const rows = expandedRows(col);
  // On the end bar the stack stays on the last row, with the bar under it where the next row would peek.
  const end = atEnd(flat);
  const { r: onRow0, x: onX0 } = rowAt(rows, Math.max(0, flat));
  const onRow = end ? rows.length - 1 : onRow0;
  const onX = end ? -1 : onX0;
  // Down moves to the rows under the picks: the whole stack slides up by transform until that row is at the top.
  const offY = onRow === 0 ? 0 : moreTop(onRow - 1);
  const b = tileBox(col.shape ?? "poster");
  const at = onRow === 0 && !end ? Math.max(0, Math.min(flat, col.items.length - 1)) : -2;
  const scroll = rowScroll(Math.max(0, at), col.items.length, b.stride, b.w);
  const hit = onRow === 0 ? col.items[at] : undefined;
  const more = rowsOf(col);
  return (
    <div class="nest-stack" style={{ transform: `translate3d(0,${-offY}px,0)` }}>
      {/* The picks fade out as the stack slides up past them (opacity only). */}
      <div class={`nest-row0${onRow > 0 ? " is-gone" : ""}`}>
        <Scroller x={0} y={0} w={EXPANDED_W} h={EXPANDED.h} axis="x" offset={scroll}>
          <Tiles items={col.items} shape={col.shape ?? "poster"} scroll={scroll} at={onRow === 0 ? at : -2} />
        </Scroller>
        {hit && <Caption hit={hit} top={EXPANDED.h + CAPTION.top} />}
      </div>
      {more.map((m, k) => {
        const r = k + 1;
        // The focused row, the one just left and the one just below (a peek) are drawn; a row is mounted as it
        // comes into view, so it rises in.
        if (r < onRow - 1 || r > onRow + 1) return null;
        const bm = tileBox(m.shape ?? "poster");
        return (
          <MoreBlock
            key={m.label}
            label={m.label}
            items={m.items}
            shape={m.shape ?? "poster"}
            top={moreTop(k)}
            gone={r < onRow}
            peek={r > onRow}
            at={r === onRow ? onX : -1}
            scroll={rowScroll(r === onRow ? Math.max(0, onX) : 0, m.items.length, bm.stride, bm.w)}
          />
        );
      })}
      {onRow === rows.length - 1 && <EndBar top={moreTop(rows.length - 1)} focus={end ? flat : null} peek={!end} />}
    </div>
  );
}

/** Under an opened card's last row: the end, with Back to top and Browse all, so Down never leaves the card. */
function EndBar({ top, focus, peek }: { top: number; focus: number | null; peek: boolean }) {
  return (
    <div class={`nest-end${peek ? " is-peek" : ""}`} style={{ top: `${top}px` }}>
      <div class="nest-end-text">
        <b>You're all caught up</b>
        <small>That's every row in this card</small>
      </div>
      <span class={`nest-end-btn${focus === END_TOP ? " is-focus" : ""}`}>↑ Back to top</span>
      <span class={`nest-end-btn${focus === END_BROWSE ? " is-focus" : ""}`}>⌕ Browse all</span>
    </div>
  );
}

/** An opened card's header names where the remote is: the card, the row and how many titles it holds ("Cinema › My List · 12 films"). */
function MediaHeader({ col, flat }: { col: MediaColumn; flat: number }) {
  const { r } = rowAt(expandedRows(col), Math.max(0, flat));
  const { title, count } = rowTitle(col, r);
  return (
    <>
      {col.name}
      <i class="nest-crumb">›</i>
      {title}
      <em>
        {count} {col.unit}
      </em>
    </>
  );
}

export function RowCard({ col, x, page, picked, focus: inside, dim, lifted }: ColumnProps) {
  const at = (dx: number, dy: number): [number, number] => [page[0] + dx, page[1] + dy];
  const focus = inside ?? -2;
  const open = col.kind === "media" && inside !== null;
  const w = columnShape(col).w;
  return (
    <div class={`nest-col nest-kind-${col.kind}${dim ? " is-dim" : ""}${lifted ? " is-lifted" : ""}`} style={{ transform: `translate3d(${x}px,0,0)` }}>
      <span class={`nest-col-label${open ? " is-answer" : ""}`}>
        {open && col.kind === "media" ? <MediaHeader col={col} flat={focus} /> : col.label}
      </span>
      {open && col.kind === "media" && !col.note && <span class="nest-col-hint">Hold OK on a title for options · Back to close</span>}
      {open && col.kind === "media" && col.note && (
        <span class="nest-col-note">
          <b>“{col.note.prompt}”</b> {col.note.reply}
        </span>
      )}
      <div class="nest-col-body">
        {/* The whole card picked: a ring faded in on its own layer, nothing moves. */}
        <i class={`nest-col-ring${picked ? " is-on" : ""}`} style={{ width: `${w}px`, height: `${columnHeight(col)}px` }} />
        {col.kind === "media" && <MediaSmall col={col} focus={-2} out={open} />}
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
      {col.kind === "weather" && <WeatherCard w={col.weather} page={page} focused={focus === 0} />}
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
