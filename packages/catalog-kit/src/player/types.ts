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
  /** Stops and releases the decoder. Safe to call at any time, more than once. */
  stop(): void;
}
