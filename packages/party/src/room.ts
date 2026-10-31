// The room as a pure state machine: no sockets, no storage, no timers. The Durable Object feeds it joins, leaves,
// raw messages and ticks, sends what `drain()` returns, and sets an alarm for `nextWake()`.
import {
  Close,
  parseClient,
  targetPos,
  type ClientMessage,
  type CloseCode,
  type Control,
  type MemberStatus,
  type MemberView,
  type Phase,
  type Release,
  type ServerMessage,
  type Timeline,
} from "./protocol.ts";

/** Our own numbers, chosen for AVPlay on the reference TV; docs/watch-party.md explains each one. */
export const LIMITS = {
  maxMembers: 8,
  /** Bounds of the lead between "play" going out and the shared start. */
  leadMinMs: 400,
  leadMaxMs: 4000,
  leadMarginMs: 150,
  /** Assumed until a member reports its own. */
  defaultRttMs: 300,
  defaultStartMs: 800,
  /** A member this close to `pos0` counts as positioned for a start. */
  readyTolSec: 1,
  /** A catching-up member this close to the target is back in sync. */
  syncTolSec: 1,
  /** A pause keeps the pauser's own position when it is this close to the model. */
  landTolSec: 2,
  /** How long a start waits for members after a play, seek or stall. */
  bufferWaitMs: 10_000,
  /** How long a start waits after a new episode, which opens a new source. */
  loadWaitMs: 30_000,
  /** A member buffering this long while playing pauses the room. */
  stallGraceMs: 1_500,
  /** More stalls than this within the window and the member catches up alone instead. */
  stallStrikes: 3,
  stallWindowMs: 5 * 60_000,
  /** How long an absent host keeps the role. */
  hostGraceMs: 30_000,
  /** A member silent this long is dropped (clients ping every few seconds). */
  idleMs: 45_000,
  emptyTtlMs: 10 * 60_000,
  maxAgeMs: 12 * 3_600_000,
  /** Token buckets: capacity and refill per second. */
  msgBucket: { cap: 40, perSec: 20 },
  cmdBucket: { cap: 3, perSec: 1.5 },
  reactBucket: { cap: 5, perSec: 0.7 },
  maxBadMessages: 5,
};
export type Limits = typeof LIMITS;

export interface Identity {
  /** `<account id>:<profile index>`, so one account's profiles are separate members. */
  id: string;
  name: string;
  color: string;
}

export interface RoomInit {
  code: string;
  control: Control;
  host: Identity;
  contentId: string;
  title: string;
  release: Release;
  startPos?: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

interface MemberRecord extends Identity {
  joinedAt: number;
  connected: boolean;
  lastSeen: number;
  status: MemberStatus;
  phase: Phase;
  pos: number;
  /** The rev the member last reported against. */
  rev: number;
  /** Server time of the member's last position reading. */
  at: number;
  rtt: number;
  startMs: number;
  bufferingSince?: number;
  /** When this member's stalls paused the room, within the window. */
  strikes: number[];
  bad: number;
  buckets: { msg: Bucket; cmd: Bucket; react: Bucket };
}

export interface RoomSnapshot {
  code: string;
  control: Control;
  createdAt: number;
  hostId: string;
  hostAwaySince?: number;
  emptySince?: number;
  tl: Timeline;
  /** The rev and author of the last change a command made, for the stale check. */
  cmdRev: number;
  cmdBy?: string;
  members: MemberRecord[];
  /** Ticket ids already used, with their expiry. */
  tickets: [string, number][];
  finished: boolean;
}

export type Out =
  | { to: string; msg: ServerMessage }
  | { all: true; msg: ServerMessage }
  | { close: string; code: CloseCode; reason: string };

export type JoinResult = { ok: true; replaced: boolean } | { ok: false; code: CloseCode; reason: string };

export interface RoomSummary {
  code: string;
  title: string;
  contentId: string;
  control: Control;
  state: Timeline["state"];
  members: number;
  full: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Room {
  private s: RoomSnapshot;
  private readonly now: () => number;
  private readonly lim: Limits;
  private out: Out[] = [];

  constructor(snapshot: RoomSnapshot, now: () => number, limits: Limits = LIMITS) {
    this.s = snapshot;
    this.now = now;
    this.lim = limits;
  }

  static create(init: RoomInit, now: () => number, limits: Limits = LIMITS): Room {
    const t = now();
    return new Room(
      {
        code: init.code,
        control: init.control,
        createdAt: t,
        hostId: init.host.id,
        // The host's own socket is not open yet; the room is empty until it joins.
        hostAwaySince: t,
        emptySince: t,
        tl: {
          rev: 1,
          state: "paused",
          pos0: Math.max(0, init.startPos ?? 0),
          t0: t,
          contentId: init.contentId,
          title: init.title,
          release: init.release,
          contentRev: 1,
          cause: "create",
        },
        cmdRev: 1,
        members: [],
        tickets: [],
        finished: false,
      },
      now,
      limits,
    );
  }

  snapshot(): RoomSnapshot {
    return this.s;
  }

  get code() {
    return this.s.code;
  }
  get timeline(): Timeline {
    return this.s.tl;
  }
  get hostId() {
    return this.s.hostId;
  }
  /** Ended or expired: the Durable Object closes everything and wipes its storage. */
  get finished() {
    return this.s.finished;
  }

  members(): MemberView[] {
    return [...this.s.members]
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        host: m.id === this.s.hostId,
        status: m.status,
        phase: m.phase,
        connected: m.connected,
      }));
  }

  summary(): RoomSummary {
    const connected = this.connected().length;
    return {
      code: this.s.code,
      title: this.s.tl.title,
      contentId: this.s.tl.contentId,
      control: this.s.control,
      state: this.s.tl.state,
      members: connected,
      full: connected >= this.lim.maxMembers,
    };
  }

  /** Everything to send since the last call, in order. */
  drain(): Out[] {
    const o = this.out;
    this.out = [];
    return o;
  }

  join(who: Identity, ticket: { id: string; exp: number }): JoinResult {
    const now = this.now();
    if (this.s.finished) return { ok: false, code: Close.NotFound, reason: "room is gone" };
    this.s.tickets = this.s.tickets.filter(([, exp]) => exp > now);
    if (ticket.exp <= now || this.s.tickets.some(([id]) => id === ticket.id)) {
      return { ok: false, code: Close.BadTicket, reason: "ticket used or expired" };
    }
    const existing = this.find(who.id);
    const replaced = existing?.connected === true;
    if (!replaced && this.connected().length >= this.lim.maxMembers) {
      return { ok: false, code: Close.Full, reason: "room is full" };
    }
    this.s.tickets.push([ticket.id, ticket.exp]);

    const tl = this.s.tl;
    const m: MemberRecord = existing ?? {
      ...who,
      joinedAt: now,
      connected: true,
      lastSeen: now,
      status: "synced",
      phase: "loading",
      pos: 0,
      rev: 0,
      at: now,
      rtt: this.lim.defaultRttMs,
      startMs: this.lim.defaultStartMs,
      strikes: [],
      bad: 0,
      buckets: this.freshBuckets(now),
    };
    m.name = who.name;
    m.color = who.color;
    m.connected = true;
    m.lastSeen = now;
    m.phase = "loading";
    m.rev = 0;
    delete m.bufferingSince;
    // Joining a moving room means starting from wherever it is now, alone, without holding anyone up.
    m.status = tl.state === "playing" || tl.state === "waiting" ? "catching_up" : "synced";
    if (!existing) this.s.members.push(m);
    if (who.id === this.s.hostId) delete this.s.hostAwaySince;
    delete this.s.emptySince;

    this.send(who.id, {
      t: "welcome",
      you: who.id,
      room: { code: this.s.code, control: this.s.control },
      tl,
      members: this.members(),
      now,
    });
    this.broadcastMembers();
    return { ok: true, replaced };
  }

  leave(id: string): void {
    const m = this.find(id);
    if (!m?.connected) return;
    const now = this.now();
    m.connected = false;
    delete m.bufferingSince;
    if (id === this.s.hostId) this.s.hostAwaySince = now;
    else this.s.members = this.s.members.filter((x) => x !== m);
    if (this.connected().length === 0) this.s.emptySince = now;
    this.broadcastMembers();
    this.settle();
  }

  receive(id: string, raw: string): void {
    const m = this.find(id);
    if (!m?.connected || this.s.finished) return;
    const now = this.now();
    m.lastSeen = now;
    if (!this.take(m, "msg")) {
      this.out.push({ close: id, code: Close.RateLimited, reason: "too many messages" });
      this.leave(id);
      return;
    }
    const msg = parseClient(raw);
    if (!msg) {
      if (++m.bad >= this.lim.maxBadMessages) {
        this.out.push({ close: id, code: Close.Protocol, reason: "malformed messages" });
        this.leave(id);
      } else this.send(id, { t: "error", code: "bad_message" });
      return;
    }
    switch (msg.t) {
      case "ping":
        this.send(id, { t: "pong", id: msg.id, c: msg.c, s: now });
        return;
      case "state":
        return this.onState(m, msg);
      case "cmd":
        return this.onCommand(m, msg);
      case "react":
        if (!this.take(m, "react")) return this.send(id, { t: "error", code: "rate_limited" });
        this.out.push({ all: true, msg: { t: "react", from: id, emoji: msg.emoji, s: now } });
        return;
      case "host":
        return this.onHandover(m, msg.to);
    }
  }

  /** Runs whatever deadlines have passed. Call it from the alarm, at `nextWake()`. */
  tick(): void {
    if (this.s.finished) return;
    const now = this.now();
    const lim = this.lim;

    if (now - this.s.createdAt >= lim.maxAgeMs) return this.expire("room is too old");
    if (this.s.emptySince !== undefined && now - this.s.emptySince >= lim.emptyTtlMs) return this.expire("room is empty");

    for (const m of this.connected()) {
      if (now - m.lastSeen >= lim.idleMs) {
        this.out.push({ close: m.id, code: Close.Idle, reason: "no message" });
        this.leave(m.id);
      }
    }

    if (this.s.hostAwaySince !== undefined && now - this.s.hostAwaySince >= lim.hostGraceMs) {
      const next = this.sortedConnected()[0];
      if (next) {
        const old = this.s.hostId;
        this.s.members = this.s.members.filter((x) => x.id !== old || x.connected);
        this.s.hostId = next.id;
        delete this.s.hostAwaySince;
        this.broadcastMembers();
      }
    }

    const tl = this.s.tl;
    if (tl.state === "playing" && now >= tl.t0) {
      let stalled = false;
      let demoted = false;
      for (const m of this.waitSet()) {
        if (m.bufferingSince === undefined || now - m.bufferingSince < lim.stallGraceMs) continue;
        m.strikes = m.strikes.filter((t) => now - t < lim.stallWindowMs);
        m.strikes.push(now);
        if (m.strikes.length > lim.stallStrikes) {
          // This member keeps freezing everyone: it goes on alone instead.
          m.status = "catching_up";
          delete m.bufferingSince;
          demoted = true;
        } else stalled = true;
      }
      if (demoted) this.broadcastMembers();
      if (stalled) this.startWaiting(targetPos(tl, now), "stall", lim.bufferWaitMs);
    }

    if (this.s.tl.state === "waiting" && this.s.tl.until !== undefined && now >= this.s.tl.until) {
      const late = this.waitSet().filter((m) => !this.isReady(m));
      for (const m of late) m.status = "catching_up";
      if (late.length) this.broadcastMembers();
      this.schedulePlay("timeout");
    }
  }

  /** The earliest server time at which `tick()` has something to do. */
  nextWake(): number | undefined {
    if (this.s.finished) return undefined;
    const lim = this.lim;
    const tl = this.s.tl;
    const times = [this.s.createdAt + lim.maxAgeMs];
    if (this.s.emptySince !== undefined) times.push(this.s.emptySince + lim.emptyTtlMs);
    if (this.s.hostAwaySince !== undefined && this.connected().length) times.push(this.s.hostAwaySince + lim.hostGraceMs);
    for (const m of this.connected()) times.push(m.lastSeen + lim.idleMs);
    if (tl.state === "playing") {
      for (const m of this.waitSet()) {
        if (m.bufferingSince !== undefined) times.push(Math.max(tl.t0, m.bufferingSince + lim.stallGraceMs));
      }
    }
    if (tl.state === "waiting" && tl.until !== undefined) times.push(tl.until);
    return Math.min(...times);
  }

  // --- messages ---

  private onState(m: MemberRecord, msg: Extract<ClientMessage, { t: "state" }>): void {
    const now = this.now();
    const tl = this.s.tl;
    if (msg.rev > tl.rev) return;
    const before = `${m.status}/${m.phase}`;
    m.phase = msg.phase;
    m.pos = Math.max(0, msg.pos);
    m.rev = msg.rev;
    m.at = clamp(msg.at, now - 5_000, now);
    if (msg.rtt !== undefined) m.rtt = clamp(msg.rtt, 0, 5_000);
    if (msg.startMs !== undefined) m.startMs = clamp(msg.startMs, 0, 5_000);

    if (msg.phase === "buffering" && msg.rev === tl.rev) m.bufferingSince ??= now;
    else delete m.bufferingSince;

    if (m.status === "catching_up" && msg.rev === tl.rev) {
      const inStep =
        tl.state === "playing"
          ? msg.phase === "playing" && m.at >= tl.t0 && Math.abs(m.pos - targetPos(tl, m.at)) <= this.lim.syncTolSec
          : this.isReady(m);
      if (inStep) m.status = "synced";
    }
    if (`${m.status}/${m.phase}` !== before) this.broadcastMembers();
    this.settle();
  }

  private onCommand(m: MemberRecord, cmd: Extract<ClientMessage, { t: "cmd" }>): void {
    const tl = this.s.tl;
    const lim = this.lim;
    const fail = (code: "stale" | "forbidden" | "rate_limited" | "invalid" | "ended") =>
      this.send(m.id, { t: "error", code, op: cmd.op, tl: this.s.tl });

    if (tl.state === "ended") return fail("ended");
    const isHost = m.id === this.s.hostId;
    if ((cmd.op === "end" || this.s.control === "host") && !isHost) return fail("forbidden");
    if (cmd.base > tl.rev) return fail("invalid");
    // Stale: the sender had not yet seen someone else's command. Its own earlier command does not count.
    if (cmd.base < this.s.cmdRev && this.s.cmdBy !== m.id) return fail("stale");
    if (!this.take(m, "cmd")) return fail("rate_limited");

    const echo = () => this.send(m.id, { t: "timeline", tl });
    const now = this.now();
    switch (cmd.op) {
      case "play":
        if (tl.state !== "paused") return echo();
        return this.startWaiting(tl.pos0, "play", lim.bufferWaitMs, m.id);
      case "pause":
        if (tl.state === "paused") return echo();
        return this.setTimeline({ state: "paused", pos0: this.landing(cmd.pos), t0: now, cause: "pause" }, m.id);
      case "seek": {
        if (cmd.pos === undefined || cmd.pos < 0) return fail("invalid");
        if (tl.state === "paused") return this.setTimeline({ state: "paused", pos0: cmd.pos, t0: now, cause: "seek" }, m.id);
        return this.startWaiting(cmd.pos, "seek", lim.bufferWaitMs, m.id);
      }
      case "next":
        // Everyone opens the new source from scratch, so nobody is behind any more.
        for (const x of this.s.members) {
          x.status = "synced";
          x.strikes = [];
        }
        this.broadcastMembers();
        return this.startWaiting(Math.max(0, cmd.pos ?? 0), "next", lim.loadWaitMs, m.id, {
          contentId: cmd.contentId!,
          title: cmd.title ?? "",
          release: cmd.release!,
        });
      case "end":
        this.setTimeline({ state: "ended", t0: now, cause: "end" }, m.id);
        for (const x of this.connected()) this.out.push({ close: x.id, code: Close.Ended, reason: "host ended the room" });
        this.s.finished = true;
        return;
    }
  }

  private onHandover(m: MemberRecord, to: string): void {
    if (m.id !== this.s.hostId) return this.send(m.id, { t: "error", code: "forbidden" });
    const target = this.find(to);
    if (!target?.connected || target === m) return this.send(m.id, { t: "error", code: "no_member" });
    this.s.hostId = target.id;
    this.broadcastMembers();
  }

  // --- timeline ---

  /** Where a pause lands: the pauser's own position when it is close to the model, so its picture does not jump. */
  private landing(sent: number | undefined): number {
    const model = targetPos(this.s.tl, this.now());
    return sent !== undefined && Math.abs(sent - model) <= this.lim.landTolSec ? Math.max(0, sent) : model;
  }

  private setTimeline(patch: Partial<Timeline>, by?: string): void {
    const rev = this.s.tl.rev + 1;
    const tl: Timeline = { ...this.s.tl, ...patch, rev };
    if (patch.contentId !== undefined) tl.contentRev = rev;
    if (tl.state !== "waiting") delete tl.until;
    if (by !== undefined) {
      tl.by = by;
      this.s.cmdRev = rev;
      this.s.cmdBy = by;
    } else delete tl.by;
    this.s.tl = tl;
    for (const m of this.s.members) delete m.bufferingSince;
    this.out.push({ all: true, msg: { t: "timeline", tl } });
  }

  private startWaiting(
    pos: number,
    cause: Timeline["cause"],
    capMs: number,
    by?: string,
    content?: Pick<Timeline, "contentId" | "title" | "release">,
  ): void {
    const now = this.now();
    this.setTimeline({ state: "waiting", pos0: pos, t0: now, until: now + capMs, cause, ...content }, by);
    this.settle();
  }

  /** A waiting room starts once everyone in sync is positioned and ready. */
  private settle(): void {
    if (this.s.tl.state !== "waiting") return;
    if (this.waitSet().every((m) => this.isReady(m))) this.schedulePlay("ready");
  }

  /**
   * Starts a lead ahead: long enough for the start to reach the slowest member (half its round trip) and for its
   * player to get from ready to the first frame.
   */
  private schedulePlay(cause: "ready" | "timeout"): void {
    const lim = this.lim;
    const need = Math.max(0, ...this.waitSet().map((m) => m.rtt / 2 + m.startMs));
    const lead = clamp(need + lim.leadMarginMs, lim.leadMinMs, lim.leadMaxMs);
    this.setTimeline({ state: "playing", pos0: this.s.tl.pos0, t0: this.now() + lead, cause });
  }

  private isReady(m: MemberRecord): boolean {
    const tl = this.s.tl;
    return (
      m.connected &&
      m.rev === tl.rev &&
      (m.phase === "ready" || m.phase === "paused") &&
      Math.abs(m.pos - tl.pos0) <= this.lim.readyTolSec
    );
  }

  private expire(reason: string): void {
    for (const m of this.connected()) this.out.push({ close: m.id, code: Close.Expired, reason });
    this.s.finished = true;
  }

  // --- helpers ---

  private find(id: string) {
    return this.s.members.find((m) => m.id === id);
  }
  private connected() {
    return this.s.members.filter((m) => m.connected);
  }
  private sortedConnected() {
    return this.connected().sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  }
  /** The members a start waits for. */
  private waitSet() {
    return this.connected().filter((m) => m.status === "synced");
  }

  private send(to: string, msg: ServerMessage) {
    this.out.push({ to, msg });
  }
  private broadcastMembers() {
    this.out.push({ all: true, msg: { t: "members", list: this.members() } });
  }

  private freshBuckets(now: number) {
    const lim = this.lim;
    return {
      msg: { tokens: lim.msgBucket.cap, at: now },
      cmd: { tokens: lim.cmdBucket.cap, at: now },
      react: { tokens: lim.reactBucket.cap, at: now },
    };
  }

  private take(m: MemberRecord, kind: "msg" | "cmd" | "react"): boolean {
    const spec = this.lim[`${kind}Bucket`];
    const b = m.buckets[kind];
    const now = this.now();
    b.tokens = Math.min(spec.cap, b.tokens + ((now - b.at) / 1000) * spec.perSec);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
