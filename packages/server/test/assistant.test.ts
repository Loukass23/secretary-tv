import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { parseWatchIntent } from "../src/intent.ts";
import { describeWeather, weatherPlaceFromEnv } from "../src/weather.ts";

test("watch prompts become a search or a browse", () => {
  assert.deepEqual(parseWatchIntent("Play Dune"), { term: "dune", kind: undefined });
  assert.deepEqual(parseWatchIntent("show me the matrix movie"), { term: "the matrix", kind: "movie" });
  assert.deepEqual(parseWatchIntent("Show me a comedy"), { kind: undefined, genre: "Comedy" });
  assert.deepEqual(parseWatchIntent("something for tonight"), { kind: undefined, genre: undefined });
  assert.deepEqual(parseWatchIntent("What should I watch?"), { kind: undefined, genre: undefined });
  assert.deepEqual(parseWatchIntent("find me scary anime"), { kind: "anime", genre: "Horror" });
  assert.deepEqual(parseWatchIntent("highest rated series this week"), null);
  assert.deepEqual(parseWatchIntent("show me highest rated series this week"), { kind: "series", genre: undefined });
});

test("lights, reminders and chat are not watch prompts", () => {
  assert.equal(parseWatchIntent("cinema mode"), null);
  assert.equal(parseWatchIntent("put on cinema mode"), null);
  assert.equal(parseWatchIntent("show me my reminders"), null);
  assert.equal(parseWatchIntent("remind me to call mum"), null);
  assert.equal(parseWatchIntent("I like it"), null);
  assert.equal(parseWatchIntent("play"), null);
});

test("weather codes and the place from the environment", () => {
  assert.deepEqual(describeWeather(0, false), { label: "Clear", icon: "🌙" });
  assert.equal(describeWeather(63, true).label, "Rain");
  assert.deepEqual(weatherPlaceFromEnv({ WEATHER_LAT: "52.5", WEATHER_LON: "13.4" }), { lat: 52.5, lon: 13.4 });
  assert.deepEqual(weatherPlaceFromEnv({ WEATHER_CITY: " Berlin " }), { city: "Berlin" });
  assert.equal(weatherPlaceFromEnv({}), undefined);
});

function catalogFetch(url: string | URL | Request): Promise<Response> {
  const u = String(url);
  const meta = (id: string, name: string) => ({ imdb_id: id, name, year: "2021", poster: `https://images.metahub.space/poster/medium/${id}/img` });
  if (u.includes("search=dune")) return Promise.resolve(new Response(JSON.stringify({ metas: [meta("tt1160419", "Dune")] })));
  if (u.includes("/catalog/movie/top/genre=Comedy")) {
    return Promise.resolve(new Response(JSON.stringify({ metas: [meta("tt1", "Funny One"), meta("tt2", "Funny Two")] })));
  }
  if (u.includes("/catalog/")) return Promise.resolve(new Response(JSON.stringify({ metas: [] })));
  if (u.includes("open-meteo")) {
    return Promise.resolve(new Response(JSON.stringify({ current: { temperature_2m: 17.6, weather_code: 2, is_day: 1 } })));
  }
  if (u.startsWith("https://images.metahub.space/")) {
    return Promise.resolve(new Response("img", { headers: { "content-type": "image/jpeg" } }));
  }
  throw new Error(`unexpected ${u}`);
}

const app = createApp({
  apiKey: "k",
  baseUrl: "http://tv",
  upstream: "",
  fetch: catalogFetch as typeof fetch,
  weather: { lat: 1, lon: 2 },
});

const ask = async (prompt: string, source = "tv") =>
  (await (await app(new Request("http://x/ai/ask", { method: "POST", body: JSON.stringify({ prompt, source }) }))).json()) as {
    action: string;
    reply: string;
    query?: string;
    results?: { type: string; title: { id: string; poster?: string } }[];
  };

test("/ai/ask answers watch prompts with titles and logs the turn", async () => {
  const dune = await ask("play dune");
  assert.equal(dune.action, "watch");
  assert.equal(dune.query, "“dune”");
  assert.equal(dune.results?.[0].title.id, "tt1160419");

  const comedy = await ask("show me a comedy movie", "companion");
  assert.equal(comedy.query, "comedy films");
  assert.deepEqual(comedy.results?.map((r) => r.title.id), ["tt1", "tt2"]);
  assert.equal(comedy.results?.[0].title.poster, "https://images.metahub.space/poster/small/tt1/img");

  const st = (await (await app(new Request("http://x/ai/state"))).json()) as {
    rev: number;
    pending: unknown;
    turns: { prompt: string; source: string; results?: unknown[] }[];
  };
  assert.equal(st.pending, null);
  assert.equal(st.rev, 4);
  assert.deepEqual(st.turns.map((t) => [t.prompt, t.source]), [["play dune", "tv"], ["show me a comedy movie", "companion"]]);
});

test("/weather and /art", async () => {
  const w = (await (await app(new Request("http://x/weather"))).json()) as { tempC: number; label: string };
  assert.deepEqual([w.tempC, w.label], [18, "Partly cloudy"]);

  const art = await app(new Request(`http://x/art?u=${encodeURIComponent("https://images.metahub.space/poster/small/tt1/img")}`));
  assert.equal(art.status, 200);
  assert.equal(art.headers.get("access-control-allow-origin"), "*");
  const evil = await app(new Request(`http://x/art?u=${encodeURIComponent("https://example.com/x.jpg")}`));
  assert.equal(evil.status, 403);
});
