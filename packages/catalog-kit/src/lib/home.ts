// Movie lights (docs/smartthings.md): the scenes Nest's lights panel picked, run straight on SmartThings with the
// access token Nest put in the launch payload. Without one (an old token, a build without SmartThings) the server's
// "cinema" preset dims instead, as before.
import type { HomeGrant } from "@secretary/nuvio";
import { smartThings, staticToken } from "@secretary/smartthings";
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
