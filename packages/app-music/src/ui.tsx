// Pieces the three screens share: a row of tiles, the progress bar and the player's icons.
import { MediaTile, Scroller } from "@secretary/tv-kit/src/glass/index.ts";
import type { ComponentChildren } from "preact";

export const TILE_W = 288;
export const TILE_H = 162;
export const TILE_GAP = 28;
/** Label, tile and the two caption lines under it. */
export const ROW_H = 300;

export interface RowItem {
  key: string;
  thumb: string;
  title: string;
  sub?: string;
  badge?: string;
}

/**
 * A labelled row of 16:9 tiles with their captions under them. It scrolls by transform so the focused tile stays
 * second from the left, and renders only the tiles around it.
 */
export function TileRow({
  label,
  items,
  x,
  y,
  w,
  focus,
}: {
  label: ComponentChildren;
  items: readonly RowItem[];
  x: number;
  y: number;
  w: number;
  /** The focused column, or -1. */
  focus: number;
}) {
  const step = TILE_W + TILE_GAP;
  const fits = Math.max(1, Math.floor((w + TILE_GAP) / step));
  const first = Math.max(0, Math.min(focus - 1, items.length - fits));
  const from = Math.max(0, first - 1);
  const to = Math.min(items.length, first + fits + 2);
  return (
    <>
      <h2 class={`mu-row-label${focus >= 0 ? " is-on" : ""}`} style={{ left: `${x}px`, top: `${y}px` }}>
        {label}
      </h2>
      <Scroller x={x} y={y + 44} w={w} h={ROW_H - 44} axis="x" offset={first * step}>
        {items.slice(from, to).map((it, k) => {
          const i = from + k;
          return (
            <div key={it.key}>
              <MediaTile x={i * step} y={0} w={TILE_W} h={TILE_H} src={it.thumb} badge={it.badge} focused={i === focus} />
              <div class={`mu-cap${i === focus ? " is-focus" : ""}`} style={{ left: `${i * step}px`, top: `${TILE_H + 12}px`, width: `${TILE_W}px` }}>
                <b>{it.title}</b>
                {it.sub && <small>{it.sub}</small>}
              </div>
            </div>
          );
        })}
      </Scroller>
    </>
  );
}

/** A thin bar filled by transform (scaleX), so moving it repaints nothing. */
export function Progress({ x, y, w, value }: { x: number; y: number; w: number; value: number }) {
  return (
    <span class="mu-progress" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px` }}>
      <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }} />
    </span>
  );
}

const svg = (d: ComponentChildren) => (
  <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
    {d}
  </svg>
);

export const Icons = {
  play: svg(<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />),
  pause: svg(
    <>
      <rect x="6" y="5" width="4.2" height="14" rx="1.2" />
      <rect x="13.8" y="5" width="4.2" height="14" rx="1.2" />
    </>,
  ),
  next: svg(
    <>
      <path d="M5 6.2v11.6a.8.8 0 0 0 1.25.66l8.3-5.8a.8.8 0 0 0 0-1.32l-8.3-5.8A.8.8 0 0 0 5 6.2z" />
      <rect x="16.4" y="5.5" width="2.6" height="13" rx="1" />
    </>,
  ),
  prev: svg(
    <>
      <path d="M19 6.2v11.6a.8.8 0 0 1-1.25.66l-8.3-5.8a.8.8 0 0 1 0-1.32l8.3-5.8A.8.8 0 0 1 19 6.2z" />
      <rect x="5" y="5.5" width="2.6" height="13" rx="1" />
    </>,
  ),
  shuffle: svg(
    <path
      d="M16 4l4 3.5-4 3.5V8.5h-1.6a3 3 0 0 0-2.45 1.27l-4.1 5.8A5 5 0 0 1 3.8 17.6H3v-2h.8a3 3 0 0 0 2.45-1.27l4.1-5.8A5 5 0 0 1 14.4 6.5H16zm0 9l4 3.5-4 3.5v-2.5h-1.6a5 5 0 0 1-3.45-1.38l1.32-1.86A3 3 0 0 0 14.4 15.5H16zM3 6.5h.8a5 5 0 0 1 3.45 1.38L5.93 9.74A3 3 0 0 0 3.8 8.5H3z"
    />,
  ),
  repeat: svg(
    <path d="M17 3l4 3.5L17 10V7.5H7a2 2 0 0 0-2 2V12H3V9.5a4 4 0 0 1 4-4h10zM7 21l-4-3.5L7 14v2.5h10a2 2 0 0 0 2-2V12h2v2.5a4 4 0 0 1-4 4H7z" />,
  ),
  search: svg(
    <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.5 4.5-1.41 1.41-4.5-4.5A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" />,
  ),
};
