import { BirdLoader } from "@secretary/tv-kit/src/glass/index.ts";
import "./loading.css";

/**
 * The one loading screen of a title: the bird, what is loading, how it is going, the source's badges and a bar. The
 * page waiting for its details, the page finding a source and the player preparing the stream all show it, so going from
 * one to the next changes the words, not the screen (`calm` keeps the bird from blooming again).
 */
export function LoadingScreen({
  heading,
  status,
  badges = [],
  meta,
  bar,
  calm,
}: {
  heading: string;
  status?: string;
  badges?: readonly string[];
  /** A dim word after the badges (the source's size). */
  meta?: string;
  bar?: "loading" | "failed";
  calm?: boolean;
}) {
  return (
    <BirdLoader label={heading} calm={calm}>
      {status && <span class="ld-status">{status}</span>}
      {(badges.length > 0 || meta) && (
        <div class="ld-badges">
          {badges.map((b) => (
            <span key={b} class="ld-badge">
              {b}
            </span>
          ))}
          {meta && <span class="ld-dim">{meta}</span>}
        </div>
      )}
      <span class="ld-bar">{bar && <i class={bar === "failed" ? "is-failed" : "is-loading"} />}</span>
    </BirdLoader>
  );
}
