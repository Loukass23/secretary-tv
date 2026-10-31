import type { PlayerEvents, TvPlayer } from "./types.ts";
import type { AvplayTrack, Webapis } from "./webapis.ts";

/** A plain file that prepares at all does so in about 9 s on the reference TV; AV1 never does. */
export const PREPARE_TIMEOUT_MS = 15_000;
export const PREPARE_ADAPTIVE_TIMEOUT_MS = 30_000;
const FIRST_FRAME_TIMEOUT_MS = 10_000;
const BUFFER_SECONDS = 5;
const SEEK_RETRY_MS = 250;
/** Rapid Left/Right presses within this window become one seek to the last target. */
export const SEEK_SETTLE_MS = 350;
/** Prepare landing within this of the requested start counts as having honoured it. */
const START_TOLERANCE_SEC = 5;

type Rect = { x: number; y: number; w: number; h: number };

/** The largest rect with the video's aspect ratio centred in `box`, in whole pixels. */
export function fitRect(box: Rect, videoW: number, videoH: number): Rect {
  let { x, y, w, h } = box;
  if (videoW > 0 && videoH > 0 && w > 0 && h > 0) {
    const aspect = videoW / videoH;
    if (w / h > aspect) {
      const fitted = h * aspect;
      x += (w - fitted) / 2;
      w = fitted;
    } else {
      const fitted = w / aspect;
      y += (h - fitted) / 2;
      h = fitted;
    }
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function videoSize(tracks: AvplayTrack[]): { w: number; h: number } {
  for (const t of tracks) {
    if (t.type !== "VIDEO") continue;
    try {
      const extra = JSON.parse(t.extra_info) as Record<string, unknown>;
      const pick = (k: string) =>
        Number(Object.entries(extra).find(([n]) => n.toLowerCase() === k)?.[1]) || 0;
      return { w: pick("width"), h: pick("height") };
    } catch {
      // Shape varies by firmware.
    }
  }
  return { w: 0, h: 0 };
}

/** AVPlay error names to a short reason. */
export function describeError(raw: unknown): string {
  const name = typeof raw === "string" ? raw : ((raw as { name?: string } | null)?.name ?? "unknown");
  return name || "unknown";
}

export interface AvplayDeps {
  api: Webapis;
  events: PlayerEvents;
  screen: { width: number; height: number };
  doc: { visibilityState: string; addEventListener(t: "visibilitychange", f: () => void): void; removeEventListener(t: "visibilitychange", f: () => void): void };
}

/**
 * Samsung AVPlay behind TvPlayer. Rules from docs/lessons.md: straight to open()
 * (no HEAD), never select a TEXT track, set buffering only before prepare,
 * watch prepare with a timer, and treat a picture with no audio track as a
 * failure so the next source runs.
 *
 * Never seek a prepared stream: every form of it (seekTo with or without
 * callbacks, jumpForward/jumpBackward) blocked the page for 3 to 34 s on the
 * reference TV while a remote 4K file re-buffered. seekTo() in IDLE only sets
 * where prepare starts, and prepare runs off the page thread, so the resume
 * point and every seek reopen the source there (lessons.md).
 */
export function createAvplayPlayer({ api, events, screen, doc }: AvplayDeps): TvPlayer {
  const av = api.avplay;
  let gen = 0;
  let opened = false;
  let prepared = false;
  let playing = false;
  let startSec = 0;
  let url = "";
  let suspended = false;
  let firstFrame: (() => void) | null = null;
  /** A resume point that prepare did not honour, sought the old way once a real duration is known. */
  let pendingSeek: number | null = null;
  let missedStart = false;
  /** The newest seek target, waiting for presses to settle or for the reopen in progress. */
  let seekWanted: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let reopening = false;
  /** Whether playback runs once the reopen lands; toggle() flips it meanwhile. */
  let playAfterSeek = false;
  let seekRun = 0;
  /** Where the picture goes. Set only when playback starts: a player still preparing in the background
   * must not take the video plane from the one that is playing (it froze it on the reference TV). */
  let rect: Rect | null = null;
  /** start() has given this player the video plane; a reopen after restore() must give it back. */
  let shown = false;
  let seekTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPos = 0;
  let lastDur = 0;

  const state = () => {
    try {
      return av.getState();
    } catch {
      return "NONE";
    }
  };
  const dur = () => {
    try {
      return Math.max(0, av.getDuration() / 1000);
    } catch {
      return 0;
    }
  };

  const release = () => {
    gen += 1;
    firstFrame = null;
    pendingSeek = null;
    if (seekTimer) clearTimeout(seekTimer);
    seekTimer = null;
    playing = false;
    prepared = false;
    if (opened && state() !== "NONE") {
      try {
        av.stop();
      } catch {}
      try {
        av.close();
      } catch {}
    }
    opened = false;
  };

  const clearSeek = () => {
    seekRun += 1;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    seekWanted = null;
    reopening = false;
  };

  /** True while the shown position is a target rather than what AVPlay reports. */
  const seeking = () => reopening || settleTimer != null || pendingSeek != null;

  /** Reopens at the newest target; a target that arrives meanwhile reopens again before playing. */
  const reopen = async () => {
    settleTimer = null;
    if (reopening || seekWanted == null) return;
    const run = seekRun;
    reopening = true;
    playAfterSeek = playing;
    events.onBuffering(true);
    try {
      while (seekWanted != null) {
        const to = seekWanted;
        seekWanted = null;
        await open(url, to);
        if (run !== seekRun) return;
      }
      reopening = false;
      if (playAfterSeek && doc.visibilityState !== "hidden") await start();
      if (run === seekRun) events.onBuffering(false);
    } catch (err) {
      if (run !== seekRun) return;
      reopening = false;
      events.onBuffering(false);
      events.onError(err instanceof Error ? err.message : describeError(err));
    }
  };

  const trySeek = () => {
    if (pendingSeek == null) return;
    const d = dur();
    if (d <= 0) {
      seekTimer ??= setTimeout(() => {
        seekTimer = null;
        trySeek();
      }, SEEK_RETRY_MS);
      return;
    }
    const to = pendingSeek;
    pendingSeek = null;
    try {
      av.seekTo(Math.round(to * 1000));
    } catch (err) {
      console.warn("[avplay] resume seek failed", err);
    }
  };

  const listener = (g: number) => ({
    onbufferingstart: () => g === gen && events.onBuffering(true),
    onbufferingcomplete: () => g === gen && events.onBuffering(false),
    oncurrentplaytime: (ms: number) => {
      if (g !== gen) return;
      // Ticks from before a seek lands would pull the shown position back.
      if (!seeking()) lastPos = ms / 1000;
      lastDur = dur();
      if (firstFrame) {
        const f = firstFrame;
        firstFrame = null;
        f();
      }
      trySeek();
      events.onTime(lastPos, lastDur);
    },
    onstreamcompleted: () => {
      if (g !== gen) return;
      playing = false;
      events.onEnded();
    },
    onerror: (type: string) => {
      if (g !== gen) return;
      events.onError(describeError(type));
    },
  });

  const onVisibility = () => {
    if (!opened) return;
    if (doc.visibilityState === "hidden") {
      if (suspended) return;
      if (state() === "PLAYING") {
        try {
          av.pause();
        } catch {}
        playing = false;
      }
      startSec = lastPos;
      suspended = true;
      try {
        av.suspend?.();
      } catch (err) {
        console.warn("[avplay] suspend failed", err);
      }
      return;
    }
    if (!suspended) return;
    suspended = false;
    try {
      av.restore?.();
    } catch (err) {
      console.warn("[avplay] restore failed", err);
    }
    // restore() can leave AVPlay idle at 0:00 (lessons.md): reopen at the saved spot, paused.
    const s = state();
    if (url && (s !== "READY" && s !== "PAUSED" && s !== "PLAYING")) {
      const at = startSec;
      const wasShown = shown;
      load(url, at)
        .then(() => {
          if (!wasShown) return;
          // load() only prepares: without the display the picture stays gone. Prepare already started at the saved spot.
          pendingSeek = missedStart ? at : null;
          showOnPlane();
        })
        .catch((err) => events.onError(describeError(err)));
    }
  };
  doc.addEventListener("visibilitychange", onVisibility);

  function load(src: string, start: number): Promise<void> {
    clearSeek();
    return open(src, start);
  }

  function open(src: string, start: number): Promise<void> {
    release();
    const g = gen;
    url = src;
    startSec = start;
    lastPos = start;
    return new Promise<void>((resolve, reject) => {
      const adaptive = /\.(m3u8|mpd)$/i.test(src.split("?")[0]);
      let timer: ReturnType<typeof setTimeout> | null = null;
      // There is one AVPlay: a source another player left open (one that failed, or a prepare-ahead) would make this
      // open() throw InvalidStateError, so it is closed first.
      if (state() !== "NONE") {
        try {
          av.stop();
        } catch {}
        try {
          av.close();
        } catch {}
      }
      try {
        av.open(src);
        opened = true;
        rect = null;
        av.setListener(listener(g));
        if (av.setBufferingParam) {
          av.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", BUFFER_SECONDS);
          av.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", BUFFER_SECONDS);
        }
        // In IDLE this returns at once and only sets where prepare starts; start() checks it was honoured.
        if (start > 0) {
          try {
            av.seekTo(Math.round(start * 1000));
          } catch (err) {
            console.warn("[avplay] start position not accepted", err);
          }
        }
      } catch (err) {
        reject(new Error(`open failed: ${describeError(err)}`));
        return;
      }
      timer = setTimeout(() => {
        if (g !== gen || prepared) return;
        reject(new Error("prepare timed out"));
      }, adaptive ? PREPARE_ADAPTIVE_TIMEOUT_MS : PREPARE_TIMEOUT_MS);
      try {
        av.prepareAsync(
          () => {
            if (timer) clearTimeout(timer);
            if (g !== gen) return reject(new Error("superseded"));
            prepared = true;
            let tracks: AvplayTrack[] = [];
            try {
              tracks = av.getTotalTrackInfo?.() ?? [];
            } catch {}
            // AVPlay lists only tracks it can decode: a picture with none is silent (lessons.md).
            if (tracks.length > 0 && !tracks.some((t) => t.type === "AUDIO")) {
              return reject(new Error("no playable audio track"));
            }
            const size = videoSize(tracks);
            rect = fitRect({ x: 0, y: 0, w: screen.width, h: screen.height }, size.w, size.h);
            lastDur = dur();
            let at = -1;
            try {
              at = av.getCurrentTime() / 1000;
            } catch {}
            missedStart = start > 0 && Math.abs(at - start) > START_TOLERANCE_SEC;
            resolve();
          },
          (err) => {
            if (timer) clearTimeout(timer);
            reject(new Error(`prepare failed: ${describeError(err)}`));
          },
        );
      } catch (err) {
        if (timer) clearTimeout(timer);
        reject(new Error(`prepare threw: ${describeError(err)}`));
      }
    });
  }

  function showOnPlane() {
    const r = rect ?? { x: 0, y: 0, w: screen.width, h: screen.height };
    av.setDisplayMethod?.("PLAYER_DISPLAY_MODE_FULL_SCREEN");
    av.setDisplayRect(r.x, r.y, r.w, r.h);
    shown = true;
  }

  function start(): Promise<void> {
    const g = gen;
    return new Promise<void>((resolve, reject) => {
      if (!prepared) return reject(new Error("not prepared"));
      const timer = setTimeout(() => {
        if (g === gen) reject(new Error("no first frame"));
      }, FIRST_FRAME_TIMEOUT_MS);
      firstFrame = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        pendingSeek = missedStart ? startSec : null;
        showOnPlane();
        av.play();
        playing = true;
      } catch (err) {
        clearTimeout(timer);
        reject(new Error(`play failed: ${describeError(err)}`));
      }
    });
  }

  return {
    load,
    start,
    toggle() {
      if (reopening) {
        playAfterSeek = !playAfterSeek;
        return;
      }
      try {
        if (state() === "PLAYING") {
          av.pause();
          playing = false;
        } else if (state() === "PAUSED") {
          av.play();
          playing = true;
        } else if (state() === "READY") {
          // Left paused by a seek: start() places the picture again.
          start().catch((err) => events.onError(err instanceof Error ? err.message : describeError(err)));
        }
      } catch (err) {
        console.warn("[avplay] toggle failed", err);
      }
    },
    isPlaying: () => (reopening ? playAfterSeek : playing),
    seekBy(sec) {
      if (!url) return;
      const d = lastDur || dur();
      const to = Math.min(Math.max(0, lastPos + sec), d > 0 ? d - 1 : Number.MAX_SAFE_INTEGER);
      lastPos = to;
      seekWanted = to;
      pendingSeek = null;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => void reopen(), SEEK_SETTLE_MS);
      events.onTime(lastPos, d);
    },
    position: () => lastPos,
    duration: () => lastDur || dur(),
    stop() {
      doc.removeEventListener("visibilitychange", onVisibility);
      clearSeek();
      release();
    },
  };
}
