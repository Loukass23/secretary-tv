// The YouTube player, through a small page served over http (packages/server, GET /music/player). YouTube refuses to
// play in an embed without a Referer (error 153), and the app runs from file://, which sends none; the page does
// send one, hosts the IFrame player, and talks to the app with postMessage. The other half of this protocol is
// packages/server/src/music.ts. docs/music.md has the measurements.

export type PlayerState = "unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued";

export type PlayerEvent =
  | { ev: "ready" }
  | { ev: "state"; state: PlayerState; t: number; d: number }
  | { ev: "time"; t: number; d: number }
  | { ev: "error"; code: number };

export type PlayerCommand =
  | { cmd: "load"; id: string; start?: number }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "seek"; t: number }
  | { cmd: "stop" };

/** Every message the page sends carries this, so other frames' messages are ignored. */
export const SOURCE = "secretary-music";

const STATES: Record<number, PlayerState> = { [-1]: "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };

export const stateName = (code: number): PlayerState => STATES[code] ?? "unstarted";

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/** One message from the page; null for anything else (other frames, malformed data). */
export function parsePlayerMessage(data: unknown): PlayerEvent | null {
  let m: Record<string, unknown>;
  try {
    m = typeof data === "string" ? JSON.parse(data) : null;
  } catch {
    return null;
  }
  if (!m || m.src !== SOURCE) return null;
  switch (m.ev) {
    case "ready":
      return { ev: "ready" };
    case "state":
      return { ev: "state", state: stateName(Number(m.state)), t: num(m.t), d: num(m.d) };
    case "time":
      return { ev: "time", t: num(m.t), d: num(m.d) };
    case "error":
      return { ev: "error", code: Number(m.code) || 0 };
    default:
      return null;
  }
}

/** YouTube's error codes as the listener should read them; 101 and 150 mean the owner turned embedding off. */
export function errorText(code: number): string {
  if (code === 101 || code === 150 || code === 153) return "This track can't be played outside YouTube.";
  if (code === 100) return "This track was removed.";
  if (code === 2) return "This track id is not valid.";
  return "YouTube could not play this track.";
}

export interface Player {
  send(c: PlayerCommand): void;
  destroy(): void;
}

/**
 * Points `frame` at the player page and relays events from it. Commands sent before the page is ready wait for it,
 * only the last load kept.
 */
export function connectPlayer(frame: HTMLIFrameElement, pageUrl: string, onEvent: (e: PlayerEvent) => void): Player {
  const origin = new URL(pageUrl).origin;
  let ready = false;
  let waiting: PlayerCommand[] = [];
  const post = (c: PlayerCommand) => frame.contentWindow?.postMessage(JSON.stringify(c), origin);
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== origin) return;
    const ev = parsePlayerMessage(e.data);
    if (!ev) return;
    if (ev.ev === "ready") {
      ready = true;
      const queued = waiting;
      waiting = [];
      queued.forEach(post);
    }
    onEvent(ev);
  };
  window.addEventListener("message", onMessage);
  frame.src = pageUrl;
  return {
    send(c) {
      if (ready) return post(c);
      if (c.cmd === "load") waiting = waiting.filter((w) => w.cmd !== "load");
      waiting.push(c);
    },
    destroy() {
      window.removeEventListener("message", onMessage);
      frame.src = "about:blank";
    },
  };
}
