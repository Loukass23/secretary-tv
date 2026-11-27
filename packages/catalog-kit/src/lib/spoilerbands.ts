// Spoiler protection's colour bands (Settings › Watching, "Bands"; lib/titlepage.ts `episodeLook`): an unwatched
// episode's still becomes a few flat bands in its own colours, leaning as the home's metal sheen does, each a step
// darker than the one before, so the tile keeps the episode's mood and its number and title read on any of them. Flat
// fills only (no blur, no gradient). Pure, so it is unit tested; ui/stillbands.ts paints them once into a small image.

export type Rgb = readonly [number, number, number];

/** Bands across a tile. */
export const BANDS = 5;
/** The sheen's lean (tv-kit glass/sheen.tsx): a band's top sits this far right of its foot, per pixel of height. */
export const LEAN = 0.243;
/** The ink the bands are pulled toward, so a light still never washes the white title out. */
const INK: Rgb = [7, 8, 11];
/** How far each band goes toward the ink: the first band, then one more step per band. */
const DARK = 0.5;
const STEP = 0.07;

/** The average colour of each of `n` vertical slices of an RGBA picture `w` x `h` (canvas ImageData order). */
export function sliceColours(data: ArrayLike<number>, w: number, h: number, n = BANDS): Rgb[] {
  const sums = Array.from({ length: n }, () => [0, 0, 0, 0]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = Math.min(n - 1, Math.floor((x * n) / w));
      const i = (y * w + x) * 4;
      // Transparent pixels (a still with letterboxing drawn over nothing) do not count.
      const a = data[i + 3] / 255;
      const s = sums[k];
      s[0] += data[i] * a;
      s[1] += data[i + 1] * a;
      s[2] += data[i + 2] * a;
      s[3] += a;
    }
  }
  return sums.map(([r, g, b, a]) => (a > 0 ? [Math.round(r / a), Math.round(g / a), Math.round(b / a)] : INK));
}

const mix = (c: Rgb, t: number): Rgb => [0, 1, 2].map((j) => Math.round(c[j] + (INK[j] - c[j]) * t)) as unknown as Rgb;

/** The bands' fills: each slice's colour pulled toward the ink, one step further per band. */
export function stepBands(colours: readonly Rgb[]): Rgb[] {
  return colours.map((c, k) => mix(c, Math.min(0.9, DARK + k * STEP)));
}

/** Relative luminance (sRGB, 0..1), to check the title reads on a band. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Band `k` of `n` across a `w` x `h` box, as the corners of a leaning quadrilateral (foot left, foot right, top right,
 * top left). The first starts off the left edge and the last runs off the right, so the bands cover the box whole.
 */
export function bandShape(k: number, n: number, w: number, h: number): [number, number][] {
  const shift = LEAN * h;
  const step = (w + shift) / n;
  const x0 = k * step - shift;
  const x1 = k === n - 1 ? w + shift : (k + 1) * step - shift;
  return [
    [x0, h],
    [x1, h],
    [x1 + shift, 0],
    [x0 + shift, 0],
  ];
}

export const css = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`;
