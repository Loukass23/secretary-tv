// The content cards on Nest's home row (docs/launcher.md): one column per app, each laid out for what it holds, like
// the concept's "Playing Music", "Searching Places" and "Playing Netflix" cards. Layout only; app.tsx builds the columns
// and runs OK. Built on tv-kit glass, with hairlines and opacity/transform focus (docs/performance.md).
import { AppChip, Glass, ListCard, MediaTile } from "@secretary/tv-kit/src/glass/index.ts";
import type { Column } from "./nest-nav.ts";

export interface Tile {
  src: string;
  title?: string;
  sub?: string;
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

/** One column of the row; `run(i)` is what OK does on its item `i`. */
export type RowColumn = { key: string; label: string; run: (i: number) => void } & (
  | { kind: "poster"; tile: Tile }
  | { kind: "stack"; tiles: Tile[] }
  | { kind: "grid"; tiles: Tile[] }
  | { kind: "home"; title: string; sub: string; actions: string[] }
  | { kind: "list"; items: ListItem[]; add?: string }
  | { kind: "apps"; apps: { icon?: string; label: string }[] }
);

/** Card height: the tallest layout fills it, the others sit at its top. */
export const CARD_H = 420;
/** Room for the column's label above its card. */
export const LABEL_H = 44;
const GAP = 44;
const STACK_GAP = 18;
const POSTER = { w: 280, h: CARD_H };
const STACK = { w: 340, h: (CARD_H - STACK_GAP) / 2 };
const GRID = { w: 112, h: 168, gap: 12, across: 3 };
const LIST = { w: 320, h: 108 };
const ADD_H = 60;
const APP = { w: 140, h: 128, gap: 14, across: 2 };
const HOME_W = 300;
const ACTION_H = 58;

/** How wide a column is and how its items run for the remote. */
export function columnShape(c: RowColumn): { w: number } & Column {
  switch (c.kind) {
    case "poster":
      return { w: POSTER.w, count: 1, across: 1 };
    case "stack":
      return { w: STACK.w, count: c.tiles.length, across: 1 };
    case "grid":
      return { w: GRID.across * GRID.w + (GRID.across - 1) * GRID.gap, count: c.tiles.length, across: GRID.across };
    case "home":
      return { w: HOME_W, count: c.actions.length, across: 1 };
    case "list":
      return { w: LIST.w, count: c.items.length + (c.add ? 1 : 0), across: 1 };
    case "apps":
      return { w: APP.across * APP.w + (APP.across - 1) * APP.gap, count: c.apps.length, across: APP.across };
  }
}

/** Where each column starts in the row, and its shape for the remote. */
export function rowLayout(cols: readonly RowColumn[]): { x: number[]; w: number[]; nav: Column[]; width: number } {
  const x: number[] = [];
  const w: number[] = [];
  const nav: Column[] = [];
  let at = 0;
  for (const c of cols) {
    const s = columnShape(c);
    x.push(at);
    w.push(s.w);
    nav.push({ count: s.count, across: s.across });
    at += s.w + GAP;
  }
  return { x, w, nav, width: Math.max(0, at - GAP) };
}

/** Where item `i` of a column sits inside it, for the glow behind a focused picture. */
export function itemBox(c: RowColumn, i: number): { x: number; y: number; w: number; h: number } | null {
  switch (c.kind) {
    case "poster":
      return { x: 0, y: 0, ...POSTER };
    case "stack":
      return { x: 0, y: i * (STACK.h + STACK_GAP), w: STACK.w, h: STACK.h };
    case "grid":
      return { x: (i % GRID.across) * (GRID.w + GRID.gap), y: Math.floor(i / GRID.across) * (GRID.h + GRID.gap), w: GRID.w, h: GRID.h };
    default:
      return null;
  }
}

interface ColumnProps {
  col: RowColumn;
  x: number;
  /** The on-screen position of the column's card (under its label), for the frost of glass surfaces inside it. */
  page: [number, number];
  /** The focused item, or -1. */
  focus: number;
}

export function RowCard({ col, x, page, focus }: ColumnProps) {
  const at = (dx: number, dy: number): [number, number] => [page[0] + dx, page[1] + dy];
  return (
    <div class="nest-col" style={{ left: `${x}px`, top: 0 }}>
      <span class="nest-col-label">{col.label}</span>
      <div class="nest-col-body">
      {col.kind === "poster" && (
        <MediaTile x={0} y={0} w={POSTER.w} h={POSTER.h} {...col.tile} focused={focus === 0} />
      )}
      {col.kind === "stack" &&
        col.tiles.map((t, i) => (
          <MediaTile key={i} x={0} y={i * (STACK.h + STACK_GAP)} w={STACK.w} h={STACK.h} {...t} focused={focus === i} />
        ))}
      {col.kind === "grid" &&
        col.tiles.map((t, i) => {
          const b = itemBox(col, i)!;
          return <MediaTile key={i} x={b.x} y={b.y} w={b.w} h={b.h} src={t.src} badge={t.badge} progress={t.progress} focused={focus === i} />;
        })}
      {col.kind === "home" && (
        <Glass x={0} y={0} w={HOME_W} h={CARD_H} page={page} class="nest-home-card">
          <i class="nest-home-bulb" />
          <b>{col.title}</b>
          <small>{col.sub}</small>
          {col.actions.map((a, i) => (
            <span
              key={a}
              class={`nest-home-action${focus === i ? " is-focus" : ""}`}
              style={{ top: `${CARD_H - (col.actions.length - i) * (ACTION_H + 10) - 12}px` }}
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
              y={i * (LIST.h + 14)}
              w={LIST.w}
              h={LIST.h}
              page={at(0, i * (LIST.h + 14))}
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
              y={col.items.length * (LIST.h + 14)}
              w={LIST.w}
              h={ADD_H}
              page={at(0, col.items.length * (LIST.h + 14))}
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
