// Movie lights (docs/smartthings.md): the scenes Nest's lights panel picked, run straight on SmartThings with the
// access token Nest put in the launch payload. Without one (an old token, a build without SmartThings) the server's
// "cinema" preset dims instead, as before.
import type { HomeGrant } from "@secretary/nuvio";
import { createLights, type LightsController, smartThings, staticToken, type StDevice } from "@secretary/smartthings";
import { readJson, writeJson } from "@secretary/tv-kit";

const HOME = "sectv.home";

export const saveHomeGrant = (g: HomeGrant) => writeJson(HOME, g);

/** The grant while its token is good for at least another minute. */
export function homeGrant(now = Date.now()): HomeGrant | null {
  const g = readJson<HomeGrant>(HOME);
  return g && typeof g.token === "string" && typeof g.exp === "number" && g.exp - now > 60_000 ? g : null;
}

/** Runs the movie scene (playback starts) or the restore scene (the player closed). True when SmartThings took it. */
export async function runMovieScene(which: "movie" | "restore", serverUrl: string, f: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  const g = homeGrant(now);
  const scene = g?.[which];
  if (g && scene) {
    try {
      await smartThings({ token: staticToken(g.token), fetch: f }).runScene(scene);
      return true;
    } catch {
      // Fall through to the server.
    }
  }
  if (which === "movie" && serverUrl) {
    await f(`${serverUrl.replace(/\/$/, "")}/domotics/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: "cinema" }),
    }).catch(() => {});
  }
  return false;
}

// --- the side lights, from the grant ---

let lights: { token: string; ctl: LightsController } | null = null;

/**
 * The side-light controller for the grant Nest sent (docs/smartthings.md), or null without one, or with every effect
 * off in Nest's Lights panel. Built once per token, so its memory of the room (what to put back) survives between calls.
 */
export function sideLights(now = Date.now()): LightsController | null {
  const g = homeGrant(now);
  if (!g?.lights?.enabled) return null;
  if (lights?.token === g.token) return lights.ctl;
  const l = g.lights;
  const ctl = createLights({
    home: smartThings({ token: staticToken(g.token) }),
    configured: () => true,
    fx: () => ({ enabled: true, splash: false, sync: l.sync }),
    side: () => ({ lights: l.side }),
    independent: () => l.independent,
    pauseLevel: () => l.level,
    moodStepMs: l.stepMs,
    moodSettleMs: l.settleMs,
    warn: () => {},
  });
  if (Array.isArray(l.restore) && l.restore.length) ctl.hold(l.restore as StDevice[]);
  lights = { token: g.token, ctl };
  return ctl;
}

/**
 * Playback's lights: off when it starts, soft when it pauses, off again when it resumes, as they were when it ends.
 * True when the side lights took it (no scene or server preset is then needed); false when there is no grant.
 */
export const playbackLights = {
  start: () => sideLights()?.playbackOff().then(() => true) ?? Promise.resolve(false),
  pause: () => void sideLights()?.playbackPause(),
  resume: () => void sideLights()?.playbackResume(),
  stop: () => sideLights()?.playbackStop().then(() => true) ?? Promise.resolve(false),
};

/** True when Nest's grant asks for the side lights to follow the poster in focus (its Lights panel, sync). */
export const lightsFollowFocus = (now = Date.now()): boolean => homeGrant(now)?.lights?.sync === true;

/** The side lights take a poster's accent, or go back when null; nothing without a grant. */
export const syncSideLights = (rgb: readonly [number, number, number] | null): void => sideLights()?.syncMood(rgb);

// The app leaves the screen (Back to Nest, another app): the side lights go back to how they were.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") syncSideLights(null);
  });
}
