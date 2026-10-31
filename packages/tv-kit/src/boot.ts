import { readJson } from "./storage.ts";

export type BootAnimationMode = "standard" | "fade" | "instant";

export interface BootOptions {
  /** Override mode; if omitted, reads from stored `sectv:settings:v1` or defaults to "standard". */
  mode?: BootAnimationMode;
  /** How long the crest stays once it has risen in, before the screen leaves (ms). */
  holdMs?: number;
  /** How long the screen takes to slide up and fade out (ms); index.html's transition matches it. */
  exitMs?: number;
}

function resolveBootMode(explicit?: BootAnimationMode): BootAnimationMode {
  if (explicit) return explicit;
  try {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return "fade";
    }
  } catch {
    // Ignore matchMedia errors.
  }
  const saved = readJson<{ general?: { bootAnimation?: BootAnimationMode } }>("sectv:settings:v1");
  const mode = saved?.general?.bootAnimation;
  if (mode === "standard" || mode === "fade" || mode === "instant") return mode;
  return "standard";
}

/**
 * Runs the boot screen out: the crest rises in (index.html), holds briefly, then the screen slides up and fades.
 * Transform and opacity only, so it stays on the compositor.
 * - Driven by `requestAnimationFrame` so timer starvation on Tizen never delays boot (`docs/lessons.md`).
 * - A remote key during the hold starts the exit at once.
 * - Marks `boot.dataset.leaving = "true"` immediately on frame 1 so `boot-watchdog.js` knows the bundle mounted cleanly.
 */
export function runBootAnimation(options: BootOptions = {}): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;

  requestAnimationFrame(() => {
    const boot = document.getElementById("boot");
    const root = document.documentElement;
    if (!boot) {
      root.dataset.bootReady = "true";
      root.dataset.bootDone = "true";
      return;
    }

    // Signal boot-watchdog immediately that the app mounted cleanly.
    boot.dataset.leaving = "true";

    const mode = resolveBootMode(options.mode);
    if (mode === "instant") {
      root.dataset.bootReady = "true";
      root.dataset.bootDone = "true";
      boot.remove();
      console.info(`[app] mounted (instant) in ${Math.round(performance.now())}ms`);
      return;
    }

    const holdMs = options.holdMs ?? 280;
    const exitMs = mode === "fade" ? 220 : (options.exitMs ?? 360);
    const start = performance.now();
    let stage: "hold" | "exit" | "done" = "hold";
    let exitStart = 0;

    boot.dataset.stage = "hold";
    boot.dataset.mode = mode;

    const finish = () => {
      if (stage === "done") return;
      stage = "done";
      window.removeEventListener("keydown", onSkipKey, true);
      root.dataset.bootReady = "true";
      root.dataset.bootDone = "true";
      boot.remove();
    };

    const startExit = (now: number) => {
      if (stage !== "hold") return;
      stage = "exit";
      exitStart = now;
      boot.dataset.stage = "exit";
      root.dataset.bootReady = "true";
      root.dataset.bootDone = "true";
    };

    // Someone pressing a key wants the app now: the exit starts at once.
    const onSkipKey = () => {
      startExit(performance.now());
    };
    window.addEventListener("keydown", onSkipKey, true);

    const step = (now: number) => {
      if (stage === "done") return;
      if (stage === "hold") {
        if (now - start >= holdMs) {
          startExit(now);
        }
        requestAnimationFrame(step);
        return;
      }
      if (stage === "exit") {
        if (now - exitStart >= exitMs) {
          finish();
          return;
        }
        requestAnimationFrame(step);
      }
    };

    console.info(`[app] mounted in ${Math.round(start)}ms (boot=${mode})`);
    requestAnimationFrame(step);
  });
}
