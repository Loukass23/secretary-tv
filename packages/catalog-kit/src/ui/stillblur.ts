// Spoiler protection's blurred stills and synopses (Detail.tsx), made once each and cheap to show. No CSS filter: each still
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

/** The text's look for `blurredText`: the box it fills and the type it is set in, as the page shows it. */
export interface TextBox {
  w: number;
  lines: number;
  /** Line height in px. */
  lineH: number;
  /** A canvas font, e.g. `28px sans-serif`. */
  font: string;
  color: string;
}

/** Text broken into at most `lines` lines that fit `w` (measured in the canvas's font). */
function wrap(g: CanvasRenderingContext2D, text: string, w: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > w) {
      out.push(line);
      if (out.length === lines) return out;
      line = word;
    } else line = next;
  }
  if (line && out.length < lines) out.push(line);
  return out;
}

/** Text drawn this many times smaller, then shown at full size: the scaling blurs it, with a light blur on top. */
const TEXT_SCALE = 4;
const texts = new Map<string, Promise<string>>();

/**
 * A synopsis as a blurred picture of itself (spoiler protection, Blur): its lines laid out as the page would set them,
 * drawn small into a canvas and read back, so it shows as soft grey lines of the right length and never as text. Made
 * once per text and box; shown as an image, it costs what any small image costs.
 */
export function blurredText(text: string, box: TextBox): Promise<string> {
  const key = `${box.w}|${box.lines}|${box.lineH}|${box.font}|${box.color}|${text}`;
  const hit = texts.get(key);
  if (hit) return hit;
  const p = new Promise<string>((resolve, reject) => {
    const c = document.createElement("canvas");
    c.width = Math.ceil(box.w / TEXT_SCALE);
    c.height = Math.ceil((box.lines * box.lineH) / TEXT_SCALE);
    const g = c.getContext("2d");
    if (!g) return reject(new Error("stillblur: no 2d context"));
    g.font = box.font;
    const lines = wrap(g, text, box.w, box.lines);
    g.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
    // In the small canvas's own pixels: about a word's letter height once shown at full size.
    g.filter = "blur(1.5px)";
    g.fillStyle = box.color;
    g.textBaseline = "middle";
    lines.forEach((l, i) => g.fillText(l, 0, i * box.lineH + box.lineH / 2));
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("stillblur: toBlob failed"))), "image/png");
  });
  texts.set(key, p);
  if (texts.size > MAX) {
    const [oldest, gone] = texts.entries().next().value as [string, Promise<string>];
    texts.delete(oldest);
    void gone.then(URL.revokeObjectURL, () => {});
  }
  return p;
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
