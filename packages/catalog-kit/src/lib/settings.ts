import { type BootAnimationMode, readJson, writeJson } from "@secretary/tv-kit";
import { applyFont, applyType, isDisplayFont, isTextSize, isTypeStyle } from "@secretary/tv-kit/src/glass/type.ts";
import { type AccentName, ACCENTS, DISPLAY_FONTS, type DisplayFont, TEXT_SIZES, type TextSize, TYPE_STYLES, type TypeStyle } from "@secretary/tv-kit/src/glass/tokens.ts";
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
/** The accent (tv-kit glass tokens.ts ACCENTS): the secretary bird's plumage. */
export type AccentTheme = AccentName;
export type ArtworkProviderPref = "fanart" | "tmdb" | "addon";
export type ReminderSource = "companion" | "local";
/**
 * Spoiler protection on a show's page, for episodes not yet watched (lib/titlepage.ts `isSpoiler`). `blur`: their
 * stills and synopses are shown blurred; `hide`: only their number and title show. The titles always stay readable.
 */
export type SpoilerMode = "off" | "blur" | "hide";
export const SPOILER_MODES: readonly SpoilerMode[] = ["off", "blur", "hide"];
export const SPOILER_LABELS: Record<SpoilerMode, string> = { off: "Off", blur: "Blur", hide: "Hide" };

/** A stored spoiler setting: the old switch (on) is Blur; anything unknown is Off. */
export function spoilerModeOf(v: unknown): SpoilerMode {
  if (v === true) return "blur";
  return SPOILER_MODES.includes(v as SpoilerMode) ? (v as SpoilerMode) : "off";
}

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
  Appearance: "Colours, fonts, the clock, the boot animation and how collections look.",
  Advanced: "Patterns that steer autoplay, and restoring the defaults.",
};

export interface DashboardSettings {
  general: {
    bootAnimation: BootAnimationMode;
    clockFormat: ClockFormat;
    accentTheme: AccentTheme;
    /** The type style and text size (tv-kit glass tokens.ts TYPE_STYLES, TEXT_SIZES), in Settings › Appearance. */
    typeStyle: TypeStyle;
    textSize: TextSize;
    /** The display face (tv-kit glass tokens.ts DISPLAY_FONTS), in Settings › Appearance › Font. */
    displayFont: DisplayFont;
    /**
     * Reduce motion: no push-in on a focused home card and no transition when a card opens (Secretary's home). On the
     * page as `data-sg-motion="reduced"` (applyLook). In Settings › Appearance.
     */
    reduceMotion: boolean;
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
    /** Spoiler protection on a show's page (`SpoilerMode`): Off by default. Saved as a boolean before 2026-11-25 (on: Blur). */
    spoilerProtection: SpoilerMode;
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
    accentTheme: "ember",
    typeStyle: "studio",
    textSize: "normal",
    displayFont: "grotesk",
    reduceMotion: false,
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
    spoilerProtection: "off",
  },
  home: {
    hiddenApps: [],
    reminders: true,
    homeAlerts: true,
    spokenReplies: true,
    listenOnFocus: true,
  },
};

export const ACCENT_THEMES: Record<AccentTheme, { label: string; hex: string; ink: string }> = ACCENTS;

/** The accents before the plumage set (Nov 2026), each to its nearest: Rose had none, so it takes the default. */
const OLD_ACCENTS: Record<string, AccentTheme> = { raptor: "ember", rose: "ember", blue: "slate", gold: "ochre" };

/** A stored accent: one of ours, an old one mapped to the new set, anything else the default. */
export function accentThemeOf(v: unknown): AccentTheme {
  if (typeof v === "string" && v in ACCENTS) return v as AccentTheme;
  return (typeof v === "string" && OLD_ACCENTS[v]) || DEFAULT_SETTINGS.general.accentTheme;
}

/**
 * The one accent (tv-kit glass tokens.ts ACCENT): every focus fill, badge, kicker, progress bar and tab takes this
 * colour, and `--tinta` is the ink on it. Secretary calls it at start and whenever the setting changes.
 */
export function applyThemeToDocument(theme: AccentTheme): void {
  if (typeof document === "undefined") return;
  const spec = ACCENT_THEMES[theme] ?? ACCENT_THEMES.ember;
  const root = document.documentElement;
  root.style.setProperty("--accent", spec.hex);
  root.style.setProperty("--tinta", spec.ink);
}

/** The page's look from the settings: the accent, the type style, the text size, the display face and motion. */
export function applyLook(
  general: Pick<DashboardSettings["general"], "accentTheme" | "typeStyle" | "textSize"> & { displayFont?: DisplayFont; reduceMotion?: boolean },
): void {
  applyThemeToDocument(general.accentTheme);
  applyType(general.typeStyle, general.textSize);
  applyFont(general.displayFont);
  applyMotion(general.reduceMotion === true);
}

/** Reduce motion on the page: `data-sg-motion="reduced"` on `<html>`, which the screens' CSS reads. */
export function applyMotion(reduced: boolean): void {
  if (typeof document === "undefined") return;
  if (reduced) document.documentElement.setAttribute("data-sg-motion", "reduced");
  else document.documentElement.removeAttribute("data-sg-motion");
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
      accentTheme: accentThemeOf(g.accentTheme),
      typeStyle: isTypeStyle(g.typeStyle) ? g.typeStyle : DEFAULT_SETTINGS.general.typeStyle,
      textSize: isTextSize(g.textSize) ? g.textSize : DEFAULT_SETTINGS.general.textSize,
      displayFont: isDisplayFont(g.displayFont) ? g.displayFont : DEFAULT_SETTINGS.general.displayFont,
      reduceMotion: typeof g.reduceMotion === "boolean" ? g.reduceMotion : DEFAULT_SETTINGS.general.reduceMotion,
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
      spoilerProtection: spoilerModeOf(p.spoilerProtection),
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
  /** A switch: whether it is on, so its line lights up in the accent (Settings' list). */
  on?(s: DashboardSettings): boolean;
  /** A few fixed values: all of them and the one set, shown under the preview beside the list. */
  choices?(s: DashboardSettings): { items: readonly string[]; at: number };
  /** A setting typed with the TV keyboard: OK opens it with the current text, Left clears it. */
  text?: { get(s: DashboardSettings): string; set(s: DashboardSettings, value: string): DashboardSettings };
}

/** The languages to cycle through, with the current one in it when it is not one of ours. */
const withCurrent = (code: string | undefined) => (code && !LANGUAGES.includes(code) ? [code, ...LANGUAGES] : [...LANGUAGES]);

const ACCENT_ORDER = Object.keys(ACCENTS) as AccentTheme[];
const FONT_ORDER = Object.keys(DISPLAY_FONTS) as DisplayFont[];
const TYPE_STYLE_ORDER = Object.keys(TYPE_STYLES) as TypeStyle[];
const TEXT_SIZE_ORDER = Object.keys(TEXT_SIZES) as TextSize[];
const BOOT_ORDER: readonly BootAnimationMode[] = ["standard", "fade", "instant"];

function cycleOption<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const idx = Math.max(0, list.indexOf(current));
  return list[(idx + dir + list.length) % list.length];
}

export const SETTING_ITEMS: readonly SettingItemDef[] = [
  {
    id: "playback.resumeAtOnce",
    section: "Watching",
    label: "Resume from Continue watching",
    description: "OK on a title in progress plays it, or opens its page first",
    getValue: (s) => (s.playback.resumeAtOnce ? "Plays at once" : "Opens the page"),
    cycle: (s) => ({ ...s, playback: { ...s.playback, resumeAtOnce: !s.playback.resumeAtOnce } }),
  },
  {
    id: "playback.spoilerProtection",
    section: "Watching",
    label: "Spoiler protection",
    description: "Episodes you have not watched yet, on a show's page",
    getValue: (s) => SPOILER_LABELS[s.playback.spoilerProtection],
    on: (s) => s.playback.spoilerProtection !== "off",
    choices: (s) => ({ items: SPOILER_MODES.map((m) => SPOILER_LABELS[m]), at: SPOILER_MODES.indexOf(s.playback.spoilerProtection) }),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, spoilerProtection: cycleOption(SPOILER_MODES, s.playback.spoilerProtection, dir) } }),
  },
  {
    id: "playback.autoSkip",
    section: "Watching",
    label: "Skip intros by themselves",
    description: "Off, a Skip intro pill shows for 10 seconds",
    getValue: (s) => (s.playback.autoSkip ? "On" : "Off"),
    on: (s) => s.playback.autoSkip,
    cycle: (s) => ({ ...s, playback: { ...s.playback, autoSkip: !s.playback.autoSkip } }),
  },
  {
    id: "playback.pausePanel",
    section: "Watching",
    label: "Pause panel",
    description: "Paused for 4 seconds, the screen says what is playing",
    getValue: (s) => (s.playback.pausePanel ? "On" : "Off"),
    on: (s) => s.playback.pausePanel,
    cycle: (s) => ({ ...s, playback: { ...s.playback, pausePanel: !s.playback.pausePanel } }),
  },
  {
    id: "playback.upNextCountdown",
    section: "Watching",
    label: "Up next countdown",
    description: "How long the Up next card waits before the next episode",
    getValue: (s) => countdownLabel(s.playback.upNextCountdown),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, upNextCountdown: cycleOption(COUNTDOWNS, s.playback.upNextCountdown, dir) } }),
  },
  {
    id: "playback.audioLangs",
    section: "Watching",
    label: "Audio language",
    description: "Sources in this language go first",
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
    description: "When no source has your language, these subtitles go next",
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
    description: "Your movie scene on Play, its restore scene after",
    getValue: (s) => (s.domotics.cinemaAutoDim ? "On" : "Off"),
    on: (s) => s.domotics.cinemaAutoDim,
    cycle: (s) => ({
      ...s,
      domotics: { ...s.domotics, cinemaAutoDim: !s.domotics.cinemaAutoDim },
    }),
  },
  {
    id: "playback.startAfter",
    section: "Sources",
    label: "Start playing after",
    description: "4K starts at once; otherwise Play waits this long",
    getValue: (s) => startAfterLabel(s.playback.startAfter),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, startAfter: cycleOption(START_AFTER, s.playback.startAfter, dir) } }),
  },
  {
    id: "playback.rememberSource",
    section: "Sources",
    label: "Remember my source",
    description: "Start with the kind of release you picked last time",
    getValue: (s) => (s.playback.rememberSource ? "On" : "Off"),
    on: (s) => s.playback.rememberSource,
    cycle: (s) => ({ ...s, playback: { ...s.playback, rememberSource: !s.playback.rememberSource } }),
  },
  {
    id: "playback.maxSizeGb",
    section: "Sources",
    label: "Largest file autoplay picks",
    description: "Bigger sources are tried last, never hidden",
    getValue: (s) => sizeLabel(s.playback.maxSizeGb),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, maxSizeGb: cycleOption(SIZE_STEPS_GB, s.playback.maxSizeGb, dir) } }),
  },
  {
    id: "playback.minSizeGb",
    section: "Sources",
    label: "Smallest file autoplay picks",
    description: "Smaller sources are tried last, never hidden",
    getValue: (s) => sizeLabel(s.playback.minSizeGb),
    cycle: (s, dir) => ({ ...s, playback: { ...s.playback, minSizeGb: cycleOption(SIZE_STEPS_GB, s.playback.minSizeGb, dir) } }),
  },
  {
    id: "playback.sheetOrder",
    section: "Sources",
    label: "Sources list order",
    description: "Grouped by quality, or in the providers' own order",
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
    description: "The card, the bell's count and the greeting; nothing is deleted",
    getValue: (s) => (s.home.reminders ? "On" : "Off"),
    on: (s) => s.home.reminders,
    cycle: (s) => ({ ...s, home: { ...s.home, reminders: !s.home.reminders } }),
  },
  {
    id: "home.homeAlerts",
    section: "Home screen",
    label: "Home notifications",
    description: "A notice when something at home changes (SmartThings)",
    getValue: (s) => (s.home.homeAlerts ? "On" : "Off"),
    on: (s) => s.home.homeAlerts,
    cycle: (s) => ({ ...s, home: { ...s.home, homeAlerts: !s.home.homeAlerts } }),
  },
  {
    id: "home.spokenReplies",
    section: "Home screen",
    label: "Spoken replies",
    description: "Answers to voice questions are read aloud; Blue switches it",
    getValue: (s) => (s.home.spokenReplies ? "On" : "Off"),
    on: (s) => s.home.spokenReplies,
    cycle: (s) => ({ ...s, home: { ...s.home, spokenReplies: !s.home.spokenReplies } }),
  },
  {
    id: "home.listenOnFocus",
    section: "Home screen",
    label: "Listen on focus",
    description: "The microphone opens when focus reaches the assistant",
    getValue: (s) => (s.home.listenOnFocus ? "On" : "Off"),
    on: (s) => s.home.listenOnFocus,
    cycle: (s) => ({ ...s, home: { ...s.home, listenOnFocus: !s.home.listenOnFocus } }),
  },
  {
    id: "general.accentTheme",
    section: "Appearance",
    label: "Accent colour",
    description: "Focus, the Play button, progress bars and badges",
    getValue: (s) => (ACCENT_THEMES[s.general.accentTheme] ?? ACCENT_THEMES.ember).label,
    choices: (s) => ({ items: ACCENT_ORDER.map((a) => ACCENT_THEMES[a].label), at: ACCENT_ORDER.indexOf(s.general.accentTheme) }),
    cycle: (s, dir) => ({
      ...s,
      general: {
        ...s.general,
        accentTheme: cycleOption(ACCENT_ORDER, s.general.accentTheme, dir),
      },
    }),
  },
  {
    id: "general.typeStyle",
    section: "Appearance",
    label: "Type style",
    description: "The faces of titles, numbers and buttons",
    getValue: (s) => TYPE_STYLES[s.general.typeStyle].label,
    choices: (s) => ({ items: TYPE_STYLE_ORDER.map((t) => TYPE_STYLES[t].label), at: TYPE_STYLE_ORDER.indexOf(s.general.typeStyle) }),
    cycle: (s, dir) => ({ ...s, general: { ...s.general, typeStyle: cycleOption(TYPE_STYLE_ORDER, s.general.typeStyle, dir) } }),
  },
  {
    id: "general.displayFont",
    section: "Appearance",
    label: "Font",
    description: "The face of titles and numbers; the type style says where it shows",
    getValue: (s) => DISPLAY_FONTS[s.general.displayFont].label,
    choices: (s) => ({ items: FONT_ORDER.map((f) => DISPLAY_FONTS[f].label), at: FONT_ORDER.indexOf(s.general.displayFont) }),
    cycle: (s, dir) => ({ ...s, general: { ...s.general, displayFont: cycleOption(FONT_ORDER, s.general.displayFont, dir) } }),
  },
  {
    id: "general.textSize",
    section: "Appearance",
    label: "Text size",
    description: "Every text on screen; Large is 15% bigger",
    getValue: (s) => TEXT_SIZES[s.general.textSize].label,
    choices: (s) => ({ items: TEXT_SIZE_ORDER.map((t) => TEXT_SIZES[t].label), at: TEXT_SIZE_ORDER.indexOf(s.general.textSize) }),
    cycle: (s, dir) => ({ ...s, general: { ...s.general, textSize: cycleOption(TEXT_SIZE_ORDER, s.general.textSize, dir) } }),
  },
  {
    id: "general.reduceMotion",
    section: "Appearance",
    label: "Reduce motion",
    description: "No push-in on focused cards, no movement when one opens",
    getValue: (s) => (s.general.reduceMotion ? "On" : "Off"),
    on: (s) => s.general.reduceMotion,
    cycle: (s) => ({ ...s, general: { ...s.general, reduceMotion: !s.general.reduceMotion } }),
  },
  {
    id: "general.clockFormat",
    section: "Appearance",
    label: "Clock format",
    description: "The time in the header",
    getValue: (s) => (s.general.clockFormat === "24h" ? "24-hour (21:45)" : "12-hour (9:45 PM)"),
    choices: (s) => ({ items: ["24-hour", "12-hour"], at: s.general.clockFormat === "24h" ? 0 : 1 }),
    cycle: (s) => ({
      ...s,
      general: { ...s.general, clockFormat: s.general.clockFormat === "24h" ? "12h" : "24h" },
    }),
  },
  {
    id: "general.bootAnimation",
    section: "Appearance",
    label: "Boot animation",
    description: "What shows while Secretary starts",
    getValue: (s) =>
      s.general.bootAnimation === "standard"
        ? "Standard (the quill rises in)"
        : s.general.bootAnimation === "fade"
          ? "Fade only"
          : "Instant (no splash)",
    choices: (s) => ({ items: ["Standard", "Fade only", "Instant"], at: BOOT_ORDER.indexOf(s.general.bootAnimation) }),
    cycle: (s, dir) => ({
      ...s,
      general: {
        ...s.general,
        bootAnimation: cycleOption(BOOT_ORDER, s.general.bootAnimation, dir),
      },
    }),
  },
  {
    id: "domotics.moodBackground",
    section: "Appearance",
    label: "Poster colour",
    description: "The background takes the colour of the poster in focus",
    getValue: (s) => (s.domotics.moodBackground ? "On" : "Off"),
    on: (s) => s.domotics.moodBackground,
    cycle: (s) => ({
      ...s,
      domotics: { ...s.domotics, moodBackground: !s.domotics.moodBackground },
    }),
  },
  {
    id: "collections.cardShape",
    section: "Appearance",
    label: "Collection cards",
    description: "Nuvio collection rows; a long OK on a row sets that row",
    getValue: (s) => CARD_SHAPE_LABELS[s.collections.cardShape],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, cardShape: cycleOption(["auto", ...CARD_SHAPES] as const, s.collections.cardShape, dir) } }),
  },
  {
    id: "collections.cardSize",
    section: "Appearance",
    label: "Collection card size",
    description: "Compact fits more cards on screen",
    getValue: (s) => CARD_SIZE_LABELS[s.collections.cardSize],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, cardSize: cycleOption(["auto", ...CARD_SIZES] as const, s.collections.cardSize, dir) } }),
  },
  {
    id: "collections.folderView",
    section: "Appearance",
    label: "Folder view",
    description: "How a folder opens; its View button sets that folder",
    getValue: (s) => FOLDER_VIEW_LABELS[s.collections.folderView],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, folderView: cycleOption(["auto", ...FOLDER_VIEWS] as const, s.collections.folderView, dir) } }),
  },
  {
    id: "collections.tabStyle",
    section: "Appearance",
    label: "Folder tabs",
    description: "How a folder's catalogs are picked",
    getValue: (s) => TAB_STYLE_LABELS[s.collections.tabStyle],
    cycle: (s, dir) => ({ ...s, collections: { ...s.collections, tabStyle: cycleOption(["auto", ...TAB_STYLES] as const, s.collections.tabStyle, dir) } }),
  },
  {
    id: "playback.require",
    section: "Advanced",
    label: "Autoplay only matching",
    description: "Only matching sources autoplay. OK types, Left clears",
    getValue: (s) => patternLabel(s.playback.require),
    cycle: (s) => ({ ...s, playback: { ...s.playback, require: "" } }),
    text: { get: (s) => s.playback.require, set: (s, v) => ({ ...s, playback: { ...s.playback, require: v } }) },
  },
  {
    id: "playback.prefer",
    section: "Advanced",
    label: "Prefer sources matching",
    description: "Matching sources are tried first. OK types, Left clears",
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
