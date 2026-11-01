// The glass backdrop, drawn once at boot so it needs no assets or network. Its colour blobs and
// vignette live in one bitmap: gradients are the slowest fill on the TV (docs/lessons.md), so
// they are painted here once, never by CSS.
import { blurBackdrop, PAGE_H as H, PAGE_W as W } from "./backdrop.ts";

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

/** The warm glow top right, "r,g,b": each app tints its backdrop (Nest and Cinema orange, Shows blue, Anime rose, Music green). */
export const TINTS = {
  orange: "255,90,38",
  blue: "90,140,255",
  rose: "236,64,122",
  green: "52,211,153",
} as const;

function drawWallpaper(g: CanvasRenderingContext2D, tint: string): void {
  g.fillStyle = "#07080b";
  g.fillRect(0, 0, W, H);
  glow(g, 360, 980, 760, "rgba(46,62,120,0.55)");
  glow(g, 1560, 260, 620, `rgba(${tint},0.16)`);
  glow(g, 1180, 900, 520, "rgba(90,70,160,0.22)");
  glow(g, 220, 120, 420, "rgba(232,176,79,0.08)");
  // Thin light streaks give the blur something to smear, so the glass reads as glass.
  g.strokeStyle = "rgba(255,255,255,0.05)";
  g.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(-200 + i * 160, H);
    g.lineTo(400 + i * 160, 0);
    g.stroke();
  }
  // Vignette and floor shadow, as in the reference.
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.7)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

/** The light version: a pale room with a lavender and pink wash top right, as in daylight. */
function drawDaylight(g: CanvasRenderingContext2D, tint: string): void {
  g.fillStyle = "#efeaf3";
  g.fillRect(0, 0, W, H);
  glow(g, 1640, 140, 820, "rgba(168,150,255,0.55)");
  glow(g, 1220, 40, 560, "rgba(255,168,214,0.45)");
  glow(g, 1500, 700, 520, `rgba(${tint},0.10)`);
  glow(g, 260, 940, 760, "rgba(255,255,255,0.9)");
  glow(g, 120, 160, 520, "rgba(214,226,255,0.6)");
  // The same streaks, lighter, so the frost still reads as glass.
  g.strokeStyle = "rgba(255,255,255,0.3)";
  g.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(-200 + i * 160, H);
    g.lineTo(400 + i * 160, 0);
    g.stroke();
  }
}

/** "night" is the dark glass; "day" the light one (pair it with the sg-day class on GlassRoot). */
export type Theme = "night" | "day";

export async function drawBackdrop(tint: string = TINTS.orange, theme: Theme = "night"): Promise<Backdrop> {
  const [wall, g] = canvas(W, H);
  if (theme === "day") drawDaylight(g, tint);
  else drawWallpaper(g, tint);
  const [wallpaper, frost] = await Promise.all([blob(wall), blurBackdrop(wall)]);
  return { wallpaper, frost };
}
