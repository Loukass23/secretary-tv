import { type ComponentChildren, createContext } from "preact";
import { useContext } from "preact/hooks";
import { FROST_SCALE, PAGE_H, PAGE_W } from "./backdrop.ts";
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
  children?: ComponentChildren;
}

/** The page a glass screen lives on: 1920x1080, with the backdrop and the frost for its surfaces. */
export function GlassRoot({ mode, wallpaper, frost, class: cls, children }: RootProps) {
  return (
    <div class={`sg-root sg-${mode}${cls ? ` ${cls}` : ""}`} style={wallpaper ? { backgroundImage: `url(${wallpaper})` } : undefined}>
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
  if (!src) return null;
  return (
    <i
      class="sg-frost"
      style={{
        width: `${PAGE_W / FROST_SCALE}px`,
        height: `${PAGE_H / FROST_SCALE}px`,
        backgroundImage: `url(${src})`,
        transform: `translate3d(${-x}px,${-y}px,0) scale(${FROST_SCALE})`,
      }}
    />
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
