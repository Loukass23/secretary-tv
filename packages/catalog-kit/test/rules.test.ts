import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/lib/autoplay.ts";
import { pickIndex, rankSources, sizeGb } from "../src/lib/rules.ts";
import type { Stream } from "../src/lib/streams.ts";

const s = (title: string, provider?: string): Stream => ({ name: title, title, url: `https://x.example/${title}`, provider });

test("sizes are read from the source's text", () => {
  assert.equal(sizeGb(s("Film.2160p 📦 48.5 GB")), 48.5);
  assert.equal(sizeGb(s("Film.720p 700 MB")), 700 / 1024);
  assert.equal(sizeGb(s("Film.1080p")), null);
});

test("size limits are preferences: outside goes last, nothing is dropped", () => {
  const list = [s("A.2160p 60 GB"), s("B.2160p 14 GB"), s("C.1080p 3 GB"), s("D.1080p")];
  assert.deepEqual(rankSources(list, { maxSizeGb: 30 }).map((x) => x.title[0]), ["B", "C", "D", "A"]);
  assert.deepEqual(rankSources(list, { minSizeGb: 15 }).map((x) => x.title[0]), ["A", "D", "B", "C"]);
  // Everything outside: still a pick, the best of them.
  assert.equal(pickIndex([s("A.2160p 60 GB"), s("C.1080p 40 GB")], { maxSizeGb: 8 }), 0);
  // A 4K source outside the limits does not start early.
  const d = decide({ candidates: [s("A.2160p 60 GB"), s("C.1080p 3 GB")], status: [], done: false, elapsedMs: 100, waitMs: 5000, rules: { maxSizeGb: 30 } });
  assert.ok("wait" in d);
});

test("provider order breaks ties of resolution, the providers' own order breaks the rest", () => {
  const list = [s("A.1080p", "fast"), s("B.2160p", "deep"), s("C.2160p", "fast"), s("D.2160p", "deep")];
  assert.deepEqual(rankSources(list).map((x) => x.title[0]), ["B", "C", "D", "A"]);
  assert.deepEqual(rankSources(list, { providerOrder: ["fast", "deep"] }).map((x) => x.title[0]), ["C", "B", "D", "A"]);
});

test("Require and Prefer: patterns rank first, an invalid one is ignored, and no match opens the sheet", async () => {
  const { compilePattern, patternLabel } = await import("../src/lib/rules.ts");
  assert.equal(compilePattern(""), null);
  assert.equal(compilePattern("MULTI("), "invalid");
  assert.match(patternLabel("MULTI("), /not a valid pattern, ignored/);
  const multi = compilePattern("multi|dual") as RegExp;
  const list = [s("A.2160p.EN 14 GB"), s("B.1080p.MULTI 4 GB"), s("C.2160p.REMUX 50 GB"), s("D.1080p.DUAL 2 GB")];
  assert.deepEqual(rankSources(list, { require: multi }).map((x) => x.title[0]), ["B", "D", "A", "C"]);
  assert.deepEqual(rankSources(list, { prefer: compilePattern("remux") as RegExp }).map((x) => x.title[0]), ["C", "A", "B", "D"]);
  const none = decide({ candidates: [list[0], list[2]], status: [], done: true, elapsedMs: 0, waitMs: 5000, rules: { require: multi } });
  assert.deepEqual(none, { sheet: "nothing autoplay may pick" });
  // Past the wait, while providers still search, one that matches may still come: wait for it, never play a mismatch.
  const later = decide({ candidates: [list[0]], status: [], done: false, elapsedMs: 9000, waitMs: 5000, rules: { require: multi } });
  assert.ok("wait" in later);
  // A 4K source that does not match does not start early.
  assert.ok("wait" in decide({ candidates: [list[0]], status: [], done: false, elapsedMs: 100, waitMs: 5000, rules: { require: multi } }));
});

test("notices never autoplay: last in the ranking, and only notices opens the sheet", () => {
  const notice: Stream = { name: "Configure this addon", title: "", url: "https://x.example/c", notice: true };
  const film = s("A.1080p 4 GB");
  assert.deepEqual(rankSources([notice, film]), [film, notice]);
  assert.deepEqual(decide({ candidates: [notice], status: [], done: true, elapsedMs: 0, waitMs: 5000 }), { sheet: "nothing autoplay may pick" });
});
