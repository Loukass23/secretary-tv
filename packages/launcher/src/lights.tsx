// Nest's Lights panel (docs/smartthings.md): the SmartThings scenes and the lights and switches, straight from the TV.
// OK runs a scene or switches a light; on a scene, Red makes it the movie scene (run on Play in the catalog apps) and
// Green the one run after the film. Levels go by voice ("couch light to 30%").
import { type Dir, move, useKeys } from "@secretary/tv-kit";
import { Glass, ListCard } from "@secretary/tv-kit/src/glass/index.ts";
import { lightCommands, type StDevice, type StScene } from "@secretary/smartthings";
import { useEffect, useMemo, useState } from "preact/hooks";
import { home, type MovieScenes, movieScenes, setMovieScenes } from "./home-control.ts";

const PANEL = { x: 260, y: 110, w: 1400, h: 860 };
const COLS = 3;
const CARD = { w: 413, h: 120, gap: 20 };
/** Light rows drawn at once; the list scrolls with focus. */
const ROWS = 3;

export function LightsPanel({
  devices,
  scenes,
  onChange,
  onClose,
}: {
  devices: readonly StDevice[];
  scenes: readonly StScene[];
  /** Ask for a fresh poll after a command (SmartThings settles in a second or two). */
  onChange: () => void;
  onClose: () => void;
}) {
  const lights = useMemo(() => devices.filter((d) => d.kind === "light"), [devices]);
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const [picked, setPicked] = useState<MovieScenes>(movieScenes);
  const [note, setNote] = useState<string | null>(null);
  // Switched here but not yet confirmed by a poll.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const lightRows = Math.ceil(lights.length / COLS);
  const lengths = useMemo(
    () => [scenes.length, ...Array.from({ length: lightRows }, (_, r) => Math.min(COLS, lights.length - r * COLS))].filter((n, i) => i > 0 || n > 0),
    [scenes.length, lights.length],
  );
  const hasScenes = scenes.length > 0;
  const sceneAt = (row: number, col: number) => (hasScenes && row === 0 ? scenes[col] : undefined);
  const lightAt = (row: number, col: number) => lights[(row - (hasScenes ? 1 : 0)) * COLS + col];

  useEffect(() => setPending({}), [devices]);

  const say = (text: string) => setNote(text);

  const runScene = (s: StScene) => {
    say(`Running “${s.name}”…`);
    home.runScene(s.id).then(
      () => {
        say(`“${s.name}” done`);
        onChange();
      },
      () => say(`Couldn't run “${s.name}”`),
    );
  };

  const toggle = (d: StDevice) => {
    const on = !(pending[d.id] ?? d.on);
    setPending((p) => ({ ...p, [d.id]: on }));
    home.command(d.id, lightCommands(on)).then(onChange, () => {
      setPending((p) => ({ ...p, [d.id]: !on }));
      say(`Couldn't switch ${d.name}`);
    });
  };

  const mark = (which: keyof MovieScenes, s: StScene) => {
    const next = { ...picked, [which]: picked[which] === s.id ? undefined : s.id };
    setPicked(next);
    setMovieScenes(next);
    say(next[which] ? `${which === "movie" ? "🎬 On Play" : "↩ After the film"}: “${s.name}”` : `No ${which === "movie" ? "movie" : "after-film"} scene`);
  };

  useKeys(true, (key) => {
    if (key === "Back") return void onClose();
    const scene = sceneAt(focus.row, focus.col);
    if (key === "Enter") {
      if (scene) return runScene(scene);
      const d = lightAt(focus.row, focus.col);
      if (d) toggle(d);
      return;
    }
    if (key === "Red" && scene) return mark("movie", scene);
    if (key === "Green" && scene) return mark("restore", scene);
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = move(lengths, focus, key.toLowerCase() as Dir);
      if (next !== focus) setFocus(next);
      return;
    }
    return false;
  });

  // The light rows in view: focus stays within the window.
  const lightFocusRow = focus.row - (hasScenes ? 1 : 0);
  const first = Math.max(0, Math.min(lightRows - ROWS, lightFocusRow - ROWS + 2));
  const sceneW = hasScenes ? Math.min(420, (PANEL.w - 120 - 20 * (scenes.length - 1)) / scenes.length) : 0;
  const listTop = hasScenes ? 330 : 210;

  return (
    <Glass {...PANEL} class="nest-account nest-lights">
      <div class="nest-lights-head">
        <span class="nest-kicker">SmartThings</span>
        <h1>Lights</h1>
      </div>
      {/* Placed surfaces need a positioned layer: glass.css makes a surface's direct children relative. */}
      <div class="nest-lights-body">
      {scenes.map((s, i) => (
        <Glass
          key={s.id}
          x={60 + i * (sceneW + 20)}
          y={210}
          w={sceneW}
          h={84}
          page={[PANEL.x + 60 + i * (sceneW + 20), PANEL.y + 210]}
          focused={focus.row === 0 && focus.col === i && hasScenes}
          class="nest-button nest-scene"
        >
          <span>
            {picked.movie === s.id ? "🎬 " : picked.restore === s.id ? "↩ " : ""}
            {s.name}
          </span>
        </Glass>
      ))}
      {lights.slice(first * COLS, (first + ROWS) * COLS).map((d, k) => {
        const idx = first * COLS + k;
        const row = Math.floor(idx / COLS);
        const col = idx % COLS;
        const on = pending[d.id] ?? d.on;
        const x = 60 + col * (CARD.w + CARD.gap);
        const y = listTop + (row - first) * (CARD.h + CARD.gap);
        return (
          <ListCard
            key={d.id}
            x={x}
            y={y}
            w={CARD.w}
            h={CARD.h}
            page={[PANEL.x + x, PANEL.y + y]}
            focused={lightFocusRow === row && focus.col === col}
            color={on ? "#ffd27a" : "#4a4a55"}
            title={d.name}
            meta={on ? (d.dimmable && d.level !== undefined ? `${d.level}%` : "On") : "Off"}
            sub={d.local ? "Local · TV hub" : "Cloud"}
          />
        );
      })}
      </div>
      <div class="nest-lights-status">
        {note ??
          (lights.length || scenes.length
            ? hasScenes && focus.row === 0
              ? "OK runs the scene · Red: run on Play · Green: run after the film · Back"
              : "OK switches · say “couch light to 30%” for levels · Back"
            : "Loading your SmartThings home…")}
      </div>
    </Glass>
  );
}
