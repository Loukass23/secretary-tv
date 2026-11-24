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
 * so the room is unchanged afterwards ("splash" is the exception: it ends in a dim orange-yellow glow that stays). "open" is the slow one, shown while Nest loads; "launch" is the quick one before
 * another app opens. Both are kept soft: a light tint, and a brightness that follows the room (`rippleLevel`).
 */
export interface RippleConfig {
  lights: readonly string[];
}

export const RIPPLE_DEFAULT: RippleConfig = { lights: SIDE };

/** "splash" is the one that plays with the secretary bird: no cool wave, a slow warm swell, a slow way back. */
export type RippleStyle = "open" | "launch" | "splash";

/** Per light, in ms, for each phase: the cool wave, the warm wave, the way back. A zero skips the phase. */
export const RIPPLE_TIMING: Record<RippleStyle, { cool: number; warm: number; back: number; settle?: number }> = {
  open: { cool: 500, warm: 400, back: 300 },
  launch: { cool: 0, warm: 200, back: 150 },
  // The splash does not put the room back: after a slow warm swell the lights settle into a dim orange-yellow glow and stay.
  splash: { cool: 0, warm: 900, back: 0, settle: 700 },
};

/** Where the splash leaves the side lights: orange-yellow (hue and saturation, 0-100) and a share of the ripple's brightness. */
const GLOW = { hue: 10, saturation: 90 };
const GLOW_SHARE = 0.45;
/** How many steps the splash takes to fade from the swell to the glow. */
const SETTLE_STAGES = 4;

/** The level the splash leaves the lights at, from the ripple's brightness. */
const glowLevelFor = (base: number) => Math.max(8, Math.round(base * GLOW_SHARE));

/** The level the splash's glow sits at in a room with this much light (lux), for fading it out afterwards. */
export const glowLevel = (lux: number | null): number => glowLevelFor(rippleLevel(lux));

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
  // The glow the splash leaves, reached in stages so the lights fade down together instead of dropping: the first stage turns
  // the colour from warm white to orange-yellow, each next one lowers the level a step, all lights in the same step.
  const glowLevel = glowLevelFor(base);
  const settleStages = (gap: number): ShowStep[] =>
    Array.from({ length: SETTLE_STAGES }, (_, k) => {
      const level = Math.round(base + ((glowLevel - base) * (k + 1)) / SETTLE_STAGES);
      return {
        targets: lights.map((d): ShowTarget => ({
          device: d,
          commands: [
            { capability: "switch", command: "on" },
            ...(k === 0 && d.colour ? colorCommands(GLOW.hue, GLOW.saturation) : []),
            ...(d.dimmable ? lightCommands(true, level).slice(1) : []),
          ],
        })),
        after: k === SETTLE_STAGES - 1 ? 0 : gap,
      };
    });
  const steps = [
    ...phase(t.cool, cool, 250),
    ...phase(t.warm, warm, t.settle ? 900 : 400),
    ...(t.settle ? settleStages(t.settle) : phase(t.back, back, 0)),
  ];
  return { steps, undo: { targets: lights.map((d) => ({ device: d, commands: restoreCommands(d) })), after: 0 } };
}

/** A colour as SmartThings takes it: hue and saturation, 0-100 each, from an sRGB colour (0-255 a channel). */
export function stColour([r, g, b]: readonly [number, number, number]): { hue: number; saturation: number } {
  const mx = Math.max(r, g, b);
  const c = mx - Math.min(r, g, b);
  let h = 0;
  if (c > 0) h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
  h = (h * 60 + 360) % 360;
  return { hue: Math.round((h / 360) * 100), saturation: mx === 0 ? 0 : Math.round((c / mx) * 100) };
}

/** A hue move of at least this much (0-100) goes by way of a halfway colour. */
const MOOD_EASE_FROM = 20;

/**
 * The colour halfway between two (in RGB, so the light passes through what lies between them), or null when the hue
 * moves less than MOOD_EASE_FROM: the side lights slide to a very different poster colour instead of snapping to it.
 */
export function moodMidpoint(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): [number, number, number] | null {
  const d = Math.abs(stColour(from).hue - stColour(to).hue);
  if (Math.min(d, 100 - d) < MOOD_EASE_FROM) return null;
  return [Math.round((from[0] + to[0]) / 2), Math.round((from[1] + to[1]) / 2), Math.round((from[2] + to[2]) / 2)];
}

/** The least saturation a mood colour is sent with: under it a light would just look white. */
const MOOD_MIN_SATURATION = 45;

/**
 * The side lights taking a poster's colour: each light that can show colour is sent it, the others only the level. One
 * step (the lights change together), plus `undo`, every light back as it was. Null when the home has none of them.
 * The level follows the room like the ripple's (`rippleLevel`); a light that is on never dims for it.
 */
export function moodShow(
  devices: readonly StDevice[],
  rgb: readonly [number, number, number],
  cfg: RippleConfig = RIPPLE_DEFAULT,
  independent: readonly string[] = INDEPENDENT_DEFAULT,
  lux: number | null = roomLux(devices),
): { steps: ShowStep[]; undo: ShowStep } | null {
  const { hue, saturation } = stColour(rgb);
  return moodShowHs(devices, hue, saturation, cfg, independent, lux);
}

function moodShowHs(
  devices: readonly StDevice[],
  hue: number,
  saturation: number,
  cfg: RippleConfig,
  independent: readonly string[],
  lux: number | null,
): { steps: ShowStep[]; undo: ShowStep } | null {
  const lights = pickAll(sharedLights(devices, independent), cfg.lights);
  if (!lights.length) return null;
  const level = rippleLevel(lux);
  const targets = lights.map((d): ShowTarget => ({
    device: d,
    commands: [
      { capability: "switch", command: "on" },
      ...(d.colour ? colorCommands(hue, Math.max(saturation, MOOD_MIN_SATURATION)) : []),
      ...(d.dimmable ? lightCommands(true, d.on && typeof d.level === "number" ? Math.max(level, d.level) : level).slice(1) : []),
    ],
  }));
  return { steps: [{ targets, after: 0 }], undo: { targets: lights.map((d) => ({ device: d, commands: restoreCommands(d) })), after: 0 } };
}

/** A colour in SmartThings terms (hue and saturation, 0-100), the start of a glide: a light that is showing white has no hue worth gliding from. */
export interface MoodTint {
  hue: number;
  saturation: number;
}

/** Under this saturation a colour has no hue worth gliding from: the glide fades the saturation in at the new hue instead. */
const GLIDE_GREY = 20;

/** The colour a fraction `t` (0-1) of the way from `from` to `to`: the hue turns the short way round the wheel (it is 0-100), the saturation follows. */
export function glideTint(from: MoodTint, to: MoodTint, t: number): MoodTint {
  const fromHue = from.saturation < GLIDE_GREY ? to.hue : from.hue;
  let dh = to.hue - fromHue;
  if (dh > 50) dh -= 100;
  if (dh < -50) dh += 100;
  const k = Math.max(0, Math.min(1, t));
  return { hue: Math.round((((fromHue + dh * k) % 100) + 100) % 100), saturation: Math.round(from.saturation + (to.saturation - from.saturation) * k) };
}

/**
 * The side lights gliding from one colour to another, in `steps` small moves `gap` ms apart: the hue turns the short way
 * round the wheel, the saturation and the level follow, so the room slides to the poster's colour instead of switching.
 * The last step is the colour itself. `undo` puts every light back as it was. Null when the home has none of the lights.
 */
export function moodGlide(
  devices: readonly StDevice[],
  from: MoodTint,
  to: MoodTint,
  steps = 5,
  gap = 600,
  cfg: RippleConfig = RIPPLE_DEFAULT,
  independent: readonly string[] = INDEPENDENT_DEFAULT,
  lux: number | null = roomLux(devices),
): { steps: ShowStep[]; undo: ShowStep } | null {
  const n = Math.max(1, Math.round(steps));
  let undo: ShowStep | null = null;
  const out: ShowStep[] = [];
  for (let k = 1; k <= n; k++) {
    const tint = glideTint(from, to, k / n);
    const one = moodShowHs(devices, tint.hue, tint.saturation, cfg, independent, lux);
    if (!one) return null;
    undo = one.undo;
    out.push({ ...one.steps[0], after: k === n ? 0 : gap });
  }
  return { steps: out, undo: undo! };
}

/**
 * The lights fading down together, in `stages` steps: to `target` percent (never raising a light), or, with 0, to off (the
 * last step switches them off). Only lights that are on take part, and one that cannot dim only goes off at the end.
 * This is how the bird leaves (the glow fades out on exit) and how the room dims when something starts playing.
 * Null when no light of the config is on.
 */
export function fadeShow(
  devices: readonly StDevice[],
  target: number,
  cfg: RippleConfig = RIPPLE_DEFAULT,
  independent: readonly string[] = INDEPENDENT_DEFAULT,
  stages = 3,
  gap = 600,
): ShowStep[] | null {
  const lit = pickAll(sharedLights(devices, independent), cfg.lights).filter((d) => d.on !== false);
  if (!lit.length) return null;
  const from = (d: StDevice) => (typeof d.level === "number" ? d.level : 50);
  const steps: ShowStep[] = [];
  for (let k = 1; k <= stages; k++) {
    const last = k === stages;
    const targets: ShowTarget[] = lit.flatMap((d): ShowTarget[] => {
      if (target === 0 && last) return [off(d)];
      if (!d.dimmable) return [];
      const goal = target === 0 ? Math.min(from(d), 6) : Math.min(from(d), target);
      const level = Math.round(from(d) + ((goal - from(d)) * k) / (target === 0 ? stages - 1 : stages));
      return [{ device: d, commands: lightCommands(true, Math.max(1, Math.min(from(d), level))).slice(1) }];
    });
    if (targets.length) steps.push({ targets, after: last ? 0 : gap });
  }
  return steps.length ? steps : null;
}

/** The room is clearly bright from this reading (lux) up: the same line Daylight uses, and the point where a dim side light cannot be seen. */
export const BRIGHT_LUX = 150;

/** True when the TV's sensor says the side lights would not show. No reading counts as dark, so the room is never left unlit unasked. */
export function roomIsBright(lux: number | null): boolean {
  return lux !== null && !Number.isNaN(lux) && lux >= BRIGHT_LUX;
}

/**
 * Playback paused: the side lights come back softly at `level` percent, in the colour they last had (a light that is off
 * keeps its colour, so only the level and on are sent). One step; null when the home has none of the lights.
 */
export function pauseShow(
  devices: readonly StDevice[],
  level: number,
  cfg: RippleConfig = RIPPLE_DEFAULT,
  independent: readonly string[] = INDEPENDENT_DEFAULT,
): ShowStep[] | null {
  const lights = pickAll(sharedLights(devices, independent), cfg.lights);
  if (!lights.length) return null;
  return [{ targets: lights.map((d) => on(d, Math.max(1, Math.min(100, level)))), after: 0 }];
}

/** The side lights off, together, in one step (playback resumed after a pause). Null when the home has none of them. */
export function offShow(
  devices: readonly StDevice[],
  cfg: RippleConfig = RIPPLE_DEFAULT,
  independent: readonly string[] = INDEPENDENT_DEFAULT,
): ShowStep[] | null {
  const lights = pickAll(sharedLights(devices, independent), cfg.lights);
  return lights.length ? [{ targets: lights.map(off), after: 0 }] : null;
}

/** The colours the lights dance through: hue and saturation, 0-100 (orange, magenta, violet, cyan, gold, green). */
export const DANCE_COLOURS = [
  { hue: 10, saturation: 95 },
  { hue: 87, saturation: 90 },
  { hue: 74, saturation: 85 },
  { hue: 50, saturation: 85 },
  { hue: 14, saturation: 90 },
  { hue: 33, saturation: 80 },
] as const;

/** Between two lights changing in the dance. */
export const DANCE_BEAT_MS = 1400;

/**
 * Music mode's dance: a chase where, each beat, the next light takes the next colour and swells while the one before
 * eases back, so the colours travel along the lights. `beats` steps; lights that cannot show colour only pulse. Null
 * without any of the lights.
 */
export function danceShow(
  devices: readonly StDevice[],
  fragments: readonly string[],
  independent: readonly string[] = INDEPENDENT_DEFAULT,
  beats = 24,
  level = 55,
): ShowStep[] | null {
  const lights = pickAll(sharedLights(devices, independent), fragments);
  if (!lights.length) return null;
  const steps: ShowStep[] = [];
  for (let b = 0; b < beats; b++) {
    const lead = lights[b % lights.length];
    const prev = lights[(b + lights.length - 1) % lights.length];
    const c = DANCE_COLOURS[b % DANCE_COLOURS.length];
    const targets: ShowTarget[] = [
      { device: lead, commands: [{ capability: "switch", command: "on" }, ...(lead.colour ? colorCommands(c.hue, c.saturation) : []), ...(lead.dimmable ? lightCommands(true, level).slice(1) : [])] },
    ];
    if (prev.id !== lead.id && prev.dimmable) targets.push({ device: prev, commands: lightCommands(true, Math.round(level * 0.45)).slice(1) });
    steps.push({ targets, after: DANCE_BEAT_MS });
  }
  return steps;
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
