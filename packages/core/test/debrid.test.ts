import { test } from "node:test";
import assert from "node:assert/strict";
import { debridServices } from "../src/index.ts";

const HASH = "c".repeat(40);

test("debrid: only services with a key, in the user's order; Premiumize picks the episode's file", async () => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${url.replace(/\?.*/, "")} ${init?.body instanceof URLSearchParams ? init.body.getAll("items[]").length || init.body.get("src") : ""}`);
    if (url.endsWith("/cache/check")) return new Response(JSON.stringify({ status: "success", response: [true, false] }));
    if (url.endsWith("/transfer/directdl")) {
      return new Response(JSON.stringify({ status: "success", content: [
        { path: "Show/Show.S01E01.mkv", size: 900, link: "https://cdn.example/e1" },
        { path: "Show/Show.S01E02.mkv", size: 800, link: "https://cdn.example/e2" },
        { path: "Show/sample.mkv", size: 10, link: "https://cdn.example/s" },
      ] }));
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const services = debridServices({ tb: "", pm: "key" }, ["pm", "tb"], f);
  assert.deepEqual(services.map((s) => s.id), ["pm"]);
  const cached = await services[0].checkCached([HASH, "d".repeat(40)]);
  assert.deepEqual([...cached], [HASH]);
  assert.equal(await services[0].resolve(HASH, undefined, { season: 1, episode: 2 }), "https://cdn.example/e2");
  assert.equal(await services[0].resolve(HASH, undefined, null), "https://cdn.example/e1");
  assert.match(calls[0], /cache\/check 2/);
});

test("debrid: TorBox with Cached sources only checks first and never adds an uncached torrent", async () => {
  const calls: string[] = [];
  const cached = new Set([HASH]);
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname.replace(/.*\/torrents\//, ""));
    if (url.pathname.endsWith("/checkcached")) {
      const asked = (url.searchParams.get("hash") ?? "").split(",");
      return new Response(JSON.stringify({ data: asked.filter((h) => cached.has(h)).map((hash) => ({ hash })) }));
    }
    if (url.pathname.endsWith("/createtorrent")) return new Response(JSON.stringify({ data: { torrent_id: 7 } }));
    if (url.pathname.endsWith("/mylist")) return new Response(JSON.stringify({ data: { files: [{ id: 1, name: "Film.mkv", size: 900 }] } }));
    if (url.pathname.endsWith("/requestdl")) return new Response(JSON.stringify({ data: "https://cdn.example/film" }));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  let on = true;
  const [tb] = debridServices({ tb: "key" }, ["tb"], f, { cachedOnly: () => on });
  assert.equal(await tb.resolve(HASH, undefined, null), "https://cdn.example/film");
  assert.deepEqual(calls, ["checkcached", "createtorrent", "mylist", "requestdl"]);
  calls.length = 0;
  await assert.rejects(tb.resolve("d".repeat(40), undefined, null), /Not cached/);
  assert.deepEqual(calls, ["checkcached"], "no torrent added");
  // Off, it adds the torrent as before, without a check.
  on = false;
  calls.length = 0;
  await tb.resolve("d".repeat(40), undefined, null);
  assert.deepEqual(calls, ["createtorrent", "mylist", "requestdl"]);
});
