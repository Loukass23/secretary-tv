// The catalog home's "top shelf" backdrop: the focused title's art under a shade, and a once-blurred
// copy of both for the glass over it. Remote art can be drawn into a canvas because the widget runs
// from file:// (docs/lessons.md); a failed load or blur leaves the app backdrop in place.
import { blurBackdrop, canvas, PAGE_H as H, PAGE_W as W } from "@secretary/tv-kit/src/glass/index.ts";

/** Darkens the left and bottom of the art so the info panel and rows read on any backdrop. */
function paintShade(g: CanvasRenderingContext2D, w: number, h: number): void {
  const left = g.createLinearGradient(0, 0, w * 0.62, 0);
  left.addColorStop(0, "rgba(7,8,11,0.78)");
  left.addColorStop(1, "rgba(7,8,11,0)");
  g.fillStyle = left;
  g.fillRect(0, 0, w, h);
  const bottom = g.createLinearGradient(0, h * 0.38, 0, h);
  bottom.addColorStop(0, "rgba(7,8,11,0)");
  bottom.addColorStop(0.55, "rgba(7,8,11,0.86)");
  bottom.addColorStop(1, "rgba(7,8,11,1)");
  g.fillStyle = bottom;
  g.fillRect(0, 0, w, h);
}

let shade: Promise<string> | null = null;

/** The shade as an image, drawn once: painted by the compositor, never by a CSS gradient. */
export function shadeImage(): Promise<string> {
  shade ??= new Promise((resolve, reject) => {
    const [c, g] = canvas(W, H);
    paintShade(g, W, H);
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("shade failed"))), "image/png");
  });
  return shade;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`art failed: ${src}`));
    img.src = src;
  });
}

/** Loads and decodes a backdrop before it is shown, so the swap itself costs no decode (docs/performance.md). */
export async function preload(src: string): Promise<void> {
  const img = await load(src);
  await img.decode?.().catch(() => {});
}

/** Draws `img` covering a w x h box, as `object-fit: cover` does. */
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** The readable copy's size: a quarter of the page each way, scaled up by the compositor (which softens it further). */
const READ_W = W / 4;
const READ_H = H / 4;

/**
 * Darkens and softens the art where a page writes on it: a blurred, much darker copy of the art, opaque over the left
 * of the page (where the logo, the lines and the buttons are) and fading to nothing by two thirds across, then the
 * shade over all of it. Painted once per backdrop into a small canvas, never by a CSS gradient or filter.
 */
function paintReadable(g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void {
  const [dc, dg] = canvas(w, h);
  dg.filter = "blur(3px)";
  cover(dg, img, w, h);
  dg.filter = "none";
  dg.fillStyle = "rgba(7,8,11,0.6)";
  dg.fillRect(0, 0, w, h);
  // Kept where the text is, faded out towards the right.
  const mask = dg.createLinearGradient(0, 0, w, 0);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.4, "rgba(0,0,0,1)");
  mask.addColorStop(0.68, "rgba(0,0,0,0)");
  dg.globalCompositeOperation = "destination-in";
  dg.fillStyle = mask;
  dg.fillRect(0, 0, w, h);
  g.drawImage(dc, 0, 0);
  paintShade(g, w, h);
}

const readables = new Map<string, Promise<string>>();
const MAX_READABLES = 8;

/**
 * The readable layer for one backdrop URL (catalog home hero, title pages): shown over the art in place of the shade,
 * so text sits on a dark, soft copy of the picture itself rather than on a band of black. Cached per URL; rejects
 * when the art cannot be read back (a tainted canvas on a desktop browser), and the page keeps the plain shade.
 */
export function readableFor(src: string): Promise<string> {
  let p = readables.get(src);
  if (!p) {
    p = load(src).then(
      (img) =>
        new Promise<string>((resolve, reject) => {
          const [c, g] = canvas(READ_W, READ_H);
          paintReadable(g, img, READ_W, READ_H);
          c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("readable failed"))), "image/png");
        }),
    );
    p.catch(() => readables.delete(src));
    readables.set(src, p);
    if (readables.size > MAX_READABLES) {
      const oldest = readables.keys().next().value!;
      void readables.get(oldest)?.then(URL.revokeObjectURL, () => {});
      readables.delete(oldest);
    }
  }
  return p;
}

const frosts = new Map<string, Promise<string>>();
const MAX_FROSTS = 24;

/** The blurred art-plus-shade behind the glass for one backdrop URL, cached per URL. */
export function frostFor(src: string): Promise<string> {
  let p = frosts.get(src);
  if (!p) {
    p = load(src).then((img) => {
      // Composed small: the blur works at 1/4 size anyway, and this keeps the canvas work cheap.
      const [c, g] = canvas(W / 4, H / 4);
      cover(g, img, W / 4, H / 4);
      paintShade(g, W / 4, H / 4);
      return blurBackdrop(c, 6);
    });
    p.catch(() => frosts.delete(src));
    frosts.set(src, p);
    if (frosts.size > MAX_FROSTS) frosts.delete(frosts.keys().next().value!);
  }
  return p;
}
