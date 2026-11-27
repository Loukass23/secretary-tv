// Ask Nest's answers: a prompt goes to reminders, something to watch, the weather, the lights, then Gemini, then a canned
// briefing. The effects come from the caller, so the server (its state store, SmartThings through it) and Nest on the
// TV (local reminders, SmartThings straight from the TV) answer the same way.
import { firstPart, GEMINI_FALLBACK_MODELS } from "./gemini.ts";
import { parseWatchIntent, type WatchIntent } from "./intent.ts";
import { parseReminder } from "./reminder.ts";
import type { SearchResult } from "./types.ts";
import { glyphLabel, isWetGlyph, type Weather } from "./weather.ts";

export type AskAction = "reminder_added" | "domotics_updated" | "briefing" | "watch" | "weather";

export type LightsCommand = { scene: "cinema" | "warm" | "off" | "music" } | { level: number };

export interface Effects {
  addReminder(text: string, due?: string, dueAt?: number): unknown;
  /** Open reminders' text, for the briefing. */
  openReminders(): string[];
  lights(cmd: LightsCommand): Promise<unknown>;
  /** Lights on now, for the canned briefing; absent leaves them out. */
  lightsOn?(): number;
  /** Finds titles for a watch prompt (search or browse); without it such prompts fall through to the briefing. */
  find?(intent: WatchIntent): Promise<SearchResult[]>;
  /** The forecast here; without it weather prompts go to Gemini like any other. */
  weather?(): Promise<Weather | null>;
  /** Clock for relative due times ("in 20 minutes", "tomorrow at 8"); defaults to `new Date()`. */
  now?(): Date;
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

const WEATHER_PROMPT = /\b(?:weather|forecast|temperature|rain(?:ing|y)?|umbrella|snow(?:ing)?|sunny|cold|warm) (?:outside|today|tonight|tomorrow|later)\b|\b(?:weather|forecast|umbrella)\b/i;

/** "It's 18° and partly cloudy in Berlin, 21° at the warmest and 9° at night." */
export function sayWeather(w: Weather): string {
  const today = w.days?.[0];
  const where = w.place ? ` in ${w.place}` : "";
  const high = today ? `, ${today.maxC}° at the warmest and ${today.minC}° at night` : "";
  return `It's ${w.tempC}° and ${w.label.toLowerCase()}${where}${high}.`;
}

/** Tomorrow's forecast line from `w.days[1]`, or null when the daily forecast is absent. */
export function sayTomorrowWeather(w: Weather): string | null {
  const tom = w.days?.[1];
  if (!tom) return null;
  const where = w.place ? ` in ${w.place}` : "";
  return `Tomorrow${where}: ${glyphLabel(tom.glyph)}, ${tom.maxC}° at the warmest and ${tom.minC}° at night.`;
}

/** Answers a weather prompt by the horizon asked about (umbrella/rain, tomorrow, tonight, or right now). */
export function sayWeatherForPrompt(w: Weather, prompt: string): string {
  const p = prompt.toLowerCase();
  const where = w.place ? ` in ${w.place}` : "";

  if (/\b(?:umbrella|rain(?:ing|y)?|snow(?:ing)?|storm|wet)\b/.test(p)) {
    if (/\btomorrow\b/.test(p) && w.days?.[1]) {
      const tom = w.days[1];
      return isWetGlyph(tom.glyph)
        ? `Take an umbrella tomorrow${where}: ${glyphLabel(tom.glyph)}, ${tom.maxC}° at the warmest and ${tom.minC}° at night.`
        : `No umbrella needed tomorrow${where}: ${glyphLabel(tom.glyph)}, up to ${tom.maxC}°.`;
    }
    if (isWetGlyph(w.glyph)) {
      return `Yes, take an umbrella: it's ${w.tempC}° with ${w.label.toLowerCase()}${where} right now.`;
    }
    const wet = w.hours?.find((h) => isWetGlyph(h.glyph));
    if (wet) {
      return `Take an umbrella: ${glyphLabel(wet.glyph)} expected around ${wet.hour}:00${where} (${wet.tempC}°).`;
    }
    if (w.hours?.length) {
      return `No umbrella needed: ${w.label.toLowerCase()} now (${w.tempC}°)${where} and dry for the next few hours.`;
    }
    return sayWeather(w);
  }

  if (/\btomorrow\b/.test(p)) {
    return sayTomorrowWeather(w) ?? sayWeather(w);
  }

  if (/\b(?:tonight|later|this evening)\b/.test(p) && w.hours?.length) {
    const low = Math.min(...w.hours.map((h) => h.tempC));
    const wet = w.hours.find((h) => isWetGlyph(h.glyph));
    const sky = wet ? glyphLabel(wet.glyph) : glyphLabel(w.hours[w.hours.length - 1].glyph);
    return `Tonight${where}: ${sky}, down to ${low}° over the next few hours.`;
  }

  return sayWeather(w);
}

export async function route(prompt: string, fx: Effects): Promise<Answer> {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // 1. Check for reminder intent: "remind me to <task> [in 20 minutes | tomorrow at 8 | at 18:00]" or "add reminder <task>"
  const rem = parseReminder(clean, fx.now ? fx.now() : new Date());
  if (rem) {
    await fx.addReminder(rem.text, rem.due, rem.dueAt);
    return {
      reply: `Added to your Secretary Nest reminders: “${rem.text}”${rem.due ? ` (${rem.due})` : ""}.`,
      action: "reminder_added",
    };
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
    if (w) return { reply: sayWeatherForPrompt(w, lower), action: "weather" };
  }

  // Music mode: the sound system and a warm room. Cinema never starts the sound system.
  if (/\bmusic mode\b/.test(lower)) {
    await fx.lights({ scene: "music" });
    return { reply: "🎵 Music mode: the sound system is on and the room is warm.", action: "domotics_updated" };
  }

  // 4. Check for lighting / domotics intent: "cinema mode", "dim lights to 20%", "turn off lights", "turn on lights"
  if (/\b(?:lights?|lamps?|cinema|movie mode|dim|bright(?:er|en)?)\b/i.test(lower)) {
    const pctMatch = lower.match(/(\d{1,3})\s*%/);
    let reply: string;
    if (lower.includes("cinema") || lower.includes("movie mode")) {
      await fx.lights({ scene: "cinema" });
      reply = "🦅 Cinema mode: the lights go down and the glare is eliminated.";
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
