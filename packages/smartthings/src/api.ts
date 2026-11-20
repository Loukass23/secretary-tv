// The SmartThings REST API, as much as Secretary TV uses: devices with their status in one call, commands, scenes.
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
}

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
  status?: Record<string, { value?: unknown }>;
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
  for (const cap of PICTURE_CAPS) {
    const mode = value(cap, "pictureMode");
    if (typeof mode !== "string") continue;
    d.pictureMode = mode;
    d.pictureCap = cap;
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

  return {
    /** Every device with its current status, one call. */
    async devices(): Promise<StDevice[]> {
      const body = await call<{ items?: RawDevice[] }>("/devices?includeStatus=true");
      return (body.items ?? []).map(toDevice).filter((d): d is StDevice => d !== null);
    },
    command(deviceId: string, commands: readonly StCommand[]): Promise<unknown> {
      return call(`/devices/${encodeURIComponent(deviceId)}/commands`, {
        method: "POST",
        body: JSON.stringify({ commands: commands.map((c) => ({ component: "main", arguments: [], ...c })) }),
      });
    },
    async scenes(): Promise<StScene[]> {
      const body = await call<{ items?: { sceneId?: string; sceneName?: string; locationId?: string }[] }>("/scenes");
      return (body.items ?? [])
        .filter((s) => s.sceneId)
        .map((s) => ({ id: s.sceneId!, name: (s.sceneName ?? "").trim(), ...(s.locationId ? { locationId: s.locationId } : {}) }));
    },
    runScene(sceneId: string): Promise<unknown> {
      return call(`/scenes/${encodeURIComponent(sceneId)}/execute`, { method: "POST" });
    },
    /** The account's locations with their coordinates (the list has none, so each is read once more). */
    async locations(): Promise<StLocation[]> {
      const body = await call<{ items?: { locationId?: string; name?: string }[] }>("/locations");
      const ids = (body.items ?? []).filter((l) => l.locationId).map((l) => l.locationId!);
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
      const body = await call<{ items?: { roomId?: string; name?: string }[] }>(`/locations/${encodeURIComponent(locationId)}/rooms`);
      return Object.fromEntries((body.items ?? []).filter((r) => r.roomId).map((r) => [r.roomId!, r.name ?? ""]));
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

/** Start cleaning (auto mode), or send the vacuum back to its dock. */
export const vacuumCommands = (start: boolean): StCommand[] =>
  start
    ? [
        { capability: "robotCleanerCleaningMode", command: "setRobotCleanerCleaningMode", arguments: ["auto"] },
        { capability: "robotCleanerMovement", command: "setRobotCleanerMovement", arguments: ["cleaning"] },
      ]
    : [{ capability: "robotCleanerMovement", command: "setRobotCleanerMovement", arguments: ["homing"] }];
