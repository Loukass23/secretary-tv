// Spoiler protection's blurred stills (Detail.tsx), made once per still and cheap to show. No CSS filter: each still
// is drawn once into a tiny canvas (32x18) and read back as a small JPEG; the tile shows that image at full size, and
// the compositor's scaling turns it into a soft blur. Showing it costs what any other tile image costs.
//
// The packaged widget runs from file://, so remote artwork does not taint the canvas (docs/lessons.md, glass). Where
// it does (a desktop browser on a remote still), the promise rejects and the tile shows no picture rather than the
// still.

const W = 32;
const H = 18;
const MAX = 64;
const made = new Map<string, Promise<string>>();

/** A 1x1 transparent image, for a tile whose blurred still is not ready (or could not be made). */
export const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function make(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => reject(new Error("stillblur: the still did not load"));
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        if (!g) return reject(new Error("stillblur: no 2d context"));
        g.imageSmoothingEnabled = true;
        // Drawn slightly oversize so the edges carry the picture's colour, not black.
        g.drawImage(img, -1, -1, W + 2, H + 2);
        c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("stillblur: toBlob failed"))), "image/jpeg", 0.8);
      } catch (e) {
        reject(e);
      }
    };
    img.src = src;
  });
}

/** The blurred copy of `src`, made once and kept for the most recent stills. */
export function blurredStill(src: string): Promise<string> {
  const hit = made.get(src);
  if (hit) {
    // Kept as the most recent.
    made.delete(src);
    made.set(src, hit);
    return hit;
  }
  const p = make(src);
  made.set(src, p);
  if (made.size > MAX) {
    const [oldest, gone] = made.entries().next().value as [string, Promise<string>];
    made.delete(oldest);
    void gone.then(URL.revokeObjectURL, () => {});
  }
  return p;
}
