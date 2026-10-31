// Glass lab: one screen in the style of the reference (floating translucent panels), built from
// the tv-kit glass components and rendered three ways so the TV can be measured, not guessed:
//   flat  translucent fills only, no blur (the floor)
//   live  backdrop-filter blur on every glass surface
//   fake  a once-blurred copy of the wallpaper behind each surface (what real screens use)
// Turn it on with ?lab=<mode> or localStorage "nest.lab"; Red cycles the mode, Back leaves.
// Results: docs/performance.md, glass lab.
import { useKeys } from "@secretary/tv-kit";
import {
  Avatar,
  DateChip,
  Fab,
  Glass,
  type GlassMode,
  GlassRoot,
  IconButton,
  ListCard,
  MediaTile,
  PAGE_H,
  Scroller,
  Segmented,
} from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useState } from "preact/hooks";
import { drawArt, type LabArt } from "./art.ts";
import { DAYS, EVENTS, type Focus, HOURS, ICONS, SEGMENTS, step } from "./nav.ts";
import "./lab.css";

export const LAB_MODES: readonly GlassMode[] = ["flat", "live", "fake"];
const STORAGE_KEY = "nest.lab";

/** The lab mode asked for, or null for the normal launcher. */
export function labMode(): GlassMode | null {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(location.search).get("lab") ?? localStorage.getItem(STORAGE_KEY);
  } catch {
    // no storage: normal launcher
  }
  return LAB_MODES.includes(asked as GlassMode) ? (asked as GlassMode) : null;
}

// Layout in CSS px on the 1920x1080 page.
const PAD = 80;
const COL_X = 1020;
const COL_W = 820;
const CHIP_W = 112;
const CHIP_H = 120;
const CHIP_STRIDE = 126;
const STRIP_Y = 196;
const CARD_Y = 356;
const CARD_H = 128;
const CARD_STRIDE = 152;
const WEATHER = { x: PAD, y: 318, w: 820, h: 236 };
const TILE_Y = 652;
const TILE_W = 395;
const TILE_H = 236;
const SEG = { x: 650, y: 96, w: 600, h: 68 };
const ICON_W = 120;
const ICON_X = [1580, 1720];

const clock = () => {
  const d = new Date();
  const h = d.getHours() % 12 || 12;
  return [`${h}:${String(d.getMinutes()).padStart(2, "0")}`, d.getHours() < 12 ? "am" : "pm"];
};

export function Lab({ initial }: { initial: GlassMode }) {
  const [mode, setMode] = useState(initial);
  const [art, setArt] = useState<LabArt | null>(null);
  const [focus, setFocus] = useState<Focus>({ area: "cards", i: 0 });
  const [time, setTime] = useState(clock);

  useEffect(() => {
    void drawArt().then(setArt);
    const t = setInterval(() => setTime(clock()), 30_000);
    return () => clearInterval(t);
  }, []);

  useKeys(true, (key) => {
    if (key === "Red") {
      const next = LAB_MODES[(LAB_MODES.indexOf(mode) + 1) % LAB_MODES.length];
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // the mode still changes for this run
      }
      setMode(next);
      return true;
    }
    if (key === "Back") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      location.reload();
      return true;
    }
    const next = step(focus, key);
    if (next !== focus) setFocus(next);
    return true;
  });

  if (!art) return <GlassRoot mode={mode} />;

  const on = (area: Focus["area"], i: number) => focus.area === area && focus.i === i;
  const cardScroll = Math.max(0, (focus.area === "cards" ? focus.i : 0) - 1) * CARD_STRIDE;
  const dateAt = focus.area === "dates" ? focus.i : 3;
  const stripScroll = Math.max(0, Math.min(DAYS.length * CHIP_STRIDE - COL_W, dateAt * CHIP_STRIDE - 300));

  return (
    <GlassRoot mode={mode} wallpaper={art.wallpaper} frost={art.blurred} class="lab">
      <div class="lab-badge">
        lab · {mode}
        {mode === "live" && !CSS.supports("backdrop-filter", "blur(1px)") ? " (unsupported)" : ""} · Red: next mode
      </div>

      <div class="lab-clock" style={{ left: `${PAD}px`, top: "72px" }}>
        {time[0]}
        <small>{time[1]}</small>
      </div>
      <div class="lab-date" style={{ left: `${PAD}px`, top: "212px" }}>
        March 25, 2020
        <small>Wednesday</small>
      </div>

      <Segmented
        {...SEG}
        items={SEGMENTS}
        picked={0}
        focusIndex={focus.area === "top" && focus.i < SEGMENTS.length ? focus.i : -1}
      />
      {ICON_X.map((x, i) => (
        <IconButton
          key={x}
          x={x}
          y={SEG.y}
          w={ICON_W}
          h={SEG.h}
          icon={ICONS[i]}
          badge={i === 1}
          focused={on("top", SEGMENTS.length + i)}
        />
      ))}

      <Glass {...WEATHER} class="lab-weather">
        {HOURS.map(([icon, temp, label], i) => (
          <div key={label} class={`lab-hour${i === 3 ? " now" : ""}${on("weather", i) ? " focus" : ""}`}>
            <span class="w-icon">{icon}</span>
            <b>{temp}C</b>
            <small>{label}</small>
          </div>
        ))}
      </Glass>

      <div class="lab-label" style={{ left: `${PAD}px`, top: `${TILE_Y - 50}px` }}>Explore</div>
      <div class="lab-label" style={{ left: `${PAD + TILE_W + 30}px`, top: `${TILE_Y - 50}px` }}>Story</div>
      <MediaTile
        x={PAD}
        y={TILE_Y}
        w={TILE_W}
        h={TILE_H}
        src={art.tiles[0]}
        title="Graphic Means Salon"
        sub="◷ 1:00pm–3:30pm"
        count={3}
        focused={on("tiles", 0)}
      />
      <MediaTile
        x={PAD + TILE_W + 30}
        y={TILE_Y}
        w={TILE_W}
        h={TILE_H}
        src={art.tiles[1]}
        title="March 23, 2020"
        count={7}
        focused={on("tiles", 1)}
      />

      <Avatar x={PAD} y={936} name="Secretary" sub="nest@secretary.local" />

      <Scroller x={COL_X} y={STRIP_Y} w={COL_W} h={CHIP_H} axis="x" offset={stripScroll}>
        {DAYS.map((d, i) => (
          <DateChip
            key={i}
            x={i * CHIP_STRIDE}
            y={0}
            w={CHIP_W}
            h={CHIP_H}
            page={[COL_X + i * CHIP_STRIDE - stripScroll, STRIP_Y]}
            day={22 + i}
            label={d}
            dot={i % 3 !== 1}
            focused={on("dates", i)}
          />
        ))}
      </Scroller>

      <Scroller x={COL_X} y={CARD_Y} w={COL_W} h={PAGE_H - CARD_Y} axis="y" offset={cardScroll}>
        {EVENTS.map(([title, sub, at, color], i) => {
          const y = CARD_Y + i * CARD_STRIDE - cardScroll;
          const below = (y - CARD_Y) / CARD_STRIDE;
          return (
            <ListCard
              key={title}
              x={0}
              y={i * CARD_STRIDE}
              w={COL_W}
              h={CARD_H}
              page={[COL_X, y]}
              opacity={below > 3 ? 0.35 : below < -0.5 ? 0 : 1}
              title={title}
              sub={sub}
              meta={`⏰ ${at}`}
              color={color}
              focused={on("cards", i)}
            />
          );
        })}
      </Scroller>

      <Fab x={1752} y={952} />
    </GlassRoot>
  );
}
