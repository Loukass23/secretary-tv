// Backdrops for the glass catalog screens: the title art behind the glass, the shade over it, and the
// frost the glass takes from it. Rules from the TV (docs/performance.md, glass catalog):
//   - the art is its own layer, decoded before it is shown, and a faded-out copy is removed
//   - the frost swap re-rasterizes every glass layer, so it waits until focus rests
import { artPalette, type Backdrop, backdropFor, type Palette, TINTS } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { frostFor, preload, shadeImage } from "../lib/hero.ts";
import { loadSettings } from "../lib/settings.ts";
import type { CatalogType } from "../lib/types.ts";
import "./art.css";

export const TINT: Record<CatalogType, string> = { movie: TINTS.orange, series: TINTS.gold, anime: TINTS.clay };

/** How long focus must rest on an item before its art becomes the backdrop. */
export const DWELL_MS = 600;
/** After a backdrop swap, how long focus must rest before the glass takes that art's frost. */
const FROST_REST_MS = 1200;
/** The backdrop crossfade (art.css); the old layer is removed after it, since even at opacity 0 it costs frames. */
const FADE_MS = 450;

/**
 * The app's tinted wallpaper (under everything) and the shade image (over the art). With `moodSrc` (the focused item's art)
 * and the "Poster colour" setting on, the wallpaper takes that poster's colour once focus has rested on it.
 */
export function useBase(type: CatalogType, moodSrc?: string): { backdrop: Backdrop | null; shade: string | null; sheen: { palette: Palette | null } | false; mood: { palette: Palette | null } | undefined } {
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [shade, setShade] = useState<string | null>(null);
  const [mood, setMood] = useState<Palette | null>(null);
  useEffect(() => {
    if (!moodSrc || !loadSettings().domotics.moodBackground) return;
    let live = true;
    const t = setTimeout(() => void artPalette(moodSrc).then((p) => live && setMood(p)), DWELL_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [moodSrc]);
  const shownMood = loadSettings().domotics.moodBackground ? mood : null;
  // The wallpaper is drawn once per app; the poster's colour is a crossfaded layer over it (MoodTint), never a redraw.
  useEffect(() => {
    void backdropFor(TINT[type], "night", null, "none").then(setBackdrop, (e) => console.warn("[art] backdrop failed", e));
  }, [type]);
  useEffect(() => {
    void shadeImage().then(setShade, () => {});
  }, []);
  // The metallic sheen goes with the "Poster colour" setting, in the poster's colour.
  const on = loadSettings().domotics.moodBackground;
  return { backdrop, shade, sheen: on && { palette: shownMood }, mood: on ? { palette: shownMood } : undefined };
}

interface Slot {
  id: string;
  src: string;
}

export interface HeroArt {
  slots: readonly [Slot | null, Slot | null];
  front: number;
  /** The shown art's frost once focus has rested on it, else null (use the wallpaper's). */
  frost: string | null;
}

/**
 * A backdrop that follows focus: when `id` has held for DWELL_MS (or at once with `immediate`), `src`
 * is decoded and crossfaded in on the spare layer, and its frost follows once focus rests.
 */
export function useHeroArt(id: string | undefined, src: string | undefined, active: boolean, immediate = false): HeroArt {
  // The backdrop alternates between two permanent layers; `front` is the one shown.
  const [slots, setSlots] = useState<[Slot | null, Slot | null]>([null, null]);
  const [front, setFront] = useState(0);
  const frontRef = useRef(0);
  frontRef.current = front;
  const [frost, setFrost] = useState<{ id: string; frost: string } | null>(null);

  useEffect(() => {
    if (!active || !id || !src) return;
    let live = true;
    let rest: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(
      () => {
        if (slots[front]?.id !== id) {
          void preload(src).then(
            () => {
              if (!live) return;
              const back = 1 - front;
              setSlots((s) => (back === 0 ? [{ id, src }, s[1]] : [s[0], { id, src }]));
              setFront(back);
              setTimeout(() => {
                if (frontRef.current === back) setSlots((s) => (back === 0 ? [s[0], null] : [null, s[1]]));
              }, FADE_MS);
            },
            () => {},
          );
        }
        // Browsing never pays for the frost swap: it lands after focus has rested, while nothing moves.
        const blurred = frostFor(src);
        rest = setTimeout(() => {
          void blurred.then(
            (f) => live && setFrost({ id, frost: f }),
            () => {},
          );
        }, FROST_REST_MS);
      },
      immediate ? 0 : DWELL_MS,
    );
    return () => {
      live = false;
      clearTimeout(t);
      clearTimeout(rest);
    };
  }, [active, id, src]);

  const shown = slots[front];
  return { slots, front, frost: frost && frost.id === shown?.id ? frost.frost : null };
}

/** The art layers and the shade over them; place first inside a GlassRoot. */
export function HeroLayers({ hero, shade }: { hero: HeroArt; shade: string | null }) {
  return (
    <>
      {hero.slots.map((h, i) =>
        h ? <img key={i} class={`cat-hero${i === hero.front ? " is-front" : ""}`} src={h.src} alt="" onError={hideImg} /> : null,
      )}
      {shade && hero.slots[hero.front] && <img class="cat-shade" src={shade} alt="" />}
    </>
  );
}

function hideImg(e: Event) {
  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
}
