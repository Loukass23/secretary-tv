// The content cards on Nest's home row (docs/launcher.md): one column per app, each laid out for what it holds, like
// the concept's "Playing Music", "Searching Places" and "Playing Netflix" cards. Layout only; app.tsx builds the columns
// and runs OK. Built on tv-kit glass, with hairlines and opacity/transform focus (docs/performance.md).
//
// A media card (Cinema, Shows, Anime, and each Nuvio collection) has a style the viewer picks with a long OK
// (card-style.ts). OK opens it in place into its rows (card-rows.ts) across the screen; the other cards fade out while it
// is open. A collection's first row is its folders and each folder's titles are a row under it (collections.ts). The
// weather card opens the same way, into its forecast.
import {
  AppChip,
  Button,
  Glass,
  Icon,
  type IconName,
  InfoPanel,
  Kicker,
  ListCard,
  MediaTile,
  RankNumber,
  Scroller,
  WAVE_ORB,
} from "@secretary/tv-kit/src/glass/index.ts";
import type { Weather } from "./assistant.ts";
import type { CatalogKind, SlimTitle } from "./apps.ts";
import { CAPTION, CAPTION_W, type CardStyle, collapsedShape, CONTINUE, EXPANDED_W, MORE, moreTop, rowScroll } from "./card-style.ts";
import { captionMeta, expandedRows, focusedItem, onRow, rowItems, rowsOf, rowTitle, targetAt, tileKey, tileKeys } from "./card-rows.ts";
import { stillArt } from "./card-covers.ts";
import { recLine, type RecState } from "./recommend.ts";
import { FOLDER_SCALE, type RowShape, type TileBox, tileBox } from "./row-look.ts";
import { Component } from "preact";
import { type Column, END_ALL, END_BUTTONS, END_RECOMMEND, END_TOP, rowAt } from "./nest-nav.ts";

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
  /** Its stylized logo (catalog-kit titleArt, Fanart.tv), drawn on landscape art in place of the name. */
  logo?: string;
  /** In progress, a show: the episode ("S1 · E5 · The Long Night"), on its Continue watching tile. */
  episode?: string;
  /** In progress: what is left ("23 min left"), on its Continue watching tile. */
  left?: string;
  /** Landscape art with no title painted in (catalog-kit titleArt `plain`). */
  plain?: string;
  /** `still` has the title's logo painted in (a Fanart.tv thumb). */
  stillHasLogo?: boolean;
  /** Its name is drawn on the art on every tile (a collection's folder: its cover may be only a picture). */
  named?: boolean;
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
      /** Continue watching lists episodes (Shows, Anime): its tiles are the bigger ones (card-style.ts CONTINUE). */
      episodes?: boolean;
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
      /** The bar's name for See all ("Open collection"). */
      allLabel?: string;
      /** What the bar says when the card has no Recommend me (a collection: its name and its folders). */
      endLine?: { title: string; sub?: string };
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
const HOME_W = 380;
/** The Home card's buttons (Cinema, Warm, Off, Music): four under its title and the bulb. */
const ACTION_H = 60;
const ASSIST_W = 440;
const PANEL_W = 460;

type MediaColumn = Extract<RowColumn, { kind: "media" }>;

/** The art of a Continue watching tile is 16:9; the bar and the episode line sit under it, inside the tile's box. */
const artH = (w: number) => Math.round((w * 9) / 16);
const continueBox = (w: number): TileBox => ({ w, h: artH(w) + CONTINUE.below, stride: w + CONTINUE.gap, art: "still", lead: 0, caption: true });
/** Continue watching tiles: the bigger one for episodes (Shows, Anime), the other for films. */
const CW_EPISODES = continueBox(CONTINUE.episodes);
const CW_FILMS = continueBox(CONTINUE.films);
const isContinue = (b: TileBox) => b === CW_EPISODES || b === CW_FILMS;
/** How a row draws its tiles: the look the viewer picked, else Continue watching tiles, else posters. */
const rowBox = (shape: RowShape | undefined, wide: boolean | undefined, episodes?: boolean, scale = 1): TileBox =>
  shape ? tileBox(shape, scale) : wide ? (episodes ? CW_EPISODES : CW_FILMS) : tileBox("poster", scale);
type Look = { shape?: RowShape; wide?: boolean; episodes?: boolean; folders?: boolean };
/** A first row of folders only (a collection card's): drawn smaller, at FOLDER_SCALE. */
const isFolderRow = (items: readonly MediaItem[]) => items.length > 0 && items.every((it) => it.named);
const rowLook = (c: MediaColumn, r: number): Look =>
  r === 0 ? { shape: c.shape, wide: c.wide, episodes: c.episodes, folders: isFolderRow(c.items) } : (rowsOf(c)[r - 1] ?? {});
const lookBox = (l: Look) => rowBox(l.shape, l.wide, l.episodes, l.folders ? FOLDER_SCALE : 1);
/** The first row's height: the rows under it start lower when it is Continue watching (card-style.ts moreTop). */
const firstH = (c: MediaColumn) => {
  const l = rowLook(c, 0);
  // A folders row has no caption under it (each tile names its folder): the rows under it move up into that room.
  return lookBox(l).h - (l.folders ? CAPTION.h : 0);
};
/** What the folded card shows. */
const smallItems = (c: MediaColumn): MediaItem[] => c.small ?? c.items;

/** The end bar's buttons, left to right: Recommend me only on a card that can ask for picks. */
export const endButtons = (c: MediaColumn): readonly number[] => (c.recommend ? END_BUTTONS : [END_ALL, END_TOP]);

/** How wide a column is and how its items run for the remote; an expanded media card is one long row. */
export function columnShape(c: RowColumn, expanded = false): { w: number } & Column {
  switch (c.kind) {
    case "media": {
      if (expanded) {
        const rows = expandedRows(c);
        return { w: EXPANDED_W, count: rows.reduce((s, n) => s + n, 0), across: rows[0], rows, ...(c.recommend ? {} : { ends: endButtons(c) }) };
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
    nav.push({ count: s.count, across: s.across, ...(s.rows ? { rows: s.rows } : {}), ...(s.hold ? { hold: true } : {}), ...(s.ends ? { ends: s.ends } : {}) });
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
    default:
      return CARD_H;
  }
}

/** Where item `i` of a column sits inside it, scroll included, for the glow behind a focused picture. */
export function itemBox(c: RowColumn, i: number, expanded = false): { x: number; y: number; w: number; h: number } | null {
  if (c.kind !== "media" || i < 0) return null;
  if (expanded) {
    const { r, x } = rowAt(expandedRows(c), i);
    const b = lookBox(rowLook(c, r));
    const n = rowItems(c, r).length;
    // Each row's tiles sit at the top of its block, under its label (the first row's name is in the header). The glow
    // sits behind a Continue watching tile's art only.
    return { x: x * b.stride + b.lead - rowScroll(x, n, b.stride, b.w), y: r === 0 ? 0 : MORE.labelH, w: b.w - b.lead, h: isContinue(b) ? artH(b.w) : b.h };
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
  /** Another card is picked: this one steps back a little, behind the one pushed in. */
  behind?: boolean;
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
            {(w.hours?.length ?? 0) > 0 && (
              <div class="nest-wc-hours">
                {w.hours!.slice(0, 4).map((h) => (
                  <div key={h.hour}>
                    <small>{h.hour}h</small>
                    <Icon name={h.glyph} size={36} />
                    <b>{h.tempC}°</b>
                  </div>
                ))}
              </div>
            )}
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
          const a = stillArt(it, b.w, b.h);
          return (
            <MediaTile
              key={keys[i]}
              x={b.x}
              y={b.y}
              w={b.w}
              h={b.h}
              src={still ? a.src : it.poster}
              title={it.named || (still && !a.painted) ? it.title : undefined}
              class={it.named ? "nest-named" : undefined}
              logo={still ? a.logo : undefined}
              sub={still ? (it.episode ?? it.sub) : undefined}
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
            {b.lead > 0 && <RankNumber x={x} w={b.lead} h={b.h} n={i + 1} focused={at === i} />}
            {isContinue(b) ? (
              <ContinueTile x={x} box={b} it={it} focused={at === i} />
            ) : (
              <MediaTile
                x={x + b.lead}
                y={0}
                w={b.w - b.lead}
                h={b.h}
                {...(b.art === "still" ? stillCaption(it, b.w - b.lead, b.h) : { src: it.poster })}
                {...(it.named ? { title: it.title, class: "nest-named" } : {})}
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

/** What a landscape tile draws on its art: the logo, and for a title in progress its name (under no logo) and where
 *  it is ("S1 · E5 · 23 min left"), on every tile and not only under the focused one. */
function stillCaption(it: MediaItem, w: number, h: number): { src: string; logo?: string; title?: string; sub?: string } {
  const a = stillArt(it, w, h);
  if (!it.resume) return { src: a.src, logo: a.logo };
  return { src: a.src, logo: a.logo, title: a.painted ? undefined : it.title, sub: [it.episode, it.left].filter(Boolean).join(" · ") || undefined };
}

const continueArt = (it: MediaItem, w: number, h: number) => {
  const a = stillArt(it, w, h);
  return { src: a.src, logo: a.logo, title: a.painted ? undefined : it.title };
};

/**
 * A Continue watching tile in an opened card: the landscape thumb with the title's logo (else its name) on it, then a
 * thick bar of how far in it is, and the episode and the time left on one line under the bar.
 */
function ContinueTile({ x, box, it, focused }: { x: number; box: TileBox; it: MediaItem; focused: boolean }) {
  const h = artH(box.w);
  const p = Math.max(0, Math.min(1, it.progress ?? 0));
  return (
    <>
      <MediaTile x={x} y={0} w={box.w} h={h} {...continueArt(it, box.w, h)} focused={focused} class="nest-cw-art" />
      <div class={`nest-cw-below${focused ? " is-focus" : ""}`} style={{ transform: `translate3d(${x}px,${h + 22}px,0)`, width: `${box.w}px` }}>
        <span class="nest-cw-bar">
          <i style={{ transform: `scaleX(${p})` }} />
        </span>
        <span class="nest-cw-line">
          <b>{it.episode ?? (it.resume ? "Resume" : it.sub)}</b>
          {it.left && <small>{it.left}</small>}
        </span>
      </div>
    </>
  );
}

/** The focused title's caption, fixed at the row's left edge under its tiles so the eye does not chase the focus. */
function Caption({ hit, top }: { hit: MediaItem; top: number }) {
  // A line of synopsis, ended with an ellipsis: at the couch-readable type size there is room for one under the name.
  return <InfoPanel x={0} y={top} w={CAPTION_W} h={CAPTION.h} title={hit.title} meta={captionMeta(hit)} about={hit.about} lines={1} />;
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
  // On the end bar the stack stays on the last row, with the bar in the place of that row's caption.
  const { r: on, x: onX, end } = onRow(col, flat);
  const fh = firstH(col);
  // Down moves to the rows under the first: the whole stack slides up by transform until that row is at the top.
  const offY = on === 0 ? 0 : moreTop(on - 1, fh);
  const b = lookBox(rowLook(col, 0));
  const at = on === 0 ? onX : -1;
  const scroll = rowScroll(Math.max(0, at), col.items.length, b.stride, b.w);
  // The caption and the focused tile are the same title (card-rows.ts focusedItem).
  const hit = on === 0 ? focusedItem(col, flat) : undefined;
  const more = rowsOf(col);
  // The end bar takes the last row's caption place, under its tiles, so it is never cut off by the screen's bottom.
  const endTop = (on === 0 ? 0 : moreTop(on - 1, fh) + MORE.labelH) + lookBox(rowLook(col, on)).h + CAPTION.top;
  return (
    <div class="nest-stack" style={{ transform: `translate3d(0,${-offY}px,0)` }}>
      {/* The first row fades out as the stack slides up past it (opacity only). */}
      <div class={`nest-row0${on > 0 ? " is-gone" : ""}`}>
        <Scroller x={0} y={0} w={EXPANDED_W} h={b.h} axis="x" offset={scroll}>
          <Tiles items={col.items} box={b} scroll={scroll} at={at} />
        </Scroller>
        {/* A folder's tile already says its name: no caption repeating it. */}
        {hit && !hit.named && <Caption hit={hit} top={b.h + CAPTION.top} />}
      </div>
      {more.map((m, k) => {
        const r = k + 1;
        // The focused row, the one just left and the one just below (a peek) are drawn; a row is mounted as it
        // comes into view, so it rises in.
        if (r < on - 1 || r > on + 1) return null;
        const bm = lookBox(m);
        return (
          <MoreBlock
            key={m.label}
            label={m.label}
            items={m.items}
            box={bm}
            top={moreTop(k, fh)}
            gone={r < on}
            peek={r > on}
            at={r === on ? onX : -1}
            scroll={rowScroll(r === on ? Math.max(0, onX) : 0, m.items.length, bm.stride, bm.w)}
          />
        );
      })}
      {end && on === rows.length - 1 && <EndBar col={col} top={endTop} focus={flat} />}
    </div>
  );
}

/**
 * Under an opened card's last row, reached with Down: the assistant's orb and its words, as at the bottom of the home,
 * offering Recommend me; then See all (the catalog home) and Back to top. Down never leaves the card.
 */
function EndBar({ col, top, focus }: { col: MediaColumn; top: number; focus: number }) {
  // A card with no picks to ask for (a collection) says what it is, and its See all leads.
  const asks = !!col.recommend;
  const line = asks ? recLine(col.recs, col.unit) : (col.endLine ?? { title: col.name });
  const loading = col.recs?.status === "loading";
  return (
    <div class={`nest-end${loading ? " is-loading" : ""}`} style={{ top: `${top}px` }}>
      <i class="nest-end-orb" style={{ backgroundImage: WAVE_ORB }} />
      <div class="nest-end-text">
        <b>{line.title}</b>
        {line.sub && <small>{line.sub}</small>}
      </div>
      {asks && <Button label={loading ? "Asking…" : "✦ Recommend me"} primary focused={focus === END_RECOMMEND} />}
      {asks && <span class="nest-end-gap" />}
      <Button label={col.allLabel ?? "See all"} primary={!asks} focused={focus === END_ALL} />
      <span class="nest-end-top">
        <Button label="↑ Back to top" focused={focus === END_TOP} />
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

export function RowCard({ col, x, page, picked, focus: inside, dim, away, lifted, behind }: ColumnProps) {
  const at = (dx: number, dy: number): [number, number] => [page[0] + dx, page[1] + dy];
  const focus = inside ?? -2;
  const open = expands(col) && inside !== null;
  const w = columnShape(col).w;
  const h = columnHeight(col);
  return (
    <div
      class={`nest-col nest-kind-${col.kind}${dim ? " is-dim" : ""}${away ? " is-away" : ""}${lifted ? " is-lifted" : ""}${picked ? " is-picked" : ""}${behind ? " is-behind" : ""}`}
      style={{ transform: `translate3d(${x}px,0,0)` }}
    >
      <span class={`nest-col-label${open ? " is-answer" : ""}`}>{open ? <OpenHeader col={col} flat={focus} /> : col.label}</span>
      {open && col.kind === "media" && col.note && (
        <span class="nest-col-note">
          <b>“{col.note.prompt}”</b> {col.note.reply}
        </span>
      )}
      {/* Sized as the folded card, so the push-in scales it about its own centre. */}
      <div class="nest-col-body" style={{ width: `${w}px`, height: `${h}px` }}>
        {/* The whole card picked: pushed in a little towards the viewer (transform, style.css), its ring faded in. */}
        <i class={`nest-col-ring${picked ? " is-on" : ""}`} style={{ width: `${w}px`, height: `${h}px` }} />
        {col.kind === "media" && <MediaSmall col={col} out={open} />}
        {/* Opened, the rows open out of the card's place: scale and opacity from its top left (style.css nest-open-in). */}
        {col.kind === "media" && open && (
          <div class="nest-open-in">
            <MediaRow col={col} focus={focus} />
          </div>
        )}
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
          </Glass>
        )}
        {col.kind === "weather" && <WeatherCard w={col.weather} page={page} focused={false} out={open} />}
        {col.kind === "weather" && open && (
          <div class="nest-open-in">
            <WeatherDetail w={col.weather} page={page} />
          </div>
        )}
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
