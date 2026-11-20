import { useEffect, useRef, useState } from "preact/hooks";
import { type Palette, paletteKey } from "./palette.ts";
import { canvas, glow } from "./wallpaper.ts";

/** The tint picture is small and scaled up by the compositor: drawing it costs next to nothing, unlike the wallpaper. */
const W = 96;
const H = 54;
/** A new colour fades in over the old for this long (matches sgTintIn in glass.css). */
const FADE_MS = 2600;

const pictures = new Map<string, string>();

/**
 * The poster's mood as a small transparent picture of coloured corner lights: laid over the (never redrawn) wallpaper,
 * so changing colour is a crossfade of two cheap layers, not a new wallpaper, a new blur and a new frost for every glass
 * surface. At night the poster's four lights glow in the corners; by day the accent washes in from the top right.
 */
function picture(p: Palette | null, day: boolean): string {
  const key = `${day ? "d" : "n"}:${paletteKey(p)}`;
  let url = pictures.get(key);
  if (!url) {
    const [c, g] = canvas(W, H);
    if (p) {
      const rgb = (v: readonly number[]) => v.join(",");
      if (day) {
        glow(g, 82, 7, 41, `rgba(${rgb(p.accent)},0.5)`);
        glow(g, 61, 2, 28, `rgba(${rgb(p.lights[2])},0.35)`);
        glow(g, 75, 35, 26, `rgba(${rgb(p.lights[1])},0.3)`);
      } else {
        const [left, right, top, bottom] = p.lights;
        glow(g, 15, 45, 41, `rgba(${rgb(left)},0.8)`);
        glow(g, 82, 18, 38, `rgba(${rgb(right)},0.75)`);
        glow(g, 48, 3, 34, `rgba(${rgb(top)},0.6)`);
        glow(g, 55, 52, 31, `rgba(${rgb(bottom)},0.5)`);
        glow(g, 75, 26, 32, `rgba(${rgb(p.accent)},0.28)`);
      }
    }
    url = c.toDataURL("image/png");
    pictures.set(key, url);
    if (pictures.size > 24) pictures.delete(pictures.keys().next().value as string);
  }
  return url;
}

/** The mood layer: crossfades between poster colours on two layers (opacity only), the old one removed afterwards. */
export function MoodTint({ palette, day }: { palette: Palette | null; day: boolean }) {
  const [layers, setLayers] = useState<{ id: number; url: string; fade: boolean }[]>([]);
  const id = useRef(0);
  const key = `${day}:${paletteKey(palette)}`;
  useEffect(() => {
    const url = picture(palette, day);
    // Up to three stay while colours change faster than they fade, so none is dropped mid-fade; a layer keeps its fade-in once it has one.
    setLayers((s) => (s.length && s[s.length - 1].url === url ? s : [...s.slice(-2), { id: ++id.current, url, fade: s.length > 0 }]));
    const drop = setTimeout(() => setLayers((s) => s.slice(-1)), FADE_MS + 100);
    return () => clearTimeout(drop);
  }, [key]);
  return (
    <>
      {layers.map((l) => (
        <i key={l.id} class={`sg-tint${l.fade ? " is-new" : ""}`} style={{ backgroundImage: `url(${l.url})` }} />
      ))}
    </>
  );
}
