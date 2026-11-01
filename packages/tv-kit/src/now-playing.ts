// What Secretary Music is playing, for Nest's "Playing Music" card (docs/music.md). Each Tizen app has its own
// storage, so the record travels over a Tizen message port between two running apps: the music app opens a local
// port and answers on it; Nest asks with a port of its own and is pushed every change after that. No server, and
// nothing to clean up: when the music app is not running there is nothing playing and the ask finds no port.

/** The port the music app listens on. */
export const NOW_PLAYING_PORT = "SecretaryNowPlaying";
/** The port Nest (or any reader) receives the record on. */
export const NOW_PLAYING_REPLY_PORT = "SecretaryNowPlayingReply";
const KEY = "nowPlaying";

export type PlayState = "playing" | "paused" | "buffering" | "stopped";

export interface NowPlaying {
  v: 1;
  title: string;
  artist: string;
  /** Square-ish artwork URL (https). */
  cover: string;
  /** Position when the record was made; add (now - updated) while playing. */
  posSec: number;
  durSec: number;
  state: PlayState;
  /** Epoch milliseconds. */
  updated: number;
}

const STATES: readonly PlayState[] = ["playing", "paused", "buffering", "stopped"];

export const encodeNowPlaying = (n: NowPlaying | null): string => (n ? JSON.stringify(n) : "");

/** Parses a record from the port; null for nothing playing or anything malformed. */
export function decodeNowPlaying(raw: unknown): NowPlaying | null {
  if (typeof raw !== "string" || !raw) return null;
  let p: Partial<NowPlaying>;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || p.v !== 1 || typeof p.title !== "string" || !STATES.includes(p.state as PlayState)) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    v: 1,
    title: p.title,
    artist: typeof p.artist === "string" ? p.artist : "",
    cover: typeof p.cover === "string" ? p.cover : "",
    posSec: num(p.posSec),
    durSec: num(p.durSec),
    state: p.state as PlayState,
    updated: num(p.updated),
  };
}

/** The position now, moving on from the record's while it plays, never past the end. */
export function positionAt(n: NowPlaying, now: number): number {
  if (n.state !== "playing") return n.posSec;
  const pos = n.posSec + Math.max(0, now - n.updated) / 1000;
  return n.durSec > 0 ? Math.min(pos, n.durSec) : pos;
}

// The slice of tizen.messageport both sides use.
type DataItem = { key: string; value: string };
interface RemotePort {
  sendMessage(data: DataItem[], reply?: LocalPort): void;
}
interface LocalPort {
  addMessagePortListener(cb: (data: DataItem[], remote: RemotePort | null) => void): number;
  removeMessagePortListener(id: number): void;
}
interface MessagePortApi {
  requestLocalMessagePort(name: string): LocalPort;
  requestRemoteMessagePort(appId: string, name: string): RemotePort;
}
const ports = (): MessagePortApi | undefined =>
  (globalThis as { tizen?: { messageport?: MessagePortApi } }).tizen?.messageport;

/**
 * The music app's side: answers every ask with `current()`, and remembers who asked so `push()` reaches them on
 * each change. A reader that has gone away is dropped on its first failed send. Does nothing off the TV.
 */
export function serveNowPlaying(current: () => NowPlaying | null): { push(): void; stop(): void } {
  const api = ports();
  if (!api) return { push() {}, stop() {} };
  const readers = new Set<RemotePort>();
  const send = (to: RemotePort) => {
    try {
      to.sendMessage([{ key: KEY, value: encodeNowPlaying(current()) }]);
      return true;
    } catch {
      readers.delete(to);
      return false;
    }
  };
  let local: LocalPort;
  let listener: number;
  try {
    local = api.requestLocalMessagePort(NOW_PLAYING_PORT);
    listener = local.addMessagePortListener((_data, remote) => {
      if (!remote) return;
      readers.add(remote);
      send(remote);
    });
  } catch (err) {
    console.warn("[now-playing] no local port", err);
    return { push() {}, stop() {} };
  }
  return {
    push() {
      for (const r of [...readers]) send(r);
    },
    stop() {
      readers.clear();
      try {
        local.removeMessagePortListener(listener);
      } catch {
        // Already gone with the app.
      }
    },
  };
}

/**
 * The reader's side (Nest): asks the music app (`appId`, e.g. "ScrtMusics.Music") and calls `onRecord` with the
 * answer and every change after it. Returns false when the music app is not running or this is not a TV; ask again
 * when the reader comes back to the foreground.
 */
export function watchNowPlaying(appId: string, onRecord: (n: NowPlaying | null) => void): boolean {
  const api = ports();
  if (!api) return false;
  try {
    const reply = api.requestLocalMessagePort(NOW_PLAYING_REPLY_PORT);
    // One listener per reader: requestLocalMessagePort hands back the same port for the same name.
    const g = globalThis as { __nowPlayingListener?: number };
    if (g.__nowPlayingListener != null) reply.removeMessagePortListener(g.__nowPlayingListener);
    g.__nowPlayingListener = reply.addMessagePortListener((data) => {
      const item = data.find((d) => d.key === KEY);
      if (item) onRecord(decodeNowPlaying(item.value));
    });
    api.requestRemoteMessagePort(appId, NOW_PLAYING_PORT).sendMessage([{ key: "ask", value: "watch" }], reply);
    return true;
  } catch {
    // NotFoundError: the music app is not running, so nothing is playing.
    return false;
  }
}
