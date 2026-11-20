import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantUnavailable, transcribe } from "../src/gemini.ts";

const clip = new Uint8Array([1, 2, 3]);
const refuse = (status: number) => (async () => new Response("{}", { status })) as typeof fetch;

test("a Gemini that refuses every model is told apart from a clip with no speech", async () => {
  await assert.rejects(() => transcribe(clip, "audio/wav", "k", refuse(402), true), AssistantUnavailable);
  await assert.rejects(() => transcribe(clip, "audio/wav", "k", (async () => { throw new Error("offline"); }) as typeof fetch, true), AssistantUnavailable);
  // Without strict it stays an empty transcript, as before.
  assert.equal(await transcribe(clip, "audio/wav", "k", refuse(402)), "");
});

test("a model that answers with nothing is no speech, not a missing assistant", async () => {
  const silent = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 })) as typeof fetch;
  assert.equal(await transcribe(clip, "audio/wav", "k", silent, true), "");
});

test("the transcript drops dictation punctuation", async () => {
  const said = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Remind me to water the plants." }] } }] }), { status: 200 })) as typeof fetch;
  assert.equal(await transcribe(clip, "audio/wav", "k", said, true), "Remind me to water the plants");
});
