// Secretary's Lights panel (docs/smartthings.md): the light effects, the SmartThings routines (scenes) and the lights and
// switches by room, straight from the TV. OK runs a routine or switches a light; on a routine, Red makes it the movie
// scene (run on Play in the catalog) and Green the one run after the film. Levels go by voice ("couch light to 30%").
//
// Long lists draw only what is in view: the routines four at a time around focus, the rooms the lines that fit.
import { type Dir, move, useKeys } from "@secretary/tv-kit";
import { Glass, Kicker, ListCard, RowLabel } from "@secretary/tv-kit/src/glass/index.ts";
import { groupByRoom, lightCommands, type RoomGroup, type SmartThings, type StDevice, type StRoom, type StScene } from "@secretary/smartthings";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { home, type MovieScenes, movieScenes, setMovieScenes } from "./home-control.ts";
import { type LightFx, lightFx, setLightFx } from "./light-fx.ts";
import { HEADER_LIGHTS } from "./nest-nav.ts";
import { type PanelHeader, usePanelHeader } from "./panel-header.tsx";

/** The light effects row: each OK flips one. Turning "Light effects" off stops every other one, whatever it shows. */
const EFFECTS: readonly { key: keyof LightFx; label: string }[] = [
  { key: "enabled", label: "Light effects" },
  { key: "splash", label: "Splash & goodbye" },
  { key: "mood", label: "Poster colour" },
  { key: "sync", label: "Match lights" },
  { key: "dance", label: "Music dance" },
  { key: "shimmer", label: "Shimmer" },
];

/** Under the one header (tv-kit HEADER.bottom), to the bottom margin. */
export const PANEL = { x: 260, y: 150, w: 1400, h: 870 } as const;
/** The inner margin, and the width inside it. */
const PAD = 60;
const INNER = PANEL.w - 2 * PAD;
const FX = { y: 170, h: 72, gap: 20 };
/** The routines: a label, then one line of cards, `ROUTINE.shown` at a time. */
const ROUTINE = { labelY: 262, y: 300, w: 305, h: 96, gap: 20, shown: 4 };
/** The rooms: the room's name in a column on the left, its lights three to a line on the right. */
const ROOMS = { labelW: 250, top: 424, bottom: 786, gap: 22 };
const COLS = 3;
const CARD = { h: 110, gap: 20, w: (INNER - ROOMS.labelW - (COLS - 1) * 20) / COLS };

/** What the panel calls: Secretary's SmartThings client, or the workbench's fake. */
export type LightsApi = Pick<SmartThings, "runScene" | "command" | "roomsIn">;

/** Rooms change rarely: read once per set of homes while Secretary runs. */
const roomCache = new Map<string, StRoom[]>();

/** A routine run from here: under way, just done (for a few seconds), done a while ago, or refused. */
type RunState = { state: "running" | "done" | "ran" | "failed"; at: number };

/** One line of lights in the rooms list, at `top` in the list's own space. */
interface Line {
  group: RoomGroup;
  first: boolean;
  devices: StDevice[];
  top: number;
}

/** "Ran 5 min ago", from a routine's last run. */
export function ranAgo(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "Ran just now";
  if (min < 60) return `Ran ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Ran ${h} h ago`;
  return `Ran ${Math.round(h / 24)} d ago`;
}

/** The lines of the rooms list, room after room, and its full height. */
export function roomLines(groups: readonly RoomGroup[]): { lines: Line[]; height: number } {
  const lines: Line[] = [];
  let y = 0;
  groups.forEach((group, g) => {
    if (g > 0) y += ROOMS.gap;
    for (let k = 0; k < group.devices.length; k += COLS) {
      lines.push({ group, first: k === 0, devices: group.devices.slice(k, k + COLS), top: y });
      y += CARD.h + CARD.gap;
    }
    y -= CARD.gap;
  });
  return { lines, height: Math.max(0, y) };
}

/** The list's scroll: the least move from `prev` that shows line `[top, top + CARD.h]` whole in `area`. */
export function scrollFor(prev: number, top: number, height: number, area: number): number {
  let off = prev;
  if (top < off) off = top;
  if (top + CARD.h > off + area) off = top + CARD.h - area;
  return Math.max(0, Math.min(off, Math.max(0, height - area)));
}

export function LightsPanel({
  devices,
  scenes,
  onChange,
  onClose,
  header,
  api = home,
  now = Date.now,
}: {
  devices: readonly StDevice[];
  scenes: readonly StScene[];
  /** Ask for a fresh poll after a command (SmartThings settles in a second or two). */
  onChange: () => void;
  onClose: () => void;
  /** Secretary's one header over the panel (panel-header.tsx). */
  header: PanelHeader;
  api?: LightsApi;
  now?: () => number;
}) {
  const lights = useMemo(() => devices.filter((d) => d.kind === "light" || d.kind === "audio"), [devices]);
  const homesKey = useMemo(() => [...new Set(lights.map((d) => d.locationId).filter((l): l is string => Boolean(l)))].sort().join(","), [lights]);
  const [rooms, setRooms] = useState<StRoom[] | null>(() => roomCache.get(homesKey) ?? null);
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const head = usePanelHeader(header, HEADER_LIGHTS);
  const inPanel = head.head == null;
  const [picked, setPicked] = useState<MovieScenes>(movieScenes);
  const [fx, setFx] = useState<LightFx>(lightFx);
  const [note, setNote] = useState<string | null>(null);
  // Switched here but not yet confirmed by a poll.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const routineFirst = useRef(0);
  const scroll = useRef(0);

  useEffect(() => setPending({}), [devices]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!homesKey) return void setRooms([]);
    const cached = roomCache.get(homesKey);
    if (cached) return void setRooms(cached);
    let live = true;
    api.roomsIn(homesKey.split(",")).then(
      (r) => {
        roomCache.set(homesKey, r);
        if (live) setRooms(r);
      },
      (e) => {
        console.warn("[lights] SmartThings rooms", e);
        // Not cached: the next opening asks again.
        if (live) setRooms([]);
      },
    );
    return () => {
      live = false;
    };
  }, [homesKey]);

  const groups = useMemo(() => {
    const out = groupByRoom(lights, rooms ?? []);
    // No rooms at all (still loading, none set up, or unreadable): one plain list.
    if (out.length === 1 && out[0].id === null) out[0] = { ...out[0], name: "All lights" };
    return out;
  }, [lights, rooms]);
  const { lines, height } = useMemo(() => roomLines(groups), [groups]);

  const hasScenes = scenes.length > 0;
  const top = hasScenes ? 2 : 1;
  // Rows, top to bottom: the light effects, the routines (when there are any), then each line of lights.
  const lengths = useMemo(() => [EFFECTS.length, ...(hasScenes ? [scenes.length] : []), ...lines.map((l) => l.devices.length)], [hasScenes, scenes.length, lines]);
  // Rooms arriving reshape the list: keep focus on a row that is still there.
  const at = focus.row < lengths.length ? { row: focus.row, col: Math.min(focus.col, lengths[focus.row] - 1) } : { row: lengths.length - 1, col: 0 };
  const sceneAt = (row: number, col: number) => (hasScenes && row === 1 ? scenes[col] : undefined);
  const lineAt = (row: number) => (row >= top ? lines[row - top] : undefined);

  const say = (text: string) => setNote(text);
  const later = (ms: number, fn: () => void) => void timers.current.push(setTimeout(fn, ms));

  const flip = (key: keyof LightFx) => {
    const next = setLightFx({ [key]: !fx[key] });
    setFx(next);
    say(
      key === "enabled"
        ? next.enabled
          ? "Light effects on"
          : "Light effects off: no splash lights, poster colour or matching"
        : `${EFFECTS.find((e) => e.key === key)!.label} ${next[key] ? "on" : "off"}${next.enabled ? "" : " (Light effects are off)"}`,
    );
  };

  const runScene = (s: StScene) => {
    if (runs[s.id]?.state === "running") return;
    setRuns((r) => ({ ...r, [s.id]: { state: "running", at: now() } }));
    say(`Running “${s.name}”…`);
    api.runScene(s.id).then(
      () => {
        const at = now();
        setRuns((r) => ({ ...r, [s.id]: { state: "done", at } }));
        say(`“${s.name}” done`);
        onChange();
        // "Done" stays on the card a few seconds, then the card says when it ran.
        later(4_000, () => setRuns((r) => (r[s.id]?.state === "done" && r[s.id].at === at ? { ...r, [s.id]: { state: "ran", at } } : r)));
      },
      () => {
        setRuns((r) => ({ ...r, [s.id]: { state: "failed", at: now() } }));
        say(`Couldn't run “${s.name}”: SmartThings didn't take it. OK tries again`);
      },
    );
  };

  const toggle = (d: StDevice) => {
    const on = !(pending[d.id] ?? d.on);
    setPending((p) => ({ ...p, [d.id]: on }));
    api.command(d.id, lightCommands(on)).then(onChange, () => {
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
    if (head.key(key)) return;
    if (key === "Back") return void onClose();
    const scene = sceneAt(at.row, at.col);
    if (key === "Enter") {
      if (at.row === 0) return flip(EFFECTS[at.col].key);
      if (scene) return runScene(scene);
      const d = lineAt(at.row)?.devices[at.col];
      if (d) toggle(d);
      return;
    }
    if (key === "Red" && scene) return mark("movie", scene);
    if (key === "Green" && scene) return mark("restore", scene);
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = move(lengths, at, key.toLowerCase() as Dir);
      if (next.row !== focus.row || next.col !== focus.col) setFocus(next);
      // Up from the effects row: into the header.
      else if (key === "Up" && at.row === 0) head.enter();
      return;
    }
    return false;
  });

  // The routines in view: one card of room before focus when it moves on, never past the ends.
  const sceneFocus = hasScenes && at.row === 1 ? at.col : -1;
  if (sceneFocus >= 0) {
    const f = routineFirst.current;
    if (sceneFocus < f + 1) routineFirst.current = sceneFocus - 1;
    else if (sceneFocus > f + ROUTINE.shown - 2) routineFirst.current = sceneFocus - ROUTINE.shown + 2;
  }
  routineFirst.current = Math.max(0, Math.min(routineFirst.current, scenes.length - ROUTINE.shown));
  const sceneFirst = routineFirst.current;

  // The rooms list: scrolled as little as keeps the focused line whole; only whole lines in view are drawn.
  // Without routines the rooms start where the routines would.
  const listTop = hasScenes ? ROOMS.top : ROUTINE.labelY;
  const area = ROOMS.bottom - listTop;
  const focusLine = lineAt(at.row);
  scroll.current = scrollFor(scroll.current, focusLine ? focusLine.top : scroll.current, height, area);
  const off = scroll.current;
  const shown = lines.filter((l) => l.top >= off && l.top + CARD.h <= off + area);

  const routineSub = (s: StScene): [string, string | undefined] => {
    const r = runs[s.id];
    if (r?.state === "running") return ["Running…", "#ffb38f"];
    if (r?.state === "done") return ["Done ✓", "#7ad48f"];
    if (r?.state === "failed") return ["Couldn't run", "#ff6b6b"];
    const last = r?.state === "ran" ? r.at : s.lastRun;
    return [last ? ranAgo(last, now()) : "Routine", undefined];
  };

  return (
    <>
    {head.view}
    <Glass {...PANEL} class="nest-account nest-lights">
      <div class="nest-lights-head">
        <Kicker>SmartThings</Kicker>
        <h1>Lights</h1>
      </div>
      {/* Placed surfaces need a positioned layer: glass.css makes a surface's direct children relative. */}
      <div class="nest-lights-body">
        {EFFECTS.map((e, i) => {
          const w = (INNER - FX.gap * (EFFECTS.length - 1)) / EFFECTS.length;
          const on = e.key === "enabled" ? fx.enabled : fx[e.key] && fx.enabled;
          return (
            <Glass
              key={e.key}
              x={PAD + i * (w + FX.gap)}
              y={FX.y}
              w={w}
              h={FX.h}
              page={[PANEL.x + PAD + i * (w + FX.gap), PANEL.y + FX.y]}
              focused={inPanel && at.row === 0 && at.col === i}
              class="nest-button nest-scene nest-fx"
            >
              <span>
                {e.label}: {on ? "On" : "Off"}
              </span>
            </Glass>
          );
        })}
        {hasScenes && <RowLabel x={PAD} y={ROUTINE.labelY} label="Routines" count={scenes.length} />}
        {hasScenes && sceneFirst > 0 && <span class="nest-lights-more is-left" style={{ top: `${ROUTINE.y + ROUTINE.h / 2}px` }}>‹</span>}
        {hasScenes && sceneFirst + ROUTINE.shown < scenes.length && (
          <span class="nest-lights-more is-right" style={{ top: `${ROUTINE.y + ROUTINE.h / 2}px` }}>›</span>
        )}
        {scenes.slice(sceneFirst, sceneFirst + ROUTINE.shown).map((s, k) => {
          const i = sceneFirst + k;
          const x = PAD + k * (ROUTINE.w + ROUTINE.gap);
          const [sub, color] = routineSub(s);
          return (
            <ListCard
              key={s.id}
              x={x}
              y={ROUTINE.y}
              w={ROUTINE.w}
              h={ROUTINE.h}
              page={[PANEL.x + x, PANEL.y + ROUTINE.y]}
              focused={inPanel && sceneFocus === i}
              class={`nest-routine${runs[s.id]?.state === "running" ? " is-running" : ""}`}
              color={color}
              title={s.name}
              meta={picked.movie === s.id ? "🎬" : picked.restore === s.id ? "↩" : undefined}
              sub={sub}
            />
          );
        })}
        {shown.map((l) => {
          const y = listTop + l.top - off;
          // The room's name beside its first line in view, so a room scrolled part-way still says which it is.
          const named = l.first || l === shown.find((x) => x.group === l.group);
          const row = top + lines.indexOf(l);
          return [
            named && (
              <RowLabel key={`room-${l.group.id ?? "none"}`} x={PAD} y={y + 14} label={l.group.name} count={l.group.devices.length} />
            ),
            ...l.devices.map((d, col) => {
              const on = pending[d.id] ?? d.on;
              const x = PAD + ROOMS.labelW + col * (CARD.w + CARD.gap);
              return (
                <ListCard
                  key={d.id}
                  x={x}
                  y={y}
                  w={CARD.w}
                  h={CARD.h}
                  page={[PANEL.x + x, PANEL.y + y]}
                  focused={inPanel && at.row === row && at.col === col}
                  class="nest-light-card"
                  color={on ? "#ffd27a" : "#4a4a55"}
                  title={d.name}
                  sub={`${on ? (d.dimmable && d.level !== undefined ? `On · ${d.level}%` : "On") : "Off"} · ${d.local ? "TV hub" : "Cloud"}`}
                />
              );
            }),
          ];
        })}
      </div>
      <div class="nest-lights-status">
        {note ?? (lights.length || scenes.length ? "" : "Loading your SmartThings home…")}
      </div>
    </Glass>
    </>
  );
}
