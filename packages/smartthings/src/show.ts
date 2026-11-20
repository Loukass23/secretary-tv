// Lighting modes for Nest's cinema and music: the lights as steps in time, so some come on one after the other instead of
// all at once. Pure: this builds the steps; Nest sends them (launcher/src/home-control.ts), because a scene in the
// SmartThings app cannot wait between its actions.
import { colorCommands, lightCommands, type StCommand, type StDevice, whiteCommands } from "./api.ts";
import { INDEPENDENT_DEFAULT, norm, roomLux, sharedLights } from "./home.ts";

export interface ShowTarget {
  device: StDevice;
  commands: StCommand[];
}

/** Send `targets` together, then wait `after` ms before the next step. */
export interface ShowStep {
  targets: ShowTarget[];
  after: number;
}

/** Cinema: the `keep` light (by a fragment of its name) is dimmed to `level`, and every other shared light goes off. */
export interface CinemaConfig {
  keep: string;
  level: number;
}

/** Music: the sound system on, `lights` warm at `level` one by one, and `off` out. */
export interface MusicConfig {
  lights: readonly string[];
  off: readonly string[];
  level: number;
}

const SIDE = ["side light low", "side light mid", "side light top"] as const;

export const CINEMA_DEFAULT: CinemaConfig = { keep: "side light top", level: 15 };
export const MUSIC_DEFAULT: MusicConfig = { lights: [...SIDE, "couch"], off: ["kitchen"], level: 50 };

/** Between two lights coming on in a sweep. */
export const SHOW_STEP_MS = 400;

/** The light whose name holds the fragment. */
function pick(devices: readonly StDevice[], fragment: string): StDevice | undefined {
  const f = norm(fragment);
  return f.trim() ? devices.find((d) => d.kind === "light" && norm(d.name).includes(f)) : undefined;
}

/** The lights for the fragments in order, each once; fragments that find nothing are skipped. */
function pickAll(devices: readonly StDevice[], fragments: readonly string[]): StDevice[] {
  const out: StDevice[] = [];
  for (const f of fragments) {
    const d = pick(devices, f);
    if (d && !out.some((o) => o.id === d.id)) out.push(d);
  }
  return out;
}

const on = (d: StDevice, level?: number): ShowTarget => ({ device: d, commands: lightCommands(true, d.dimmable ? level : undefined) });
const off = (d: StDevice): ShowTarget => ({ device: d, commands: lightCommands(false) });

/**
 * The cinema mode, in one step: the top side light dimmed, everything else off but the independent lights. Null when the
 * home has no lights.
 */
export function cinemaShow(devices: readonly StDevice[], cfg: CinemaConfig = CINEMA_DEFAULT, independent: readonly string[] = INDEPENDENT_DEFAULT): ShowStep[] | null {
  const lights = sharedLights(devices, independent);
  if (!lights.length) return null;
  const keep = pick(lights, cfg.keep);
  return [{ targets: lights.map((d) => (d.id === keep?.id ? on(d, cfg.level) : off(d))), after: 0 }];
}

/** The music mode, or null when the home has neither a sound system nor any of its lights. */
export function musicShow(devices: readonly StDevice[], cfg: MusicConfig = MUSIC_DEFAULT, independent: readonly string[] = INDEPENDENT_DEFAULT): ShowStep[] | null {
  const sound = devices.filter((d) => d.kind === "audio");
  const shared = sharedLights(devices, independent);
  const lights = pickAll(shared, cfg.lights);
  if (!sound.length && !lights.length) return null;
  const steps: ShowStep[] = [];
  if (sound.length) steps.push({ targets: sound.map((d) => ({ device: d, commands: lightCommands(true) })), after: lights.length ? 250 : 0 });
  lights.forEach((d) => steps.push({ targets: [on(d, cfg.level)], after: SHOW_STEP_MS / 2 }));
  const dark = pickAll(shared, cfg.off).filter((d) => !lights.some((l) => l.id === d.id));
  if (dark.length) steps.push({ targets: dark.map(off), after: 0 });
  return steps;
}

/**
 * The ripple: a wave down the side lights that turns them on even when they are off, shifts them through a cool colour
 * to a warm white and up in brightness, then sets every light back exactly as it was (on or off, level, colour or white),
 * so the room is unchanged afterwards. "open" is the slow one, shown while Nest loads; "launch" is the quick one before
 * another app opens. Both are kept soft: a light tint, and a brightness that follows the room (`rippleLevel`).
 */
export interface RippleConfig {
  lights: readonly string[];
}

export const RIPPLE_DEFAULT: RippleConfig = { lights: SIDE };

export type RippleStyle = "open" | "launch";

/** Per light, in ms, for each phase: the cool wave, the warm wave, the way back. A zero skips the phase. */
export const RIPPLE_TIMING: Record<RippleStyle, { cool: number; warm: number; back: number }> = {
  open: { cool: 500, warm: 400, back: 300 },
  launch: { cool: 0, warm: 200, back: 150 },
};

/** The wave's colours: a soft cool tint (hue and saturation, 0-100), then a warm white in kelvin. */
const COOL = { hue: 62, saturation: 35 };
const WARM = { kelvin: 2700 };

/** The cool wave's brightness, as a share of the warm wave's. */
const COOL_SHARE = 0.7;

/**
 * How bright the ripple goes (percent) for the room's light, from the TV's sensor: low in a dark room so it is a glow
 * rather than a flash, higher in a bright one so it still shows. Without a reading, a middle value.
 */
export function rippleLevel(lux: number | null): number {
  if (lux === null || Number.isNaN(lux)) return 35;
  const points = [[0, 15], [50, 30], [150, 50], [400, 75]] as const;
  if (lux <= 0) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (lux <= x1) {
      const [x0, y0] = points[i - 1];
      return Math.round(y0 + ((lux - x0) / (x1 - x0)) * (y1 - y0));
    }
  }
  return points[points.length - 1][1];
}

/** Over this saturation a light is taken to be showing a colour; under it, a white (its hue and saturation then only follow its temperature: a 2700 K white reports about 66). */
const COLOUR_MIN_SATURATION = 75;

/** The commands that put a light back as the status describes it: its colour or white, its level, then on or off last. */
export function restoreCommands(d: StDevice): StCommand[] {
  const out: StCommand[] = [];
  if (d.colour) {
    if (typeof d.saturation === "number" && d.saturation > COLOUR_MIN_SATURATION && typeof d.hue === "number") out.push(...colorCommands(d.hue, d.saturation));
    else if (typeof d.colorTemp === "number") out.push(...whiteCommands(d.colorTemp));
  }
  if (d.dimmable && typeof d.level === "number") out.push({ capability: "switchLevel", command: "setLevel", arguments: [Math.max(1, Math.min(100, d.level))] });
  out.push({ capability: "switch", command: d.on === false ? "off" : "on" });
  return out;
}

/**
 * The ripple, and `undo`: every light back as it was, for the caller to send if the ripple breaks off halfway. Null when
 * the home has none of its lights. The state comes from `devices`, so it should be a status read just now.
 */
export function rippleShow(
  devices: readonly StDevice[],
  style: RippleStyle = "open",
  cfg: RippleConfig = RIPPLE_DEFAULT,
  independent: readonly string[] = INDEPENDENT_DEFAULT,
  lux: number | null = roomLux(devices),
): { steps: ShowStep[]; undo: ShowStep } | null {
  const lights = pickAll(sharedLights(devices, independent), cfg.lights);
  if (!lights.length) return null;
  const base = rippleLevel(lux);
  // A light that is already on never dims for the wave: it keeps its own level when that is higher, and only its colour shifts.
  const levelFor = (d: StDevice, target: number) => (d.on && typeof d.level === "number" ? Math.max(target, d.level) : target);
  const t = RIPPLE_TIMING[style];
  const last = lights.length - 1;
  const phase = (ms: number, commandsFor: (d: StDevice) => StCommand[], hold: number): ShowStep[] =>
    ms ? lights.map((d, i) => ({ targets: [{ device: d, commands: commandsFor(d) }], after: i === last ? hold : ms })) : [];
  const cool = (d: StDevice): StCommand[] => [
    { capability: "switch", command: "on" },
    ...(d.colour ? colorCommands(COOL.hue, COOL.saturation) : []),
    ...(d.dimmable ? lightCommands(true, levelFor(d, Math.round(base * COOL_SHARE))).slice(1) : []),
  ];
  const warm = (d: StDevice): StCommand[] => [
    { capability: "switch", command: "on" },
    ...(d.colour ? whiteCommands(WARM.kelvin) : []),
    ...(d.dimmable ? lightCommands(true, levelFor(d, base)).slice(1) : []),
  ];
  const back = (d: StDevice): StCommand[] => restoreCommands(d);
  const steps = [...phase(t.cool, cool, 250), ...phase(t.warm, warm, 400), ...phase(t.back, back, 0)];
  return { steps, undo: { targets: lights.map((d) => ({ device: d, commands: restoreCommands(d) })), after: 0 } };
}

/** How a show is played: `send` sends one light's commands, the rest is timing and what to do when it breaks off. */
export interface RunOptions {
  send(target: ShowTarget): Promise<unknown>;
  sleep?(ms: number): Promise<void>;
  /** Checked before each later step; true stops the show (another command took over). */
  cancelled?(): boolean;
  /** Sent if a step fails, unless cancelled: the lights put back (the ripple moves levels and colours and must return them). */
  undo?: ShowStep;
  onError?(e: unknown): void;
}

/**
 * Plays a show. Steps go out on schedule, whatever the network takes (a SmartThings call is a few hundred ms, and waiting
 * for each would stretch a one-second ripple to three), but a light's own commands stay in order: each waits for the
 * light's previous one. `started` settles when the first step has been sent (a failure rejects it, so a caller can say
 * so at once); `finished` when everything has, and never rejects.
 */
export function runShow(steps: readonly ShowStep[], o: RunOptions): { started: Promise<void>; finished: Promise<void> } {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const chains = new Map<string, Promise<unknown>>();
  const fire = (step: ShowStep): Promise<unknown> => {
    const sent = Promise.all(
      step.targets.map((t) => {
        const next = (chains.get(t.device.id) ?? Promise.resolve()).catch(() => undefined).then(() => o.send(t));
        chains.set(t.device.id, next);
        return next;
      }),
    );
    // Whoever awaits it sees a failure; one nobody is awaiting yet must not become an unhandled rejection.
    sent.catch(() => undefined);
    return sent;
  };
  const first = fire(steps[0]);
  const started = first.then(() => undefined);
  const finished = (async () => {
    const all: Promise<unknown>[] = [first];
    for (let i = 1; i < steps.length; i++) {
      await sleep(steps[i - 1].after);
      if (o.cancelled?.()) break;
      all.push(fire(steps[i]));
    }
    await Promise.all(all);
  })().catch(async (e) => {
    o.onError?.(e);
    if (o.undo && !o.cancelled?.()) await fire(o.undo).catch(() => undefined);
  });
  return { started, finished };
}
