// Spoiler protection's banded stills (Detail.tsx; the bands are lib/spoilerbands.ts), and the episodes' readable stills.
// No CSS filter and no gradient: each still is drawn once into a tiny canvas, its colours read back, and its bands
// painted flat into a small image the tile shows like any other picture.
//
// The packaged widget runs from file://, so remote artwork does not taint the canvas (docs/lessons.md, glass). Where
// it does (a desktop browser on a remote still), the promise rejects and the tile shows its flat fill rather than the
// still.
import { BANDS, bandShape, css, type Rgb, sliceColours, stepBands } from "../lib/spoilerbands.ts";

/** The still is read this small: enough for a few averages. */
const SAMPLE_W = 40;
const SAMPLE_H = 22;
/** The bands' picture: small, the compositor scales it up; flat edges stay clean at this size. */
const OUT_W = 320;
const OUT_H = 180;
const MAX = 64;

/** A 1x1 transparent image, for a tile whose bands are not ready (or could not be made). */
export const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Keeps the most recent `MAX` entries of a cache, the oldest dropped (and its blob URL let go). */
function keep<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>, drop?: (v: T) => void): Promise<T> {
  const hit = map.get(key);
  if (hit) {
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const p = make();
  map.set(key, p);
  if (map.size > MAX) {
    const [oldest, gone] = map.entries().next().value as [string, Promise<T>];
    map.delete(oldest);
    if (drop) void gone.then(drop, () => {});
  }
  return p;
}

const colours = new Map<string, Promise<Rgb[]>>();

/** A still's band fills (lib/spoilerbands.ts), read once and kept for the most recent stills. */
export function stillBands(src: string): Promise<Rgb[]> {
  return keep(colours, src, () =>
    new Promise<Rgb[]>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onerror = () => reject(new Error("stillbands: the still did not load"));
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = SAMPLE_W;
          c.height = SAMPLE_H;
          const g = c.getContext("2d");
          if (!g) return reject(new Error("stillbands: no 2d context"));
          g.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
          resolve(stepBands(sliceColours(g.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data, SAMPLE_W, SAMPLE_H, BANDS)));
        } catch (e) {
          reject(e);
        }
      };
      img.src = src;
    }),
  );
}

const banded = new Map<string, Promise<string>>();

/** The banded picture of `src`, made once and kept for the most recent stills. */
export function bandedStill(src: string): Promise<string> {
  return keep(
    banded,
    src,
    () =>
      stillBands(src).then(
        (fills) =>
          new Promise<string>((resolve, reject) => {
            const c = document.createElement("canvas");
            c.width = OUT_W;
            c.height = OUT_H;
            const g = c.getContext("2d");
            if (!g) return reject(new Error("stillbands: no 2d context"));
            fills.forEach((f, k) => {
              const pts = bandShape(k, fills.length, OUT_W, OUT_H);
              g.beginPath();
              g.moveTo(pts[0][0], pts[0][1]);
              for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
              g.closePath();
              g.fillStyle = css(f);
              g.fill();
            });
            c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("stillbands: toBlob failed"))), "image/png");
          }),
      ),
    URL.revokeObjectURL,
  );
}

// --- readable stills: an episode's title on its still (Detail.tsx EpisodeTile) ---

const READ_W = 480;
const READ_H = 270;
const readable = new Map<string, Promise<string>>();

/** Darkens the lower half of a still, where a tile writes its title, as the title pages' readable copy does. Painted
 *  once into a canvas, never by a CSS gradient. */
function makeReadable(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => reject(new Error("readable: the still did not load"));
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = READ_W;
        c.height = READ_H;
        const g = c.getContext("2d");
        if (!g) return reject(new Error("readable: no 2d context"));
        const scale = Math.max(READ_W / img.naturalWidth, READ_H / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        g.drawImage(img, (READ_W - dw) / 2, (READ_H - dh) / 2, dw, dh);
        const shade = g.createLinearGradient(0, READ_H * 0.38, 0, READ_H);
        shade.addColorStop(0, "rgba(7,8,11,0)");
        shade.addColorStop(0.55, "rgba(7,8,11,0.62)");
        shade.addColorStop(1, "rgba(7,8,11,0.86)");
        g.fillStyle = shade;
        g.fillRect(0, 0, READ_W, READ_H);
        c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("readable: toBlob failed"))), "image/jpeg", 0.86);
      } catch (e) {
        reject(e);
      }
    };
    img.src = src;
  });
}

/** The readable copy of an episode's still, made once and kept for the most recent stills; rejects where the still
 *  cannot be read back (a desktop browser on remote art), and the tile shows the still as it is. */
export function readableStill(src: string): Promise<string> {
  const hit = readable.get(src);
  if (hit) {
    readable.delete(src);
    readable.set(src, hit);
    return hit;
  }
  const p = makeReadable(src);
  readable.set(src, p);
  if (readable.size > MAX) {
    const [oldest, gone] = readable.entries().next().value as [string, Promise<string>];
    readable.delete(oldest);
    void gone.then(URL.revokeObjectURL, () => {});
  }
  return p;
}
