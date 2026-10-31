import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvplayPlayer, SEEK_SETTLE_MS } from "../src/player/avplay.ts";
import type { Avplay, AvplayListener, AvplayState } from "../src/player/webapis.ts";
import type { PlayerEvents } from "../src/player/types.ts";

/**
 * An AVPlay like the reference TV's: seekTo in IDLE sets where prepare starts, a seek on a prepared
 * stream is logged as "blocking seek" (it froze the page there), and prepare can be held open.
 */
function fakeAvplay(opts: { ignoresIdleSeek?: boolean } = {}) {
  const calls: string[] = [];
  let listener: AvplayListener = {};
  let state: AvplayState = "NONE";
  let posMs = 0;
  let held: { ok: () => void; err: (e: unknown) => void } | null = null;
  const f = {
    calls,
    hold: false,
    fire: () => listener,
    finishPrepare() {
      const h = held!;
      held = null;
      h.ok();
    },
    failPrepare() {
      const h = held!;
      held = null;
      h.err({ name: "PLAYER_ERROR_CONNECTION_FAILED" });
    },
    av: undefined as unknown as Avplay,
  };
  f.av = {
    open: () => { calls.push("open"); state = "IDLE"; posMs = 0; },
    close: () => { calls.push("close"); state = "NONE"; },
    prepareAsync: (ok, err) => {
      calls.push("prepare");
      const done = () => { state = "READY"; ok(); };
      if (f.hold) held = { ok: done, err };
      else done();
    },
    play: () => { calls.push("play"); state = "PLAYING"; },
    pause: () => { calls.push("pause"); state = "PAUSED"; },
    stop: () => { calls.push("stop"); },
    seekTo: (ms) => {
      if (state === "IDLE") {
        calls.push(`idle seek ${ms}`);
        if (!opts.ignoresIdleSeek) posMs = ms;
      } else {
        calls.push(`blocking seek ${ms}`);
        posMs = ms;
      }
    },
    getState: () => state,
    getDuration: () => 6_000_000,
    getCurrentTime: () => posMs,
    setDisplayRect: () => { calls.push("rect"); },
    setListener: (l) => { listener = l; },
    getTotalTrackInfo: () => [
      { index: 0, type: "VIDEO", extra_info: "{}" },
      { index: 1, type: "AUDIO", extra_info: "{}" },
    ],
  };
  return f;
}

type Fake = ReturnType<typeof fakeAvplay>;
const flush = () => new Promise((r) => setImmediate(r));

function make(f: Fake) {
  const times: number[] = [];
  const errors: string[] = [];
  const buffering: boolean[] = [];
  const events: PlayerEvents = {
    onTime: (pos) => times.push(pos),
    onEnded() {},
    onBuffering: (b) => buffering.push(b),
    onError: (m) => errors.push(m),
  };
  const doc = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const p = createAvplayPlayer({ api: { avplay: f.av }, events, screen: { width: 1920, height: 1080 }, doc });
  return { p, times, errors, buffering };
}

/** A player at 600 s, playing, with the call log cleared. */
async function playing(f: Fake) {
  const m = make(f);
  await m.p.load("http://x/a.mkv", 600);
  const started = m.p.start();
  f.fire().oncurrentplaytime?.(600_000);
  await started;
  f.calls.length = 0;
  return m;
}

/** Lets a reopen's prepare land and its first frame arrive. */
async function land(f: Fake, atMs: number) {
  f.finishPrepare();
  await flush();
  f.fire().oncurrentplaytime?.(atMs);
  await flush();
}

test("the resume point is set in IDLE before prepare, never by seeking the prepared stream", async () => {
  const f = fakeAvplay();
  const { p } = make(f);
  await p.load("http://x/a.mkv", 120);
  assert.deepEqual(f.calls, ["open", "idle seek 120000", "prepare"]);
  const started = p.start();
  f.fire().oncurrentplaytime?.(120_000);
  await started;
  assert.ok(!f.calls.some((c) => c.startsWith("blocking")));
  assert.equal(p.position(), 120);
});

test("firmware that ignores the IDLE seek still resumes, once a real duration is known", async () => {
  const f = fakeAvplay({ ignoresIdleSeek: true });
  const { p } = make(f);
  await p.load("http://x/a.mkv", 120);
  const started = p.start();
  f.fire().oncurrentplaytime?.(500);
  await started;
  assert.ok(f.calls.includes("blocking seek 120000"));
  assert.equal(p.position(), 120, "the early tick does not show 0:00");
});

test("seekBy waits for presses to settle, then reopens at the target and plays", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeAvplay();
  const { p, buffering } = await playing(f);
  f.hold = true;
  p.seekBy(-10);
  assert.equal(f.calls.length, 0, "nothing happens before the presses settle");
  t.mock.timers.tick(SEEK_SETTLE_MS);
  assert.deepEqual(f.calls, ["stop", "close", "open", "idle seek 590000", "prepare"]);
  assert.ok(p.isPlaying(), "still reported as playing while it reopens");
  await land(f, 590_000);
  assert.deepEqual(f.calls.slice(5), ["rect", "play"]);
  assert.ok(!f.calls.some((c) => c.startsWith("blocking")));
  assert.equal(p.position(), 590);
  assert.deepEqual(buffering, [true, false]);
});

test("rapid presses coalesce into one reopen at the last target, each shown at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeAvplay();
  const { p, times } = await playing(f);
  for (let i = 0; i < 6; i++) {
    p.seekBy(-10);
    t.mock.timers.tick(SEEK_SETTLE_MS - 50);
    f.fire().oncurrentplaytime?.(601_000);
  }
  t.mock.timers.tick(50);
  assert.deepEqual(f.calls.filter((c) => c.includes("seek")), ["idle seek 540000"]);
  assert.equal(p.position(), 540);
  const shown = times.slice(-12).filter((x, i, a) => x !== a[i - 1]);
  assert.deepEqual(shown, [590, 580, 570, 560, 550, 540], "old ticks re-show the target, never 601");
});

test("a press during a reopen reopens again at the newest target before anything plays", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeAvplay();
  const { p } = await playing(f);
  f.hold = true;
  p.seekBy(30);
  t.mock.timers.tick(SEEK_SETTLE_MS);
  p.seekBy(30);
  p.seekBy(30);
  t.mock.timers.tick(SEEK_SETTLE_MS);
  assert.equal(f.calls.filter((c) => c === "open").length, 1, "the busy reopen is not interrupted");
  f.finishPrepare();
  await flush();
  assert.ok(!f.calls.includes("play"));
  assert.ok(f.calls.includes("idle seek 690000"));
  await land(f, 690_000);
  assert.deepEqual(f.calls.filter((c) => c.includes("seek")), ["idle seek 630000", "idle seek 690000"]);
  assert.equal(f.calls.filter((c) => c === "play").length, 1);
});

test("a paused player stays paused at the target; OK then places the picture and plays", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeAvplay();
  const { p } = await playing(f);
  p.toggle();
  assert.equal(p.isPlaying(), false);
  p.seekBy(10);
  t.mock.timers.tick(SEEK_SETTLE_MS);
  await flush();
  assert.ok(!f.calls.includes("play"));
  p.toggle();
  assert.deepEqual(f.calls.slice(-2), ["rect", "play"]);
  assert.equal(p.isPlaying(), true);
});

test("OK during a reopen decides whether it plays when it lands", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeAvplay();
  const { p } = await playing(f);
  f.hold = true;
  p.seekBy(10);
  t.mock.timers.tick(SEEK_SETTLE_MS);
  p.toggle();
  assert.equal(p.isPlaying(), false);
  f.finishPrepare();
  await flush();
  assert.ok(!f.calls.includes("play"));
});

test("a reopen that fails to prepare reports an error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeAvplay();
  const { p, errors, buffering } = await playing(f);
  f.hold = true;
  p.seekBy(10);
  t.mock.timers.tick(SEEK_SETTLE_MS);
  f.failPrepare();
  await flush();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /CONNECTION_FAILED/);
  assert.deepEqual(buffering, [true, false]);
});

test("stop drops a seek waiting to settle, and one in progress", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakeAvplay();
  const { p, errors } = await playing(f);
  p.seekBy(10);
  p.stop();
  t.mock.timers.tick(SEEK_SETTLE_MS);
  assert.ok(!f.calls.includes("open"));

  const g = fakeAvplay();
  const m = await playing(g);
  g.hold = true;
  m.p.seekBy(10);
  t.mock.timers.tick(SEEK_SETTLE_MS);
  m.p.stop();
  g.finishPrepare();
  await flush();
  assert.ok(!g.calls.includes("play"));
  assert.deepEqual([...errors, ...m.errors], []);
});
