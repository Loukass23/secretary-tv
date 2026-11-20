import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantUnavailable } from "../src/gemini.ts";
import { GROQ_MODEL, transcribeGroq } from "../src/groq.ts";

const clip = new Uint8Array(new ArrayBuffer(4));

test("a clip goes to Groq's Whisper with the key and comes back as plain words", async () => {
  let seen: { url: string; auth: string | null; model: unknown; file: unknown } | undefined;
  const f = (async (url: string, init: RequestInit) => {
    const form = init.body as FormData;
    seen = { url, auth: new Headers(init.headers).get("authorization"), model: form.get("model"), file: form.get("file") };
    return new Response(JSON.stringify({ text: " Remind me to water the plants. " }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await transcribeGroq(clip, "gsk_test", f), "Remind me to water the plants");
  assert.equal(seen?.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(seen?.auth, "Bearer gsk_test");
  assert.equal(seen?.model, GROQ_MODEL);
  assert.ok(seen?.file instanceof Blob);
});

test("segments Whisper thinks are not speech are dropped, so noise never becomes a question", async () => {
  const noise = (async () =>
    new Response(JSON.stringify({ text: " Thank you.", segments: [{ text: " Thank you.", no_speech_prob: 0.92 }] }), { status: 200 })) as typeof fetch;
  assert.equal(await transcribeGroq(clip, "k", noise), "");
  const mixed = (async () =>
    new Response(
      JSON.stringify({ text: "x", segments: [{ text: " Dim the lights.", no_speech_prob: 0.02 }, { text: " Thank you.", no_speech_prob: 0.8 }] }),
      { status: 200 },
    )) as typeof fetch;
  assert.equal(await transcribeGroq(clip, "k", mixed), "Dim the lights");
});

test("a refusal or a network failure is a missing assistant, silence is an empty transcript", async () => {
  const refuse = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  await assert.rejects(() => transcribeGroq(clip, "k", refuse), AssistantUnavailable);
  const offline = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  await assert.rejects(() => transcribeGroq(clip, "k", offline), AssistantUnavailable);
  const silent = (async () => new Response(JSON.stringify({ text: "" }), { status: 200 })) as typeof fetch;
  assert.equal(await transcribeGroq(clip, "k", silent), "");
});
