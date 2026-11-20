import { useLayoutEffect, useRef } from "preact/hooks";
import type { Palette } from "./palette.ts";

const VARS = ["--sg-focus", "--sg-focus-ink", "--sg-focus-ink-dim"] as const;

/**
 * Tints the focus ring and the focus fill with `palette`'s accent (night only; null leaves the defaults). The colour is set on
 * the focused elements themselves, never on the page root: a custom property changed on the root restyles every element
 * under it (about 55 ms for Nest on the TV, against 8 ms for one element), and that on every move of focus.
 * Call it once in the screen's component: it runs after every render, before paint, so a newly focused element is never
 * drawn in the default colour first.
 */
export function useFocusRing(palette: Palette | null): void {
  const tinted = useRef(new Set<HTMLElement>());
  useLayoutEffect(() => {
    const now = new Set<HTMLElement>();
    if (palette) {
      const accent = `rgb(${palette.accent.join(",")})`;
      document.querySelectorAll<HTMLElement>(".sg-root .is-focus").forEach((el) => {
        now.add(el);
        el.style.setProperty(VARS[0], accent);
        el.style.setProperty(VARS[1], "#1c1008");
        el.style.setProperty(VARS[2], "rgba(28, 16, 8, 0.62)");
      });
    }
    for (const el of tinted.current) if (!now.has(el)) VARS.forEach((v) => el.style.removeProperty(v));
    tinted.current = now;
  });
}
