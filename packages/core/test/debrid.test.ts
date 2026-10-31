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
