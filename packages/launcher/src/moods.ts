// Moods (the header's lights button, mood.tsx): a few activities, each one press that sets several things at once,
// built only from what Secretary already has: a lights command (home-control.ts runLights: the cinema and music shows,
// the warm and off levels or scenes), the light effects (light-fx.ts), the TV's picture mode, the sound system, and the
// SmartThings routines the viewer chose to show here (Settings › SmartThings). The viewer can change what each mood
// does (Settings › SmartThings, the Mood lines), saved as `nest.moods` over the defaults below.
import type { StScene } from "@secretary/smartthings";
import type { IconName } from "@secretary/tv-kit/src/glass/icons.ts";
import type { LightFx } from "./light-fx.ts";

/** One of runLights' commands. */
export type MoodScene = "cinema" | "warm" | "off" | "music";
/** What a mood asks the lights for: one of runLights' commands, a routine of the viewer's, or nothing. */
export type MoodLights = { scene: MoodScene } | { routine: string } | { keep: true };

export interface Mood {
  /** "cinema", "music", "dining", "off", or `routine:<scene id>`. */
  key: string;
  label: string;
  /** Its icon, in the header strip, on the Home card and in the Mood list. */
  icon: IconName;
  /** One short line under the label in the list. */
  hint: string;
  lights: MoodLights;
  /** The effects it switches; the rest stay as they are. */
  fx: Partial<LightFx>;
  /** The TV picture mode it sets ("Eco"); absent, the picture stays as it is. */
  picture?: string;
  /** The sound system on or off; absent, it stays as it is. */
  sound?: boolean;
  /** What it does, one line each, for its preview. */
  does: readonly string[];
  /** The viewer changed it in Settings. */
  edited?: boolean;
}

export const MOODS: readonly Mood[] = [
  {
    key: "cinema",
    label: "Cinema",
    icon: "cinema",
    hint: "Lights dim, side lights follow the poster",
    lights: { scene: "cinema" },
    fx: { enabled: true, mood: true, sync: true, dance: false },
    does: ["The room's lights dim for the film", "The side lights take the poster's colour", "The background follows the poster"],
  },
  {
    key: "music",
    label: "Music",
    icon: "music",
    hint: "Warm room, side lights dance",
    lights: { scene: "music" },
    fx: { enabled: true, dance: true, sync: false },
    does: ["The room warms up", "The side lights move through colours with the music"],
  },
  {
    key: "dining",
    label: "Dining",
    icon: "dining",
    hint: "Warm and brighter, for eating",
    lights: { scene: "warm" },
    fx: { sync: false, dance: false },
    does: ["The room's lights come up warm and brighter", "The side lights hold still, whatever is on screen"],
  },
  {
    key: "off",
    label: "Off",
    icon: "lights-off",
    hint: "Every shared light off",
    lights: { scene: "off" },
    fx: { sync: false, dance: false },
    does: ["Every light the moods share goes off", "The side lights stop following the screen"],
  },
];

/** The routines the viewer chose to show here (Settings › SmartThings), as moods after the four, in SmartThings' order. */
export function routineMoods(scenes: readonly Pick<StScene, "id" | "name">[], shown: readonly string[]): Mood[] {
  return scenes
    .filter((s) => shown.includes(s.id))
    .map((s) => ({
      key: `routine:${s.id}`,
      label: s.name,
      icon: "routine",
      hint: "Your SmartThings routine",
      lights: { routine: s.id },
      fx: {},
      does: [`Runs “${s.name}” in SmartThings`, "The light effects stay as they are"],
    }));
}

/** The effects after a mood: its own switches over the current ones. */
export const withMood = (fx: LightFx, mood: Pick<Mood, "fx">): LightFx => ({ ...fx, ...mood.fx });

/** The little room of the effects' previews (style.css .lfx-*), lit the way a mood leaves it. */
export function moodStage(m: Pick<Mood, "lights" | "fx">): string {
  const scene = "scene" in m.lights ? m.lights.scene : null;
  if (scene === "off") return "";
  const c = ["is-on"];
  if (scene === "cinema") c.push("is-dim");
  if (scene === "warm") c.push("is-warm");
  if (m.fx.sync) c.push("is-sync");
  if (m.fx.dance && scene === "music") c.push("is-dance");
  return c.join(" ");
}

// ---- The viewer's own moods (`nest.moods`) ----

/** What the viewer changed in one mood; a field left out keeps the default's. `null` means "leave it as it is". */
export interface MoodEdit {
  lights?: MoodLights;
  /** Every switch the mood sets, replacing the default's set: a switch left out stays as it is. */
  fx?: Partial<LightFx>;
  picture?: string | null;
  sound?: boolean | null;
}

const FX_KEYS: readonly (keyof LightFx)[] = ["enabled", "splash", "mood", "sync", "dance", "shimmer"];
const SCENES: readonly MoodScene[] = ["cinema", "warm", "off", "music"];

function parseLights(v: unknown): MoodLights | undefined {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return undefined;
  if (typeof o.scene === "string" && (SCENES as readonly string[]).includes(o.scene)) return { scene: o.scene as MoodScene };
  if (typeof o.routine === "string" && o.routine) return { routine: o.routine };
  if (o.keep === true) return { keep: true };
  return undefined;
}

/** Stored edits of any shape: what is unreadable is dropped, field by field. */
export function parseMoodEdits(raw: unknown): Record<string, MoodEdit> {
  const out: Record<string, MoodEdit> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const edit: MoodEdit = {};
    const lights = parseLights(e.lights);
    if (lights) edit.lights = lights;
    if (e.fx && typeof e.fx === "object") {
      const fx: Partial<LightFx> = {};
      for (const k of FX_KEYS) {
        const b = (e.fx as Record<string, unknown>)[k];
        if (typeof b === "boolean") fx[k] = b;
      }
      edit.fx = fx;
    }
    if (e.picture === null || (typeof e.picture === "string" && e.picture)) edit.picture = e.picture as string | null;
    if (e.sound === null || typeof e.sound === "boolean") edit.sound = e.sound as boolean | null;
    if (Object.keys(edit).length) out[key] = edit;
  }
  return out;
}

const FX_WORDS: Record<keyof LightFx, [string, string]> = {
  enabled: ["The light effects come on", "Every light effect stops"],
  splash: ["The splash plays on opening", "No splash on opening"],
  mood: ["The background follows the poster", "The background stays plain"],
  sync: ["The side lights take the poster's colour", "The side lights stop following the screen"],
  dance: ["The side lights dance in music mode", "The side lights hold still"],
  shimmer: ["The shimmer slides across the background", "No shimmer"],
};
const LIGHTS_WORDS: Record<MoodScene, string> = {
  cinema: "The room's lights dim for the film",
  music: "The room warms up for music",
  warm: "The room's lights come up warm and brighter",
  off: "Every light the moods share goes off",
};

/** What a mood does, one line each, from its settings: for a mood the viewer changed. */
export function describeMood(m: Pick<Mood, "lights" | "fx" | "picture" | "sound">, routineName?: (id: string) => string | undefined): string[] {
  const lines: string[] = [];
  if ("scene" in m.lights) lines.push(LIGHTS_WORDS[m.lights.scene]);
  else if ("routine" in m.lights) lines.push(`Runs “${routineName?.(m.lights.routine) ?? "a routine"}” in SmartThings`);
  for (const k of FX_KEYS) {
    const v = m.fx[k];
    if (v !== undefined) lines.push(FX_WORDS[k][v ? 0 : 1]);
  }
  if (m.picture) lines.push(`The picture goes to ${m.picture}`);
  if (m.sound !== undefined) lines.push(m.sound ? "The sound system comes on" : "The sound system goes off");
  return lines.length ? lines : ["Nothing changes: every part is left as it is"];
}

/** A mood with the viewer's changes over it. */
export function withEdit(m: Mood, edit: MoodEdit | undefined, routineName?: (id: string) => string | undefined): Mood {
  if (!edit) return m;
  const next: Mood = { ...m, edited: true };
  if (edit.lights) next.lights = edit.lights;
  if (edit.fx) next.fx = { ...edit.fx };
  if (edit.picture !== undefined) {
    if (edit.picture === null) delete next.picture;
    else next.picture = edit.picture;
  }
  if (edit.sound !== undefined) {
    if (edit.sound === null) delete next.sound;
    else next.sound = edit.sound;
  }
  next.does = describeMood(next, routineName);
  return next;
}

/** The moods as the viewer set them: the defaults (and routines shown), each with its saved changes. */
export function mergeMoods(defaults: readonly Mood[], edits: Record<string, MoodEdit>, routineName?: (id: string) => string | undefined): Mood[] {
  return defaults.map((m) => withEdit(m, edits[m.key], routineName));
}

const ACTIVE_KEY = "nest.mood";
const ROUTINES_KEY = "nest.moodRoutines";
export const MOODS_KEY = "nest.moods";

const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Until Secretary restarts.
  }
};

export const moodEdits = (): Record<string, MoodEdit> => parseMoodEdits(read(MOODS_KEY));

/** Saves a change to one mood over what was saved before; returns every edit. */
export function editMood(key: string, patch: MoodEdit): Record<string, MoodEdit> {
  const all = moodEdits();
  const next = { ...all, [key]: { ...all[key], ...patch } };
  write(MOODS_KEY, next);
  return next;
}

/** Puts one mood back as Secretary ships it. */
export function resetMood(key: string): Record<string, MoodEdit> {
  const { [key]: _, ...rest } = moodEdits();
  write(MOODS_KEY, rest);
  return rest;
}

/** Every mood the viewer has: the four, then the routines shown, with the saved changes. */
export function allMoods(scenes: readonly Pick<StScene, "id" | "name">[]): Mood[] {
  const name = (id: string) => scenes.find((s) => s.id === id)?.name;
  return mergeMoods([...MOODS, ...routineMoods(scenes, moodRoutines())], moodEdits(), name);
}

/** The four moods (the Home card's buttons), with the saved changes. */
export const mainMoods = (scenes: readonly Pick<StScene, "id" | "name">[] = []): Mood[] => allMoods(scenes).slice(0, MOODS.length);

/** The mood last set from here, or null: shown as active until another is set. */
export function activeMood(): string | null {
  const v = read(ACTIVE_KEY);
  return typeof v === "string" ? v : null;
}

export const setActiveMood = (key: string | null) => write(ACTIVE_KEY, key);

/** The icon of the mood with `key`, for the header's lights button; the plain bulb with none. */
export function moodIcon(key: string | null): IconName {
  if (!key) return "lights";
  if (key.startsWith("routine:")) return "routine";
  return MOODS.find((m) => m.key === key)?.icon ?? "lights";
}

/** The routines shown as moods (scene ids). */
export function moodRoutines(): string[] {
  const v = read(ROUTINES_KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Shows or hides a routine among the moods; returns the new list. */
export function toggleMoodRoutine(id: string): string[] {
  const was = moodRoutines();
  const next = was.includes(id) ? was.filter((x) => x !== id) : [...was, id];
  write(ROUTINES_KEY, next);
  return next;
}

// ---- The editor's choices, stepped with Left and Right ----

/** One step through `list` from `at`, wrapping. */
export function cycle<T>(list: readonly T[], at: number, dir: 1 | -1): T {
  const i = at < 0 ? (dir === 1 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
  return list[i];
}

/** A switch's three states in a mood: on, off, or left as it is. */
export const SWITCH_STEPS: readonly (boolean | undefined)[] = [true, false, undefined];

/** The lights a mood can ask for: the four commands, each routine, or nothing. */
export function lightsChoices(scenes: readonly Pick<StScene, "id">[]): MoodLights[] {
  return [...SCENES.map((scene) => ({ scene })), ...scenes.map((s) => ({ routine: s.id })), { keep: true as const }];
}

export const sameLights = (a: MoodLights, b: MoodLights) => JSON.stringify(a) === JSON.stringify(b);

/** The picture modes a mood can set: none (as it is), the two favourites, then the rest the TV offers. */
export function pictureChoices(pair: readonly string[], supported: readonly string[] = []): (string | undefined)[] {
  const seen = new Set<string>();
  const out: (string | undefined)[] = [undefined];
  for (const m of [...pair, ...supported]) {
    const k = m.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

/** A routine's part with a film: none, run on Play, or run after the film (home-control.ts movieScenes). */
export type FilmPart = "none" | "movie" | "restore";

/** Gives `id` the film part `part`, taking it from any other routine that had it. */
export function withPart(picked: { movie?: string; restore?: string }, id: string, part: FilmPart): { movie?: string; restore?: string } {
  const next: { movie?: string; restore?: string } = { movie: picked.movie === id ? undefined : picked.movie, restore: picked.restore === id ? undefined : picked.restore };
  if (part !== "none") next[part] = id;
  return next;
}
