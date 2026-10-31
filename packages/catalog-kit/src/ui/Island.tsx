import { Glass, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useState } from "preact/hooks";
import { createIsland, type IslandMessage } from "../lib/island.ts";

/** The app's one island (lib/island.ts): any view pushes to it, ui/Island.tsx shows it. */
export const island = createIsland();

// Debug handle for the CDP scripts, next to the player's and the plugins'.
const dbg = globalThis as unknown as { __sectv?: Record<string, unknown> };
dbg.__sectv ??= {};
dbg.__sectv.island = island;

const W = 820;
const H = 60;

/**
 * Short messages in a glass pill. The pill has a fixed size and grows from its centre by transform, and its text fades
 * in after, so a message never relayouts the page. Over the video it sits at the top, out of the controls' way, and
 * is smoked like them.
 */
export function Island({ onVideo }: { onVideo: boolean }) {
  const [msg, setMsg] = useState<IslandMessage | null>(() => island.current());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      setMsg(island.current());
      clearTimeout(timer);
      const end = island.endsAt();
      if (end != null) timer = setTimeout(update, Math.max(0, end - Date.now()) + 20);
    };
    const stop = island.subscribe(update);
    update();
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);
  return (
    <GlassRoot mode="flat" class="island-root">
      <Glass
        x={(1920 - W) / 2}
        y={onVideo ? 40 : 990}
        w={W}
        h={H}
        frost={false}
        class={`island${msg ? " is-open" : ""}${msg?.level === "error" ? " is-error" : ""}`}
      >
        <span class="island-text">{msg ? `${msg.level === "error" ? "⚠ " : ""}${msg.text}` : ""}</span>
      </Glass>
    </GlassRoot>
  );
}
