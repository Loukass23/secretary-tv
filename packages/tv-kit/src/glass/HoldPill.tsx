import { useEffect, useRef } from "preact/hooks";
import { Glass } from "./Glass.tsx";

/** A tap never flashes the pill: it shows only once OK has been down this long. */
export const HOLD_PILL_DELAY_MS = 150;

/**
 * "Hold for options" with a bar that fills while OK is held (`since` is when it went down, from createOkHold's
 * onChange; null hides the pill), then "Release for options". Place it inside a GlassRoot. It is one flat surface that
 * only fades in; the bar moves by transform, written straight to the DOM from one rAF loop, so the page does not render
 * per frame.
 */
export function HoldPill({ since, holdMs = 600, x = 1400, y = 40, w = 440, h = 60 }: { since: number | null; holdMs?: number; x?: number; y?: number; w?: number; h?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = root.current;
    if (since == null) {
      el?.classList.remove("is-open");
      return;
    }
    let raf = 0;
    const tick = () => {
      const p = Math.max(0, Math.min(1, (Date.now() - since) / holdMs));
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      if (label.current) label.current.textContent = p >= 1 ? "Release for options" : "Hold for options";
      raf = requestAnimationFrame(tick);
    };
    const show = setTimeout(() => {
      el?.classList.add("is-open");
      tick();
    }, Math.max(0, HOLD_PILL_DELAY_MS - (Date.now() - since)));
    return () => {
      clearTimeout(show);
      cancelAnimationFrame(raf);
    };
  }, [since, holdMs]);
  return (
    <div ref={root} class="sg-holdpill-wrap">
      <Glass x={x} y={y} w={w} h={h} frost={false} class="sg-holdpill">
        <span ref={label} class="sg-holdpill-text">Hold for options</span>
        <i class="sg-holdpill-track">
          <i ref={fill} class="sg-holdpill-fill" />
        </i>
      </Glass>
    </div>
  );
}
