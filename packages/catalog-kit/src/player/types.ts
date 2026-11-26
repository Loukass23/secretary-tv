import type { AspectMode, AudioTrackInfo } from "./tracks.ts";

export interface PlayerEvents {
  onTime(posSec: number, durSec: number): void;
  onEnded(): void;
  onBuffering(buffering: boolean): void;
  /** A failure after playback began. Failures before it reject load/start instead. */
  onError(message: string): void;
}

/**
 * One interface over AVPlay and an HTML5 <video>. load() opens and prepares
 * without playing, so the detail page can prepare ahead; start() plays and
 * resolves at the first frame.
 */
export interface TvPlayer {
  load(url: string, startSec: number): Promise<void>;
  start(): Promise<void>;
  toggle(): void;
  isPlaying(): boolean;
  seekBy(sec: number): void;
  position(): number;
  duration(): number;
  /** Audio tracks of the open source; empty when the player cannot list them (the built-in <video>). */
  audioTracks?(): AudioTrackInfo[];
  /** The index of the track playing, or -1 when unknown. */
  audioIndex?(): number;
  /** Plays another audio track. The pick is kept across the reopen a seek does. */
  selectAudio?(index: number): void;
  /** The page draws the captions: the firmware must not draw its own text track too. Kept across reopens. */
  silentSubtitles?(on: boolean): void;
  aspect?(): AspectMode;
  setAspect?(mode: AspectMode): void;
  /** Stops and releases the decoder. Safe to call at any time, more than once. */
  stop(): void;
}
