// Weather on Nest without the server (docs/launcher.md, "Weather"): Open-Meteo straight from the TV, for the
// SmartThings home's coordinates, else the build's WEATHER_LAT/LON or WEATHER_CITY. The place and the last forecast
// are kept on the TV, so the header has weather from the first frame after a restart.
import { fetchForecast, geocode, type Weather, type WeatherGlyph, weatherPlaceFromEnv } from "@secretary/assistant";
import type { StLocation } from "@secretary/smartthings";
import { iconMask } from "@secretary/tv-kit/src/glass/icons.ts";
import type { KeyValue } from "./brain.ts";

const PLACE_KEY = "nest.place";
const WEATHER_KEY = "nest.weather";
/** A SmartThings home rarely moves; look again once a day. */
const PLACE_TTL_MS = 24 * 60 * 60_000;
/** An older forecast is not shown at start: better no weather than yesterday's. */
const STALE_MS = 3 * 60 * 60_000;

export interface Place {
  lat: number;
  lon: number;
  name?: string;
  from: "smartthings" | "env";
  at: number;
}

export interface PlaceDeps {
  store: KeyValue;
  /** The SmartThings locations, when this TV has SmartThings. */
  locations?: () => Promise<StLocation[]>;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: number;
}

const read = <T>(store: KeyValue, key: string): T | null => {
  try {
    return JSON.parse(store.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
};

const write = (store: KeyValue, key: string, v: unknown) => {
  try {
    store.setItem(key, JSON.stringify(v));
  } catch {
    // Looked up again next time.
  }
};

/** Where the weather is for: the SmartThings home first, then the build's place; null when neither is known. */
export async function findPlace({ store, locations, env, fetch: f = fetch, now = Date.now() }: PlaceDeps): Promise<Place | null> {
  const cached = read<Place>(store, PLACE_KEY);
  // A place from the build is kept until the build names a different one (an older TV kept it without its name).
  const envName = env.WEATHER_CITY?.trim() || undefined;
  if (cached && ((cached.from === "env" && cached.name === envName) || (cached.from !== "env" && now - cached.at < PLACE_TTL_MS))) return cached;
  if (locations) {
    try {
      const home = (await locations()).find((l) => typeof l.lat === "number" && typeof l.lon === "number");
      if (home) {
        const p: Place = { lat: home.lat!, lon: home.lon!, ...(home.name ? { name: home.name } : {}), from: "smartthings", at: now };
        write(store, PLACE_KEY, p);
        return p;
      }
    } catch {
      // SmartThings is down or signed out: the build's place, or yesterday's home.
      if (cached) return cached;
    }
  }
  const fromEnv = weatherPlaceFromEnv(env);
  if (!fromEnv) return cached;
  try {
    const at = "city" in fromEnv ? await geocode(fromEnv.city, f) : fromEnv;
    // The name the build gave wins over the geocoder's spelling.
    if (!at) return cached;
    const name = envName ?? at.name;
    const p: Place = { lat: at.lat, lon: at.lon, ...(name ? { name } : {}), from: "env", at: now };
    write(store, PLACE_KEY, p);
    return p;
  } catch {
    return cached;
  }
}

/** The last forecast kept on the TV, when it is recent enough to show. */
export function cachedWeather(store: KeyValue, now = Date.now()): Weather | null {
  const c = read<{ at: number; w: Weather }>(store, WEATHER_KEY);
  return c && now - c.at < STALE_MS ? c.w : null;
}

/** A fresh forecast, kept for the next start; null leaves what is shown alone. */
export async function refreshWeather(deps: PlaceDeps): Promise<Weather | null> {
  const place = await findPlace(deps);
  if (!place) return null;
  const w = await fetchForecast(place, deps.fetch);
  if (w) write(deps.store, WEATHER_KEY, { at: deps.now ?? Date.now(), w });
  return w;
}

// --- the weather glyphs are tv-kit's line icons (glass/icons.ts), named as the forecast names them ---

/** The glyph as a CSS mask image (`-webkit-mask-image`), made once per glyph. */
export function glyphMask(g: WeatherGlyph): string {
  return iconMask(g);
}
