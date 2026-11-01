// Gemini over its REST API with plain fetch: the server and Nest on the TV both call it (docs/launcher.md, "Ask Nest").
import { fromBase64, toBase64 } from "./base64.ts";

// Fastest first: measured on 2026-10-31, a one-line reply took 0.4-0.6 s on the lite models, 16 s on 3.6-flash (it
// thinks first) and over two minutes on 3.8-flash. Someone is waiting at the TV, so the lite models lead.
export const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
] as const;

/** Audio Gemini takes inline. Nest and Desk record WAV themselves, since Gemini does not list WebM. */
export const VOICE_TYPES = ["audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/mpeg", "audio/aac"];
/** About 30 s of 16 kHz mono WAV; Nest stops recording at 15 s. */
export const VOICE_MAX_BYTES = 1_000_000;

/** Gemini models with speech output; GEMINI_TTS_MODEL puts another first. */
const GEMINI_TTS_MODELS = ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"];

const geminiUrl = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

/** How long one model may take before the next is tried: someone is waiting at the TV. */
const GEMINI_TIMEOUT_MS = 8000;

/** Posts one request to each model in turn until one answers with a part; null when none does. */
export async function firstPart(models: readonly string[], key: string, body: unknown, f: typeof fetch): Promise<GeminiPart | null> {
  const payload = JSON.stringify(body);
  for (const model of models) {
    try {
      const res = await f(geminiUrl(model, key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const out = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
      const part = out.candidates?.[0]?.content?.parts?.[0];
      if (part) return part;
    } catch {
      // Try the next model.
    }
  }
  return null;
}

/** What was said in a short clip, or "" when there was no speech (or Gemini is down). */
export async function transcribe(audio: Uint8Array, mimeType: string, key: string, f: typeof fetch = fetch): Promise<string> {
  const part = await firstPart(
    GEMINI_FALLBACK_MODELS,
    key,
    {
      contents: [
        {
          parts: [
            { inlineData: { mimeType, data: toBase64(audio) } },
            {
              text: "Transcribe this spoken request to a TV assistant exactly, in the language spoken. Reply with the transcript only, or with nothing if there is no speech.",
            },
          ],
        },
      ],
    },
    f,
  );
  // Gemini punctuates like dictation ("Remind me to water the plants."); a typed prompt has no full stop, and the
  // reminder would keep it. Quotes go too.
  return part?.text?.trim().replace(/^["“]|["”]$/g, "").replace(/[.。!！]+$/u, "").trim() ?? "";
}

/** A reply read aloud as WAV, or null without a speech model. Emoji are dropped first: they would be read out. */
export async function speak(text: string, key: string, f: typeof fetch = fetch, model?: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const plain = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").trim();
  if (!plain) return null;
  const part = await firstPart(
    model ? [model, ...GEMINI_TTS_MODELS] : GEMINI_TTS_MODELS,
    key,
    {
      contents: [{ parts: [{ text: plain }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
      },
    },
    f,
  );
  const data = part?.inlineData?.data;
  if (!data) return null;
  // Gemini sends raw 16-bit PCM ("audio/L16;codec=pcm;rate=24000"), which <audio> cannot play without a header.
  const rate = Number(part.inlineData?.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
  return pcmToWav(fromBase64(data), rate);
}

/** 16-bit little-endian mono PCM in a WAV file. */
export function pcmToWav(pcm: Uint8Array, rate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** A WAV file as a data: URL for <audio>. */
export const wavDataUrl = (wav: Uint8Array) => `data:audio/wav;base64,${toBase64(wav)}`;
