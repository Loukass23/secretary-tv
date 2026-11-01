// The artwork-coloured glow behind a focused tile. A soft outer shadow repaints on every focus change
// (docs/performance.md, glass lab), so the glow is a small blurred blob drawn once per colour on a
// canvas, scaled up by the compositor and moved and faded with transform and opacity only.
import { useRef } from "preact/hooks";
import { blob, canvas } from "./wallpaper.ts";

const blobs = new Map<string, Promise<string>>();

/** A soft halo in "r,g,b", as an object URL (cached per colour). */
export function glowImage(rgb: string): Promise<string> {
  let hit = blobs.get(rgb);
  if (!hit) {
    // A blurred rectangle, so the colour gathers around the tile's edges; the compositor stretches it to the tile.
    const [c, g] = canvas(64, 64);
    g.filter = "blur(4px)";
    g.fillStyle = `rgba(${rgb},0.9)`;
    g.fillRect(9, 9, 46, 46);
    hit = blob(c, "image/png");
    blobs.set(rgb, hit);
  }
  return hit;
}

const colours = new Map<string, Promise<string | null>>();

/**
 * The lively average colour of an image as "r,g,b", or null when it cannot be read. The image must
 * be same-origin or CORS-enabled (Nest loads artwork through the server's /art for this).
 */
export function artColour(src: string): Promise<string | null> {
  let hit = colours.get(src);
  if (!hit) {
    hit = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const [, g] = canvas(8, 8);
          g.drawImage(img, 0, 0, 8, 8);
          const d = g.getImageData(0, 0, 8, 8).data;
          // Weighted towards saturated pixels so a red cover glows red, not brown.
          let r = 0;
          let gr = 0;
          let b = 0;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            const max = Math.max(d[i], d[i + 1], d[i + 2]);
            const w = 0.15 + (max - Math.min(d[i], d[i + 1], d[i + 2])) / 255;
            r += d[i] * w;
            gr += d[i + 1] * w;
            b += d[i + 2] * w;
            n += w;
          }
          resolve(boost(r / n, gr / n, b / n));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    colours.set(src, hit);
  }
  return hit;
}

/** Brightens and saturates a colour so the glow reads on both the dark and the light glass. */
function boost(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b, 1);
  const min = Math.min(r, g, b);
  const k = 235 / max;
  const s = (v: number) => Math.round(Math.max(0, Math.min(255, min * k * 0.6 + (v - min) * k * 1.25)));
  return `${s(r)},${s(g)},${s(b)}`;
}

/** The glow layer. Place it before the tiles it sits behind; `at` is the focused tile's page box. */
export function Glow({ at, src, spread = 56 }: { at: { x: number; y: number; w: number; h: number } | null; src?: string; spread?: number }) {
  // When focus leaves the artwork the glow fades where it was, instead of sliding to the corner as it fades.
  const last = useRef(at);
  if (at) last.current = at;
  const box = at ?? last.current;
  if (!src) return null;
  const w = (box?.w ?? 0) + spread * 2;
  const h = (box?.h ?? 0) + spread * 2;
  return (
    <i
      class={`sg-glow${at ? " is-on" : ""}`}
      style={{
        left: 0,
        top: 0,
        width: `${w}px`,
        height: `${h}px`,
        backgroundImage: `url(${src})`,
        transform: box ? `translate3d(${box.x - spread}px,${box.y - spread}px,0)` : undefined,
      }}
    />
  );
}
