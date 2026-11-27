// Ask Nest on the TV (docs/launcher.md, "Ask Nest on the TV"): answers from @secretary/assistant's route(), with
// reminders kept on the TV and the lights through SmartThings from the TV.
import {
  discoverCatalog,
  type FocusedTitleContext,
  type LibraryEffects,
  type LightsCommand,
  type MoodKey,
  MAX_HISTORY_TURNS,
  route,
  searchCatalogs,
  type SearchResult,
  type Weather,
} from "@secretary/assistant";
import type { AssistantState, AssistantTurn } from "./assistant.ts";
import type { Reminder } from "./apps.ts";

const REMINDERS_KEY = "nest.reminders";
const MAX_TURNS = 8;
const MAX_REMINDERS = 30;

export interface KeyValue {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Reminders kept on this TV (source "local"), with due timestamps so they toast when due. */
export function localReminders(store: KeyValue) {
  const load = (): Reminder[] => {
    try {
      const v = JSON.parse(store.getItem(REMINDERS_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((r): r is Reminder => typeof r?.id === "string" && typeof r.text === "string") : [];
    } catch {
      return [];
    }
  };
  const save = (items: Reminder[]) => {
    try {
      store.setItem(REMINDERS_KEY, JSON.stringify(items.slice(0, MAX_REMINDERS)));
    } catch {
      // Until Nest restarts.
    }
    return items;
  };
  return {
    list: load,
    add(text: string, due?: string, now = Date.now(), dueAt?: number): Reminder[] {
      const r: Reminder = {
        id: `local-${now.toString(36)}`,
        text,
        completed: false,
        source: "local",
        ...(due ? { due } : {}),
        ...(typeof dueAt === "number" && Number.isFinite(dueAt) ? { dueAt } : {}),
      };
      return save([r, ...load()]);
    },
    toggle(id: string): Reminder[] {
      return save(load().map((r) => (r.id === id ? { ...r, completed: !r.completed } : r)));
    },
    /**
     * Marks open unfired reminders whose `dueAt` has arrived (`<= now`) as fired so each toasts once across reloads,
     * returning the ones that just fired (earliest due first).
     */
    fireDue(now = Date.now()): Reminder[] {
      const items = load();
      const fired = items.filter((r) => !r.completed && !r.firedAt && typeof r.dueAt === "number" && r.dueAt <= now);
      if (!fired.length) return [];
      const ids = new Set(fired.map((r) => r.id));
      save(items.map((r) => (ids.has(r.id) ? { ...r, firedAt: now } : r)));
      return [...fired].sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
    },
    /** Earliest upcoming `dueAt` among open unfired reminders, or null when none is waiting. */
    nextDueAt(): number | null {
      let soonest: number | null = null;
      for (const r of load()) {
        if (!r.completed && !r.firedAt && typeof r.dueAt === "number") {
          if (soonest === null || r.dueAt < soonest) soonest = r.dueAt;
        }
      }
      return soonest;
    },
    owns: (id: string) => id.startsWith("local-"),
  };
}

export type LocalReminders = ReturnType<typeof localReminders>;

export interface LocalBrainOptions extends LibraryEffects {
  reminders: LocalReminders;
  /** Runs a lights command on SmartThings; throws when this TV has no SmartThings. */
  lights(cmd: LightsCommand): Promise<unknown>;
  /** Sets one of the viewer's moods (moods.ts, app.tsx applyMood): "cinema mode", "movie night", "goodnight". */
  mood?(key: MoodKey): Promise<unknown>;
  focusedTitle?(): Promise<FocusedTitleContext | null>;
  weather?(): Promise<Weather | null>;
  now?(): Date;
  geminiKey?: string;
  fetch?: typeof fetch;
}

/** Titles for a watch prompt, from the catalogs straight from the TV. */
const find = (f: typeof fetch) => async (intent: { term?: string; kind?: SearchResult["type"]; genre?: string }) =>
  intent.term
    ? (await searchCatalogs(intent.term, f)).filter((x) => !intent.kind || x.type === intent.kind)
    : discoverCatalog(intent.kind, intent.genre, f);

/** Answers on the TV and keeps the conversation's recent turns. */
export function localBrain(opts: LocalBrainOptions) {
  const f = opts.fetch ?? fetch;
  const turns: AssistantTurn[] = [];
  let rev = 0;
  // Positive and increasing, so `lastAnswer.id > since` shows each new turn after the assistant is entered.
  let nextId = 1;
  const clock = () => opts.now?.() ?? new Date();

  const note = (prompt: string, reply: string, action: string, extra: Partial<AssistantTurn> = {}): AssistantTurn => {
    const turn: AssistantTurn = { id: nextId++, prompt, reply, action, source: "tv", at: clock().getTime(), ...extra };
    turns.push(turn);
    if (turns.length > MAX_TURNS) turns.shift();
    rev++;
    return turn;
  };

  return {
    /** A turn Nest answered itself (a light by name, say), so it shows in the conversation too. */
    note,
    async ask(prompt: string): Promise<AssistantTurn> {
      try {
        const a = await route(prompt, {
          addReminder: (text, due, dueAt) => opts.reminders.add(text, due, clock().getTime(), dueAt),
          openReminders: () => opts.reminders.list().filter((r) => !r.completed).map((r) => r.text),
          lights: opts.lights,
          mood: opts.mood,
          find: find(f),
          focusedTitle: opts.focusedTitle,
          continueWatching: opts.continueWatching,
          myList: opts.myList,
          setMyList: opts.setMyList,
          weather: opts.weather,
          history: turns.slice(-MAX_HISTORY_TURNS),
          now: opts.now,
          geminiKey: opts.geminiKey,
          fetch: f,
        });
        return note(prompt, a.reply, a.action, a.query ? { query: a.query, results: a.results } : {});
      } catch (e) {
        return note(prompt, e instanceof NestError ? e.message : "Something went wrong; try again.", "error");
      }
    },
    state(): AssistantState {
      return { rev, turns: [...turns] };
    },
  };
}

export type LocalBrain = ReturnType<typeof localBrain>;

/** A failure whose message is fit to show on the TV as the answer. */
export class NestError extends Error {}
