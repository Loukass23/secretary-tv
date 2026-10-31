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
