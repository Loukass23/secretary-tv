// SmartThings straight from Nest, no server (docs/smartthings.md). Nest is the only holder of the OAuth refresh token:
// it works once per refresh, so a second holder would cancel Nest's. The catalog apps get an access token in the
// launch payload instead (homeGrant).
import type { HomeGrant } from "@secretary/nuvio";
import type { LightsCommand } from "@secretary/assistant";
import {
  CINEMA_DEFAULT,
  createLights,
  MOOD_SETTLE_MS,
  type CinemaConfig,
  cinemaShow,
  danceShow,
  INDEPENDENT_DEFAULT,
  lightCommands,
  MUSIC_DEFAULT,
  type MusicConfig,
  musicShow,
  nextPictureMode,
  oauthTokens,
  pictureModeCommands,
  pictureScene,
  pictureTv,
  RIPPLE_DEFAULT,
  type RippleConfig,
  type RippleStyle,
  sharedLights,
  smartThings,
  type StDevice,
  type StScene,
  type StTokens,
  type TokenSource,
} from "@secretary/smartthings";
import { NestError } from "./brain.ts";
import { effective, lightFx } from "./light-fx.ts";
import { ST_CLIENT_ID, ST_CLIENT_SECRET, ST_TOKEN } from "./config.ts";

/** Where the setup script (tv-kit/scripts/smartthings.mjs authorize) writes the first token pair. */
export const TOKENS_KEY = "nest.smartthings";
const SCENES_KEY = "nest.movieScenes";

const isTokens = (t: unknown): t is StTokens => {
  const x = t as StTokens | null;
  return Boolean(x && typeof x.access === "string" && typeof x.refresh === "string" && typeof x.exp === "number");
};

const store = {
  load(): StTokens | null {
    try {
      const t = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "null");
      return isTokens(t) ? t : null;
    } catch {
      return null;
    }
  },
  save(t: StTokens) {
    try {
      localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    } catch {
      // Lost on restart: the setup script has to authorize again.
    }
  },
};

const oauth: TokenSource | null = ST_CLIENT_ID && ST_CLIENT_SECRET ? oauthTokens({ clientId: ST_CLIENT_ID, clientSecret: ST_CLIENT_SECRET }, store) : null;

/** The OAuth pair when the setup script has run, else the build's personal token. */
const token: TokenSource = async (force) => (oauth ? await oauth(force) : null) ?? (ST_TOKEN || null);

/** True when this build can reach SmartThings at all. */
export const homeConfigured = () => Boolean(ST_TOKEN) || (oauth !== null && store.load() !== null);

export const home = smartThings({ token });

export interface MovieScenes {
  movie?: string;
  restore?: string;
}

export function movieScenes(): MovieScenes {
  try {
    const v = JSON.parse(localStorage.getItem(SCENES_KEY) ?? "{}") as MovieScenes;
    return { ...(typeof v.movie === "string" ? { movie: v.movie } : {}), ...(typeof v.restore === "string" ? { restore: v.restore } : {}) };
  } catch {
    return {};
  }
}

export function setMovieScenes(v: MovieScenes) {
  try {
    localStorage.setItem(SCENES_KEY, JSON.stringify(v));
  } catch {
    // Until Nest restarts.
  }
}

/** What a catalog app gets for its lights: an access token good for a while, the scenes if any, and how the side lights behave. Null without SmartThings. */
export async function homeGrant(now = Date.now()): Promise<HomeGrant | null> {
  const scenes = movieScenes();
  if (!homeConfigured()) return null;
  try {
    const t = await token();
    if (!t) return null;
    // A personal token's expiry is unknown: an hour, after which the app falls back to the server.
    const exp = oauth && store.load()?.access === t ? store.load()!.exp : now + 60 * 60_000;
    const fx = effective(lightFx());
    const restore = lights.heldStatus()?.filter((d) => d.kind === "light");
    return {
      token: t,
      exp,
      ...scenes,
      lights: { sync: fx.sync, enabled: fx.enabled, side: [...rippleConfig().lights], independent: [...independentLights()], level: cinemaConfig().level, ...(restore?.length ? { restore } : {}) },
    };
  } catch {
    return null;
  }
}

const PICTURE_KEY = "nest.pictureModes";
/** The two modes the quick toggle flips between: Dynamic by day (a bright window), Eco at night. */
export const DEFAULT_PICTURE_PAIR: readonly [string, string] = ["Dynamic", "Eco"];

export function picturePair(): readonly [string, string] {
  try {
    const v = JSON.parse(localStorage.getItem(PICTURE_KEY) ?? "null") as unknown;
    if (Array.isArray(v) && v.length === 2 && v.every((m) => typeof m === "string" && m)) return [v[0], v[1]];
  } catch {
    // Unreadable: the defaults.
  }
  return DEFAULT_PICTURE_PAIR;
}

const PICTURE_LAST_KEY = "nest.pictureLast";

/** The picture mode Nest last set. SmartThings' own picture-mode status is stale on this TV (it never updates), so the toggle and the icon go by this. */
export function lastPictureMode(): string | undefined {
  try {
    return localStorage.getItem(PICTURE_LAST_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Flips the TV's picture mode between the two favourites and returns the mode it asked for. It runs the scene named for
 * the mode ("TV Eco", made in the SmartThings app), because this TV ignores the picture-mode command from the cloud API
 * but obeys a scene; without one it sends the command anyway.
 */
export async function togglePictureMode(devices: readonly StDevice[], scenes: readonly StScene[]): Promise<string> {
  if (!homeConfigured()) throw new NestError("Picture mode needs SmartThings on this TV.");
  const tv = pictureTv(devices);
  const mode = nextPictureMode(lastPictureMode() ?? tv?.pictureMode, picturePair(), tv?.pictureModes);
  const scene = pictureScene(mode, scenes);
  if (scene) await home.runScene(scene.id);
  else if (tv) await home.command(tv.id, pictureModeCommands(mode, tv.pictureCap));
  else throw new NestError(`Make a SmartThings scene named “TV ${mode}” to switch the picture.`);
  rememberPictureMode(mode);
  return mode;
}

/** Keeps the mode Nest just set, by the button or by a prompt. */
export function rememberPictureMode(mode: string) {
  try {
    localStorage.setItem(PICTURE_LAST_KEY, mode);
  } catch {
    // The toggle then starts from SmartThings' status again after a restart.
  }
}

/** Scene names that stand for Ask Nest's "cinema mode", "warm lights" and "lights off". */
const SCENE_NAMES: Record<"cinema" | "warm" | "off" | "music", RegExp> = {
  music: /music/i,
  cinema: /cinema|movie|film/i,
  warm: /warm|evening|relax|cos[yi]/i,
  off: /off|good ?night|bed/i,
};
/** The levels used when no scene fits: what the server's own scenes set. */
const SCENE_LEVEL = { cinema: 15, warm: 70, off: 0, music: 50 } as const;

const CINEMA_KEY = "nest.cinemaShow";
const MUSIC_KEY = "nest.musicMode";

const names = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const stored = (key: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const INDEPENDENT_KEY = "nest.independentLights";

/** Lights no mode touches: the computer desk, or `nest.independentLights` (name fragments) for another home. */
export function independentLights(): readonly string[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEPENDENT_KEY) ?? "null") as unknown;
    if (names(v)) return v;
  } catch {
    // Unreadable: the default.
  }
  return INDEPENDENT_DEFAULT;
}

/** Cinema's light: the defaults (the top side light, dimmed to 15%), or `nest.cinemaShow` ({ keep, level }) for another home. */
export function cinemaConfig(): CinemaConfig {
  const v = stored(CINEMA_KEY);
  return {
    keep: typeof v.keep === "string" ? v.keep : CINEMA_DEFAULT.keep,
    level: typeof v.level === "number" ? Math.max(1, Math.min(100, v.level)) : CINEMA_DEFAULT.level,
  };
}

/** Music mode's lights: the defaults, or `nest.musicMode` ({ lights, off, level }). */
export function musicConfig(): MusicConfig {
  const v = stored(MUSIC_KEY);
  return {
    lights: names(v.lights) ? v.lights : MUSIC_DEFAULT.lights,
    off: names(v.off) ? v.off : MUSIC_DEFAULT.off,
    level: typeof v.level === "number" ? Math.max(1, Math.min(100, v.level)) : MUSIC_DEFAULT.level,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const RIPPLE_KEY = "nest.openRipple";

/** The ripples are on unless the light effects are off (Lights panel), or `nest.openRipple` is "off" (or a JSON object with `enabled: false`). */
export function openRippleEnabled(): boolean {
  if (!lightFx().enabled) return false;
  try {
    const raw = localStorage.getItem(RIPPLE_KEY);
    if (raw === "off") return false;
    return (stored(RIPPLE_KEY).enabled ?? true) !== false;
  } catch {
    return true;
  }
}

/** The ripple's lights: the side lights, or `nest.openRipple` ({ lights }) for another home. */
export function rippleConfig(): RippleConfig {
  const v = stored(RIPPLE_KEY);
  return { lights: names(v.lights) ? v.lights : RIPPLE_DEFAULT.lights };
}

const lights = createLights({
  home,
  configured: homeConfigured,
  fx: () => effective(lightFx()),
  rippleEnabled: openRippleEnabled,
  side: rippleConfig,
  independent: independentLights,
  pauseLevel: () => cinemaConfig().level,
  warn: (what, e) => console.warn(`[nest] lights ${what}`, e),
});

/** Nest's poller reports each status read here; one taken while a ripple is playing shows the wave, so it is dropped. */
export const noteStatus = lights.noteStatus;

/** When Nest opens or comes back: the slow ripple, from the status just read. */
export const playOpenRipple = (devices?: readonly StDevice[]) => lights.playRipple("open", devices);

/** The warm swell that plays with the splash (the secretary bird): only when the splash and the light effects are on. In a bright room the glow it leaves fades out. */
export async function playSplashRipple(devices?: readonly StDevice[]): Promise<void> {
  if (!effective(lightFx()).splash) return;
  await lights.playRipple("splash", devices);
}

/** The bird leaving: the side lights fade out and go off as Nest is left. */
export const playFarewell = () => lights.farewell();

/** When something starts playing: the side lights go off (cinema level when the player pauses), the room is dim before the picture comes up. */
export const dimForMedia = (limitMs = 2_500) => lights.playbackOff(limitMs);
export const mediaPaused = () => lights.playbackPause();
export const mediaResumed = () => lights.playbackResume();
export const mediaStopped = () => lights.playbackStop();
/** Nest is back on screen: the app that played has put the room back, so Nest stops holding it. */
export const mediaReleased = () => lights.release();

/** The dance's length: a round is ~35 s, so this is some twenty minutes, after which the lights stay as they are. */
const DANCE_ROUNDS = 36;

/** Music mode's dance, round after round, until another lights command replaces it. */
async function dance(run: number, devices: readonly StDevice[]): Promise<void> {
  const steps = danceShow(devices, musicConfig().lights, independentLights());
  if (!steps) return;
  for (let round = 0; round < DANCE_ROUNDS && run === lights.currentRun(); round++) await lights.startShow(steps, run).finished;
}

/** Puts the side lights in `rgb` (a poster's accent), or back as they were when it is null. */
export const syncMood = lights.syncMood;
export { MOOD_SETTLE_MS };

/** A ripple on request ("ripple test" to Ask Nest): plays whether or not the ripples are switched off, from a fresh status. */
export async function playRippleTest(style: RippleStyle): Promise<void> {
  lights.clearStatus();
  await lights.playRipple(style, undefined, true);
}

/**
 * Before another app opens: the quick ripple, then the app. Never longer than the limit, and a failure never stops the
 * app from opening.
 */
export async function rippleBeforeLaunch(limitMs = 3_000): Promise<void> {
  await Promise.race([lights.playRipple("launch").catch((e) => console.warn("[nest] launch ripple", e)), sleep(limitMs)]);
}

/**
 * Ask Nest's lights from the TV. Cinema is a show (the lights come on one after the other, then settle to one dim
 * glow), music is the sound system plus a warm room; either falls back to the movie scene picked in Lights (or a scene
 * with a fitting name), else every light at the scene's level. The sound system is not a light, so cinema, warm and off
 * never touch it.
 */
export async function runLights(cmd: LightsCommand, devices: readonly StDevice[], scenes: readonly StScene[]): Promise<void> {
  if (!homeConfigured()) throw new NestError("Lights need SmartThings on this TV, or Secretary Server.");
  // A lights command defines the room now, so a ripple it cut short has nothing left to restore to, nor a mood colour.
  const run = lights.takeOver();
  if ("scene" in cmd) {
    const apart = independentLights();
    const show = cmd.scene === "cinema" ? cinemaShow(devices, cinemaConfig(), apart) : cmd.scene === "music" ? musicShow(devices, musicConfig(), apart) : null;
    if (show) {
      const { started, finished } = lights.startShow(show, run);
      // Music mode: once the room is warm, the side lights dance (an effect of its own, off with the master switch).
      if (cmd.scene === "music" && effective(lightFx()).dance) void started.then(() => finished).then(() => dance(run, devices));
      return started;
    }
    const id = (cmd.scene === "cinema" ? movieScenes().movie : undefined) ?? scenes.find((s) => SCENE_NAMES[cmd.scene].test(s.name))?.id;
    if (id) return void (await home.runScene(id));
    if (cmd.scene === "music") throw new NestError("Music mode needs a sound system or lights SmartThings can see.");
  }
  const level = "level" in cmd ? cmd.level : SCENE_LEVEL[cmd.scene];
  const shared = sharedLights(devices, independentLights());
  if (!shared.length) throw new NestError("I can't see any SmartThings lights yet.");
  await Promise.all(shared.map((d) => home.command(d.id, lightCommands(level > 0, d.dimmable ? level : undefined))));
}

/** The header's sound button: the sound system on if it is off, off if it is on. Returns the state it asked for. */
export async function toggleSound(devices: readonly StDevice[], now?: boolean): Promise<boolean> {
  if (!homeConfigured()) throw new NestError("The sound system needs SmartThings on this TV.");
  const sound = devices.find((d) => d.kind === "audio");
  if (!sound) throw new NestError("I can't see a sound system in SmartThings.");
  const on = !(now ?? sound.on ?? false);
  await home.command(sound.id, lightCommands(on));
  lights.clearStatus();
  return on;
}
