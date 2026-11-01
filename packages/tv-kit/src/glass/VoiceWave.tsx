// The assistant's wave: three tapered ribbons, drawn once as SVG images and moved by transform only
// (translate and a flipping scaleY), so it animates on the compositor like the rest of the glass
// (docs/performance.md, glass lab). The state sets how tall and how fast it moves; while someone speaks (the room
// microphone) or Nest does (a spoken reply), setWaveLevel() drives its height from the voice instead.
import { useEffect, useRef } from "preact/hooks";

/** idle: a slow ripple; listening: full height; thinking: low and fast; speaking: tall while a reply arrives. */
export type WaveState = "idle" | "listening" | "thinking" | "speaking";

const W = 800;
const H = 100;

/** One ribbon as an SVG data URI: a sine whose height and thickness taper to nothing at both ends. */
function ribbon(cycles: number, phase: number, amp: number, thick: number, from: string, to: string): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const env = Math.sin(Math.PI * t) ** 1.6;
    const y = H / 2 + amp * env * Math.sin(2 * Math.PI * cycles * t + phase);
    const half = (thick / 2) * env + 0.4;
    top.push(`${(t * W).toFixed(1)},${(y - half).toFixed(1)}`);
    bottom.push(`${(t * W).toFixed(1)},${(y + half).toFixed(1)}`);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
    `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${from}" stop-opacity="0"/>` +
    `<stop offset=".3" stop-color="${from}"/><stop offset=".7" stop-color="${to}"/>` +
    `<stop offset="1" stop-color="${to}" stop-opacity="0"/></linearGradient></defs>` +
    `<path fill="url(#g)" d="M${top.join(" L")} L${bottom.reverse().join(" L")} Z"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Cool ribbons while the room talks, warm ones while Nest does; the two sets swap by opacity. */
const ROOM = [
  ribbon(1.5, 0, 34, 7, "#7b6cff", "#4fc3ff"),
  ribbon(2, 1.6, 26, 5, "#ff7ad9", "#7b6cff"),
  ribbon(1, 3.1, 20, 9, "#4fc3ff", "#b78bff"),
];
const NEST = [
  ribbon(1.5, 0, 34, 7, "#b06cff", "#ff7ad9"),
  ribbon(2, 1.6, 26, 5, "#ffb36b", "#b06cff"),
  ribbon(1, 3.1, 20, 9, "#ff7ad9", "#ffd36b"),
];

// --- the level bus: one voice at a time, read by every mounted wave ---

let level: number | null = null;
const listeners = new Set<() => void>();

/** How loud the voice is now, 0..1; null hands the wave back to its state's own motion. */
export function setWaveLevel(v: number | null) {
  const next = v === null ? null : Math.max(0, Math.min(1, v));
  if (next === level) return;
  level = next;
  for (const l of listeners) l();
}

/** Each ribbon follows the voice at its own pace and height, so they part and rejoin like the reference. */
const FOLLOW = [0.35, 0.22, 0.14];
const GAIN = [1.05, 0.8, 0.6];
const FLOOR = 0.12;

export function VoiceWave({ x, y, w, h, state }: { x: number; y: number; w: number; h: number; state: WaveState }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const amps = Array.from(el.querySelectorAll<HTMLElement>(".sg-wave-amp"));
    const eased = [0, 0, 0];
    let frame = 0;
    const tick = () => {
      frame = 0;
      if (level === null) {
        // The voice stopped: CSS takes the ribbons back to the state's height with its own transition.
        el.classList.remove("is-live");
        for (const a of amps) a.style.transform = "";
        eased.fill(0);
        return;
      }
      el.classList.add("is-live");
      let moving = false;
      for (let i = 0; i < 3; i++) {
        const d = level - eased[i];
        eased[i] += d * FOLLOW[i];
        if (Math.abs(d) > 0.004) moving = true;
      }
      amps.forEach((a, k) => (a.style.transform = `scaleY(${(FLOOR + GAIN[k % 3] * eased[k % 3]).toFixed(3)})`));
      // Keep easing towards the last level; a new level restarts the loop anyway.
      if (moving) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    listeners.add(wake);
    wake();
    return () => {
      listeners.delete(wake);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={root}
      class={`sg-wave is-${state}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
    >
      {[ROOM, NEST].map((set, s) => (
        <span key={s} class={`sg-wave-set sg-wave-${s ? "nest" : "room"}`}>
          {set.map((bg, i) => (
            <span key={i} class="sg-wave-amp">
              <i class={`sg-wave-r${i}`} style={{ backgroundImage: bg }} />
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
