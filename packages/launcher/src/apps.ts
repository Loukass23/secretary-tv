import { launchCatalogApp } from "./cloud.ts";
import { APP_IDS, SYNC_BACKEND } from "./config.ts";

export interface RawApp {
  id: string;
  name: string;
  iconPath?: string;
  show?: boolean;
}

export interface AppEntry {
  id: string;
  name: string;
  iconPath?: string;
}

export type CatalogKind = "movie" | "series" | "anime";

export interface SlimTitle {
  id: string;
  name: string;
  year: string;
  rating: string;
  poster?: string;
  background?: string;
}

export interface UnifiedResumeEntry {
  type: CatalogKind;
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

export interface SearchResult {
  type: CatalogKind;
  title: SlimTitle;
}

export const posterUrl = (t: Pick<SlimTitle, "id" | "poster">) =>
  t.poster ? t.poster.replace("/medium.", "/small.") : `https://images.metahub.space/poster/small/${t.id}/img`;

export const badgeFor = (entry: {
  type: CatalogKind;
  episode?: UnifiedResumeEntry["episode"];
  title?: SlimTitle;
  posSec?: number;
}) => {
  const kind = entry.type === "movie" ? "Movie" : entry.type === "series" ? "Series" : "Anime";
  if (entry.episode) {
    const s = String(entry.episode.season).padStart(2, "0");
    const e = String(entry.episode.episode).padStart(2, "0");
    if (entry.posSec === 0) return `Next · S${s}E${e}`;
    return `${kind} · S${s}E${e}`;
  }
  if (entry.title?.year) return `${kind} · ${entry.title.year}`;
  return kind;
};

/** Package-style ids (ten alphanumerics, a dot, a name) or numeric store ids. */
const STORE_ID = /^(?:[A-Za-z0-9]{10}\.[\w-]+|\d+)$/;
/** getAppsInfo reports many internal services as visible. */
const INTERNAL_NAME = /service|worker|agent|e-?manual/i;

export interface Options {
  /** Shown first, in this order, even when the filters would drop them. */
  pins: readonly string[];
  /** Never shown. */
  hide: readonly string[];
  /** This launcher's own id. */
  self?: string;
}

/** Pure so it can be tested: filters internals, pins first, the rest alphabetical. */
export function visibleApps(raw: readonly RawApp[], { pins, hide, self }: Options): AppEntry[] {
  const byId = new Map<string, RawApp>();
  for (const a of raw) byId.set(a.id, a);
  const pinned = pins.flatMap((id) => (byId.has(id) && id !== self ? [byId.get(id)!] : []));
  const rest = raw
    .filter(
      (a) =>
        a.show !== false &&
        a.id !== self &&
        !pins.includes(a.id) &&
        !hide.includes(a.id) &&
        STORE_ID.test(a.id) &&
        !INTERNAL_NAME.test(a.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...pinned, ...rest].map(({ id, name, iconPath }) => ({ id, name, iconPath }));
}

type TizenApp = {
  getAppsInfo(ok: (apps: RawApp[]) => void, err?: (e: unknown) => void): void;
  launch(id: string, ok?: () => void, err?: (e: unknown) => void): void;
  getCurrentApplication(): { appInfo: { id: string } };
};
const tizenApp = (): TizenApp | undefined =>
  (globalThis as { tizen?: { application?: TizenApp } }).tizen?.application;

export function listApps(): Promise<RawApp[]> {
  return new Promise((resolve, reject) => {
    const app = tizenApp();
    if (!app) return reject(new Error("tizen.application unavailable"));
    app.getAppsInfo(resolve, reject);
  });
}

export function launchApp(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const app = tizenApp();
    if (!app) return reject(new Error("tizen.application unavailable"));
    app.launch(id, () => resolve(), reject);
  });
}

/** The catalog apps get Nest's launch payload (a session of their own, a title to open); other apps a plain launch. */
export const openApp = (id: string): Promise<void> =>
  (Object.values(APP_IDS) as string[]).includes(id) ? launchCatalogApp(id, undefined, launchApp) : launchApp(id);

/**
 * Launches the target catalog app on the title's Detail view: the title travels in the launch payload, and through
 * `@secretary/server` too while the apps still read the server's handoff.
 */
export async function openTitleInApp(
  serverUrl: string,
  type: CatalogKind,
  title: SlimTitle,
  autoPlay = false,
  f: typeof fetch = fetch,
): Promise<void> {
  // With Nuvio the title travels in the launch payload only; the server's handoff would open it a second time.
  if (serverUrl && SYNC_BACKEND === "secretary") {
    try {
      await f(`${serverUrl}/handoff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, title, autoPlay }),
      });
    } catch {
      // Proceed to launch even if the server handoff fails.
    }
  }
  await launchCatalogApp(APP_IDS[type], { type, title, autoPlay }, launchApp);
}

export function ownId(): string | undefined {
  try {
    return tizenApp()?.getCurrentApplication().appInfo.id;
  } catch {
    return undefined;
  }
}

/** Landscape art for a Continue Watching tile; anime (Kitsu ids) has no metahub background. */
export const backdropUrl = (entry: Pick<UnifiedResumeEntry, "type" | "title">) =>
  entry.title.background ??
  (entry.type === "anime" ? posterUrl(entry.title) : `https://images.metahub.space/background/medium/${entry.title.id}/img`);

/** A reminder as `@secretary/server` stores it (GET /reminders). */
export interface Reminder {
  id: string;
  text: string;
  due?: string;
  completed: boolean;
  source: "companion" | "gemini" | "local";
}

export interface ReminderState {
  items: Reminder[];
  aiSummary?: string;
}

/** Open reminders first, done ones after; each group keeps the server's order. */
export const orderReminders = (items: readonly Reminder[]): Reminder[] => [
  ...items.filter((r) => !r.completed),
  ...items.filter((r) => r.completed),
];

async function call<T>(f: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  const res = await f(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} ${res.status}`);
  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchReminders = (serverUrl: string, f: typeof fetch = fetch) =>
  call<ReminderState>(f, `${serverUrl}/reminders`);

export const toggleReminder = (serverUrl: string, id: string, f: typeof fetch = fetch) =>
  call<ReminderState>(f, `${serverUrl}/reminders/${encodeURIComponent(id)}/toggle`, { method: "POST" });

export const addReminder = (serverUrl: string, text: string, f: typeof fetch = fetch) =>
  call<ReminderState>(f, `${serverUrl}/reminders`, post({ text, source: "local" }));

export type Scene = "cinema" | "warm" | "off";

export const setScene = (serverUrl: string, scene: Scene, f: typeof fetch = fetch) =>
  call<unknown>(f, `${serverUrl}/domotics/command`, post({ scene }));
