import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBase64, toBase64 } from "../src/base64.ts";
import { type Effects, type LightsCommand, route, sayWeather } from "../src/route.ts";
import { parseForecast, weatherGlyph } from "../src/weather.ts";

function effects(extra: Partial<Effects> = {}) {
  const added: [string, string | undefined][] = [];
  const lights: LightsCommand[] = [];
  const fx: Effects = {
    addReminder: (text, due) => added.push([text, due]),
    openReminders: () => ["water the plants"],
    lights: async (cmd) => void lights.push(cmd),
    ...extra,
  };
  return { fx, added, lights };
}

test("reminders, with a due time", async () => {
  const { fx, added } = effects();
  const a = await route("Remind me to call mum at 18:00", fx);
  assert.equal(a.action, "reminder_added");
  assert.deepEqual(added, [["call mum", "18:00"]]);
});

test("watch prompts search or browse through find", async () => {
  const { fx } = effects({
    find: async (intent) => (intent.genre === "Comedy" ? [{ type: "movie", title: { id: "tt1", name: "Funny", year: "", rating: "" } }] : []),
  });
  const a = await route("show me a comedy movie", fx);
  assert.equal(a.action, "watch");
  assert.equal(a.query, "comedy films");
  assert.equal(a.results?.length, 1);
  assert.equal((await route("play nothing at all", fx)).reply, "I couldn't find anything for “nothing at all”.");
});

test("a briefing or the forecast asked with a watch verb is not a title", async () => {
  const { fx } = effects({ find: async () => [{ type: "movie", title: { id: "tt1", name: "Briefing", year: "", rating: "" } }] });
  assert.equal((await route("Give me a briefing", fx)).action, "briefing");
  assert.equal((await route("show me the news", fx)).action, "briefing");
  assert.equal((await route("show me the weather", fx)).action, "briefing");
  assert.equal((await route("show me dune", fx)).action, "watch");
});

test("lights: scenes and levels", async () => {
  const { fx, lights } = effects();
  await route("cinema mode", fx);
  await route("lights off", fx);
  await route("dim the lights to 20%", fx);
  await route("lights please", fx);
  assert.deepEqual(lights, [{ scene: "cinema" }, { scene: "off" }, { level: 20 }, { scene: "warm" }]);
});

test("the weather comes from the forecast, without Gemini", async () => {
  const w = { tempC: 18, label: "Partly cloudy", icon: "⛅", place: "Berlin", days: [{ date: "2026-11-01", minC: 9, maxC: 21, glyph: "partly" as const }] };
  const { fx } = effects({ weather: async () => w, geminiKey: "k", fetch: () => Promise.reject(new Error("no network")) });
  const a = await route("what's the weather", fx);
  assert.deepEqual(a, { reply: "It's 18° and partly cloudy in Berlin, 21° at the warmest and 9° at night.", action: "weather" });
  // "warm lights" is the lights, not the weather.
  assert.equal((await route("warm lights", fx)).action, "domotics_updated");
  assert.equal(sayWeather({ tempC: 3, label: "Snow", icon: "" }), "It's 3° and snow.");
});

test("Gemini answers the rest; without it, the canned briefing", async () => {
  let asked = "";
  const gemini = (async (_url: string, init: RequestInit) => {
    asked = String(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Indeed." }] } }] }));
  }) as unknown as typeof fetch;
  const { fx } = effects({ geminiKey: "k", fetch: gemini });
  assert.deepEqual(await route("Briefing", fx), { reply: "Indeed.", action: "briefing" });
  assert.match(asked, /water the plants/);

  const plain = effects({ lightsOn: () => 2 });
  assert.match((await route("Briefing", plain.fx)).reply, /1 pending task on my quill, 2 lamps lit/);
  const tv = effects();
  assert.match((await route("Briefing", tv.fx)).reply, /1 pending task on my quill\. Dictate/);
});

test("base64 both ways, larger than one chunk", () => {
  const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test("the forecast: now, the next 6 hours and 4 days", () => {
  const w = parseForecast(
    {
      current: { temperature_2m: 9.1, weather_code: 0, is_day: 0 },
      hourly: {
        time: ["2026-11-01T00:00", "2026-11-01T01:00", "2026-11-01T02:00", "2026-11-01T03:00", "2026-11-01T04:00", "2026-11-01T05:00", "2026-11-01T06:00"],
        temperature_2m: [9.3, 8.8, 8.3, 8, 7.6, 6.9, 6.4],
        weather_code: [0, 0, 0, 0, 0, 1, 61],
        is_day: [0, 0, 0, 0, 0, 0, 0],
      },
      daily: { time: ["2026-11-01", "2026-11-02"], weather_code: [2, 80], temperature_2m_max: [13.4, 11.4], temperature_2m_min: [6.2, 8.2] },
    },
    "Paris",
  );
  assert.equal(w?.tempC, 9);
  assert.equal(w?.glyph, "clear-night");
  assert.deepEqual(w?.hours?.map((h) => h.hour), ["01", "02", "03", "04", "05", "06"]);
  assert.equal(w?.hours?.[5].glyph, "rain");
  assert.deepEqual(w?.days?.[1], { date: "2026-11-02", minC: 8, maxC: 11, glyph: "rain" });
  assert.equal(parseForecast({}), null);
  assert.equal(weatherGlyph(95, true), "storm");
  assert.equal(weatherGlyph(73, true), "snow");
});
