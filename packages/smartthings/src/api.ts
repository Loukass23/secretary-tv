// The SmartThings REST API, as much as Secretary TV uses: devices with their status in one call, commands, scenes
// (the app calls them routines), locations and their rooms. Lists come in pages; every page is read.
// The TV calls it directly (packaged apps apply no CORS). The device list allows 10 calls per ~15 s per token, so
// pollers stay at one call per 15 s.
import { ST_API, type TokenSource } from "./oauth.ts";

export type DeviceKind = "light" | "vacuum" | "phone" | "tv" | "lightSensor" | "audio" | "other";

/** A plain on/off device named like this is a sound system (a smart plug on the amplifier), not a light. */
const AUDIO_NAME = /\b(?:sound|audio|speakers?|soundbar|stereo|hi-?fi|subwoofer)\b/i;

export interface StDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  locationId?: string;
  roomId?: string;
  /** Runs on the hub (the TV's built-in hub for Matter), not cloud to cloud. */
  local: boolean;
  dimmable: boolean;
  on?: boolean;
  /** 0-100. */
  level?: number;
  present?: boolean;
  /** The vacuum's movement: cleaning, homing, charging, idle, pause, alarm, … */
  vacuum?: string;
  /** Lux, from the TV's light sensor. */
  lux?: number;
  /** The TV's picture mode (Dynamic, Standard, Eco, …) and the modes it offers, when it exposes them. */
  pictureMode?: string;
  pictureModes?: string[];
  /** The capability that carries it, which a command has to name. */
  pictureCap?: string;

  /** The TV's active sound output ("TV Speaker", "Bluetooth", …), when SmartThings reports it. */
  soundFrom?: string;
  soundFromMode?: number;

  /** When SmartThings last saw the picture mode change (epoch ms). It never moves on the reference TV (docs/smartthings.md). */
  pictureAt?: number;

  /** Takes colour or colour temperature commands. */
  colour?: boolean;
  /** Colour as the light reports it (0-100 each), and its white temperature in kelvin. */
  hue?: number;
  saturation?: number;
  colorTemp?: number;
}

/** The capabilities a Samsung TV has shown its picture mode under, in the order tried. */
export const PICTURE_CAPS = ["custom.picturemode", "samsungvd.pictureMode"] as const;

export interface StScene {
  id: string;
  name: string;
  locationId?: string;
  /** Epoch ms of its last run, when SmartThings reports one. */
  lastRun?: number;
}

/** A room in a SmartThings location. */
export interface StRoom {
  id: string;
  name: string;
  locationId: string;
}

/** A list endpoint's answer: its items and, when there are more, the link to the next page. */
interface Page<T> {
  items?: T[];
  _links?: { next?: { href?: string } | null };
}

/** Pages read at most per list, so a link that loops cannot keep the TV asking. */
const MAX_PAGES = 20;

/** A SmartThings location (a home); the coordinates are what the owner set in the app, when they did. */
export interface StLocation {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
}

export interface StCommand {
  capability: string;
  command: string;
  arguments?: unknown[];
  component?: string;
}

interface RawCapability {
  id?: string;
  status?: Record<string, { value?: unknown; timestamp?: string }>;
}

export interface RawDevice {
  deviceId?: string;
  label?: string;
  name?: string;
  type?: string;
  locationId?: string;
  roomId?: string;
  executionContext?: string;
  ocf?: { ocfDeviceType?: string };
  components?: { id?: string; capabilities?: RawCapability[] }[];
}

export class StApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One device as Secretary TV sees it, from a `GET /devices?includeStatus=true` item; null for hubs. */
export function toDevice(raw: RawDevice): StDevice | null {
  if (!raw.deviceId || raw.type === "HUB") return null;
  const main = raw.components?.find((c) => c.id === "main") ?? raw.components?.[0];
  const caps = new Map((main?.capabilities ?? []).map((c) => [c.id ?? "", c.status ?? {}]));
  const value = (cap: string, attr: string) => caps.get(cap)?.[attr]?.value;
  const ocf = raw.ocf?.ocfDeviceType ?? "";
  const label = (raw.label || raw.name || raw.deviceId).trim();
  const kind: DeviceKind =
    raw.type === "MOBILE" || caps.has("presenceSensor")
      ? "phone"
      : ocf === "oic.d.robotcleaner"
        ? "vacuum"
        : ocf === "oic.d.tv"
          ? "tv"
          : caps.has("illuminanceMeasurement")
            ? "lightSensor"
            : caps.has("switch") && AUDIO_NAME.test(label)
              ? "audio"
              : caps.has("switch")
                ? "light"
                : "other";
  const d: StDevice = {
    id: raw.deviceId,
    name: label,
    kind,
    local: raw.executionContext === "LOCAL" || raw.type === "MATTER" || raw.type === "ZIGBEE" || raw.type === "ZWAVE",
    dimmable: caps.has("switchLevel"),
  };
  if (raw.locationId) d.locationId = raw.locationId;
  if (raw.roomId) d.roomId = raw.roomId;
  const sw = value("switch", "switch");
  if (sw === "on" || sw === "off") d.on = sw === "on";
  const level = value("switchLevel", "level");
  if (typeof level === "number") d.level = level;
  const presence = value("presenceSensor", "presence");
  if (typeof presence === "string") d.present = presence === "present";
  const move = value("robotCleanerMovement", "robotCleanerMovement");
  if (typeof move === "string") d.vacuum = move;
  const lux = value("illuminanceMeasurement", "illuminance");
  if (typeof lux === "number") d.lux = lux;
  if (caps.has("colorControl") || caps.has("colorTemperature")) {
    d.colour = true;
    const hue = value("colorControl", "hue");
    const sat = value("colorControl", "saturation");
    const temp = value("colorTemperature", "colorTemperature");
    if (typeof hue === "number") d.hue = hue;
    if (typeof sat === "number") d.saturation = sat;
    if (typeof temp === "number") d.colorTemp = temp;
  }
  const soundDetail = value("samsungvd.soundFrom", "detailName") ?? value("audioOutputSource", "audioOutputSource");
  const soundMode = value("samsungvd.soundFrom", "mode");
  if (typeof soundDetail === "string" && soundDetail.trim()) d.soundFrom = soundDetail.trim();
  if (typeof soundMode === "number") d.soundFromMode = soundMode;
  for (const cap of PICTURE_CAPS) {
    const mode = value(cap, "pictureMode");
    if (typeof mode !== "string") continue;
    d.pictureMode = mode;
    d.pictureCap = cap;
    const at = Date.parse(caps.get(cap)?.pictureMode?.timestamp ?? "");
    if (Number.isFinite(at)) d.pictureAt = at;
    const modes = value(cap, "supportedPictureModes");
    if (Array.isArray(modes)) d.pictureModes = modes.filter((m): m is string => typeof m === "string");
    break;
  }
  return d;
}

export interface SmartThingsOptions {
  token: TokenSource;
  fetch?: typeof fetch;
  base?: string;
}

export function smartThings({ token, fetch: f = fetch, base = ST_API }: SmartThingsOptions) {
  async function call<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const t = await token(retried);
    if (!t) throw new StApiError(401, "SmartThings is not set up");
    const res = await f(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${t}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    });
    // A token revoked or expired early: refresh once and try again.
    if (res.status === 401 && !retried) return call<T>(path, init, true);
    if (!res.ok) throw new StApiError(res.status, `SmartThings ${path.split("?")[0]}: ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Every item of a list, following `_links.next` (an absolute link, on the same API) page by page. */
  async function list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let n = 0; next && n < MAX_PAGES; n++) {
      const body: Page<T> = await call<Page<T>>(next);
      out.push(...(body.items ?? []));
      const href = body._links?.next?.href;
      next = href ? (href.startsWith(base) ? href.slice(base.length) : href.startsWith("/") ? href : undefined) : undefined;
    }
    return out;
  }

  async function roomsOf(locationId: string): Promise<StRoom[]> {
    const items = await list<{ roomId?: string; name?: string; locationId?: string }>(`/locations/${encodeURIComponent(locationId)}/rooms`);
    return items.filter((r) => r.roomId).map((r) => ({ id: r.roomId!, name: (r.name ?? "").trim(), locationId: r.locationId ?? locationId }));
  }

  return {
    /** Every device with its current status, one call (more only for a home of over a page of devices). */
    async devices(): Promise<StDevice[]> {
      const items = await list<RawDevice>("/devices?includeStatus=true");
      return items.map(toDevice).filter((d): d is StDevice => d !== null);
    },
    command(deviceId: string, commands: readonly StCommand[]): Promise<unknown> {
      return call(`/devices/${encodeURIComponent(deviceId)}/commands`, {
        method: "POST",
        body: JSON.stringify({ commands: commands.map((c) => ({ component: "main", arguments: [], ...c })) }),
      });
    },
    /** The scenes, which the SmartThings app shows as manual routines: the ones OK can run. */
    async scenes(): Promise<StScene[]> {
      const items = await list<{ sceneId?: string; sceneName?: string; locationId?: string; lastExecutedDate?: number | string }>("/scenes");
      return items
        .filter((s) => s.sceneId)
        .map((s) => {
          const last = typeof s.lastExecutedDate === "number" ? s.lastExecutedDate : s.lastExecutedDate ? Date.parse(s.lastExecutedDate) : Number.NaN;
          return {
            id: s.sceneId!,
            name: (s.sceneName ?? "").trim(),
            ...(s.locationId ? { locationId: s.locationId } : {}),
            ...(Number.isFinite(last) && last > 0 ? { lastRun: last } : {}),
          };
        });
    },
    runScene(sceneId: string): Promise<unknown> {
      return call(`/scenes/${encodeURIComponent(sceneId)}/execute`, { method: "POST" });
    },
    /** The account's locations with their coordinates (the list has none, so each is read once more). */
    async locations(): Promise<StLocation[]> {
      const items = await list<{ locationId?: string; name?: string }>("/locations");
      const ids = items.filter((l) => l.locationId).map((l) => l.locationId!);
      const out = await Promise.all(
        ids.map((id) => call<{ locationId?: string; name?: string; latitude?: number; longitude?: number }>(`/locations/${encodeURIComponent(id)}`)),
      );
      return out.map((l, k) => ({
        id: l.locationId ?? ids[k],
        name: (l.name ?? "").trim(),
        ...(typeof l.latitude === "number" && typeof l.longitude === "number" ? { lat: l.latitude, lon: l.longitude } : {}),
      }));
    },
    /** Room names by id for a location. */
    async rooms(locationId: string): Promise<Record<string, string>> {
      return Object.fromEntries((await roomsOf(locationId)).map((r) => [r.id, r.name]));
    },
    /** The rooms of every location given (a device's `locationId`s, say), one call per location. */
    async roomsIn(locationIds: Iterable<string>): Promise<StRoom[]> {
      const ids = [...new Set(locationIds)].filter(Boolean);
      return (await Promise.all(ids.map(roomsOf))).flat();
    },
  };
}

export type SmartThings = ReturnType<typeof smartThings>;

/** The commands that switch a light, and set its level when it has one. */
export function lightCommands(on: boolean, level?: number): StCommand[] {
  const out: StCommand[] = [{ capability: "switch", command: on ? "on" : "off" }];
  if (on && typeof level === "number") {
    out.push({ capability: "switchLevel", command: "setLevel", arguments: [Math.max(1, Math.min(100, Math.round(level)))] });
  }
  return out;
}

/** A colour (hue and saturation, 0-100 each). */
export const colorCommands = (hue: number, saturation: number): StCommand[] => [
  { capability: "colorControl", command: "setColor", arguments: [{ hue: Math.round(hue), saturation: Math.round(saturation) }] },
];

/** A white, in kelvin. */
export const whiteCommands = (kelvin: number): StCommand[] => [
  { capability: "colorTemperature", command: "setColorTemperature", arguments: [Math.round(kelvin)] },
];

/** Set the TV's picture mode, on the capability it reported (custom.picturemode when unknown). */
export const pictureModeCommands = (mode: string, cap: string = PICTURE_CAPS[0]): StCommand[] => [
  { capability: cap, command: "setPictureMode", arguments: [mode] },
];

/** Ask the TV to route its own media sound to TV speakers (mode 0 on Samsung Tizen TVs). */
export const tvSoundCommands = (mode = 0, detailName = "TV Speaker"): StCommand[] => [
  { capability: "samsungvd.soundFrom", command: "setSoundFrom", arguments: [mode, detailName] },
];

/** Start cleaning (auto mode), or send the vacuum back to its dock. */
export const vacuumCommands = (start: boolean): StCommand[] =>
  start
    ? [
        { capability: "robotCleanerCleaningMode", command: "setRobotCleanerCleaningMode", arguments: ["auto"] },
        { capability: "robotCleanerMovement", command: "setRobotCleanerMovement", arguments: ["cleaning"] },
      ]
    : [{ capability: "robotCleanerMovement", command: "setRobotCleanerMovement", arguments: ["homing"] }];
