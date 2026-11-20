// The mood of a poster: its dominant colour and four corner lights, for the background and the side lights.
// Pure (no DOM), so it is tested on synthetic pixels. The method is the one the older native Nuvio app used: score
// the art by hue bucket (chroma squared, so the colourful part votes), discount skin tones, ignore grey and
// near-black, then pull the result into OKLCh ranges so a loud poster still gives a calm background.

export type Rgb = readonly [number, number, number];

export interface Palette {
  /** The poster's dominant colour, lively but not neon (0-255), for glows and the side lights. */
  accent: Rgb;
  /** The background's base: nearly black with a breath of the hue. */
  base: Rgb;
  /** Light colour from the left, right, top and bottom thirds of the art. */
  lights: readonly [Rgb, Rgb, Rgb, Rgb];
  /** Hue in degrees, 0-360. */
  hue: number;
}

// --- OKLab ---
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => (c <= 0 ? 0 : c >= 1 ? 1 : c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklch(r: number, g: number, b: number): [number, number, number] {
  const lr = toLin(r / 255);
  const lg = toLin(g / 255);
  const lb = toLin(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}

/** L, C, h (radians) to sRGB 0-255, lowering chroma until the colour fits, so the hue and lightness hold. */
export function fromOklch(L: number, C: number, h: number): Rgb {
  for (let k = 0; k < 60; k++) {
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (C <= 0 || lin.every((v) => v >= -0.001 && v <= 1.001)) return [Math.round(fromLin(lin[0]) * 255), Math.round(fromLin(lin[1]) * 255), Math.round(fromLin(lin[2]) * 255)];
    C *= 0.96;
  }
  const g = Math.round(fromLin(L ** 3) * 255);
  return [g, g, g];
}

const BUCKETS = 24;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The palette of an RGBA image (a small one: Nest draws the art at 32x18), or null for grey or black-and-white art,
 * where callers keep their default.
 */
export function extractPalette(px: ArrayLike<number>, w: number, h: number): Palette | null {
  if (w <= 0 || h <= 0 || px.length < w * h * 4) return null;
  const cell = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0, wc: 0, rc: 0, gc: 0, bc: 0 }));
  // Left, right, top, bottom thirds: every opaque sample counts, weighted towards the coloured ones.
  const reg = Array.from({ length: 4 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  let chromatic = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] < 200) continue;
      total++;
      const r = px[i] / 255;
      const g = px[i + 1] / 255;
      const b = px[i + 2] / 255;
      const mx = Math.max(r, g, b);
      const c = mx - Math.min(r, g, b);
      const wr = 0.25 + 8 * c * c;
      const add = (k: number) => {
        reg[k].w += wr;
        reg[k].r += px[i] * wr;
        reg[k].g += px[i + 1] * wr;
        reg[k].b += px[i + 2] * wr;
      };
      if (x * 3 < w) add(0);
      if (x * 3 >= 2 * w) add(1);
      if (y * 3 < h) add(2);
      if (y * 3 >= 2 * h) add(3);
      if (mx < 0.14 || c < 0.1) continue;
      chromatic++;
      let hue = mx === r ? (g - b) / c : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      if (hue < 0) hue += 6;
      const k = Math.min(BUCKETS - 1, Math.floor(hue * (BUCKETS / 6)));
      const wt = Math.max(0.005, c * c * (1 - 1.1 * Math.abs(mx - 0.62)));
      const sat = c / mx;
      const skin = hue * 60 >= 8 && hue * 60 <= 42 && sat >= 0.18 && sat <= 0.64 && mx >= 0.3;
      const e = cell[k];
      const wp = skin ? wt * 0.12 : wt;
      e.w += wp;
      e.r += px[i] * wp;
      e.g += px[i + 1] * wp;
      e.b += px[i + 2] * wp;
      e.wc += wt;
      e.rc += px[i] * wt;
      e.gc += px[i + 1] * wt;
      e.bc += px[i + 2] * wt;
    }
  }
  // Under 4% coloured samples: black and white art.
  if (total < 8 || chromatic * 25 < total) return null;

  const best = (full: boolean) => {
    let top = -1;
    let at = 0;
    for (let k = 0; k < BUCKETS; k++) {
      const wOf = (j: number) => (full ? cell[(j + BUCKETS) % BUCKETS].wc : cell[(j + BUCKETS) % BUCKETS].w);
      const score = wOf(k) + 0.5 * (wOf(k - 1) + wOf(k + 1));
      if (score > top) {
        top = score;
        at = k;
      }
    }
    return { at, top };
  };
  let pick = best(false);
  let full = false;
  // Skin as the only colour: the discount emptied the art, so it counts in full rather than giving up.
  if (pick.top < 0.0025 * total) {
    full = true;
    pick = best(true);
    if (pick.top < 0.0025 * total) return null;
  }
  let W = 0;
  const sum = [0, 0, 0];
  for (const j of [pick.at - 1, pick.at, pick.at + 1]) {
    const e = cell[(j + BUCKETS) % BUCKETS];
    const wj = full ? e.wc : e.w;
    W += wj;
    sum[0] += full ? e.rc : e.r;
    sum[1] += full ? e.gc : e.g;
    sum[2] += full ? e.bc : e.b;
  }
  const [, C, hue] = toOklch(sum[0] / W, sum[1] / W, sum[2] / W);
  const accent = fromOklch(0.72, clamp(C * 1.15, 0.08, 0.2), hue);
  const base = fromOklch(0.17, Math.min(C * 0.35, 0.035), hue);
  const lights = reg.map((e) => {
    const [, c, hh] = e.w > 0 ? toOklch(e.r / e.w, e.g / e.w, e.b / e.w) : [0, 0, 0];
    return fromOklch(0.42, Math.min(c * 2.3, 0.11), hh);
  }) as unknown as [Rgb, Rgb, Rgb, Rgb];
  return { accent, base, lights, hue: ((hue * 180) / Math.PI + 360) % 360 };
}

/** A stable key for caching what is drawn from a palette (accent rounded to 8 levels a channel). */
export const paletteKey = (p: Palette | null): string => (p ? p.accent.map((v) => v >> 3).join(".") : "none");
