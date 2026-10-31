// Ask Nest by voice from a room microphone (a USB conference speaker on the TV, say): docs/launcher.md, "Room
// microphone". Records a short clip as 16 kHz WAV, which the server sends to Gemini. No MediaRecorder: Gemini does
// not list WebM, and the TV's MediaRecorder support varies, so the samples are taken with Web Audio and encoded here.

/** Sample rate of the clip sent to the server: plenty for speech, a third of the bytes of 48 kHz. */
export const CLIP_RATE = 16000;
/** Level (RMS, 0..1) above which a frame counts as speech. */
const SPEECH_RMS = 0.02;
/** Silence after speech that ends the clip. */
const TRAILING_SILENCE_MS = 1200;
/** Give up when nobody speaks this long after the key press. */
const NO_SPEECH_MS = 6000;
export const MAX_CLIP_MS = 15000;

/** Root mean square of a frame, 0 for silence, about 0.7 for a full-scale sine. */
export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

export type EndReason = "silence" | "no-speech" | "max";

/** Decides when a clip ends from the level of each frame. `feed` returns why it ended, or null to keep going. */
export function endpointer() {
  let elapsed = 0;
  let heard = false;
  let quiet = 0;
  return {
    feed(level: number, ms: number): EndReason | null {
      elapsed += ms;
      if (level >= SPEECH_RMS) {
        heard = true;
        quiet = 0;
      } else {
        quiet += ms;
      }
      if (elapsed >= MAX_CLIP_MS) return "max";
      if (heard && quiet >= TRAILING_SILENCE_MS) return "silence";
      if (!heard && elapsed >= NO_SPEECH_MS) return "no-speech";
      return null;
    },
    get heard() {
      return heard;
    },
  };
}

/** Averages each run of input samples into one output sample (fine for speech going down to 16 kHz). */
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return samples;
  const ratio = from / to;
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

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** A speakerphone by its device label, for both its microphone and its speaker. */
// Not a bare "speak": the TV calls its own output "builtin-speaker".
const ROOM_DEVICE = /jabra|speakerphone|conference/i;

/** The microphone stays open between asks, so the second press starts at once. */
let mic: Promise<MediaStream> | null = null;

const CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** Opens the room microphone, preferring a Jabra (or any USB speakerphone) over the default input. */
async function openMic(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw new Error("no getUserMedia");
  const first = await md.getUserMedia({ audio: CONSTRAINTS });
  // Labels are only filled in once a stream is open.
  const inputs = (await md.enumerateDevices()).filter((d) => d.kind === "audioinput");
  const room = inputs.find((d) => ROOM_DEVICE.test(d.label));
  const current = first.getAudioTracks()[0]?.getSettings().deviceId;
  if (!room || room.deviceId === current) return first;
  first.getTracks().forEach((t) => t.stop());
  return md.getUserMedia({ audio: { ...CONSTRAINTS, deviceId: { exact: room.deviceId } } });
}

export function micName(stream: MediaStream): string {
  return stream.getAudioTracks()[0]?.label || "microphone";
}

export interface Recording {
  /** Ends the clip now (the mic key pressed again). */
  stop(): void;
  /** The clip as WAV, or null when nobody spoke. */
  done: Promise<Uint8Array<ArrayBuffer> | null>;
  /** Which microphone it is recording from. */
  name: string;
}

/** Starts a clip; rejects when the TV gives the app no microphone. */
export async function record(): Promise<Recording> {
  if (!mic) mic = openMic();
  let stream: MediaStream;
  try {
    stream = await mic;
  } catch (e) {
    mic = null;
    throw e;
  }
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but present on every TV; AudioWorklet would need a separate module file.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const frames: Float32Array[] = [];
  const ends = endpointer();
  const frameMs = (4096 / ctx.sampleRate) * 1000;
  let finish!: (clip: Uint8Array<ArrayBuffer> | null) => void;
  const done = new Promise<Uint8Array<ArrayBuffer> | null>((r) => (finish = r));
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    node.disconnect();
    source.disconnect();
    void ctx.close();
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
    if (ends.feed(rms(frame), frameMs)) stop();
  };
  source.connect(node);
  // A ScriptProcessor only runs while connected to the output; it writes silence there.
  node.connect(ctx.destination);
  return { stop, done, name: micName(stream) };
}

/** Plays a spoken reply (a data: URL from the server) on the speakerphone when there is one, else the TV's output. */
export async function play(src: string): Promise<void> {
  const audio = new Audio(src) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  try {
    // The TV lists a USB speakerphone as an output too, but keeps playing on its own speakers unless told.
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    const room = outputs.find((d) => ROOM_DEVICE.test(d.label));
    if (room && audio.setSinkId) await audio.setSinkId(room.deviceId);
  } catch {
    // The default output it is.
  }
  return new Promise((resolve) => {
    audio.onended = audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}
