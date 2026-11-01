// Ask Nest's answers: a prompt goes to reminders, something to watch, the weather, the lights, then Gemini, then a canned
// briefing. The effects come from the caller, so the server (its state store, SmartThings through it) and Nest on the
// TV (local reminders, SmartThings straight from the TV) answer the same way.
import { firstPart, GEMINI_FALLBACK_MODELS } from "./gemini.ts";
import { parseWatchIntent, type WatchIntent } from "./intent.ts";
import type { SearchResult } from "./types.ts";
import type { Weather } from "./weather.ts";

export type AskAction = "reminder_added" | "domotics_updated" | "briefing" | "watch" | "weather";

export type LightsCommand = { scene: "cinema" | "warm" | "off" } | { level: number };

export interface Effects {
  addReminder(text: string, due?: string): unknown;
  /** Open reminders' text, for the briefing. */
  openReminders(): string[];
  lights(cmd: LightsCommand): Promise<unknown>;
  /** Lights on now, for the canned briefing; absent leaves them out. */
  lightsOn?(): number;
  /** Finds titles for a watch prompt (search or browse); without it such prompts fall through to the briefing. */
  find?(intent: WatchIntent): Promise<SearchResult[]>;
  /** The forecast here; without it weather prompts go to Gemini like any other. */
  weather?(): Promise<Weather | null>;
  geminiKey?: string;
  fetch?: typeof fetch;
}

export interface Answer {
  reply: string;
  action: AskAction;
  /** For "watch": what was searched or browsed, and the titles Nest shows next to the assistant. */
  query?: string;
  results?: SearchResult[];
}

const KIND_LABEL = { movie: "films", series: "series", anime: "anime" } as const;

/** What a watch prompt searched or browsed, in words for the TV ("comedy films", "“dune”"). */
export function describeIntent(intent: WatchIntent): string {
  if (intent.term) return `“${intent.term}”`;
  const kind = intent.kind ? KIND_LABEL[intent.kind] : "films and series";
  return intent.genre ? `${intent.genre.toLowerCase()} ${kind}` : `top ${kind}`;
}

const WEATHER_PROMPT = /\b(?:weather|forecast|temperature|rain(?:ing|y)?|umbrella|snow(?:ing)?|sunny|cold|warm) (?:outside|today|tonight|tomorrow)\b|\b(?:weather|forecast|umbrella)\b/i;

/** "It's 18° and partly cloudy in Berlin, 21° at the warmest." */
export function sayWeather(w: Weather): string {
  const today = w.days?.[0];
  const where = w.place ? ` in ${w.place}` : "";
  const high = today ? `, ${today.maxC}° at the warmest and ${today.minC}° at night` : "";
  return `It's ${w.tempC}° and ${w.label.toLowerCase()}${where}${high}.`;
}

export async function route(prompt: string, fx: Effects): Promise<Answer> {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // 1. Check for reminder intent: "remind me to <task> [at <time>]" or "add reminder <task>"
  const remMatch = clean.match(/^(?:remind\s+me\s+to|add\s+(?:a\s+)?reminder\s+to|remind\s+me|reminder:?)\s+(.+)$/i);
  if (remMatch) {
    let taskText = remMatch[1].trim();
    let due: string | undefined;
    const timeMatch = taskText.match(/\s+(?:at|by|on)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow|tonight|today)$/i);
    if (timeMatch) {
      due = timeMatch[1];
      taskText = taskText.slice(0, timeMatch.index).trim();
    }
    await fx.addReminder(taskText, due);
    return { reply: `Added to your Secretary Nest reminders: “${taskText}”${due ? ` (${due})` : ""}.`, action: "reminder_added" };
  }

  // 2. Something to watch: "show me a comedy", "play dune", "something for tonight".
  const watch = fx.find ? parseWatchIntent(clean) : null;
  if (watch && fx.find) {
    const query = describeIntent(watch);
    let results: SearchResult[] = [];
    try {
      results = await fx.find(watch);
    } catch {
      // The catalogs are down; say so below.
    }
    const reply = results.length
      ? watch.term
        ? `Here is what I found for ${query}.`
        : `Here are ${query} worth a look.`
      : `I couldn't find anything for ${query}.`;
    return { reply, action: "watch", query, results };
  }

  // 3. The weather, from the forecast the caller already has: no Gemini call.
  if (fx.weather && WEATHER_PROMPT.test(lower)) {
    const w = await fx.weather().catch(() => null);
    if (w) return { reply: sayWeather(w), action: "weather" };
  }

  // 4. Check for lighting / domotics intent: "cinema mode", "dim lights to 20%", "turn off lights", "turn on lights"
  if (/(?:light|lamp|cinema|dim|bright)/i.test(lower)) {
    const pctMatch = lower.match(/(\d{1,3})\s*%/);
    let reply: string;
    if (lower.includes("cinema") || lower.includes("movie mode")) {
      await fx.lights({ scene: "cinema" });
      reply = "🦅 Cinema stomp executed: Dimmable lights crushed to 15%, glare eliminated.";
    } else if (lower.includes("off")) {
      await fx.lights({ scene: "off" });
      reply = "🦅 All territory lights extinguished.";
    } else if (pctMatch) {
      const level = Math.max(0, Math.min(100, Number(pctMatch[1])));
      await fx.lights({ level });
      reply = `Adjusted lights to ${level}%.`;
    } else {
      await fx.lights({ scene: "warm" });
      reply = "Set SmartThings lights to Warm 70%.";
    }
    return { reply, action: "domotics_updated" };
  }

  // 5. Optional Gemini REST API call for general assistant queries / briefings when a key is present.
  const open = fx.openReminders();
  if (fx.geminiKey) {
    const w = fx.weather ? await fx.weather().catch(() => null) : null;
    const part = await firstPart(
      GEMINI_FALLBACK_MODELS,
      fx.geminiKey,
      {
        contents: [
          {
            parts: [
              {
                text: `You are the Secretary Bird (Sagittarius serpentarius), an aristocratic, razor-sharp, slightly bad-tempered avian butler presiding over the user's Secretary TV. Active reminders: ${open.join("; ") || "none"}.${w ? ` Weather: ${sayWeather(w)}` : ""} Reply in 1 witty, imperious sentence (under 140 chars) for a TV screen: ${clean}`,
              },
            ],
          },
        ],
      },
      fx.fetch ?? fetch,
    );
    const text = part?.text?.trim();
    if (text) return { reply: text, action: "briefing" };
  }

  const pendingCount = open.length;
  const lightsOn = fx.lightsOn?.();
  const lamps = lightsOn === undefined ? "" : `, ${lightsOn} lamp${lightsOn === 1 ? "" : "s"} lit`;
  const reply = `🪶 Secretary Briefing: ${pendingCount} pending task${pendingCount === 1 ? "" : "s"} on my quill${lamps}. Dictate “Remind me to ... at 20:00” or “Cinema mode” before I lose my temper.`;
  return { reply, action: "briefing" };
}
