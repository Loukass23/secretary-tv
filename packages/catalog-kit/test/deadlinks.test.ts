import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeadLinks, DEAD_TTL_MS, sourceKey } from "../src/lib/deadlinks.ts";

const memory = () => {
  const map = new Map<string, unknown>();
  return { get: <T>(k: string) => (map.has(k) ? (structuredClone(map.get(k)) as T) : null), set: (k: string, v: unknown) => void map.set(k, structuredClone(v)) };
};

test("sourceKey: tokens and signatures go, episode numbers and the provider stay", () => {
  const a = sourceKey({ provider: "p", url: "https://cdn.example/f/a.mkv?token=1&e=3&X-Amz-Signature=x&expires=9" });
  const b = sourceKey({ provider: "p", url: "https://cdn.example/f/a.mkv?e=3&token=2&X-Amz-Signature=y" });
  assert.equal(a, b);
  assert.equal(a, "p|cdn.example/f/a.mkv?e=3");
  assert.notEqual(a, sourceKey({ provider: "p", url: "https://cdn.example/f/a.mkv?e=4" }));
  assert.notEqual(a, sourceKey({ provider: "q", url: "https://cdn.example/f/a.mkv?e=3" }));
  assert.equal(sourceKey({ provider: "p", url: "debrid:tb:abc/2?s=1&e=3" }), "p|debrid:tb:abc/2?s=1&e=3");
});

test("dead links: six hours, a wrong clock, a cap, and a success forgets", () => {
  let t = 1_000_000;
  const kv = memory();
  const dead = createDeadLinks(kv, () => t);
  const s = (n: number) => ({ provider: "p", url: `https://cdn.example/${n}.mkv` });
  dead.mark(s(1), "prepare timed out");
  assert.equal(dead.get({ provider: "p", url: "https://cdn.example/1.mkv?token=new" })?.reason, "prepare timed out");
  t += DEAD_TTL_MS - 1;
  assert.ok(dead.get(s(1)));
  t += 2;
  assert.equal(dead.get(s(1)), null);
  // Stamped in the future (the clock went back): not trusted.
  dead.mark(s(2), "refused");
  t -= 60_000;
  assert.equal(dead.get(s(2)), null);
  for (let i = 0; i < 140; i++) {
    t += 1;
    dead.mark(s(100 + i), "x");
  }
  assert.equal(Object.keys(kv.get<Record<string, unknown>>("sectv.dead.v1")!).length, 128);
  assert.ok(dead.get(s(239)) && !dead.get(s(100)));
  dead.clear(s(239));
  assert.equal(dead.get(s(239)), null);
  assert.deepEqual(dead.aliveFirst([s(238), s(1), s(237)]).map((x) => x.url), [s(1).url, s(238).url, s(237).url]);
});
