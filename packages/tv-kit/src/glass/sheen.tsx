import { useEffect, useRef, useState } from "preact/hooks";
import type { Palette, Rgb } from "./palette.ts";
import { blob, canvas } from "./wallpaper.ts";

/** Savanna gold: the sheen's colour when there is no poster, and what a poster's accent is pulled toward. */
const GOLD: Rgb = [232, 176, 79];
/** How far a poster's accent is pulled toward gold, so the light never turns cold. */
const WARM = 0.35;
/** After this long without a key the bands start sliding again. */
const REST_MS = 1200;
/** A new colour fades in over the old for this long (matches sgSheenIn in glass.css). */
const FADE_MS = 2400;
const BANDS = 2;

const SPRITE_W = 300;
const SPRITE_H = 540;

const sprites = new Map<string, Promise<string>>();

/** One soft band of light in `rgb`, small: the compositor scales it up to the page, so it costs no more than a bitmap. */
function sprite(rgb: Rgb): Promise<string> {
  const key = rgb.join(",");
  let hit = sprites.get(key);
  if (!hit) {
    const [c, g] = canvas(SPRITE_W, SPRITE_H);
    // Drawn leaning, so the band slides by translate alone: a skew in the animation costs the TV more than a bitmap does.
    const k = -0.243;
    g.setTransform(1, 0, k, 1, -k * (SPRITE_H / 2), 0);
    const grad = g.createLinearGradient(70, 0, 230, 0);
    grad.addColorStop(0, `rgba(${key},0)`);
    grad.addColorStop(0.5, `rgba(${key},1)`);
    grad.addColorStop(1, `rgba(${key},0)`);
    g.fillStyle = grad;
    g.fillRect(70, 0, 160, SPRITE_H);
    hit = blob(c, "image/png");
    sprites.set(key, hit);
    if (sprites.size > 12) sprites.delete(sprites.keys().next().value as string);
  }
  return hit;
}

/** The accent of `palette` pulled toward gold, or gold itself. */
export function sheenColour(palette: Palette | null): Rgb {
  if (!palette) return GOLD;
  const [r, g, b] = palette.accent;
  const mix = (a: number, t: number) => Math.round(a + (t - a) * WARM);
  return [mix(r, GOLD[0]), mix(g, GOLD[1]), mix(b, GOLD[2])];
}

/**
 * Slow metallic light sliding across the backdrop: two soft diagonal bands on their own layers, moved by transform
 * alone (docs/lessons.md: opacity and transform only, nothing animated that has to be repainted). The bands never
 * restart: a new poster colour fades in on a second picture inside each band, and the old one is removed after. The
 * bands stop while keys are being pressed, so a walk along a row pays nothing, and start again once focus rests.
 */
export function MetalSheen({ palette }: { palette: Palette | null }) {
  const [pics, setPics] = useState<{ id: number; url: string; fade: boolean }[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const id = useRef(0);
  const rgb = sheenColour(palette);
  const key = rgb.join(",");

  useEffect(() => {
    let live = true;
    let drop: ReturnType<typeof setTimeout> | undefined;
    void sprite(rgb).then(
      (url) => {
        if (!live) return;
        setPics((s) => (s.length && s[s.length - 1].url === url ? s : [...s.slice(-2), { id: ++id.current, url, fade: s.length > 0 }]));
        // Once the new colour has faded in, the old picture goes: even fully covered it would cost frames.
        drop = setTimeout(() => setPics((s) => s.slice(-1)), FADE_MS + 100);
      },
      () => {},
    );
    return () => {
      live = false;
      clearTimeout(drop);
    };
  }, [key]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const el = root.current;
    const onKey = () => {
      el?.classList.add("is-paused");
      clearTimeout(t);
      t = setTimeout(() => el?.classList.remove("is-paused"), REST_MS);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
    };
  }, []);

  return (
    <div class="sg-sheen" ref={root} aria-hidden="true">
      {Array.from({ length: BANDS }, (_, b) => (
        <i key={b}>
          {pics.map((p) => (
            <b key={p.id} class={p.fade ? "is-new" : ""} style={{ backgroundImage: `url(${p.url})` }} />
          ))}
        </i>
      ))}
    </div>
  );
}
