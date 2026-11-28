import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type AudioDeviceLike,
  type AudioRouteState,
  downsample,
  encodeWav,
  endpointer,
  envelope,
  levelOf,
  MAX_CLIP_MS,
  pickRoomMic,
  pickRoomSink,
  rms,
  summarizeAudioDevices,
  visualRms,
  watchAudioDevices,
} from "../src/voice.ts";

test("level is RMS", () => {
  assert.equal(rms(new Float32Array(8)), 0);
  assert.equal(rms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
});

test("visualRms catches syllabic bursts in either half of a frame and gates ambient noise", () => {
  const burst = new Float32Array(128);
  for (let i = 64; i < 128; i++) burst[i] = 0.08;
  assert.ok(visualRms(burst) > rms(burst) * 1.3);
  assert.equal(levelOf(0.003), 0);
  assert.ok(levelOf(0.04) > 0.55);
  assert.equal(levelOf(1), 1);
});

test("a clip ends after speech and a pause, not during it", () => {
  const ends = endpointer();
  assert.equal(ends.feed(0, 500), null);
  assert.equal(ends.feed(0.2, 500), null);
  assert.equal(ends.feed(0, 1000), null);
  assert.equal(ends.feed(0.2, 100), null);
  assert.equal(ends.feed(0, 1100), null);
  assert.equal(ends.feed(0, 100), "silence");
});

test("a short noise is not speech: the clip gives up, and nothing is sent", () => {
  const ends = endpointer();
  assert.equal(ends.feed(0.3, 100), null);
  assert.equal(ends.feed(0.001, 1000), null);
  assert.equal(ends.feed(0.001, 5000), "no-speech");
  assert.equal(ends.heard, false);
  // A quarter of a second of voice does count.
  const voice = endpointer();
  voice.feed(0.2, 150);
  assert.equal(voice.heard, false);
  voice.feed(0.2, 100);
  assert.equal(voice.heard, true);
});

test("a clip gives up on silence, and stops at the cap", () => {
  const quiet = endpointer();
  let end = null;
  for (let t = 0; t < 10_000 && !end; t += 100) end = quiet.feed(0.001, 100);
  assert.equal(end, "no-speech");
  assert.equal(quiet.heard, false);

  const talker = endpointer();
  end = null;
  let t = 0;
  for (; !end; t += 100) end = talker.feed(0.3, 100);
  assert.equal(end, "max");
  assert.equal(t, MAX_CLIP_MS);
});

test("48 kHz goes down to 16 kHz by averaging", () => {
  const out = downsample(new Float32Array([0, 0.3, 0.6, 1, 1, 1]), 48000, 16000);
  assert.deepEqual([...out].map((x) => Math.round(x * 10) / 10), [0.3, 1]);
  const same = new Float32Array([1, 2]);
  assert.equal(downsample(same, 16000, 16000), same);
});

test("WAV is 16-bit mono with the right header", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 15)), "WAVEfmt");
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(40, true), 6);
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [0, 32767, -32768]);
});

test("a reply's envelope follows its loudness every 50 ms", () => {
  // 100 ms of silence then 100 ms of a loud tone, at 16 kHz.
  const rate = 16000;
  const samples = new Float32Array(rate / 5);
  for (let i = rate / 10; i < samples.length; i++) samples[i] = 0.3 * Math.sin(i / 3);
  const env = envelope(encodeWav(samples, rate));
  assert.equal(env.length, 4);
  assert.deepEqual(env.slice(0, 2), [0, 0]);
  assert.ok(env[2] > 0.9 && env[3] > 0.9);
  assert.deepEqual(envelope(new Uint8Array(8)), []);
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(1), 1);
});

test("Bluetooth and room speakerphones are picked over TV built-in speakers, and hot-plug devicechange updates routing", async () => {
  const bootOnlyTv: AudioDeviceLike[] = [
    { kind: "audiooutput", deviceId: "default", label: "builtin-speaker" },
    { kind: "audiooutput", deviceId: "hdmi-arc", label: "HDMI ARC Soundbar" },
  ];
  assert.equal(pickRoomMic(bootOnlyTv), undefined);
  assert.equal(pickRoomSink(bootOnlyTv), undefined);
  assert.deepEqual(summarizeAudioDevices(bootOnlyTv), {
    hasMic: false,
    micLabel: undefined,
    roomMic: false,
    sinkId: undefined,
    sinkLabel: undefined,
    bluetooth: false,
  });

  const withBluetooth: AudioDeviceLike[] = [
    ...bootOnlyTv,
    { kind: "audioinput", deviceId: "mic-default", label: "Default Audio Input" },
    { kind: "audioinput", deviceId: "bt-jabra-mic", label: "Jabra SPEAK 510 USB (bluetooth voice)" },
    { kind: "audiooutput", deviceId: "bt-media-sink", label: "BluetoothMedia (bluetooth media)" },
  ];
  assert.equal(pickRoomMic(withBluetooth)?.deviceId, "bt-jabra-mic");
  assert.equal(pickRoomSink(withBluetooth)?.deviceId, "bt-media-sink");
  const summary = summarizeAudioDevices(withBluetooth);
  assert.equal(summary.hasMic, true);
  assert.equal(summary.roomMic, true);
  assert.equal(summary.bluetooth, true);
  assert.equal(summary.sinkId, "bt-media-sink");

  // Simulate turning on the Bluetooth speaker after the app booted via navigator.mediaDevices devicechange.
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let currentList: AudioDeviceLike[] = bootOnlyTv;
  const handlers = new Set<() => void>();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        enumerateDevices: async () => currentList,
        getUserMedia: async () => ({
          active: true,
          getTracks: () => [{ stop() {} }],
          getAudioTracks: () => [{ label: "Jabra SPEAK 510 USB (bluetooth voice)", readyState: "live", getSettings: () => ({ deviceId: "bt-jabra-mic" }), stop() {} }],
        }),
        addEventListener: (ev: string, fn: () => void) => {
          if (ev === "devicechange") handlers.add(fn);
        },
        removeEventListener: (ev: string, fn: () => void) => {
          if (ev === "devicechange") handlers.delete(fn);
        },
      },
    },
  });
  try {
    const seen: AudioRouteState[] = [];
    const unwatch = watchAudioDevices((s) => seen.push(s));
    await new Promise((r) => setTimeout(r, 15));
    // Hot-plug Bluetooth speakerphone (initially unlabeled until getUserMedia unlocks labels, then labeled).
    let unlocked = false;
    currentList = [
      ...bootOnlyTv,
      { kind: "audioinput", deviceId: "bt-jabra-mic", label: "" },
      { kind: "audiooutput", deviceId: "bt-media-sink", label: "" },
    ];
    (globalThis.navigator.mediaDevices as unknown as { enumerateDevices: () => Promise<AudioDeviceLike[]> }).enumerateDevices = async () =>
      unlocked ? withBluetooth : currentList;
    const origGum = globalThis.navigator.mediaDevices.getUserMedia.bind(globalThis.navigator.mediaDevices);
    globalThis.navigator.mediaDevices.getUserMedia = async (c) => {
      unlocked = true;
      return origGum(c);
    };
    for (const fn of handlers) fn();
    await new Promise((r) => setTimeout(r, 25));
    unwatch();
    assert.equal(handlers.size, 0);
    assert.ok(seen.some((s) => s.bluetooth && s.sinkId === "bt-media-sink" && s.roomMic));
  } finally {
    if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
