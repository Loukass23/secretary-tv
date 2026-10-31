import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

function fakeFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = String(url);
  const j = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b)));
  if (u.includes("/stream/")) {
    return j({
      streams: [
        { title: "Movie 720p x264", infoHash: A },
        { title: "Movie 2160p HEVC DDP", infoHash: B, fileIdx: 1 },
      ],
    });
  }
  if (u.includes("checkcached")) return j({ data: [{ hash: A }, { hash: B }] });
  if (u.includes("createtorrent")) return j({ data: { torrent_id: 9 } });
  if (u.includes("mylist")) return j({ data: { files: [{ id: 1, name: "a.mkv", size: 5 }] } });
  if (u.includes("requestdl")) return j({ data: "https://cdn.example/file.mkv" });
  throw new Error(`unexpected ${u} ${init?.method ?? ""}`);
}

const app = createApp({
  apiKey: "k",
  baseUrl: "http://tv",
  upstream: "https://up",
  fetch: fakeFetch as typeof fetch,
});

test("stream lists cached hashes, best first, pointing at /resolve", async () => {
  const res = await app(new Request("http://x/stream/movie/tt1.json"));
  const { streams } = (await res.json()) as { streams: { url: string }[] };
  assert.equal(streams[0].url, `http://tv/resolve/${B}/1`);
  assert.equal(streams[1].url, `http://tv/resolve/${A}`);
  assert.equal(streams.length, 2);
});

test("resolve redirects to the TorBox CDN link", async () => {
  const res = await app(new Request(`http://x/resolve/${B}/1`));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://cdn.example/file.mkv");
});

test("resolve skips a readme at id 0 and picks the largest video", async () => {
  const f = ((url: string) => {
    const j = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b)));
    if (url.includes("createtorrent")) return j({ data: { torrent_id: 1 } });
    if (url.includes("mylist"))
      return j({
        data: {
          files: [
            { id: 0, name: "readme.txt", size: 1 },
            { id: 1, name: "movie.mkv", size: 9 },
          ],
        },
      });
    if (url.includes("file_id=1")) return j({ data: "https://cdn/movie" });
    throw new Error(url);
  }) as unknown as typeof fetch;
  const a = createApp({ apiKey: "k", baseUrl: "http://tv", upstream: "u", fetch: f });
  const res = await a(new Request(`http://x/resolve/${A}`));
  assert.equal(res.headers.get("location"), "https://cdn/movie");
});

test("unknown path is 404", async () => {
  assert.equal((await app(new Request("http://x/nope"))).status, 404);
});

test("stream and resolve results are cached until the TTL passes", async () => {
  let calls = 0;
  let t = 0;
  const counting = ((url: string, init?: RequestInit) => {
    if (String(url).includes("/stream/") || String(url).includes("createtorrent")) calls++;
    return fakeFetch(url, init);
  }) as typeof fetch;
  const a = createApp({ apiKey: "k", baseUrl: "http://tv", upstream: "u", fetch: counting, now: () => t });
  await a(new Request("http://x/stream/movie/tt9.json"));
  await a(new Request("http://x/stream/movie/tt9.json"));
  await a(new Request(`http://x/resolve/${B}/1`));
  await a(new Request(`http://x/resolve/${B}/1`));
  assert.equal(calls, 2);
  t = 31 * 60_000;
  await a(new Request("http://x/stream/movie/tt9.json"));
  assert.equal(calls, 3);
});

test("resume sync stores per-type progress and returns unified list sorted by updated", async () => {
  const a = createApp({ apiKey: "k", baseUrl: "http://tv", upstream: "u", fetch: fakeFetch as typeof fetch });
  await a(
    new Request("http://x/resume/movie", {
      method: "PUT",
      body: JSON.stringify([
        { title: { id: "tt1", name: "M1", year: "2025", rating: "7" }, posSec: 120, durSec: 6000, updated: 10 },
      ]),
    }),
  );
  await a(
    new Request("http://x/resume/anime", {
      method: "PUT",
      body: JSON.stringify([
        {
          title: { id: "kitsu:1", name: "A1", year: "2020", rating: "8" },
          episode: { id: "kitsu:1:2", season: 1, episode: 2, name: "Ep 2" },
          posSec: 300,
          durSec: 1400,
          updated: 20,
        },
      ]),
    }),
  );

  const allRes = await a(new Request("http://x/resume"));
  const { items } = (await allRes.json()) as { items: { type: string; title: { id: string } }[] };
  assert.deepEqual(items.map((i) => `${i.type}:${i.title.id}`), ["anime:kitsu:1", "movie:tt1"]);
});

test("handoff stores a title and autoPlay flag for a catalog app and consumes it once", async () => {
  let t = 1000;
  const a = createApp({ apiKey: "k", baseUrl: "http://tv", upstream: "u", fetch: fakeFetch as typeof fetch, now: () => t });
  await a(
    new Request("http://x/handoff", {
      method: "POST",
      body: JSON.stringify({
        type: "series",
        title: { id: "tt2", name: "Show", year: "2024", rating: "8.1" },
        autoPlay: true,
      }),
    }),
  );
  const first = (await (await a(new Request("http://x/handoff/series"))).json()) as {
    title: { id: string } | null;
    autoPlay?: boolean;
  };
  assert.equal(first.title?.id, "tt2");
  assert.equal(first.autoPlay, true);
  const second = (await (await a(new Request("http://x/handoff/series"))).json()) as {
    title: { id: string } | null;
    autoPlay?: boolean;
  };
  assert.equal(second.title, null);
  assert.equal(second.autoPlay, false);
});

test("search queries movie, series, and anime catalogs and ranks exact matches first", async () => {
  const searchFetch = (async (url: string) => {
    const u = String(url);
    const j = (b: unknown) => new Response(JSON.stringify(b));
    if (u.includes("/catalog/movie/")) return j({ metas: [{ imdb_id: "tt10", name: "Titanfall", year: "2022" }] });
    if (u.includes("/catalog/series/")) return j({ metas: [{ imdb_id: "tt20", name: "Titans", year: "2018" }] });
    if (u.includes("/catalog/anime/")) return j({ metas: [{ id: "kitsu:7442", name: "Titan", year: "2013" }] });
    throw new Error(u);
  }) as unknown as typeof fetch;
  const a = createApp({ apiKey: "k", baseUrl: "http://tv", upstream: "u", fetch: searchFetch });
  const res = await a(new Request("http://x/search?q=titan"));
  const { results } = (await res.json()) as { results: { type: string; title: { id: string; name: string } }[] };
  assert.equal(results.length, 3);
  assert.equal(results[0].title.name, "Titan");
  assert.equal(results[0].type, "anime");
});

test("health and cloud endpoints expose server status and active TorBox cloud torrents", async () => {
  const cloudFetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/torrents/mylist")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: 42, hash: A, name: "The.Matrix.1999.2160p.mkv", size: 1000, download_present: true, files: [] },
          ],
        }),
      );
    }
    throw new Error(u);
  }) as unknown as typeof fetch;
  const a = createApp({ apiKey: "k", baseUrl: "http://tv", upstream: "u", fetch: cloudFetch });
  const health = (await (await a(new Request("http://x/health"))).json()) as { ok: boolean; resumeCount: number };
  assert.equal(health.ok, true);
  const cloud = (await (await a(new Request("http://x/cloud"))).json()) as {
    items: { id: number; name: string; url: string }[];
  };
  assert.equal(cloud.items.length, 1);
  assert.equal(cloud.items[0].url, `http://tv/resolve/${A}`);
});

test("companion, reminders, Gemini AI assistant, and SmartThings domotics endpoints work end-to-end", async () => {
  const stCalls: { url: string; body: string }[] = [];
  const domFetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.smartthings.com/v1/devices/")) {
      stCalls.push({ url: u, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ results: [{ status: "ACCEPTED" }] }));
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const a = createApp({
    apiKey: "k",
    baseUrl: "http://tv",
    upstream: "u",
    smartThingsToken: "st-pat-token",
    fetch: domFetch,
  });

  // 1. Companion HTML page renders
  const compRes = await a(new Request("http://x/companion"));
  assert.equal(compRes.status, 200);
  const html = await compRes.text();
  assert.ok(html.includes("Secretary Desk"));

  // 2. Gemini / AI Assistant natural language reminder creation
  const aiRemRes = await a(
    new Request("http://x/ai/ask", {
      method: "POST",
      body: JSON.stringify({ prompt: "Remind me to check the oven at 20:30" }),
    }),
  );
  const aiRemBody = (await aiRemRes.json()) as {
    action: string;
    reply: string;
    reminders: { id: string; text: string; due?: string; source: string }[];
  };
  assert.equal(aiRemBody.action, "reminder_added");
  assert.equal(aiRemBody.reminders[0].text, "check the oven");
  assert.equal(aiRemBody.reminders[0].due, "20:30");
  assert.equal(aiRemBody.reminders[0].source, "gemini");

  // 3. Toggle reminder completion
  const remId = aiRemBody.reminders[0].id;
  const toggleRes = await a(new Request(`http://x/reminders/${encodeURIComponent(remId)}/toggle`, { method: "POST" }));
  const toggleBody = (await toggleRes.json()) as { items: { id: string; completed: boolean }[] };
  assert.equal(toggleBody.items.find((r) => r.id === remId)?.completed, true);

  // 4. Domotics command forwards to SmartThings Cloud Hub API
  const domRes = await a(
    new Request("http://x/domotics/command", {
      method: "POST",
      body: JSON.stringify({ id: "st-living-main", on: true, level: 25 }),
    }),
  );
  const domBody = (await domRes.json()) as { device: { id: string; on: boolean; level: number } };
  assert.equal(domBody.device.level, 25);
  assert.equal(stCalls.length, 1);
  assert.ok(stCalls[0].url.includes("api.smartthings.com/v1/devices/st-living-main/commands"));
  assert.ok(stCalls[0].body.includes('"setLevel"'));

  // 5. Domotics scene command forwards to SmartThings for targeted devices
  stCalls.length = 0;
  const sceneRes = await a(
    new Request("http://x/domotics/command", {
      method: "POST",
      body: JSON.stringify({ scene: "cinema", targetIds: ["st-living-main"] }),
    }),
  );
  const sceneBody = (await sceneRes.json()) as { devices: { id: string; on: boolean; level: number }[] };
  assert.equal(sceneBody.devices.find((d) => d.id === "st-living-main")?.level, 15);
  assert.equal(stCalls.length, 1);
  assert.ok(stCalls[0].url.includes("api.smartthings.com/v1/devices/st-living-main/commands"));
  assert.ok(stCalls[0].body.includes("15"));
});
