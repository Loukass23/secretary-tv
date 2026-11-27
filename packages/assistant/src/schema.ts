// Structured JSON intent routing for Gemini (`responseMimeType: "application/json"` + `responseSchema`), used only
// when no local rule matched. Validated strictly in plain TypeScript; anything unexpected returns null so route()
// falls back to the canned briefing.
import type { LightsCommand } from "./route.ts";
import type { CatalogKind } from "./types.ts";

export type StructuredIntentKind = "watch" | "reminder" | "lights" | "weather" | "chat";

export type ValidatedIntent =
  | { intent: "watch"; term?: string; kind?: CatalogKind; genre?: string; reply?: string }
  | { intent: "reminder"; reminderText: string; due?: string; reply?: string }
  | { intent: "lights"; command: LightsCommand; reply?: string }
  | { intent: "weather"; reply?: string }
  | { intent: "chat"; reply?: string };

const VALID_KINDS = new Set<CatalogKind>(["movie", "series", "anime"]);
const VALID_SCENES = new Set<"cinema" | "warm" | "off" | "music">(["cinema", "warm", "off", "music"]);

const CANONICAL_GENRES: Readonly<Record<string, string>> = {
  comedy: "Comedy",
  action: "Action",
  horror: "Horror",
  thriller: "Thriller",
  drama: "Drama",
  romance: "Romance",
  "sci-fi": "Sci-Fi",
  scifi: "Sci-Fi",
  "science fiction": "Sci-Fi",
  fantasy: "Fantasy",
  animation: "Animation",
  documentary: "Documentary",
  crime: "Crime",
  mystery: "Mystery",
  family: "Family",
  adventure: "Adventure",
  war: "War",
  western: "Western",
};

/** Gemini v1beta OpenAPI-subset responseSchema (no `additionalProperties`, which v1beta rejects with 400). */
export const INTENT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: {
      type: "STRING",
      enum: ["watch", "reminder", "lights", "weather", "chat"],
    },
    term: { type: "STRING" },
    kind: { type: "STRING", enum: ["movie", "series", "anime"] },
    genre: { type: "STRING" },
    reminderText: { type: "STRING" },
    due: { type: "STRING" },
    scene: { type: "STRING", enum: ["cinema", "warm", "off", "music"] },
    level: { type: "INTEGER" },
    reply: { type: "STRING" },
  },
  required: ["intent"],
} as const;

const cleanStr = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

/** Parses and validates Gemini's JSON text against `ValidatedIntent`; returns null on any unexpected shape. */
export function validateStructuredIntent(rawText: string | undefined): ValidatedIntent | null {
  if (!rawText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const intent = obj.intent;
  const reply = cleanStr(obj.reply);

  if (intent === "chat") {
    return { intent: "chat", ...(reply ? { reply } : {}) };
  }

  if (intent === "weather") {
    return { intent: "weather", ...(reply ? { reply } : {}) };
  }

  if (intent === "reminder") {
    const reminderText = cleanStr(obj.reminderText);
    if (!reminderText) return null;
    const due = cleanStr(obj.due);
    return { intent: "reminder", reminderText, ...(due ? { due } : {}), ...(reply ? { reply } : {}) };
  }

  if (intent === "lights") {
    const scene = cleanStr(obj.scene);
    if (scene && VALID_SCENES.has(scene as "cinema" | "warm" | "off" | "music")) {
      return {
        intent: "lights",
        command: { scene: scene as "cinema" | "warm" | "off" | "music" },
        ...(reply ? { reply } : {}),
      };
    }
    if (typeof obj.level === "number" && Number.isFinite(obj.level)) {
      const level = Math.max(0, Math.min(100, Math.round(obj.level)));
      return { intent: "lights", command: { level }, ...(reply ? { reply } : {}) };
    }
    return null;
  }

  if (intent === "watch") {
    const rawKind = cleanStr(obj.kind);
    if (rawKind !== undefined && !VALID_KINDS.has(rawKind as CatalogKind)) return null;
    const kind = rawKind as CatalogKind | undefined;
    const rawGenre = cleanStr(obj.genre);
    const genre = rawGenre ? (CANONICAL_GENRES[rawGenre.toLowerCase()] ?? rawGenre) : undefined;
    const term = cleanStr(obj.term)?.toLowerCase();
    return {
      intent: "watch",
      ...(term ? { term } : {}),
      ...(kind ? { kind } : {}),
      ...(genre ? { genre } : {}),
      ...(reply ? { reply } : {}),
    };
  }

  return null;
}
