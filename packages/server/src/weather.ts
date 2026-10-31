// Current weather for Nest's header, from Open-Meteo (no key). The place comes from the server's
// environment (WEATHER_LAT / WEATHER_LON, or WEATHER_CITY looked up once); the TV never sends one.

export type WeatherPlace = { lat: number; lon: number; name?: string } | { city: string };

export interface Weather {
  tempC: number;
  /** A short description ("Partly cloudy") and an emoji for it. */
  label: string;
  icon: string;
  place?: string;
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

/** Reads WEATHER_LAT / WEATHER_LON or WEATHER_CITY; undefined when neither is set. */
export function weatherPlaceFromEnv(env: Record<string, string | undefined>): WeatherPlace | undefined {
  const lat = Number(env.WEATHER_LAT);
  const lon = Number(env.WEATHER_LON);
  if (env.WEATHER_LAT && env.WEATHER_LON && Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  const city = env.WEATHER_CITY?.trim();
  return city ? { city } : undefined;
}

let geocoded: { city: string; lat: number; lon: number; name: string } | null = null;

export async function fetchWeather(place: WeatherPlace, f: typeof fetch = fetch): Promise<Weather | null> {
  try {
    let at: { lat: number; lon: number; name?: string };
    if ("city" in place) {
      if (geocoded?.city !== place.city) {
        const g = await f(
          `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place.city)}`,
        );
        const hit = ((await g.json()) as { results?: { latitude: number; longitude: number; name: string }[] })
          .results?.[0];
        if (!hit) return null;
        geocoded = { city: place.city, lat: hit.latitude, lon: hit.longitude, name: hit.name };
      }
      at = geocoded!;
    } else {
      at = place;
    }
    const res = await f(
      `https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lon}&current=temperature_2m,weather_code,is_day`,
    );
    if (!res.ok) return null;
    const { current } = (await res.json()) as {
      current?: { temperature_2m: number; weather_code: number; is_day: number };
    };
    if (!current) return null;
    return {
      tempC: Math.round(current.temperature_2m),
      ...describeWeather(current.weather_code, current.is_day !== 0),
      place: at.name,
    };
  } catch {
    return null;
  }
}
