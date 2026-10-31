import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProviderStatus } from "@secretary/plugins";
import { decide, type DecideInput, waitMs } from "../src/lib/autoplay.ts";
import { pickIndex } from "../src/lib/rules.ts";
import type { Stream } from "../src/lib/streams.ts";

const s = (name: string): Stream => ({ name, title: `Film.${name}.mkv`, url: `https://x.example/${name}` });
const st = (id: string, state: ProviderStatus["state"]): ProviderStatus => ({ repo: "r", id, name: id, state, count: 0, ms: 0 });
const base: DecideInput = { candidates: [], status: [], done: false, elapsedMs: 0, waitMs: 5000 };

test("the pick: the first of the best resolution; AV1 only when nothing else", () => {
  assert.equal(pickIndex([s("1080p"), s("720p"), s("2160p"), s("2160p.HDR")]), 2);
  assert.equal(pickIndex([s("2160p.AV1"), s("1080p")]), 1);
  assert.equal(pickIndex([s("2160p.AV1")]), 0);
  assert.equal(pickIndex([]), -1);
});

test("decide: one case per rule, in order", () => {
  const cases: [string, Partial<DecideInput>, string][] = [
    ["nothing yet waits", {}, "wait"],
    ["nothing at the end gives up", { done: true }, "none"],
    ["a finished search plays its best", { candidates: [s("1080p"), s("2160p")], done: true }, "go 1"],
    ["the remembered source plays when found", { candidates: [s("1080p"), s("720p")], remembered: { url: "https://x.example/720p" } }, "go 1"],
    [
      "its provider still searching is waited for",
      { candidates: [s("2160p")], status: [st("p", "searching")], remembered: { url: "https://x.example/other", provider: "p" } },
      "wait",
    ],
    [
      "but not past the wait",
      { candidates: [s("1080p")], status: [st("p", "searching")], remembered: { url: "u", provider: "p" }, elapsedMs: 5000 },
      "go 0",
    ],
    ["the wait run out plays the best so far", { candidates: [s("720p"), s("1080p")], elapsedMs: 5200 }, "go 1"],
    ["a 4K source starts early", { candidates: [s("1080p"), s("2160p")], elapsedMs: 300 }, "go 1"],
    ["below 4K waits inside the wait", { candidates: [s("1080p")], elapsedMs: 300 }, "wait"],
    ["Instantly goes with anything", { candidates: [s("720p")], waitMs: waitMs("instant") }, "go 0"],
    ["every provider waits for the end, 4K or not", { candidates: [s("2160p")], elapsedMs: 60_000, waitMs: waitMs("all") }, "wait"],
  ];
  for (const [name, input, want] of cases) {
    const d = decide({ ...base, ...input });
    const got = "go" in d ? `go ${d.go}` : "wait" in d ? "wait" : "none";
    assert.equal(got, want, name);
  }
});

test("the pick and decide leave out sources that failed recently, unless every one has", () => {
  const list = [s("2160p"), s("1080p"), s("2160p.HDR")];
  const deadFirst = (x: Stream) => x === list[0];
  assert.equal(pickIndex(list, { isDead: deadFirst }), 2);
  assert.equal(pickIndex(list, { isDead: () => true }), 0);
  const d = decide({ ...base, candidates: list, done: true, rules: { isDead: deadFirst } });
  assert.deepEqual("go" in d && d.go, 2);
  // A recent failure is no reason to start early.
  assert.ok("wait" in decide({ ...base, candidates: [s("2160p")], elapsedMs: 300, rules: { isDead: () => true } }));
});
