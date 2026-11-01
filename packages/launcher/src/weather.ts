// Weather on Nest without the server (docs/launcher.md, "Weather"): Open-Meteo straight from the TV, for the
// SmartThings home's coordinates, else the build's WEATHER_LAT/LON or WEATHER_CITY. The place and the last forecast
// are kept on the TV, so the header has weather from the first frame after a restart.
import { fetchForecast, geocode, type Weather, type WeatherGlyph, weatherPlaceFromEnv } from "@secretary/assistant";
import type { StLocation } from "@secretary/smartthings";
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
  if (cached && (cached.from === "env" || now - cached.at < PLACE_TTL_MS)) return cached;
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
    if (!at) return cached;
    const p: Place = { lat: at.lat, lon: at.lon, ...(at.name ? { name: at.name } : {}), from: "env", at: now };
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

// --- line icons, one colour: drawn as masks so they take the theme's ink ---

const STROKE = 'fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
const MOON = '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>';
const CLOUD = '<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 18.5z"/>';
const SMALL_SUN = '<circle cx="8" cy="8" r="3"/><path d="M8 1.8v1.4M1.8 8h1.4M3.6 3.6l1 1M12.4 3.6l-1 1"/>';
const SMALL_MOON = '<path d="M11 9.6A4.6 4.6 0 1 1 6.4 3.5a3.6 3.6 0 0 0 4.6 6.1z"/>';
const HIGH_CLOUD = '<path d="M9 19.5h9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1A3.1 3.1 0 0 0 9 19.5z"/>';
const RAIN_CLOUD = '<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 14.5z"/>';

const GLYPHS: Record<WeatherGlyph, string> = {
  clear: SUN,
  "clear-night": MOON,
  partly: SMALL_SUN + HIGH_CLOUD,
  "partly-night": SMALL_MOON + HIGH_CLOUD,
  cloud: CLOUD,
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
  rain: RAIN_CLOUD + '<path d="M9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5"/>',
  snow: RAIN_CLOUD + '<path d="M9 18.5h.01M13 20h.01M17 18.5h.01M11 21.5h.01M15 21.5h.01"/>',
  storm: RAIN_CLOUD + '<path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>',
};

const MASKS = new Map<WeatherGlyph, string>();

/** The glyph as a CSS mask image (`-webkit-mask-image`), made once per glyph. */
export function glyphMask(g: WeatherGlyph): string {
  let m = MASKS.get(g);
  if (!m) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${STROKE}>${GLYPHS[g]}</svg>`;
    m = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    MASKS.set(g, m);
  }
  return m;
}
