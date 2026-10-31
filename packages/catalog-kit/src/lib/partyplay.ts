// The watch party's player side (docs/watch-party.md, "Constraints for the TV client"): the room's { pos0, t0 }
// applied to the one AVPlay. Play is scheduled at t0 on the server clock; drift is lived with under 2 s and otherwise
// fixed by one rare reopen (party/src/sync.ts correction); the rate is never changed. In a wait, a member a little
// behind plays forward to pos0 instead of seeking.
import { type ClientMessage, type Phase, targetPos, type Timeline } from "@secretary/party/src/protocol.ts";
import { correction } from "@secretary/party/src/sync.ts";

/** The player as the follower drives it. */
export interface PartyPlayer {
  /** `loading` until prepared, `ready` while prepared and never started, then what the player is doing. */
  phase(): Phase;
  position(): number;
  /** Starts (the first time) or resumes; nothing while it is already starting or playing. */
  play(): void;
  pause(): void;
  /** One reopen at `to` (AVPlay cannot seek a prepared stream cheaply); stays paused when it was paused. */
  seek(to: number): void;
  /** How long this TV's last reopen took, ms. */
  reopenMs(): number;
  /** Prepared to first frame, ms. */
  startMs(): number;
}

export interface FollowerDeps {
  player: PartyPlayer;
  serverNow(): number;
  rtt(): number | undefined;
  send(m: ClientMessage): void;
}

export const FOLLOW = {
  tickMs: 250,
  /** A state report this often while playing, besides every timeline and phase change. */
  reportMs: 5000,
  /** Within this of pos0 a member counts as positioned (the server's ready rule). */
  readySec: 1,
  /** A member this far behind in a wait plays forward; further, or ahead, it reopens. */
  walkMaxSec: 10,
  /** A pause lands within this of the pauser; closer than this, nobody seeks. */
  pauseTolSec: 2,
};

const moving = (p: Phase) => p === "playing" || p === "buffering";

export function createFollower({ player, serverNow, rtt, send }: FollowerDeps) {
  let tl: Timeline | null = null;
  /** Server ms of this TV's last reopen, for the one-per-30-s rule. */
  let lastSeekAt: number | undefined;
  /** Playing forward to pos0 during a wait. */
  let walking = false;
  let lastPhase: Phase | null = null;
  let lastReport = 0;
  let tick: ReturnType<typeof setInterval> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;

  function report() {
    if (!tl) return;
    const phase = player.phase();
    lastPhase = phase;
    lastReport = serverNow();
    const r = rtt();
    send({
      t: "state",
      rev: tl.rev,
      phase,
      pos: player.position(),
      at: lastReport,
      ...(r !== undefined ? { rtt: Math.round(r) } : {}),
      startMs: Math.round(player.startMs()),
    });
  }

  function seek(to: number) {
    walking = false;
    lastSeekAt = serverNow();
    player.seek(to);
  }

  /** Paused at pos0, or on the way there: the waiting rule, also used before a scheduled t0. */
  function position(at: number) {
    const ph = player.phase();
    if (ph === "loading" || ph === "error") return;
    const gap = at - player.position();
    if (Math.abs(gap) <= FOLLOW.readySec) {
      walking = false;
      if (moving(ph)) player.pause();
      return;
    }
    if (gap > 0 && gap <= FOLLOW.walkMaxSec) {
      walking = true;
      if (!moving(ph)) player.play();
      return;
    }
    if (moving(ph)) player.pause();
    seek(at);
  }

  function act() {
    if (!tl) return;
    if (startTimer) clearTimeout(startTimer);
    startTimer = null;
    const ph = player.phase();
    if (ph === "loading" || ph === "error") return;
    switch (tl.state) {
      case "paused":
        walking = false;
        if (moving(ph)) player.pause();
        if (Math.abs(player.position() - tl.pos0) > FOLLOW.pauseTolSec) seek(tl.pos0);
        return;
      case "waiting":
        return position(tl.pos0);
      case "playing": {
        const now = serverNow();
        if (now < tl.t0) {
          position(tl.pos0);
          const at = tl;
          startTimer = setTimeout(() => {
            startTimer = null;
            if (tl === at) start();
          }, tl.t0 - now);
          return;
        }
        return start();
      }
      case "ended":
        walking = false;
        if (moving(ph)) player.pause();
    }
  }

  /** t0 has come: play; a member that comes in late is fixed by the drift rule, not here. */
  function start() {
    walking = false;
    const ph = player.phase();
    if (ph !== "loading" && ph !== "error" && !moving(ph)) player.play();
    report();
  }

  function onTick() {
    if (!tl) return;
    const ph = player.phase();
    const now = serverNow();
    if (walking && (tl.state === "waiting" || (tl.state === "playing" && now < tl.t0))) {
      if (player.position() >= tl.pos0 - FOLLOW.readySec / 2) {
        walking = false;
        player.pause();
        return report();
      }
    }
    // A player that finished loading or a reopen picks up where the room is.
    if (lastPhase === "loading" && ph !== "loading") act();
    // t0 passed while a reopen was still running (the start timer found it busy): start now.
    if (tl.state === "playing" && now >= tl.t0 && (ph === "ready" || ph === "paused")) player.play();
    if (tl.state === "playing" && now >= tl.t0 && ph === "playing") {
      const c = correction({ tl, serverNow: now, localPos: player.position(), lastSeekAt, reopenMs: player.reopenMs() });
      if (c.kind === "seek") seek(c.to);
    }
    if (player.phase() !== lastPhase || (moving(ph) && now - lastReport >= FOLLOW.reportMs)) report();
  }

  return {
    /** A timeline from the room (welcome, timeline, or a refusal carrying one). */
    timeline(next: Timeline) {
      if (tl && next.rev < tl.rev) return;
      tl = next;
      walking = false;
      act();
      report();
    },
    start() {
      tick ??= setInterval(onTick, FOLLOW.tickMs);
    },
    stop() {
      if (tick) clearInterval(tick);
      if (startTimer) clearTimeout(startTimer);
      tick = startTimer = null;
    },
    /** Where the room wants the media now, for the overlay's clock and for seek commands. */
    target: () => (tl ? targetPos(tl, serverNow()) : 0),
  };
}

export type Follower = ReturnType<typeof createFollower>;
