// Ask Nest: the assistant panel's data (docs/launcher.md). Talks to @secretary/server's /ai/ask and
// /ai/state, which the phone companion uses too, so prompts from either show on the TV.
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
}

/** The chips under the wave: the first opens the keyboard (and its voice input), the rest are prompts. */
export const CHIPS = [
  { label: "🎤 Ask", prompt: "" },
  { label: "Something for tonight", prompt: "Something for tonight" },
  { label: "Cinema lights", prompt: "Cinema mode" },
  { label: "Briefing", prompt: "Briefing" },
] as const;

export const askNest = async (serverUrl: string, prompt: string, f: typeof fetch = fetch): Promise<AskReply> => {
  const res = await f(`${serverUrl}/ai/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, source: "tv" }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as AskReply;
};

export const fetchAssistant = async (serverUrl: string, f: typeof fetch = fetch): Promise<AssistantState> => {
  const res = await f(`${serverUrl}/ai/state`);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as AssistantState;
};

export interface Weather {
  tempC: number;
  label: string;
  icon: string;
  place?: string;
}

/** Null when the server has no place configured or the forecast is down: Nest then shows no weather. */
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

/** Daylight from 07:00 to 18:59 when the preference is auto. */
export function themeFor(pref: ThemePref, hour: number): "day" | "night" {
  if (pref !== "auto") return pref;
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
