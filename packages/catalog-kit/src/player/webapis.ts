// The slice of Samsung's webapis.avplay this app uses, declared by hand so
// tests can pass a stub.
export type AvplayState = "NONE" | "IDLE" | "READY" | "PLAYING" | "PAUSED";

export type AvplayTrack = { index: number; type: string; extra_info: string };

export type AvplayListener = {
  onbufferingstart?: () => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (ms: number) => void;
  onstreamcompleted?: () => void;
  onevent?: (type: string, data: string) => void;
  onerror?: (type: string) => void;
};

export type Avplay = {
  open(url: string): void;
  close(): void;
  prepareAsync(ok: () => void, err: (e: unknown) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(ms: number, ok?: () => void, err?: (e: unknown) => void): void;
  getState(): AvplayState;
  getDuration(): number;
  getCurrentTime(): number;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayMethod?(method: string): void;
  setListener(l: AvplayListener): void;
  setBufferingParam?(option: string, unit: string, amount: number): void;
  getTotalTrackInfo?(): AvplayTrack[];
  /** Only ever called with "AUDIO": selecting a TEXT track can crash the decoder (docs/lessons.md). */
  setSelectTrack?(type: "AUDIO", index: number): void;
  getCurrentStreamInfo?(): AvplayTrack[];
  /** Keeps the firmware from drawing its own default text track under the page's captions. */
  setSilentSubtitle?(on: boolean): void;
  suspend?(): void;
  restore?(): void;
};

export type Webapis = { avplay: Avplay };

export function webapis(): Webapis | null {
  const w = (globalThis as { webapis?: Partial<Webapis> }).webapis;
  return w?.avplay ? (w as Webapis) : null;
}
