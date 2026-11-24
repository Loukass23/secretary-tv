// The side lights as one stateful controller, shared by Nest and the catalog apps: the ripples, the lights following the
// focused poster, and the room going dark for playback. Pure show builders are in show.ts; this holds what must be
// remembered between calls (the newest command, the lights as they were, the last colour) and sends the steps.
import type { SmartThings, StDevice } from "./api.ts";
import { roomLux } from "./home.ts";
import {
  fadeShow,
  glowLevel,
  glideTint,
  moodGlide,
  type MoodTint,
  offShow,
  pauseShow,
  RIPPLE_DEFAULT,
  type RippleConfig,
  type RippleStyle,
  rippleShow,
  roomIsBright,
  runShow,
  type ShowStep,
  stColour,
} from "./show.ts";

export interface LightsDeps {
  home: Pick<SmartThings, "devices" | "command">;
  /** False when SmartThings cannot be reached at all: every call is then a no-op. */
  configured(): boolean;
  /** The effects now in force (the master switch already counted). */
  fx(): { enabled: boolean; splash: boolean; sync: boolean };
  /** Whether the ripples play (Nest's own switch); the catalog apps never ripple. */
  rippleEnabled?(): boolean;
  side?(): RippleConfig;
  independent?(): readonly string[];
  /** The level the room is dimmed to when playback pauses (percent). */
  pauseLevel?(): number;
  /** Time between the three moves of a colour change (ms, MOOD_STEP_MS by default), and how long focus must rest first (MOOD_SETTLE_MS). */
  moodStepMs?: number;
  moodSettleMs?: number;
  warn?(what: string, e: unknown): void;
}

/**
 * How long focus must rest before the lights start towards its colour: a walk along a row sends nothing until it stops,
 * and then only the last colour, so the room never flickers through every poster on the way.
 */
export const MOOD_SETTLE_MS = 700;

/** A timing from the environment: a whole number of ms within [min, max], else the default (empty, text, out of range). */
export function moodMs(raw: string | number | undefined | null, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
}
/**
 * The glide to a new colour is three moves, `MOOD_STEP_MS` apart (about a second and a half in all; each move is a cloud
 * call, so not much closer), enough that the light slides rather than snaps. Nest takes both from the environment
 * (`NEST_MOOD_STEP_MS`, `NEST_MOOD_SETTLE_MS`), through `moodMs`.
 */
export const MOOD_STEP_MS = 500;
const glideSteps = (_hueDistance: number) => 3;
/** The least change of hue (0-100) that is worth a call. */
const MOOD_MIN_STEP = 5;
/** A status read this recently is used again instead of asking. */
const FRESH_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createLights(deps: LightsDeps) {
  const { home } = deps;
  const stepMs = deps.moodStepMs ?? MOOD_STEP_MS;
  const settleMs = deps.moodSettleMs ?? MOOD_SETTLE_MS;
  const side = () => deps.side?.() ?? RIPPLE_DEFAULT;
  const apart = () => deps.independent?.() ?? undefined;
  const warn = (what: string, e: unknown) => (deps.warn ?? ((w, x) => console.warn(`[lights] ${w}`, x)))(what, e);

  /** The newest lights command: a show stops when another command comes in. */
  let current = 0;
  let status: { devices: readonly StDevice[]; at: number } | null = null;
  /** The lights as they were when the ripple now playing began (a status read in the middle of a wave must not become the "original"). */
  let baseline: readonly StDevice[] | null = null;
  let moodLights: readonly StDevice[] | null = null;
  let moodSent: { hue: number; rgb: readonly [number, number, number] } | null = null;
  /** The glide now playing, so a newer colour can start from where the lights have got to instead of waiting. */
  let moodGlideNow: { from: MoodTint; to: MoodTint; at: number; steps: number } | null = null;
  let moodTimer: ReturnType<typeof setTimeout> | undefined;
  let moodWanted: readonly [number, number, number] | null = null;
  /** The room as it was before playback took the lights, for the way back. */
  let held: readonly StDevice[] | null = null;
  /** Playback is on: the mood stays out of it, whatever the poster in focus. */
  let playing = false;

  const startShow = (steps: readonly ShowStep[], run: number, undo?: ShowStep) =>
    runShow(steps, {
      send: (t) => home.command(t.device.id, t.commands),
      cancelled: () => run !== current,
      undo,
      onError: (e) => warn("show", e),
    });

  /** Nest's poller reports each status read here; one taken while a ripple is playing shows the wave, so it is dropped. */
  function noteStatus(devices: readonly StDevice[]) {
    if (!baseline) status = { devices, at: Date.now() };
  }

  async function freshStatus(): Promise<readonly StDevice[]> {
    if (status && Date.now() - status.at < FRESH_MS) return status.devices;
    const devices = await home.devices();
    noteStatus(devices);
    return devices;
  }

  /** A lights command that defines the room now: whatever a ripple or the mood was restoring to is moot. */
  function takeOver(): number {
    baseline = null;
    moodLights = null;
    moodSent = null;
    moodGlideNow = null;
    return ++current;
  }

  async function playRipple(style: RippleStyle, devices?: readonly StDevice[], force = false): Promise<void> {
    if (!deps.configured() || (!force && !(deps.rippleEnabled?.() ?? true))) return;
    const source = baseline ?? devices ?? (await freshStatus());
    const ripple = rippleShow(source, style, side(), apart(), roomLux(source));
    if (!ripple) return;
    baseline = source;
    const run = ++current;
    const { started, finished } = startShow(ripple.steps, run, ripple.undo);
    try {
      await started;
      await finished;
      // The splash leaves a dim glow that a bright room would not show: the TV's sensor, read before the wave (the glow
      // itself must not colour the reading), decides whether it goes out.
      if (style === "splash" && run === current && roomIsBright(roomLux(source))) {
        const level = glowLevel(roomLux(source));
        const glowing = source.map((d) => ({ ...d, on: true, level }));
        const out = fadeShow(glowing, 0, side(), apart(), 3, 700);
        if (out) await startShow(out, run).finished;
      }
    } finally {
      if (run === current) {
        baseline = null;
        status = null;
      }
    }
  }

  async function applyMood(rgb: readonly [number, number, number] | null): Promise<void> {
    if (!deps.configured() || baseline || playing) return;
    const wanted = rgb !== null && deps.fx().sync;
    if (!wanted) {
      if (!moodLights) return;
      const before = moodLights;
      moodLights = null;
      moodSent = null;
      moodGlideNow = null;
      const lights = rippleShow(before, "launch", side(), apart());
      if (lights) await startShow([lights.undo], ++current).finished;
      return;
    }
    const to = stColour(rgb);
    if (moodSent && Math.abs(moodSent.hue - to.hue) < MOOD_MIN_STEP) return;
    moodLights ??= await freshStatus();
    // In a bright room the colour cannot be seen: leave the lights as they are.
    if (roomIsBright(roomLux(moodLights))) return;
    // From the colour the lights are showing: part-way along a glide still playing, else the last one sent, else what a light has now.
    const g = moodGlideNow;
    const from: MoodTint = g
      ? glideTint(g.from, g.to, Math.min(1, (Date.now() - g.at) / (g.steps * stepMs)))
      : moodSent
        ? stColour(moodSent.rgb)
        : startTint(moodLights);
    // From a white there is no hue to turn: a middling glide fades the colour in.
    const near = from.saturation < 20 ? 15 : Math.min(Math.abs(from.hue - to.hue), 100 - Math.abs(from.hue - to.hue));
    const glide = moodGlide(moodLights, from, to, glideSteps(near), stepMs, side(), apart());
    if (!glide) return;
    moodSent = { hue: to.hue, rgb };
    moodGlideNow = { from, to, at: Date.now(), steps: glide.steps.length };
    // The newest colour replaces a glide still playing: the old one stops where it is.
    await startShow(glide.steps, ++current, glide.undo).started;
  }

  /** The colour a side light shows now (grey for one that is off or white), where the first glide starts. */
  function startTint(devices: readonly StDevice[]): MoodTint {
    const d = devices.find((x) => x.colour && x.on !== false && typeof x.hue === "number" && typeof x.saturation === "number");
    return d ? { hue: d.hue!, saturation: d.saturation! } : { hue: 0, saturation: 0 };
  }

  /**
   * Puts the side lights in `rgb` (a poster's accent), or back as they were when it is null (focus left the art, or the
   * setting went off). Waits for focus to rest and glides there in small steps; a ripple, playback or another command takes over.
   */
  function syncMood(rgb: readonly [number, number, number] | null): void {
    moodWanted = rgb;
    clearTimeout(moodTimer);
    // Each call restarts the wait, so only the colour focus rests on is sent; going back to normal is not held up.
    const wait = rgb ? settleMs : 0;
    moodTimer = setTimeout(() => {
      moodTimer = undefined;
      void applyMood(moodWanted).catch((e) => warn("mood", e));
    }, wait);
  }

  /** Waits for a show, never longer than `limitMs`, so the caller (a player opening, an app closing) is not held up. */
  const bounded = (p: Promise<unknown>, limitMs: number) => Promise.race([p, sleep(limitMs)]).catch((e) => warn("wait", e));

  return {
    noteStatus,
    syncMood,
    playRipple,
    /** A lights command from outside (a scene, a prompt) defines the room: returns the run number it should use. */
    takeOver: () => {
      status = null;
      held = null;
      playing = false;
      return takeOver();
    },
    startShow,
    currentRun: () => current,
    /** The room as it was before playback took the lights (null when playback is not holding them). */
    heldStatus: (): readonly StDevice[] | null => held,
    /** Playback began elsewhere (Nest dimmed the room before the app opened): `devices` is the way back. */
    /** Forgets what playback was holding (the app that played it has put the room back). */
    release() {
      held = null;
      playing = false;
    },
    hold(devices: readonly StDevice[]) {
      held = devices;
    },
    freshStatus,
    clearStatus: () => void (status = null),

    /** Playback starts: the side lights fade out, and the room as it was is kept for when playback ends. */
    async playbackOff(limitMs = 2_500): Promise<void> {
      if (!deps.configured() || !deps.fx().enabled) return;
      const was = held ?? moodLights ?? (await freshStatus());
      held ??= was;
      playing = true;
      const run = takeOver();
      const steps = fadeShow(await freshStatus(), 0, side(), apart(), 2, 500);
      status = null;
      if (!steps) return;
      const { started, finished } = startShow(steps, run);
      await bounded(started.then(() => finished), limitMs);
    },

    /** Paused: the side lights come back softly, in the colour they last had. */
    async playbackPause(limitMs = 2_500): Promise<void> {
      if (!deps.configured() || !deps.fx().enabled || !playing) return;
      const run = ++current;
      const steps = pauseShow(await freshStatus(), deps.pauseLevel?.() ?? 15, side(), apart());
      status = null;
      if (!steps) return;
      await bounded(startShow(steps, run).finished, limitMs);
    },

    /** Resumed after a pause: off again. */
    async playbackResume(limitMs = 2_500): Promise<void> {
      if (!deps.configured() || !deps.fx().enabled || !playing) return;
      const run = ++current;
      const steps = offShow(await freshStatus(), side(), apart());
      status = null;
      if (!steps) return;
      await bounded(startShow(steps, run).finished, limitMs);
    },

    /** Playback is over: every side light back as it was before it started. */
    async playbackStop(): Promise<void> {
      const before = held;
      held = null;
      playing = false;
      if (!before || !deps.configured()) return;
      const lights = rippleShow(before, "launch", side(), apart());
      status = null;
      if (lights) await startShow([lights.undo], takeOver()).finished.catch((e) => warn("restore", e));
    },

    /** The bird leaving: the side lights fade out and go off. */
    async farewell(): Promise<void> {
      if (!deps.configured() || !deps.fx().splash) return;
      const run = takeOver();
      const steps = fadeShow(await freshStatus(), 0, side(), apart(), 3, 700);
      status = null;
      if (!steps) return;
      const { started, finished } = startShow(steps, run);
      await bounded(started.then(() => finished), 4_000);
    },
  };
}

export type LightsController = ReturnType<typeof createLights>;
