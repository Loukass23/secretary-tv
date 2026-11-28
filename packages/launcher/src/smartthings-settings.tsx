// Settings › SmartThings (a category Secretary adds to the catalog's Settings, catalog-kit host.ts): the detailed setup
// the Mood panel's moods are built from, one line each beside a preview of what it does. The light effects and their
// switches (Poster colour and Match lights among them), then the mood editor (one mood at a time: its lights, each
// effect, the picture mode and the sound system, saved as `nest.moods`), then the routines (shown as moods or not, and
// which runs on Play and after the film), then every light by room, switched from here.
import type { HostSettingRow, HostSettingsTab } from "@secretary/catalog-kit/src/host.ts";
import { groupByRoom, lightCommands, pictureTv, type StDevice, type StRoom, type StScene } from "@secretary/smartthings";
import { EFFECTS, EffectPreview, ranAgo } from "./light-effects.tsx";
import { lightCount } from "./light-count.ts";
import { type LightFx, lightFx, setLightFx } from "./light-fx.ts";
import { type MovieScenes, movieScenes, picturePair, setMovieScenes } from "./home-control.ts";
import {
  allMoods,
  cycle,
  editMood,
  type FilmPart,
  lightsChoices,
  type Mood,
  type MoodLights,
  moodRoutines,
  moodStage,
  pictureChoices,
  resetMood,
  sameLights,
  SWITCH_STEPS,
  toggleMoodRoutine,
  withPart,
} from "./moods.ts";

export const SMARTTHINGS_TAB = "SmartThings";

/** What the category switches through: Secretary's SmartThings client, or the workbench's fake. */
export interface SmartThingsSetup {
  devices: readonly StDevice[];
  scenes: readonly StScene[];
  rooms: readonly StRoom[];
  command(id: string, commands: ReturnType<typeof lightCommands>): Promise<unknown>;
  /** Ask for a fresh poll after a switch (SmartThings settles in a second or two). */
  onChange(): void;
  now?: () => number;
}

const PART_LABEL: Record<FilmPart, string> = { none: "Not with films", movie: "Runs on Play", restore: "Runs after the film" };
const PARTS: readonly FilmPart[] = ["none", "movie", "restore"];

const partOf = (picked: MovieScenes, id: string): FilmPart => (picked.movie === id ? "movie" : picked.restore === id ? "restore" : "none");

/** Switched here and not yet confirmed by a poll, by device id. */
const pending = new Map<string, boolean>();

function RoutinePreview({ s, inMood, part, ran }: { s: StScene; inMood: boolean; part: FilmPart; ran: string }) {
  return (
    <div class="lfx-pv">
      <div class={`lfx-stage${inMood || part !== "none" ? " is-on" : ""}`}>
        <i class="lfx-lamp is-left" />
        <i class="lfx-screen" />
        <i class="lfx-lamp is-right" />
      </div>
      <b class="lfx-title">{s.name}</b>
      <ul class="mood-does">
        <li>{inMood ? "Shown in Mood, after the four moods" : "Not shown in Mood"}</li>
        <li>{part === "movie" ? "Runs when a film starts playing" : part === "restore" ? "Runs when the film is over" : "Not run with films"}</li>
        <li>{ran}</li>
      </ul>
      <p class="lfx-about">OK shows or hides it in Mood. Left and Right choose its part with a film.</p>
    </div>
  );
}

function LightPreview({ d, on, room }: { d: StDevice; on: boolean; room: string }) {
  return (
    <div class="lfx-pv">
      <div class={`lfx-stage is-single${on ? " is-on is-warm" : ""}`}>
        <i class="lfx-lamp is-left" />
      </div>
      <b class="lfx-title">{d.name}</b>
      <ul class="mood-does">
        <li>{room}</li>
        <li>{on ? (d.dimmable && d.level !== undefined ? `On at ${d.level}%` : "On") : "Off"}</li>
        <li>{d.local ? "Through the TV's hub" : "Through the SmartThings cloud"}</li>
      </ul>
      <p class="lfx-about">OK switches it. Levels go by voice ("couch light to 30%").</p>
    </div>
  );
}

/** The mood the editor lines show, chosen on its first line; kept while Secretary runs. */
let editing = "cinema";

const SCENE_LABEL = { cinema: "Cinema, dimmed", music: "Music show", warm: "Warm and bright", off: "Off" } as const;

function lightsLabel(l: MoodLights, name: (id: string) => string | undefined): string {
  if ("scene" in l) return SCENE_LABEL[l.scene];
  if ("routine" in l) return name(l.routine) ?? "A routine";
  return "As they are";
}

const switchLabel = (v: boolean | undefined) => (v === undefined ? "As it is" : v ? "On" : "Off");

function MoodEditPreview({ m }: { m: Mood }) {
  return (
    <div class="lfx-pv">
      <div class={`lfx-stage ${moodStage(m)}`}>
        <i class="lfx-sheen" />
        <i class="lfx-lamp is-left" />
        <i class="lfx-screen" />
        <i class="lfx-lamp is-right" />
      </div>
      <b class="lfx-title">{m.label}</b>
      <ul class="mood-does">
        {m.does.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <p class="lfx-about">{m.edited ? "Changed here. Left and Right change a line; the last line puts it back." : "As Secretary sets it. Left and Right change a line."}</p>
    </div>
  );
}

/** The mood editor: which mood, then what it does, one line each, stepped with Left and Right (OK steps forward). */
function moodRows(st: SmartThingsSetup): HostSettingRow[] {
  const moods = allMoods(st.scenes);
  const m = moods.find((x) => x.key === editing) ?? moods[0];
  editing = m.key;
  const name = (id: string) => st.scenes.find((s) => s.id === id)?.name;
  const dir = (key: "Enter" | "Left" | "Right") => (key === "Left" ? -1 : 1);
  const preview = <MoodEditPreview m={m} />;
  const lights = lightsChoices(st.scenes);
  const pictures = pictureChoices(picturePair(), pictureTv(st.devices)?.pictureModes);
  const rows: HostSettingRow[] = [
    {
      key: "mood:pick",
      title: "Mood to set up",
      sub: "Left and Right pick the mood",
      value: m.edited ? `${m.label} · Changed` : m.label,
      on: m.edited,
      preview,
      act: (key) => void (editing = cycle(moods, moods.indexOf(m), dir(key)).key),
    },
    {
      key: "mood:lights",
      title: `${m.label}: lights`,
      sub: "A lights command or a routine",
      value: lightsLabel(m.lights, name),
      on: !("keep" in m.lights),
      preview,
      act: (key) => void editMood(m.key, { lights: cycle(lights, lights.findIndex((c) => sameLights(c, m.lights)), dir(key)) }),
    },
  ];
  for (const e of EFFECTS) {
    const v = m.fx[e.key];
    rows.push({
      key: `mood:fx:${e.key}`,
      title: `${m.label}: ${e.label}`,
      sub: e.hint,
      value: switchLabel(v),
      on: v === true,
      preview,
      act: (key) => {
        const next = cycle(SWITCH_STEPS, SWITCH_STEPS.indexOf(v), dir(key));
        const fx = { ...m.fx };
        if (next === undefined) delete fx[e.key];
        else fx[e.key] = next;
        editMood(m.key, { fx });
      },
    });
  }
  rows.push({
    key: "mood:picture",
    title: `${m.label}: picture mode`,
    sub: "The TV's own picture mode",
    value: m.picture ?? "As it is",
    on: m.picture !== undefined,
    preview,
    act: (key) => void editMood(m.key, { picture: cycle(pictures, pictures.indexOf(m.picture), dir(key)) ?? null }),
  });
  if (st.devices.some((d) => d.kind === "audio")) {
    rows.push({
      key: "mood:sound",
      title: `${m.label}: sound system`,
      sub: "On or off with the mood",
      value: switchLabel(m.sound),
      on: m.sound === true,
      preview,
      act: (key) => void editMood(m.key, { sound: cycle(SWITCH_STEPS, SWITCH_STEPS.indexOf(m.sound), dir(key)) ?? null }),
    });
  }
  if (m.edited) {
    rows.push({
      key: "mood:reset",
      title: `Put ${m.label} back`,
      sub: "As Secretary sets it",
      value: "OK",
      preview,
      act: (key) => void (key === "Enter" && resetMood(m.key)),
    });
  }
  return rows;
}

/** The category's lines, read each time Settings draws. */
export function smartThingsRows(st: SmartThingsSetup): HostSettingRow[] {
  const fx: LightFx = lightFx();
  const rows: HostSettingRow[] = EFFECTS.map((e) => {
    const on = e.key === "enabled" ? fx.enabled : fx[e.key] && fx.enabled;
    const waits = e.key !== "enabled" && fx[e.key] && !fx.enabled;
    return {
      key: `fx:${e.key}`,
      title: e.label,
      sub: e.hint,
      value: waits ? "On, waits for Light effects" : on ? "On" : "Off",
      on,
      preview: <EffectPreview effect={e} fx={fx} />,
      act: () => void setLightFx({ [e.key]: !fx[e.key] }),
    };
  });
  rows.push(...moodRows(st));
  const picked = movieScenes();
  const shown = moodRoutines();
  const now = st.now ?? Date.now;
  for (const s of st.scenes) {
    const part = partOf(picked, s.id);
    const inMood = shown.includes(s.id);
    rows.push({
      key: `routine:${s.id}`,
      title: s.name,
      sub: "A SmartThings routine",
      value: [inMood ? "In Mood" : "", part === "none" ? "" : PART_LABEL[part]].filter(Boolean).join(" · ") || "Not shown",
      on: inMood || part !== "none",
      preview: <RoutinePreview s={s} inMood={inMood} part={part} ran={s.lastRun ? ranAgo(s.lastRun, now()) : "Not run yet"} />,
      act: (key) => {
        if (key === "Enter") return void toggleMoodRoutine(s.id);
        const step = PARTS[(PARTS.indexOf(part) + (key === "Right" ? 1 : PARTS.length - 1)) % PARTS.length];
        setMovieScenes(withPart(picked, s.id, step));
      },
    });
  }
  const lights = st.devices.filter((d) => d.kind === "light" || d.kind === "audio");
  for (const g of groupByRoom(lights, [...st.rooms])) {
    const room = g.id === null ? "No room" : g.name;
    for (const d of g.devices) {
      const on = pending.get(d.id) ?? d.on === true;
      rows.push({
        key: `light:${d.id}`,
        title: d.name,
        sub: room,
        value: `${room} · ${on ? "On" : "Off"}`,
        on,
        preview: <LightPreview d={d} on={on} room={room} />,
        act: (key) => {
          if (key !== "Enter") return;
          pending.set(d.id, !on);
          st.command(d.id, lightCommands(!on)).then(
            () => st.onChange(),
            () => pending.delete(d.id),
          );
        },
      });
    }
  }
  return rows;
}

/** Forgets the switches a poll has now confirmed (app.tsx calls it with each new device list). */
export function settled(devices: readonly StDevice[]): void {
  for (const d of devices) if (pending.get(d.id) === d.on) pending.delete(d.id);
}

/** The category for Settings; its blurb counts the lights as the Home card and Mood do (light-count.ts). */
export function smartThingsTab(st: SmartThingsSetup): HostSettingsTab {
  const c = lightCount(st.devices, Object.fromEntries(pending));
  return {
    name: SMARTTHINGS_TAB,
    blurb: c.total ? `Light effects, routines and lights: ${c.on} of ${c.total} on now.` : "Light effects, routines and lights, once SmartThings is set up.",
    rows: () => smartThingsRows(st),
  };
}
