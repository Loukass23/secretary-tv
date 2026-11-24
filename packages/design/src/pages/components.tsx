// Every glass component in its states, placed on the 1920x1080 page and walked with the remote.
// Arrows move between specimens; OK on the Scroller goes inside it (Back leaves), OK on the wave
// cycles its state.
import { type Dir, type Focus, move, useKeys } from "@secretary/tv-kit";
import {
  AppChip,
  Avatar,
  DateChip,
  Fab,
  Glass,
  GlassRoot,
  Glow,
  glowImage,
  Icon,
  IconButton,
  type IconName,
  ICON_PATHS,
  ListCard,
  MediaTile,
  Scroller,
  Segmented,
  TINTS,
  VoiceWave,
  type WaveState,
} from "@secretary/tv-kit/src/glass/index.ts";
import { Fragment, type VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Art } from "../art.ts";
import type { PageProps } from "../app.tsx";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Spec {
  name: string;
  w: number;
  h: number;
  render(b: Box, focused: boolean): VNode;
}

const PAD = 80;
const GAP = 40;
const CAPTION = 40;
const ROW_GAP = 40;
const WAVES: readonly WaveState[] = ["idle", "listening", "thinking", "speaking"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
const CHIP = { w: 112, h: 120, stride: 126 };
const NAMES = Object.keys(ICON_PATHS) as IconName[];
const ACTIONS = NAMES.slice(0, NAMES.indexOf("clear"));
const WEATHER = NAMES.slice(NAMES.indexOf("clear"));

/** One icon at the IconButton's 34px on a glass square, with its name. */
function iconSpec(name: IconName): Spec {
  return { name, w: 96, h: 96, render: (b, f) => <IconButton {...b} focused={f} icon={<Icon name={name} />} /> };
}

export function ComponentsPage({ mode, theme, backdrop, art, group, focusAll }: PageProps & { art: Art; group: number }) {
  const [focus, setFocus] = useState<Focus>({ row: 0, col: 0 });
  const [inside, setInside] = useState(-1);
  const [wave, setWave] = useState(0);
  const [glow, setGlow] = useState<string | undefined>();

  const groups: { title: string; specs: Spec[] }[][] = [
    [
      {
        title: "Surfaces",
        specs: [
          { name: "Glass", w: 300, h: 120, render: (b, f) => <Glass {...b} focused={f} class="dz-panel"><b>Glass panel</b><small>Frost, fill and hairline</small></Glass> },
          { name: "Segmented", w: 470, h: 68, render: (b, f) => <Segmented {...b} items={["Home", "Cinema", "Shows", "Anime"]} picked={1} focusIndex={f ? 2 : -1} /> },
          { name: "IconButton", w: 72, h: 64, render: (b, f) => <IconButton {...b} focused={f} icon={<Icon name="search" />} /> },
          { name: "badge", w: 72, h: 64, render: (b, f) => <IconButton {...b} focused={f} icon={<Icon name="lights" />} badge /> },
          { name: "count", w: 72, h: 64, render: (b, f) => <IconButton {...b} focused={f} icon={<Icon name="bell" />} badge={3} /> },
          { name: "Fab", w: 88, h: 88, render: (b, f) => <Fab x={b.x} y={b.y} focused={f} /> },
        ],
      },
      {
        title: "Chips and people",
        specs: [
          { name: "DateChip", w: CHIP.w, h: CHIP.h, render: (b, f) => <DateChip {...b} focused={f} day="19" label="Thu" /> },
          { name: "with dot", w: CHIP.w, h: CHIP.h, render: (b, f) => <DateChip {...b} focused={f} day="20" label="Fri" dot /> },
          { name: "AppChip", w: 140, h: 128, render: (b, f) => <AppChip {...b} focused={f} icon={art.icons[0]} label="Music" /> },
          { name: "no icon", w: 140, h: 128, render: (b, f) => <AppChip {...b} focused={f} label="Photos" /> },
          { name: "Avatar", w: 260, h: 84, render: (b, f) => <Avatar x={b.x + 4} y={b.y + 4} focused={f} name="Guest" sub="No profile" /> },
          { name: "own colour", w: 260, h: 84, render: (b, f) => <Avatar x={b.x + 4} y={b.y + 4} focused={f} name="Robin" sub="Profile" color="#5b52e6" /> },
        ],
      },
      {
        title: "Cards",
        specs: [
          { name: "ListCard", w: 420, h: 108, render: (b, f) => <ListCard {...b} focused={f} title="Call the plumber" sub="Today, 17:00" /> },
          { name: "colour and meta", w: 420, h: 108, render: (b, f) => <ListCard {...b} focused={f} title="Bins out" sub="Every Thursday" meta="20:00" color="#ff5a26" /> },
          { name: "long text", w: 420, h: 108, render: (b, f) => <ListCard {...b} focused={f} title="A reminder whose title is far too long for its card" sub="And a subtitle that runs past the edge as well" meta="Tomorrow" color="#5a8cff" /> },
        ],
      },
    ],
    [
      {
        title: "Media",
        specs: [
          { name: "MediaTile", w: 380, h: 214, render: (b, f) => <MediaTile {...b} focused={f} src={art.stills[0]} title="The Quiet Harbour" sub="2019 · Drama" /> },
          { name: "badge", w: 380, h: 214, render: (b, f) => <MediaTile {...b} focused={f} src={art.stills[1]} title="Northern Lights" badge="4K" /> },
          { name: "progress", w: 380, h: 214, render: (b, f) => <MediaTile {...b} focused={f} src={art.stills[2]} title="Glass Mountain" sub="42 min left" progress={0.6} /> },
          { name: "poster, count", w: 160, h: 240, render: (b, f) => <MediaTile {...b} focused={f} src={art.posters[3]} count={12} /> },
          { name: "watched", w: 380, h: 214, render: (b, f) => <MediaTile {...b} focused={f} src={art.stills[3]} badge="S1E2" watched /> },
        ],
      },
      {
        title: "Motion",
        specs: [
          {
            name: inside >= 0 ? "Scroller (inside: Back leaves)" : "Scroller (OK goes inside)",
            w: 640,
            h: CHIP.h,
            render: (b, f) => {
              const at = Math.max(0, inside);
              const offset = Math.max(0, Math.min(DAYS.length * CHIP.stride - b.w, at * CHIP.stride - 200));
              return (
                <Glass {...b} focused={f && inside < 0} class="dz-track">
                  <Scroller x={0} y={0} w={b.w} h={b.h} axis="x" offset={offset} pad={0}>
                    {DAYS.map((d, i) => (
                      <DateChip
                        key={i}
                        x={i * CHIP.stride}
                        y={0}
                        w={CHIP.w}
                        h={CHIP.h}
                        page={[b.x + i * CHIP.stride - offset, b.y]}
                        day={String(16 + i)}
                        label={d}
                        dot={i % 3 === 0}
                        focused={(f || focusAll) && inside === i}
                      />
                    ))}
                  </Scroller>
                </Glass>
              );
            },
          },
          {
            name: `VoiceWave: ${WAVES[wave]} (OK cycles)`,
            w: 420,
            h: 60,
            render: (b, f) => (
              <>
                <VoiceWave {...b} state={WAVES[wave]} />
                {f && <i class="dz-ring" style={{ left: `${b.x - 8}px`, top: `${b.y - 8}px`, width: `${b.w + 16}px`, height: `${b.h + 16}px` }} />}
              </>
            ),
          },
          {
            name: "Glow behind a tile",
            w: 300,
            h: 169,
            render: (b, f) => (
              <>
                <Glow at={f || focusAll ? b : null} src={glow} />
                <MediaTile {...b} focused={f} src={art.stills[4]} title="Copper Sky" />
              </>
            ),
          },
        ],
      },
    ],
    // Every line icon, on a quiet button as Nest's header shows them, and bare at the forecast's size.
    [
      { title: "Icons · actions", specs: ACTIONS.map((n) => iconSpec(n)) },
      { title: "Icons · weather", specs: WEATHER.map((n) => iconSpec(n)) },
      { title: "In use", specs: [
        { name: "Header button", w: 72, h: 64, render: (b, f) => <IconButton {...b} focused={f} class="nest-quiet" icon={<Icon name="bell" />} badge={2} /> },
        { name: "Settings button", w: 120, h: 68, render: (b, f) => <IconButton {...b} focused={f} icon={<Icon name="settings" />} /> },
        { name: "Voice, listening", w: 140, h: 68, render: (b, f) => <IconButton {...b} focused={f} icon={<><Icon name="mic" />…</>} /> },
      ] },
    ],
  ];
  const rows = groups[group] ?? groups[0];

  useEffect(() => void glowImage(TINTS.orange).then(setGlow), []);

  const lengths = rows.map((r) => r.specs.length);
  const at = { row: Math.min(focus.row, rows.length - 1), col: 0 };
  at.col = Math.min(focus.col, lengths[at.row] - 1);
  const current = rows[at.row].specs[at.col];

  useKeys(true, (key) => {
    const scroller = current.name.startsWith("Scroller");
    if (inside >= 0) {
      if (key === "Left") setInside(Math.max(0, inside - 1));
      else if (key === "Right") setInside(Math.min(DAYS.length - 1, inside + 1));
      else if (key === "Back" || key === "Up" || key === "Down") setInside(-1);
      return true;
    }
    if (key === "Enter") {
      if (scroller) setInside(0);
      else if (current.name.startsWith("VoiceWave")) setWave((wave + 1) % WAVES.length);
      return true;
    }
    const dir = ({ Left: "left", Right: "right", Up: "up", Down: "down" } as Record<string, Dir>)[key];
    if (!dir) return false;
    const next = move(lengths, at, dir);
    if (next !== at) setFocus(next);
    return true;
  });

  // Rows top to bottom: a kicker, then the specimens, each with its caption under it.
  let y = 70;
  const placed: VNode[] = [];
  rows.forEach((row, r) => {
    placed.push(<div key={`k${r}`} class="dz-kicker" style={{ left: `${PAD}px`, top: `${y}px` }}>{row.title}</div>);
    y += 48;
    const h = Math.max(...row.specs.map((s) => s.h));
    let x = PAD;
    row.specs.forEach((s, c) => {
      const focused = focusAll || (at.row === r && at.col === c);
      const b = { x, y: y + (h - s.h) / 2, w: s.w, h: s.h };
      placed.push(<Fragment key={`s${r}-${c}`}>{s.render(b, focused)}</Fragment>);
      placed.push(
        <div key={`c${r}-${c}`} class={`dz-caption${at.row === r && at.col === c ? " is-on" : ""}`} style={{ left: `${x}px`, top: `${y + h + 14}px`, width: `${Math.max(s.w, 120)}px` }}>
          {s.name}
        </div>,
      );
      x += s.w + GAP;
    });
    y += h + CAPTION + ROW_GAP;
  });

  return (
    <GlassRoot mode={mode} wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} class={theme === "day" ? "dz-page sg-day" : "dz-page"}>
      {placed}
    </GlassRoot>
  );
}
