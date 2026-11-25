// Backdrops for the glass catalog screens: the title art behind the glass, the shade over it, and the
// frost the glass takes from it. Rules from the TV (docs/performance.md, glass catalog):
//   - the art is its own layer, decoded before it is shown, and a faded-out copy is removed
//   - the frost swap re-rasterizes every glass layer, so it waits until focus rests
import { artPalette, type Backdrop, backdropFor, type Palette, TINTS } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { type ArtTitle, cachedTitleArt, titleArt } from "../lib/fanart.ts";
import { frostFor, preload, readableFor, shadeImage } from "../lib/hero.ts";
import { lightsFollowFocus, syncSideLights } from "../lib/home.ts";
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
    const wantBackground = loadSettings().domotics.moodBackground;
    const wantLights = lightsFollowFocus();
    if (!moodSrc || !(wantBackground || wantLights)) {
      // Focus left the art: the side lights go back, but not for a passing visit elsewhere.
      if (!moodSrc && wantLights) {
        const t = setTimeout(() => syncSideLights(null), 3000);
        return () => clearTimeout(t);
      }
      return;
    }
    let live = true;
    const t = setTimeout(
      () =>
        void artPalette(moodSrc).then((p) => {
          if (!live) return;
          if (wantBackground) setMood(p);
          if (wantLights) syncSideLights(p ? p.accent : null);
        }),
      DWELL_MS,
    );
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
  /** The art's readable copy (lib/hero.ts `readableFor`), shown over it in place of the shade. */
  read?: string;
}

export interface HeroArt {
  slots: readonly [Slot | null, Slot | null];
  front: number;
  /** The shown art's frost once focus has rested on it, else null (use the wallpaper's). */
  frost: string | null;
  /** The art for `id` is up and its frost is in (or either could not be had): a page can show itself whole. */
  settled: boolean;
}

/**
 * A backdrop that follows focus: when `id` has held for DWELL_MS (or at once with `immediate`), `src`
 * is decoded and crossfaded in on the spare layer, and its frost follows once focus rests.
 */
/** Art already shown on this page: a screen that takes over for the same title (the player after its page) starts with it on, not fading in from black. */
const shownArt = new Set<string>();

export function useHeroArt(
  id: string | undefined,
  src: string | undefined,
  active: boolean,
  immediate = false,
  /** How long focus rests before the frost swaps; a page that does not move (Detail) takes it at once. */
  frostRestMs = FROST_REST_MS,
  /**
   * The page writes on the art (catalog home hero, title pages): each backdrop comes with its readable copy, made
   * before the swap so both arrive together in one fade. Without it (or when it cannot be made) the shade.
   */
  readable = false,
): HeroArt {
  // The backdrop alternates between two permanent layers; `front` is the one shown.
  const [slots, setSlots] = useState<[Slot | null, Slot | null]>(() => (immediate && id && src && shownArt.has(src) ? [{ id, src }, null] : [null, null]));
  const [front, setFront] = useState(0);
  const frontRef = useRef(0);
  frontRef.current = front;
  const [frost, setFrost] = useState<{ src: string; frost: string } | null>(null);
  /** What has failed for the current id ("art", "frost"), so `settled` never waits on it. */
  const [failed, setFailed] = useState<{ id: string; art?: boolean; frost?: boolean } | null>(null);

  useEffect(() => {
    if (!active || !id || !src) return;
    let live = true;
    let rest: ReturnType<typeof setTimeout> | undefined;
    // Details arriving with another backdrop for a title already shown keep the shown art, and its frost with it.
    const shownSrc = slots[front]?.id === id ? slots[front]!.src : null;
    const t = setTimeout(
      () => {
        if (!shownSrc) {
          const read = readable ? readableFor(src).catch(() => undefined) : Promise.resolve(undefined);
          void Promise.all([preload(src), read]).then(
            ([, r]) => {
              if (!live) return;
              shownArt.add(src);
              const back = 1 - front;
              const slot: Slot = { id, src, read: r };
              setSlots((s) => (back === 0 ? [slot, s[1]] : [s[0], slot]));
              setFront(back);
              setTimeout(() => {
                if (frontRef.current === back) setSlots((s) => (back === 0 ? [s[0], null] : [null, s[1]]));
              }, FADE_MS);
            },
            () => live && setFailed((f) => ({ ...(f?.id === id ? f : {}), id, art: true })),
          );
        }
        // Browsing never pays for the frost swap: it lands after focus has rested, while nothing moves.
        const frostSrc = shownSrc ?? src;
        const blurred = frostFor(frostSrc);
        rest = setTimeout(() => {
          void blurred.then(
            (f) => live && setFrost({ src: frostSrc, frost: f }),
            () => live && setFailed((x) => ({ ...(x?.id === id ? x : {}), id, frost: true })),
          );
        }, frostRestMs);
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
  const shownFrost = frost && frost.src === shown?.src ? frost.frost : null;
  const fail = failed?.id === id ? failed : null;
  const settled = Boolean(id && (fail?.art || (shown?.id === id && (shownFrost || fail?.frost))));
  return { slots, front, frost: shownFrost, settled };
}

/**
 * The art layers; place first inside a GlassRoot. Each is one layer holding the art and, over it, its readable copy or
 * else the shade, so the darkening crossfades with the picture it belongs to and never changes in a step.
 */
export function HeroLayers({ hero, shade }: { hero: HeroArt; shade: string | null }) {
  return (
    <>
      {hero.slots.map((h, i) =>
        h ? (
          <div key={i} class={`cat-hero${i === hero.front ? " is-front" : ""}`}>
            <img class="cat-hero-art" src={h.src} alt="" onError={hideImg} />
            {(h.read ?? shade) && <img class="cat-hero-over" src={h.read ?? shade!} alt="" />}
          </div>
        ) : null,
      )}
    </>
  );
}

/** Logos already decoded on this page: shown at once when their title comes back, never faded in again. */
const decodedLogos = new Set<string>();

/**
 * A title's logo (lib/fanart.ts `titleArt`, "hero" size), decoded before it is returned: `src` is undefined while there
 * is none (show the name), and `settled` once the lookup has answered either way, so a page can wait for it before it
 * shows itself. With `waitMs`, the lookup starts only once the title has held that long (the catalog home, where focus
 * passes over many titles).
 */
export function useLogo(type: CatalogType, t: ArtTitle | undefined, waitMs = 0): { src?: string; settled: boolean } {
  const cachedLogo = t ? cachedTitleArt(type, t, "hero").logo : undefined;
  const [got, setGot] = useState<{ id: string; src?: string } | null>(null);
  useEffect(() => {
    if (!t) return;
    let live = true;
    const done = (src?: string) => live && setGot({ id: t.id, src });
    const show = (src: string | undefined) => {
      if (!src) return done();
      if (decodedLogos.has(src)) return done(src);
      void preload(src).then(
        () => {
          decodedLogos.add(src);
          done(src);
        },
        () => done(),
      );
    };
    const timer = setTimeout(() => void titleArt(type, t, "hero").then((a) => show(a.logo)), waitMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [type, t?.id]);
  if (!t) return { settled: true };
  if (got?.id === t.id) return { src: got.src, settled: true };
  return { src: cachedLogo && decodedLogos.has(cachedLogo) ? cachedLogo : undefined, settled: false };
}

/**
 * The title's mark over the art: its logo, contained in `w` x `h` and anchored bottom left, else its name in the display
 * face, no taller than `h` (see `shrink`). A logo arriving after the name fades in in its place once (opacity, its own layer); the
 * captions are anchored by their foot, so only what is above the mark can move, and that under the page's veil.
 */
export function TitleMark({ name, logo, w, h, shrink, class: cls }: { name: string; logo?: string; w: number; h: number; shrink?: boolean; class?: string }) {
  return (
    // A logo fills its box. With `shrink` (a title page, one title) a name takes only the lines it needs; else (the
    // catalog home, where titles follow focus) the box keeps its height, so the kicker over it never moves.
    <div class={`cat-mark${cls ? ` ${cls}` : ""}`} style={{ width: `${w}px`, ...(logo || !shrink ? { height: `${h}px` } : { maxHeight: `${h}px` }) }}>
      {logo ? <img key={logo} class="cat-mark-logo" src={logo} alt={name} /> : <b class="cat-mark-name">{name}</b>}
    </div>
  );
}

function hideImg(e: Event) {
  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
}
