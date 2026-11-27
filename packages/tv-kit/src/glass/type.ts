// The type style and text size (tokens.ts TYPE_STYLES, TEXT_SIZES), switched by two attributes on <html>: glass.css
// holds the values, so a switch is one restyle and costs nothing afterwards. Settings (wave 3) calls applyType when the
// viewer picks; Secretary calls it once at start with the saved choice.
import { DISPLAY_FONTS, type DisplayFont, TEXT_SIZES, type TextSize, TYPE_STYLES, type TypeStyle } from "./tokens.ts";

export const isTypeStyle = (v: unknown): v is TypeStyle => typeof v === "string" && v in TYPE_STYLES;
export const isTextSize = (v: unknown): v is TextSize => typeof v === "string" && v in TEXT_SIZES;

/** The attributes for a choice: none for the defaults (Studio, Normal), so a page without them looks the same. */
export function typeAttrs(style: TypeStyle, size: TextSize): { "data-sg-type"?: string; "data-sg-text"?: string } {
  return {
    ...(style !== "studio" ? { "data-sg-type": style } : {}),
    ...(size !== "normal" ? { "data-sg-text": size } : {}),
  };
}

/** Puts `style` and `size` on the page (unknown values fall back to Studio and Normal). */
export function applyType(style: unknown, size: unknown, root: HTMLElement | undefined = typeof document !== "undefined" ? document.documentElement : undefined): void {
  if (!root) return;
  const attrs = typeAttrs(isTypeStyle(style) ? style : "studio", isTextSize(size) ? size : "normal");
  for (const name of ["data-sg-type", "data-sg-text"] as const) {
    const v = attrs[name];
    if (v) root.setAttribute(name, v);
    else root.removeAttribute(name);
  }
}

export const isDisplayFont = (v: unknown): v is DisplayFont => typeof v === "string" && v in DISPLAY_FONTS;

/** The display face's attribute: none for Grotesk, the default. */
export function fontAttr(font: DisplayFont): { "data-sg-font"?: string } {
  return font !== "grotesk" ? { "data-sg-font": font } : {};
}

/** Puts the display face `font` on the page (unknown values fall back to Grotesk): one restyle, like `applyType`. */
export function applyFont(font: unknown, root: HTMLElement | undefined = typeof document !== "undefined" ? document.documentElement : undefined): void {
  if (!root) return;
  const v = fontAttr(isDisplayFont(font) ? font : "grotesk")["data-sg-font"];
  if (v) root.setAttribute("data-sg-font", v);
  else root.removeAttribute("data-sg-font");
}
