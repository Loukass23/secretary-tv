import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stream } from "../src/lib/streams.ts";
import { type Check, checkSource, classify, createVerifier } from "../src/lib/verify.ts";

const GB = 1024 ** 3;
const answer = (status: number, url: string, headers: Record<string, string>) => ({
  status,
  url,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
});

test("classify: video, error pages, refusals and warning clips", () => {
  const video = { "content-type": "application/octet-stream", "content-range": `bytes 0-1023/${22 * GB}` };
  assert.deepEqual(classify(answer(206, "https://cdn.example/f/Film.2160p.mkv", video)), { verdict: "ok", size: 22 * GB });
  assert.equal(classify(answer(200, "https://cdn.example/a.mkv", { "content-length": String(3 * GB) })).verdict, "ok");
  assert.equal(classify(answer(206, "https://x.example/", { "content-type": "text/html; charset=utf-8" })).verdict, "not video");
  assert.equal(classify(answer(200, "https://x.example/api", { "content-type": "application/json" })).verdict, "not video");
  assert.equal(classify(answer(403, "https://cdn.example/a.mkv", video)).verdict, "refused");
  assert.equal(classify(answer(206, "https://cdn.example/videos/downloading.mp4", video)).verdict, "warning clip");
  assert.equal(classify(answer(206, "https://cdn.example/not_cached.mp4", video)).verdict, "warning clip");
  const tiny = { "content-type": "video/mp4", "content-range": "bytes 0-1023/2400000" };
  assert.equal(classify(answer(206, "https://cdn.example/clip.mp4", tiny)).verdict, "warning clip");
  // A word inside a release name is not a placeholder.
  assert.equal(classify(answer(206, "https://cdn.example/The.Error.Code.2160p.mkv", video)).verdict, "ok");
});

test("checkSource: resolves debrid sources first, probes a kilobyte, never throws", async () => {
  const seen: string[] = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(`${url} ${(init?.headers as Record<string, string>).Range}`);
    if (String(url).includes("down")) throw new TypeError("network");
    return new Response("x".repeat(1024), {
      status: 206,
      headers: { "content-type": "application/octet-stream", "content-range": `bytes 0-1023/${GB}` },
    });
  }) as typeof fetch;
  const playable = async (u: string) => (u.startsWith("debrid:") ? "https://cdn.example/resolved.mkv" : u);
  const ok = await checkSource("debrid:pm:abc", playable, f);
  assert.equal(ok.verdict, "ok");
  assert.equal(ok.url, "https://cdn.example/resolved.mkv");
  assert.deepEqual(seen, ["https://cdn.example/resolved.mkv bytes=0-1023"]);
  assert.equal((await checkSource("https://down.example/a", playable, f)).verdict, "no answer");
  assert.equal((await checkSource("debrid:tb:x", async () => Promise.reject(new Error("no key")), f)).verdict, "no answer");
});

const src = (n: string): Stream => ({ name: n, title: n, url: n });

test("verifier: the leading safe run is checked a few at a time; the first in order that passes wins", async () => {
  const started: string[] = [];
  const done = new Map<string, (c: Check) => void>();
  const check = (url: string) =>
    new Promise<Check>((resolve) => {
      started.push(url);
      done.set(url, resolve);
    });
  const v = createVerifier([src("a"), src("b"), src("c"), src("d"), src("tb")], {
    check,
    safe: (s) => s.url !== "tb",
    parallel: 2,
  });
  assert.equal(v.ahead, 4);
  assert.deepEqual(started, ["a", "b"]);
  // b answers first and passes, a fails afterwards: b is the winner because a failed, not because b was faster.
  done.get("b")!({ verdict: "ok", url: "b", ms: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(started, ["a", "b", "c"]);
  done.get("a")!({ verdict: "warning clip", url: "a", ms: 1 });
  assert.equal((await v.get(0)).verdict, "warning clip");
  assert.equal((await v.get(1)).verdict, "ok");
  await new Promise((r) => setTimeout(r, 0));
  // The TorBox source past the run is never checked (resolved) ahead of its turn.
  assert.ok(!started.includes("tb"));
  done.get("c")!({ verdict: "ok", url: "c", ms: 1 });
  done.get("d")?.({ verdict: "ok", url: "d", ms: 1 });
  const tb = v.get(4);
  assert.ok(started.includes("tb"));
  done.get("tb")!({ verdict: "ok", url: "cdn", ms: 1 });
  assert.equal((await tb).url, "cdn");
});

test("verifier: nothing is checked ahead when the first source is not safe, or past the deadline", async () => {
  const started: string[] = [];
  const pending: (() => void)[] = [];
  const check = (url: string) =>
    new Promise<Check>((resolve) => {
      started.push(url);
      pending.push(() => resolve({ verdict: "ok", url, ms: 1 }));
    });
  createVerifier([src("tb"), src("a")], { check, safe: (s) => s.url !== "tb" });
  assert.deepEqual(started, []);

  let t = 0;
  const v = createVerifier([src("a"), src("b")], { check, safe: () => true, parallel: 1, deadlineMs: 20_000, now: () => t });
  assert.deepEqual(started, ["a"]);
  t = 25_000;
  pending.shift()!();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(started, ["a"], "b waits for its turn");
  void v.get(1);
  assert.deepEqual(started, ["a", "b"]);
});

test("safeToCheck: Premiumize and provider links ahead; TorBox only when the setting allows it", async () => {
  const { safeToCheck } = await import("../src/lib/verify.ts");
  const off = safeToCheck(false);
  assert.ok(off(src("debrid:pm:abc")));
  assert.ok(off({ name: "⚡ [PM] 2160p", title: "", url: "https://w.example/k/debrid/resolve?service=pm&hash=a" }));
  assert.ok(off(src("https://cdn.example/film.mkv")));
  assert.ok(!off(src("debrid:tb:abc")));
  assert.ok(!off({ name: "⚡ [TB] 2160p", title: "", url: "https://w.example/k/debrid/resolve?service=tb&hash=a" }));
  assert.ok(safeToCheck(true)(src("debrid:tb:abc")));
});

test("tryInOrder: sources skipped by their check do not use up the tries", async () => {
  const { SkipSource, tryInOrder } = await import("../src/lib/autopick.ts");
  const tried: number[] = [];
  const winner = await tryInOrder([0, 1, 2, 3, 4], async (n) => {
    tried.push(n);
    if (n < 3) throw new SkipSource("warning clip");
    if (n === 3) throw new Error("prepare timed out");
  }, { max: 2 });
  assert.equal(winner, 4);
  assert.deepEqual(tried, [0, 1, 2, 3, 4]);
});
