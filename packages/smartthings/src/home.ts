// What Nest does with the devices: notices worth a toast between two polls, and prompts that name a device or scene
// ("turn off the couch light", "run energetic lights", "start the vacuum"), matched here so they need neither the
// server nor Gemini.
import { lightCommands, type StCommand, type StDevice, type StScene, vacuumCommands } from "./api.ts";

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

export type HomeAction =
  | { kind: "scene"; scene: StScene; reply: string }
  | { kind: "devices"; targets: { device: StDevice; commands: StCommand[] }[]; reply: string };

const norm = (s: string) =>
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
export function homeAction(prompt: string, devices: readonly StDevice[], scenes: readonly StScene[]): HomeAction | null {
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
  if (/ (?:lights|lamps|everything) /.test(text) && lights.length) {
    return {
      kind: "devices",
      targets: lights.map((d) => ({ device: d, commands: lightCommands(intent.on, d.dimmable ? intent.level : undefined) })),
      reply: intent.on && intent.level !== undefined ? `Setting the lights ${say("").trim()}` : say("the lights"),
    };
  }
  return null;
}
