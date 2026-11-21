import { BIRD_SVG } from "./bird.ts";

/**
 * The loading screen's mark: the boot splash's secretary bird, blooming and then breathing (glass.css). It fades in
 * only after `delay` ms, so a load that is over at once never flashes it. `label` names what is loading.
 */
export function BirdLoader({ label, size = 300, delay = 220 }: { label?: string; size?: number; delay?: number }) {
  return (
    <div class="sg-loader" style={{ animationDelay: `${delay}ms` }}>
      <div class="sg-bird" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: BIRD_SVG }} />
      {label && <span class="sg-loader-label">{label}</span>}
    </div>
  );
}
