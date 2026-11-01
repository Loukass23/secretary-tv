import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedWeather, findPlace, glyphMask, refreshWeather } from "../src/weather.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

const forecast = (async (url: string) => {
  const u = String(url);
  if (u.includes("geocoding-api")) return new Response(JSON.stringify({ results: [{ latitude: 52.5, longitude: 13.4, name: "Berlin" }] }));
  if (u.includes("api.open-meteo.com")) return new Response(JSON.stringify({ current: { temperature_2m: 17.6, weather_code: 2, is_day: 1 } }));
  throw new Error(`unexpected ${u}`);
}) as unknown as typeof fetch;

test("the SmartThings home comes first, and is kept for a day", async () => {
  const store = memory();
  let calls = 0;
  const locations = async () => {
    calls++;
    return [{ id: "l0", name: "Flat" }, { id: "l1", name: "Home", lat: 48.85, lon: 2.35 }];
  };
  const env = { WEATHER_CITY: "Berlin" };
  const p = await findPlace({ store, locations, env, fetch: forecast, now: 0 });
  assert.deepEqual([p?.lat, p?.name, p?.from], [48.85, "Home", "smartthings"]);
  await findPlace({ store, locations, env, fetch: forecast, now: 60_000 });
  assert.equal(calls, 1);
  await findPlace({ store, locations, env, fetch: forecast, now: 25 * 60 * 60_000 });
  assert.equal(calls, 2);
});

test("without SmartThings coordinates, the build's place; a city is looked up once", async () => {
  const p = await findPlace({ store: memory(), locations: async () => [{ id: "l0", name: "Flat" }], env: { WEATHER_CITY: "Berlin" }, fetch: forecast });
  assert.deepEqual([p?.lat, p?.lon, p?.name, p?.from], [52.5, 13.4, "Berlin", "env"]);
  const q = await findPlace({ store: memory(), env: { WEATHER_LAT: "1", WEATHER_LON: "2" }, fetch: forecast });
  assert.deepEqual([q?.lat, q?.lon], [1, 2]);
  assert.equal(await findPlace({ store: memory(), env: {} }), null);
});

test("SmartThings down: yesterday's home still serves", async () => {
  const store = memory();
  await findPlace({ store, locations: async () => [{ id: "l", name: "Home", lat: 1, lon: 2 }], env: {}, now: 0 });
  const p = await findPlace({ store, locations: () => Promise.reject(new Error("401")), env: {}, now: 2 * 24 * 60 * 60_000 });
  assert.equal(p?.name, "Home");
});

test("the forecast is kept for the next start, but not shown once stale", async () => {
  const store = memory();
  const w = await refreshWeather({ store, env: { WEATHER_LAT: "1", WEATHER_LON: "2" }, fetch: forecast, now: 1000 });
  assert.deepEqual([w?.tempC, w?.label, w?.glyph], [18, "Partly cloudy", "partly"]);
  assert.equal(cachedWeather(store, 1000 + 60_000)?.tempC, 18);
  assert.equal(cachedWeather(store, 1000 + 4 * 60 * 60_000), null);
  assert.equal(await refreshWeather({ store: memory(), env: {} }), null);
});

test("weather glyphs are masks made once", () => {
  assert.match(glyphMask("rain"), /^url\("data:image\/svg\+xml,/);
  assert.equal(glyphMask("rain"), glyphMask("rain"));
});
