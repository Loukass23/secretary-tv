// Every glass component in its states, placed on the 1920x1080 page and walked with the remote.
// Arrows move between specimens; OK on the Scroller goes inside it (Back leaves), OK on the wave
// cycles its state.
import { type Dir, type Focus, move, useKeys } from "@secretary/tv-kit";
import {
  AppChip,
  Avatar,
  ButtonRow,
  DateChip,
  Fab,
  Glass,
  GlassRoot,
  Glow,
  glowImage,
  Header,
  Icon,
  IconButton,
  type IconName,
  ICON_PATHS,
  InfoPanel,
  Kicker,
  LandscapeTile,
  ListCard,
  MediaTile,
  PosterTile,
  PreviewList,
  type PreviewListItem,
  RankNumber,
  RowLabel,
  Scroller,
  Segmented,
  Tabs,
  TINTS,
  VoiceWave,
  type WaveState,
} from "@secretary/tv-kit/src/glass/index.ts";
import { Fragment, type VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Art } from "../art.ts";
import type { PageProps } from "../app.tsx";
import { headerButtons } from "@secretary/launcher/src/home.tsx";

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
/** Secretary's header buttons, as the home screen shows them (Watch together hidden while it is off). */
const HEAD_BUTTONS = headerButtons(undefined, true, 2);
/** Settings-like lines for the preview piece: what wave 3 puts beside a preview of each choice. */
const LOOK_LINES: readonly PreviewListItem[] = [
  { key: "accent", title: "Accent", sub: "Raptor Orange", color: "#ff5a26" },
  { key: "type", title: "Type style", sub: "Studio" },
  { key: "size", title: "Text size", sub: "Normal" },
  { key: "theme", title: "Theme", sub: "Automatic" },
  { key: "clock", title: "Clock", sub: "24 hours" },
  { key: "boot", title: "Start animation", sub: "Standard" },
  { key: "cards", title: "Card size", sub: "Automatic" },
  { key: "tabs", title: "Tab style", sub: "Automatic" },
];
const SEASONS = Array.from({ length: 12 }, (_, i) => `Season ${i + 1}`);
const ABOUT = "A lighthouse keeper on a remote island finds a message in a bottle, and starts a long correspondence with a stranger who seems to know the island better than anyone.";
/** The groups drawn under the header, which start lower so it stays clear. */
const UNDER_HEADER = [3, 4, 5];
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
  const [headOpen, setHeadOpen] = useState(true);
  const [line, setLine] = useState(1);

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
        { name: "Header button", w: 72, h: 64, render: (b, f) => <IconButton {...b} focused={f} frost={false} class="sg-quiet" icon={<Icon name="bell" />} badge={2} /> },
        { name: "Settings button", w: 120, h: 68, render: (b, f) => <IconButton {...b} focused={f} icon={<Icon name="settings" />} /> },
        { name: "Voice, listening", w: 140, h: 68, render: (b, f) => <IconButton {...b} focused={f} icon={<><Icon name="mic" />…</>} /> },
      ] },
    ],
    // The one header (drawn at the top of this page) and the pieces the catalog screens take from the home screen.
    [
      {
        title: "Header",
        specs: [
          {
            name: headOpen ? "Header: expanded (OK collapses)" : "Header: clock only (OK expands, as Up does)",
            w: 420,
            h: 60,
            render: (b, f) => <ButtonRow x={b.x} y={b.y} items={[{ id: "t", label: headOpen ? "Collapse to the clock" : "Expand the header", icon: "settings" }]} focusIndex={f ? 0 : -1} />,
          },
        ],
      },
      {
        title: "Info panel",
        specs: [
          { name: "InfoPanel (home caption)", w: 620, h: 200, render: (b) => <InfoPanel {...b} title="The Quiet Harbour" meta={["2019", "Drama", "1 h 52 min"]} about={ABOUT} /> },
          {
            name: "InfoPanel glass + ButtonRow (title page)",
            w: 900,
            h: 330,
            render: (b, f) => (
              <InfoPanel {...b} glass kicker="Film" title="The Quiet Harbour" meta={["2019", "Drama", "1 h 52 min", "7.8"]} about={ABOUT} lines={2}>
                <ButtonRow
                  items={[
                    { id: "resume", label: "Resume", icon: "cinema", primary: true },
                    { id: "start", label: "Start over" },
                    { id: "party", label: "Watch together", icon: "party" },
                  ]}
                  focusIndex={f ? 0 : -1}
                />
              </InfoPanel>
            ),
          },
        ],
      },
      {
        title: "Buttons and tabs",
        specs: [
          {
            name: "ButtonRow",
            w: 520,
            h: 60,
            render: (b, f) => <ButtonRow x={b.x} y={b.y} items={[{ id: "play", label: "Play", primary: true }, { id: "trailer", label: "Trailer" }, { id: "list", label: "My List" }]} focusIndex={f ? 1 : -1} />,
          },
          { name: "Tabs (seasons, scrolls)", w: 760, h: 60, render: (b, f) => <Tabs {...b} items={SEASONS} picked={1} focusIndex={f ? 5 : -1} /> },
          { name: "Kicker", w: 200, h: 30, render: (b) => <span class="dz-at" style={{ left: `${b.x}px`, top: `${b.y}px` }}><Kicker>Watch together</Kicker></span> },
        ],
      },
    ],
    [
      {
        title: "Posters",
        specs: [
          { name: "RowLabel", w: 260, h: 40, render: (b) => <RowLabel x={b.x} y={b.y} label="Trending" count={20} /> },
          { name: "PosterTile", w: 252, h: 378, render: (b, f) => <PosterTile x={b.x} y={b.y} focused={f} src={art.posters[0]} /> },
          { name: "resume", w: 252, h: 378, render: (b, f) => <PosterTile x={b.x} y={b.y} focused={f} src={art.posters[1]} badge="▶ Resume" progress={0.4} /> },
          { name: "watched", w: 252, h: 378, render: (b, f) => <PosterTile x={b.x} y={b.y} focused={f} src={art.posters[2]} watched /> },
          { name: "scale 0.8", w: 202, h: 302, render: (b, f) => <PosterTile x={b.x} y={b.y} focused={f} src={art.posters[3]} scale={0.8} /> },
        ],
      },
      {
        title: "Landscape (Continue watching, episodes)",
        specs: [
          { name: "LandscapeTile", w: 448, h: 252, render: (b, f) => <LandscapeTile x={b.x} y={b.y} focused={f} src={art.stills[0]} title="Glass Mountain" sub="42 min left" progress={0.6} /> },
          { name: "episode", w: 448, h: 252, render: (b, f) => <LandscapeTile x={b.x} y={b.y} focused={f} src={art.stills[1]} title="The Long Night" sub="S1 · E3" badge="Next" /> },
          { name: "watched", w: 448, h: 252, render: (b, f) => <LandscapeTile x={b.x} y={b.y} focused={f} src={art.stills[2]} title="Arrival" sub="S1 · E1" watched /> },
        ],
      },
    ],
    // The piece Settings and Lights build on (wave 3), and the one rank numeral.
    [
      {
        title: "Preview beside a list",
        specs: [
          {
            name: `PreviewList: line ${line + 1} (OK steps)`,
            w: 1760,
            h: 420,
            render: (b, f) => (
              <PreviewList
                {...b}
                kicker="Appearance"
                items={LOOK_LINES}
                focusIndex={f ? line : -1}
                shown={line}
                preview={<LookPreview line={LOOK_LINES[line]} art={art} />}
              />
            ),
          },
        ],
      },
      {
        title: "Rank numeral",
        specs: [1, 2, 10].map((n, k) => ({
          name: n === 10 ? "RankNumber 10" : `RankNumber ${n}`,
          w: 330,
          h: 270,
          render: (b: Box, f: boolean) => (
            <>
              <RankNumber x={b.x} y={b.y} w={150} h={b.h} n={n} focused={f} />
              <PosterTile x={b.x + 150} y={b.y} focused={f} src={art.posters[k + 3]} scale={270 / 378} />
            </>
          ),
        })),
      },
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
      else if (current.name.startsWith("Header")) setHeadOpen(!headOpen);
      else if (current.name.startsWith("PreviewList")) setLine((line + 1) % LOOK_LINES.length);
      return true;
    }
    const dir = ({ Left: "left", Right: "right", Up: "up", Down: "down" } as Record<string, Dir>)[key];
    if (!dir) return false;
    const next = move(lengths, at, dir);
    if (next !== at) setFocus(next);
    return true;
  });

  // Rows top to bottom: a kicker, then the specimens, each with its caption under it.
  const underHeader = UNDER_HEADER.includes(group);
  let y = underHeader ? 160 : 70;
  const placed: VNode[] = [];
  if (underHeader) {
    const onHeader = group === 3 && at.row === 0;
    placed.push(
      <Header
        key="head"
        time="20:41"
        expanded={group === 4 ? false : headOpen}
        person={{ name: "Robin", sub: "Profile", color: "#5b52e6" }}
        buttons={HEAD_BUTTONS}
        focus={focusAll || onHeader ? 1 : null}
      />,
    );
  }
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

/** The preview side of the specimen: a small mock of what the focused line changes, in the page's own accent and type. */
function LookPreview({ line, art }: { line: PreviewListItem; art: Art }) {
  return (
    <div class="dz-look">
      <InfoPanel x={44} y={40} w={600} kicker={`Preview · ${line.title}`} title="The Quiet Harbour" meta={["2019", "Drama", "1 h 52 min", "20:41"]} about={ABOUT} lines={2}>
        <ButtonRow items={[{ id: "play", label: "Play", primary: true }, { id: "list", label: "My List" }]} focusIndex={0} />
      </InfoPanel>
      <PosterTile x={720} y={40} src={art.posters[6]} scale={0.8} progress={0.4} focused />
    </div>
  );
}
