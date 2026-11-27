// Multi-effect routines ("goodnight", "movie night", "good morning"): one prompt runs a light scene, checks open
// reminders, and pulls tomorrow's (or today's) forecast or film picks together. Each effect runs under allSettled so
// a missing SmartThings setup or offline forecast never blocks the rest of the answer. Goodnight and movie night set the
// viewer's Off and Cinema moods when the caller has moods (`fx.mood`, Secretary's moods.ts), so a mood changed in
// Settings › SmartThings changes the routine too; morning has no mood and brings the warm lights up.
import { type Answer, type Effects, moodOrLights, sayTomorrowWeather, sayWeather } from "./route.ts";

export type RoutineKind = "goodnight" | "movie_night" | "morning";

export function parseRoutine(prompt: string): RoutineKind | null {
  const p = prompt
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, "")
    .replace(/^(?:hey\s+nest,?\s+|nest,?\s+|please\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:good\s*night|bedtime|(?:i(?:'m| am)\s+)?going\s+to\s+(?:bed|sleep)|time\s+for\s+bed)$/.test(p)) {
    return "goodnight";
  }
  if (/^(?:movie\s+night|film\s+night|(?:it(?:'s| is)\s+)?movie\s+time)$/.test(p)) {
    return "movie_night";
  }
  if (/^(?:good\s+morning|morning\s+routine)$/.test(p)) {
    return "morning";
  }
  return null;
}

function reminderBrief(open: readonly string[]): string {
  if (open.length === 0) return "No open reminders.";
  if (open.length === 1) return `1 reminder open: “${open[0]}”.`;
  return `${open.length} reminders open, first “${open[0]}”.`;
}

export async function runRoutine(kind: RoutineKind, fx: Effects): Promise<Answer> {
  const open = fx.openReminders();

  if (kind === "goodnight") {
    const [lightsRes, weatherRes] = await Promise.allSettled([
      moodOrLights(fx, "off", { scene: "off" }),
      fx.weather ? fx.weather() : Promise.resolve(null),
    ]);
    const lightsOk = lightsRes.status === "fulfilled";
    const w = weatherRes.status === "fulfilled" ? weatherRes.value : null;
    const wx = w ? (sayTomorrowWeather(w) ?? sayWeather(w)) : "";
    const reply = [lightsOk ? "🌙 Lights off." : "🌙 Goodnight.", wx, reminderBrief(open)].filter(Boolean).join(" ");
    return {
      reply,
      action: lightsOk ? "domotics_updated" : w ? "weather" : "briefing",
    };
  }

  if (kind === "movie_night") {
    const [lightsRes, findRes] = await Promise.allSettled([
      moodOrLights(fx, "cinema", { scene: "cinema" }),
      fx.find ? fx.find({ kind: "movie" }) : Promise.resolve([]),
    ]);
    const lightsOk = lightsRes.status === "fulfilled";
    const results = findRes.status === "fulfilled" ? findRes.value : [];
    const remNote = open.length ? ` (${open.length} reminder${open.length === 1 ? "" : "s"} open)` : "";
    if (results.length) {
      const reply = lightsOk
        ? `🎬 Cinema lights set${remNote} — here are tonight's films.`
        : `🎬 Here are tonight's films${remNote}.`;
      return { reply, action: "watch", query: "top films", results };
    }
    return {
      reply: lightsOk ? `🎬 Cinema lights set${remNote}.` : `🎬 Movie night${remNote}: couldn't reach the catalog.`,
      action: lightsOk ? "domotics_updated" : "briefing",
    };
  }

  // "morning"
  const [lightsRes, weatherRes] = await Promise.allSettled([
    fx.lights({ scene: "warm" }),
    fx.weather ? fx.weather() : Promise.resolve(null),
  ]);
  const lightsOk = lightsRes.status === "fulfilled";
  const w = weatherRes.status === "fulfilled" ? weatherRes.value : null;
  const wx = w ? sayWeather(w) : "";
  const reply = [lightsOk ? "☀️ Warm lights on." : "☀️ Good morning.", wx, reminderBrief(open)].filter(Boolean).join(" ");
  return {
    reply,
    action: w ? "weather" : lightsOk ? "domotics_updated" : "briefing",
  };
}
