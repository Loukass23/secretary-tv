// Speech to text on Groq's hosted Whisper, over plain fetch. Only the transcription: answers and spoken replies stay on
// Gemini. Nest on the TV and the server can both call it (docs/launcher.md, "Voice").
import { AssistantUnavailable } from "./gemini.ts";

/** The fast Whisper: a short clip comes back in well under a second. */
export const GROQ_MODEL = "whisper-large-v3-turbo";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TIMEOUT_MS = 8000;
/** Whisper's own estimate that a segment is not speech: above it, the words are invented from noise ("Thank you."). */
const NO_SPEECH_PROB = 0.6;

/**
 * What was said in a clip (WAV), or "" when Whisper heard nothing. Throws AssistantUnavailable when Groq refuses or cannot
 * be reached (a bad key, the quota, no network), so the caller can try another provider or say "no assistant".
 */
export async function transcribeGroq(audio: Uint8Array<ArrayBuffer>, key: string, f: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "clip.wav");
  form.append("model", GROQ_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  let res: Response;
  try {
    res = await f(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  } catch {
    throw new AssistantUnavailable();
  }
  if (!res.ok) throw new AssistantUnavailable();
  const out = (await res.json()) as { text?: string; segments?: { text?: string; no_speech_prob?: number }[] };
  const said = out.segments?.length
    ? out.segments.filter((s) => (s.no_speech_prob ?? 0) < NO_SPEECH_PROB).map((s) => s.text ?? "").join(" ")
    : out.text;
  // Same clean-up as Gemini's transcripts: no closing full stop, no quotes.
  return said?.trim().replace(/^["“]|["”]$/g, "").replace(/[.。!！]+$/u, "").trim() ?? "";
}
