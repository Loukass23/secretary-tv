import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type CatalogKind = "movie" | "series" | "anime";

export interface SlimTitle {
  id: string;
  name: string;
  year: string;
  rating: string;
  poster?: string;
  background?: string;
}

export interface StoredResumeEntry {
  title: SlimTitle;
  episode?: {
    id: string;
    season: number;
    episode: number;
    name: string;
  };
  posSec: number;
  durSec: number;
  updated: number;
}

export interface UnifiedResumeEntry extends StoredResumeEntry {
  type: CatalogKind;
}

export interface StoredReminder {
  id: string;
  text: string;
  due?: string;
  completed: boolean;
  source: "companion" | "gemini" | "local";
  createdAt: number;
}

export interface DomoticDevice {
  id: string;
  name: string;
  room: string;
  on: boolean;
  level: number;
  provider: "smartthings" | "matter";
}

/** One prompt and its answer, from the TV or the phone companion (GET /ai/state). */
export interface AssistantTurn {
  id: number;
  prompt: string;
  reply: string;
  action: string;
  source: "tv" | "companion";
  at: number;
  /** What was searched or browsed when the prompt asked for something to watch. */
  query?: string;
  results?: { type: CatalogKind; title: SlimTitle }[];
}

/** What the assistant is doing, polled by Nest so the wave and the panel follow prompts from the phone too. */
export interface AssistantState {
  rev: number;
  pending: { prompt: string; source: "tv" | "companion"; at: number } | null;
  turns: AssistantTurn[];
}

interface PersistedState {
  resume: Record<CatalogKind, StoredResumeEntry[]>;
  reminders?: StoredReminder[];
  domotics?: DomoticDevice[];
  aiSummary?: string;
}

const KINDS: readonly CatalogKind[] = ["movie", "series", "anime"];
const MAX_PER_KIND = 20;
const MAX_REMINDERS = 30;
const HANDOFF_TTL_MS = 30_000;
const MAX_TURNS = 8;
/** A prompt still "thinking" after this long has failed somewhere; Nest stops showing it. */
const PENDING_TTL_MS = 30_000;

const DEFAULT_REMINDERS: StoredReminder[] = [
  {
    id: "rem-1",
    text: "Check Secretary Nest modules & settings",
    due: "Today",
    completed: false,
    source: "companion",
    createdAt: 1,
  },
  {
    id: "rem-2",
    text: "Movie night at 21:00 — dim living room lights",
    due: "21:00",
    completed: false,
    source: "gemini",
    createdAt: 2,
  },
];

const DEFAULT_DOMOTICS: DomoticDevice[] = [
  { id: "st-living-main", name: "Living Room Bias", room: "Living Room", on: true, level: 65, provider: "smartthings" },
  { id: "st-living-lamp", name: "Floor Lamp", room: "Living Room", on: true, level: 40, provider: "smartthings" },
  { id: "st-hallway", name: "Hallway Spots", room: "Hallway", on: false, level: 80, provider: "smartthings" },
];

export function isCatalogKind(v: string): v is CatalogKind {
  return (KINDS as readonly string[]).includes(v);
}

export interface HandoffEntry {
  title: SlimTitle;
  autoPlay?: boolean;
}

export function createStateStore(stateFile?: string, now: () => number = Date.now) {
  const resume: Record<CatalogKind, StoredResumeEntry[]> = {
    movie: [],
    series: [],
    anime: [],
  };
  let reminders: StoredReminder[] = structuredClone(DEFAULT_REMINDERS);
  let domotics: DomoticDevice[] = structuredClone(DEFAULT_DOMOTICS);
  let aiSummary = "Gemini Assistant ready — ask from your phone Companion app to manage reminders or dim lights.";
  const handoffs = new Map<CatalogKind, { title: SlimTitle; autoPlay?: boolean; at: number }>();
  const assistant: AssistantState = { rev: 0, pending: null, turns: [] };

  if (stateFile && existsSync(stateFile)) {
    try {
      const raw = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<PersistedState>;
      for (const k of KINDS) {
        if (Array.isArray(raw.resume?.[k])) resume[k] = raw.resume![k];
      }
      if (Array.isArray(raw.reminders)) reminders = raw.reminders;
      if (Array.isArray(raw.domotics) && raw.domotics.length) domotics = raw.domotics;
      if (typeof raw.aiSummary === "string" && raw.aiSummary) aiSummary = raw.aiSummary;
    } catch {
      // Ignore corrupt state file and start fresh.
    }
  }

  function persist() {
    if (!stateFile) return;
    try {
      writeFileSync(stateFile, JSON.stringify({ resume, reminders, domotics, aiSummary }), "utf8");
    } catch {
      // Ignore write errors in read-only environments.
    }
  }

  return {
    getResume(type: CatalogKind): StoredResumeEntry[] {
      return resume[type];
    },

    putResume(type: CatalogKind, entries: readonly StoredResumeEntry[]): StoredResumeEntry[] {
      const sorted = entries
        .filter((e) => e && e.title && typeof e.title.id === "string" && typeof e.title.name === "string")
        .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
      const seen = new Set<string>();
      const valid: StoredResumeEntry[] = [];
      for (const e of sorted) {
        const key = e.title.name.trim().toLowerCase() || e.title.id;
        if (seen.has(key)) continue;
        seen.add(key);
        valid.push(e);
        if (valid.length >= MAX_PER_KIND) break;
      }
      resume[type] = valid;
      persist();
      return valid;
    },

    getAllResume(): UnifiedResumeEntry[] {
      const all: UnifiedResumeEntry[] = [];
      for (const k of KINDS) {
        for (const e of resume[k]) all.push({ ...e, type: k });
      }
      all.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
      const seen = new Set<string>();
      const deduped: UnifiedResumeEntry[] = [];
      for (const e of all) {
        const key = `${e.type}:${e.title.name.trim().toLowerCase() || e.title.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(e);
        if (deduped.length >= MAX_PER_KIND) break;
      }
      return deduped;
    },

    setHandoff(type: CatalogKind, title: SlimTitle, autoPlay?: boolean): void {
      if (!title?.id || !title?.name) return;
      handoffs.set(type, { title, autoPlay: Boolean(autoPlay), at: now() });
    },

    consumeHandoff(type: CatalogKind): SlimTitle | null {
      return this.consumeHandoffEntry(type)?.title ?? null;
    },

    consumeHandoffEntry(type: CatalogKind): HandoffEntry | null {
      const hit = handoffs.get(type);
      handoffs.delete(type);
      if (!hit || now() - hit.at > HANDOFF_TTL_MS) return null;
      return { title: hit.title, autoPlay: Boolean(hit.autoPlay) };
    },

    getReminders(): StoredReminder[] {
      return reminders;
    },

    getAiSummary(): string {
      return aiSummary;
    },

    /** Kept in memory only: the conversation starts over when the server restarts. */
    getAssistant(): AssistantState {
      if (assistant.pending && now() - assistant.pending.at > PENDING_TTL_MS) {
        assistant.pending = null;
        assistant.rev++;
      }
      return assistant;
    },

    beginAsk(prompt: string, source: "tv" | "companion"): void {
      assistant.pending = { prompt, source, at: now() };
      assistant.rev++;
    },

    endAsk(turn: Omit<AssistantTurn, "id" | "at">): AssistantTurn {
      const done: AssistantTurn = { ...turn, id: assistant.rev + 1, at: now() };
      assistant.turns = [...assistant.turns, done].slice(-MAX_TURNS);
      assistant.pending = null;
      assistant.rev++;
      return done;
    },

    setAiSummary(text: string): void {
      aiSummary = text;
      persist();
    },

    addReminder(input: { text: string; due?: string; source?: "companion" | "gemini" | "local" }): StoredReminder[] {
      const text = input.text.trim();
      if (!text) return reminders;
      const item: StoredReminder = {
        id: `rem-${now()}-${Math.random().toString(36).slice(2, 6)}`,
        text,
        due: input.due?.trim() || undefined,
        completed: false,
        source: input.source ?? "companion",
        createdAt: now(),
      };
      reminders = [item, ...reminders].slice(0, MAX_REMINDERS);
      persist();
      return reminders;
    },

    toggleReminder(id: string): StoredReminder[] {
      reminders = reminders.map((r) => (r.id === id ? { ...r, completed: !r.completed } : r));
      persist();
      return reminders;
    },

    deleteReminder(id: string): StoredReminder[] {
      reminders = reminders.filter((r) => r.id !== id);
      persist();
      return reminders;
    },

    getDomotics(): DomoticDevice[] {
      return domotics;
    },

    setDomotics(list: DomoticDevice[]): DomoticDevice[] {
      domotics = list;
      persist();
      return domotics;
    },

    updateDomoticDevice(id: string, patch: { on?: boolean; level?: number }): DomoticDevice | null {
      let updated: DomoticDevice | null = null;
      domotics = domotics.map((d) => {
        if (d.id !== id) return d;
        const nextLevel =
          typeof patch.level === "number" ? Math.max(0, Math.min(100, Math.round(patch.level))) : d.level;
        const nextOn = typeof patch.on === "boolean" ? patch.on : d.on;
        updated = { ...d, on: nextOn, level: nextLevel };
        return updated;
      });
      if (updated) persist();
      return updated;
    },

    applyDomoticScene(scene: "cinema" | "warm" | "off", targetIds?: readonly string[]): DomoticDevice[] {
      const idSet = targetIds && targetIds.length > 0 ? new Set(targetIds) : null;
      domotics = domotics.map((d) => {
        if (scene === "off") {
          if (idSet && !idSet.has(d.id)) return d;
          return { ...d, on: false };
        }
        if (scene === "cinema") {
          const isCinemaTarget = idSet
            ? idSet.has(d.id)
            : d.room === "Living Room" || d.room === "Dimmable";
          return isCinemaTarget ? { ...d, on: true, level: 15 } : { ...d, on: false };
        }
        if (idSet && !idSet.has(d.id)) return d;
        return { ...d, on: true, level: 70 };
      });
      persist();
      return domotics;
    },
  };
}
