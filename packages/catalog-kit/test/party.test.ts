import { test } from "node:test";
import assert from "node:assert/strict";
import type { MemberView, ServerMessage, Timeline } from "@secretary/party/src/protocol.ts";
import { contentApp, createPartyApi, PartyHttpError } from "@secretary/party/src/client.ts";
import { createPartySession, PARTY, releaseOf, sizeBytes, type SocketLike, streamFor } from "../src/lib/party.ts";
import { createFollower, type PartyPlayer } from "../src/lib/partyplay.ts";
import type { Phase } from "@secretary/party/src/protocol.ts";

const HASH = "a".repeat(40);
const tl = (over: Partial<Timeline> = {}): Timeline => ({
  rev: 1,
  state: "paused",
  pos0: 0,
  t0: 0,
  contentId: "tt1",
  title: "Film",
  release: { infoHash: HASH, fileIdx: 0, size: 1 },
  contentRev: 1,
  cause: "create",
  ...over,
});
const member = (id: string, host = false): MemberView => ({
  id,
  name: id,
  color: "#fff",
  host,
  status: "synced",
  phase: "ready",
  connected: true,
});

/** Sockets the session opens, with what each sent. */
function fakeSockets() {
  const opened: (SocketLike & { url: string; sent: any[]; closedWith?: number; serve(m: ServerMessage): void; drop(code: number): void })[] = [];
  const socket = (url: string) => {
    const s = {
      url,
      sent: [] as any[],
      closedWith: undefined as number | undefined,
      onopen: null as (() => void) | null,
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onclose: null as ((e: { code: number }) => void) | null,
      onerror: null as (() => void) | null,
      send(d: string) {
        s.sent.push(JSON.parse(d));
      },
      close(code?: number) {
        s.closedWith = code;
      },
      serve(m: ServerMessage) {
        s.onmessage?.({ data: JSON.stringify(m) });
      },
      drop(code: number) {
        s.onclose?.({ code });
      },
    };
    opened.push(s);
    return s;
  };
  return { opened, socket };
}

const welcome = (over: Partial<Extract<ServerMessage, { t: "welcome" }>> = {}): ServerMessage => ({
  t: "welcome",
  you: "u:1",
  room: { code: "ABC234", control: "host" },
  tl: tl(),
  members: [member("u:1", true)],
  now: 0,
  ...over,
});

const flush = () => new Promise((r) => setImmediate(r));

test("party session: the first socket uses the create ticket, pings in a burst, and the lowest RTT sets the clock", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1_000;
  let tickets = 0;
  const { opened, socket } = fakeSockets();
  const s = createPartySession({
    code: "ABC234",
    joinUrl: "https://p/j/ABC234",
    firstWsUrl: "wss://p/first",
    ticket: async () => `wss://p/t${++tickets}`,
    socket,
    now: () => now,
  });
  const seen: Timeline[] = [];
  s.follow((x) => seen.push(x));
  s.connect();
  await flush();
  assert.equal(opened[0].url, "wss://p/first");
  assert.equal(tickets, 0, "the create answer's ticket is used, not a new one");
  const ws = opened[0];
  ws.onopen?.();
  ws.serve(welcome({ now: 51_000 }));
  assert.equal(s.get().status, "open");
  assert.equal(s.serverNow(), 51_000, "welcome.now is the rough offset");
  assert.equal(seen.length, 1, "the follower gets the welcome's timeline");
  // Three quick pings, then one every few seconds.
  t.mock.timers.tick(PARTY.burstGapMs);
  t.mock.timers.tick(PARTY.burstGapMs);
  assert.equal(ws.sent.filter((m) => m.t === "ping").length, 3);
  // Answers: 200 ms, then 40 ms (the winner), then 120 ms round trips.
  const [a, b, c] = ws.sent.filter((m) => m.t === "ping");
  now = a.c + 200;
  ws.serve({ t: "pong", id: a.id, c: a.c, s: a.c + 50_000 + 100 });
  now = b.c + 40;
  ws.serve({ t: "pong", id: b.id, c: b.c, s: b.c + 50_000 + 20 });
  now = c.c + 120;
  ws.serve({ t: "pong", id: c.id, c: c.c, s: c.c + 50_000 + 90 });
  assert.equal(s.rtt(), 40);
  assert.equal(s.serverNow() - now, 50_000, "offset from the 40 ms sample");
  t.mock.timers.tick(PARTY.pingMs);
  assert.equal(ws.sent.filter((m) => m.t === "ping").length, 4);
});

test("party session: close codes decide between reconnecting with a new ticket and leaving", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let tickets = 0;
  const { opened, socket } = fakeSockets();
  const s = createPartySession({ code: "ABC234", joinUrl: "", ticket: async () => `wss://p/t${++tickets}`, socket });
  s.connect();
  await flush();
  opened[0].serve(welcome());
  // A network drop: backoff 1 s, then a fresh ticket.
  opened[0].drop(1006);
  assert.equal(s.get().status, "retrying");
  t.mock.timers.tick(PARTY.backoffMs[0] - 1);
  await flush();
  assert.equal(opened.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(opened[1].url, "wss://p/t2");
  // A bad ticket gets one more try at once, a second one gives up.
  opened[1].drop(4001);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(opened.length, 3);
  opened[2].drop(4001);
  assert.equal(s.get().status, "closed");
  assert.equal(s.get().reason, "ticket");
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(opened.length, 3, "no more tries");
});

test("party session: the host ending the room, a gone room and a full one are final", async () => {
  for (const [code, reason] of [
    [4000, "ended"],
    [4004, "not_found"],
    [4005, "full"],
    [4009, "replaced"],
  ] as const) {
    const { opened, socket } = fakeSockets();
    const s = createPartySession({ code: "ABC234", joinUrl: "", ticket: async () => "wss://p/t", socket });
    s.connect();
    await flush();
    opened[0].drop(code);
    assert.deepEqual([s.get().status, s.get().reason], ["closed", reason]);
  }
  // A ticket call that says the room is gone never opens a socket.
  const { opened, socket } = fakeSockets();
  const s = createPartySession({
    code: "ABC234",
    joinUrl: "",
    ticket: async () => {
      throw new PartyHttpError(404, "no such room");
    },
    socket,
  });
  s.connect();
  await flush();
  assert.equal(opened.length, 0);
  assert.equal(s.get().reason, "not_found");
});

test("party session: commands carry the newest rev; a guest in a host room is told, and nothing is sent", async () => {
  const { opened, socket } = fakeSockets();
  const s = createPartySession({ code: "ABC234", joinUrl: "", firstWsUrl: "wss://p/f", ticket: async () => "", socket });
  s.connect();
  await flush();
  const ws = opened[0];
  ws.serve(welcome({ you: "g:1", members: [member("h:1", true), member("g:1")], tl: tl({ rev: 7 }) }));
  assert.equal(s.command("play"), false);
  assert.match(s.get().notice?.text ?? "", /host/);
  ws.serve({ t: "members", list: [member("h:1"), member("g:1", true)] });
  assert.equal(s.command("seek", { pos: 42 }), true);
  assert.deepEqual(ws.sent.at(-1), { t: "cmd", op: "seek", base: 7, pos: 42 });
  // A stale refusal shows the room's newer timeline.
  ws.serve({ t: "error", code: "stale", tl: tl({ rev: 9, state: "playing" }) });
  assert.equal(s.get().tl?.rev, 9);
  assert.match(s.get().notice?.text ?? "", /first/);
  ws.serve({ t: "react", from: "h:1", emoji: "laugh", s: 0 });
  assert.equal(s.get().reactions[0].emoji, "laugh");
});

test("party session: suspend drops the socket, resume comes back with a new ticket", async () => {
  let tickets = 0;
  const { opened, socket } = fakeSockets();
  const s = createPartySession({ code: "ABC234", joinUrl: "", firstWsUrl: "wss://p/f", ticket: async () => `wss://p/t${++tickets}`, socket });
  s.connect();
  await flush();
  opened[0].serve(welcome());
  s.suspend();
  assert.equal(opened[0].closedWith, 1000);
  s.resume();
  await flush();
  assert.equal(opened[1].url, "wss://p/t1");
});

test("release fingerprint: only torrent sources have one, and never a link", () => {
  assert.deepEqual(releaseOf({ url: `debrid:tb:${HASH.toUpperCase()}/3?s=1&e=2` }, "12.5 GB"), {
    infoHash: HASH,
    fileIdx: 3,
    size: Math.round(12.5 * 1024 ** 3),
  });
  assert.deepEqual(releaseOf({ url: `debrid:pm:${HASH}` }), { infoHash: HASH, fileIdx: -1, size: 0 });
  assert.equal(releaseOf({ url: "https://cdn.example/file.mkv" }), null);
  assert.equal(sizeBytes("700 MB"), 700 * 1024 ** 2);
  // A guest plays it through its own service, with the episode hint.
  assert.equal(streamFor({ infoHash: HASH, fileIdx: 3, size: 1 }, "pm", "x", { season: 1, episode: 2 })?.url, `debrid:pm:${HASH}/3?s=1&e=2`);
  assert.equal(streamFor({ infoHash: HASH, fileIdx: -1, size: 0 }, "tb", "x")?.url, `debrid:tb:${HASH}`);
  assert.equal(streamFor({ infoHash: HASH, fileIdx: 0, size: 0 }, undefined, "x"), null);
});

test("party api: bearer token, JSON body, and the HTTP status on refusals", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createPartyApi({
    url: "https://party.test/",
    token: async () => "tok",
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.endsWith("/ticket")
        ? new Response(JSON.stringify({ error: "room is full" }), { status: 409 })
        : new Response(JSON.stringify({ code: "ABC234" }), { status: 201 });
    }) as typeof fetch,
  });
  const made = await api.create({ profile: 3, contentId: "tt1", title: "Film", release: { infoHash: HASH, fileIdx: 0, size: 1 }, control: "host" });
  assert.equal(made.code, "ABC234");
  assert.equal(calls[0].url, "https://party.test/rooms");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer tok");
  await assert.rejects(api.ticket("ABC234", 3), (e: unknown) => e instanceof PartyHttpError && e.status === 409);
  const off = createPartyApi({ url: "", token: async () => "tok" });
  assert.equal(off.configured, false);
  await assert.rejects(off.summary("ABC234"), PartyHttpError);
});

test("contentApp: which app opens a room's content", () => {
  assert.deepEqual(contentApp("tt1"), { type: "movie", titleId: "tt1" });
  assert.deepEqual(contentApp("tt1:2:3"), { type: "series", titleId: "tt1" });
  assert.deepEqual(contentApp("kitsu:7442:3"), { type: "anime", titleId: "kitsu:7442" });
});

/** A player that moves only when told, and whose position the test sets. */
function fakePlayer(phase: Phase = "ready", pos = 0) {
  const calls: string[] = [];
  const p: PartyPlayer & { ph: Phase; pos: number; calls: string[] } = {
    ph: phase,
    pos,
    calls,
    phase: () => p.ph,
    position: () => p.pos,
    play() {
      calls.push("play");
      p.ph = "playing";
    },
    pause() {
      calls.push("pause");
      p.ph = "paused";
    },
    seek(to: number) {
      calls.push(`seek ${Math.round(to * 10) / 10}`);
      p.pos = to;
    },
    reopenMs: () => 3000,
    startMs: () => 500,
  };
  return p;
}

function follow(player: PartyPlayer, server: { now: number }) {
  const sent: any[] = [];
  const f = createFollower({ player, serverNow: () => server.now, rtt: () => 40, send: (m) => sent.push(m) });
  f.start();
  return { f, sent };
}

test("follower: ready at pos0 for a wait, then play() exactly at t0 on the server clock", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const server = { now: 10_000 };
  const p = fakePlayer("ready", 120);
  const { f, sent } = follow(p, server);
  f.timeline(tl({ rev: 2, state: "waiting", pos0: 120, until: 20_000 }));
  assert.deepEqual(p.calls, [], "positioned already: no seek, no play");
  assert.deepEqual(
    [sent.at(-1).t, sent.at(-1).rev, sent.at(-1).phase, sent.at(-1).pos, sent.at(-1).startMs, sent.at(-1).rtt],
    ["state", 2, "ready", 120, 500, 40],
  );
  f.timeline(tl({ rev: 3, state: "playing", pos0: 120, t0: 10_900 }));
  t.mock.timers.tick(899);
  assert.deepEqual(p.calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(p.calls, ["play"]);
  assert.equal(sent.at(-1).phase, "playing");
  f.stop();
});

test("follower: a late start is fixed by one reopen ahead of the room, then drift under 2 s is lived with", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const server = { now: 20_000 };
  const p = fakePlayer("paused", 100);
  const { f } = follow(p, server);
  // The room started 5 s ago at 100.
  f.timeline(tl({ rev: 4, state: "playing", pos0: 100, t0: 15_000 }));
  assert.deepEqual(p.calls, ["play"]);
  t.mock.timers.tick(250);
  // Target 105; reopen lands 3 s later, at 108.
  assert.deepEqual(p.calls, ["play", "seek 108"]);
  // Still off by 3 s ten seconds on: inside the 30 s gap, no second reopen.
  server.now = 30_000;
  p.pos = 112;
  t.mock.timers.tick(250);
  assert.equal(p.calls.filter((c) => c.startsWith("seek")).length, 1);
  // 40 s on, 1.5 s behind: lived with.
  server.now = 60_000;
  p.pos = 143.5;
  t.mock.timers.tick(250);
  assert.equal(p.calls.filter((c) => c.startsWith("seek")).length, 1);
  f.stop();
});

test("follower: in a stall wait a member a little behind plays forward to pos0; far behind it reopens once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const server = { now: 0 };
  const near = fakePlayer("buffering", 297);
  const { f: f1, sent } = follow(near, server);
  f1.timeline(tl({ rev: 5, state: "waiting", pos0: 300, cause: "stall" }));
  assert.deepEqual(near.calls, [], "already moving: no seek");
  near.ph = "playing";
  near.pos = 299.6;
  t.mock.timers.tick(250);
  assert.deepEqual(near.calls, ["pause"]);
  assert.deepEqual([sent.at(-1).phase, sent.at(-1).rev], ["paused", 5]);
  f1.stop();

  const far = fakePlayer("playing", 280);
  const { f: f2 } = follow(far, server);
  f2.timeline(tl({ rev: 5, state: "waiting", pos0: 300, cause: "stall" }));
  assert.deepEqual(far.calls, ["pause", "seek 300"]);
  f2.stop();
});

test("follower: a pause lands without seeking when close; far off it reopens at pos0", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const server = { now: 0 };
  const p = fakePlayer("playing", 50.8);
  const { f } = follow(p, server);
  f.timeline(tl({ rev: 6, state: "paused", pos0: 50, cause: "pause" }));
  assert.deepEqual(p.calls, ["pause"]);
  f.timeline(tl({ rev: 7, state: "paused", pos0: 600, cause: "seek" }));
  assert.deepEqual(p.calls, ["pause", "seek 600"]);
  // An older rev arriving late changes nothing.
  f.timeline(tl({ rev: 6, state: "playing", pos0: 50 }));
  assert.deepEqual(p.calls, ["pause", "seek 600"]);
  f.stop();
});

test("follower: t0 passing during a reopen starts the player once the reopen is done", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const server = { now: 0 };
  const p = fakePlayer("ready", 0);
  p.seek = (to) => {
    p.calls.push(`seek ${to}`);
    p.pos = to;
    p.ph = "buffering";
  };
  const { f } = follow(p, server);
  f.timeline(tl({ rev: 2, state: "playing", pos0: 400, t0: 1000 }));
  assert.deepEqual(p.calls, ["seek 400"]);
  server.now = 1000;
  t.mock.timers.tick(1000);
  assert.deepEqual(p.calls, ["seek 400"], "still reopening at t0");
  p.ph = "paused";
  server.now = 2500;
  t.mock.timers.tick(250);
  assert.deepEqual(p.calls, ["seek 400", "play"]);
  f.stop();
});
