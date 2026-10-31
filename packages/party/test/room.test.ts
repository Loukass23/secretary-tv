import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, Room, type Out } from "../src/room.ts";
import { Close, parseClient, targetPos, type ServerMessage, type Timeline } from "../src/protocol.ts";

const release = { infoHash: "ab".repeat(20), fileIdx: 3, size: 4_000_000_000 };
const who = (n: string) => ({ id: `${n}:1`, name: n.toUpperCase(), color: "#336699" });

function setup(control: "host" | "shared" = "host") {
  const clock = { t: 1_000_000 };
  const now = () => clock.t;
  const room = Room.create(
    { code: "K7QX2M", control, host: who("h"), contentId: "tt0111161", title: "A film", release },
    now,
  );
  let k = 0;
  const join = (n: string) => room.join(who(n), { id: `ticket-${k++}`, exp: clock.t + 60_000 });
  const send = (n: string, msg: object) => room.receive(`${n}:1`, JSON.stringify(msg));
  const report = (n: string, phase: string, pos: number, extra: object = {}) =>
    send(n, { t: "state", rev: room.timeline.rev, phase, pos, at: clock.t, ...extra });
  const cmd = (n: string, op: string, extra: object = {}) =>
    send(n, { t: "cmd", op, base: room.timeline.rev, ...extra });
  const advance = (ms: number) => {
    clock.t += ms;
    room.tick();
  };
  return { room, clock, join, send, report, cmd, advance, drain: () => room.drain() };
}

const msgsTo = (out: Out[], id: string): ServerMessage[] =>
  out.flatMap((o) => ("msg" in o && ("all" in o || o.to === id) ? [o.msg] : []));
const errors = (out: Out[], id: string) =>
  msgsTo(out, id).filter((m): m is Extract<ServerMessage, { t: "error" }> => m.t === "error");
const closes = (out: Out[]) => out.flatMap((o) => ("close" in o ? [[o.close, o.code] as const] : []));
const member = (room: Room, n: string) => room.members().find((m) => m.id === `${n}:1`)!;

/** Host and a guest, both loaded and paused at the start. */
function pausedPair(control: "host" | "shared" = "host") {
  const r = setup(control);
  r.join("h");
  r.join("g");
  r.report("h", "paused", 0, { rtt: 200, startMs: 600 });
  r.report("g", "paused", 0, { rtt: 80, startMs: 300 });
  r.drain();
  return r;
}

/** Host and guest playing together from `pos0` 0. */
function playingPair(control: "host" | "shared" = "host") {
  const r = pausedPair(control);
  r.cmd("h", "play");
  r.report("h", "ready", 0);
  r.report("g", "ready", 0);
  assert.equal(r.room.timeline.state, "playing");
  r.clock.t = r.room.timeline.t0;
  r.report("h", "playing", 0);
  r.report("g", "playing", 0);
  r.drain();
  return r;
}

test("a new room is paused at the start and the host gets a welcome with it", () => {
  const { room, join, drain } = setup();
  assert.deepEqual(join("h"), { ok: true, replaced: false });
  const welcome = msgsTo(drain(), "h:1").find((m) => m.t === "welcome");
  assert.ok(welcome && welcome.t === "welcome");
  assert.equal(welcome.tl.state, "paused");
  assert.equal(welcome.tl.rev, 1);
  assert.deepEqual(welcome.tl.release, release);
  assert.equal(member(room, "h").host, true);
});

test("play waits for everyone to report ready, then starts a lead ahead sized by the slowest member", () => {
  const { room, clock, cmd, report, drain } = pausedPair();
  cmd("h", "play");
  assert.equal(room.timeline.state, "waiting");
  report("h", "ready", 0);
  assert.equal(room.timeline.state, "waiting", "the guest has not acknowledged yet");
  report("g", "ready", 0.4);
  const tl = room.timeline;
  assert.equal(tl.state, "playing");
  assert.equal(tl.cause, "ready");
  // host: 200/2 + 600 = 700 beats guest: 80/2 + 300; plus the margin.
  assert.equal(tl.t0, clock.t + 700 + LIMITS.leadMarginMs);
  assert.equal(tl.pos0, 0);
  const sent = msgsTo(drain(), "g:1").filter((m) => m.t === "timeline");
  assert.deepEqual(
    sent.map((m) => m.t === "timeline" && m.tl.state),
    ["waiting", "playing"],
  );
});

test("the lead is clamped between its bounds", () => {
  const fast = pausedPair();
  fast.report("h", "paused", 0, { rtt: 0, startMs: 0 });
  fast.report("g", "paused", 0, { rtt: 0, startMs: 0 });
  fast.cmd("h", "play");
  fast.report("h", "ready", 0);
  fast.report("g", "ready", 0);
  assert.equal(fast.room.timeline.t0 - fast.clock.t, LIMITS.leadMinMs);

  const slow = pausedPair();
  slow.report("g", "paused", 0, { rtt: 4000, startMs: 5000 });
  slow.cmd("h", "play");
  slow.report("h", "ready", 0);
  slow.report("g", "ready", 0);
  assert.equal(slow.room.timeline.t0 - slow.clock.t, LIMITS.leadMaxMs);
});

test("a member positioned too far from the start point is not ready", () => {
  const { room, cmd, report } = pausedPair();
  cmd("h", "play");
  report("h", "ready", 0);
  report("g", "ready", 5);
  assert.equal(room.timeline.state, "waiting");
  report("g", "ready", 0.2);
  assert.equal(room.timeline.state, "playing");
});

test("targetPos holds before t0 and runs after it", () => {
  const { room, clock } = playingPair();
  const tl = room.timeline;
  assert.equal(targetPos(tl, tl.t0 - 500), 0);
  assert.equal(targetPos(tl, tl.t0 + 12_500), 12.5);
  assert.equal(targetPos({ ...tl, state: "paused" }, clock.t + 99_000), 0);
});

test("a command based on a rev older than someone else's command is rejected as stale", () => {
  const { room, send, cmd, drain } = playingPair("shared");
  const seen = room.timeline.rev;
  cmd("h", "pause");
  assert.equal(room.timeline.state, "paused");
  drain();
  // The guest pressed seek before the pause reached it.
  send("g", { t: "cmd", op: "seek", base: seen, pos: 300 });
  const out = drain();
  const [err] = errors(out, "g:1");
  assert.equal(err.code, "stale");
  assert.equal(err.op, "seek");
  assert.equal(err.tl?.state, "paused", "the rejection carries the current timeline");
  assert.equal(room.timeline.pos0 < 300, true);
});

test("a sender's own earlier command does not make its next one stale", () => {
  const { room, send } = playingPair();
  const seen = room.timeline.rev;
  send("h", { t: "cmd", op: "pause", base: seen });
  send("h", { t: "cmd", op: "seek", base: seen, pos: 120 });
  assert.equal(room.timeline.state, "paused");
  assert.equal(room.timeline.pos0, 120);
});

test("server-made changes (the scheduled start) do not make commands stale", () => {
  const { room, send, cmd, report } = pausedPair("shared");
  cmd("h", "play");
  const waitingRev = room.timeline.rev;
  report("h", "ready", 0);
  report("g", "ready", 0);
  assert.equal(room.timeline.state, "playing");
  send("g", { t: "cmd", op: "pause", base: waitingRev });
  assert.equal(room.timeline.state, "paused");
});

test("in host-only rooms guests cannot command; in shared rooms they can, but only the host can end", () => {
  const hostOnly = playingPair("host");
  hostOnly.cmd("g", "pause");
  assert.equal(errors(hostOnly.drain(), "g:1")[0].code, "forbidden");
  assert.equal(hostOnly.room.timeline.state, "playing");

  const shared = playingPair("shared");
  shared.cmd("g", "pause");
  assert.equal(shared.room.timeline.state, "paused");
  assert.equal(shared.room.timeline.by, "g:1");
  shared.cmd("g", "end");
  assert.equal(errors(shared.drain(), "g:1")[0].code, "forbidden");
});

test("a pause lands on the model position at the moment it arrives", () => {
  const { room, clock, cmd } = playingPair();
  const t0 = room.timeline.t0;
  clock.t = t0 + 61_000;
  cmd("h", "pause");
  assert.equal(room.timeline.state, "paused");
  assert.equal(room.timeline.pos0, 61);
});

test("a pause keeps the pauser's own position when close to the model, and the model's when not", () => {
  const near = playingPair();
  near.clock.t = near.room.timeline.t0 + 30_000;
  near.cmd("h", "pause", { pos: 29.2 });
  assert.equal(near.room.timeline.pos0, 29.2);

  const far = playingPair();
  far.clock.t = far.room.timeline.t0 + 30_000;
  far.cmd("h", "pause", { pos: 12 });
  assert.equal(far.room.timeline.pos0, 30);
});

test("a pause before the scheduled start lands on the start point", () => {
  const { room, cmd, report } = pausedPair();
  cmd("h", "seek", { pos: 90 });
  report("h", "paused", 90);
  report("g", "paused", 90);
  cmd("h", "play");
  report("h", "ready", 90);
  report("g", "ready", 90);
  assert.equal(room.timeline.state, "playing");
  cmd("h", "pause");
  assert.equal(room.timeline.pos0, 90);
});

test("seeking while paused stays paused; seeking while playing waits and restarts at the target", () => {
  const { room, cmd, report } = playingPair();
  cmd("h", "seek", { pos: 600 });
  assert.equal(room.timeline.state, "waiting");
  assert.equal(room.timeline.pos0, 600);
  report("h", "ready", 600);
  report("g", "ready", 600.3);
  assert.equal(room.timeline.state, "playing");
  assert.equal(room.timeline.pos0, 600);
  cmd("h", "pause");
  cmd("h", "seek", { pos: 30 });
  assert.equal(room.timeline.state, "paused");
  assert.equal(room.timeline.pos0, 30);
  cmd("h", "seek", { pos: -1 });
  assert.equal(room.timeline.pos0, 30);
});

test("a short buffering blip does not pause the room", () => {
  const { room, advance, report } = playingPair();
  advance(5_000);
  report("g", "buffering", 4.8);
  advance(LIMITS.stallGraceMs - 100);
  report("g", "playing", 6.3);
  advance(1_000);
  assert.equal(room.timeline.state, "playing");
});

test("a stall past the grace freezes the room where it is and resumes once the staller is ready", () => {
  const { room, clock, advance, report } = playingPair();
  const t0 = room.timeline.t0;
  advance(20_000);
  report("g", "buffering", 19.5);
  assert.equal(room.nextWake(), clock.t + LIMITS.stallGraceMs);
  advance(LIMITS.stallGraceMs);
  const tl = room.timeline;
  assert.equal(tl.state, "waiting");
  assert.equal(tl.cause, "stall");
  assert.equal(tl.pos0, (clock.t - t0) / 1000);
  assert.equal(tl.until, clock.t + LIMITS.bufferWaitMs);
  report("h", "paused", tl.pos0);
  assert.equal(room.timeline.state, "waiting");
  advance(3_000);
  report("g", "ready", tl.pos0 - 0.3);
  assert.equal(room.timeline.state, "playing");
  assert.equal(room.timeline.pos0, tl.pos0);
  assert.equal(member(room, "g").status, "synced");
});

test("buffering during the lead before the start is preparation, not a stall", () => {
  const { room, clock, cmd, report } = pausedPair();
  cmd("h", "play");
  report("h", "ready", 0);
  report("g", "ready", 0);
  const t0 = room.timeline.t0;
  report("g", "buffering", 0);
  clock.t = t0 - 1;
  room.tick();
  assert.equal(room.timeline.state, "playing");
  assert.equal(room.nextWake()! >= t0, true);
});

test("a member that never gets ready is left to catch up alone when the wait runs out", () => {
  const { room, clock, advance, report, drain } = playingPair();
  advance(10_000);
  report("g", "buffering", 9.9);
  advance(LIMITS.stallGraceMs);
  const frozen = room.timeline.pos0;
  report("h", "paused", frozen);
  advance(LIMITS.bufferWaitMs - 1);
  assert.equal(room.timeline.state, "waiting");
  drain();
  advance(1);
  assert.equal(room.timeline.state, "playing");
  assert.equal(room.timeline.cause, "timeout");
  assert.equal(member(room, "g").status, "catching_up");
  // The lead now only covers the host.
  assert.equal(room.timeline.t0, clock.t + 200 / 2 + 600 + LIMITS.leadMarginMs);
  const members = msgsTo(drain(), "h:1").filter((m) => m.t === "members");
  assert.equal(members.length > 0, true);

  // It catches up: in step once it plays within tolerance of the target.
  clock.t = room.timeline.t0 + 15_000;
  report("g", "playing", frozen + 11);
  assert.equal(member(room, "g").status, "catching_up");
  report("g", "playing", frozen + 14.5);
  assert.equal(member(room, "g").status, "synced");
});

test("a catching-up member's stalls do not pause anyone", () => {
  const { room, advance, report } = playingPair();
  advance(1_000);
  report("g", "buffering", 0.5);
  advance(LIMITS.stallGraceMs);
  report("h", "paused", room.timeline.pos0);
  advance(LIMITS.bufferWaitMs);
  assert.equal(member(room, "g").status, "catching_up");
  advance(5_000);
  report("g", "buffering", 1);
  advance(LIMITS.stallGraceMs * 3);
  assert.equal(room.timeline.state, "playing");
});

test("a member that keeps stalling stops freezing the room and catches up alone", () => {
  const { room, clock, advance, report } = playingPair();
  for (let i = 0; i < LIMITS.stallStrikes; i++) {
    advance(5_000);
    report("g", "buffering", 1);
    advance(LIMITS.stallGraceMs);
    assert.equal(room.timeline.state, "waiting", `stall ${i + 1} freezes`);
    report("h", "paused", room.timeline.pos0);
    report("g", "ready", room.timeline.pos0);
    assert.equal(room.timeline.state, "playing");
    clock.t = room.timeline.t0;
  }
  advance(5_000);
  report("g", "buffering", 1);
  advance(LIMITS.stallGraceMs);
  assert.equal(room.timeline.state, "playing");
  assert.equal(member(room, "g").status, "catching_up");
});

test("a late joiner catches up alone and does not hold up the next start", () => {
  const { room, clock, join, report, cmd, drain } = playingPair();
  clock.t += 40_000;
  join("late");
  const out = drain();
  const welcome = msgsTo(out, "late:1").find((m) => m.t === "welcome");
  assert.ok(welcome && welcome.t === "welcome");
  assert.equal(welcome.tl.state, "playing");
  assert.equal(welcome.now, clock.t);
  assert.equal(member(room, "late").status, "catching_up");

  cmd("h", "seek", { pos: 900 });
  report("h", "ready", 900);
  report("g", "ready", 900);
  assert.equal(room.timeline.state, "playing", "the start did not wait for the late joiner");
});

test("a late joiner in a paused room is in sync and is waited for", () => {
  const { room, join, cmd, report } = pausedPair();
  join("late");
  assert.equal(member(room, "late").status, "synced");
  cmd("h", "play");
  report("h", "ready", 0);
  report("g", "ready", 0);
  assert.equal(room.timeline.state, "waiting");
  report("late", "ready", 0);
  assert.equal(room.timeline.state, "playing");
});

test("a member reporting against an old rev does not count as ready", () => {
  const { room, send, cmd, report } = pausedPair();
  const old = room.timeline.rev;
  cmd("h", "play");
  report("h", "ready", 0);
  send("g", { t: "state", rev: old, phase: "ready", pos: 0, at: 0 });
  assert.equal(room.timeline.state, "waiting");
});

test("a member leaving mid-wait lets the start go ahead", () => {
  const { room, cmd, report } = pausedPair();
  cmd("h", "play");
  report("h", "ready", 0);
  room.leave("g:1");
  assert.equal(room.timeline.state, "playing");
});

test("an absent host keeps the role through the grace period, then the longest-present member takes it", () => {
  const { room, join, advance, report, drain } = playingPair();
  join("third");
  room.leave("h:1");
  assert.equal(member(room, "h").connected, false);
  assert.equal(room.hostId, "h:1");
  advance(LIMITS.hostGraceMs - 1);
  report("g", "playing", 1);
  assert.equal(room.hostId, "h:1");
  drain();
  advance(1);
  assert.equal(room.hostId, "g:1");
  assert.equal(member(room, "g").host, true);
  assert.equal(room.members().some((m) => m.id === "h:1"), false);
  assert.equal(msgsTo(drain(), "third:1").some((m) => m.t === "members"), true);
  // The old host can come back as a guest.
  join("h");
  assert.equal(member(room, "h").host, false);
});

test("a host that reconnects within the grace keeps the role", () => {
  const { room, join, advance, report } = playingPair();
  room.leave("h:1");
  advance(10_000);
  report("g", "playing", 1);
  assert.deepEqual(join("h"), { ok: true, replaced: false });
  advance(LIMITS.hostGraceMs);
  assert.equal(room.hostId, "h:1");
});

test("the host can hand over the role", () => {
  const { room, send, drain } = playingPair();
  send("g", { t: "host", to: "g:1" });
  assert.equal(errors(drain(), "g:1")[0].code, "forbidden");
  send("h", { t: "host", to: "nobody:1" });
  assert.equal(errors(drain(), "h:1")[0].code, "no_member");
  send("h", { t: "host", to: "g:1" });
  assert.equal(room.hostId, "g:1");
});

test("next switches the release for everyone, waits longer, and puts catching-up members back in sync", () => {
  const { room, clock, advance, report, cmd, drain } = playingPair();
  advance(1_000);
  report("g", "buffering", 0.5);
  advance(LIMITS.stallGraceMs);
  report("h", "paused", room.timeline.pos0);
  advance(LIMITS.bufferWaitMs);
  assert.equal(member(room, "g").status, "catching_up");

  const next = { infoHash: "cd".repeat(20), fileIdx: 0, size: 2_000_000_000 };
  cmd("h", "next", { contentId: "tt0903747:1:2", title: "Episode 2", release: { ...next, url: "https://x/y" } });
  const tl = room.timeline;
  assert.equal(tl.state, "waiting");
  assert.equal(tl.contentId, "tt0903747:1:2");
  assert.equal(tl.contentRev, tl.rev);
  assert.deepEqual(tl.release, next, "only the fingerprint is kept");
  assert.equal(tl.until, clock.t + LIMITS.loadWaitMs);
  assert.equal(member(room, "g").status, "synced");
  drain();
  report("h", "ready", 0);
  report("g", "ready", 0);
  assert.equal(room.timeline.state, "playing");
});

test("next without a valid fingerprint is a bad message", () => {
  const { room, cmd, drain } = playingPair();
  cmd("h", "next", { contentId: "tt1", release: { url: "https://cdn/file.mkv" } });
  assert.equal(errors(drain(), "h:1")[0].code, "bad_message");
  assert.equal(room.timeline.contentId, "tt0111161");
});

test("end closes every member with the ended code and the room refuses joins after", () => {
  const { room, cmd, join, drain } = playingPair();
  cmd("h", "end");
  const out = drain();
  assert.deepEqual(closes(out).sort(), [
    ["g:1", Close.Ended],
    ["h:1", Close.Ended],
  ]);
  assert.equal(room.finished, true);
  assert.equal(room.nextWake(), undefined);
  const res = join("x");
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.code, Close.NotFound);
});

test("a ticket works once, the room has a member cap, and a reconnect replaces the old connection", () => {
  const { room, clock } = setup();
  const ticket = { id: "same", exp: clock.t + 60_000 };
  assert.equal(room.join(who("h"), ticket).ok, true);
  const again = room.join(who("h"), ticket);
  assert.equal(!again.ok && again.code, Close.BadTicket);
  assert.equal(room.join(who("h"), { id: "old", exp: clock.t }).ok, false, "expired ticket");
  assert.deepEqual(room.join(who("h"), { id: "fresh", exp: clock.t + 1 }), { ok: true, replaced: true });

  for (let i = 1; i < LIMITS.maxMembers; i++) assert.equal(room.join(who(`m${i}`), { id: `t${i}`, exp: clock.t + 1 }).ok, true);
  const full = room.join(who("extra"), { id: "tx", exp: clock.t + 1 });
  assert.equal(!full.ok && full.code, Close.Full);
  assert.equal(room.summary().full, true);
});

test("commands and reactions are rate limited; a flood closes the connection", () => {
  const { room, send, cmd, drain } = playingPair("shared");
  cmd("g", "pause");
  cmd("g", "play");
  cmd("g", "pause");
  drain();
  cmd("g", "play");
  assert.equal(errors(drain(), "g:1")[0].code, "rate_limited");

  for (let i = 0; i < LIMITS.reactBucket.cap; i++) send("h", { t: "react", emoji: "laugh" });
  const reacts = msgsTo(drain(), "g:1").filter((m) => m.t === "react");
  assert.equal(reacts.length, LIMITS.reactBucket.cap);
  send("h", { t: "react", emoji: "laugh" });
  assert.equal(errors(drain(), "h:1")[0].code, "rate_limited");

  for (let i = 0; i < LIMITS.msgBucket.cap + 1; i++) send("g", { t: "ping", id: i, c: 0 });
  assert.deepEqual(closes(drain()), [["g:1", Close.RateLimited]]);
  assert.equal(room.members().some((m) => m.id === "g:1"), false);
});

test("repeated malformed messages close the connection", () => {
  const { room, drain } = playingPair();
  for (let i = 0; i < LIMITS.maxBadMessages; i++) room.receive("g:1", "{nope");
  assert.deepEqual(closes(drain()), [["g:1", Close.Protocol]]);
});

test("pings answer with the server time", () => {
  const { clock, send, drain } = playingPair();
  send("g", { t: "ping", id: 7, c: 123 });
  assert.deepEqual(msgsTo(drain(), "g:1").at(-1), { t: "pong", id: 7, c: 123, s: clock.t });
});

test("silent members are dropped, and an empty room expires", () => {
  const { room, clock, advance, drain } = playingPair();
  assert.equal(room.nextWake(), clock.t + LIMITS.idleMs);
  advance(LIMITS.idleMs);
  assert.deepEqual(
    closes(drain()).sort(),
    [
      ["g:1", Close.Idle],
      ["h:1", Close.Idle],
    ],
  );
  assert.equal(room.finished, false);
  advance(LIMITS.emptyTtlMs);
  assert.equal(room.finished, true);
});

test("a room never outlives its maximum age", () => {
  const { room, clock, report, drain } = playingPair();
  clock.t += LIMITS.maxAgeMs;
  report("h", "playing", 1);
  report("g", "playing", 1);
  room.tick();
  assert.equal(room.finished, true);
  assert.equal(closes(drain()).every(([, c]) => c === Close.Expired), true);
});

test("a room restored from its JSON snapshot carries on", () => {
  const r = playingPair();
  r.cmd("h", "seek", { pos: 42 });
  const json = JSON.parse(JSON.stringify(r.room.snapshot()));
  const room = new Room(json, () => r.clock.t);
  room.receive("h:1", JSON.stringify({ t: "state", rev: room.timeline.rev, phase: "ready", pos: 42, at: r.clock.t }));
  room.receive("g:1", JSON.stringify({ t: "state", rev: room.timeline.rev, phase: "ready", pos: 42, at: r.clock.t }));
  assert.equal(room.timeline.state, "playing");
  assert.equal((room.timeline as Timeline).pos0, 42);
});

test("parseClient keeps only known fields and rejects links in place of a fingerprint", () => {
  assert.equal(parseClient('{"t":"react","emoji":"<script>"}'), null);
  assert.equal(parseClient('{"t":"cmd","op":"warp","base":1}'), null);
  assert.equal(parseClient('{"t":"state","rev":1,"phase":"ready","pos":"1","at":0}'), null);
  assert.deepEqual(parseClient('{"t":"ping","id":1,"c":2,"extra":true}'), { t: "ping", id: 1, c: 2 });
  assert.equal(
    parseClient(JSON.stringify({ t: "cmd", op: "next", base: 1, contentId: "tt1", release: { ...release, infoHash: "XYZ" } })),
    null,
  );
  assert.equal(parseClient("x".repeat(5000)), null);
});
