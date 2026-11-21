import type { ComponentChildren } from "preact";
import { BIRD_SVG } from "./bird.ts";

/**
 * The loading screen's mark: the boot splash's secretary bird, blooming and then breathing (glass.css). It fades in
 * only after `delay` ms, so a load that is over at once never flashes it. `label` names what is loading and `children`
 * (a status line, badges, a bar) sit under it. `calm` skips the bloom, so a second loading screen right after the first
 * continues it instead of starting the bird over.
 */
export function BirdLoader({ label, size = 260, delay = 220, calm, children }: { label?: string; size?: number; delay?: number; calm?: boolean; children?: ComponentChildren }) {
  return (
    <div class={`sg-loader${calm ? " is-calm" : ""}`} style={calm ? undefined : { animationDelay: `${delay}ms` }}>
      <div class="sg-bird" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: BIRD_SVG }} />
      {label && <span class="sg-loader-label">{label}</span>}
      {children}
    </div>
  );
}
