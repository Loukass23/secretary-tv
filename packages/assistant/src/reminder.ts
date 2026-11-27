// Parses reminder prompts and turns spoken due phrases ("in 20 minutes", "tomorrow at 8", "at 18:00", "tonight")
// into both a display label (`due`) and an epoch timestamp (`dueAt`) relative to an injected `now` clock.

export interface ParsedReminder {
  text: string;
  due?: string;
  dueAt?: number;
}

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function atLocal(base: Date, dayOffset: number, hour: number, minute = 0): number {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, minute, 0, 0).getTime();
}

function resolveHour(rawHour: number, meridiem: string | undefined, eveningHint: boolean): number | null {
  const m = meridiem?.toLowerCase();
  if (m === "am") {
    if (rawHour < 1 || rawHour > 12) return null;
    return rawHour === 12 ? 0 : rawHour;
  }
  if (m === "pm") {
    if (rawHour < 1 || rawHour > 12) return null;
    return rawHour === 12 ? 12 : rawHour + 12;
  }
  if (rawHour < 0 || rawHour > 23) return null;
  if (eveningHint && rawHour >= 1 && rawHour <= 11) return rawHour + 12;
  return rawHour;
}

/** Parses a standalone due string ("in 20 minutes", "tomorrow at 8", "18:00", "tonight") against `now`. */
export function parseDueTime(raw: string, now: Date): number | undefined {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return undefined;

  if (s === "in half an hour" || s === "half an hour") return now.getTime() + 30 * 60_000;

  const rel = s.match(/^(?:in\s+)?(an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*(hours?|hrs?|minutes?|mins?)$/);
  if (rel) {
    const n = WORDS[rel[1]] ?? Number(rel[1]);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const mult = rel[2].startsWith("h") ? 60 * 60_000 : 60_000;
    return now.getTime() + n * mult;
  }

  // "tomorrow at 8", "tomorrow 8:30 pm", "tonight at 9"
  const dayClock =
    s.match(/^(tomorrow|tonight|this evening|today)\s+(?:(?:at|by)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/) ??
    s.match(/^(?:(?:at|by)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(tomorrow|tonight|this evening|today)$/);
  if (dayClock) {
    const dayFirst = /^(?:tomorrow|tonight|this|today)/.test(dayClock[1]);
    const word = dayFirst ? dayClock[1] : dayClock[4];
    const rawH = Number(dayFirst ? dayClock[2] : dayClock[1]);
    const min = Number((dayFirst ? dayClock[3] : dayClock[2]) ?? 0);
    const mer = dayFirst ? dayClock[4] : dayClock[3];
    if (min < 0 || min > 59) return undefined;
    const evening = word === "tonight" || word === "this evening";
    const h = resolveHour(rawH, mer, evening);
    if (h === null) return undefined;
    const offset = word === "tomorrow" ? 1 : 0;
    const target = atLocal(now, offset, h, min);
    return offset === 0 && target <= now.getTime() ? atLocal(now, 1, h, min) : target;
  }

  // Bare clock: "18:00", "8pm", "9:30 am", "7"
  const clock = s.match(/^(?:(?:at|by)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (clock) {
    const rawH = Number(clock[1]);
    const min = Number(clock[2] ?? 0);
    const mer = clock[3];
    if (min < 0 || min > 59) return undefined;
    const h = resolveHour(rawH, mer, false);
    if (h === null) return undefined;
    const first = atLocal(now, 0, h, min);
    if (first > now.getTime()) return first;
    // Ambiguous 1..11 without am/pm ("at 7" asked in the afternoon): try 19:00 today before 07:00 tomorrow.
    if (!mer && rawH >= 1 && rawH <= 11 && !clock[2]) {
      const pm = atLocal(now, 0, rawH + 12, min);
      if (pm > now.getTime()) return pm;
    }
    return atLocal(now, 1, h, min);
  }

  if (s === "tomorrow" || s === "tomorrow morning") return atLocal(now, 1, 9, 0);
  if (s === "tomorrow evening" || s === "tomorrow night") return atLocal(now, 1, 20, 0);
  if (s === "tonight" || s === "this evening") {
    const t = atLocal(now, 0, 20, 0);
    return t > now.getTime() ? t : now.getTime() + 60 * 60_000;
  }
  if (s === "today") {
    const t = atLocal(now, 0, 18, 0);
    return t > now.getTime() ? t : now.getTime() + 60 * 60_000;
  }
  return undefined;
}

const LEAD = /^(?:remind\s+me\s+to|add\s+(?:a\s+)?reminder(?:\s+to)?|remind\s+me|reminder:?)\s+(.+)$/i;

const TRAILING_PATTERNS: readonly { re: RegExp; keepIn: boolean }[] = [
  // "in 20 minutes", "in half an hour", "in 2 hours"
  {
    re: /\s+(in\s+(?:half\s+an\s+hour|(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*(?:hours?|hrs?|minutes?|mins?)))$/i,
    keepIn: true,
  },
  // "tomorrow at 8", "tonight at 9:30 pm", "on tomorrow at 8"
  {
    re: /\s+(?:on\s+)?((?:tomorrow|tonight|this\s+evening|today)\s+(?:(?:at|by)\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i,
    keepIn: true,
  },
  // "at 8 tomorrow", "by 9pm tonight"
  {
    re: /\s+(?:at|by)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:tomorrow|tonight|this\s+evening|today))$/i,
    keepIn: false,
  },
  // "at 18:00", "at 8pm", "by 9:30 am"
  {
    re: /\s+(?:at|by|on)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i,
    keepIn: false,
  },
  // "by tomorrow", "tonight", "tomorrow morning"
  {
    re: /\s+(?:(?:at|by|on)\s+)?(tomorrow\s+(?:morning|evening|night)|tomorrow|tonight|this\s+evening|today)$/i,
    keepIn: false,
  },
];

export function parseReminder(prompt: string, now = new Date()): ParsedReminder | null {
  const m = prompt.trim().match(LEAD);
  if (!m) return null;
  const full = m[1].trim();
  if (!full) return null;

  for (const { re } of TRAILING_PATTERNS) {
    const hit = full.match(re);
    if (hit && hit.index !== undefined) {
      const task = full.slice(0, hit.index).trim();
      const due = hit[1].replace(/\s+/g, " ").trim();
      const dueAt = parseDueTime(due, now);
      if (task && dueAt !== undefined) {
        return { text: task, due, dueAt };
      }
    }
  }

  return { text: full };
}
