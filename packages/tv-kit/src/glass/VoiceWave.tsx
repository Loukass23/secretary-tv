// The assistant's wave: three tapered ribbons, drawn once as SVG images and moved by transform only
// (translate and a flipping scaleY), so it animates on the compositor like the rest of the glass
// (docs/performance.md, glass lab). The state sets how tall and how fast it moves.

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

const RIBBONS = [
  ribbon(1.5, 0, 34, 7, "#7b6cff", "#4fc3ff"),
  ribbon(2, 1.6, 26, 5, "#ff7ad9", "#7b6cff"),
  ribbon(1, 3.1, 20, 9, "#4fc3ff", "#b78bff"),
];

export function VoiceWave({ x, y, w, h, state }: { x: number; y: number; w: number; h: number; state: WaveState }) {
  return (
    <div class={`sg-wave is-${state}`} style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}>
      {RIBBONS.map((bg, i) => (
        <span key={i} class="sg-wave-amp">
          <i class={`sg-wave-r${i}`} style={{ backgroundImage: bg }} />
        </span>
      ))}
    </div>
  );
}
