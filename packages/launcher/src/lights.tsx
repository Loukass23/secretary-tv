// Secretary's Lights panel (docs/smartthings.md): the light effects, the SmartThings routines (scenes) and the lights and
// switches by room, straight from the TV. The effects are a list beside a preview of what the focused one does
// (PreviewList, as in Settings), each lit in the accent while it is on; on the right, the routines over the rooms. OK
// runs a routine or switches a light; on a routine, Red makes it the movie scene (run on Play in the catalog) and Green
// the one run after the film. Levels go by voice ("couch light to 30%").
//
// Long lists draw only what is in view: the routines three at a time around focus, the rooms the lines that fit.
import { useKeys } from "@secretary/tv-kit";
import { Glass, Kicker, ListCard, PreviewList, RowLabel } from "@secretary/tv-kit/src/glass/index.ts";
import { groupByRoom, lightCommands, type RoomGroup, type SmartThings, type StDevice, type StRoom, type StScene } from "@secretary/smartthings";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { home, type MovieScenes, movieScenes, setMovieScenes } from "./home-control.ts";
import { lightCount } from "./light-count.ts";
import { type LightFx, lightFx, setLightFx } from "./light-fx.ts";
import { clampLights, type LightsFocus, type LightsMemo, stepLights } from "./lights-nav.ts";
import { HEADER_LIGHTS } from "./nest-nav.ts";
import { type PanelHeader, usePanelHeader } from "./panel-header.tsx";

/** The light effects: each OK flips one. Turning "Light effects" off stops every other one, whatever it is set to. */
export const EFFECTS: readonly { key: keyof LightFx; label: string; hint: string; about: string }[] = [
  { key: "enabled", label: "Light effects", hint: "All of the effects", about: "Every effect here at once. Off, none of them runs, whatever each is set to." },
  { key: "splash", label: "Splash & goodbye", hint: "Opening and leaving", about: "The warm side lights come up as Secretary opens and fade as you leave it." },
  { key: "mood", label: "Poster colour", hint: "Background colour", about: "The background takes the colour of the poster in focus." },
  { key: "sync", label: "Match lights", hint: "Side lights follow", about: "The side lights take the poster's colour too. Needs SmartThings." },
  { key: "dance", label: "Music dance", hint: "Music mode", about: "In music mode the side lights move through colours with the music." },
  { key: "shimmer", label: "Shimmer", hint: "Moving light", about: "A slow band of light slides across the background." },
];

/** The title, then the two sides: the effects (list and preview) on the left, the routines and rooms on the right. */
const TITLE = { x: 80, y: 146 };
const SIDE = { y: 290, h: 750 };
const FX = { x: 80, w: 880, listW: 500 };
export const PANEL = { x: 992, y: SIDE.y, w: 848, h: SIDE.h } as const;
/** The inner margin of the right side, and the width inside it. */
const PAD = 32;
const INNER = PANEL.w - 2 * PAD;
/** The routines: a label, then one line of cards, `ROUTINE.shown` at a time; a long name wraps to three lines. */
const ROUTINE = { labelY: 26, y: 70, h: 170, gap: 20, shown: 3, w: (INNER - 2 * 20) / 3 };
/** The rooms: the room's name in a column on the left, its lights two to a line on the right. */
const ROOMS = { labelW: 180, top: 276, bottom: SIDE.h - 26, gap: 22 };
const COLS = 2;
const CARD = { h: 132, gap: 16, w: (INNER - ROOMS.labelW - (COLS - 1) * 16) / COLS };

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

/** What an effect shows in its preview: a little room, a screen between two side lights, doing what the effect does. */
function EffectPreview({ effect, fx }: { effect: (typeof EFFECTS)[number]; fx: LightFx }) {
  const own = fx[effect.key];
  const on = effect.key === "enabled" ? fx.enabled : own && fx.enabled;
  const waits = effect.key !== "enabled" && own && !fx.enabled;
  return (
    <div class="lfx-pv">
      <div class={`lfx-stage is-${effect.key}${on ? " is-on" : ""}`}>
        <i class="lfx-sheen" />
        <i class="lfx-lamp is-left" />
        <i class="lfx-screen" />
        <i class="lfx-lamp is-right" />
      </div>
      <b class="lfx-title">{effect.label}</b>
      <p class="lfx-about">{effect.about}</p>
      {waits && <small class="lfx-wait">Set on, but Light effects are off</small>}
      <div class="lfx-chips">
        <span class={`lfx-chip${on ? "" : " is-on"}`}>Off</span>
        <span class={`lfx-chip${on ? " is-on" : ""}`}>On</span>
      </div>
    </div>
  );
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
  const [focus, setFocus] = useState<LightsFocus>({ area: "fx", i: 0 });
  const memo = useRef<LightsMemo>({ fx: 0, grid: { row: 0, col: 0 } });
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
  // The same count as the Home card's (light-count.ts), with the switches made here counted at once.
  const count = lightCount(devices, pending);

  const hasScenes = scenes.length > 0;
  const top = hasScenes ? 1 : 0;
  // The right side's rows, top to bottom: the routines (when there are any), then each line of lights.
  const lengths = useMemo(() => [...(hasScenes ? [scenes.length] : []), ...lines.map((l) => l.devices.length)], [hasScenes, scenes.length, lines]);
  // Rooms arriving reshape the list: keep focus on a row that is still there.
  const at = clampLights(focus, EFFECTS.length, lengths);
  const fxAt = at.area === "fx" ? at.i : -1;
  const gridRow = at.area === "grid" ? at.row : -1;
  const gridCol = at.area === "grid" ? at.col : -1;
  if (at.area === "fx") memo.current.fx = at.i;
  else memo.current.grid = { row: at.row, col: at.col };
  const sceneAt = (row: number, col: number) => (hasScenes && row === 0 ? scenes[col] : undefined);
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
    const scene = sceneAt(gridRow, gridCol);
    if (key === "Enter") {
      if (at.area === "fx") return flip(EFFECTS[at.i].key);
      if (scene) return runScene(scene);
      const d = lineAt(gridRow)?.devices[gridCol];
      if (d) toggle(d);
      return;
    }
    if (key === "Red" && scene) return mark("movie", scene);
    if (key === "Green" && scene) return mark("restore", scene);
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = stepLights(at, key, EFFECTS.length, lengths, memo.current);
      if (next === "header") head.enter();
      else if (next !== at) setFocus(next);
      return;
    }
    return false;
  });

  // The routines in view: one card of room before focus when it moves on, never past the ends.
  const sceneFocus = hasScenes && gridRow === 0 ? gridCol : -1;
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
  const focusLine = lineAt(gridRow);
  scroll.current = scrollFor(scroll.current, focusLine ? focusLine.top : scroll.current, height, area);
  const off = scroll.current;
  const shown = lines.filter((l) => l.top >= off && l.top + CARD.h <= off + area);

  const routineSub = (s: StScene): [string, string | undefined] => {
    const r = runs[s.id];
    if (r?.state === "running") return ["Running…", "#ffb38f"];
    if (r?.state === "done") return ["Done ✓", "#7ad48f"];
    if (r?.state === "failed") return ["Couldn't run", "#ff6b6b"];
    const last = r?.state === "ran" ? r.at : s.lastRun;
    return [last ? ranAgo(last, now()) : "Not run yet", undefined];
  };

  const fxShown = memo.current.fx;
  return (
    <>
      {head.view}
      <div class="nest-lights-head" style={{ left: `${TITLE.x}px`, top: `${TITLE.y}px` }}>
        <Kicker>SmartThings</Kicker>
        <h1>
          Lights
          {count.total > 0 && (
            <small>
              {count.on} of {count.total} on
            </small>
          )}
        </h1>
      </div>
      <div class="nest-lights-status" style={{ left: `${PANEL.x}px`, top: `${TITLE.y + 64}px`, width: `${PANEL.w}px` }}>
        {note ?? (lights.length || scenes.length ? "" : "Loading your SmartThings home…")}
      </div>
      <PreviewList
        x={FX.x}
        y={SIDE.y}
        w={FX.w}
        h={SIDE.h}
        listW={FX.listW}
        kicker="Light effects"
        items={EFFECTS.map((e) => {
          const on = e.key === "enabled" ? fx.enabled : fx[e.key] && fx.enabled;
          return { key: e.key, title: e.label, sub: e.key !== "enabled" && fx[e.key] && !fx.enabled ? "Waits for Light effects" : e.hint, meta: on ? "On" : "Off", lit: on, color: "var(--sg-line)" };
        })}
        focusIndex={inPanel ? fxAt : -1}
        shown={fxShown}
        preview={<EffectPreview effect={EFFECTS[fxShown]} fx={fx} />}
      />
      <Glass {...PANEL} class="nest-lights">
        {/* Placed surfaces need a positioned layer: glass.css makes a surface's direct children relative. */}
        <div class="nest-lights-body">
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
                frost={false}
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
                <span key={`room-${l.group.id ?? "none"}`} class="sg-row-label nest-room-label" style={{ left: `${PAD}px`, top: `${y + 14}px` }}>
                  {l.group.name}
                  <em>{l.group.devices.length}</em>
                </span>
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
                    frost={false}
                    focused={inPanel && gridRow === row && gridCol === col}
                    class={`nest-light-card${on ? " is-on" : ""}`}
                    color={on ? "#ffd27a" : "#4a4a55"}
                    title={d.name}
                    sub={`${on ? (d.dimmable && d.level !== undefined ? `On · ${d.level}%` : "On") : "Off"} · ${d.local ? "TV hub" : "Cloud"}`}
                  />
                );
              }),
            ];
          })}
        </div>
      </Glass>
    </>
  );
}
