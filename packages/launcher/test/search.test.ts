import { test } from "node:test";
import assert from "node:assert/strict";
import { liveSearch, type LiveSearchState, type Timers } from "../src/live-search.ts";
import { typeCode, watchPhone } from "../src/phone-keys.ts";
import { backFrom, clamp, KEY_ROWS, type SearchLens, START, step, typeKey } from "../src/search-nav.ts";

/** A clock the test moves by hand: timers fire only in `advance`. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void due.delete(h as number),
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const first = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      due.delete(first[0]);
      now = first[1].at;
      first[1].fn();
      await flush();
    }
    now = end;
    await flush();
  };
  return { timers, now: () => now, advance };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

/** A search whose requests the test answers by hand. */
function harness(wait = 300) {
  const clock = fakeClock();
  const asked: { q: string; signal: AbortSignal; answer(r: string[]): void; fail(): void }[] = [];
  const states: LiveSearchState<string>[] = [];
  const s = liveSearch<string>({
    wait,
    timers: clock.timers,
    now: clock.now,
    find: (q, signal) =>
      new Promise((resolve, reject) => {
        asked.push({ q, signal, answer: resolve, fail: () => reject(new Error("down")) });
      }),
    onChange: (st) => states.push(st),
  });
  const last = () => states[states.length - 1];
  return { s, clock, asked, states, last };
}

/** Types `text` one key every `gap` ms. */
async function type(h: ReturnType<typeof harness>, text: string, gap: number) {
  for (let i = 1; i <= text.length; i++) {
    h.s.set(text.slice(0, i));
    await h.clock.advance(gap);
  }
}

test("live search: typing fast asks at most once per window, and always for the last text", async () => {
  const h = harness(300);
  // Nine keys, 80 ms apart: 720 ms of typing.
  await type(h, "the quiet", 80);
  await h.clock.advance(400);
  const qs = h.asked.map((a) => a.q);
  assert.ok(qs.length <= 4, `asked ${qs.length} times: ${qs.join(" | ")}`);
  assert.ok(qs.length < "the quiet".length - 1);
  assert.equal(qs[qs.length - 1], "the quiet");
  // One key is never a request.
  assert.ok(!qs.includes("t"));
});

test("live search: a newer request aborts the one running", async () => {
  const h = harness(300);
  h.s.set("du");
  await h.clock.advance(0);
  assert.equal(h.asked.length, 1);
  h.s.set("dun");
  await h.clock.advance(300);
  assert.equal(h.asked.length, 2);
  assert.equal(h.asked[0].signal.aborted, true);
  assert.equal(h.asked[1].signal.aborted, false);
});

test("live search: a stale answer never replaces a newer one", async () => {
  const h = harness(300);
  h.s.set("du");
  await h.clock.advance(0);
  h.s.set("dune");
  await h.clock.advance(300);
  const [old, fresh] = h.asked;
  fresh.answer(["Dune"]);
  await flush();
  // The older request answers last (its server ignored the abort): dropped.
  old.answer(["Dumbo", "Dunkirk"]);
  await flush();
  assert.deepEqual(h.last().results, ["Dune"]);
  assert.equal(h.last().answered, "dune");
  assert.equal(h.last().searching, false);
});

test("live search: an answer for an earlier text shows while the latest is still coming", async () => {
  const h = harness(300);
  h.s.set("qu");
  await h.clock.advance(0);
  h.asked[0].answer(["Quiet Harbour", "Quarry"]);
  await flush();
  h.s.set("qui");
  assert.deepEqual(h.last().results, ["Quiet Harbour", "Quarry"]);
  assert.equal(h.last().answered, "qu");
  assert.equal(h.last().searching, true);
});

test("live search: Delete back to an earlier text reuses its answer without asking", async () => {
  const h = harness(300);
  h.s.set("ha");
  await h.clock.advance(0);
  h.asked[0].answer(["Harbour"]);
  await flush();
  h.s.set("har");
  await h.clock.advance(300);
  h.asked[1].answer(["Harbour Lights"]);
  await flush();
  h.s.set("ha");
  await h.clock.advance(1000);
  assert.equal(h.asked.length, 2);
  assert.deepEqual(h.last().results, ["Harbour"]);
  assert.equal(h.last().searching, false);
});

test("live search: clearing the field cancels what is running and empties the results", async () => {
  const h = harness(300);
  h.s.set("ha");
  await h.clock.advance(0);
  h.s.set("");
  assert.equal(h.asked[0].signal.aborted, true);
  h.asked[0].answer(["Harbour"]);
  await flush();
  assert.deepEqual(h.last().results, []);
  assert.equal(h.last().searching, false);
});

test("live search: a failed request says so, and a later one recovers", async () => {
  const h = harness(300);
  h.s.set("ha");
  await h.clock.advance(0);
  h.asked[0].fail();
  await flush();
  assert.equal(h.last().failed, true);
  h.s.set("har");
  await h.clock.advance(300);
  h.asked[1].answer(["Harbour"]);
  await flush();
  assert.equal(h.last().failed, false);
  assert.deepEqual(h.last().results, ["Harbour"]);
});

test("live search: nothing is asked or reported after dispose", async () => {
  const h = harness(300);
  h.s.set("ha");
  await h.clock.advance(0);
  const n = h.states.length;
  h.s.dispose();
  assert.equal(h.asked[0].signal.aborted, true);
  h.asked[0].answer(["Harbour"]);
  h.s.set("harb");
  await h.clock.advance(1000);
  assert.equal(h.asked.length, 1);
  assert.equal(h.states.length, n);
});

const lens = (o: Partial<SearchLens> = {}): SearchLens => ({
  results: 0,
  recent: 0,
  buttons: 7,
  home: 1,
  lastKey: { row: 0, col: 0 },
  lastResult: 0,
  ...o,
});

test("search keys: the wide last row maps columns both ways", () => {
  const last = KEY_ROWS.length - 1;
  assert.deepEqual(step({ area: "keys", row: last - 1, col: 5 }, "Down", lens()), { area: "keys", row: last, col: 2 });
  assert.deepEqual(step({ area: "keys", row: last, col: 1 }, "Up", lens()), { area: "keys", row: last - 1, col: 2 });
  assert.deepEqual(step(START, "Up", lens()), { area: "header", i: 1 });
});

test("search keys: Left off the keyboard goes to the results, Right off the results comes back", () => {
  const l = lens({ results: 10, lastResult: 5, lastKey: { row: 3, col: 2 } });
  // The rightmost tile of the row last focused (row 1: tiles 4 to 7).
  assert.deepEqual(step({ area: "keys", row: 3, col: 0 }, "Left", l), { area: "results", i: 7 });
  assert.deepEqual(step({ area: "results", i: 7 }, "Right", l), { area: "keys", row: 3, col: 0 });
  // A short last row: Down from above it lands on its last tile.
  assert.deepEqual(step({ area: "results", i: 7 }, "Down", l), { area: "results", i: 9 });
  assert.deepEqual(step({ area: "results", i: 2 }, "Up", l), { area: "header", i: 1 });
  // No results, recent searches shown: Left goes to them.
  assert.deepEqual(step({ area: "keys", row: 2, col: 0 }, "Left", lens({ recent: 4 })), { area: "recent", i: 2 });
});

test("search keys: focus leaves results that went away", () => {
  assert.deepEqual(clamp({ area: "results", i: 8 }, lens({ results: 3 })), { area: "results", i: 2 });
  assert.deepEqual(clamp({ area: "results", i: 0 }, lens({ lastKey: { row: 4, col: 3 } })), { area: "keys", row: 4, col: 0 });
});

test("search keys: typing", () => {
  assert.equal(typeKey("", "space"), "");
  assert.equal(typeKey("the", "space"), "the ");
  assert.equal(typeKey("the ", "space"), "the ");
  assert.equal(typeKey("the", "delete"), "th");
  assert.equal(typeKey("the", "clear"), "");
  assert.equal(typeKey("the", "q"), "theq");
});

test("phone keyboard: codes are long and from a safe alphabet", () => {
  const code = typeCode();
  assert.match(code, /^[a-z0-9]{16}$/);
  assert.notEqual(typeCode(), code);
});

test("phone keyboard: the TV takes each new text once, and stops asking when closed", async () => {
  const clock = fakeClock();
  const answers = [
    { text: "", rev: 0 },
    { text: "the q", rev: 1 },
    { text: "the q", rev: 1 },
    { text: "the quiet", rev: 2 },
  ];
  let calls = 0;
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const body = answers[Math.min(calls++, answers.length - 1)];
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  const got: string[] = [];
  const stop = watchPhone("http://192.0.2.10:7000", "abcdefghjkmn2345", (t) => got.push(t), { every: 500, fetch: f, timers: clock.timers });
  await clock.advance(2000);
  assert.deepEqual(got, ["the q", "the quiet"]);
  assert.equal(urls[0], "http://192.0.2.10:7000/type/abcdefghjkmn2345/text");
  stop();
  const before = calls;
  await clock.advance(5000);
  assert.equal(calls, before);
});

test("search keys: one Back leaves, whatever is typed or focused; from the header it comes down to the keys", () => {
  assert.equal(backFrom(START), "close");
  assert.equal(backFrom({ area: "results", i: 5 }), "close");
  assert.equal(backFrom({ area: "recent", i: 0 }), "close");
  assert.equal(backFrom({ area: "header", i: 1 }), "keys");
});
