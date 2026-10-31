// Wire format of the watch-party room service. docs/watch-party.md explains every message.

/** Which file everyone plays: each member resolves it through their own debrid account. Never a URL. */
export interface Release {
  /** 40 lowercase hex characters. */
  infoHash: string;
  /** The file's index inside the torrent; -1 when the source did not say (the file is then picked by episode, or largest). */
  fileIdx: number;
  /** The file's size in bytes, to tell two cuts with the same index apart; 0 when unknown. */
  size: number;
}

export type Control = "host" | "shared";

export type PlayState = "paused" | "waiting" | "playing" | "ended";

export type Cause = "create" | "play" | "pause" | "seek" | "next" | "end" | "stall" | "ready" | "timeout";

/**
 * Where the room is. Every member derives the same target position from it and the server clock:
 * playing → `pos0 + (serverNow - t0) / 1000` once `serverNow ≥ t0` (hold at `pos0` before), otherwise `pos0`.
 */
export interface Timeline {
  /** Bumped on every change. */
  rev: number;
  state: PlayState;
  /** Media position in seconds. */
  pos0: number;
  /** Server time (ms) at which the media is at `pos0`; for a scheduled play, in the future. */
  t0: number;
  contentId: string;
  title: string;
  release: Release;
  /** The rev at which the content last changed. */
  contentRev: number;
  cause: Cause;
  /** The member whose command made this rev. */
  by?: string;
  /** While waiting: the server time at which the wait stops for whoever is not ready. */
  until?: number;
}

/** What a member's player is doing, as the member reports it. */
export type Phase = "loading" | "ready" | "paused" | "playing" | "buffering" | "ended" | "error";

export type MemberStatus = "synced" | "catching_up";

export interface MemberView {
  id: string;
  name: string;
  color: string;
  host: boolean;
  status: MemberStatus;
  phase: Phase;
  connected: boolean;
}

export const REACTIONS = ["laugh", "wow", "love", "sad", "clap", "fire", "scared", "eyes"] as const;
export type Reaction = (typeof REACTIONS)[number];

export type CommandOp = "play" | "pause" | "seek" | "next" | "end";

export type ClientMessage =
  | { t: "ping"; id: number; c: number }
  | {
      t: "state";
      /** The rev the member is acting on. */
      rev: number;
      phase: Phase;
      /** Media position in seconds. */
      pos: number;
      /** Server time (ms, from the member's clock offset) at which `pos` was read. */
      at: number;
      /** The member's best recent round trip, ms. */
      rtt?: number;
      /** How long the member's player takes from ready to the first frame, ms. */
      startMs?: number;
    }
  | {
      t: "cmd";
      op: CommandOp;
      /** The latest rev the sender had seen. */
      base: number;
      pos?: number;
      contentId?: string;
      title?: string;
      release?: Release;
    }
  | { t: "react"; emoji: Reaction }
  | { t: "host"; to: string };

export type ErrorCode = "stale" | "forbidden" | "rate_limited" | "bad_message" | "invalid" | "ended" | "no_member";

export type ServerMessage =
  | {
      t: "welcome";
      you: string;
      room: { code: string; control: Control };
      tl: Timeline;
      members: MemberView[];
      /** Server time when sent; a first rough clock offset before any ping. */
      now: number;
    }
  | { t: "pong"; id: number; c: number; s: number }
  | { t: "timeline"; tl: Timeline }
  | { t: "members"; list: MemberView[] }
  | { t: "error"; code: ErrorCode; op?: CommandOp; tl?: Timeline }
  | { t: "react"; from: string; emoji: Reaction; s: number };

/** Close codes in the application range (4000-4999). */
export const Close = {
  Ended: 4000,
  BadTicket: 4001,
  Forbidden: 4003,
  NotFound: 4004,
  Full: 4005,
  Expired: 4006,
  RateLimited: 4008,
  Replaced: 4009,
  Idle: 4010,
  Protocol: 4011,
} as const;
export type CloseCode = (typeof Close)[keyof typeof Close];

/** No 0/O, 1/I/L: a code read off a TV across a room is typed back without mistakes. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;

/** What a person typed, as a code, or null. Lower case, spaces and dashes are forgiven. */
export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}

const PHASES: readonly Phase[] = ["loading", "ready", "paused", "playing", "buffering", "ended", "error"];
const OPS: readonly CommandOp[] = ["play", "pause", "seek", "next", "end"];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

export function isRelease(v: unknown): v is Release {
  const r = v as Release | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.infoHash === "string" &&
    /^[0-9a-f]{40}$/.test(r.infoHash) &&
    isInt(r.fileIdx) &&
    r.fileIdx >= -1 &&
    isInt(r.size) &&
    r.size >= 0
  );
}

/** Only the three fingerprint fields survive, so nothing else (a link, say) is ever relayed. */
export const cleanRelease = (r: Release): Release => ({ infoHash: r.infoHash, fileIdx: r.fileIdx, size: r.size });

export const isContentId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 96 && /^[\w:.-]+$/.test(v);

export const cleanTitle = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 120) : "");

/** A parsed client message, or null when it is malformed. Unknown fields are dropped. */
export function parseClient(raw: string): ClientMessage | null {
  if (raw.length > 2048) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  switch (m.t) {
    case "ping":
      return isNum(m.id) && isNum(m.c) ? { t: "ping", id: m.id, c: m.c } : null;
    case "state": {
      if (!isInt(m.rev) || !PHASES.includes(m.phase as Phase) || !isNum(m.pos) || !isNum(m.at)) return null;
      const out: ClientMessage = { t: "state", rev: m.rev, phase: m.phase as Phase, pos: m.pos, at: m.at };
      if (isNum(m.rtt)) out.rtt = m.rtt;
      if (isNum(m.startMs)) out.startMs = m.startMs;
      return out;
    }
    case "cmd": {
      if (!OPS.includes(m.op as CommandOp) || !isInt(m.base)) return null;
      const out: ClientMessage = { t: "cmd", op: m.op as CommandOp, base: m.base };
      if (m.pos !== undefined) {
        if (!isNum(m.pos)) return null;
        out.pos = m.pos;
      }
      if (m.op === "next") {
        if (!isContentId(m.contentId) || !isRelease(m.release)) return null;
        out.contentId = m.contentId;
        out.release = cleanRelease(m.release);
        out.title = cleanTitle(m.title);
      }
      return out;
    }
    case "react":
      return REACTIONS.includes(m.emoji as Reaction) ? { t: "react", emoji: m.emoji as Reaction } : null;
    case "host":
      return typeof m.to === "string" && m.to.length <= 128 ? { t: "host", to: m.to } : null;
    default:
      return null;
  }
}

/** The media position the room wants at server time `now`. */
export function targetPos(tl: Timeline, now: number): number {
  if (tl.state !== "playing" || now <= tl.t0) return tl.pos0;
  return tl.pos0 + (now - tl.t0) / 1000;
}
