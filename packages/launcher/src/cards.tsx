// The content cards on Nest's home row (docs/launcher.md): one column per app, each laid out for what it holds, like
// the concept's "Playing Music", "Searching Places" and "Playing Netflix" cards. Layout only; app.tsx builds the columns
// and runs OK. Built on tv-kit glass, with hairlines and opacity/transform focus (docs/performance.md).
//
// A media card (Cinema, Shows, Anime) has a style the viewer picks with a long OK (card-style.ts). OK expands it in
// place into one row of all its titles and the app's Open tile; the cards after it slide aside by transform.
import { AppChip, Glass, ListCard, MediaTile, Scroller } from "@secretary/tv-kit/src/glass/index.ts";
import { type CardStyle, collapsedShape, EXPANDED, EXPANDED_W, expandedScroll } from "./card-style.ts";
import type { Column } from "./nest-nav.ts";

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
}

export interface ListItem {
  title: string;
  sub?: string;
  meta?: string;
  color?: string;
  done?: boolean;
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
      /** The last tile of the expanded card: opens the app itself. */
      open: { label: string; run: () => void };
    }
  | { kind: "home"; title: string; sub: string; actions: string[] }
  | { kind: "list"; items: ListItem[]; add?: string }
  | { kind: "apps"; apps: { icon?: string; label: string }[] }
);

/** Card height: the tallest layout fills it, the others sit at its top. */
export const CARD_H = 540;
/** Room for the column's label above its card. */
export const LABEL_H = 54;
const GAP = 48;
const LIST = { w: 420, h: 136 };
const ADD_H = 76;
const APP = { w: 176, h: 160, gap: 18, across: 2 };
const HOME_W = 380;
const ACTION_H = 72;

/** How wide a column is and how its items run for the remote; an expanded media card is one long row. */
export function columnShape(c: RowColumn, expanded = false): { w: number } & Column {
  switch (c.kind) {
    case "media": {
      if (expanded) return { w: EXPANDED_W, count: c.items.length + 1, across: c.items.length + 1 };
      const s = collapsedShape(c.style);
      return { w: s.w, count: Math.min(c.items.length, s.count), across: s.across };
    }
    case "home":
      return { w: HOME_W, count: c.actions.length, across: 1 };
    case "list":
      return { w: LIST.w, count: c.items.length + (c.add ? 1 : 0), across: 1 };
    case "apps":
      return { w: APP.across * APP.w + (APP.across - 1) * APP.gap, count: c.apps.length, across: APP.across };
  }
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
    nav.push({ count: s.count, across: s.across });
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
    default:
      return CARD_H;
  }
}

/** Where item `i` of a column sits inside it, scroll included, for the glow behind a focused picture. */
export function itemBox(c: RowColumn, i: number, expanded = false): { x: number; y: number; w: number; h: number } | null {
  if (c.kind !== "media" || i < 0 || i >= c.items.length) return null;
  if (expanded) {
    const n = c.items.length + 1;
    return { x: i * EXPANDED.stride - expandedScroll(i, n), y: 0, w: EXPANDED.w, h: EXPANDED.h };
  }
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

/** A media card opened: every title in one row, then the app's Open tile; they rise in one after another. */
function MediaRow({ col, focus, page }: { col: Extract<RowColumn, { kind: "media" }>; focus: number; page: [number, number] }) {
  const n = col.items.length + 1;
  const at = Math.max(0, Math.min(focus, n - 1));
  const scroll = expandedScroll(at, n);
  // Everything in view, from the scroll (a row of 8 and Open is drawn whole), plus one each side.
  const from = Math.max(0, Math.floor(scroll / EXPANDED.stride) - 1);
  const to = Math.min(n, from + Math.ceil(EXPANDED_W / EXPANDED.stride) + 2);
  const hit = col.items[at];
  return (
    <>
      <Scroller x={0} y={0} w={EXPANDED_W} h={EXPANDED.h} axis="x" offset={scroll}>
        {Array.from({ length: to - from }, (_, k) => {
          const i = from + k;
          const x = i * EXPANDED.stride;
          const rise = { animationDelay: `${Math.min(i, 7) * 30}ms` };
          if (i === col.items.length) {
            return (
              <div key="open" class="nest-rise" style={rise}>
                <Glass x={x} y={0} w={EXPANDED.w} h={EXPANDED.h} page={[page[0] + x - scroll, page[1]]} focused={focus === i} class="nest-open">
                  <b>{col.open.label}</b>
                  <small>All {col.unit} in the app</small>
                </Glass>
              </div>
            );
          }
          const it = col.items[i];
          return (
            <div key={i} class="nest-rise" style={rise}>
              <MediaTile x={x} y={0} w={EXPANDED.w} h={EXPANDED.h} src={it.poster} badge={badgeOf(it, false)} progress={it.progress} focused={focus === i} />
            </div>
          );
        })}
      </Scroller>
      {hit && (
        <div class="nest-result-cap is-on" style={{ left: 0, top: 0, transform: `translate3d(${at * EXPANDED.stride - scroll}px,${EXPANDED.h + 30}px,0)` }}>
          <b>{hit.title}</b>
          {hit.sub && <small>{hit.sub}</small>}
        </div>
      )}
    </>
  );
}

export function RowCard({ col, x, page, picked, focus: inside, dim }: ColumnProps) {
  const at = (dx: number, dy: number): [number, number] => [page[0] + dx, page[1] + dy];
  const focus = inside ?? -2;
  const open = col.kind === "media" && inside !== null;
  const w = columnShape(col).w;
  return (
    <div class={`nest-col${dim ? " is-dim" : ""}`} style={{ transform: `translate3d(${x}px,0,0)` }}>
      <span class={`nest-col-label${open ? " is-answer" : ""}`}>
        {open && col.kind === "media" ? `${col.name} · ${col.items.length} ${col.unit}` : col.label}
      </span>
      <div class="nest-col-body">
        {/* The whole card picked: a ring faded in on its own layer, nothing moves. */}
        <i class={`nest-col-ring${picked ? " is-on" : ""}`} style={{ width: `${w}px`, height: `${columnHeight(col)}px` }} />
        {col.kind === "media" && <MediaSmall col={col} focus={-2} out={open} />}
        {col.kind === "media" && open && <MediaRow col={col} focus={focus} page={page} />}
      {col.kind === "home" && (
        <Glass x={0} y={0} w={HOME_W} h={CARD_H} page={page} class="nest-home-card">
          <i class="nest-home-bulb" />
          <b>{col.title}</b>
          <small>{col.sub}</small>
          {col.actions.map((a, i) => (
            <span
              key={a}
              class={`nest-home-action${focus === i ? " is-focus" : ""}`}
              style={{ top: `${CARD_H - (col.actions.length - i) * (ACTION_H + 12) - 16}px` }}
            >
              {a}
            </span>
          ))}
        </Glass>
      )}
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
