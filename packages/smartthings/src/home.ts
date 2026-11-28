// What Nest does with the devices: notices worth a toast between two polls, and prompts that name a device or scene
// ("turn off the couch light", "run energetic lights", "start the vacuum"), matched here so they need neither the
// server nor Gemini.
import { lightCommands, pictureModeCommands, type StCommand, type StDevice, type StScene, vacuumCommands } from "./api.ts";

export interface HomeAlert {
  deviceId: string;
  text: string;
}

const CLEANING = new Set(["cleaning", "point", "after"]);

/** What changed between two polls that someone on the couch wants to know. */
export function homeAlerts(prev: readonly StDevice[], next: readonly StDevice[]): HomeAlert[] {
  const before = new Map(prev.map((d) => [d.id, d]));
  const out: HomeAlert[] = [];
  for (const d of next) {
    const was = before.get(d.id);
    if (!was) continue;
    if (d.kind === "phone" && was.present !== undefined && d.present !== undefined && was.present !== d.present) {
      out.push({ deviceId: d.id, text: d.present ? `🏠 ${d.name} is home` : `🚪 ${d.name} left` });
    }
    if (d.kind === "vacuum" && was.vacuum && d.vacuum && was.vacuum !== d.vacuum) {
      if (d.vacuum === "alarm") out.push({ deviceId: d.id, text: `⚠️ ${d.name} needs help` });
      else if (CLEANING.has(d.vacuum) && !CLEANING.has(was.vacuum)) out.push({ deviceId: d.id, text: `🧹 ${d.name} started cleaning` });
      else if (d.vacuum === "charging" && (CLEANING.has(was.vacuum) || was.vacuum === "homing")) {
        out.push({ deviceId: d.id, text: `✅ ${d.name} finished and is charging` });
      }
    }
  }
  return out;
}

/** The room's light from the TV's sensor, for Daylight: null without a reading. */
export function roomLux(devices: readonly StDevice[]): number | null {
  const s = devices.find((d) => d.kind === "lightSensor" && typeof d.lux === "number");
  return s?.lux ?? null;
}

/**
 * Lights that no mode, scene or "all the lights" prompt touches: matched by a fragment of their name, the way the
 * by-name prompts are. Naming one ("turn off the computer desk") still works. The default is the reference home's desk.
 */
export const INDEPENDENT_DEFAULT: readonly string[] = ["computer desk"];

export function isIndependent(d: StDevice, fragments: readonly string[] = INDEPENDENT_DEFAULT): boolean {
  const n = norm(d.name);
  return fragments.some((f) => norm(f).trim() !== "" && n.includes(norm(f)));
}

/** Every light a mode is allowed to switch. */
export const sharedLights = (devices: readonly StDevice[], independent: readonly string[] = INDEPENDENT_DEFAULT): StDevice[] =>
  devices.filter((d) => d.kind === "light" && !isIndependent(d, independent));

/** The TV that reports a picture mode, if any. */
export const pictureTv = (devices: readonly StDevice[]): StDevice | undefined => devices.find((d) => d.kind === "tv" && d.pictureMode);

/** The TV device for sound-output routing (preferring one that reports `soundFrom`). */
export const soundTv = (devices: readonly StDevice[]): StDevice | undefined =>
  devices.find((d) => d.kind === "tv" && d.soundFrom) ?? devices.find((d) => d.kind === "tv");

/** True when the TV's reported sound output is a Bluetooth device rather than TV/HDMI/optical speakers. */
export const isBluetoothSound = (soundFrom: string | undefined): boolean =>
  /\b(?:bluetooth|bt|headset|earbuds?|jabra|speakerphone|hands[- ]?free)\b/i.test(soundFrom ?? "");

/**
 * A SmartThings routine that switches the TV's sound output ("TV Speaker" / "TV Sound" for movies, or "Bluetooth Speaker"
 * / "AI Speaker" to restore Bluetooth when a TV disconnects Bluetooth on TV Speaker).
 */
export function soundOutputScene(target: "tv" | "bluetooth", scenes: readonly StScene[]): StScene | undefined {
  return scenes.find((s) => {
    const n = norm(s.name);
    if (target === "tv") {
      return !/ bluetooth | bt | ai /.test(n) && (/ tv (?:speaker|speakers|sound|audio) /.test(n) || / (?:speaker|sound|audio) tv /.test(n) || / soundbar /.test(n));
    }
    return / (?:bluetooth|bt|ai) (?:speaker|speakers|sound|audio) /.test(n) || / (?:speaker|sound|audio) (?:bluetooth|bt) /.test(n);
  });
}

const modeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A spoken or saved mode as the name this TV uses ("echo" and "eco" both find "Eco"); capitalised as given when unlisted. */
export function resolvePictureMode(want: string, supported: readonly string[] = []): string {
  const k = modeKey(want) === "echo" ? "eco" : modeKey(want);
  const hit = supported.find((m) => modeKey(m) === k) ?? supported.find((m) => modeKey(m).startsWith(k));
  const word = k === "eco" ? "eco" : want;
  return hit ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The scene that sets a picture mode: one named after the mode and the TV ("TV Eco", "Picture Dynamic"). The TV here
 * ignores the picture-mode command from the cloud API but obeys a scene, which runs the SmartThings app's own action.
 */
export function pictureScene(mode: string, scenes: readonly StScene[]): StScene | undefined {
  const m = norm(mode);
  return scenes.find((s) => {
    const n = norm(s.name);
    return n.includes(m) && / (?:tv|picture|screen) /.test(n);
  });
}

/** The other of two favourite modes: the first unless the TV is on it already, then the second. */
export function nextPictureMode(current: string | undefined, pair: readonly [string, string], supported: readonly string[] = []): string {
  const [a, b] = pair.map((m) => resolvePictureMode(m, supported));
  return current !== undefined && modeKey(current) === modeKey(a) ? b : a;
}

/** `picture` is set when the action switches the TV's picture mode, so the caller can remember it. */
export type HomeAction =
  | { kind: "scene"; scene: StScene; reply: string; picture?: string }
  | { kind: "devices"; targets: { device: StDevice; commands: StCommand[] }[]; reply: string; picture?: string };

export const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9% ]+/g, " ")
    .replace(/\b(the|a|an|my|please|all)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

/** The longest name found whole in the prompt. */
function longest<T>(items: readonly T[], name: (x: T) => string, text: string): T | undefined {
  let best: T | undefined;
  let size = 0;
  for (const x of items) {
    const n = norm(name(x));
    if (n.trim().length >= 3 && text.includes(n) && n.length > size) {
      best = x;
      size = n.length;
    }
  }
  return best;
}

/** On, off or a level from the words around a light's name; null when the prompt says neither. */
function lightIntent(text: string): { on: boolean; level?: number } | null {
  const pct = text.match(/ (\d{1,3}) ?(?:%|percent )/);
  if (pct) {
    const level = Math.min(100, Number(pct[1]));
    return level === 0 ? { on: false } : { on: true, level };
  }
  if (/ (?:off|out) | (?:switch|turn|shut) off /.test(text)) return { on: false };
  if (/ dim /.test(text)) return { on: true, level: 30 };
  if (/ (?:full|brighten|brightest|max) /.test(text)) return { on: true, level: 100 };
  if (/ on | (?:switch|turn) on /.test(text)) return { on: true };
  return null;
}

/**
 * A prompt that names a scene, a light (or "lights") or the vacuum, as an action; null for anything else, which then
 * goes to the assistant as before.
 */
export function homeAction(
  prompt: string,
  devices: readonly StDevice[],
  scenes: readonly StScene[],
  independent: readonly string[] = INDEPENDENT_DEFAULT,
): HomeAction | null {
  const text = norm(prompt);
  const lights = devices.filter((d) => d.kind === "light");

  // A scene named in full wins: "couch light turn off" is a scene here, not the couch light.
  const scene = longest(scenes, (s) => s.name, text);
  const light = longest(lights, (d) => d.name, text);
  if (scene && (!light || norm(scene.name).length >= norm(light.name).length)) {
    return { kind: "scene", scene, reply: `Running “${scene.name}”.` };
  }

  if (/ (?:vacuum|hoover|robot|powerbot) /.test(text)) {
    const vac = devices.find((d) => d.kind === "vacuum");
    if (vac) {
      const start = !/ (?:stop|dock|home|back|pause) /.test(text);
      return {
        kind: "devices",
        targets: [{ device: vac, commands: vacuumCommands(start) }],
        reply: start ? `Sending ${vac.name} to clean.` : `Sending ${vac.name} back to its dock.`,
      };
    }
  }

  // The sound system by name: "turn on the sound system", "music off", "stop the music". "Music mode" is the assistant's.
  const sound = devices.find((d) => d.kind === "audio");
  if (sound && / (?:sound|soundbar|speakers?|stereo|hifi|audio|music) /.test(text)) {
    const off = / (?:off|stop|quiet|silence) /.test(text);
    const on = !off && !/ mode /.test(text) && / (?:switch|turn) on | on /.test(text);
    if (off || on) {
      return {
        kind: "devices",
        targets: [{ device: sound, commands: lightCommands(on) }],
        reply: on ? `Turning on ${sound.name}.` : `Turning off ${sound.name}.`,
      };
    }
  }

  // "switch to eco mode", "dynamic picture", "picture mode standard".
  const picked = text.match(/ (dynamic|eco|echo|standard|natural) /);
  if (picked && / (?:picture|screen|mode|tv) /.test(text)) {
    const tv = pictureTv(devices);
    const mode = resolvePictureMode(picked[1], tv?.pictureModes);
    const modeScene = pictureScene(mode, scenes);
    if (modeScene) return { kind: "scene", scene: modeScene, reply: `Switching the picture to ${mode}.`, picture: mode };
    if (tv) {
      return {
        kind: "devices",
        targets: [{ device: tv, commands: pictureModeCommands(mode, tv.pictureCap) }],
        reply: `Switching the picture to ${mode}.`,
        picture: mode,
      };
    }
  }

  const intent = lightIntent(text);
  if (!intent) return null;
  const say = (what: string) =>
    intent.on ? (intent.level !== undefined ? `${what} to ${intent.level}%.` : `Turning on ${what}.`) : `Turning off ${what}.`;
  if (light) {
    return {
      kind: "devices",
      targets: [{ device: light, commands: lightCommands(intent.on, light.dimmable ? intent.level : undefined) }],
      reply: intent.on && intent.level !== undefined ? `Setting ${light.name} ${say("").trim()}` : say(light.name),
    };
  }
  // "The lights" are the shared ones: an independent light (the computer desk) only answers to its own name.
  const shared = sharedLights(devices, independent);
  if (/ (?:lights|lamps|everything) /.test(text) && shared.length) {
    return {
      kind: "devices",
      targets: shared.map((d) => ({ device: d, commands: lightCommands(intent.on, d.dimmable ? intent.level : undefined) })),
      reply: intent.on && intent.level !== undefined ? `Setting the lights ${say("").trim()}` : say("the lights"),
    };
  }
  return null;
}
