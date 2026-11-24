import { type ComponentChildren, createContext } from "preact";
import { useContext, useRef, useState } from "preact/hooks";
import { FROST_SCALE, PAGE_H, PAGE_W } from "./backdrop.ts";
import type { Palette } from "./palette.ts";
import { MetalSheen } from "./sheen.tsx";
import { MoodTint } from "./tint.tsx";
import "./glass.css";

/**
 * How glass is drawn. "fake" (the default for real screens) shows a once-blurred backdrop behind
 * each surface; "flat" has no blur; "live" uses backdrop-filter and is only for comparison.
 */
export type GlassMode = "flat" | "live" | "fake";

const FrostContext = createContext<string | null>(null);

interface RootProps {
  mode: GlassMode;
  /** The full-page backdrop behind everything. */
  wallpaper?: string;
  /** blurBackdrop() of the same backdrop; without it "fake" renders flat. */
  frost?: string | null;
  class?: string;
  /** Slow metallic light sliding over the wallpaper; `palette` (the poster's) tints it, null keeps it savanna gold. */
  sheen?: { palette: Palette | null } | false;
  /** The poster's mood as coloured corner lights over the wallpaper, crossfaded (tint.tsx); undefined keeps the wallpaper as drawn. */
  mood?: { palette: Palette | null; day?: boolean };
  children?: ComponentChildren;
}

/** The page a glass screen lives on: 1920x1080, with the backdrop and the frost for its surfaces. */
export function GlassRoot({ mode, wallpaper, frost, class: cls, sheen, mood, children }: RootProps) {
  // A new wallpaper fades in over the old one: the old one stays on its own layer and fades out (opacity only).
  const shown = useRef<{ now?: string; before?: string }>({});
  if (shown.current.now !== wallpaper) {
    shown.current = { now: wallpaper, before: shown.current.now };
  }
  const before = shown.current.before;
  return (
    <div class={`sg-root sg-${mode}${cls ? ` ${cls}` : ""}`} style={wallpaper ? { backgroundImage: `url(${wallpaper})` } : undefined}>
      {before && <i key={before} class="sg-wall-out" style={{ backgroundImage: `url(${before})` }} />}
      {mood && wallpaper && <MoodTint palette={mood.palette} day={!!mood.day} />}
      {sheen && wallpaper && <MetalSheen palette={sheen.palette} />}
      <FrostContext.Provider value={mode === "fake" ? (frost ?? null) : null}>{children}</FrostContext.Provider>
    </div>
  );
}

/**
 * The blurred backdrop behind one surface, placed so it lines up with the page underneath. It is its
 * own compositor layer (translate3d), so the surface's content can repaint without redrawing it and a
 * moving surface can counter-move it. That layer is rasterized at page scale, so swapping the frost
 * costs long frames: swap it while nothing moves (docs/performance.md, glass catalog).
 */
export function Frost({ x, y }: { x: number; y: number }) {
  const src = useContext(FrostContext);
  // A new frost fades in over the old one, which is dropped once the fade ends: never a snap from one blur to the next.
  const shown = useRef<{ now: string | null; before: string | null }>({ now: src, before: null });
  if (shown.current.now !== src) shown.current = { now: src, before: src ? shown.current.now : null };
  const [, redraw] = useState(0);
  if (!src) return null;
  const before = shown.current.before;
  const layer = (url: string) => ({
    width: `${PAGE_W / FROST_SCALE}px`,
    height: `${PAGE_H / FROST_SCALE}px`,
    backgroundImage: `url(${url})`,
    transform: `translate3d(${-x}px,${-y}px,0) scale(${FROST_SCALE})`,
  });
  const done = () => {
    shown.current = { ...shown.current, before: null };
    redraw((n) => n + 1);
  };
  return (
    <>
      {before && <i key={before} class="sg-frost" style={layer(before)} />}
      <i key={src} class={`sg-frost${before ? " is-in" : ""}`} style={layer(src)} onAnimationEnd={before ? done : undefined} />
    </>
  );
}

export interface BoxProps {
  /** Position inside the parent, in CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Where the surface sits on the page, for the frost. Defaults to x/y (a surface placed on the
   * page itself); inside a scrolled list pass the on-screen position, scroll included.
   */
  page?: readonly [number, number];
  focused?: boolean;
  class?: string;
  opacity?: number;
  /** false: translucent fill only, no frost (surfaces in fast-moving rows over a dark shade). */
  frost?: boolean;
}

/** A translucent surface with a hairline; when focused, a white sheet fades in under its content. */
export function Glass({
  x,
  y,
  w,
  h,
  page,
  focused,
  class: cls,
  opacity,
  frost = true,
  children,
}: BoxProps & { children?: ComponentChildren }) {
  return (
    <div
      class={`sg-glass${focused ? " is-focus" : ""}${cls ? ` ${cls}` : ""}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, opacity }}
    >
      {frost && <Frost x={page?.[0] ?? x} y={page?.[1] ?? y} />}
      {children}
    </div>
  );
}
