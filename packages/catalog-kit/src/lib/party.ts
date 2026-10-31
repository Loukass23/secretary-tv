// The watch party's connection (docs/watch-party.md): one WebSocket to the room, opened with a one-use ticket in its
// URL, pings for the server clock, reconnects by the close code's rule, and the room as the overlay shows it.
// Pure on its inputs (socket factory, ticket call, clock) so it is tested with fakes.
import {
  Close,
  type ClientMessage,
  type CommandOp,
  type Control,
  type MemberView,
  type Reaction,
  type Release,
  type ServerMessage,
  type Timeline,
} from "@secretary/party/src/protocol.ts";
import { PartyHttpError } from "@secretary/party/src/client.ts";
import { ServerClock } from "@secretary/party/src/sync.ts";
import type { Stream } from "./streams.ts";
import { withHint } from "./streams.ts";
import type { FileHint } from "./episodes.ts";

/** What a Tizen WebSocket offers that the session uses. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export type ConnStatus = "connecting" | "open" | "retrying" | "closed";

/** Why the party is over for this TV. */
export type LeaveReason =
  | "left"
  | "ended"
  | "expired"
  | "not_found"
  | "full"
  | "forbidden"
  | "replaced"
  | "ticket"
  | "protocol"
  | "auth";

export const LEAVE_TEXT: Record<LeaveReason, string> = {
  left: "You left the party.",
  ended: "The host ended the party.",
  expired: "The party expired.",
  not_found: "That party does not exist any more.",
  full: "The party is full (8 TVs).",
  forbidden: "This party refused this profile.",
  replaced: "This profile joined the party on another TV.",
  ticket: "Could not get into the party. Try joining again.",
  protocol: "The party connection broke. Try joining again.",
  auth: "Sign in to Nuvio in Nest first.",
};

export interface ShownReaction {
  id: number;
  from: string;
  emoji: Reaction;
  /** Local ms when it arrived. */
  at: number;
}

export interface PartyView {
  status: ConnStatus;
  reason?: LeaveReason;
  code: string;
  joinUrl: string;
  /** This TV's member id, once welcomed. */
  you: string | null;
  control: Control;
  tl: Timeline | null;
  members: MemberView[];
  /** A refusal or event to show for a few seconds. */
  notice: { text: string; at: number } | null;
  reactions: ShownReaction[];
}

export const PARTY = {
  /** Three quick pings after every connect so the clock has a good sample before the first start, then this gap. */
  pingMs: 3000,
  burstGapMs: 250,
  burst: 3,
  backoffMs: [1000, 2000, 4000, 8000, 16000, 30000],
  rateLimitedMs: 5000,
  /** Reactions stay on screen this long. */
  reactionMs: 4000,
};

export interface SessionDeps {
  code: string;
  joinUrl: string;
  /** The socket URL that came with create or join; its ticket works once, so only the first connect uses it. */
  firstWsUrl?: string;
  /** A fresh socket URL (POST /rooms/<code>/ticket). */
  ticket(): Promise<string>;
  socket(url: string): SocketLike;
  now?: () => number;
}

const NOTICE: Partial<Record<string, string>> = {
  stale: "Someone else pressed first.",
  forbidden: "Only the host controls playback.",
  rate_limited: "Slow down a little.",
  ended: "The party has ended.",
};

const CLOSE_REASON: Partial<Record<number, LeaveReason>> = {
  [Close.Ended]: "ended",
  [Close.Forbidden]: "forbidden",
  [Close.NotFound]: "not_found",
  [Close.Full]: "full",
  [Close.Expired]: "expired",
  [Close.Replaced]: "replaced",
  [Close.Protocol]: "protocol",
};

export function createPartySession(deps: SessionDeps) {
  const now = deps.now ?? Date.now;
  const clock = new ServerClock();
  let view: PartyView = {
    status: "connecting",
    code: deps.code,
    joinUrl: deps.joinUrl,
    you: null,
    control: "host",
    tl: null,
    members: [],
    notice: null,
    reactions: [],
  };
  const listeners = new Set<(v: PartyView) => void>();
  let onTimeline: ((tl: Timeline) => void) | null = null;
  let ws: SocketLike | null = null;
  let firstUrl = deps.firstWsUrl;
  let attempt = 0;
  let badTickets = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let pingId = 0;
  let welcomeOffset = 0;
  let suspended = false;
  let reactionId = 0;

  const set = (patch: Partial<PartyView>) => {
    view = { ...view, ...patch };
    for (const l of listeners) l(view);
  };
  const notice = (text: string) => set({ notice: { text, at: now() } });
  /** Read through a call: the status changes while a ticket call is awaited. */
  const over = () => view.status === "closed";

  function stopTimers() {
    if (retryTimer) clearTimeout(retryTimer);
    if (pingTimer) clearTimeout(pingTimer);
    retryTimer = pingTimer = null;
  }

  function finish(reason: LeaveReason) {
    stopTimers();
    const old = ws;
    ws = null;
    if (old) {
      old.onclose = old.onmessage = old.onopen = old.onerror = null;
      try {
        old.close(1000);
      } catch {
        // Already closed.
      }
    }
    set({ status: "closed", reason });
  }

  function retry(ms: number) {
    if (view.status === "closed" || suspended) return;
    set({ status: "retrying" });
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, ms);
  }
  const backoff = () => PARTY.backoffMs[Math.min(attempt++, PARTY.backoffMs.length - 1)];

  function ping(left: number) {
    if (!ws) return;
    send({ t: "ping", id: ++pingId, c: now() });
    pingTimer = setTimeout(() => ping(left - 1), left > 1 ? PARTY.burstGapMs : PARTY.pingMs);
  }

  function receive(raw: unknown) {
    let m: ServerMessage;
    try {
      m = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    switch (m.t) {
      case "pong":
        clock.add(m.c, m.s, now());
        return;
      case "welcome":
        attempt = 0;
        badTickets = 0;
        welcomeOffset = m.now - now();
        set({ status: "open", you: m.you, control: m.room.control, members: m.members, tl: m.tl });
        onTimeline?.(m.tl);
        return;
      case "timeline":
        set({ tl: m.tl });
        onTimeline?.(m.tl);
        return;
      case "members":
        set({ members: m.list });
        return;
      case "react": {
        const t = now();
        const kept = view.reactions.filter((r) => t - r.at < PARTY.reactionMs);
        set({ reactions: [...kept, { id: ++reactionId, from: m.from, emoji: m.emoji, at: t }].slice(-8) });
        return;
      }
      case "error":
        if (NOTICE[m.code]) notice(NOTICE[m.code]!);
        if (m.tl && (!view.tl || m.tl.rev >= view.tl.rev)) {
          set({ tl: m.tl });
          onTimeline?.(m.tl);
        }
        return;
    }
  }

  function closed(code: number) {
    ws = null;
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = null;
    if (view.status === "closed" || suspended) return;
    const reason = CLOSE_REASON[code];
    if (reason) return finish(reason);
    if (code === Close.BadTicket) {
      // A ticket that expired on the way: one more, then give up.
      if (++badTickets > 1) return finish("ticket");
      return retry(0);
    }
    if (code === Close.RateLimited) return retry(PARTY.rateLimitedMs);
    if (code === Close.Idle) return retry(0);
    retry(backoff());
  }

  async function connect(): Promise<void> {
    if (view.status === "closed" || suspended || ws) return;
    set({ status: view.you ? "retrying" : "connecting" });
    let url = firstUrl;
    firstUrl = undefined;
    if (!url) {
      try {
        url = await deps.ticket();
      } catch (e) {
        const status = e instanceof PartyHttpError ? e.status : 0;
        if (status === 404) return finish("not_found");
        if (status === 409) return finish("full");
        if (status === 401 || status === 403) return finish("auth");
        return retry(backoff());
      }
    }
    if (over() || suspended) return;
    const s = deps.socket(url);
    ws = s;
    s.onopen = () => ping(PARTY.burst);
    s.onmessage = (e) => receive(e.data);
    s.onclose = (e) => {
      if (ws === s) closed(e.code);
    };
    s.onerror = null;
  }

  function send(m: ClientMessage): boolean {
    if (!ws) return false;
    try {
      ws.send(JSON.stringify(m));
      return true;
    } catch {
      return false;
    }
  }

  const me = () => view.members.find((m) => m.id === view.you);
  const isHost = () => me()?.host === true;
  const canControl = () => view.control === "shared" || isHost();

  return {
    get: () => view,
    subscribe(l: (v: PartyView) => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** The player follower: gets every timeline, the current one at once. */
    follow(fn: ((tl: Timeline) => void) | null) {
      onTimeline = fn;
      if (fn && view.tl) fn(view.tl);
    },
    connect: () => void connect(),
    serverNow: () => clock.toServer(now(), welcomeOffset),
    /** The best recent round trip, ms. */
    rtt: () => clock.best()?.rtt,
    send,
    isHost,
    canControl,
    /** A playback command; false when this TV may not send it (the overlay says why). */
    command(op: CommandOp, extra: Partial<Extract<ClientMessage, { t: "cmd" }>> = {}): boolean {
      if (!view.tl) return false;
      if (op === "end" ? !isHost() : !canControl()) {
        notice(NOTICE.forbidden!);
        return false;
      }
      return send({ ...extra, t: "cmd", op, base: view.tl.rev });
    },
    react: (emoji: Reaction) => send({ t: "react", emoji }),
    handOver: (to: string) => isHost() && send({ t: "host", to }),
    leave: () => finish("left"),
    /** The app went to the background: the socket goes, and comes back with a fresh ticket on resume. */
    suspend() {
      if (view.status === "closed") return;
      suspended = true;
      stopTimers();
      const old = ws;
      ws = null;
      if (old) {
        old.onclose = null;
        try {
          old.close(1000);
        } catch {
          // Already closed.
        }
      }
    },
    resume() {
      if (!suspended) return;
      suspended = false;
      attempt = 0;
      void connect();
    },
  };
}

export type PartySession = ReturnType<typeof createPartySession>;

const DEBRID_URL = /^debrid:([a-z]+):([0-9a-fA-F]{40})(?:\/(\d+))?(?:\?|$)/;

/** "12.3 GB" from the source's label in bytes, rounded; 0 when the label has none. */
export function sizeBytes(label: string | undefined): number {
  const m = label?.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i);
  if (!m) return 0;
  const n = Number(m[1].replace(",", "."));
  return Math.round(n * (m[2].toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2));
}

/**
 * The fingerprint of a source, never its link: only torrent sources (debrid:<service>:<hash>[/<idx>]) have one.
 * `sizeLabel` is the size the source's name shows.
 */
export function releaseOf(s: Pick<Stream, "url">, sizeLabel?: string): Release | null {
  const m = s.url.match(DEBRID_URL);
  if (!m) return null;
  return { infoHash: m[2].toLowerCase(), fileIdx: m[3] != null ? Number(m[3]) : -1, size: sizeBytes(sizeLabel) };
}

/**
 * The room's release as a source of this TV's own: the same torrent and file through this TV's debrid service, so
 * each member resolves its own link. Null when this TV has no debrid key.
 */
export function streamFor(release: Release, service: string | undefined, title: string, hint?: FileHint): Stream | null {
  if (!service) return null;
  const base = `debrid:${service}:${release.infoHash}${release.fileIdx >= 0 ? `/${release.fileIdx}` : ""}`;
  return { name: "Watch together", title, url: hint ? withHint(base, hint) : base };
}
