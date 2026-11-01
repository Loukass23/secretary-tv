// Weather from Open-Meteo (no key, CORS open): the server's /weather and Nest on the TV both use it.

export type WeatherPlace = { lat: number; lon: number; name?: string } | { city: string };

/** One line icon per kind of sky; Nest draws them as masks, so they follow the theme. */
export type WeatherGlyph = "clear" | "clear-night" | "partly" | "partly-night" | "cloud" | "fog" | "rain" | "snow" | "storm";

export interface WeatherHour {
  /** Local hour, "21". */
  hour: string;
  tempC: number;
  glyph: WeatherGlyph;
}

export interface WeatherDay {
  /** Local date, "2026-11-02". */
  date: string;
  minC: number;
  maxC: number;
  glyph: WeatherGlyph;
}

export interface Weather {
  tempC: number;
  /** A short description ("Partly cloudy") and an emoji for it. */
  label: string;
  icon: string;
  glyph?: WeatherGlyph;
  place?: string;
  /** The next 6 hours and today plus 3 days, when the forecast had them. */
  hours?: WeatherHour[];
  days?: WeatherDay[];
}

/** WMO weather codes as Open-Meteo reports them. */
export function describeWeather(code: number, isDay: boolean): { label: string; icon: string } {
  if (code === 0) return { label: "Clear", icon: isDay ? "☀️" : "🌙" };
  if (code <= 2) return { label: "Partly cloudy", icon: isDay ? "⛅" : "☁️" };
  if (code === 3) return { label: "Cloudy", icon: "☁️" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "🌦️" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "🌨️" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "🌦️" };
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "🌨️" };
  if (code >= 95) return { label: "Thunderstorm", icon: "⛈️" };
  return { label: "Mixed", icon: "🌤️" };
}

export function weatherGlyph(code: number, isDay: boolean): WeatherGlyph {
  if (code === 0) return isDay ? "clear" : "clear-night";
  if (code <= 2) return isDay ? "partly" : "partly-night";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "cloud";
}

/** Reads WEATHER_LAT / WEATHER_LON or WEATHER_CITY; undefined when neither is set. */
export function weatherPlaceFromEnv(env: Record<string, string | undefined>): WeatherPlace | undefined {
  const lat = Number(env.WEATHER_LAT);
  const lon = Number(env.WEATHER_LON);
  if (env.WEATHER_LAT && env.WEATHER_LON && Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  const city = env.WEATHER_CITY?.trim();
  return city ? { city } : undefined;
}

/** A city's coordinates, or null when Open-Meteo knows no such place. */
export async function geocode(city: string, f: typeof fetch = fetch): Promise<{ lat: number; lon: number; name: string } | null> {
  const g = await f(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`);
  const hit = ((await g.json()) as { results?: { latitude: number; longitude: number; name: string }[] }).results?.[0];
  return hit ? { lat: hit.latitude, lon: hit.longitude, name: hit.name } : null;
}

interface RawForecast {
  current?: { temperature_2m: number; weather_code: number; is_day: number };
  hourly?: { time: string[]; temperature_2m: number[]; weather_code: number[]; is_day: number[] };
  daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
}

/** Now, the next 6 hours and 4 days, in the place's own time zone; null when the forecast is down. */
export async function fetchForecast(at: { lat: number; lon: number; name?: string }, f: typeof fetch = fetch): Promise<Weather | null> {
  try {
    const res = await f(
      `https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lon}` +
        "&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4&forecast_hours=7",
    );
    if (!res.ok) return null;
    return parseForecast((await res.json()) as RawForecast, at.name);
  } catch {
    return null;
  }
}

export function parseForecast({ current, hourly, daily }: RawForecast, place?: string): Weather | null {
  if (!current) return null;
  const isDay = current.is_day !== 0;
  const out: Weather = {
    tempC: Math.round(current.temperature_2m),
    ...describeWeather(current.weather_code, isDay),
    glyph: weatherGlyph(current.weather_code, isDay),
    ...(place ? { place } : {}),
  };
  // The first hour is the one under way; "next 6" starts after it.
  if (hourly?.time?.length) {
    out.hours = hourly.time.slice(1, 7).map((t, k) => ({
      hour: t.slice(11, 13),
      tempC: Math.round(hourly.temperature_2m[k + 1]),
      glyph: weatherGlyph(hourly.weather_code[k + 1], hourly.is_day[k + 1] !== 0),
    }));
  }
  if (daily?.time?.length) {
    out.days = daily.time.map((date, k) => ({
      date,
      minC: Math.round(daily.temperature_2m_min[k]),
      maxC: Math.round(daily.temperature_2m_max[k]),
      glyph: weatherGlyph(daily.weather_code[k], true),
    }));
  }
  return out;
}

let geocoded: { city: string; lat: number; lon: number; name: string } | null = null;

/** The forecast for a place from the environment; a city is looked up once. */
export async function fetchWeather(place: WeatherPlace, f: typeof fetch = fetch): Promise<Weather | null> {
  try {
    if (!("city" in place)) return await fetchForecast(place, f);
    if (geocoded?.city !== place.city) {
      const hit = await geocode(place.city, f);
      if (!hit) return null;
      geocoded = { city: place.city, ...hit };
    }
    return await fetchForecast(geocoded, f);
  } catch {
    return null;
  }
}
