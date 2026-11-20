// The glass backdrop, drawn once at boot so it needs no assets or network. Its colour blobs and
// vignette live in one bitmap: gradients are the slowest fill on the TV (docs/lessons.md), so
// they are painted here once, never by CSS.
import { blurBackdrop, PAGE_H as H, PAGE_W as W } from "./backdrop.ts";
import type { Palette, Rgb } from "./palette.ts";
import { TINTS } from "./tokens.ts";

export interface Backdrop {
  wallpaper: string;
  /** The same wallpaper blurred small, for the glass surfaces. */
  frost: string;
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

export function blob(c: HTMLCanvasElement, type = "image/jpeg"): Promise<string> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("toBlob failed"))), type, 0.9),
  );
}

export function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

export { TINTS } from "./tokens.ts";

const rgb = (c: Rgb) => c.join(",");

/** A small repeatable generator, so the brushed grain is the same on every draw (and a cached backdrop matches a fresh one). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The brushed-metal finish, painted into the bitmap once like everything else here: fine horizontal grain, a few
 * soft diagonal highlight bands in warm gold, and the thin streaks the blur smears so the glass reads as glass.
 * Light on dark (`light` false) or dark on light.
 */
function metal(g: CanvasRenderingContext2D, light: boolean): void {
  const rnd = seeded(7);
  // Grain: soft bands a few pixels tall, faint, so the brushed look reads without lines that shimmer on a TV.
  for (let y = 0; y < H; y += 3) {
    const a = 0.004 + rnd() * 0.016;
    g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${light ? a * 3 : a})` : `rgba(0,0,0,${light ? a : a * 1.4})`;
    g.fillRect(0, y, W, 3);
  }
  // Broad highlight bands, the same direction as the sheen that slides over them (sheen.tsx).
  const bands: readonly [number, number, number][] = [
    [260, 430, 0.07],
    [900, 520, 0.05],
    [1480, 380, 0.06],
  ];
  g.save();
  g.transform(1, 0, -0.36, 1, 0, 0);
  for (const [x, w, a] of bands) {
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    const warm = light ? "255,214,150" : "255,206,140";
    grad.addColorStop(0, `rgba(${warm},0)`);
    grad.addColorStop(0.5, `rgba(${warm},${light ? a * 2.2 : a})`);
    grad.addColorStop(1, `rgba(${warm},0)`);
    g.fillStyle = grad;
    g.fillRect(x, -100, w, H + 200);
  }
  g.restore();
  g.strokeStyle = light ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.04)";
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(-200 + i * 160, H);
    g.lineTo(400 + i * 160, 0);
    g.stroke();
  }
}

function drawWallpaper(g: CanvasRenderingContext2D, tint: string, mood: Palette | null): void {
  if (mood) {
    // The poster's mood: its base, its four corner lights and a pool of the accent, over the same metal streaks.
    const [left, right, top, bottom] = mood.lights;
    g.fillStyle = `rgb(${rgb(mood.base)})`;
    g.fillRect(0, 0, W, H);
    glow(g, 300, 900, 820, `rgba(${rgb(left)},0.7)`);
    glow(g, 1640, 360, 760, `rgba(${rgb(right)},0.65)`);
    glow(g, 960, 60, 680, `rgba(${rgb(top)},0.5)`);
    glow(g, 1100, 1040, 620, `rgba(${rgb(bottom)},0.45)`);
    glow(g, 1500, 520, 640, `rgba(${rgb(mood.accent)},0.2)`);
  } else {
    g.fillStyle = "#0b0807";
    g.fillRect(0, 0, W, H);
    glow(g, 360, 980, 760, "rgba(122,52,22,0.55)");
    glow(g, 1560, 260, 620, `rgba(${tint},0.16)`);
    glow(g, 1180, 900, 520, "rgba(168,84,24,0.24)");
    glow(g, 220, 120, 420, "rgba(232,176,79,0.08)");
  }
  metal(g, false);
  // Vignette and floor shadow, as in the reference.
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.7)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

/** The light version: a pale room with a lavender and pink wash top right, as in daylight. */
function drawDaylight(g: CanvasRenderingContext2D, tint: string, mood: Palette | null): void {
  g.fillStyle = "#f6ebdd";
  g.fillRect(0, 0, W, H);
  if (mood) {
    glow(g, 1640, 140, 820, `rgba(${rgb(mood.accent)},0.5)`);
    glow(g, 1220, 40, 560, `rgba(${rgb(mood.lights[2])},0.4)`);
    glow(g, 1500, 700, 520, `rgba(${rgb(mood.lights[1])},0.3)`);
  } else {
    glow(g, 1640, 140, 820, "rgba(255,186,110,0.55)");
    glow(g, 1220, 40, 560, "rgba(255,140,96,0.42)");
    glow(g, 1500, 700, 520, `rgba(${tint},0.10)`);
  }
  glow(g, 260, 940, 760, "rgba(255,255,255,0.9)");
  glow(g, 120, 160, 520, "rgba(255,226,190,0.6)");
  metal(g, true);
}

/** "night" is the dark glass; "day" the light one (pair it with the sg-day class on GlassRoot). */
export type Theme = "night" | "day";

/** `mood` (a poster's palette, palette.ts) tints the backdrop; without it the backdrop is the neutral one. */
export async function drawBackdrop(tint: string = TINTS.orange, theme: Theme = "night", mood: Palette | null = null): Promise<Backdrop> {
  const [wall, g] = canvas(W, H);
  if (theme === "day") drawDaylight(g, tint, mood);
  else drawWallpaper(g, tint, mood);
  const [wallpaper, frost] = await Promise.all([blob(wall), blurBackdrop(wall)]);
  return { wallpaper, frost };
}

const kept = new Map<string, Promise<Backdrop>>();
/** How many backdrops stay drawn, so going back to a poster's colour costs nothing. The oldest goes first. */
const KEEP = 6;

/** drawBackdrop with the last few kept, shared by every screen. `key` is `paletteKey(mood)`. */
export function backdropFor(tint: string, theme: Theme, mood: Palette | null, key: string): Promise<Backdrop> {
  const id = `${theme}:${tint}:${key}`;
  const hit = kept.get(id);
  if (hit) {
    // Most recently used goes last.
    kept.delete(id);
    kept.set(id, hit);
    return hit;
  }
  const p = drawBackdrop(tint, theme, mood);
  kept.set(id, p);
  p.catch(() => kept.delete(id));
  if (kept.size > KEEP) {
    const old = kept.keys().next().value as string;
    const gone = kept.get(old);
    kept.delete(old);
    // The object URLs of the evicted backdrop are freed once it is out of the cache.
    void gone?.then((b) => {
      URL.revokeObjectURL(b.wallpaper);
      URL.revokeObjectURL(b.frost);
    }, () => {});
  }
  return p;
}
