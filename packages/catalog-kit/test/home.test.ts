import { test } from "node:test";
import assert from "node:assert/strict";
import { homeGrant, runMovieScene, saveHomeGrant } from "../src/lib/home.ts";

const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const recorder = () => {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(url)} ${(init?.headers as Record<string, string>)?.authorization ?? ""} ${init?.body ?? ""}`);
    return new Response("");
  }) as typeof fetch;
  return { calls, f };
};

test("movie lights: Nest's scenes on SmartThings while its token is good", async () => {
  mem.clear();
  saveHomeGrant({ token: "tok", exp: 10 * 60_000, movie: "scene-movie", restore: "scene-bright" });
  const { calls, f } = recorder();
  assert.equal(await runMovieScene("movie", "http://192.0.2.10:7000", f, 0), true);
  assert.equal(await runMovieScene("restore", "http://192.0.2.10:7000", f, 0), true);
  assert.deepEqual(calls, [
    "POST https://api.smartthings.com/v1/scenes/scene-movie/execute Bearer tok ",
    "POST https://api.smartthings.com/v1/scenes/scene-bright/execute Bearer tok ",
  ]);
});

test("movie lights: an expiring grant falls back to the server's cinema preset, and nothing restores", async () => {
  mem.clear();
  saveHomeGrant({ token: "tok", exp: 30_000, movie: "scene-movie" });
  assert.equal(homeGrant(0), null);
  const { calls, f } = recorder();
  assert.equal(await runMovieScene("movie", "http://192.0.2.10:7000/", f, 0), false);
  assert.equal(await runMovieScene("restore", "http://192.0.2.10:7000/", f, 0), false);
  assert.deepEqual(calls, ['POST http://192.0.2.10:7000/domotics/command  {"scene":"cinema"}']);
  assert.equal(await runMovieScene("movie", "", f, 0), false);
  assert.equal(calls.length, 1);
});
