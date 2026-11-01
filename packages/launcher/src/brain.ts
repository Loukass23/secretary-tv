// Ask Nest without the server (docs/launcher.md, "Ask Nest on the TV"): the same answers as the server's /ai/ask,
// from @secretary/assistant's route(), with reminders kept on the TV and the lights through SmartThings from the TV.
// With a server, Nest still asks it first (the phone companion shares its turns and reminders); this answers when
// there is none or it is down.
import {
  discoverCatalog,
  type LightsCommand,
  route,
  searchCatalogs,
  type SearchResult,
  type Weather,
} from "@secretary/assistant";
import type { AssistantState, AssistantTurn } from "./assistant.ts";
import type { Reminder } from "./apps.ts";

const REMINDERS_KEY = "nest.reminders";
/** As many turns as the server keeps. */
const MAX_TURNS = 8;
const MAX_REMINDERS = 30;

export interface KeyValue {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Reminders kept on this TV (source "local"), next to the server's when there is one. */
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
    add(text: string, due?: string, now = Date.now()): Reminder[] {
      const r: Reminder = { id: `local-${now.toString(36)}`, text, completed: false, source: "local", ...(due ? { due } : {}) };
      return save([r, ...load()]);
    },
    toggle(id: string): Reminder[] {
      return save(load().map((r) => (r.id === id ? { ...r, completed: !r.completed } : r)));
    },
    owns: (id: string) => id.startsWith("local-"),
  };
}

export type LocalReminders = ReturnType<typeof localReminders>;

export interface LocalBrainOptions {
  reminders: LocalReminders;
  /** Runs a lights command on SmartThings; throws when this TV has no SmartThings. */
  lights(cmd: LightsCommand): Promise<unknown>;
  weather?(): Promise<Weather | null>;
  geminiKey?: string;
  fetch?: typeof fetch;
}

/** Titles for a watch prompt, from the catalogs straight from the TV. */
const find = (f: typeof fetch) => async (intent: { term?: string; kind?: SearchResult["type"]; genre?: string }) =>
  intent.term
    ? (await searchCatalogs(intent.term, f)).filter((x) => !intent.kind || x.type === intent.kind)
    : discoverCatalog(intent.kind, intent.genre, f);

/** Answers on the TV and keeps its own turns, shaped like the server's /ai/state. */
export function localBrain(opts: LocalBrainOptions) {
  const f = opts.fetch ?? fetch;
  const turns: AssistantTurn[] = [];
  let rev = 0;
  // Below the server's ids, so the two never collide when Nest shows both.
  let nextId = -1;

  const note = (prompt: string, reply: string, action: string, extra: Partial<AssistantTurn> = {}): AssistantTurn => {
    const turn: AssistantTurn = { id: nextId--, prompt, reply, action, source: "tv", at: Date.now(), ...extra };
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
          addReminder: (text, due) => opts.reminders.add(text, due),
          openReminders: () => opts.reminders.list().filter((r) => !r.completed).map((r) => r.text),
          lights: opts.lights,
          find: find(f),
          weather: opts.weather,
          geminiKey: opts.geminiKey,
          fetch: f,
        });
        return note(prompt, a.reply, a.action, a.query ? { query: a.query, results: a.results } : {});
      } catch (e) {
        return note(prompt, e instanceof NestError ? e.message : "Something went wrong; try again.", "error");
      }
    },
    state(): AssistantState {
      return { rev, pending: null, turns: [...turns] };
    },
  };
}

export type LocalBrain = ReturnType<typeof localBrain>;

/** A failure whose message is fit to show on the TV as the answer. */
export class NestError extends Error {}

/** Both conversations, the server's and the TV's own, in the order they happened. */
export function mergeTurns(server: AssistantState | null, local: AssistantState): AssistantState {
  if (!server) return local;
  if (!local.turns.length) return server;
  return {
    rev: server.rev * 1000 + local.rev,
    pending: server.pending,
    turns: [...server.turns, ...local.turns].sort((a, b) => a.at - b.at).slice(-MAX_TURNS),
  };
}
