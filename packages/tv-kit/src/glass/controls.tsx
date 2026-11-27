// Glass controls for TV screens. Each is placed absolutely (BoxProps) and takes its focus state
// from the caller, so screens keep their own remote navigation (see grid.ts / use-keys.ts).
import type { ComponentChildren } from "preact";
import { type BoxProps, Glass } from "./Glass.tsx";
import { type IconName, iconMask } from "./icons.ts";

/** The control's own class plus any the caller passed. */
const cx = (own: string, extra?: string) => (extra ? `${own} ${extra}` : own);

/** A pill of options; `picked` is the current one, `focusIndex` the one under the remote (or -1). */
export function Segmented({
  items,
  picked,
  focusIndex = -1,
  ...box
}: Omit<BoxProps, "focused"> & { items: readonly string[]; picked: number; focusIndex?: number }) {
  return (
    <Glass {...box} class={cx("sg-seg", box.class)}>
      {items.map((label, i) => (
        <span key={label} class={`sg-seg-item${i === picked ? " is-picked" : ""}${i === focusIndex ? " is-focus" : ""}`}>
          {label}
        </span>
      ))}
    </Glass>
  );
}

/** `badge`: true draws a small bar, a number a red count bubble (nothing for 0). */
export function IconButton({ icon, badge, ...box }: BoxProps & { icon: ComponentChildren; badge?: boolean | number }) {
  return (
    <Glass {...box} class={cx("sg-icon", box.class)}>
      <span>{icon}</span>
      {badge === true && <b class="sg-badge" />}
      {typeof badge === "number" && badge > 0 && <b class="sg-count">{badge > 9 ? "9+" : badge}</b>}
    </Glass>
  );
}

/** One day in a date strip: number over weekday, with an optional dot for "has events". */
export function DateChip({ day, label, dot, ...box }: BoxProps & { day: ComponentChildren; label: string; dot?: boolean }) {
  return (
    <Glass {...box} class={cx("sg-chip", box.class)}>
      <b>{day}</b>
      <small>{label}</small>
      {dot && <i class="sg-dot" />}
    </Glass>
  );
}

/** An app in a strip: its icon (or a letter when it has none) over its name. */
export function AppChip({ icon, label, ...box }: BoxProps & { icon?: string; label: string }) {
  return (
    <Glass {...box} class={cx("sg-app", box.class)}>
      {icon ? <img src={icon} alt="" decoding="async" onError={hideImg} /> : <span class="sg-app-letter">{label.slice(0, 1)}</span>}
      <small>{label}</small>
    </Glass>
  );
}

/** A logo that does not load gives its place back to the title's name. */
function logoFailed(e: Event) {
  const img = e.currentTarget as HTMLImageElement;
  img.style.display = "none";
  img.nextElementSibling?.removeAttribute("hidden");
}

function hideImg(e: Event) {
  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
}

/** Art fades in over the tile's flat fill once it has loaded, rather than popping in line by line (glass.css). */
export function showImg(e: Event) {
  (e.currentTarget as HTMLImageElement).classList.add("is-ready");
}

interface CardProps {
  title: string;
  sub?: string;
  meta?: ComponentChildren;
  /** Colour of the leading dot (a calendar, a source, an app). */
  color?: string;
  /** A leading line icon in place of the dot (a mood). */
  icon?: IconName;
}

/** A list row: dot or icon, title and meta on one line, subtitle under it. Turns solid white when focused. */
export function ListCard({ title, sub, meta, color, icon, ...box }: BoxProps & CardProps) {
  return (
    <Glass {...box} class={cx("sg-card", box.class)}>
      <div class="sg-card-row">
        {icon ? <Icon name={icon} class="sg-card-icon" /> : color && <i class="sg-dot" style={{ background: color }} />}
        <b>{title}</b>
        {meta != null && <span class="sg-card-meta">{meta}</span>}
      </div>
      {sub && <small>{sub}</small>}
    </Glass>
  );
}

interface TileProps {
  src: string;
  title?: string;
  sub?: string;
  count?: number;
  /** Small label in the top-left corner. */
  badge?: string;
  /** Watched fraction, 0..1, drawn as a bar along the bottom. */
  progress?: number;
  /** Watched to the end: a tick in the top-right corner, and the art dimmed while the tile is not focused. */
  watched?: boolean;
  /** The title's stylized logo (Fanart.tv), drawn in place of its name; the name comes back if the logo fails. */
  logo?: string;
}

/** Artwork with a caption; the focused tile lifts (transform only) and gets a white ring. */
export function MediaTile({ x, y, w, h, focused, class: cls, src, title, sub, count, badge, progress, watched, logo }: Omit<BoxProps, "page"> & TileProps) {
  return (
    <div
      class={`sg-tile${focused ? " is-focus" : ""}${watched ? " is-watched" : ""}${cls ? ` ${cls}` : ""}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
    >
      <img class="sg-fade" src={src} alt="" decoding="async" onLoad={showImg} onError={hideImg} />
      {badge && <span class="sg-tile-badge">{badge}</span>}
      {watched && <span class="sg-tile-tick">✓</span>}
      {(title || sub || logo) && (
        <div class="sg-tile-cap">
          {logo && <img class="sg-tile-logo" src={logo} alt="" decoding="async" onError={logoFailed} />}
          {title && <b hidden={!!logo}>{title}</b>}
          {sub && <small>{sub}</small>}
        </div>
      )}
      {count != null && <span class="sg-tile-count">{count}</span>}
      {progress != null && progress > 0 && (
        <span class="sg-tile-progress">
          <i style={{ transform: `scaleX(${Math.min(1, progress)})` }} />
        </span>
      )}
    </div>
  );
}

export function Avatar({
  name,
  sub,
  x,
  y,
  focused,
  color,
  img,
}: {
  name: string;
  /** A line under the name: words, or a few icons. */
  sub?: ComponentChildren;
  x: number;
  y: number;
  focused?: boolean;
  /** A profile's colour: the disc shows it with the name's initial instead of the default rings. */
  color?: string;
  img?: string;
}) {
  const own = Boolean(color || img);
  return (
    <div class={`sg-user${focused ? " is-focus" : ""}`} style={{ left: `${x}px`, top: `${y}px` }}>
      <span
        class={`sg-avatar${own ? " is-own" : ""}`}
        style={own ? { background: img ? `${color ?? "#1d2240"} center / cover url("${img}")` : color } : undefined}
      >
        {own && !img ? name.trim().charAt(0).toUpperCase() : null}
      </span>
      <div>
        <b>{name}</b>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

/** The round white action button. */
export function Fab({ x, y, focused, children = "+" }: { x: number; y: number; focused?: boolean; children?: ComponentChildren }) {
  return (
    <div class={`sg-fab${focused ? " is-focus" : ""}`} style={{ left: `${x}px`, top: `${y}px` }}>
      {children}
    </div>
  );
}

/**
 * A clipped, scrolling column or row. Children are placed in its own coordinates; `offset` scrolls
 * it by transform. Surfaces inside pass `page` = their on-screen position so the frost follows.
 */
export function Scroller({
  x,
  y,
  w,
  h,
  axis,
  offset,
  pad = 20,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  axis: "x" | "y";
  offset: number;
  /** Room around the content for focus lift, kept inside the clip. */
  pad?: number;
  children?: ComponentChildren;
}) {
  const t = axis === "x" ? `translate3d(${pad - offset}px,${pad}px,0)` : `translate3d(${pad}px,${pad - offset}px,0)`;
  return (
    <div class="sg-clip" style={{ left: `${x - pad}px`, top: `${y - pad}px`, width: `${w + pad * 2}px`, height: `${h + pad * 2}px` }}>
      <div class="sg-scroll" style={{ transform: t }}>
        {children}
      </div>
    </div>
  );
}

/**
 * One line icon in the surrounding text colour. Without `size` it is 1em, so it follows the font size of
 * whatever holds it (an IconButton's 34px, a header's 30px).
 */
export function Icon({ name, size, class: cls }: { name: IconName; size?: number; class?: string }) {
  const mask = iconMask(name);
  const s = size ? `${size}px` : "1em";
  return <i class={cls ? `sg-ic ${cls}` : "sg-ic"} style={{ width: s, height: s, WebkitMaskImage: mask, maskImage: mask }} aria-hidden="true" />;
}
