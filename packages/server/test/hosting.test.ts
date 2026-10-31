import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, KEY_PATTERN, keyedPath } from "../src/app.ts";

const KEY = "k3y_0123456789abcdefghijkl";

test("keyed paths keep what follows the key", () => {
  assert.equal(keyedPath(`/${KEY}/reminders`, KEY), "/reminders");
  assert.equal(keyedPath(`/${KEY}/stream/movie/tt1.json`, KEY), "/stream/movie/tt1.json");
  assert.equal(keyedPath(`/${KEY}`, KEY), "/");
  assert.equal(keyedPath("/reminders", KEY), null);
  assert.equal(keyedPath(`/${KEY.slice(0, -1)}x/reminders`, KEY), null);
  assert.equal(keyedPath(`/${KEY}x/reminders`, KEY), null);
  assert.equal(keyedPath("/", KEY), null);
});

test("a key is long and URL-safe", () => {
  assert.ok(KEY_PATTERN.test(KEY));
  assert.ok(!KEY_PATTERN.test("short"));
  assert.ok(!KEY_PATTERN.test("has/a/slash/and/is/long/enough"));
});

const hosted = createApp({
  apiKey: "k",
  baseUrl: `https://tv.example.com/${KEY}`,
  key: KEY,
  upstream: "",
  geminiApiKey: "",
  fetch: (async () => {
    throw new Error("no network in tests");
  }) as typeof fetch,
});

test("a hosted server answers only under its key", async () => {
  assert.equal((await hosted(new Request("http://x/reminders"))).status, 404);
  assert.equal((await hosted(new Request("http://x/manifest.json"))).status, 404);
  assert.equal((await hosted(new Request("http://x/companion"))).status, 404);
  const wrong = `/${"z".repeat(KEY.length)}/reminders`;
  assert.equal((await hosted(new Request(`http://x${wrong}`))).status, 404);
  const ok = await hosted(new Request(`http://x/${KEY}/reminders`));
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(((await ok.json()) as { items: unknown[] }).items));
  const lights = await hosted(
    new Request("http://x/domotics/command", { method: "POST", body: JSON.stringify({ scene: "off", dryRun: true }) }),
  );
  assert.equal(lights.status, 404);
});

test("the bare health check gives nothing away", async () => {
  const res = await hosted(new Request("http://x/health"));
  assert.deepEqual(await res.json(), { ok: true });
  const keyed = (await (await hosted(new Request(`http://x/${KEY}/health`))).json()) as { companionUrl: string };
  assert.equal(keyed.companionUrl, `https://tv.example.com/${KEY}/companion`);
});

test("Desk calls the server under the key", async () => {
  const html = await (await hosted(new Request(`http://x/${KEY}/companion`))).text();
  assert.ok(html.includes(`const API = "/${KEY}";`));
  assert.ok(!/fetch\('\//.test(html));
});

test("a home server keeps its paths", async () => {
  const home = createApp({ apiKey: "k", baseUrl: "http://192.0.2.10:7000", upstream: "" });
  assert.equal((await home(new Request("http://x/reminders"))).status, 200);
  const html = await (await home(new Request("http://x/companion"))).text();
  assert.ok(html.includes('const API = "";'));
});
