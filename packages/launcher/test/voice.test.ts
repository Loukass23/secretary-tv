import { test } from "node:test";
import assert from "node:assert/strict";
import { transcribeClip, VoiceError } from "../src/assistant.ts";
import { downsample, encodeWav, endpointer, envelope, levelOf, MAX_CLIP_MS, rms } from "../src/voice.ts";

test("level is RMS", () => {
  assert.equal(rms(new Float32Array(8)), 0);
  assert.equal(rms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
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

test("transcription failures say why", async () => {
  const wav = encodeWav(new Float32Array(4), 16000);
  const status = (code: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status: code })) as unknown as typeof fetch;
  assert.equal(await transcribeClip("http://s", wav, status(200, { transcript: "cinema mode" })), "cinema mode");
  for (const [code, reason] of [[503, "unavailable"], [422, "no-speech"], [500, "failed"]] as const) {
    await assert.rejects(transcribeClip("http://s", wav, status(code)), (e) => e instanceof VoiceError && e.reason === reason);
  }
  const offline = (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  await assert.rejects(transcribeClip("http://s", wav, offline), (e) => e instanceof VoiceError && e.reason === "failed");
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
