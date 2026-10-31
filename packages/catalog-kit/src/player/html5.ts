import type { PlayerEvents, TvPlayer } from "./types.ts";

const LOAD_TIMEOUT_MS = 20_000;

/** Fallback when AVPlay cannot play a source: a plain <video> inside `host`. */
export function createHtml5Player(host: HTMLElement, events: PlayerEvents): TvPlayer {
  const video = document.createElement("video");
  video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:#000";
  host.appendChild(video);
  let startSec = 0;

  video.addEventListener("timeupdate", () => events.onTime(video.currentTime, video.duration || 0));
  video.addEventListener("ended", () => events.onEnded());
  video.addEventListener("waiting", () => events.onBuffering(true));
  video.addEventListener("playing", () => events.onBuffering(false));
  video.addEventListener("error", () => events.onError(video.error?.message ?? "video error"));

  const once = (name: string, ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} timed out`)), ms);
      video.addEventListener(
        name,
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  return {
    async load(url, start) {
      startSec = start;
      video.src = url;
      video.load();
      await once("loadedmetadata", LOAD_TIMEOUT_MS);
      if (startSec > 0) video.currentTime = startSec;
    },
    async start() {
      const playing = once("playing", LOAD_TIMEOUT_MS);
      await video.play();
      await playing;
    },
    toggle() {
      if (video.paused) void video.play();
      else video.pause();
    },
    isPlaying: () => !video.paused && !video.ended,
    seekBy(sec) {
      video.currentTime = Math.max(0, video.currentTime + sec);
    },
    position: () => video.currentTime,
    duration: () => video.duration || 0,
    stop() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}
