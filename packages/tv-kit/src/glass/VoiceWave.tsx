// The assistant's wave: three tapered ribbons, drawn once as SVG images and moved by transform only
// (translate and scaleY), so it animates on the compositor like the rest of the glass
// (docs/performance.md, glass lab). Cool sky-blue ribbons while the viewer speaks, warm gold ribbons while Secretary
// answers, and fast syllabic attack / smooth release when setWaveLevel() drives live audio.
import { useEffect, useRef } from "preact/hooks";

/** idle: the orb at rest; listening: blue ready/voice wave; thinking: tight fast pulse; speaking: warm reply wave. */
export type WaveState = "idle" | "listening" | "thinking" | "speaking";

const W = 800;
const H = 100;

/** One ribbon as an SVG data URI: a sine whose height and thickness taper to nothing at both ends. */
function ribbon(cycles: number, phase: number, amp: number, thick: number, from: string, to: string): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const env = Math.sin(Math.PI * t) ** 1.5;
    const y = H / 2 + amp * env * Math.sin(2 * Math.PI * cycles * t + phase);
    const half = (thick / 2) * env + 0.5;
    top.push(`${(t * W).toFixed(1)},${(y - half).toFixed(1)}`);
    bottom.push(`${(t * W).toFixed(1)},${(y + half).toFixed(1)}`);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${from}" stop-opacity="0"/>` +
    `<stop offset=".24" stop-color="${from}"/><stop offset=".76" stop-color="${to}"/>` +
    `<stop offset="1" stop-color="${to}" stop-opacity="0"/></linearGradient></defs>` +
    `<path fill="url(#g)" d="M${top.join(" L")} L${bottom.reverse().join(" L")} Z"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function orbSvg(c0: string, c1: string, c2: string, c3: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="b" cx=".38" cy=".34" r=".7">` +
    `<stop offset="0" stop-color="${c0}"/><stop offset=".36" stop-color="${c1}"/><stop offset=".76" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>` +
    `</radialGradient></defs><circle cx="50" cy="50" r="48" fill="url(#b)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const ROOM = [
  ribbon(1.8, 0, 38, 8, "#0284c7", "#38bdf8"),
  ribbon(2.5, 2.1, 30, 6, "#2dd4bf", "#60a5fa"),
  ribbon(1.2, 4.1, 24, 10, "#7dd3fc", "#38bdf8"),
];
const NEST = [
  ribbon(1.8, 0, 38, 8, "#f59e0b", "#fcd34d"),
  ribbon(2.5, 2.1, 30, 6, "#fb923c", "#fbbf24"),
  ribbon(1.2, 4.1, 24, 10, "#fde68a", "#f59e0b"),
];

export const WAVE_ORB = orbSvg("#fff0c4", "#ffb52e", "#ff7a1a", "#c2410c");
export const WAVE_ORB_LISTEN = orbSvg("#e0f2fe", "#38bdf8", "#0284c7", "#1d4ed8");

let level: number | null = null;
const listeners = new Set<() => void>();

/** How loud the voice is now, 0..1; null hands the wave back to its state's own motion. */
export function setWaveLevel(v: number | null) {
  const next = v === null ? null : Math.max(0, Math.min(1, v));
  if (next === level) return;
  level = next;
  for (const l of listeners) l();
}

export function currentWaveLevel(): number | null {
  return level;
}

const ATTACK = [0.65, 0.48, 0.34];
const RELEASE = [0.22, 0.16, 0.11];
const GAIN = [1.32, 1.0, 0.74];
const FLOOR = 0.14;

export function VoiceWave({ x, y, w, h, state }: { x: number; y: number; w: number; h: number; state: WaveState }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const amps = Array.from(el.querySelectorAll<HTMLElement>(".sg-wave-amp"));
    const orbs = Array.from(el.querySelectorAll<HTMLElement>(".sg-wave-orb"));
    const eased = [0, 0, 0];
    let frame = 0;
    const tick = () => {
      frame = 0;
      if (level === null) {
        el.classList.remove("is-live", "is-hearing");
        for (const a of amps) a.style.transform = "";
        for (const o of orbs) o.style.transform = "";
        eased.fill(0);
        return;
      }
      el.classList.add("is-live");
      el.classList.toggle("is-hearing", level > 0.08);
      let moving = false;
      for (let i = 0; i < 3; i++) {
        const d = level - eased[i];
        eased[i] += d * (d > 0 ? ATTACK[i] : RELEASE[i]);
        if (Math.abs(d) > 0.003) moving = true;
      }
      amps.forEach((a, k) => {
        a.style.transform = `scaleY(${(FLOOR + GAIN[k % 3] * eased[k % 3]).toFixed(3)})`;
      });
      const s = `scale(${(0.92 + eased[0] * 0.32).toFixed(3)})`;
      for (const o of orbs) o.style.transform = s;
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

  const orbBox = { width: `${h}px`, height: `${h}px`, left: `calc(50% - ${h / 2}px)` };
  return (
    <div ref={root} class={`sg-wave is-${state}`} style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}>
      <span class="sg-wave-orb sg-wave-orb-warm" style={{ backgroundImage: WAVE_ORB, ...orbBox }} />
      <span class="sg-wave-orb sg-wave-orb-cool" style={{ backgroundImage: WAVE_ORB_LISTEN, ...orbBox }} />
      {[ROOM, NEST].map((set, s) => (
        <span key={s} class={`sg-wave-set sg-wave-${s ? "nest" : "room"}`} style={{ transformOrigin: "50% 50%" }}>
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
