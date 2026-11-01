// Ask Nest: the assistant panel's data (docs/launcher.md). Talks to @secretary/server's /ai/ask and
// /ai/state, which the phone companion uses too, so prompts from either show on the TV.
import type { Weather } from "@secretary/assistant";
import type { WaveState } from "@secretary/tv-kit/src/glass/index.ts";
import type { Reminder, SearchResult } from "./apps.ts";

export interface AssistantTurn {
  id: number;
  prompt: string;
  reply: string;
  action: string;
  source: "tv" | "companion";
  at: number;
  query?: string;
  results?: SearchResult[];
}

export interface AssistantState {
  rev: number;
  pending: { prompt: string; source: "tv" | "companion"; at: number } | null;
  turns: AssistantTurn[];
}

export interface AskReply {
  reply: string;
  action: string;
  reminders?: Reminder[];
  turn?: AssistantTurn;
  /** The reply read aloud (a data: URL), when asked for and the server has a speech model. */
  speech?: string | null;
}

/** The chips under the wave: the first opens the keyboard (and its voice input), the rest are prompts. */
export const CHIPS = [
  { label: "🎤 Ask", prompt: "" },
  { label: "Something for tonight", prompt: "Something for tonight" },
  { label: "Cinema lights", prompt: "Cinema mode" },
  { label: "Briefing", prompt: "Briefing" },
] as const;

export const askNest = async (
  serverUrl: string,
  prompt: string,
  f: typeof fetch = fetch,
  speak = false,
): Promise<AskReply> => {
  const res = await f(`${serverUrl}/ai/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, source: "tv", ...(speak ? { speak } : {}) }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as AskReply;
};

/** Why a clip gave no words: the server has no Gemini key, nobody spoke, or it failed. */
export class VoiceError extends Error {
  readonly reason: "unavailable" | "no-speech" | "failed";
  constructor(reason: VoiceError["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

/** The words in a recorded clip (WAV), from the server's /ai/transcribe. */
export const transcribeClip = async (serverUrl: string, wav: Uint8Array<ArrayBuffer>, f: typeof fetch = fetch): Promise<string> => {
  let res: Response;
  try {
    res = await f(`${serverUrl}/ai/transcribe`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: wav,
    });
  } catch {
    throw new VoiceError("failed");
  }
  if (res.status === 503) throw new VoiceError("unavailable");
  if (res.status === 422) throw new VoiceError("no-speech");
  if (!res.ok) throw new VoiceError("failed");
  return ((await res.json()) as { transcript: string }).transcript;
};

export const fetchAssistant = async (serverUrl: string, f: typeof fetch = fetch): Promise<AssistantState> => {
  const res = await f(`${serverUrl}/ai/state`);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as AssistantState;
};

export type { Weather } from "@secretary/assistant";

/** The server's forecast, when the TV knows no place of its own (weather.ts); null without one. */
export const fetchWeather = async (serverUrl: string, f: typeof fetch = fetch): Promise<Weather | null> => {
  try {
    const res = await f(`${serverUrl}/weather`);
    return res.ok ? ((await res.json()) as Weather) : null;
  } catch {
    return null;
  }
};

/** Artwork through the server, which adds the CORS header the canvas needs to read its colour. */
export const artProxy = (serverUrl: string, src: string) => `${serverUrl}/art?u=${encodeURIComponent(src)}`;

export interface WaveInputs {
  /** The TV keyboard is open for a prompt. */
  listening: boolean;
  /** A prompt from this TV is waiting for its answer. */
  asking: boolean;
  /** The server reports a prompt in progress (from the phone, say). */
  pending: boolean;
  /** An answer arrived in the last few seconds. */
  answered: boolean;
}

export function waveState({ listening, asking, pending, answered }: WaveInputs): WaveState {
  if (listening) return "listening";
  if (asking || pending) return "thinking";
  return answered ? "speaking" : "idle";
}

/** What the panel's status line says for each state. */
export const WAVE_STATUS: Record<WaveState, string> = {
  idle: "",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "",
};

export type ThemePref = "auto" | "day" | "night";
export const THEME_PREFS: readonly ThemePref[] = ["auto", "day", "night"];

/** Room light (lux, from the TV's sensor through SmartThings) above which auto picks Daylight, and below which Night. */
const LUX_DAY = 150;
const LUX_NIGHT = 60;

/**
 * Auto follows the room when the TV's light sensor reads clearly bright or dark (about 35 lux with lamps on at night),
 * and the clock otherwise: Daylight from 07:00 to 18:59.
 */
export function themeFor(pref: ThemePref, hour: number, lux: number | null = null): "day" | "night" {
  if (pref !== "auto") return pref;
  if (lux !== null && lux >= LUX_DAY) return "day";
  if (lux !== null && lux < LUX_NIGHT) return "night";
  return hour >= 7 && hour < 19 ? "day" : "night";
}

/** Theme prompts Nest answers itself, without the server: "light theme", "dark mode", "auto theme". */
export function themePrompt(prompt: string): ThemePref | null {
  const p = prompt.trim().toLowerCase();
  if (!/\b(?:theme|mode|look)\b/.test(p) && !/^(?:daylight|night ?mode)$/.test(p)) return null;
  if (/\b(?:auto|automatic)\b/.test(p)) return "auto";
  if (/\b(?:light|day|daylight|bright)\b/.test(p)) return "day";
  if (/\b(?:dark|night)\b/.test(p)) return "night";
  return null;
}
