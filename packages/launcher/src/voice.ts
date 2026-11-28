// Ask Secretary by voice from a room microphone or Bluetooth speakerphone (docs/launcher.md, "Room microphone").
// Listens to `devicechange` and re-checks devices before recording/playback so Bluetooth speakers turned on after boot
// are detected immediately, and routes AI speech via `setSinkId` while TV speakers remain dedicated to AVPlay media.

export const CLIP_RATE = 16000;
const SPEECH_RMS = 0.02;
const MIN_SPEECH_MS = 250;
const TRAILING_SILENCE_MS = 1200;
const NO_SPEECH_MS = 6000;
export const MAX_CLIP_MS = 15000;

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/** Peak half-window RMS so syllabic consonants and quick words register crisply in the visual wave. */
export function visualRms(frame: Float32Array): number {
  if (frame.length < 64) return rms(frame);
  const mid = frame.length >> 1;
  return Math.max(rms(frame.subarray(0, mid)), rms(frame.subarray(mid)));
}

export type EndReason = "silence" | "no-speech" | "max";

export function endpointer() {
  let elapsed = 0;
  let heard = false;
  let loud = 0;
  let quiet = 0;
  return {
    get heard() {
      return heard;
    },
    feed(level: number, ms: number): EndReason | null {
      elapsed += ms;
      if (level >= SPEECH_RMS) {
        loud += ms;
        quiet = 0;
        if (loud >= MIN_SPEECH_MS) heard = true;
      } else if (heard) {
        quiet += ms;
        if (quiet >= TRAILING_SILENCE_MS) return "silence";
      } else {
        loud = 0;
        if (elapsed >= NO_SPEECH_MS) return "no-speech";
      }
      return elapsed >= MAX_CLIP_MS ? "max" : null;
    },
  };
}

export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function encodeWav(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(new ArrayBuffer(44 + dataBytes));
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  put(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  put(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

const NOISE_FLOOR = 0.005;
const LOUD_RMS = 0.085;
export const levelOf = (r: number) => (r <= NOISE_FLOOR ? 0 : Math.min(1, ((r - NOISE_FLOOR) / (LOUD_RMS - NOISE_FLOOR)) ** 0.58));
export const ENVELOPE_MS = 50;

export function envelope(wav: Uint8Array): number[] {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(wav[at], wav[at + 1], wav[at + 2], wav[at + 3]);
  if (wav.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return [];
  let rate = 0;
  let channels = 1;
  let bits = 0;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = v.getUint32(at + 4, true);
    if (tag(at) === "fmt ") {
      channels = v.getUint16(at + 10, true);
      rate = v.getUint32(at + 12, true);
      bits = v.getUint16(at + 22, true);
    } else if (tag(at) === "data") {
      if (bits !== 16 || !rate) return [];
      const frames = Math.floor(Math.min(size, wav.length - at - 8) / (2 * channels));
      const step = Math.max(1, Math.round((rate * ENVELOPE_MS) / 1000));
      const out: number[] = [];
      for (let start = 0; start < frames; start += step) {
        let sum = 0;
        const end = Math.min(frames, start + step);
        for (let f = start; f < end; f++) {
          const s = v.getInt16(at + 8 + f * 2 * channels, true) / 0x8000;
          sum += s * s;
        }
        out.push(levelOf(Math.sqrt(sum / (end - start))));
      }
      return out;
    }
    at += 8 + size + (size & 1);
  }
  return [];
}

export interface AudioDeviceLike {
  kind: string;
  deviceId: string;
  label: string;
}

const BT_RE = /bluetooth|bt[-_\s]|a2dp|hands[-_\s]?free|headset|earbuds?/i;
export const ROOM_DEVICE = /jabra|speakerphone|conference|bluetooth|bt[-_\s]|a2dp|hands[-_\s]?free|headset|earbuds?/i;
const BUILTIN_ID = /^(?:default|communications)$/i;
const TV_BUILTIN_LABEL = /builtin|internal|tv[-_\s]?speaker|hdmi|optical|arc/i;

export function pickRoomMic<T extends AudioDeviceLike>(devices: readonly T[]): T | undefined {
  const inputs = devices.filter((d) => d.kind === "audioinput");
  return inputs.find((d) => ROOM_DEVICE.test(d.label)) ?? inputs[0];
}

export function pickRoomSink<T extends AudioDeviceLike>(devices: readonly T[]): T | undefined {
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  return (
    outputs.find((d) => ROOM_DEVICE.test(d.label)) ??
    outputs.find((d) => d.deviceId && !BUILTIN_ID.test(d.deviceId) && Boolean(d.label) && !TV_BUILTIN_LABEL.test(d.label))
  );
}

export interface AudioRouteState {
  hasMic: boolean;
  micLabel?: string;
  roomMic: boolean;
  sinkId?: string;
  sinkLabel?: string;
  bluetooth: boolean;
}

export function summarizeAudioDevices(devices: readonly AudioDeviceLike[]): AudioRouteState {
  const micDev = pickRoomMic(devices);
  const sinkDev = pickRoomSink(devices);
  return {
    hasMic: Boolean(micDev),
    micLabel: micDev?.label || undefined,
    roomMic: Boolean(micDev && ROOM_DEVICE.test(micDev.label)),
    sinkId: sinkDev?.deviceId || undefined,
    sinkLabel: sinkDev?.label || undefined,
    bluetooth: Boolean((micDev && BT_RE.test(micDev.label)) || (sinkDev && BT_RE.test(sinkDev.label))),
  };
}

const CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
let mic: Promise<MediaStream> | null = null;
let openedStream: MediaStream | null = null;
let routeState: AudioRouteState = { hasMic: false, roomMic: false, bluetooth: false };
const routeListeners = new Set<(state: AudioRouteState) => void>();

const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

function closeCachedMic() {
  mic = null;
  stopStream(openedStream);
  openedStream = null;
}

const streamLive = (s: MediaStream | null) => Boolean(s?.active && s.getAudioTracks()[0]?.readyState === "live");

function publishRoute(next: AudioRouteState) {
  if (JSON.stringify(next) === JSON.stringify(routeState)) return;
  routeState = next;
  for (const fn of routeListeners) fn(next);
}

export const getAudioRouteState = (): AudioRouteState => routeState;

export async function refreshAudioDevices(opts: { unlockLabels?: boolean } = {}): Promise<AudioRouteState> {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md?.enumerateDevices) return routeState;
  try {
    let list = await md.enumerateDevices();
    if (opts.unlockLabels && md.getUserMedia && list.some((d) => (d.kind === "audioinput" || d.kind === "audiooutput") && !d.label)) {
      try {
        const probe = await md.getUserMedia({ audio: CONSTRAINTS });
        list = await md.enumerateDevices();
        if (!streamLive(openedStream)) {
          openedStream = probe;
          mic = Promise.resolve(probe);
        } else stopStream(probe);
      } catch {
        // Outputs may still enumerate when mic permission or hardware is absent.
      }
    }
    const next = summarizeAudioDevices(list);
    if (openedStream) {
      const track = openedStream.getAudioTracks()[0];
      const roomMic = pickRoomMic(list);
      const upgraded = roomMic && ROOM_DEVICE.test(roomMic.label) && !ROOM_DEVICE.test(track?.label ?? "") && roomMic.deviceId !== track?.getSettings?.().deviceId;
      if (!streamLive(openedStream) || upgraded) closeCachedMic();
    }
    publishRoute(next);
    return next;
  } catch {
    return routeState;
  }
}

export function watchAudioDevices(listener: (state: AudioRouteState) => void): () => void {
  routeListeners.add(listener);
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  const onChange = () => void refreshAudioDevices({ unlockLabels: true });
  md?.addEventListener?.("devicechange", onChange);
  void refreshAudioDevices({ unlockLabels: false });
  return () => {
    routeListeners.delete(listener);
    md?.removeEventListener?.("devicechange", onChange);
  };
}

async function openMic(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw new Error("no getUserMedia");
  const first = await md.getUserMedia({ audio: CONSTRAINTS });
  const list = await md.enumerateDevices();
  publishRoute(summarizeAudioDevices(list));
  const room = pickRoomMic(list);
  const current = first.getAudioTracks()[0]?.getSettings().deviceId;
  let chosen = first;
  if (room && ROOM_DEVICE.test(room.label) && room.deviceId && room.deviceId !== current) {
    stopStream(first);
    chosen = await md.getUserMedia({ audio: { ...CONSTRAINTS, deviceId: { exact: room.deviceId } } });
  }
  openedStream = chosen;
  chosen.getAudioTracks().forEach((t) =>
    t.addEventListener?.("ended", () => {
      if (openedStream === chosen) closeCachedMic();
      void refreshAudioDevices();
    }),
  );
  return chosen;
}

export const micName = (stream: MediaStream): string => stream.getAudioTracks()[0]?.label || "microphone";

export interface Recording {
  stop(): void;
  cancel(): void;
  readonly cancelled: boolean;
  readonly heard: boolean;
  done: Promise<Uint8Array<ArrayBuffer> | null>;
  name: string;
}

let audioCtx: AudioContext | null = null;

export async function record(onLevel?: (level: number | null) => void): Promise<Recording> {
  stopPlayback();
  await refreshAudioDevices();
  if (!mic || !streamLive(openedStream)) {
    closeCachedMic();
    mic = openMic();
  }
  let stream: MediaStream;
  try {
    stream = await mic;
    if (!streamLive(stream)) {
      closeCachedMic();
      mic = openMic();
      stream = await mic;
    }
  } catch (e) {
    closeCachedMic();
    throw e;
  }
  if (!audioCtx) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
  }
  const ctx = audioCtx;
  if (ctx.state === "suspended") await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const bufSize = 2048;
  const node = ctx.createScriptProcessor(bufSize, 1, 1);
  const frames: Float32Array[] = [];
  const ends = endpointer();
  const frameMs = (bufSize / ctx.sampleRate) * 1000;
  let finish!: (clip: Uint8Array<ArrayBuffer> | null) => void;
  const done = new Promise<Uint8Array<ArrayBuffer> | null>((r) => (finish = r));
  let stopped = false;
  let cancelled = false;
  onLevel?.(0);

  const teardown = () => {
    stopped = true;
    onLevel?.(null);
    node.disconnect();
    source.disconnect();
    void ctx.suspend();
  };

  const cancel = () => {
    if (stopped) return;
    cancelled = true;
    teardown();
    finish(null);
  };

  const stop = () => {
    if (stopped) return;
    teardown();
    if (!ends.heard) return finish(null);
    const all = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const f of frames) {
      all.set(f, at);
      at += f.length;
    }
    finish(encodeWav(downsample(all, ctx.sampleRate, CLIP_RATE), Math.min(CLIP_RATE, ctx.sampleRate)));
  };

  node.onaudioprocess = (e) => {
    if (stopped) return;
    const frame = new Float32Array(e.inputBuffer.getChannelData(0));
    frames.push(frame);
    const level = rms(frame);
    onLevel?.(levelOf(visualRms(frame)));
    if (ends.feed(level, frameMs)) stop();
  };
  source.connect(node);
  node.connect(ctx.destination);
  return {
    stop,
    cancel,
    done,
    name: micName(stream),
    get cancelled() {
      return cancelled;
    },
    get heard() {
      return ends.heard;
    },
  };
}

let activeAudioStop: (() => void) | null = null;
export const stopPlayback = (): void => activeAudioStop?.();

export async function play(src: string | Uint8Array, onLevel?: (level: number | null) => void): Promise<void> {
  stopPlayback();
  let wav: Uint8Array;
  try {
    wav = typeof src === "string" ? new Uint8Array(await (await fetch(src)).arrayBuffer()) : src;
  } catch {
    return;
  }
  const url = URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }));
  const audio = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  const levels = onLevel ? envelope(wav) : [];
  try {
    const state = await refreshAudioDevices({ unlockLabels: true });
    if (state.sinkId && audio.setSinkId) await audio.setSinkId(state.sinkId);
  } catch {
    // Keep default output when setSinkId is unsupported or refused.
  }
  const meter = levels.length ? setInterval(() => onLevel!(levels[Math.floor((audio.currentTime * 1000) / ENVELOPE_MS)] ?? 0), 30) : undefined;
  return new Promise<void>((resolve) => {
    const done = () => {
      if (activeAudioStop === stopNow) activeAudioStop = null;
      resolve();
    };
    const stopNow = () => {
      try {
        audio.pause();
      } catch {}
      done();
    };
    activeAudioStop = stopNow;
    audio.onended = audio.onerror = done;
    audio.play().catch(done);
  }).finally(() => {
    clearInterval(meter);
    URL.revokeObjectURL(url);
    if (levels.length) onLevel!(null);
  });
}
