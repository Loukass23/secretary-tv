// Moods (the header's lights button, mood.tsx): a few activities, each one press that sets several things at once,
// built only from what Secretary already has: a lights command (home-control.ts runLights: the cinema and music shows,
// the warm and off levels or scenes), the light effects (light-fx.ts) and the SmartThings routines the viewer chose to
// show here (Settings › SmartThings). The detailed setup lives in Settings; this is the quick switch.
import type { StScene } from "@secretary/smartthings";
import type { LightFx } from "./light-fx.ts";

/** What a mood asks the lights for: one of runLights' commands, or a routine of the viewer's. */
export type MoodLights = { scene: "cinema" | "warm" | "off" | "music" } | { routine: string };

export interface Mood {
  /** "cinema", "music", "dining", "off", or `routine:<scene id>`. */
  key: string;
  label: string;
  /** One short line under the label in the list. */
  hint: string;
  lights: MoodLights;
  /** The effects it switches; the rest stay as they are. */
  fx: Partial<LightFx>;
  /** What it does, one line each, for its preview. */
  does: readonly string[];
}

export const MOODS: readonly Mood[] = [
  {
    key: "cinema",
    label: "Cinema",
    hint: "Lights dim, side lights follow the poster",
    lights: { scene: "cinema" },
    fx: { enabled: true, mood: true, sync: true, dance: false },
    does: ["The room's lights dim for the film", "The side lights take the poster's colour", "The background follows the poster"],
  },
  {
    key: "music",
    label: "Music",
    hint: "Warm room, side lights dance",
    lights: { scene: "music" },
    fx: { enabled: true, dance: true, sync: false },
    does: ["The room warms up", "The side lights move through colours with the music"],
  },
  {
    key: "dining",
    label: "Dining",
    hint: "Warm and brighter, for eating",
    lights: { scene: "warm" },
    fx: { sync: false, dance: false },
    does: ["The room's lights come up warm and brighter", "The side lights hold still, whatever is on screen"],
  },
  {
    key: "off",
    label: "Off",
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
      hint: "Your SmartThings routine",
      lights: { routine: s.id },
      fx: {},
      does: [`Runs “${s.name}” in SmartThings`, "The light effects stay as they are"],
    }));
}

/** The effects after a mood: its own switches over the current ones. */
export const withMood = (fx: LightFx, mood: Pick<Mood, "fx">): LightFx => ({ ...fx, ...mood.fx });

const ACTIVE_KEY = "nest.mood";
const ROUTINES_KEY = "nest.moodRoutines";

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

/** The mood last set from here, or null: shown as active until another is set. */
export function activeMood(): string | null {
  const v = read(ACTIVE_KEY);
  return typeof v === "string" ? v : null;
}

export const setActiveMood = (key: string | null) => write(ACTIVE_KEY, key);

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

/** A routine's part with a film: none, run on Play, or run after the film (home-control.ts movieScenes). */
export type FilmPart = "none" | "movie" | "restore";

/** Gives `id` the film part `part`, taking it from any other routine that had it. */
export function withPart(picked: { movie?: string; restore?: string }, id: string, part: FilmPart): { movie?: string; restore?: string } {
  const next: { movie?: string; restore?: string } = { movie: picked.movie === id ? undefined : picked.movie, restore: picked.restore === id ? undefined : picked.restore };
  if (part !== "none") next[part] = id;
  return next;
}

