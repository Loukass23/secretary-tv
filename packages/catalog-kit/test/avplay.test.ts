import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvplayPlayer, fitRect } from "../src/player/avplay.ts";
import type { Avplay, AvplayListener, AvplayState, AvplayTrack } from "../src/player/webapis.ts";
import type { PlayerEvents } from "../src/player/types.ts";

function stub(tracks: AvplayTrack[], opts: { prepareError?: boolean; durationMs?: number } = {}) {
  const calls: string[] = [];
  let listener: AvplayListener = {};
  let state: AvplayState = "NONE";
  const av: Avplay = {
    open: (u) => { calls.push(`open ${u}`); state = "IDLE"; },
    close: () => { calls.push("close"); state = "NONE"; },
    prepareAsync: (ok, err) => {
      calls.push("prepare");
      if (opts.prepareError) err({ name: "PLAYER_ERROR_INVALID_URI" });
      else { state = "READY"; ok(); }
    },
    play: () => { calls.push("play"); state = "PLAYING"; },
    pause: () => { state = "PAUSED"; },
    stop: () => { calls.push("stop"); },
    seekTo: (ms) => { calls.push(`seek ${ms}`); },
    getState: () => state,
    getDuration: () => opts.durationMs ?? 6_000_000,
    getCurrentTime: () => 0,
    setDisplayRect: (x, y, w, h) => { calls.push(`rect ${x},${y},${w},${h}`); },
    setListener: (l) => { listener = l; },
    getTotalTrackInfo: () => tracks,
  };
  return { av, calls, fire: () => listener };
}

const video: AvplayTrack = { index: 0, type: "VIDEO", extra_info: JSON.stringify({ Width: 3840, Height: 1606 }) };
const audio: AvplayTrack = { index: 1, type: "AUDIO", extra_info: "{}" };

function make(s: ReturnType<typeof stub>) {
  const events: PlayerEvents = { onTime() {}, onEnded() {}, onBuffering() {}, onError() {} };
  const doc = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  return createAvplayPlayer({ api: { avplay: s.av }, events, screen: { width: 1920, height: 1080 }, doc });
}

test("fitRect letterboxes a 2.39:1 picture inside 16:9", () => {
  assert.deepEqual(fitRect({ x: 0, y: 0, w: 1920, h: 1080 }, 3840, 1606), { x: 0, y: 138, w: 1920, h: 803 });
  assert.deepEqual(fitRect({ x: 0, y: 0, w: 1920, h: 1080 }, 0, 0), { x: 0, y: 0, w: 1920, h: 1080 });
});

test("load prepares without playing; start plays and resolves at the first time tick", async () => {
  const s = stub([video, audio]);
  const p = make(s);
  await p.load("http://x/a.mkv", 0);
  assert.ok(!s.calls.includes("play"));
  const started = p.start();
  assert.ok(s.calls.includes("play"));
  s.fire().oncurrentplaytime?.(1000);
  await started;
  assert.equal(p.position(), 1);
});

test("a player that is only preparing never sets the display; start sets it before play", async () => {
  const s = stub([video, audio]);
  const p = make(s);
  await p.load("http://x/a.mkv", 0);
  assert.ok(!s.calls.some((c) => c.startsWith("rect")));
  const started = p.start();
  const rectAt = s.calls.findIndex((c) => c.startsWith("rect"));
  assert.ok(rectAt >= 0 && rectAt < s.calls.indexOf("play"));
  assert.ok(s.calls[rectAt].endsWith("0,138,1920,803"));
  s.fire().oncurrentplaytime?.(1000);
  await started;
});

test("a picture with no audio track fails so the next source is tried", async () => {
  const p = make(stub([video]));
  await assert.rejects(p.load("http://x/a.mkv", 0), /no playable audio/);
});

test("a prepare error rejects with the AVPlay error name", async () => {
  const p = make(stub([video, audio], { prepareError: true }));
  await assert.rejects(p.load("http://x/a.mkv", 0), /INVALID_URI/);
});

test("resume seeks only once a real duration is known", async () => {
  const s = stub([video, audio]);
  const p = make(s);
  await p.load("http://x/a.mkv", 120);
  const started = p.start();
  s.fire().oncurrentplaytime?.(500);
  await started;
  assert.ok(s.calls.includes("seek 120000"));
});

test("stop releases the decoder and ignores late callbacks", async () => {
  const s = stub([video, audio]);
  const p = make(s);
  await p.load("http://x/a.mkv", 0);
  const l = s.fire();
  p.stop();
  assert.ok(s.calls.includes("close"));
  const before = p.position();
  l.oncurrentplaytime?.(9000);
  assert.equal(p.position(), before);
});

test("a reopen after restore() gives the picture back, paused, and resumes at the saved spot", async () => {
  const s = stub([video, audio]);
  let wake: () => void = () => {};
  const doc = {
    visibilityState: "visible",
    addEventListener: (_t: "visibilitychange", f: () => void) => { wake = f; },
    removeEventListener() {},
  };
  const events: PlayerEvents = { onTime() {}, onEnded() {}, onBuffering() {}, onError() {} };
  const p = createAvplayPlayer({ api: { avplay: { ...s.av, suspend() {}, restore() {} } }, events, screen: { width: 1920, height: 1080 }, doc });
  await p.load("http://x/a.mkv", 0);
  const started = p.start();
  s.fire().oncurrentplaytime?.(90_000);
  await started;
  doc.visibilityState = "hidden";
  wake();
  // restore() leaves AVPlay idle: the player reopens the source.
  s.av.close();
  s.calls.length = 0;
  doc.visibilityState = "visible";
  wake();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(s.calls.some((c) => c.startsWith("rect")), "display set again");
  assert.ok(!s.calls.includes("play"), "stays paused");
  p.toggle();
  s.fire().oncurrentplaytime?.(0);
  assert.ok(s.calls.includes("seek 90000"));
});

test("a source another player left open is closed before this one opens (one AVPlay)", async () => {
  const s = stub([video, audio]);
  const first = make(s);
  await first.load("http://x/a.mkv", 0);
  // The first player is abandoned with AVPlay prepared (a source that failed after prepare, or a prepare-ahead).
  s.calls.length = 0;
  const second = make(s);
  await second.load("http://x/b.mkv", 0);
  assert.deepEqual(s.calls.slice(0, 3), ["stop", "close", "open http://x/b.mkv"]);
});
