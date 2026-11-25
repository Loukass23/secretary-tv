// The pieces Secretary's home is made of, shared so the catalog screens (title pages, catalog home, search, settings)
// can take the same look: the type, spacing, glass and focus of the home row and its opened cards. Like every glass
// control they are placed absolutely and take their focus from the host screen.
//
// Where an existing control already fits, use it: `Glass` for a surface, `Segmented` for a few fixed options of equal
// width, `MediaTile` for any other art, `ListCard` for a list line.
import type { ComponentChildren } from "preact";
import { Glass } from "./Glass.tsx";
import { Icon, ListCard, MediaTile } from "./controls.tsx";
import type { IconName } from "./icons.ts";

const cx = (own: string, extra?: string) => (extra ? `${own} ${extra}` : own);

export interface RankNumberProps {
  /** The box the numeral sits in, before its tile; the numeral is set at its bottom right. */
  x: number;
  y?: number;
  w: number;
  h: number;
  /** 1 for the first. */
  n: number;
  focused?: boolean;
  /** The numeral's size in px; default from the box's height. Decorative, so it is not on the type scale. */
  size?: number;
}

/**
 * A Top 10's numeral beside its tile, in one style everywhere (Secretary's cards, the catalog home, a folder): filled,
 * flat, in the number face, quiet until its tile has focus, then full ink. Focus changes only its opacity. Place it
 * before the tile, and the tile after it in the DOM so the tile draws over any overlap.
 */
export function RankNumber({ x, y = 0, w, h, n, focused, size }: RankNumberProps) {
  return (
    <span
      class={`sg-rank${focused ? " is-focus" : ""}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, fontSize: `${size ?? Math.round(Math.min(220, h * 0.46))}px` }}
    >
      {n}
    </span>
  );
}

/** The small uppercase label in the accent colour over a panel or a menu ("Watch together", a show's kicker). */
export function Kicker({ children, class: cls }: { children: ComponentChildren; class?: string }) {
  return <span class={cx("sg-kicker", cls)}>{children}</span>;
}

/** A row's name over its tiles, with its count beside it, as over the home row's cards. */
export function RowLabel({ x, y, label, count }: { x: number; y: number; label: string; count?: number }) {
  return (
    <span class="sg-row-label" style={{ left: `${x}px`, top: `${y}px` }}>
      {label}
      {count != null && <em>{count}</em>}
    </span>
  );
}

export interface InfoPanelProps {
  x: number;
  y: number;
  w: number;
  /** Fixed height; leave it out to let the text set it (bare only: with `glass` it defaults to 360). */
  h?: number;
  kicker?: ComponentChildren;
  title: string;
  /** The line under the title: words, or parts joined with " · " (year, runtime, rating). */
  meta?: string | readonly string[];
  /** The synopsis, cut to `lines` lines. */
  about?: string;
  /** Default 3, as under an opened card's row. */
  lines?: number;
  /** A glass surface behind the text (a title page's panel); default false, the bare caption of the home row. */
  glass?: boolean;
  /** Under the text: a `ButtonRow`, a progress line. */
  children?: ComponentChildren;
}

/**
 * A title's name, its line and its synopsis: the caption under an opened card's row on the home screen, and the panel
 * on a title page. Bare by default; `glass` puts it on a surface (place it on the page, so the frost lines up).
 */
export function InfoPanel({ x, y, w, h, kicker, title, meta, about, lines = 3, glass, children }: InfoPanelProps) {
  const line = Array.isArray(meta) ? meta.filter(Boolean).join(" · ") : (meta as string | undefined);
  const body = (
    <>
      {kicker != null && <Kicker>{kicker}</Kicker>}
      <b class="sg-info-title">{title}</b>
      {line && <small class="sg-info-meta">{line}</small>}
      {about && (
        <p class="sg-info-about" style={{ WebkitLineClamp: lines, maxHeight: `${lines * 1.38}em` }}>
          {about}
        </p>
      )}
      {children}
    </>
  );
  if (glass) {
    return (
      <Glass x={x} y={y} w={w} h={h ?? 360} class="sg-info is-glass">
        {body}
      </Glass>
    );
  }
  return (
    <div class="sg-info" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: h != null ? `${h}px` : undefined }}>
      {body}
    </div>
  );
}

export interface ButtonProps {
  label: string;
  icon?: IconName;
  /** The main action (Play, Resume): a raised fill while it is not focused. */
  primary?: boolean;
  focused?: boolean;
}

/** A pill button as on the home screen's cards: hairline, the white sheet fading in on focus and a small lift. */
export function Button({ label, icon, primary, focused }: ButtonProps) {
  return (
    <span class={`sg-btn${primary ? " is-primary" : ""}${focused ? " is-focus" : ""}`}>
      {icon && <Icon name={icon} />}
      {label}
    </span>
  );
}

/** A row of buttons, left to right from x/y; `focusIndex` is the one under the remote, or -1. */
export function ButtonRow({
  x,
  y,
  items,
  focusIndex = -1,
}: {
  /** Leave x/y out to flow inside a panel (an InfoPanel's children). */
  x?: number;
  y?: number;
  items: readonly ({ id: string } & Omit<ButtonProps, "focused">)[];
  focusIndex?: number;
}) {
  const placed = x != null && y != null;
  return (
    <div class={`sg-btn-row${placed ? " is-placed" : ""}`} style={placed ? { left: `${x}px`, top: `${y}px` } : undefined}>
      {items.map((b, i) => (
        <Button key={b.id} label={b.label} icon={b.icon} primary={b.primary} focused={i === focusIndex} />
      ))}
    </div>
  );
}

/** One tab's width and the gap after it, for hosts that place things under a tab. */
export const TAB = { w: 176, h: 60, gap: 12 } as const;

/**
 * A row of tabs (a show's seasons, a settings page's sections). `picked` is the one shown, `focusIndex` the one under
 * the remote (-1 when the remote is elsewhere). Tabs have one width (`TAB.w`) so the row scrolls by transform to keep
 * the focused, else the picked, tab in view; for a few options of their own width, use `Segmented`.
 */
export function Tabs({ x, y, w, items, picked, focusIndex = -1 }: { x: number; y: number; w: number; items: readonly string[]; picked: number; focusIndex?: number }) {
  const stride = TAB.w + TAB.gap;
  const at = focusIndex >= 0 ? focusIndex : picked;
  const total = items.length * stride - TAB.gap;
  // Keep `at` in view with one tab of room after it, never past the ends.
  const offset = Math.max(0, Math.min(total - w, (at + 2) * stride - TAB.gap - w));
  return (
    <div class="sg-tabs" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px` }}>
      <div class="sg-tabs-run" style={{ transform: `translate3d(${-offset}px,0,0)` }}>
        {items.map((label, i) => (
          <span key={i} class={`sg-tab${i === picked ? " is-picked" : ""}${i === focusIndex ? " is-focus" : ""}`} style={{ left: `${i * stride}px` }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The home row's poster size (an opened card's titles); `gap` is between two posters. */
export const POSTER = { w: 252, h: 378, gap: 26 } as const;
/** A 16:9 still with its title on the art: Continue watching, episodes. */
export const LANDSCAPE = { w: 448, h: 252, gap: 26 } as const;

interface TileArt {
  x: number;
  y: number;
  src: string;
  focused?: boolean;
  /** Small label top left ("4K", "▶ Resume"). */
  badge?: string;
  /** Watched fraction, 0..1. */
  progress?: number;
  watched?: boolean;
  /** Times the standard size (a host's size setting). */
  scale?: number;
  class?: string;
}

/** A portrait poster at the home row's size, art only: the title goes in an `InfoPanel`, fixed beside the row. */
export function PosterTile({ scale = 1, ...t }: TileArt) {
  return <MediaTile {...t} w={Math.round(POSTER.w * scale)} h={Math.round(POSTER.h * scale)} />;
}

/** A landscape still with the title and a line on the art: every Continue watching row, and episodes. */
export function LandscapeTile({ scale = 1, title, sub, ...t }: TileArt & { title?: string; sub?: string }) {
  return <MediaTile {...t} w={Math.round(LANDSCAPE.w * scale)} h={Math.round(LANDSCAPE.h * scale)} title={title} sub={sub} />;
}

/** The list side of a `PreviewList`: its width, one line's height and the gap under it, the inner margin, the gap to the preview. */
export const PREVIEW_LIST = { listW: 640, row: 96, gap: 12, pad: 24, head: 64, split: 32 } as const;

export interface PreviewListItem {
  key: string;
  title: string;
  /** A line under the title: the current value of a setting, a light's state. */
  sub?: string;
  /** Right of the title: a short value ("On", "40%"). */
  meta?: string;
  /** A dot before the title. */
  color?: string;
}

export interface PreviewListProps {
  x: number;
  y: number;
  w: number;
  h: number;
  items: readonly PreviewListItem[];
  /** The line under the remote, or -1 while the remote is elsewhere (in the preview, in the header). */
  focusIndex: number;
  /** The line the preview shows while the remote is not on the list; default the focused line, else the first. */
  shown?: number;
  /** Which side the list is on; the preview takes the rest. Default left. */
  side?: "left" | "right";
  listW?: number;
  /** Over the list: what it is ("Appearance", "Living room"). */
  kicker?: ComponentChildren;
  /** The preview of the shown line, on its own glass beside the list: a small mock of the screen, a light's state. */
  preview: ComponentChildren;
  /** The preview has the remote (it has controls of its own): its panel takes the focus sheet's hairline. */
  previewFocused?: boolean;
}

/**
 * A compact list on one side and a preview of the focused line on the other (Settings and Lights, wave 3). The list
 * scrolls by transform to keep the focused line in view and draws only the lines in view; its lines have no frost, as
 * they move with every key. The two panels are fixed, so their frost never swaps. The host owns the focus and the keys.
 */
export function PreviewList({ x, y, w, h, items, focusIndex, shown, side = "left", listW = PREVIEW_LIST.listW, kicker, preview, previewFocused }: PreviewListProps) {
  const L = PREVIEW_LIST;
  const listX = side === "left" ? x : x + w - listW;
  const previewX = side === "left" ? x + listW + L.split : x;
  const previewW = w - listW - L.split;
  const top = kicker != null ? L.head : L.pad;
  const area = h - top - L.pad;
  const stride = L.row + L.gap;
  const fits = Math.max(1, Math.floor((area + L.gap) / stride));
  const at = focusIndex >= 0 ? focusIndex : (shown ?? 0);
  // Keep the line in view with one line of room after it, never past the ends.
  const first = Math.max(0, Math.min(items.length - fits, at - fits + 2));
  const offset = first * stride;
  const from = Math.max(0, first - 1);
  const to = Math.min(items.length, first + fits + 1);
  return (
    <>
      <Glass x={listX} y={y} w={listW} h={h} class="sg-plist">
        {kicker != null && <Kicker class="sg-plist-kicker">{kicker}</Kicker>}
        <div class="sg-clip" style={{ left: "0px", top: `${top}px`, width: `${listW}px`, height: `${area}px` }}>
          <div class="sg-scroll" style={{ transform: `translate3d(0,${-offset}px,0)` }}>
            {items.slice(from, to).map((it, k) => {
              const i = from + k;
              return (
                <ListCard
                  key={it.key}
                  x={L.pad}
                  y={i * stride}
                  w={listW - 2 * L.pad}
                  h={L.row}
                  frost={false}
                  class={`sg-plist-line${i === (shown ?? -1) && focusIndex < 0 ? " is-picked" : ""}`}
                  focused={i === focusIndex}
                  title={it.title}
                  sub={it.sub}
                  meta={it.meta}
                  color={it.color}
                />
              );
            })}
          </div>
        </div>
      </Glass>
      <Glass x={previewX} y={y} w={previewW} h={h} class={`sg-plist-preview${previewFocused ? " is-active" : ""}`}>
        {preview}
      </Glass>
    </>
  );
}
