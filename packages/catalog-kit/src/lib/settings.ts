import { type BootAnimationMode, readJson, writeJson } from "@secretary/tv-kit";
import { START_AFTER, type StartAfter, startAfterLabel } from "./autoplay.ts";
import type { SheetOrder } from "../ui/sheet.ts";
import { patternLabel, SIZE_STEPS_GB, sizeLabel } from "./rules.ts";
import { type Countdown, COUNTDOWNS, countdownLabel } from "./upnext.ts";
import {
  type Auto,
  CARD_SHAPE_LABELS,
  CARD_SHAPES,
  CARD_SIZE_LABELS,
  CARD_SIZES,
  type CardShape,
  type CardSize,
  FOLDER_VIEW_LABELS,
  FOLDER_VIEWS,
  type FolderView,
  TAB_STYLE_LABELS,
  TAB_STYLES,
  type TabStyle,
} from "./collectionlayout.ts";

// The Hub has Search and Settings; the dashboard is Secretary Nest (docs/launcher.md).
export type OverlayTab = "search" | "settings";
export type ClockFormat = "24h" | "12h";
export type AccentTheme = "raptor" | "rose" | "blue" | "gold";
export type ArtworkProviderPref = "fanart" | "tmdb" | "addon";
export type ReminderSource = "companion" | "local";

/**
 * Settings' categories, as its tabs show them (ui/HubOverlay.tsx). "Apps" lists the TV's apps for the Apps card, and
 * "Sources" ends with the plugin repositories, debrid keys and addons (ui/sources.ts).
 */
export const SETTING_TABS = ["Watching", "Sources", "Home screen", "Apps", "Appearance", "Advanced"] as const;
export type SettingTab = (typeof SETTING_TABS)[number];

/** One line under each tab's name, saying what is in it. */
export const SETTING_TAB_BLURB: Record<SettingTab, string> = {
  Watching: "How titles start, play and end, the languages you watch in, spoilers and the lights.",
  Sources: "How a source is picked, then the repositories, debrid keys and addons streams come from.",
  "Home screen": "Turn Secretary's features on or off.",
  Apps: "The apps the Apps card shows. A new app shows until you hide it.",
  Appearance: "Colours, the clock, the boot animation and how collections look.",
  Advanced: "Patterns that steer autoplay, and restoring the defaults.",
};

export interface DashboardSettings {
  general: {
    bootAnimation: BootAnimationMode;
    clockFormat: ClockFormat;
    accentTheme: AccentTheme;
  };
  domotics: {
    cinemaAutoDim: boolean;
    /** The background takes the mood of the focused poster (its dominant colour). */
    moodBackground: boolean;
  };
  /** How Nuvio collections look (lib/collectionlayout.ts); a row or a folder can carry its own choice on top. */
  collections: {
    cardShape: Auto<CardShape>;
    cardSize: Auto<CardSize>;
    folderView: Auto<FolderView>;
    tabStyle: Auto<TabStyle>;
  };
  playback: {
    /** OK on a title in progress (Nest's Continue watching) plays it at once, or opens its page first. */
    resumeAtOnce: boolean;
    /** How long Play waits for slower providers before starting the best source found (lib/autoplay.ts). */
    startAfter: StartAfter;
    /** Sources outside these sizes, in GB, are tried after the others (lib/rules.ts); null is no limit. */
    maxSizeGb: number | null;
    minSizeGb: number | null;
    /** Patterns typed on the TV (lib/rules.ts): only sources matching `require` autoplay; `prefer` goes first. */
    require: string;
    prefer: string;
    /** Start a title, and the next episode, with the same kind of source as last time (lib/sourcepref.ts). */
    rememberSource: boolean;
    /** The sources sheet grouped by quality, or in the providers' own order (ui/sheet.ts). */
    sheetOrder: SheetOrder;
    /** How long the Up next card counts down before the next episode starts (lib/upnext.ts). */
    upNextCountdown: Countdown;
    /** Skip intros and recaps without asking (lib/skip.ts). */
    autoSkip: boolean;
    /** Paused for 4 s, the screen says what is playing (lib/pausepanel.ts). */
    pausePanel: boolean;
    /**
     * Audio languages, most wanted first (ISO 639-1), sent as LANG_PREF. Empty is Automatic: the TV's language ranks
     * the sources, and providers keep what their repository's worker guessed for them, as before this setting.
     */
    audioLangs: string[];
    /** Subtitle languages for a source in another language (VOSTFR-style); empty is the audio languages. */
    subLangs: string[];
    /**
     * Spoiler protection on a show's page: the still and the synopsis of every episode not yet watched are blurred
     * (lib/titlepage.ts `isSpoiler`); the titles stay readable. Off by default.
     */
    spoilerProtection: boolean;
  };
  /**
   * Secretary's own home screen (launcher/src/features.ts): what the Apps card leaves out, and the features a viewer can
   * switch off. Each is on by default, as before these switches.
   */
  home: {
    /** Apps taken off the Apps card, by id. Only hidden ids are kept, so an app installed later shows. */
    hiddenApps: string[];
    /** The Reminders card, the bell's count, and reminders in the assistant's greeting. */
    reminders: boolean;
    /** A notice when something at home changes (SmartThings), also kept in the Recent card. */
    homeAlerts: boolean;
    /** The answer to a voice question is read aloud. Was `nest.speak` ("0" off) before this setting. */
    spokenReplies: boolean;
    /** The microphone opens as soon as focus reaches the assistant; off, OK or the mic key starts it. */
    listenOnFocus: boolean;
  };
}

/** The languages Settings cycles through; a code outside it (another TV language) is kept as it is. */
export const LANGUAGES: readonly string[] = ["en", "fr", "es", "de", "it", "pt", "ja", "ko", "hi", "ru", "zh", "ar", "nl", "pl", "tr"];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  ru: "Russian",
  zh: "Chinese",
  ar: "Arabic",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
};

export const languageLabel = (code: string | undefined) => (code ? (LANGUAGE_NAMES[code] ?? code.toUpperCase()) : "None");

/** The TV's language ("fr-FR" → "fr"), English when it does not say. */
export function systemLang(): string {
  const tag = typeof navigator !== "undefined" ? navigator.language : "";
  const code = /^([a-z]{2,3})(?![a-z])/i.exec(tag ?? "")?.[1]?.toLowerCase();
  return code ?? "en";
}

type LangSettings = Pick<DashboardSettings["playback"], "audioLangs" | "subLangs">;

/** The audio languages the sources are ranked by: the chosen ones, else the TV's. */
export const audioLangsOf = (p: Pick<LangSettings, "audioLangs">) => (p.audioLangs.length ? p.audioLangs : [systemLang()]);

/** The subtitle languages the sources are ranked by: the chosen ones, else the audio ones (FansubGroup-style anime). */
export const subLangsOf = (p: LangSettings) => (p.subLangs.length ? p.subLangs : audioLangsOf(p));

/**
 * The LANG_PREF providers read (packages/plugins sandbox.ts): "fr,en;subs=fr", or "fr" without subtitles. Nothing
 * while both are Automatic, so a provider keeps the worker's guess: the live providers return no French release under
 * "en", where the worker's "bilingual" did.
 */
export function langPref(p: LangSettings): string | undefined {
  if (!p.audioLangs.length && !p.subLangs.length) return undefined;
  const audio = audioLangsOf(p).join(",");
  return p.subLangs.length ? `${audio};subs=${p.subLangs.join(",")}` : audio;
}

const langList = (v: unknown, fallback: string[]) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[a-z]{2,3}$/.test(x)) : fallback;

export const DEFAULT_SETTINGS: DashboardSettings = {
  general: {
    bootAnimation: "standard",
    clockFormat: "24h",
    accentTheme: "raptor",
  },
  domotics: {
    cinemaAutoDim: false,
    moodBackground: true,
  },
  collections: { cardShape: "auto", cardSize: "auto", folderView: "auto", tabStyle: "auto" },
  playback: {
    resumeAtOnce: true,
    startAfter: "5",
    maxSizeGb: null,
    minSizeGb: null,
    require: "",
    prefer: "",
    rememberSource: true,
    sheetOrder: "grouped",
    upNextCountdown: "5",
    autoSkip: false,
    pausePanel: true,
    audioLangs: [],
    subLangs: [],
    spoilerProtection: false,
  },
  home: {
    hiddenApps: [],
    reminders: true,
    homeAlerts: true,
    spokenReplies: true,
    listenOnFocus: true,
  },
};

export const ACCENT_THEMES: Record<AccentTheme, { label: string; hex: string; ink: string }> = {
  raptor: { label: "Raptor Orange (#FF5A26)", hex: "#ff5a26", ink: "#ffffff" },
  rose: { label: "Rose (#EC407A)", hex: "#ec407a", ink: "#ffffff" },
  blue: { label: "Cinema Blue (#5AA2FF)", hex: "#5aa2ff", ink: "#0d0f13" },
  gold: { label: "Aristocrat Gold (#E8B04F)", hex: "#e8b04f", ink: "#0d0f13" },
};

/** The accent colours highlights (Play, progress, badges); glass focus stays white. */
export function applyThemeToDocument(theme: AccentTheme): void {
  if (typeof document === "undefined") return;
  const spec = ACCENT_THEMES[theme] ?? ACCENT_THEMES.raptor;
  const root = document.documentElement;
  root.style.setProperty("--accent", spec.hex);
  root.style.setProperty("--tinta", spec.ink);
}

const SETTINGS_KEY = "sectv:settings:v1";
/** Spoken replies before they were a setting: "0" was off. Still written, so an older build reads the same choice. */
export const LEGACY_SPEAK_KEY = "nest.speak";
const LOCAL_REMINDERS_KEY = "sectv:reminders:local:v1";
const RECENT_SEARCHES_KEY = "sectv:recent-searches:v1";
const MAX_RECENT_SEARCHES = 8;

const DEFAULT_RECENT_SEARCHES = ["Dune", "Severance", "The Matrix", "Attack on Titan"];

export function loadRecentSearches(): string[] {
  const list = readJson<string[]>(RECENT_SEARCHES_KEY);
  if (!Array.isArray(list)) return [...DEFAULT_RECENT_SEARCHES];
  return list.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, MAX_RECENT_SEARCHES);
}

export function saveRecentSearch(query: string): string[] {
  const clean = query.trim();
  if (clean.length < 2) return loadRecentSearches();
  const existing = loadRecentSearches().filter((x) => x.toLowerCase() !== clean.toLowerCase());
  const next = [clean, ...existing].slice(0, MAX_RECENT_SEARCHES);
  writeJson(RECENT_SEARCHES_KEY, next);
  return next;
}

export function clearRecentSearches(): string[] {
  writeJson(RECENT_SEARCHES_KEY, []);
  return [];
}

/** Secretary's preferences kept under their own keys before they were settings (read when the settings lack them). */
export interface LegacyPrefs {
  /** `nest.speak`: "0" muted the spoken replies. */
  speak?: string | null;
}

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const idList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))] : []);

/**
 * Settings saved by older builds keep their extra keys on disk; only the known ones are read. A section an older build
 * never saved (`home`) takes its defaults, except what `legacy` still holds from before it was a setting.
 */
export function mergeSettings(partial?: Partial<DashboardSettings> | null, legacy: LegacyPrefs = {}): DashboardSettings {
  const legacySpeak = legacy.speak === "0" ? false : DEFAULT_SETTINGS.home.spokenReplies;
  if (!partial || typeof partial !== "object") {
    const fresh = structuredClone(DEFAULT_SETTINGS);
    fresh.home.spokenReplies = legacySpeak;
    return fresh;
  }
  const g = partial.general ?? ({} as Partial<DashboardSettings["general"]>);
  const d = partial.domotics ?? ({} as Partial<DashboardSettings["domotics"]>);
  const p = partial.playback ?? ({} as Partial<DashboardSettings["playback"]>);
  const c = partial.collections ?? ({} as Partial<DashboardSettings["collections"]>);
  const h = (partial.home && typeof partial.home === "object" ? partial.home : {}) as Partial<DashboardSettings["home"]>;
  const pick = <T extends string>(list: readonly T[], v: unknown): Auto<T> => (list.includes(v as T) ? (v as T) : "auto");
  return {
    general: {
      bootAnimation: g.bootAnimation ?? DEFAULT_SETTINGS.general.bootAnimation,
      clockFormat: g.clockFormat ?? DEFAULT_SETTINGS.general.clockFormat,
      accentTheme: g.accentTheme ?? DEFAULT_SETTINGS.general.accentTheme,
    },
    domotics: {
      cinemaAutoDim: d.cinemaAutoDim ?? DEFAULT_SETTINGS.domotics.cinemaAutoDim,
      moodBackground: d.moodBackground ?? DEFAULT_SETTINGS.domotics.moodBackground,
    },
    collections: {
      cardShape: pick(CARD_SHAPES, c.cardShape),
      cardSize: pick(CARD_SIZES, c.cardSize),
      folderView: pick(FOLDER_VIEWS, c.folderView),
      tabStyle: pick(TAB_STYLES, c.tabStyle),
    },
    playback: {
      resumeAtOnce: p.resumeAtOnce ?? DEFAULT_SETTINGS.playback.resumeAtOnce,
      startAfter: p.startAfter && START_AFTER.includes(p.startAfter) ? p.startAfter : DEFAULT_SETTINGS.playback.startAfter,
      maxSizeGb: SIZE_STEPS_GB.includes(p.maxSizeGb ?? null) ? (p.maxSizeGb ?? null) : null,
      minSizeGb: SIZE_STEPS_GB.includes(p.minSizeGb ?? null) ? (p.minSizeGb ?? null) : null,
      require: typeof p.require === "string" ? p.require : "",
      prefer: typeof p.prefer === "string" ? p.prefer : "",
      rememberSource: p.rememberSource ?? DEFAULT_SETTINGS.playback.rememberSource,
      sheetOrder: p.sheetOrder === "provider" ? "provider" : "grouped",
      upNextCountdown: p.upNextCountdown && COUNTDOWNS.includes(p.upNextCountdown) ? p.upNextCountdown : "5",
      autoSkip: p.autoSkip ?? false,
      pausePanel: p.pausePanel ?? true,
      audioLangs: langList(p.audioLangs, []),
      subLangs: langList(p.subLangs, []),
      spoilerProtection: p.spoilerProtection === true,
    },
    home: {
      hiddenApps: idList(h.hiddenApps),
      reminders: bool(h.reminders, DEFAULT_SETTINGS.home.reminders),
      homeAlerts: bool(h.homeAlerts, DEFAULT_SETTINGS.home.homeAlerts),
      spokenReplies: bool(h.spokenReplies, legacySpeak),
      listenOnFocus: bool(h.listenOnFocus, DEFAULT_SETTINGS.home.listenOnFocus),
    },
  };
}

function readLegacy(): LegacyPrefs {
  try {
    return { speak: localStorage.getItem(LEGACY_SPEAK_KEY) };
  } catch {
    return {};
  }
}

export function loadSettings(): DashboardSettings {
  return mergeSettings(readJson<Partial<DashboardSettings>>(SETTINGS_KEY), readLegacy());
}

const listeners = new Set<(s: DashboardSettings) => void>();

/** Calls `cb` with the settings after every save, from Settings or from Secretary's home (Blue mutes the replies). */
export function onSettings(cb: (s: DashboardSettings) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function saveSettings(next: DashboardSettings): DashboardSettings {
  const merged = mergeSettings(next);
  writeJson(SETTINGS_KEY, merged);
  try {
    localStorage.setItem(LEGACY_SPEAK_KEY, merged.home.spokenReplies ? "1" : "0");
  } catch {
    // The setting above is what this build reads.
  }
  listeners.forEach((l) => l(merged));
  return merged;
}

/** Changes Secretary's own preferences (the `home` section) and saves. */
export const saveHome = (patch: Partial<DashboardSettings["home"]>) => {
  const s = loadSettings();
  return saveSettings({ ...s, home: { ...s.home, ...patch } });
};

/** Shows or hides one app on the Apps card. */
export function toggleApp(s: DashboardSettings, id: string): DashboardSettings {
  const hidden = s.home.hiddenApps.includes(id) ? s.home.hiddenApps.filter((x) => x !== id) : [...s.home.hiddenApps, id];
  return { ...s, home: { ...s.home, hiddenApps: hidden } };
}

export interface SettingItemDef {
  id: string;
  /** The tab it is under. */
  section: SettingTab;
  label: string;
  description: string;
  getValue(s: DashboardSettings): string;
  cycle(s: DashboardSettings, dir: 1 | -1): DashboardSettings;
  /** A setting typed with the TV keyboard: OK opens it with the current text, Left clears it. */
  text?: { get(s: DashboardSettings): string; set(s: DashboardSettings, value: string): DashboardSettings };
}

/** The languages to cycle through, with the current one in it when it is not one of ours. */
const withCurrent = (code: string | undefined) => (code && !LANGUAGES.includes(code) ? [code, ...LANGUAGES] : [...LANGUAGES]);

function cycleOption<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const idx = Math.max(0, list.indexOf(current));
  return list[(idx + dir + list.length) % list.length];
}

export const SETTING_ITEMS: readonly SettingItemDef[] = [
  {
    id: "playback.resumeAtOnce",
    section: "Watching",
    label: "Resume from Continue watching",
    description: "A title in progress plays at once when you press OK on it on the home screen; off, its page opens first",
    getValue: (s) => (s.playback.resumeAtOnce ? "Plays at once" : "Opens the page"),
    cycle: (s) => ({ ...s, playback: { ...s.playback, resumeAtOnce: !s.playback.resumeAtOnce } }),
  },
  {
    id: "playback.spoilerProtection",
    section: "Watching",
    label: "Spoiler protection",
    description: "On a show's page, the still and the synopsis of every episode you have not watched are blurred; the titles stay readable",
    getValue: (s) => (s.playback.spoilerProtection ? "On" : "Off"),
    cycle: (s) => ({ ...s, playback: { ...s.playback, spoilerProtection: !s.playback.spoilerProtection } }),
  },
  {
    id: "playback.autoSkip",
    section: "Watching",
    label: "Skip intros and recaps by themselves",
    description: "Off: a Skip intro pill shows for 10 seconds and OK skips; On: they are skipped without asking",
    getValue: (s) => (s.playback.autoSkip ? "On" : "Off"),
    cycle: (s) => ({ ...s, playback: { ...s.playback, autoSkip: !s.playback.autoSkip } }),
  },
  {
    id: "playback.pausePanel",
    section: "Watching",
    label: "Pause panel",
    description: "Paused for 4 seconds, the screen shows what is playing; OK resumes",
    getValue: (s) => (s.playback.pausePanel ? "On" : "Off"),
    cycle: (s) => ({ ...s, playback: { ...s.playback, pausePanel: !s.playback.pausePanel } }),
  },
  {
    id: "playback.upNextCountdown",
    section: "Watching",
    label: "Up next countdown",
    description: "Near an episode's end a card shows the next one; it starts after this, or OK starts it at once",
    getValue: (s) => countdownLabel(s.playback.upNextCountdown),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, upNextCountdown: cycleOption(COUNTDOWNS, s.playback.upNextCountdown, dir) } }),
  },
  {
    id: "playback.audioLangs",
    section: "Watching",
    label: "Audio language",
    description: "Sources in this language go first; providers that know the language of a release use it to search",
    getValue: (s) =>
      s.playback.audioLangs.length ? languageLabel(s.playback.audioLangs[0]) : `Automatic (${languageLabel(systemLang())})`,
    cycle: (s, dir) => {
      const options = ["", ...withCurrent(s.playback.audioLangs[0])];
      const next = cycleOption(options, s.playback.audioLangs[0] ?? "", dir);
      return { ...s, playback: { ...s.playback, audioLangs: next ? [next] : [] } };
    },
  },
  {
    id: "playback.subLangs",
    section: "Watching",
    label: "Subtitles for other languages",
    description: "When no source has your audio language, those with subtitles in this one go next (VOSTFR-style)",
    getValue: (s) => (s.playback.subLangs.length ? languageLabel(s.playback.subLangs[0]) : "Same as audio"),
    cycle: (s, dir) => {
      const options = ["", ...withCurrent(s.playback.subLangs[0])];
      const next = cycleOption(options, s.playback.subLangs[0] ?? "", dir);
      return { ...s, playback: { ...s.playback, subLangs: next ? [next] : [] } };
    },
  },
  {
    id: "domotics.cinemaAutoDim",
    section: "Watching",
    label: "Movie lights",
    description:
      "Run the movie scene picked in the Lights panel when playback starts, and its restore scene after. Without SmartThings in Secretary, the server dims to 15%",
    getValue: (s) => (s.domotics.cinemaAutoDim ? "On" : "Off"),
    cycle: (s) => ({
      ...s,
      domotics: { ...s.domotics, cinemaAutoDim: !s.domotics.cinemaAutoDim },
    }),
  },
  {
    id: "playback.startAfter",
    section: "Sources",
    label: "Start playing after",
    description: "Play starts at once with a 4K source; otherwise it waits this long for slower providers",
    getValue: (s) => startAfterLabel(s.playback.startAfter),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, startAfter: cycleOption(START_AFTER, s.playback.startAfter, dir) } }),
  },
  {
    id: "playback.rememberSource",
    section: "Sources",
    label: "Remember my source",
    description: "A title, and its next episode, start with the same kind of release you picked or watched last",
    getValue: (s) => (s.playback.rememberSource ? "On" : "Off"),
    cycle: (s) => ({ ...s, playback: { ...s.playback, rememberSource: !s.playback.rememberSource } }),
  },
  {
    id: "playback.maxSizeGb",
    section: "Sources",
    label: "Largest file autoplay picks",
    description: "Bigger sources are tried after the others, never hidden",
    getValue: (s) => sizeLabel(s.playback.maxSizeGb),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, maxSizeGb: cycleOption(SIZE_STEPS_GB, s.playback.maxSizeGb, dir) } }),
  },
  {
    id: "playback.minSizeGb",
    section: "Sources",
    label: "Smallest file autoplay picks",
    description: "Smaller sources (often low quality) are tried after the others, never hidden",
    getValue: (s) => sizeLabel(s.playback.minSizeGb),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, minSizeGb: cycleOption(SIZE_STEPS_GB, s.playback.minSizeGb, dir) } }),
  },
  {
    id: "playback.sheetOrder",
    section: "Sources",
    label: "Sources list order",
    description: "Grouped by quality with the best for this TV first, or in the providers' own order",
    getValue: (s) => (s.playback.sheetOrder === "provider" ? "Providers' order" : "Grouped by quality"),
    cycle: (s) => ({
      ...s,
      playback: { ...s.playback, sheetOrder: s.playback.sheetOrder === "provider" ? "grouped" : "provider" },
    }),
  },
  {
    id: "home.reminders",
    section: "Home screen",
    label: "Reminders",
    description: "The Reminders card, the count on the bell and reminders in the assistant's greeting. Off hides them; nothing is deleted",
    getValue: (s) => (s.home.reminders ? "On" : "Off"),
    cycle: (s) => ({ ...s, home: { ...s.home, reminders: !s.home.reminders } }),
  },
  {
    id: "home.homeAlerts",
    section: "Home screen",
    label: "Home notifications",
    description: "A notice when something at home changes (a phone comes home, the vacuum finishes), kept in the Recent card. Needs SmartThings",
    getValue: (s) => (s.home.homeAlerts ? "On" : "Off"),
    cycle: (s) => ({ ...s, home: { ...s.home, homeAlerts: !s.home.homeAlerts } }),
  },
  {
    id: "home.spokenReplies",
    section: "Home screen",
    label: "Spoken replies",
    description: "The assistant reads its answer aloud after a voice question. Blue on the home screen switches it too",
    getValue: (s) => (s.home.spokenReplies ? "On" : "Off"),
    cycle: (s) => ({ ...s, home: { ...s.home, spokenReplies: !s.home.spokenReplies } }),
  },
  {
    id: "home.listenOnFocus",
    section: "Home screen",
    label: "Listen when the assistant is focused",
    description: "The microphone opens as soon as focus reaches the assistant. Off, it waits for OK or the mic key",
    getValue: (s) => (s.home.listenOnFocus ? "On" : "Off"),
    cycle: (s) => ({ ...s, home: { ...s.home, listenOnFocus: !s.home.listenOnFocus } }),
  },
  {
    id: "general.accentTheme",
    section: "Appearance",
    label: "Accent colour",
    description: "Colours the Play button, progress bars and badges; focus stays white glass",
    getValue: (s) => (ACCENT_THEMES[s.general.accentTheme] ?? ACCENT_THEMES.raptor).label,
    cycle: (s, dir) => ({
      ...s,
      general: {
        ...s.general,
        accentTheme: cycleOption(["raptor", "rose", "blue", "gold"] as const, s.general.accentTheme, dir),
      },
    }),
  },
  {
    id: "general.clockFormat",
    section: "Appearance",
    label: "Clock format",
    description: "Show the time in 24-hour or 12-hour format",
    getValue: (s) => (s.general.clockFormat === "24h" ? "24-hour (21:45)" : "12-hour (9:45 PM)"),
    cycle: (s) => ({
      ...s,
      general: { ...s.general, clockFormat: s.general.clockFormat === "24h" ? "12h" : "24h" },
    }),
  },
  {
    id: "general.bootAnimation",
    section: "Appearance",
    label: "Boot animation",
    description: "The quill rising in, a gentle fade, or an instant launch",
    getValue: (s) =>
      s.general.bootAnimation === "standard"
        ? "Standard (Quill rises in)"
        : s.general.bootAnimation === "fade"
          ? "Fade Only (Reduced Motion)"
          : "Instant (No Splash)",
    cycle: (s, dir) => ({
      ...s,
      general: {
        ...s.general,
        bootAnimation: cycleOption(["standard", "fade", "instant"] as const, s.general.bootAnimation, dir),
      },
    }),
  },
  {
    id: "domotics.moodBackground",
    section: "Appearance",
    label: "Poster colour",
    description: "Tint the metallic background with the colour of the poster in focus. Off keeps the neutral background",
    getValue: (s) => (s.domotics.moodBackground ? "On" : "Off"),
    cycle: (s) => ({
      ...s,
      domotics: { ...s.domotics, moodBackground: !s.domotics.moodBackground },
    }),
  },
  {
    id: "collections.cardShape",
    section: "Appearance",
    label: "Collection cards",
    description: "The card shape of Nuvio collection rows; Automatic uses each collection's own. A long OK on a row sets that row",
    getValue: (s) => CARD_SHAPE_LABELS[s.collections.cardShape],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, cardShape: cycleOption(["auto", ...CARD_SHAPES] as const, s.collections.cardShape, dir) } }),
  },
  {
    id: "collections.cardSize",
    section: "Appearance",
    label: "Collection card size",
    description: "Compact fits more cards on screen; Automatic is Standard",
    getValue: (s) => CARD_SIZE_LABELS[s.collections.cardSize],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, cardSize: cycleOption(["auto", ...CARD_SIZES] as const, s.collections.cardSize, dir) } }),
  },
  {
    id: "collections.folderView",
    section: "Appearance",
    label: "Folder view",
    description: "How a folder opens: grid, rows, timeline, cover flow, ranking, mural or decades. Automatic follows the collection. The View button in a folder sets that folder",
    getValue: (s) => FOLDER_VIEW_LABELS[s.collections.folderView],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, folderView: cycleOption(["auto", ...FOLDER_VIEWS] as const, s.collections.folderView, dir) } }),
  },
  {
    id: "collections.tabStyle",
    section: "Appearance",
    label: "Folder tabs",
    description: "How a folder's catalogs are picked: chips, a dropdown, a centre bar or pages. Automatic uses chips up to 5 catalogs, else a dropdown",
    getValue: (s) => TAB_STYLE_LABELS[s.collections.tabStyle],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, tabStyle: cycleOption(["auto", ...TAB_STYLES] as const, s.collections.tabStyle, dir) } }),
  },
  {
    id: "playback.require",
    section: "Advanced",
    label: "Autoplay only sources matching",
    description: "A pattern such as MULTI|DUAL; when nothing matches, the sources open to pick from. OK types, ‹ clears",
    getValue: (s) => patternLabel(s.playback.require),
    cycle: (s) => ({ ...s, playback: { ...s.playback, require: "" } }),
    text: { get: (s) => s.playback.require, set: (s, v) => ({ ...s, playback: { ...s.playback, require: v } }) },
  },
  {
    id: "playback.prefer",
    section: "Advanced",
    label: "Prefer sources matching",
    description: "A pattern such as REMUX; matching sources are tried first. OK types, ‹ clears",
    getValue: (s) => patternLabel(s.playback.prefer),
    cycle: (s) => ({ ...s, playback: { ...s.playback, prefer: "" } }),
    text: { get: (s) => s.playback.prefer, set: (s, v) => ({ ...s, playback: { ...s.playback, prefer: v } }) },
  },
];

export interface ReminderItem {
  id: string;
  text: string;
  due?: string;
  completed: boolean;
  source?: "companion" | "gemini" | "local";
  createdAt: number;
}

const DEFAULT_LOCAL_REMINDERS: ReminderItem[] = [
  {
    id: "local-1",
    text: "Open Secretary Desk on phone to dictate tasks or stomp lights",
    due: "Today",
    completed: false,
    source: "local",
    createdAt: 1,
  },
];

export function loadLocalReminders(): ReminderItem[] {
  const list = readJson<ReminderItem[]>(LOCAL_REMINDERS_KEY);
  return Array.isArray(list) && list.length ? list : DEFAULT_LOCAL_REMINDERS;
}

export function saveLocalReminders(items: ReminderItem[]): ReminderItem[] {
  writeJson(LOCAL_REMINDERS_KEY, items);
  return items;
}

export async function fetchRemindersForMode(
  source: ReminderSource,
  serverUrl: string,
  f: typeof fetch = fetch,
): Promise<{ items: ReminderItem[]; aiSummary?: string }> {
  if (source === "local" || !serverUrl) {
    return { items: loadLocalReminders() };
  }
  try {
    const res = await f(`${serverUrl.replace(/\/$/, "")}/reminders`);
    if (!res.ok) return { items: loadLocalReminders() };
    const data = (await res.json()) as { items?: ReminderItem[]; aiSummary?: string };
    return { items: data.items ?? [], aiSummary: data.aiSummary };
  } catch {
    return { items: loadLocalReminders() };
  }
}

export async function toggleReminderForMode(
  source: ReminderSource,
  serverUrl: string,
  id: string,
  f: typeof fetch = fetch,
): Promise<ReminderItem[]> {
  if (source === "local" || !serverUrl) {
    const current = loadLocalReminders();
    const updated = current.map((r) => (r.id === id ? { ...r, completed: !r.completed } : r));
    return saveLocalReminders(updated);
  }
  try {
    const res = await f(`${serverUrl.replace(/\/$/, "")}/reminders/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
    });
    if (!res.ok) return loadLocalReminders();
    const data = (await res.json()) as { items?: ReminderItem[] };
    return data.items ?? [];
  } catch {
    return loadLocalReminders();
  }
}
