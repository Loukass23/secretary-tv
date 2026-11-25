// The design tokens (tv-kit glass/tokens.ts) at TV scale: the accent and the colours of the current theme, radii, the
// type scale in the current type style and text size (the toolbar switches both), and motion. OK replays the motion sample.
import { useKeys } from "@secretary/tv-kit";
import { ACCENT, DAY, Glass, GlassRoot, MOTION, NIGHT, PAGE_BG, RADII, TINTS, TYPE_SCALE } from "@secretary/tv-kit/src/glass/index.ts";
import { useState } from "preact/hooks";
import type { PageProps } from "../app.tsx";

const PAD = 80;

export function TokensPage({ mode, theme, backdrop }: PageProps) {
  const [moved, setMoved] = useState(false);
  useKeys(true, (key) => {
    if (key !== "Enter") return false;
    setMoved(!moved);
    return true;
  });
  const colours = theme === "day" ? DAY : NIGHT;
  const entries = [...Object.entries(ACCENT), ...Object.entries(colours)];

  return (
    <GlassRoot mode={mode} wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} class={theme === "day" ? "dz-page sg-day" : "dz-page"}>
      <div class="dz-kicker" style={{ left: `${PAD}px`, top: "70px" }}>
        Colour · {theme === "day" ? "Daylight (.sg-root.sg-day)" : "Night (.sg-root)"} · page {PAGE_BG[theme]}
      </div>
      {entries.map(([name, value], i) => {
        const x = PAD + (i % 5) * 352;
        const y = 120 + Math.floor(i / 5) * 126;
        return (
          <Glass key={name} x={x} y={y} w={336} h={108} class="dz-swatch">
            <i style={{ background: `var(--sg-${name})` }} />
            <div>
              <b>--sg-{name}</b>
              <small>{value}</small>
            </div>
          </Glass>
        );
      })}

      <div class="dz-kicker" style={{ left: `${PAD}px`, top: "400px" }}>App tints (wallpaper glow)</div>
      {Object.entries(TINTS).map(([name, rgb], i) => (
        <Glass key={name} x={PAD + i * 300} y={450} w={270} h={84} class="dz-swatch">
          <i style={{ background: `rgb(${rgb})` }} />
          <div>
            <b>{name}</b>
            <small>{rgb}</small>
          </div>
        </Glass>
      ))}

      <div class="dz-kicker" style={{ left: "1020px", top: "400px" }}>Radii</div>
      {Object.entries(RADII).map(([name, r], i) => (
        <Glass key={name} x={1020 + i * 210} y={450} w={190} h={120} class={`dz-radius dz-r-${name}`}>
          <b>{name}</b>
          <small>{r}</small>
        </Glass>
      ))}

      <div class="dz-kicker" style={{ left: `${PAD}px`, top: "620px" }}>Type scale (--sg-t-*, px at Normal) · titles and numbers in the style's faces</div>
      {Object.entries(TYPE_SCALE).map(([name, t], i) => {
        const big = i >= 4;
        const top = big ? 664 + [0, 54, 118, 194][i - 4] : 664 + (i % 4) * 54;
        return (
          <div key={name} class={`dz-type${big ? " is-title" : ""}`} style={{ left: `${big ? 640 : PAD}px`, top: `${top}px` }}>
            <span style={{ fontSize: `var(--sg-t-${name})` }}>{big ? "Aa 20:41" : t.use}</span>
            <small>
              {name} · {t.px}px
            </small>
          </div>
        );
      })}

      <div class="dz-kicker" style={{ left: "1020px", top: "620px" }}>
        Motion · move {MOTION.move}, fade {MOTION.fade} · OK plays it
      </div>
      <Glass x={1020} y={670} w={820} h={150} class="dz-motion">
        <i class="dz-motion-dot" style={{ transform: `translate3d(${moved ? 640 : 0}px,0,0)` }} />
      </Glass>
      <Glass x={1020} y={850} w={820} h={110} focused={moved} class="dz-panel">
        <b>Focus sheet</b>
        <small>Fades in with opacity over {MOTION.fade}, ease {MOTION.ease}</small>
      </Glass>
    </GlassRoot>
  );
}
