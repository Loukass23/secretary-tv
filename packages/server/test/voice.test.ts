import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { pcmToWav, speak } from "../src/companion.ts";

const WAV = pcmToWav(new Uint8Array(3200), 16000);

/** Gemini stand-in: transcribes every clip as `heard`, and speaks two PCM samples. */
function gemini(heard: string, calls: string[] = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes("generativelanguage.googleapis.com")) throw new Error(`unexpected ${u}`);
    const body = String(init?.body);
    calls.push(body.includes("responseModalities") ? "tts" : body.includes("inlineData") ? "transcribe" : "chat");
    const part = body.includes("responseModalities")
      ? { inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from([1, 0, 2, 0]).toString("base64") } }
      : body.includes("inlineData")
        ? { text: heard }
        : { text: "Very well." };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [part] } }] }));
  }) as typeof fetch;
}

const voiceApp = (heard: string, calls?: string[], geminiApiKey = "g-key") =>
  createApp({ apiKey: "k", baseUrl: "http://tv", upstream: "", geminiApiKey, fetch: gemini(heard, calls) });

const post = (body: BodyInit, type = "audio/wav") =>
  new Request("http://x/ai/transcribe", { method: "POST", headers: { "content-type": type }, body });

test("a clip comes back as words, without asking the assistant", async () => {
  const calls: string[] = [];
  const res = await voiceApp("Remind me to water the plants", calls)(post(WAV));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { transcript: "Remind me to water the plants" });
  assert.deepEqual(calls, ["transcribe"]);
});

test("transcription refuses what Gemini cannot take", async () => {
  assert.equal((await voiceApp("x", [], "")(post(WAV))).status, 503);
  assert.equal((await voiceApp("x")(post(WAV, "audio/webm"))).status, 415);
  assert.equal((await voiceApp("x")(post(new Uint8Array(0)))).status, 400);
  assert.equal((await voiceApp("x")(post(new Uint8Array(1_000_001)))).status, 413);
  assert.equal((await voiceApp("")(post(WAV))).status, 422);
});

test("asking with speak returns the reply as WAV", async () => {
  const calls: string[] = [];
  const res = await voiceApp("", calls)(
    new Request("http://x/ai/ask", { method: "POST", body: JSON.stringify({ prompt: "How are you?", source: "tv", speak: true }) }),
  );
  const body = (await res.json()) as { reply: string; speech: string; turn: { source: string } };
  assert.equal(body.reply, "Very well.");
  assert.equal(body.turn.source, "tv");
  assert.ok(body.speech.startsWith("data:audio/wav;base64,UklGR"));
  assert.deepEqual(calls, ["chat", "tts"]);
});

test("asking without speak sends no speech", async () => {
  const calls: string[] = [];
  const res = await voiceApp("", calls)(new Request("http://x/ai/ask", { method: "POST", body: JSON.stringify({ prompt: "Hi" }) }));
  assert.equal(((await res.json()) as { speech?: string }).speech, undefined);
  assert.deepEqual(calls, ["chat"]);
});

test("speech drops emoji, and wraps Gemini's PCM in a WAV header", async () => {
  const sent: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push(String(init?.body));
    return gemini("")(url, init);
  }) as typeof fetch;
  const wav = await speak("🦅 Cinema stomp executed", "g-key", f);
  assert.ok(wav);
  assert.ok(!sent[0].includes("🦅") && sent[0].includes("Cinema stomp executed"));
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint32(40, true), 4);
  assert.equal(await speak("🦅", "g-key", f), null);
});
