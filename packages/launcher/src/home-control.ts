// SmartThings straight from Nest, no server (docs/smartthings.md). Nest is the only holder of the OAuth refresh token:
// it works once per refresh, so a second holder would cancel Nest's. The catalog apps get an access token in the
// launch payload instead (homeGrant).
import type { HomeGrant } from "@secretary/nuvio";
import type { LightsCommand } from "@secretary/assistant";
import { lightCommands, nextPictureMode, oauthTokens, pictureModeCommands, pictureScene, pictureTv, smartThings, type StDevice, type StScene, type StTokens, type TokenSource } from "@secretary/smartthings";
import { NestError } from "./brain.ts";
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

/** What a catalog app gets for its movie lights: an access token good for a while, and the scenes. Null when unset. */
export async function homeGrant(now = Date.now()): Promise<HomeGrant | null> {
  const scenes = movieScenes();
  if (!scenes.movie || !homeConfigured()) return null;
  try {
    const t = await token();
    if (!t) return null;
    // A personal token's expiry is unknown: an hour, after which the app falls back to the server.
    const exp = oauth && store.load()?.access === t ? store.load()!.exp : now + 60 * 60_000;
    return { token: t, exp, ...scenes };
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
const SCENE_NAMES: Record<"cinema" | "warm" | "off", RegExp> = {
  cinema: /cinema|movie|film/i,
  warm: /warm|evening|relax|cos[yi]/i,
  off: /off|good ?night|bed/i,
};
/** The levels used when no scene fits: what the server's own scenes set. */
const SCENE_LEVEL = { cinema: 15, warm: 70, off: 0 } as const;

/**
 * Ask Nest's lights from the TV: the movie scene picked in Lights (or a scene with a fitting name), else every light at
 * the scene's level.
 */
export async function runLights(cmd: LightsCommand, devices: readonly StDevice[], scenes: readonly StScene[]): Promise<void> {
  if (!homeConfigured()) throw new NestError("Lights need SmartThings on this TV, or Secretary Server.");
  if ("scene" in cmd) {
    const id = (cmd.scene === "cinema" ? movieScenes().movie : undefined) ?? scenes.find((s) => SCENE_NAMES[cmd.scene].test(s.name))?.id;
    if (id) return void (await home.runScene(id));
  }
  const level = "level" in cmd ? cmd.level : SCENE_LEVEL[cmd.scene];
  const lights = devices.filter((d) => d.kind === "light");
  if (!lights.length) throw new NestError("I can't see any SmartThings lights yet.");
  await Promise.all(lights.map((d) => home.command(d.id, lightCommands(level > 0, d.dimmable ? level : undefined))));
}
