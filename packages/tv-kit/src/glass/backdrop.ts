// The blur behind glass surfaces, computed once. A live backdrop-filter drops a glass screen to
// about 15 fps on the TV; this costs nothing per frame (docs/performance.md, glass lab).

/** The blurred copy is drawn at 1/FROST_SCALE of the page and scaled back up by the compositor. */
export const FROST_SCALE = 4;
export const PAGE_W = 1920;
export const PAGE_H = 1080;

/**
 * Blurs a full-page backdrop (1920x1080, drawn or same-origin) into a small image and returns its
 * object URL for <GlassRoot frost>. Rejects when the canvas is tainted by a cross-origin image;
 * the caller then renders flat glass.
 */
export function blurBackdrop(source: CanvasImageSource, blurPx = 10, saturate = 1.4): Promise<string> {
  const c = document.createElement("canvas");
  c.width = PAGE_W / FROST_SCALE;
  c.height = PAGE_H / FROST_SCALE;
  const g = c.getContext("2d")!;
  g.filter = `blur(${blurPx}px) saturate(${saturate})`;
  // Drawn slightly oversize so the blur does not pull transparent black in at the edges.
  g.drawImage(source, -12, -12, c.width + 24, c.height + 24);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("blurBackdrop: toBlob failed"))), "image/jpeg", 0.9),
  );
}
