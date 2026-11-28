import { exitApp, getTvInputBridge, useKeys, useOkHold } from "@secretary/tv-kit";
import { artColour, artPalette, type Backdrop, backdropFor, Glass, GlassRoot, glowImage, HoldPill, homeMood, type IconName, type Palette, setWaveLevel, TINTS, useFocusRing } from "@secretary/tv-kit/src/glass/index.ts";
import { avatarCatalog, avatarImage, type LibraryItem, listProfiles, type Profile, pullCollections, pullLibrary, deleteProgress, progressKey, pullProgress, toItems, withMeta } from "@secretary/nuvio";
import { readJson, writeJson } from "@secretary/tv-kit";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Profiles, SignIn } from "./account.tsx";
import {
  addReminder,
  type AppEntry,
  appsOnCard,
  backdropUrl,
  type CatalogKind,
  fetchReminders,
  launchApp,
  listApps,
  onBeforeLaunch,
  openApp,
  openYoutube,
  orderReminders,
  ownId,
  posterUrl,
  type Reminder,
  type Scene,
  type SearchResult,
  type SlimTitle,
  setScene,
  toggleReminder,
  type UnifiedResumeEntry,
  visibleApps,
} from "./apps.ts";
import {
  artProxy,
  type AssistantTurn,
  fetchWeather,
  THEME_PREFS,
  type ThemePref,
  themeFor,
  flipTheme,
  ripplePrompt,
  themePrompt,
  VoiceError,
  WAVE_STATUS,
  briefing,
  waveState,
  type Weather,
} from "./assistant.ts";
import { localBrain, localReminders, NestError } from "./brain.ts";
import { cloud, cloudEnabled, signInSkipped, skipSignIn } from "./cloud.ts";
import { GEMINI_KEY, GROQ_KEY, HIDE, PINS, SERVER_URL, WEATHER_ENV, YOUTUBE_API_KEY, YOUTUBE_APP_ID } from "./config.ts";
import { alertsShown, mayListen, remindersShown, speaksReply } from "./features.ts";
import { applyOrder, keepOrder, loadOrder, moveKey, saveOrder } from "./card-order.ts";
import { type CardStyle, collapsedShape, loadCardStyles, openStyleMenu, saveCardStyles, type StyleMenu, stepStyleMenu, styleFor } from "./card-style.ts";
import { COVER_EVERY_MS, COVER_TURN_KEY, coverPicks, oneEach } from "./card-covers.ts";
import { CatalogHost, type CatalogEntry } from "./catalog-host.tsx";
// Types only: the catalog itself loads as its own chunk (catalog-host.tsx).
import type { EmbeddedHost } from "@secretary/catalog-kit";
import type { HostCatalogContext } from "@secretary/catalog-kit/src/host.ts";
import { statusForInteraction, tailorAssistant, type AssistantPageContext } from "./assistant-context.ts";
import { clampConversation, type ConversationFocus, type ConversationShape, dockItemCount, stepConversation, stepDock } from "./conversation-nav.ts";
import { AssistantDock, ConversationOverlay, MAX_INLINE_RESULTS } from "./conversation.tsx";
import { DISCOVER, type DiscoverData, loadDiscover, refreshDiscover } from "./discover.ts";
import { loadMylist, mylistItems, saveMylist } from "./mylist.ts";
import {
  type CollectionCard,
  collectionLine,
  collectionStyle,
  FOLDER_TITLES,
  folderRowKey,
  folderRows,
  foldersRowKey,
  foldersShape,
  type FolderTitle,
  folderTitlesKey,
  isCollectionKey,
  loadCards,
  loadFolderTitles,
  saveCards,
  saveFolderTitles,
  toCards,
} from "./collections.ts";
import { loadVideos, refreshVideos, regionOf, CARD_VIDEOS, watchUrl, type Video } from "./youtube.ts";
import { applyLook, loadSettings, onSettings, saveHome } from "@secretary/catalog-kit/src/lib/settings.ts";
import { dismiss, loadDismissed, saveDismissed } from "./dismissed.ts";
import { loadRowLooks, ROW_SHAPE_LABEL, type RowShape, rowShape, saveRowLooks, stepShape } from "./row-look.ts";
import { canRemove, labelOf, loadHidden, removed, saveHidden } from "./home-cards.ts";
import { expandedRows, expands, type MediaItem, type MoreRow, type RowColumn, rowLayout, type TileTarget, targetAt } from "./cards.tsx";
import { episodeLabel, timeLeft } from "./card-rows.ts";
import { appIcon } from "./app-icons.ts";
import { cachedTitleArt, type TitleArt, titleArt } from "@secretary/catalog-kit/src/lib/fanart.ts";
import { recommend, type RecState } from "./recommend.ts";
import { type CardMenu, HEADER_ITEMS, HEADER_ORDER, headerButtons, Home, shownStyle, type TileMenu } from "./home.tsx";
import {
  atEnd,
  clamp,
  enter,
  type Focus,
  HEADER_BELL,
  HEADER_LIGHTS,
  HEADER_PARTY,
  HEADER_PICTURE,
  HEADER_PROFILE,
  HEADER_SEARCH,
  HEADER_SETTINGS,
  HEADER_SOUND,
  type Layout,
  END_ALL,
  END_RECOMMEND,
  END_TOP,
  leave,
  rowAt,
  step,
} from "./nest-nav.ts";
import {
  ensureTvSoundForMedia,
  home,
  homeConfigured,
  homeGrant,
  independentLights,
  noteStatus,
  mediaReleased,
  playFarewell,
  playOpenRipple,
  playRippleTest,
  pictureNow,
  playSplashRipple,

  restoreAiSoundAfterMedia,

  setPictureMode,

  syncMood,
  rippleBeforeLaunch,
  runLights,
  toggleSound,
  togglePictureMode,
} from "./home-control.ts";
import { saveHomeGrant } from "@secretary/catalog-kit/src/lib/home.ts";
import { inLibrary, toggleLibrary } from "@secretary/catalog-kit/src/lib/library.ts";
import { animeImdbIds, knownAnime, noteAnime, onlyKind } from "@secretary/catalog-kit/src/lib/animeguard.ts";
import { isTitleWatched, loadWatchedIds, removeResume, toggleTitleWatched, watchedEpisodes } from "@secretary/catalog-kit/src/lib/resume.ts";
import { fetchMeta } from "@secretary/catalog-kit/src/lib/cinemeta.ts";
import { defaultEpisode, episodesOf, nextEpisode, seasonsOf } from "@secretary/catalog-kit/src/lib/episodes.ts";
import { episodeTag, isSpoiler } from "@secretary/catalog-kit/src/lib/titlepage.ts";
import { stepTitleMenu, titleMenu } from "@secretary/catalog-kit/src/lib/titlemenu.ts";
import { effective, type LightFx, lightFx, onLightFx, setLightFx } from "./light-fx.ts";
import { lightCount, lightsOnLabel } from "./light-count.ts";
import { MoodPanel } from "./mood.tsx";
import { activeMood, allMoods, mainMoods, type Mood, setActiveMood } from "./moods.ts";
import { readTvPicture } from "./picture-mode.ts";
import { accountsTab, startTrackers } from "./accounts-settings.tsx";
import { settled, SMARTTHINGS_TAB, smartThingsTab } from "./smartthings-settings.tsx";
import type { PanelHeader } from "./panel-header.tsx";
import { WatchTogether } from "./party.tsx";
import { SearchScreen } from "./search.tsx";
import { getAudioRouteState, play, record, refreshAudioDevices, stopPlayback, watchAudioDevices, type AudioRouteState, type Recording } from "./voice.ts";
import { cachedWeather, refreshWeather } from "./weather.ts";
import { homeAction, homeAlerts, pictureTv, roomLux, type StDevice, type StRoom, type StScene } from "@secretary/smartthings";
import { AssistantUnavailable, discoverCatalog, findCatalogs, type FocusedTitleContext, type MoodKey, parseReminder, parseRoutine, transcribeGroq, speak as speakGemini, transcribe as transcribeGemini } from "@secretary/assistant";

const EXIT_WINDOW_MS = 2000;
const REMINDER_TOAST_MS = 6000;
const THEME_KEY = "nest.theme";
const VOICE_KEYS = { listen: Boolean(GEMINI_KEY || GROQ_KEY), speak: Boolean(GEMINI_KEY) };
/** Open-Meteo updates every 15 min; the header has no need to be fresher than half an hour. */
const WEATHER_POLL_MS = 30 * 60_000;
/** Answers and home alerts in the Recent row, newest first. */
const MAX_RECENT = 4;
/** SmartThings device status while Nest is up: one call per rate-limit window (10 per ~15 s, shared with commands). */
const HOME_POLL_MS = 15_000;
/** Nest has to have been off screen this long (another app, the TV's own menus) for the slow ripple to play on its return. */
const RIPPLE_AWAY_MS = 20_000;
/** How long the wave keeps "speaking" after an answer arrives. */
const SPEAK_MS = 3000;
/** The glow when an artwork's colour cannot be read: the app's own tint. */
const KIND_TINT: Record<CatalogKind, string> = { movie: TINTS.orange, series: TINTS.gold, anime: TINTS.clay };
const THEME_LABEL: Record<ThemePref, string> = { auto: "Theme: automatic (Daylight 7–19h)", day: "Theme: Daylight", night: "Theme: Night" };

function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEME_PREFS.includes(v as ThemePref) ? (v as ThemePref) : "auto";
  } catch {
    return "auto";
  }
}

/** The TV's settings have their own place (the profile menu), not the Apps card. */
const OWN_PLACES: readonly string[] = [PINS[PINS.length - 1]];
const SETTINGS_ID = PINS[PINS.length - 1];
/** Trending titles for the empty Cinema, Shows and Anime cards, fetched from the TV once a day. */
// .2: picks now carry their description (the caption under an opened card).
const TRENDING_KEY = "nest.trending.2";
const TRENDING_TTL_MS = 24 * 60 * 60_000;
type Trending = Record<CatalogKind, SearchResult[]>;

/** The results whose poster really loads: a blank slot among the suggestions only confuses. */
function loadablePosters(items: SearchResult[]): Promise<SearchResult[]> {
  return Promise.all(
    items.map(
      (r) =>
        new Promise<boolean>((resolve) => {
          const img = new Image();
          const t = setTimeout(() => resolve(false), 6000);
          img.onload = () => {
            clearTimeout(t);
            resolve(true);
          };
          img.onerror = () => {
            clearTimeout(t);
            resolve(false);
          };
          img.src = posterUrl(r.title);
        }),
    ),
  ).then((ok) => items.filter((_, i) => ok[i]));
}

/** The media cards, in row order: what fills each and how it is named (cards.tsx, card-style.ts). */
// The card's label is its one-word name ("Shows"), whatever it holds. `list` names the day's list the picks are ranked
// on, for their caption ("No. 3 in today's popular films").
const MEDIA = [
  { key: "cinema", kind: "movie", name: "Cinema", unit: "films", pickBadge: "Top film", list: "today's popular films" },
  { key: "shows", kind: "series", name: "Shows", unit: "shows", pickBadge: "Top series", list: "today's popular shows" },
  { key: "anime", kind: "anime", name: "Anime", unit: "titles", pickBadge: undefined, list: "today's trending anime" },
] as const;
/** Titles per media card whose artwork is looked up (catalog-kit titleArt): what the folded card and Continue watching show. */
const ART_PER_CARD = 6;
/** The row "Recommend me" fills; it is the last row, just above the end bar. */
const PICKED_ROW = "Picked for you";
/** Titles an opened media card holds at most. */
const MEDIA_MAX = 8;
const NO_TRENDING: Trending = { movie: [], series: [], anime: [] };

/** A card in the Recent column: an answer from the assistant, or something the home reported. */
type RecentCard =
  | { kind: "answer"; key: string; at: number; action: string; prompt: string; reply: string }
  | { kind: "alert"; key: string; at: number; text: string };

const SOURCE_LABEL: Record<Reminder["source"], [string, string]> = {
  companion: ["From Secretary Desk", "#e0792a"],
  gemini: ["From the assistant", "#ffb52e"],
  local: ["Added on the TV", "#3ccf6e"],
};
/**
 * The line under a reminder: when it is due, else where it came from, but only when that tells the viewer something
 * (not every reminder being "Added on the TV" when they all were).
 */
const reminderLine = (r: Reminder, all: readonly Reminder[]): string | undefined => {
  if (r.completed) return undefined;
  const mixed = all.some((o) => o.source !== r.source);
  return mixed || r.source !== "local" ? (SOURCE_LABEL[r.source] ?? SOURCE_LABEL.local)[0] : undefined;
};
const SCENES: readonly [Scene, string][] = [
  ["cinema", "🎬 Cinema lights"],
  ["warm", "🕯 Warm lights"],
  ["off", "🌙 Lights off"],
  ["music", "🎵 Music mode"],
];
/** The Home card's buttons: the same scenes (toasts keep the emoji), as line icons and short names. */
const CARD_ACTION: Record<Scene, { icon: IconName; label: string }> = {
  cinema: { icon: "cinema", label: "Cinema" },
  warm: { icon: "warm", label: "Warm" },
  off: { icon: "power", label: "Off" },
  music: { icon: "music", label: "Music" },
};

/** localStorage, or memory when the TV refuses it: the TV's reminders then last until Nest restarts. */
const memory = new Map<string, string>();
const storage = {
  getItem(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem(k: string, v: string) {
    memory.set(k, v);
    try {
      localStorage.setItem(k, v);
    } catch {
      // kept in memory
    }
  },
};
const localRem = localReminders(storage);

const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** "user:profile" of the signed-in Nuvio profile (the collections cache is kept per profile), or null. */
function collectionOwner(): string | null {
  const s = cloudEnabled ? cloud.session.get() : null;
  return s && !s.anonymous ? `${s.userId}:${cloud.session.profile()}` : null;
}

/**
 * One search request for the search screen, to the catalogs straight from the TV: aborted with `signal` (a newer
 * keystroke), given up after a few seconds, and an error when no catalog answers.
 */
const findTitles = (q: string, signal: AbortSignal): Promise<SearchResult[]> => findCatalogs(q, { signal });

/** What was typed in the search when it was last left: the next visit opens on it. */
let lastSearch = "";

export function App() {
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  /** The light effects (Lights panel) and the focused poster's mood, which tints the background. */
  const [fx, setFx] = useState<LightFx>(lightFx);
  const [mood, setMood] = useState<Palette | null>(null);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [continueItems, setContinueItems] = useState<UnifiedResumeEntry[]>([]);
  // The home cards' artwork (catalog-kit titleArt: Fanart.tv thumbs and logos), by `kind:id`; the cache's art until then.
  const [arts, setArts] = useState<Record<string, TitleArt>>({});
  // The profile's My List (mylist.ts), for its card; the last pull shows at once.
  const [myList, setMyList] = useState<LibraryItem[]>(() => loadMylist(storage, collectionOwner()));
  // Genre rows after My List (discover.ts); the last pull shows at once.
  const [discover, setDiscover] = useState<DiscoverData>(() => loadDiscover(storage).data);
  // What is popular on YouTube (youtube.ts), for its card; the last pull shows at once.
  const [youtube, setYoutube] = useState<Video[]>(() => loadVideos(storage).videos);
  // The profile's Nuvio collections, one home card each (collections.ts); the last pull shows at once.
  const [collectionCards, setCollectionCards] = useState<CollectionCard[]>(() => loadCards(storage, collectionOwner()));
  // Each folder's first titles, for its row in the opened collection card; the last load shows at once.
  const [folderTitles, setFolderTitles] = useState<Record<string, FolderTitle[]>>(() => loadFolderTitles(storage, collectionOwner()));
  // Secretary's own settings (Settings › Home screen and Apps): the features switched off and the apps hidden.
  const [prefs, setPrefs] = useState(() => loadSettings().home);
  // The one accent and the type (glass tokens.ts) come from the settings, from the first frame and on every change.
  useMemo(() => applyLook(loadSettings().general), []);
  // The watch trackers the viewer connected (Settings › Accounts: Simkl), told what plays from the first frame.
  useMemo(() => startTrackers(), []);
  useEffect(
    () =>
      onSettings((s) => {
        setPrefs(s.home);
        applyLook(s.general);
      }),
    [],
  );
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [serverReminders, setReminders] = useState<Reminder[]>([]);
  const [localItems, setLocalItems] = useState<Reminder[]>(() => localRem.list());
  const reminders = useMemo(() => remindersShown(prefs, orderReminders([...serverReminders, ...localItems])), [serverReminders, localItems, prefs.reminders]);
  const [summary, setSummary] = useState<string | undefined>();
  const [serverOnline, setServerOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "search" | "signin" | "profiles" | "party" | "lights" | "catalog">(() =>
    cloudEnabled && !cloud.session.signedIn() && !signInSkipped() ? "signin" : "home",
  );
  // The catalog browsed inside Secretary (catalog-host.tsx): what it opened on.
  const [catalog, setCatalog] = useState<CatalogEntry | null>(null);
  /** The catalog screen the search was opened from, to go back to with Back; null: the home. */
  const [searchFrom, setSearchFrom] = useState<CatalogEntry | null>(null);
  const [me, setMe] = useState<{ name: string; color?: string; img?: string } | null>(null);
  const [focus, setFocus] = useState<Focus>({ area: "row", col: 0, i: 0 });
  /** The latest focus, for callbacks that outlive a render. */
  const focusRef = useRef(focus);
  focusRef.current = focus;
  // Which titles the folded media cards show (card-covers.ts): one turn on from the last launch, then on every return
  // from the catalog and every few minutes while no media card is focused or open.
  const [coverTurn, setCoverTurn] = useState(() => {
    const next = (Number(readJson<number>(COVER_TURN_KEY)) || 0) + 1;
    writeJson(COVER_TURN_KEY, next);
    return next;
  });
  /** Whether a media card has focus now (set while the row renders): its covers wait. */
  const mediaFocused = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      if (!mediaFocused.current) setCoverTurn((n) => n + 1);
    }, COVER_EVERY_MS);
    return () => clearInterval(t);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The mood strip under the lights button (mood-strip.tsx), while it is open. */
  const [stripOpen, setStripOpen] = useState(false);
  // Each media card's look (a long OK on it), and the menu while it is open: the card previews the menu's choice.
  const [cardStyles, setCardStyles] = useState<Record<string, CardStyle>>(() => loadCardStyles(storage));
  const [styleMenu, setStyleMenu] = useState<StyleMenu | null>(null);
  /** The cards taken off the home row (a long OK, "Remove from home"); the last card puts them back. */
  const [hidden, setHidden] = useState<string[]>(() => loadHidden(storage));
  /** Suggestions taken off the picks (title menu, "Remove from suggestions"): the next trending title takes their place. */
  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissed(storage));
  /** How each row of an opened media card draws its tiles (title menu, "Row look"), by `<card>/<row>`. */
  const [rowLooks, setRowLooks] = useState<Record<string, RowShape>>(() => loadRowLooks(storage));
  /** "Recommend me" on each media card's end bar, by card key: where the assistant's answer is, and how often it was asked. */
  const [recs, setRecs] = useState<Record<string, { state: RecState; n: number }>>({});
  /** The card whose picks just arrived, so focus can move onto them once the row is drawn. */
  const [recFocus, setRecFocus] = useState<string | null>(null);
  /** The menu on a title tile of an opened media card (a long OK), with what it acts on. */
  const [tileMenu, setTileMenu] = useState<{ menu: TileMenu; target: TileTarget } | null>(null);
  /** When OK went down on something a long press does more with; the hold pill shows from it (null: not holding). */
  const [holdSince, setHoldSince] = useState<number | null>(null);
  /** The remove menu on a card without a style menu: that card's key. */
  const [removeMenu, setRemoveMenu] = useState<CardMenu | null>(null);
  // The card order the viewer set (card-order.ts), and the card being moved with the order it had, so Back can undo.
  const [order, setOrder] = useState<string[]>(() => loadOrder(storage));
  const [moving, setMoving] = useState<{ key: string; orig: string[] } | null>(null);
  const [trending, setTrending] = useState<Trending>(() => {
    try {
      const c = JSON.parse(storage.getItem(TRENDING_KEY) ?? "null") as { at: number; v: Trending } | null;
      return c?.v ?? NO_TRENDING;
    } catch {
      return NO_TRENDING;
    }
  });
  /** What the search screen opens with (the assistant's and the CDP scripts' searches). */
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  /** The sound system's state just asked for, shown until SmartThings reports it (a few seconds at most). */
  const [soundSet, setSoundSet] = useState<boolean | null>(null);
  const soundTimer = useRef<ReturnType<typeof setTimeout>>();
  /**
   * The picture mode as the TV itself reads it (picture-mode.ts), read again on load, when Secretary comes back to the
   * screen, every half minute and after each change; undefined on a TV without the settings API. SmartThings' own
   * status for it is stale on this TV.
   */
  const [tvPicture, setTvPicture] = useState<string | undefined>(readTvPicture);
  /** The mood last set (moods.ts activeMood): the header's lights button shows its icon. */
  const [moodKey, setMoodKey] = useState<string | null>(activeMood);
  const [time, setTime] = useState(clock);
  const [asking, setAsking] = useState(false);
  const [listening, setListening] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingAudio, setSpeakingAudio] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();
  const [audioRoute, setAudioRoute] = useState<AudioRouteState>(getAudioRouteState);
  const audioRouteRef = useRef(audioRoute);
  audioRouteRef.current = audioRoute;
  const [catalogCtx, setCatalogCtx] = useState<HostCatalogContext | null>(null);
  const catalogCtxRef = useRef(catalogCtx);
  catalogCtxRef.current = catalogCtx;
  /** Assistant dock or full-screen conversation opened over a non-Home screen (Catalog, Detail, Mood). */
  const [extAssistant, setExtAssistant] = useState<null | "dock" | "chat">(null);
  const extAssistantRef = useRef(extAssistant);
  extAssistantRef.current = extAssistant;
  const [extDockIdx, setExtDockIdx] = useState(0);
  const [convFocus, setConvFocus] = useState<ConversationFocus>({ zone: "controls", i: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastHomeCol = useRef(0);
  if (focus.area === "row") lastHomeCol.current = focus.col ?? 0;
  const onWave = (v: number | null) => {
    setWaveLevel(v);
    const loud = v !== null && v > 0.08;
    setHearing((was) => (was === loud ? was : loud));
  };
  /** What the assistant just recommended: it replaces that kind's card items, and the card opens onto them. */
  const [found, setFound] = useState<{ kind: CatalogKind; query: string; prompt: string; reply: string; items: SearchResult[] } | null>(null);
  /** The card to put focus on once the row has been rebuilt (a card's index is only known then). */
  const [goto, setGoto] = useState<{ key: string; inside: boolean } | null>(null);
  const [weather, setWeather] = useState<Weather | null>(() => cachedWeather(storage));
  /** What the home reported lately (the phone came home, the vacuum finished), for the Recent row. */
  const [alerts, setAlerts] = useState<{ text: string; at: number }[]>([]);
  const [themePref, setThemePref] = useState<ThemePref>(loadThemePref);
  const speakReplies = prefs.spokenReplies;
  /** The clip being recorded from the room microphone. */
  const recording = useRef<Recording | null>(null);
  /** The microphone is being opened: a second press waits for it. */
  const opening = useRef(false);
  /** Auto-listen pauses when no microphone is connected, cleared automatically on `devicechange` or manual retry. */
  const keyboardOnly = useRef(false);
  const [glow, setGlow] = useState<string | undefined>();
  const speakTimer = useRef<ReturnType<typeof setTimeout>>();
  const [devices, setDevices] = useState<StDevice[]>([]);
  const [scenes, setScenes] = useState<StScene[]>([]);
  // The rooms of the homes the lights are in, for Settings › SmartThings: read once per set of homes.
  const [stRooms, setStRooms] = useState<StRoom[]>([]);
  const homesKey = [...new Set(devices.map((d) => d.locationId).filter((l): l is string => Boolean(l)))].sort().join(",");
  useEffect(() => {
    if (!homesKey || !homeConfigured()) return;
    let live = true;
    home.roomsIn(homesKey.split(",")).then(
      (r) => live && setStRooms(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [homesKey]);
  // Switches made in Settings › SmartThings count at once until a poll confirms them.
  useEffect(() => settled(devices), [devices]);
  const lux = useMemo(() => roomLux(devices), [devices]);
  const theme = useMemo(() => themeFor(themePref, new Date().getHours(), lux), [themePref, time, lux]);
  const scene = useRef(0);
  const lastBack = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  /** What the TV's own assistant reads when it answers: the latest devices, scenes, forecast and focused title. */
  const lastFocusedTarget = useRef<{ type: CatalogKind; title: SlimTitle } | null>(null);
  const live = useRef({ devices, scenes, weather, continueItems, myList });
  /** The viewer's mood by key (set below, beside applyMood), for Ask's mood prompts and routines. */
  const moodBy = useRef<(key: MoodKey) => Promise<unknown>>(() => Promise.resolve());
  live.current = { devices, scenes, weather, continueItems, myList };
  const currentTitleTarget = (): { type: CatalogKind; title: SlimTitle } | null => {
    if (viewRef.current === "catalog" && catalogCtxRef.current?.title) {
      const ct = catalogCtxRef.current.title;
      return { type: ct.kind, title: ct };
    }
    return lastFocusedTarget.current;
  };
  const readFocusedTitle = async (): Promise<FocusedTitleContext | null> => {
    const pick =
      currentTitleTarget() ??
      (live.current.continueItems[0] ? { type: live.current.continueItems[0].type, title: live.current.continueItems[0].title } : null);
    if (!pick) return null;
    const meta = await Promise.race([
      fetchMeta(pick.type, pick.title.id).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    const spoilerMode = loadSettings().playback.spoilerProtection;
    const watched = watchedEpisodes(pick.title.id);
    const titleWatched = isTitleWatched(pick.title.id);
    const resume = live.current.continueItems.find((e) => e.title.id === pick.title.id);
    const videos = meta?.videos ?? [];
    const ordered = seasonsOf(videos).flatMap((s) => episodesOf(videos, s));

    let lastWatched: FocusedTitleContext["lastWatched"];
    if (resume?.episode) {
      const match = videos.find((v) => v.season === resume.episode!.season && v.episode === resume.episode!.episode);
      lastWatched = {
        label: episodeTag(resume.episode),
        name: match?.name ?? resume.episode.name,
        overview: match?.overview,
      };
    } else if (ordered.length && watched.size) {
      const seen = [...ordered].reverse().find((v) => watched.has(`${v.season}:${v.episode}`));
      if (seen) lastWatched = { label: episodeTag(seen), name: seen.name, overview: seen.overview };
    }

    let nextEp: FocusedTitleContext["nextEpisode"];
    if (pick.type !== "movie" && videos.length) {
      const candidate = resume?.episode
        ? (nextEpisode(videos, resume.episode.id) ?? defaultEpisode(videos, resume.episode.id, Date.now(), watched))
        : defaultEpisode(videos, undefined, Date.now(), watched);
      if (candidate) {
        nextEp = {
          label: episodeTag(candidate),
          name: candidate.name,
          overview: candidate.overview,
          unwatched: isSpoiler(candidate, { mode: "blur", watched, resumeId: resume?.episode?.id, titleWatched }),
        };
      }
    }

    return {
      id: pick.title.id,
      kind: pick.type,
      name: meta?.name ?? pick.title.name,
      year: meta?.year || pick.title.year || undefined,
      rating: meta?.rating || pick.title.rating || undefined,
      runtime: meta?.runtime,
      genres: meta?.genre,
      director: meta?.director,
      cast: meta?.cast,
      poster: meta?.poster ?? pick.title.poster,
      background: meta?.background ?? pick.title.background,
      description: meta?.description ?? pick.title.description,
      spoilerMode,
      lastWatched,
      nextEpisode: nextEp,
    };
  };
  const brain = useMemo(
    () =>
      localBrain({
        reminders: localRem,
        lights: (cmd) => runLights(cmd, live.current.devices, live.current.scenes),
        // Ask's "cinema mode", "movie night" and "goodnight" set the viewer's own moods, as the strip does.
        mood: (key) => moodBy.current(key),
        focusedTitle: readFocusedTitle,
        continueWatching: () => live.current.continueItems.map((e) => ({ type: e.type, title: e.title })),
        myList: () =>
          [...live.current.myList]
            .sort((a, b) => b.addedAt - a.addedAt)
            .map((l) => ({ type: l.type, title: l.title })),
        setMyList: (wantSaved) => {
          const pick = currentTitleTarget();
          if (!pick) return null;
          const currently = inLibrary(pick.type, pick.title.id);
          if (currently !== wantSaved) toggleLibrary(pick.type, pick.title);
          return { name: pick.title.name, saved: wantSaved, item: { type: pick.type, title: pick.title } };
        },
        weather: async () => live.current.weather,
        geminiKey: GEMINI_KEY,
      }),
    [],
  );
  const [talk, setTalk] = useState(() => brain.state());

  const flash = (msg: string, ms = EXIT_WINDOW_MS) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  // Detect Bluetooth / room audio devices connected after Secretary started, and keep media/movies on TV speakers.
  const prevBluetooth = useRef(false);
  useEffect(() => {
    const off = watchAudioDevices((next) => {
      setAudioRoute(next);
      if (next.hasMic) keyboardOnly.current = false;
      if (next.bluetooth && !prevBluetooth.current) {
        flash("🔵 Bluetooth speaker ready for Secretary");
        if (viewRef.current === "catalog" && catalogCtxRef.current?.screen === "player") {
          void ensureTvSoundForMedia(live.current.devices, live.current.scenes, true);
        }
      }
      prevBluetooth.current = next.bluetooth;
    });
    const onWake = () => {
      if (document.visibilityState !== "hidden") void refreshAudioDevices();
    };
    document.addEventListener("visibilitychange", onWake);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  // When leaving the catalog or changing top-level screens, close any floating non-Home assistant bar.
  useEffect(() => {
    if (view !== "catalog") setCatalogCtx(null);
    if (view === "search" || view === "signin" || view === "profiles" || view === "party") {
      recording.current?.cancel();
      stopPlayback();
      setExtAssistant(null);
    }
  }, [view]);

  // While AVPlay plays a film or episode: hide the assistant, stop any AI speech, and route TV media audio to TV speakers.
  const isPlayingMedia = view === "catalog" && catalogCtx?.screen === "player";
  const wasPlayingMedia = useRef(false);
  useEffect(() => {
    if (isPlayingMedia) {
      recording.current?.cancel();
      stopPlayback();
      setExtAssistant(null);
      void ensureTvSoundForMedia(live.current.devices, live.current.scenes, audioRouteRef.current.bluetooth);
    } else if (wasPlayingMedia.current) {
      void restoreAiSoundAfterMedia(live.current.scenes);
      void refreshAudioDevices();
    }
    wasPlayingMedia.current = isPlayingMedia;
  }, [isPlayingMedia]);

  /** The one search (search.tsx), from the header, the Search key and CH-, here and inside the catalog; with no query, on the last one typed. */
  const openSearch = (q = "") => {
    setQuery(q.trim() ? q : lastSearch);
    setSearchFrom(null);
    setView("search");
  };

  const applyReminders = (state: { items: Reminder[]; aiSummary?: string }) => {
    setReminders(orderReminders(state.items));
    if (state.aiSummary !== undefined) setSummary(state.aiSummary);
  };

  /** Types a new reminder with the TV keyboard and saves it on the server, or on the TV without one. */
  const newReminder = () => {
    const opened = getTvInputBridge().open("", {
      onCommit: (val) => {
        const text = val.trim();
        if (!text) return;
        if (!SERVER_URL) {
          const parsed = parseReminder(`remind me to ${text}`);
          setLocalItems(parsed ? localRem.add(parsed.text, parsed.due, Date.now(), parsed.dueAt) : localRem.add(text));
          return flash("Reminder added");
        }
        addReminder(SERVER_URL, text).then(
          (s) => {
            applyReminders(s);
            flash("Reminder added");
          },
          () => flash("Couldn't add the reminder"),
        );
      },
    });
    if (!opened) flash("The TV keyboard isn't available; add reminders from Secretary Desk");
  };

  const pickTheme = (pref: ThemePref) => {
    setThemePref(pref);
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      // the choice lasts until the app restarts
    }
    flash(THEME_LABEL[pref]);
  };

  /** A new answer: the wave speaks for a moment, and titles it found show inline in conversation or on the home card. */
  const onNewTurn = (turn: AssistantTurn) => {
    setAnswered(true);
    clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => setAnswered(false), SPEAK_MS);
    const inChatNow = (viewRef.current === "home" && focusRef.current.area === "chat") || extAssistantRef.current === "chat";
    showTurn(turn, viewRef.current === "home" && !inChatNow);
    if (inChatNow) {
      setConvFocus({ zone: "chips", i: 0 });
    } else if (viewRef.current !== "home") {
      if (turn.action === "resume" && turn.results?.[0]) {
        const hit = turn.results[0];
        const inProgress = live.current.continueItems.find((e) => e.title.id === hit.title.id);
        if (inProgress) resume(inProgress);
        else openHit(hit);
      } else if (turn.results?.length || turn.action === "title_info" || turn.action === "briefing" || turn.action === "weather") {
        setExtAssistant("chat");
        setConvFocus({ zone: "chips", i: 0 });
      } else {
        flash(turn.reply);
      }
    }
    if (turn.action === "reminder_added") setLocalItems(localRem.list());
  };

  /** What an answer is about: films it recommends open the Cinema card (or Shows, Anime), the weather opens its card, and so on. */
  function showTurn(turn: AssistantTurn, here: boolean) {
    if (turn.action === "watch" && turn.results?.length) {
      const kind = turn.results[0].type;
      const m = MEDIA.find((k) => k.kind === kind);
      const items = turn.results.filter((r) => r.type === kind);
      setFound({ kind, query: turn.query ?? turn.prompt, prompt: turn.prompt, reply: turn.reply, items });
      void loadablePosters(items).then((good) => {
        if (good.length && good.length < items.length) setFound((f) => (f && f.prompt === turn.prompt && f.reply === turn.reply ? { ...f, items: good } : f));
      });
      if (m && here) setGoto({ key: m.key, inside: true });
    } else if (here && turn.action === "resume" && turn.results?.[0]) {
      const hit = turn.results[0];
      const inProgress = live.current.continueItems.find((e) => e.title.id === hit.title.id);
      if (inProgress) resume(inProgress);
      else openHit(hit);
    } else if (here && (turn.action === "title_info" || turn.action === "mylist_updated") && turn.results?.[0]) {
      const m = MEDIA.find((k) => k.kind === turn.results![0].type);
      if (m && focusRef.current.area !== "row") setGoto({ key: m.key, inside: false });
    } else if (here && turn.action === "weather") setGoto({ key: "weather", inside: true });
    else if (here && turn.action === "domotics_updated") setGoto({ key: "home", inside: false });
    else if (here && turn.action === "reminder_added") setGoto({ key: "reminders", inside: true });
  }

  /** An answer from the TV's assistant. */
  const showLocal = (turn: AssistantTurn) => {
    setTalk(brain.state());
    onNewTurn(turn);
  };

  /** Asks the assistant on the TV; `spoken` prompts get their answer read aloud too, unless replies are muted. */
  const send = async (prompt: string, spoken = false) => {
    const pref = themePrompt(prompt);
    if (pref) return pickTheme(pref);
    // "ripple test": the lights' ripple on request, from a fresh status, to try it (docs/smartthings.md).
    const rippleStyle = ripplePrompt(prompt);
    if (rippleStyle) {
      flash(rippleStyle === "launch" ? "✨ Launch ripple" : "✨ Open ripple");
      return void playRippleTest(rippleStyle).catch(() => flash("SmartThings didn't take that; try again"));
    }
    // A light, "the lights", a scene or the vacuum by name: straight to SmartThings, unless it is a multi-step routine.
    const act = !parseRoutine(prompt) && (devices.length || scenes.length) ? homeAction(prompt, devices, scenes, independentLights()) : null;
    if (act) {
      flash(act.reply);
      showLocal(brain.note(prompt, act.reply, "domotics_updated"));
      // A picture mode is set on the TV itself where it can be (picture-mode.ts), else by the scene or command.
      if (act.picture) {
        const want = act.picture;
        return void setPictureMode(want, devices, scenes).then(
          (mode) => {
            setTvPicture(readTvPicture() ?? mode);
            pollHomeSoon();
          },
          () => flash("SmartThings didn't take that; try again"),
        );
      }
      const done =
        act.kind === "scene"
          ? home.runScene(act.scene.id)
          : Promise.all(act.targets.map((t) => home.command(t.device.id, t.commands)));
      return void done.then(pollHomeSoon, () => flash("SmartThings didn't take that; try again"));
    }
    stopPlayback();
    setPendingPrompt(prompt);
    setAsking(true);
    const wantSpeech = speaksReply(prefs, spoken, VOICE_KEYS.speak);
    let speech: Uint8Array | null | undefined;
    try {
      const turn = await brain.ask(prompt);
      setAsking(false);
      setPendingPrompt(undefined);
      showLocal(turn);
      if (wantSpeech) speech = await speakGemini(turn.reply, GEMINI_KEY);
    } finally {
      setAsking(false);
      setPendingPrompt(undefined);
    }
    if (speech) {
      // The wave keeps speaking for as long as the reply plays, not just SPEAK_MS.
      clearTimeout(speakTimer.current);
      setAnswered(true);
      setSpeakingAudio(true);
      await play(speech, onWave);
      setSpeakingAudio(false);
      setAnswered(false);
    }
  };

  /**
   * The mic key: a clip from the room/Bluetooth microphone (docs/launcher.md, "Room microphone"), the key again to stop
   * early. Without a transcription key, or when no microphone is connected, manual presses fall back to the TV keyboard.
   */
  const listen = async (auto = false) => {
    if (!mayListen(prefsRef.current, auto, VOICE_KEYS.listen)) return auto ? undefined : openAsk();
    if (recording.current) return recording.current.stop();
    if (opening.current) return;
    if (auto && keyboardOnly.current) return;
    let rec: Recording;
    opening.current = true;
    try {
      rec = await record(onWave);
      keyboardOnly.current = false;
    } catch {
      opening.current = false;
      keyboardOnly.current = true;
      return auto ? undefined : openAsk();
    }
    opening.current = false;
    // Focus left the assistant while the microphone was opening: nothing to listen for.
    const stillListening =
      (viewRef.current === "home" && (focusRef.current.area === "ask" || focusRef.current.area === "chat")) ||
      extAssistantRef.current !== null;
    if (auto && !stillListening) return rec.cancel();
    recording.current = rec;
    setListening(true);
    const clip = await rec.done;
    recording.current = null;
    setListening(false);
    setHearing(false);
    if (!clip) return rec.cancelled ? undefined : flash(`Couldn't hear anything on ${rec.name.match(/\(([^)]+)\)$/)?.[1] ?? "the microphone"}`);
    setTranscribing(true);
    setAsking(true);
    let words = "";
    try {
      words = await transcribeOnTv(clip);
    } catch (e) {
      const reason = e instanceof VoiceError ? e.reason : "failed";
      if (reason === "no-assistant") {
        flash("No assistant connected: check the API key");
      } else {
        flash(reason === "no-speech" ? "Couldn't hear anything" : "Couldn't reach the assistant");
      }
    } finally {
      setTranscribing(false);
      setAsking(false);
    }
    if (words) await send(words, true);
  };

  /** The words in a clip, straight from the TV: Groq's Whisper first when there is a key, Gemini after it. */
  const transcribeOnTv = async (clip: Uint8Array<ArrayBuffer>) => {
    let words: string | null = null;
    let refused = false;
    if (GROQ_KEY) {
      try {
        words = await transcribeGroq(clip, GROQ_KEY);
      } catch (e) {
        if (!(e instanceof AssistantUnavailable)) throw new VoiceError("failed");
        refused = true;
      }
    }
    if (words === null && GEMINI_KEY) {
      try {
        words = await transcribeGemini(clip, "audio/wav", GEMINI_KEY, fetch, true);
        refused = false;
      } catch (e) {
        throw new VoiceError(e instanceof AssistantUnavailable ? "no-assistant" : "failed");
      }
    }
    if (words === null) throw new VoiceError(refused ? "no-assistant" : "failed");
    if (!words) throw new VoiceError("no-speech");
    return words;
  };

  const toggleSpeech = () => {
    if (!VOICE_KEYS.speak) return flash("Spoken replies need NEST_GEMINI_API_KEY in this build");
    const next = !speakReplies;
    // A setting now (Settings › Home screen); saving also keeps the old nest.speak key in step.
    saveHome({ spokenReplies: next });
    flash(next ? "🔊 Spoken replies on" : "🔇 Spoken replies off");
  };

  /** The TV keyboard, whose microphone key dictates; OK sends the prompt. */
  const openAsk = () => {
    setListening(true);
    const opened = getTvInputBridge().open("", {
      onCommit: (val) => {
        setListening(false);
        if (val.trim()) void send(val.trim());
      },
      onCancel: () => setListening(false),
    });
    if (!opened) {
      setListening(false);
      flash(SERVER_URL ? `No TV keyboard here: ask from your phone at ${SERVER_URL}/companion` : "No TV keyboard here");
    } else if (VOICE_KEYS.listen) {
      flash("🎤 Listening");
    }
  };

  /** Red and the Picture button: flips the TV between its two favourite picture modes through SmartThings. */
  const togglePicture = () => {
    togglePictureMode(devices, scenes).then(
      (mode) => {
        setTvPicture(readTvPicture() ?? mode);
        flash(`Picture mode: ${mode}`);
        pollHomeSoon();
      },
      (e) => flash(e instanceof NestError ? e.message : "Couldn't reach the TV's picture mode"),
    );
  };

  /** The Sound button: the sound system on or off; the icon flips at once and SmartThings confirms a moment later. */
  const toggleSoundButton = () => {
    const sound = devices.find((d) => d.kind === "audio");
    toggleSound(devices, soundSet ?? sound?.on).then(
      (on) => {
        setSoundSet(on);
        clearTimeout(soundTimer.current);
        soundTimer.current = setTimeout(() => setSoundSet(null), 8000);
        flash(on ? "🔊 Sound system on" : "🔇 Sound system off");
        pollHomeSoon();
      },
      (e) => flash(e instanceof NestError ? e.message : "Couldn't reach the sound system"),
    );
  };

  const nextScene = () => {
    const [id, label] = SCENES[scene.current];
    scene.current = (scene.current + 1) % SCENES.length;
    if (!SERVER_URL) {
      return void runLights({ scene: id }, devices, scenes).then(
        () => flash(label),
        (e) => flash(e instanceof NestError ? e.message : "Couldn't reach the lights"),
      );
    }
    setScene(SERVER_URL, id).then(
      () => flash(label),
      () => flash("Couldn't reach the lights"),
    );
  };

  const refreshApps = () =>
    listApps().then(
      (raw) => {
        setApps(visibleApps(raw, { pins: PINS, hide: HIDE, self: ownId() }));
        (globalThis as { __sectv?: Record<string, unknown> }).__sectv = {
          ...(globalThis as { __sectv?: Record<string, unknown> }).__sectv,
          rawApps: raw,
          launch: launchApp,
        };
      },
      (e) => setError(String((e as Error)?.message ?? e)),
    );

  /** Continue Watching from the Nuvio profile on this TV (every app's progress, and other devices'). */
  const refreshCloud = async () => {
    if (!cloudEnabled || !cloud.session.signedIn()) {
      setCollectionCards([]);
      setMyList([]);
      return setContinueItems([]);
    }
    // The collections and My List come on their own: a failed pull keeps what is shown.
    const owner = collectionOwner();
    if (owner) {
      void pullLibrary(cloud, cloud.session.profile()).then(
        (list) => {
          saveMylist(storage, owner, list);
          setMyList(collectionOwner() === owner ? list : []);
        },
        () => {},
      );
      void pullCollections(cloud, cloud.session.profile()).then(
        (got) => {
          if (!got) return;
          const cards = toCards(got.collections);
          saveCards(storage, owner, cards);
          setCollectionCards(collectionOwner() === owner ? cards : []);
        },
        () => {},
      );
    }
    try {
      const items = toItems(await pullProgress(cloud, cloud.session.profile())).slice(0, 20);
      setContinueItems((await withMeta(items, { get: readJson, set: writeJson })) as UnifiedResumeEntry[]);
    } catch {
      // Offline: keep what is shown.
    }
  };

  /** Takes a title off Continue watching everywhere it is kept: this TV, the Nuvio profile, the home server. */
  const forgetProgress = async (kind: CatalogKind, id: string) => {
    removeResume(id);
    try {
      if (cloudEnabled && cloud.session.signedIn()) {
        const profile = cloud.session.profile();
        const rows = (await pullProgress(cloud, profile)).filter((r) => r.content_id === id);
        await deleteProgress(cloud, profile, rows.map((r) => progressKey(r.content_id, r.season, r.episode)));
      } else if (SERVER_URL) {
        const got = (await (await fetch(`${SERVER_URL}/resume/${kind}`)).json()) as { items?: { title: { id: string } }[] };
        await fetch(`${SERVER_URL}/resume/${kind}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify((got.items ?? []).filter((e) => e.title.id !== id)),
        });
      }
    } catch {
      flash("Couldn't remove it everywhere; it may come back");
    }
  };

  const refreshServer = async () => {
    if (cloudEnabled) void refreshCloud();
    if (!SERVER_URL) return;
    try {
      const res = await fetch(`${SERVER_URL}/resume`);
      if (!res.ok) throw new Error(String(res.status));
      const { items = [] } = (await res.json()) as { items?: UnifiedResumeEntry[] };
      if (!cloudEnabled) setContinueItems(items);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
      return;
    }
    fetchReminders(SERVER_URL).then(applyReminders, () => {
      // the rest of the server answered; reminders stay as they were
    });
  };

  /** The profile on this TV, for the avatar; a fresh account shows as "Main". */
  const refreshMe = async () => {
    if (!cloudEnabled || !cloud.session.signedIn()) return setMe(null);
    try {
      const [list, images] = await Promise.all([listProfiles(cloud), avatarCatalog(cloud)]);
      const p = list.find((x) => x.index === cloud.session.profile()) ?? list[0];
      setMe({ name: p.name, color: p.color, img: avatarImage(p, images) });
    } catch {
      setMe((m) => m ?? { name: "Nuvio" });
    }
  };

  const picked = (p: Profile) => {
    cloud.session.setProfile(p.index);
    void refreshCloud();
    setView("home");
    setFocus({ area: "header", i: HEADER_PROFILE });
    void refreshMe();
    flash(`Watching as ${p.name}`);
  };

  useEffect(() => {
    void refreshMe();
    void refreshApps();
    void refreshServer();
    // The remote changes the picture mode without Secretary knowing: the TV is read again when Secretary comes back to
    // the screen or gets the window back (the TV's own menu took it), and with the clock.
    const readPicture = () => setTvPicture(readTvPicture());
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      void refreshServer();
      readPicture();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", readPicture);
    const t = setInterval(() => {
      setTime(clock());
      if (document.visibilityState !== "hidden") readPicture();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", readPicture);
      clearInterval(t);
    };
  }, []);

  // The wallpaper and its frost are drawn once per theme; a poster's colour is a crossfaded layer over them (MoodTint), never a redraw.
  useEffect(() => onLightFx(setFx), []);
  const moodOn = effective(fx).mood;
  const shownMood = moodOn ? mood : null;
  // At night the focus rings and fills (the picked card's ring too) take the poster's colour; in daylight, or with Poster colour off, the theme accent.
  useFocusRing(theme === "day" ? null : shownMood, ".nest-col-ring.is-on");
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () => {
        void backdropFor(TINTS.orange, theme, null, "none").then(
          (b) => live && setBackdrop(b),
          (e) => console.warn("[nest] backdrop failed", e),
        );
      },
      backdrop ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [theme]);

  // Due reminders kept on the TV: one timer to the next upcoming `dueAt`, deferred while AVPlay owns the video plane.
  useEffect(() => {
    if (!prefs.reminders) return;
    const checkDue = () => {
      if (!prefsRef.current.reminders || document.visibilityState === "hidden") return;
      if (document.documentElement.classList.contains("avplay")) return;
      const fired = localRem.fireDue();
      if (!fired.length) return;
      setLocalItems(localRem.list());
      const line = `⏰ Reminder: ${fired.map((r) => r.text).join(" · ")}`;
      flash(line, REMINDER_TOAST_MS);
      const at = Date.now();
      setAlerts((prev) => [...fired.map((r) => ({ text: `⏰ ${r.text}`, at })), ...prev].slice(0, MAX_RECENT));
    };
    checkDue();
    const nextAt = localRem.nextDueAt();
    const timer = nextAt !== null ? setTimeout(checkDue, Math.max(0, Math.min(nextAt - Date.now(), 60 * 60_000))) : undefined;
    const onWake = () => {
      if (document.visibilityState !== "hidden") checkDue();
    };
    document.addEventListener("visibilitychange", onWake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [localItems, prefs.reminders, view]);

  // Weather straight from the TV (the SmartThings home, else the build's place); the server's only as a last resort.
  useEffect(() => {
    const get = async () => {
      const w =
        (await refreshWeather({
          store: storage,
          locations: homeConfigured() ? () => home.locations() : undefined,
          env: WEATHER_ENV,
        }).catch(() => null)) ?? (SERVER_URL ? await fetchWeather(SERVER_URL) : null);
      if (w) setWeather(w);
    };
    void get();
    const t = setInterval(get, WEATHER_POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Genre rows, once a day from the catalogs.
  useEffect(() => {
    void refreshDiscover(storage, (kind, genre) => discoverCatalog(kind, genre)).then((d) => Object.keys(d).length && setDiscover(d));
  }, []);

  // What is popular on YouTube, once an hour (a pull is good for that long); no key, no pull.
  useEffect(() => {
    if (!YOUTUBE_API_KEY) return;
    const region = regionOf(typeof navigator === "undefined" ? undefined : navigator.language);
    const get = () => void refreshVideos(storage, YOUTUBE_API_KEY, region).then((v) => v.length && setYoutube(v));
    get();
    const t = setInterval(get, 60 * 60_000);
    return () => clearInterval(t);
  }, []);

  // SmartThings straight from the TV (docs/smartthings.md): the devices' status every 15 s while Nest is on screen,
  // with a toast for what changed (the phone came home, the vacuum finished), and the scenes once.
  const lastDevices = useRef<StDevice[] | null>(null);
  const homeTimer = useRef<ReturnType<typeof setTimeout>>();
  const homeSignInNoted = useRef(false);
  const scenesLoaded = useRef(false);
  const pollHome = () => {
    if (!homeConfigured() || document.visibilityState === "hidden") return;
    home.devices().then(
      (next) => {
        if (lastDevices.current) {
          const news = alertsShown(prefsRef.current, homeAlerts(lastDevices.current, next));
          for (const a of news) flash(a.text);
          if (news.length) setAlerts((prev) => [...news.map((a) => ({ text: a.text, at: Date.now() })), ...prev].slice(0, MAX_RECENT));
        }
        // The first status read of this run (Nest just opened): the ripple down the side lights.
        if (lastDevices.current === null) {
          // With the splash on, the lights swell warm with the bird; otherwise the open ripple, as before.
          (effective(lightFx()).splash ? playSplashRipple(next) : playOpenRipple(next)).catch((e) => console.warn("[nest] open ripple", e));
        }
        noteStatus(next);
        lastDevices.current = next;
        setDevices(next);
        // Scenes once per run, after the first poll that works (the sign-in may come after Nest started).
        if (!scenesLoaded.current) {
          scenesLoaded.current = true;
          home.scenes().then(setScenes, (e) => {
            scenesLoaded.current = false;
            console.warn("[nest] SmartThings scenes", e);
          });
        }
      },
      (e: unknown) => {
        console.warn("[nest] SmartThings devices", e);
        // The refresh token lapsed (29 days unused) or was revoked: say so once, not every 15 s.
        if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 400) {
          if (!homeSignInNoted.current) flash("SmartThings needs signing in again (smartthings.mjs authorize)");
          homeSignInNoted.current = true;
        }
      },
    );
  };
  /** After a command: SmartThings takes a moment to report the new state. */
  const pollHomeSoon = () => {
    clearTimeout(homeTimer.current);
    homeTimer.current = setTimeout(pollHome, 1500);
  };
  useEffect(() => {
    if ((view !== "home" && view !== "lights") || !homeConfigured()) return;
    pollHome();
    const t = setInterval(pollHome, HOME_POLL_MS);
    return () => clearInterval(t);
  }, [view]);

  // The lights' ripples (docs/smartthings.md): a quick one before another app opens, and the slow one when Nest comes
  // back to the screen after a while away (the first one, at start, is in pollHome).
  useEffect(() => {
    onBeforeLaunch(rippleBeforeLaunch);
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === "hidden") return void (hiddenAt = Date.now());
      mediaReleased();
      if (hiddenAt && Date.now() - hiddenAt > RIPPLE_AWAY_MS) playOpenRipple().catch((e) => console.warn("[nest] open ripple", e));
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      onBeforeLaunch(null);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Recent: the assistant's latest answers and the home's latest news, newest first, then Continue Watching.
  // The same prompt asked again shows once, as its newest answer.
  const recentTurns = talk.turns
    .filter((t) => t.action !== "error")
    .reverse()
    .filter((t, k, all) => all.findIndex((u) => u.prompt.toLowerCase() === t.prompt.toLowerCase()) === k)
    .slice(0, MAX_RECENT);
  const latest: RecentCard[] = [
    ...recentTurns.map((t) => ({
      kind: "answer" as const,
      key: `t${t.id}`,
      at: t.at,
      action: t.action,
      prompt: t.prompt,
      reply: t.reply,
    })),
    ...alerts.map((a) => ({ kind: "alert" as const, key: `a${a.at}:${a.text}`, at: a.at, text: a.text })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RECENT);
  // A new card moves the whole row (67-83 ms frames on the TV), so the row catches up once Nest is idle again and the
  // answer rises in the Ask panel on its own (docs/performance.md, "Voice").
  const [recent, setRecent] = useState<RecentCard[]>(latest);
  const latestKey = latest.map((c) => c.key).join();
  const idle = !listening && !asking && !answered;
  useEffect(() => {
    if (idle) setRecent(latest);
  }, [latestKey, idle]);

  // Trending titles for the cards with nothing in progress: once a day, from the TV.
  useEffect(() => {
    try {
      const c = JSON.parse(storage.getItem(TRENDING_KEY) ?? "null") as { at: number } | null;
      if (c && Date.now() - c.at < TRENDING_TTL_MS) return;
    } catch {
      // fetch again
    }
    void Promise.all((["movie", "series", "anime"] as const).map((k) => discoverCatalog(k, undefined).catch(() => []))).then(
      ([movie, series, anime]) => {
        if (!movie.length && !series.length && !anime.length) return;
        const v = { movie, series, anime };
        setTrending(v);
        storage.setItem(TRENDING_KEY, JSON.stringify({ at: Date.now(), v }));
      },
    );
  }, []);

  // The row: one card per app, each laid out for what it holds (docs/launcher.md, "Home screen").
  const failed = (name: string) => () => flash(`Couldn't open ${name}`);
  // Resuming opens the title's page inside Secretary and plays it there.
  const playTitle = (type: CatalogKind, title: SlimTitle, autoPlay = true) => browse({ type, open: { type, title, autoPlay } });
  // Settings › Playback › Resume from Continue watching: play at once, or open the title's page first.
  const resume = (e: UnifiedResumeEntry) => playTitle(e.type, e.title, loadSettings().playback.resumeAtOnce);
  const openHit = (r: SearchResult) => browse({ type: r.type, open: { type: r.type, title: r.title } });
  /** "Recommend me" on a media card's end bar: taste-aware picks of its kind become a row on the card (recommend.ts). */
  const askRecommend = (key: string, kind: CatalogKind, shown: ReadonlySet<string>) => {
    const n = recs[key]?.n ?? 0;
    const byId = new Map<string, string[]>();
    for (const d of DISCOVER) {
      for (const r of discover[d.key] ?? []) {
        const list = byId.get(r.title.id);
        if (list) {
          if (!list.includes(d.genre)) list.push(d.genre);
        } else {
          byId.set(r.title.id, [d.genre]);
        }
      }
    }
    const taste = {
      watching: continueItems.map((e) => ({
        id: e.title.id,
        name: e.title.name,
        kind: e.type,
        genres: byId.get(e.title.id),
        description: e.title.description,
      })),
      saved: [...myList]
        .sort((a, b) => b.addedAt - a.addedAt)
        .map((l) => ({
          id: l.title.id,
          name: l.title.name,
          kind: l.type,
          genres: byId.get(l.title.id),
          description: l.title.description,
        })),
    };
    const excluded = new Set([...shown, ...dismissed, ...loadWatchedIds()]);
    setRecs((r) => ({ ...r, [key]: { state: { status: "loading" }, n } }));
    void recommend(kind, n, excluded, (intent) => discoverCatalog(intent.kind, intent.genre), taste).then((state) => {
      setRecs((r) => ({ ...r, [key]: { state, n: n + 1 } }));
      if (state.status === "ready") setRecFocus(key);
    });
  };
  /** Shows the catalog inside Secretary, on its home or on what `entry` names. */
  const browse = (entry: CatalogEntry) => {
    setExtAssistant(null);
    setCatalog(entry);
    setView("catalog");
  };
  // The catalog runs the cinema scenes from the grant it finds in `sectv.home` (catalog-kit lib/home.ts): Secretary writes
  // it as the catalog opens and keeps it fresh while it is open (a personal token lasts an hour, and the restore scene
  // runs when the film ends).
  useEffect(() => {
    if (view !== "catalog") return;
    const put = () => void homeGrant().then((g) => g && saveHomeGrant(g), () => {});
    put();
    const t = setInterval(put, 20 * 60_000);
    return () => clearInterval(t);
  }, [view]);
  /** Back from the search: to the catalog screen it was opened from (as first opened, never playing), else home. */
  const closeSearch = () => {
    const from = searchFrom;
    setSearchFrom(null);
    if (from) browse({ ...from, open: from.open && { ...from.open, autoPlay: false, room: undefined } });
    else setView("home");
  };
  /** The catalog's search keys and buttons (and a title page's header) open Secretary's one search in its place. */
  const searchFromCatalog = (q = "") => {
    const from = catalog;
    setCatalog(null);
    openSearch(q);
    setSearchFrom(from);
  };
  /** The catalog screen Settings was opened from (the header's settings button), to come back to with Back. */
  const settingsFrom = useRef<CatalogEntry | null>(null);
  const leaveCatalog = () => {
    setExtAssistant(null);
    const back = settingsFrom.current;
    settingsFrom.current = null;
    if (back && catalog?.hub) return browse({ ...back, open: back.open && { ...back.open, autoPlay: false, room: undefined } });
    setCatalog(null);
    setView("home");
    // Watching in the catalog moved progress, My List and collections: Nest's cards read them again.
    void refreshCloud();
  };

  const openExternalAssistant = (how: "voice" | "dock" | "chat") => {
    if (how === "voice") {
      setExtAssistant("chat");
      setConvFocus({ zone: "controls", i: 0 });
      void listen(false);
    } else if (how === "chat") {
      setExtAssistant("chat");
      setConvFocus({ zone: "controls", i: 0 });
    } else {
      setExtDockIdx(0);
      setExtAssistant("dock");
    }
  };


  const pictureMode = pictureNow(devices, tvPicture);

  const soundOn = soundSet ?? devices.find((d) => d.kind === "audio")?.on;
  const openReminders = reminders.filter((r) => !r.completed).length;
  const headerPerson = { name: me?.name ?? "Secretary", color: me?.color, img: me?.img };
  const embeddedHost: EmbeddedHost = {
    // One Nuvio client for the page: the catalog uses Nest's, so there is one session in memory and one refresh.
    cloud,
    // The catalog home draws Secretary's header too, with the same person top left.
    person: headerPerson,
    onExit: leaveCatalog,
    onSearch: searchFromCatalog,
    assistantOpen: extAssistant !== null,
    onAssistant: openExternalAssistant,
    onContext: setCatalogCtx,
    // Settings › SmartThings: the effects, routines and lights the Mood panel's moods are built from.
    // Settings › Accounts: the watch trackers (Simkl).
    settingsTabs: [
      ...(homeConfigured()
        ? [smartThingsTab({ devices, scenes, rooms: stRooms, command: (id, c) => home.command(id, c), onChange: () => pollHomeSoon() })]
        : []),
      accountsTab(),
    ],
    voice: VOICE_KEYS,
    // Settings › Apps lists what the Apps card could show; the TV's own settings have their place in the profile menu.
    apps: appsOnCard(apps, [], OWN_PLACES).map((a) => ({
      id: a.id,
      name: a.name.replace(/^Secretary\s+/, ""),
      note: a.id === YOUTUBE_APP_ID ? "Has its own card on the home screen too" : undefined,
    })),
    // Secretary's one header, which the catalog's title pages draw collapsed to the clock (catalog-kit host.ts).
    header: {
      time,
      person: headerPerson,
      buttons: headerButtons(pictureMode, soundOn, openReminders, moodKey),
      press: (at) => {
        const i = at === "person" ? HEADER_PROFILE : HEADER_ORDER[at];
        // Search keeps the title page to come back to with Back.
        if (i === HEADER_SEARCH) return searchFromCatalog();
        // Settings opens in the catalog anew; Back from it comes back to this screen (leaveCatalog).
        if (i === HEADER_SETTINGS && catalog && !catalog.hub) {
          const from = catalog;
          leaveCatalog();
          pressHeader(i);
          settingsFrom.current = from;
          return;
        }
        // Picture and sound act in place; the rest are Secretary's own screens, so the catalog gives the screen back.
        if (i !== HEADER_PICTURE && i !== HEADER_SOUND) leaveCatalog();
        pressHeader(i);
      },
    },
  };
  // The anime rule (catalog-kit lib/animeguard.ts): a title the catalog knows is anime shows only on the Anime card.
  // The ids come from the anime catalogs, and from the Anime card's own picks and genre rows.
  const [animeRev, setAnimeRev] = useState(0);
  useEffect(() => void animeImdbIds().then(() => setAnimeRev((r) => r + 1), () => {}), []);
  const animeIds = useMemo(() => {
    noteAnime([...trending.anime, ...DISCOVER.filter((d) => d.kind === "anime").flatMap((d) => discover[d.key] ?? [])].map((r) => r.title.id));
    return new Set(knownAnime());
  }, [animeRev, trending, discover]);
  const progressOf = (e: UnifiedResumeEntry) => (e.durSec > 0 ? e.posSec / e.durSec : undefined);
  /** A title's card artwork: what the lookup brought, else the cache's (or the catalog's own) art, for the first frame. */
  const artOf = (kind: CatalogKind, t: SlimTitle): TitleArt => arts[`${kind}:${t.id}`] ?? cachedTitleArt(kind, t, "card");
  /** The titles whose artwork is looked up: those the folded cards and Continue watching show. */
  const artWanted: { kind: CatalogKind; title: SlimTitle }[] = [];
  // One entry per title: a show synced from a phone under one id and played here under another is one tile.
  const byKind = (k: CatalogKind) => oneEach(onlyKind(k, continueItems, animeIds), (e) => e.title);
  /** The titles the folded cards already show, so the next card shows others. */
  const onCovers = new Set<string>();
  const columns: RowColumn[] = [];
  /** The artwork behind each column's items, for the glow. */
  const art: ({ src: string; type: CatalogKind } | undefined)[][] = [];
  const push = (col: RowColumn, pics: ({ src: string; type: CatalogKind } | undefined)[] = []) => {
    if (hidden.includes(col.key)) return;
    columns.push(col);
    art.push(pics);
  };
  // The assistant's own card leads the row: OK opens the full chat. The weather and the calendar follow it.
  const brief = briefing(new Date(), me?.name, reminders.filter((r) => !r.completed));
  push({
    kind: "assistant",
    key: "assistant",
    label: "Assistant",
    greeting: brief.greeting,
    lines: brief.lines,
    run: () => {
      setConvFocus({ zone: "controls", i: 0 });
      setFocus({ area: "chat", i: 0 });
    },
  });
  push({
    kind: "weather",
    key: "weather",
    label: "Weather",
    weather,
    // OK opens the forecast across the screen (cards.tsx); inside it there is nothing more to do.
    run: () => undefined,
  });
  push({ kind: "calendar", key: "calendar", label: "Calendar", date: new Date(), run: () => focusReminders(0) });
  if (recent.length) {
    const shown = recent.slice(0, 3);
    push({
      kind: "list",
      key: "recent",
      label: "Recent",
      items: shown.map((c) =>
        c.kind === "alert"
          ? { title: c.text, sub: "Home" }
          : { title: `“${c.prompt}”`, sub: c.reply },
      ),
      run: (i) => openRecent(shown[i]),
    });
  }
  // Cinema, Shows and Anime: what is in progress first, then tonight's picks. The card shows as many as its style
  // holds; OK opens it into its rows, Continue watching first, then the picks (card-rows.ts, cards.tsx).
  for (const m of MEDIA) {
    // What the assistant just recommended takes the card's place until it is left.
    const mine = found?.kind === m.kind ? found : null;
    const going = mine ? [] : byKind(m.kind).slice(0, MEDIA_MAX);
    // Titles without a poster would be blank slots, so a recommendation keeps only those that have one.
    const picks = mine
      ? (mine.items.some((r) => r.title.poster) ? mine.items.filter((r) => r.title.poster) : mine.items).slice(0, MEDIA_MAX)
      : onlyKind(m.kind, trending[m.kind], animeIds).filter((r) => !going.some((e) => e.title.id === r.title.id) && !dismissed.includes(r.title.id)).slice(0, MEDIA_MAX);
    if (!going.length && !picks.length) continue;
    // Under the first row (Down in the opened card): tonight's picks when Continue watching leads, the profile's My List
    // for this kind, its genre rows, then what "Recommend me" brought.
    const tile = (r: SearchResult): MediaItem => ({
      poster: posterUrl(r.title),
      still: backdropUrl(r),
      title: r.title.name,
      sub: r.title.year || undefined,
      rating: r.title.rating || undefined,
      about: r.title.description,
    });
    // On the folded card and Continue watching: the lookup's landscape thumb and logo (Fanart.tv, else the catalog's).
    const styled = (it: MediaItem, kind: CatalogKind, t: SlimTitle): MediaItem => {
      const a = artOf(kind, t);
      // A Fanart.tv thumb has the title's logo painted in: the tile shows it whole, or the textless art under the
      // logo when its shape would crop it (cards.tsx stillArt).
      return { ...it, still: a.thumb, plain: a.plain, stillHasLogo: a.thumbHasLogo, logo: a.logo };
    };
    const goingItems: MediaItem[] = going.map((e) =>
      styled(
        {
          poster: posterUrl(e.title),
          still: backdropUrl(e),
          title: e.title.name,
          // The row is named Continue watching already: a film's line is its year.
          sub: episodeLabel(e.episode) ?? (e.title.year || undefined),
          episode: episodeLabel(e.episode),
          left: timeLeft(e.posSec, e.durSec),
          resume: true,
          progress: progressOf(e),
          rating: e.title.rating || undefined,
          about: e.title.description,
        },
        e.type,
        e.title,
      ),
    );
    // The day's list ranks the picks; the assistant's own picks have no ranking.
    const ranked = mine ? [] : onlyKind(m.kind, trending[m.kind], animeIds);
    const pickItems: MediaItem[] = picks.map((r, k) => {
      const place = ranked.findIndex((t) => t.title.id === r.title.id);
      return {
        ...(k < ART_PER_CARD ? styled(tile(r), r.type, r.title) : tile(r)),
        badge: k === 0 && !going.length && !mine ? m.pickBadge : undefined,
        rank: place >= 0 ? `No. ${place + 1} in ${m.list}` : undefined,
      };
    });
    const pickTarget = (i: number): TileTarget | null =>
      picks[i] ? { type: picks[i].type, title: picks[i].title, resume: false, suggestion: !mine, row: `${m.key}/picks` } : null;
    const listedHere = mylistItems(onlyKind(m.kind, myList, animeIds), MEDIA_MAX * 2).map((l) => ({ type: m.kind, title: l.item.title }));
    const rec = recs[m.key];
    const recHits = rec?.state.status === "ready" ? onlyKind(m.kind, rec.state.items, animeIds) : [];
    const rowsHere: { label: string; hits: SearchResult[] }[] = [
      { label: "My List", hits: listedHere },
      ...DISCOVER.filter((d) => d.kind === m.kind).map((d) => ({ label: d.label, hits: onlyKind(m.kind, discover[d.key] ?? [], animeIds).filter((r) => r.title.poster).slice(0, MEDIA_MAX) })),
      { label: PICKED_ROW, hits: recHits },
    ].filter((r) => r.hits.length);
    const more: MoreRow[] = [
      // With Continue watching first, the picks get a row of their own under it.
      ...(going.length && picks.length
        ? [{ label: "Tonight's picks", items: pickItems, shape: rowLooks[`${m.key}/picks`], run: (i: number) => picks[i] && openHit(picks[i]), target: pickTarget }]
        : []),
      ...rowsHere.map((r) => ({
        label: r.label,
        items: r.hits.map(tile),
        shape: rowLooks[`${m.key}/${r.label}`],
        run: (i: number) => r.hits[i] && openHit(r.hits[i]),
        target: (i: number): TileTarget | null => (r.hits[i] ? { type: r.hits[i].type, title: r.hits[i].title, resume: false, row: `${m.key}/${r.label}` } : null),
      })),
    ];
    const items = going.length ? goingItems : pickItems;
    const style = shownStyle(styleMenu, m.key, styleFor(cardStyles, m.key));
    // Folded, the card shows a few of what is in progress and the picks, moving on each turn (card-covers.ts).
    const coverPool = [...going.map((e, k) => ({ it: goingItems[k], t: e.title })), ...picks.slice(0, ART_PER_CARD).map((r, k) => ({ it: pickItems[k], t: r.title }))];
    const covers = coverPicks(coverPool, collapsedShape(style).count, coverTurn, onCovers, (c) => c.t).map((c) => c.it);
    for (const t of [...going, ...picks].slice(0, ART_PER_CARD + going.length)) artWanted.push({ kind: t.type, title: t.title });
    // Everything the card already shows, so the assistant's picks bring something new.
    const shownIds = new Set([...going.map((e) => e.title.id), ...picks.map((r) => r.title.id), ...rowsHere.flatMap((r) => r.hits.map((h) => h.title.id))]);
    push(
      {
        kind: "media",
        key: m.key,
        name: m.name,
        unit: m.unit,
        label: m.name,
        items,
        small: covers,
        style,
        heading: mine ? "For you" : going.length ? "Continue watching" : "Tonight's picks",
        // Continue watching draws landscape stills unless the viewer picked another look for it.
        shape: rowLooks[going.length ? `${m.key}/continue` : `${m.key}/picks`],
        wide: going.length > 0,
        // Shows and Anime list episodes in Continue watching: the bigger tiles.
        episodes: m.kind !== "movie",
        more,
        note: mine ? { prompt: mine.prompt, reply: mine.reply } : undefined,
        run: (i) => (going.length ? going[i] && resume(going[i]) : picks[i] && openHit(picks[i])),
        recommend: () => askRecommend(m.key, m.kind, shownIds),
        recs: rec?.state,
        seeAll: () => browse({ type: m.kind }),
        target: (i) =>
          going.length
            ? going[i]
              ? { type: going[i].type, title: going[i].title, resume: true, row: `${m.key}/continue` }
              : null
            : pickTarget(i),
      },
      // The opened card's art runs across all its rows (the picks, then My List and the genres), like focus.i does.
      [...items, ...more.flatMap((r) => r.items)].map((it) => ({ src: it.poster, type: m.kind })),
    );
  }
  // Back from the catalog is a new visit to the home: the covers move on.
  const inCatalog = catalog !== null;
  const wasInCatalog = useRef(inCatalog);
  useEffect(() => {
    if (wasInCatalog.current && !inCatalog) setCoverTurn((n) => n + 1);
    wasInCatalog.current = inCatalog;
  }, [inCatalog]);
  // The artwork lookups for the titles on the cards (catalog-kit titleArt: at most 3 at once, cached), applied in one go.
  const artKey = artWanted.map((t) => `${t.kind}:${t.title.id}`).join();
  useEffect(() => {
    const todo = artWanted.filter((t) => !arts[`${t.kind}:${t.title.id}`]);
    if (!todo.length) return;
    let live = true;
    void Promise.all(todo.map((t) => titleArt(t.kind, t.title, "card").then((a) => [`${t.kind}:${t.title.id}`, a] as const))).then((found) => {
      if (live) setArts((was) => ({ ...was, ...Object.fromEntries(found) }));
    });
    return () => {
      live = false;
    };
  }, [artKey]);
  // The YouTube card: what is popular (with a key), or one way into the app; OK opens the video there.
  const shownVideos = youtube.slice(0, CARD_VIDEOS);
  if (shownVideos.length) {
    push({
      kind: "videos",
      key: "youtube",
      label: "YouTube",
      videos: shownVideos.map((v) => ({ title: v.title, channel: v.channel, thumb: v.thumb })),
      run: (i) => void openYoutube(watchUrl(shownVideos[i].id)).catch(failed("YouTube")),
    });
  } else {
    push({
      kind: "list",
      key: "youtube",
      label: "YouTube",
      items: [{ title: "YouTube", sub: "Open the app" }],
      run: () => void openYoutube().catch(failed("YouTube")),
    });
  }
  // Each Nuvio collection is a card like Cinema's (collections.ts): folded, its folders' covers in the style picked for
  // it; opened, the folders as the first row (OK opens that folder's page) and each folder's titles as a row under it.
  // The end bar's "Open collection" opens the folder page at the first folder.
  for (const c of collectionCards) {
    const folderItems: MediaItem[] = c.folders.map((f) => ({ poster: f.cover ?? "", still: f.cover, title: f.title, named: true }));
    const rowsHere = folderRows(c, folderTitles);
    const titleItem = (t: FolderTitle): MediaItem => ({
      poster: posterUrl(t),
      still: t.background,
      title: t.name,
      sub: t.year || undefined,
      rating: t.rating || undefined,
      about: t.description,
    });
    const slim = (t: FolderTitle): SlimTitle => ({ id: t.id, name: t.name, year: t.year ?? "", rating: t.rating ?? "", poster: t.poster, background: t.background, description: t.description });
    const more: MoreRow[] = rowsHere.map(({ folder, titles }) => ({
      label: folder.title,
      items: titles.map(titleItem),
      shape: rowLooks[folderRowKey(c, folder.id)],
      run: (i: number) => titles[i] && openHit({ type: titles[i].kind, title: slim(titles[i]) }),
      target: (i: number): TileTarget | null => (titles[i] ? { type: titles[i].kind, title: slim(titles[i]), resume: false, row: folderRowKey(c, folder.id) } : null),
    }));
    const openFolder = (k: number) => c.folders[k] && browse({ type: c.folders[k].kind, folder: { collectionId: c.id, folderId: c.folders[k].id } });
    push(
      {
        kind: "media",
        key: c.key,
        name: c.title,
        unit: "titles",
        label: c.title,
        items: folderItems,
        style: shownStyle(styleMenu, c.key, cardStyles[c.key] ?? collectionStyle(c.folders)),
        heading: "Folders",
        shape: rowLooks[foldersRowKey(c)] ?? foldersShape(c.folders),
        more,
        run: openFolder,
        seeAll: () => openFolder(0),
        allLabel: "Open collection",
        endLine: collectionLine(c),
      },
      [...c.folders.map((f) => (f.cover ? { src: f.cover, type: f.kind } : undefined)), ...rowsHere.flatMap((r) => r.titles.map((t) => ({ src: posterUrl(t), type: t.kind })))],
    );
  }
  // The same count as the Lights panel's (light-count.ts).
  const lights = lightCount(devices);
  push({
    kind: "home",
    key: "home",
    label: "Home",
    title: lights.total ? lightsOnLabel(lights) : "Lights",
    sub: lux !== null ? `${Math.round(lux)} lux in the room` : homeConfigured() ? `${lights.total} lights` : SERVER_URL ? "Through Secretary Server" : "SmartThings not set up",
    // With SmartThings on the TV, the card's buttons are the Mood panel's four moods (moods.ts); through the server,
    // its scenes as before.
    actions: homeConfigured() ? mainMoods(scenes).map((m) => ({ icon: m.icon, label: m.label })) : SCENES.map(([id]) => CARD_ACTION[id]),
    run: (i) => {
      if (!homeConfigured()) return runScene(SCENES[i][0], SCENES[i][1]);
      const m = mainMoods(scenes)[i];
      applyMood(m).then(
        () => flash(`${m.label} is on`),
        (e) => flash(e instanceof NestError ? e.message : "Couldn't reach the lights"),
      );
    },
  });
  const shownReminders = reminders.slice(0, 3);
  if (prefs.reminders) push({
    kind: "list",
    key: "reminders",
    label: "Reminders",
    items: shownReminders.map((r) => {
      const [, color] = SOURCE_LABEL[r.source] ?? SOURCE_LABEL.local;
      return { title: r.text, sub: reminderLine(r, reminders), meta: r.completed ? "✓" : r.due ? `⏰ ${r.due}` : undefined, color: r.completed ? "#6d6c68" : color, done: r.completed };
    }),
    add: "+ Add reminder",
    run: (i) => (i < shownReminders.length ? toggleReminderAt(shownReminders[i]) : newReminder()),
  });
  const otherApps = appsOnCard(apps, prefs.hiddenApps, OWN_PLACES).slice(0, 6);
  if (otherApps.length) {
    push({
      kind: "apps",
      key: "apps",
      label: "Apps",
      apps: otherApps.map((a) => ({ icon: appIcon(a), label: a.name.replace(/^Secretary\s+/, "") })),
      run: (i) => void openApp(otherApps[i].id).catch(failed(otherApps[i].name)),
    });
  }
  // The last card puts back what was taken off the home row.
  const gone = removed(hidden, [...collectionCards.map((c) => ({ key: c.key, label: c.title }))]);
  push({
    kind: "list",
    key: "add",
    label: "Add to home",
    items: gone.map((e) => ({ title: e.label, sub: "Put it back on the home screen" })),
    add: gone.length ? undefined : "Everything is on the home screen",
    run: (i) => (i < gone.length ? restoreCard(gone[i].key) : flash("Everything is on the home screen")),
  });
  // The viewer's order (card-order.ts): the Assistant stays first and "Add to home" last; the art follows its column.
  {
    const was = columns.map((c, i) => ({ key: c.key, c, a: art[i] }));
    applyOrder(was, order).forEach((w, n) => {
      columns[n] = w.c;
      art[n] = w.a;
    });
  }
  const colAt = focus.area === "row" ? (focus.col ?? 0) : -1;
  const homeColIdx = Math.min(lastHomeCol.current, Math.max(0, columns.length - 1));
  mediaFocused.current = columns[colAt]?.kind === "media";


  // A collection card picked or opened: its folders' titles load (once a visit) for the rows under its folders, through
  // catalog-kit lib/folder-titles.ts, in the catalog chunk, imported only now so the addon client stays out of the
  // first bundle.
  const pickedCollection = colAt >= 0 && isCollectionKey(columns[colAt]?.key ?? "") ? columns[colAt].key : null;
  const foldersAsked = useRef(new Set<string>());
  useEffect(() => {
    const c = collectionCards.find((k) => k.key === pickedCollection);
    const owner = collectionOwner();
    if (!c || !owner) return;
    const todo = c.folders.filter((f) => f.sources?.length && !foldersAsked.current.has(folderTitlesKey(c.id, f.id)));
    if (!todo.length) return;
    for (const f of todo) foldersAsked.current.add(folderTitlesKey(c.id, f.id));
    void import("@secretary/catalog-kit").then(async ({ folderTitles: load }) => {
      const got = await Promise.all(
        todo.map(async (f) => {
          const list = await load(f.sources ?? [], f.kind, FOLDER_TITLES).catch(() => []);
          const titles: FolderTitle[] = list.map((t) => ({
            id: t.id,
            name: t.name,
            ...(t.poster ? { poster: t.poster } : {}),
            ...(t.background ? { background: t.background } : {}),
            ...(t.year ? { year: t.year } : {}),
            ...(t.rating ? { rating: t.rating } : {}),
            ...(t.description ? { description: t.description.slice(0, 280) } : {}),
            kind: t.catalogType ?? f.kind,
          }));
          return [folderTitlesKey(c.id, f.id), titles] as const;
        }),
      );
      if (collectionOwner() !== owner) return;
      setFolderTitles((was) => {
        // Moved to the end, so the cache keeps the folders seen last (collections.ts saveFolderTitles).
        const next = { ...was };
        // A folder that failed to load keeps its last titles.
        for (const [k, t] of got.filter(([, t]) => t.length)) {
          delete next[k];
          next[k] = t;
        }
        saveFolderTitles(storage, owner, next);
        return next;
      });
    }, () => {});
  }, [pickedCollection, collectionCards]);
  let homeFocusedTile: TileTarget | null = null;
  if (columns[homeColIdx]?.kind === "media") {
    homeFocusedTile = targetAt(columns[homeColIdx], focus.area === "row" && focus.inside ? Math.max(0, focus.i) : 0);
    if (colAt >= 0 && homeFocusedTile) lastFocusedTarget.current = { type: homeFocusedTile.type, title: homeFocusedTile.title };
  }
  // On a card itself (not yet inside it) the background takes the colour of its first poster, so moving between cards tints too.
  const rowArt = colAt >= 0 ? (focus.inside && focus.i >= 0 ? art[colAt]?.[focus.i] : art[colAt]?.[0]) : undefined;
  const focusedArt: { src: string; type: CatalogKind } | null = rowArt ? rowArt : null;
  // A card without a poster (Assistant, Weather, Calendar...) has its own warm colour, stable for its key.
  const cardKey = colAt >= 0 ? columns[colAt]?.key : undefined;
  useEffect(() => {
    if (!focusedArt && !cardKey) {
      // Focus left the cards: the side lights go back, but not for a passing visit to the header.
      const t = setTimeout(() => syncMood(null), 3000);
      return () => clearTimeout(t);
    }
    let live = true;
    const t = setTimeout(() => {
      const fxNow = effective(fx);
      const apply = (p: Palette | null) => {
        if (!live) return;
        // A grey poster, or art that cannot be read, falls back to the card's own colour.
        const shown = p ?? (cardKey ? homeMood(cardKey) : null);
        if (fxNow.mood) setMood(shown);
        if (fxNow.sync) syncMood(shown ? shown.accent : null);
        if (!focusedArt && shown) void glowImage(shown.accent.join(",")).then((src) => live && setGlow(src));
      };
      if (!focusedArt) return apply(null);
      // The art is read straight from its host first (it allows it); the home server's /art is the way when a host does not.
      const direct = focusedArt.src;
      const via = SERVER_URL ? artProxy(SERVER_URL, direct) : null;
      void artColour(direct)
        .then((rgb) => rgb ?? (via ? artColour(via) : null))
        .then((rgb) => glowImage(rgb ?? KIND_TINT[focusedArt.type]))
        .then((src) => live && setGlow(src));
      if (fxNow.mood || fxNow.sync) {
        void artPalette(direct)
          .then((p) => p ?? (via ? artPalette(via) : null))
          .then(apply);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [focusedArt?.src, cardKey, fx]);
  // The side lights go back the moment the sync (or every effect) is switched off.
  useEffect(() => {
    if (!effective(fx).sync) syncMood(null);
  }, [fx]);

  // Debug helpers for the CDP scripts.
  useEffect(() => {
    const g = globalThis as { __sectv?: Record<string, unknown> };
    g.__sectv = {
      ...g.__sectv,
      continueItems,
      reminders,
      assistant: talk,
      audio: audioRoute,
      // spoken: the reply is read aloud as after a voice prompt (Gemini speech, envelope, playback).
      ask: (q: string, spoken = false) => send(q, spoken),
      // Drives the wave like a voice would, for cdp.mjs walks with nobody speaking (null hands it back).
      wave: setWaveLevel,
      // A reply's WAV through the real playback (envelope, speakerphone, wave), when the speech model is out of quota.
      play: (wav: Uint8Array) => play(wav, onWave),
      theme: (pref: ThemePref) => pickTheme(pref),
      openSearch: (q = "") => openSearch(q),
    };
  }, [continueItems, reminders, talk, audioRoute]);

  // Build the active page context so the bottom Assistant Dock and Conversation suggestions adapt to the page/title.
  const pageContext: AssistantPageContext = useMemo(() => {
    const common = { hasContinue: continueItems.length > 0, lightsOn: lights.on, lightsTotal: lights.total, openReminders, userName: me?.name };
    if (view === "lights") return { ...common, screen: "lights" };
    if (view === "catalog" && catalogCtx) {
      const s = catalogCtx.screen;
      const t = catalogCtx.title;
      return {
        ...common,
        screen: s === "detail" || s === "folder" || s === "timeline" ? s : "catalog-home",
        kind: catalogCtx.kind,
        focused: t ? { kind: t.kind, title: t, resume: t.resume, episodeLabel: t.episodeLabel } : null,
        folderTitle: catalogCtx.folderTitle,
        sagaTitle: catalogCtx.sagaTitle,
      };
    }
    return {
      ...common,
      screen: "home",
      card: columns[homeColIdx]?.key,
      focused: homeFocusedTile ? { kind: homeFocusedTile.type, title: homeFocusedTile.title, resume: homeFocusedTile.resume } : null,
    };
  }, [view, catalogCtx, columns[homeColIdx]?.key, homeFocusedTile?.title.id, homeFocusedTile?.resume, continueItems.length, lights.on, lights.total, openReminders, me?.name]);

  const lastAnswer = talk.turns[talk.turns.length - 1];
  const tailored = useMemo(() => tailorAssistant(pageContext, lastAnswer), [pageContext, lastAnswer]);

  // The strip's moods: the four and the routines shown, as the viewer set them (read while it is open).
  const stripMoods = useMemo(() => (stripOpen ? allMoods(scenes) : []), [stripOpen, scenes]);
  const menuItems = [
    cloudEnabled ? (me ? "Switch profile" : "Sign in to Nuvio") : "Profiles",
    "TV settings",
    THEME_LABEL[themePref],
    ...(VOICE_KEYS.speak ? [speakReplies ? "🔊 Spoken replies: on" : "🔇 Spoken replies: off"] : []),
  ];
  // A media card is open while the remote is inside it: its row of titles takes the width.
  const openCol = focus.area === "row" && focus.inside && expands(columns[focus.col ?? 0]) ? (focus.col ?? 0) : -1;
  const dockCount = dockItemCount(tailored.dockChips.length);
  const navKey = `${openCol}:${dockCount}:${rowLayout(columns, openCol).nav.map((c) => `${c.count}/${c.across}`).join()}`;
  const layout: Layout = useMemo(
    () => ({
      ask: dockCount,
      cols: rowLayout(columns, openCol).nav,
      menu: menuOpen ? menuItems.length : 0,
      moods: stripOpen ? stripMoods.length + 1 : 0,
      header: HEADER_ITEMS,
    }),
    [navKey, menuOpen, stripOpen, stripMoods.length],
  );

  const inHomeDock = view === "home" && focus.area === "ask";
  const inHomeChat = view === "home" && focus.area === "chat";
  const dockFocused = inHomeDock || extAssistant === "dock";
  const chatOpen = inHomeChat || extAssistant === "chat";
  const activeDockIndex = inHomeDock ? focus.i : extDockIdx;

  // Focusing the assistant (Speak on the dock, or opening Conversation) starts listening when `listenOnFocus` is on.
  const autoListenActive = (dockFocused && activeDockIndex === 0) || (chatOpen && convFocus.zone === "controls" && convFocus.i === 0);
  useEffect(() => {
    if (!autoListenActive) return;
    const t = setTimeout(() => {
      if (mayListen(prefs, true, VOICE_KEYS.listen) && !recording.current && !keyboardOnly.current) void listen(true);
    }, 180);
    return () => {
      clearTimeout(t);
      if (recording.current && !recording.current.heard) recording.current.cancel();
    };
  }, [dockFocused, chatOpen, prefs.listenOnFocus]);

  // Keep conversation focus valid as turns and chips update.
  const turnsWithResults = useMemo(() => talk.turns.filter((t) => (t.results?.length ?? 0) > 0), [talk]);
  const convShape: ConversationShape = useMemo(
    () => ({
      resultRows: turnsWithResults.map((t) => Math.min(MAX_INLINE_RESULTS, t.results!.length)),
      chips: tailored.chatChips.length,
      controls: VOICE_KEYS.speak ? 3 : 2,
    }),
    [turnsWithResults, tailored.chatChips.length],
  );
  useEffect(() => {
    if (!chatOpen) return;
    const clamped = clampConversation(convFocus, convShape);
    if (clamped.zone !== convFocus.zone || clamped.i !== convFocus.i || clamped.row !== convFocus.row) {
      setConvFocus(clamped);
    }
  }, [chatOpen, convShape]);

  // An answer that is about a card puts focus on it, once the row holds what the answer found.
  const rowSettled = recent.map((c) => c.key).join() === latestKey;
  useEffect(() => {
    if (!goto || !idle || !rowSettled) return;
    const c = columns.findIndex((k) => k.key === goto.key);
    setGoto(null);
    if (c >= 0) setFocus(goto.inside ? { area: "row", col: c, i: 0, inside: true } : { area: "row", col: c, i: 0 });
  }, [goto, idle, rowSettled]);

  // The assistant's picks arrived on a card whose end bar still has the remote: focus moves to the first of them.
  useEffect(() => {
    if (!recFocus) return;
    setRecFocus(null);
    const c = columns.findIndex((k) => k.key === recFocus);
    const col = columns[c];
    if (col?.kind !== "media" || focus.area !== "row" || focus.col !== c || !focus.inside || !atEnd(focus.i)) return;
    const rows = expandedRows(col);
    setFocus({ ...focus, i: rows.slice(0, -1).reduce((s, n) => s + n, 0) });
  }, [recFocus]);

  // The recommendation goes back to the card's usual titles once it was opened and left, or after a minute.
  const foundKey = found ? MEDIA.find((m) => m.kind === found.kind)?.key : undefined;
  const foundSeen = useRef(false);
  useEffect(() => {
    if (!found) return void (foundSeen.current = false);
    const at = focus.area === "row" && focus.inside ? columns[focus.col ?? 0]?.key : undefined;
    if (at === foundKey) foundSeen.current = true;
    else if (foundSeen.current) setFound(null);
  }, [found, focus]);
  useEffect(() => {
    if (!found) return;
    const t = setTimeout(() => setFound(null), 60_000);
    return () => clearTimeout(t);
  }, [found]);

  // Keep focus valid when a card's items change.
  useEffect(() => {
    if (focus.area === "row" && !layout.cols.some((c) => c.count > 0) && !error) return;
    const next = clamp(focus, layout);
    if (next.area !== focus.area || next.i !== focus.i || next.col !== focus.col || next.inside !== focus.inside) setFocus(next);
  }, [layout]);

  /** OK on a Recent card: back to what that answer was about. */
  const openRecent = (card: RecentCard) => {
    if (card.kind === "alert") return homeConfigured() ? void setView("lights") : undefined;
    const turn = talk.turns.find((t) => `t${t.id}` === card.key);
    if (!turn) return;
    if (turn.action === "watch" || turn.action === "weather" || turn.action === "resume") return showTurn(turn, true);
    if ((turn.action === "title_info" || turn.action === "mylist_updated") && turn.results?.[0]) return openHit(turn.results[0]);
    if (turn.action === "domotics_updated") return homeConfigured() ? void setView("lights") : nextScene();
    if (turn.action === "reminder_added") return focusReminders(reminders.findIndex((r) => !r.completed && turn.reply.includes(r.text)));
    void send(turn.prompt);
  };

  /** The Reminders card, at reminder `at` (or its first). */
  function focusReminders(at = 0) {
    const col = columns.findIndex((c) => c.key === "reminders");
    if (col >= 0) setFocus({ area: "row", col, i: Math.max(0, Math.min(at, 2)), inside: true });
  }

  /** Takes a card off the home row (a long OK, "Remove from home"); the last card brings it back. */
  function removeCard(key: string) {
    if (!canRemove(key)) return;
    const next = [...hidden, key];
    setHidden(next);
    saveHidden(storage, next);
    flash(`${columns.find((c) => c.key === key)?.label ?? labelOf(key)} removed · the last card adds it back`);
    setFocus({ area: "row", col: Math.min(focus.col ?? 0, Math.max(0, columns.length - 2)), i: 0 });
  }

  function restoreCard(key: string) {
    const next = hidden.filter((k) => k !== key);
    setHidden(next);
    saveHidden(storage, next);
    flash(`${collectionCards.find((c) => c.key === key)?.title ?? labelOf(key)} is back on the home screen`);
    setGoto({ key, inside: false });
  }

  function toggleReminderAt(r: Reminder) {
    if (localRem.owns(r.id)) setLocalItems(localRem.toggle(r.id));
    else if (SERVER_URL) toggleReminder(SERVER_URL, r.id).then(applyReminders, () => flash("Couldn't update the reminder"));
  }

  moodBy.current = (key) => {
    const m = mainMoods(scenes).find((x) => x.key === key);
    return m ? applyMood(m) : Promise.reject(new NestError(`No ${key} mood`));
  };
  /**
   * A mood (moods.ts, with the viewer's changes): its effects, then together its lights (a show, a level or a routine,
   * unless it leaves them), the TV's picture mode and the sound system, each only when the mood sets it.
   */
  function applyMood(m: Mood): Promise<void> {
    setLightFx(m.fx);
    setActiveMood(m.key);
    setMoodKey(m.key);
    const jobs: Promise<unknown>[] = [];
    if ("routine" in m.lights) jobs.push(home.runScene(m.lights.routine));
    else if ("scene" in m.lights) jobs.push(runLights(m.lights, devices, scenes));
    if (m.picture) jobs.push(setPictureMode(m.picture, devices, scenes).then((mode) => setTvPicture(readTvPicture() ?? mode)));
    const sound = devices.find((d) => d.kind === "audio");
    if (m.sound !== undefined && sound && sound.on !== m.sound) {
      jobs.push(
        toggleSound(devices, !m.sound).then((on) => {
          setSoundSet(on);
          clearTimeout(soundTimer.current);
          soundTimer.current = setTimeout(() => setSoundSet(null), 8000);
        }),
      );
    }
    return Promise.all(jobs).then(() => pollHomeSoon());
  }

  /** A scene from the Home card: SmartThings from the TV, else through the server. */
  function runScene(id: Scene, label: string) {
    if (!SERVER_URL || homeConfigured()) {
      return void runLights({ scene: id }, devices, scenes).then(
        () => {
          flash(label);
          pollHomeSoon();
        },
        (e) => flash(e instanceof NestError ? e.message : "Couldn't reach the lights"),
      );
    }
    setScene(SERVER_URL, id).then(
      () => flash(label),
      () => flash("Couldn't reach the lights"),
    );
  }

  /** OK on the lights button: the mood strip, focus on the active mood (or the first). */
  const openStrip = () => {
    const moods = allMoods(scenes);
    setStripOpen(true);
    setFocus({ area: "moods", i: Math.max(0, moods.findIndex((m) => m.key === moodKey)) });
  };
  const closeStrip = () => {
    setStripOpen(false);
    setFocus({ area: "header", i: HEADER_LIGHTS });
  };
  /** OK in the strip: that mood at once, or the full Mood panel from "more". */
  const runStrip = (i: number) => {
    const m = stripMoods[i];
    setStripOpen(false);
    if (!m) return void setView("lights");
    setFocus({ area: "header", i: HEADER_LIGHTS });
    flash(`${m.label}…`);
    applyMood(m).then(
      () => flash(`${m.label} is on`),
      (e) => flash(e instanceof NestError ? e.message : "Couldn't reach the lights"),
    );
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setFocus({ area: "header", i: HEADER_PROFILE });
  };

  const runMenu = (i: number) => {
    if (i === 0) {
      closeMenu();
      return void setView(cloudEnabled ? (cloud.session.signedIn() ? "profiles" : "signin") : "profiles");
    }
    if (i === 1) {
      closeMenu();
      return void openApp(SETTINGS_ID).catch(failed("the TV's settings"));
    }
    if (i === 2) return pickTheme(flipTheme(themePref, new Date().getHours(), lux));
    toggleSpeech();
  };

  /** OK on a header button (nest-nav's numbers), from home or from a catalog title page. */
  const pressHeader = (i: number) => {
    if (i === HEADER_PROFILE) {
      setMenuOpen(true);
      return setFocus({ area: "menu", i: 0 });
    }
    if (i === HEADER_PARTY) return void setView("party");
    if (i === HEADER_SEARCH) return openSearch();
    if (i === HEADER_LIGHTS) return homeConfigured() ? openStrip() : nextScene();
    if (i === HEADER_PICTURE) return togglePicture();
    if (i === HEADER_SOUND) return toggleSoundButton();
    // The catalog's settings (playback, sources, appearance, collections), the Hub's Settings tab.
    if (i === HEADER_SETTINGS) return browse({ type: "movie", hub: { tab: "settings" } });
    if (i === HEADER_BELL) {
      if (!prefs.reminders) return flash("Reminders are off · Settings › Home screen");
      const due = reminders.findIndex((r) => !r.completed);
      if (due < 0) return flash("No open reminders");
      return focusReminders(due);
    }
  };

  const runDockItem = (idx: number) => {
    const chips = tailored.dockChips;
    if (idx === 0) return void listen();
    if (idx >= 1 && idx <= chips.length) {
      const chip = chips[idx - 1];
      recording.current?.cancel();
      setConvFocus({ zone: "chips", i: 0 });
      if (view === "home") setFocus({ area: "chat", i: 0 });
      else setExtAssistant("chat");
      if (chip) void send(chip, false);
      return;
    }
    recording.current?.cancel();
    setConvFocus({ zone: "controls", i: 0 });
    if (view === "home") setFocus({ area: "chat", i: 0 });
    else setExtAssistant("chat");
  };

  const closeConversation = () => {
    recording.current?.cancel();
    stopPlayback();
    if (view === "home") {
      setFocus({ area: "row", col: homeColIdx, i: 0 });
    } else {
      setExtAssistant(null);
    }
  };

  const activateConversation = () => {
    const cur = clampConversation(convFocus, convShape);
    if (cur.zone === "controls") {
      if (cur.i === 0) return void listen();
      if (cur.i === 1) {
        recording.current?.cancel();
        return openAsk();
      }
      if (cur.i === 2) return toggleSpeech();
      return;
    }
    if (cur.zone === "chips") {
      const chip = tailored.chatChips[cur.i];
      if (!chip) return;
      recording.current?.cancel();
      void send(chip, false);
      return;
    }
    // Inline media recommendation selected from the conversation thread!
    const turn = turnsWithResults[cur.row ?? turnsWithResults.length - 1];
    const hit = turn?.results?.[cur.i];
    if (!hit) return;
    closeConversation();
    if (turn.action === "resume") {
      const inProgress = live.current.continueItems.find((e) => e.title.id === hit.title.id);
      if (inProgress) return resume(inProgress);
    }
    openHit(hit);
  };

  // Remote keys for the full-screen Conversation view (works identically over Home, Catalog, Detail and Mood).
  useKeys(chatOpen, (key) => {
    if (key === "SearchVoice") return void listen();
    if (key === "Blue") return toggleSpeech();
    if (key === "Back") return closeConversation();
    if (key === "Enter") return activateConversation();
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = stepConversation(convFocus, key, convShape);
      if (next.zone !== "controls" && recording.current && !recording.current.heard) {
        recording.current.cancel();
      }
      setConvFocus(next);
      return;
    }
    return true;
  });

  // Remote keys for the bottom Assistant Dock when focused over a non-Home screen (Catalog, Detail, Mood).
  useKeys(extAssistant === "dock" && !chatOpen, (key) => {
    if (key === "SearchVoice") return void listen();
    if (key === "Blue") return toggleSpeech();
    if (key === "Back" || key === "Up") {
      recording.current?.cancel();
      setExtAssistant(null);
      return;
    }
    if (key === "Enter") return runDockItem(extDockIdx);
    if (key === "Left" || key === "Right") {
      const next = stepDock(extDockIdx, key, tailored.dockChips.length);
      if (typeof next === "number") {
        if (next > 0 && recording.current && !recording.current.heard) recording.current.cancel();
        setExtDockIdx(next);
      }
      return;
    }
    return true;
  });

  const activate = () => {
    const { area, i } = focus;
    if (area === "menu") return runMenu(i);
    if (area === "moods") return runStrip(i);
    if (area === "header") return pressHeader(i);
    if (area === "ask") return runDockItem(i);
    if (area === "chat") return activateConversation();
    if (area === "row") {
      // A card as a whole: OK goes inside it (a media card opens, useOkHold below). Inside, an item does its own thing.
      // On the Assistant card, OK opens the full chat.
      if (!focus.inside) {
        if (columns[focus.col ?? 0]?.kind === "assistant") {
          setConvFocus({ zone: "controls", i: 0 });
          return setFocus({ area: "chat", i: 0 });
        }
        return setFocus(enter(focus, layout));
      }
      const col = columns[focus.col ?? 0];
      // The bar under an opened media card's last row: back to its first title, the assistant's picks, or the catalog.
      if (col?.kind === "media" && i === END_TOP) return setFocus({ ...focus, i: 0 });
      if (col?.kind === "media" && i === END_RECOMMEND) return col.recs?.status === "loading" ? undefined : col.recommend?.();
      if (col?.kind === "media" && i === END_ALL) return col.seeAll?.();
      // A row under the picks (My List, a genre): its own item.
      if (col?.kind === "media" && i >= col.items.length) {
        const { r, x } = rowAt(expandedRows(col), i);
        return (col.more ?? []).filter((m) => m.items.length)[r - 1]?.run(x);
      }
      col?.run(i);
    }
  };

  // On a media card as a whole, OK is split: a short press opens it, a long one opens its style menu (the remote sends
  // no repeats for a held OK). Everywhere else OK acts on the keydown as before.
  const pickedCard = view === "home" && !chatOpen && !styleMenu && !removeMenu && !moving && focus.area === "row" && !focus.inside;

  /** Starts moving a card: Left and Right slide it along the row, OK keeps it there, Back puts it back. */
  const startMove = (key: string) => {
    setMoving({ key, orig: order });
    setFocus({ area: "row", col: columns.findIndex((c) => c.key === key), i: 0 });
  };
  /** One step of a move: the order is applied on the next render, so focus is placed where the card will be. */
  const stepMove = (key: string, dir: -1 | 1) => {
    const keys = columns.map((c) => c.key);
    const next = moveKey(keys, key, dir);
    if (next.every((k, i) => k === keys[i])) return;
    setOrder(keepOrder(next, order));
    setFocus({ area: "row", col: next.indexOf(key), i: 0 });
  };
  const openPicked = () => {
    const c = columns[focus.col ?? 0];
    if (c?.kind === "assistant") {
      setConvFocus({ zone: "controls", i: 0 });
      return setFocus({ area: "chat", i: 0 });
    }
    setFocus(enter(focus, layout));
  };
  const hold = useOkHold(pickedCard, openPicked, () => {
    const c = columns[focus.col ?? 0];
    if (c?.kind === "media") setStyleMenu(openStyleMenu(c.key, c.style));
    else if (c && canRemove(c.key)) setRemoveMenu({ key: c.key, line: 0 });
    else openPicked();
  }, undefined, setHoldSince);

  // On a title tile inside an opened media card the same split: a short OK does what it did (plays or opens), a long
  // one opens the title's menu (details, play, watched, My List). The Open tile and the rows under it stay immediate.
  const tileCol = view === "home" && !chatOpen && focus.area === "row" && focus.inside ? columns[focus.col ?? 0] : undefined;
  const tilePicked = !styleMenu && !removeMenu && !moving && !tileMenu && tileCol?.kind === "media" && !!targetAt(tileCol, focus.i);
  const tileHold = useOkHold(tilePicked, activate, () => {
    const target = tileCol?.kind === "media" ? targetAt(tileCol, focus.i) : null;
    if (!target || tileCol?.kind !== "media") return;
    const lines: { id: string; label: string }[] = titleMenu({
      series: target.type !== "movie",
      hasProgress: target.resume,
      watched: isTitleWatched(target.title.id),
      saved: inLibrary(target.type, target.title.id),
      saga: false,
      details: true,
    }).filter((l) => l.id !== "restart" && l.id !== "sources" && l.id !== "timeline");
    if (target.suggestion) lines.push({ id: "dismiss", label: "✕ Remove from suggestions" });
    if (target.resume) lines.push({ id: "unresume", label: "⊘ Remove from Continue" });
    lines.push(lookLine(lookOf(target.row)));
    setTileMenu({ menu: { name: target.title.name, lines, at: 0 }, target });
  }, undefined, setHoldSince);
  /** The menu's "Row look" line: Left and Right (or OK) change how the whole row draws, at once. */
  const lookLine = (shape: RowShape) => ({ id: "look", label: `▦ Row look  ‹ ${ROW_SHAPE_LABEL[shape]} ›` });
  /** A row's look: the one picked for it, else stills for Continue watching, else posters. */
  const lookOf = (row: string): RowShape => rowLooks[row] ?? (row.endsWith("/continue") ? "landscape" : rowShape(rowLooks, row));
  const stepLook = (m: { menu: TileMenu; target: TileTarget }, dir: 1 | -1) => {
    const next = stepShape(lookOf(m.target.row), dir);
    const looks = { ...rowLooks, [m.target.row]: next };
    setRowLooks(looks);
    saveRowLooks(storage, looks);
    setTileMenu({ ...m, menu: { ...m.menu, lines: m.menu.lines.map((l) => (l.id === "look" ? lookLine(next) : l)) } });
  };
  /** One line of the tile menu. */
  const runTileLine = (id: string, t: TileTarget) => {
    if (id === "unresume") {
      setContinueItems((l) => l.filter((e) => e.title.id !== t.title.id));
      void forgetProgress(t.type, t.title.id);
      return flash(`${t.title.name} removed from Continue watching`);
    }
    if (id === "dismiss") {
      const next = dismiss(dismissed, t.title.id);
      setDismissed(next);
      saveDismissed(storage, next);
      return flash(`${t.title.name} removed from suggestions`);
    }
    if (id === "details") return openHit({ type: t.type, title: t.title });
    if (id === "play") return playTitle(t.type, t.title);
    if (id === "watched") return flash(toggleTitleWatched(t.title.id, t.type) ? `${t.title.name} marked watched` : `${t.title.name} marked not watched`);
    if (id === "mylist") return flash(toggleLibrary(t.type, t.title) ? `${t.title.name} added to My List` : `${t.title.name} removed from My List`);
  };

  useKeys(view === "home" && !chatOpen, (key) => {
    // The tile menu takes every key while it is open: Up and Down pick, OK does it, Back leaves it.
    if (tileMenu) {
      if (key === "Enter" && tileHold.holding()) return;
      if (tileMenu.menu.lines[tileMenu.menu.at]?.id === "look" && (key === "Left" || key === "Right" || key === "Enter")) return stepLook(tileMenu, key === "Left" ? -1 : 1);
      const r = stepTitleMenu(tileMenu.menu.at, tileMenu.menu.lines.length, key);
      if (r === "close") setTileMenu(null);
      else if (r === "run") {
        const line = tileMenu.menu.lines[tileMenu.menu.at];
        const t = tileMenu.target;
        setTileMenu(null);
        if (line) runTileLine(line.id, t);
      } else if (r !== tileMenu.menu.at) setTileMenu({ ...tileMenu, menu: { ...tileMenu.menu, at: r } });
      return;
    }
    // Moving a card: Left and Right slide it, OK keeps the order (saved), Back puts the old order back.
    if (moving) {
      if (key === "Enter" && hold.holding()) return;
      if (key === "Left" || key === "Right") stepMove(moving.key, key === "Left" ? -1 : 1);
      else if (key === "Enter") {
        saveOrder(storage, order);
        setMoving(null);
      } else if (key === "Back") {
        setOrder(moving.orig);
        setMoving(null);
        setFocus({ area: "row", col: Math.max(0, applyOrder(columns, moving.orig).findIndex((c) => c.key === moving.key)), i: 0 });
      }
      return;
    }
    // The move/remove menu (a long OK on any other card): Up and Down pick, OK does it, Back leaves it.
    if (removeMenu) {
      if (key === "Enter" && hold.holding()) return;
      if (key === "Enter") {
        const m = removeMenu;
        setRemoveMenu(null);
        if (m.line === 0) startMove(m.key);
        else removeCard(m.key);
      } else if (key === "Up" || key === "Down") setRemoveMenu({ ...removeMenu, line: key === "Up" ? 0 : 1 });
      else if (key === "Back") setRemoveMenu(null);
      return;
    }
    // The card style menu takes every key while it is open. OK keeps the style, Back puts the old one back.
    if (styleMenu) {
      if (key === "Enter" && hold.holding()) return;
      const r = stepStyleMenu(styleMenu, key);
      if (r === "keep") {
        const next = { ...cardStyles, [styleMenu.key]: styleMenu.style };
        setCardStyles(next);
        saveCardStyles(storage, next);
        setStyleMenu(null);
      } else if (r === "undo") setStyleMenu(null);
      else if (r === "move") {
        const k = styleMenu.key;
        const next = { ...cardStyles, [k]: styleMenu.style };
        setCardStyles(next);
        saveCardStyles(storage, next);
        setStyleMenu(null);
        startMove(k);
      } else if (r === "remove") {
        const k = styleMenu.key;
        setStyleMenu(null);
        removeCard(k);
      } else setStyleMenu(r);
      return;
    }
    // Channel Down (CH-) or Search opens the search.
    if (key === "ChannelDown" || key === "Search") return openSearch();
    // The microphone key talks to Secretary on the home screen; Red flips the picture mode, Green cycles the theme, Blue
    // mutes spoken replies.
    if (key === "SearchVoice") return void listen();
    if (key === "Red") return togglePicture();
    if (key === "Blue") return toggleSpeech();
    if (key === "Green") return pickTheme(flipTheme(themePref, new Date().getHours(), lux));
    if (key === "ChannelUp") {
      getTvInputBridge().close();
      setFocus({ area: "header", i: HEADER_SEARCH });
      return;
    }
    if (key === "Enter") return pickedCard || hold.holding() || tilePicked || tileHold.holding() ? undefined : void activate();
    if (menuOpen && key === "Back") return closeMenu();
    if (stripOpen && (key === "Back" || key === "Up" || key === "Down")) return closeStrip();
    if (menuOpen && (key === "Left" || key === "Right")) return;
    if (key === "Back" && focus.area === "row" && focus.inside) return setFocus(leave(focus));
    if (key === "Back" && focus.area === "ask") {
      recording.current?.cancel();
      return setFocus({ area: "row", col: homeColIdx, i: 0 });
    }
    if (key === "Back") {
      const now = performance.now();
      if (now - lastBack.current < EXIT_WINDOW_MS) return void playFarewell().finally(() => exitApp());
      lastBack.current = now;
      flash("Press Back again to leave Secretary");
      return;
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      if (focus.area === "ask" && key === "Up") {
        recording.current?.cancel();
        return setFocus({ area: "row", col: homeColIdx, i: 0 });
      }
      const next = step(focus, key, layout);
      if (focus.area === "ask" && next.area === "ask" && next.i > 0 && recording.current && !recording.current.heard) {
        recording.current.cancel();
      }
      if (next !== focus) setFocus(next);
      return;
    }
    return false;
  });

  // Under the name, only what needs doing (an error, signing in); what the TV is connected to is a pair of icons,
  // and the words for it open with the profile menu.
  const status = error ?? (cloudEnabled && !me ? "Not signed in to Nuvio" : "");

  /** The one header over a panel (Lights, Watch together): picture and sound act in place, the rest leave for home. */
  const panelHeader: PanelHeader = {
    time,
    person: { ...headerPerson, sub: status || undefined },
    buttons: headerButtons(pictureMode, soundOn, openReminders, moodKey),
    press: (i) => {
      if (i !== HEADER_PICTURE && i !== HEADER_SOUND) {
        setView("home");
        setFocus({ area: "header", i });
      }
      pressHeader(i);
    },
  };
  const links: { icon: IconName; off?: boolean }[] = [
    ...(cloudEnabled && me ? [{ icon: "sync" as const }] : []),
    ...(SERVER_URL ? [{ icon: "server" as const, off: !serverOnline }] : []),
  ];
  const menuInfo = [
    cloudEnabled ? (me ? `Nuvio · synced as ${me.name}` : "Nuvio · not signed in") : "Nuvio sync off",
    SERVER_URL ? (serverOnline ? "Server online · CH- to search" : "Server offline · apps still work") : "No server configured",
  ];

  const wave = waveState({ listening, asking, answered });
  const liveStatus = statusForInteraction({
    listening,
    hearing,
    transcribing,
    asking,
    speaking: speakingAudio,
  }) || WAVE_STATUS[wave];
  const showAssistantBar =
    view === "home" ||
    view === "lights" ||
    (view === "catalog" && catalogCtx?.screen !== "player" && catalogCtx?.screen !== "hub" && !catalog?.hub);

  const askView = {
    wave,
    status: liveStatus,
    prompt: listening ? undefined : lastAnswer?.prompt,
    reply: lastAnswer?.reply ?? summary ?? "",
    turnId: lastAnswer?.id ?? 0,
    focused: inHomeDock,
    full: inHomeChat,
  };

  return (
    <GlassRoot
      mode="fake"
      wallpaper={backdrop?.wallpaper}
      frost={backdrop?.frost}
      mood={moodOn ? { palette: shownMood, day: theme === "day" } : undefined}
      sheen={effective(fx).shimmer && { palette: shownMood }}
      class={theme === "day" && view !== "catalog" ? "nest sg-day" : "nest"}
    >
      {view === "signin" ? (
        <SignIn
          onDone={() => {
            setView("profiles");
            void refreshMe();
            void refreshCloud();
          }}
          onClose={() => {
            skipSignIn();
            setView("home");
          }}
        />
      ) : view === "profiles" ? (
        <Profiles
          onPicked={picked}
          onSignedOut={() => {
            setMe(null);
            setContinueItems([]);
            setView("home");
            flash("Signed out of Nuvio");
          }}
          onClose={() => setView("home")}
        />
      ) : view === "catalog" && catalog ? (
        <CatalogHost entry={catalog} host={embeddedHost} serverUrl={SERVER_URL} />
      ) : view === "party" ? (
        <WatchTogether
          header={panelHeader}
          onClose={() => setView("home")}
          onJoinHere={(o) => browse({ type: o.type, open: { type: o.type, title: { ...o.title, year: "", rating: "" }, autoPlay: false, room: o.room } })}
        />
      ) : view === "lights" ? (
        <MoodPanel
          devices={devices}
          scenes={scenes}
          header={panelHeader}
          active={extAssistant === null}
          onAssistant={openExternalAssistant}
          onMood={applyMood}
          onSetup={() => browse({ type: "movie", hub: { tab: "settings", category: SMARTTHINGS_TAB } })}
          onClose={() => setView("home")}
        />
      ) : view === "search" ? (
        <SearchScreen
          key={query}
          time={time}
          person={{ ...headerPerson, sub: status || undefined }}
          buttons={headerButtons(pictureMode, soundOn, openReminders, moodKey)}
          find={findTitles}
          initialQuery={query}
          onQuery={(q) => (lastSearch = q)}
          desk={SERVER_URL && serverOnline ? SERVER_URL : ""}
          onOpen={(hit) => {
            setSearchFrom(null);
            browse({ type: hit.type, open: { type: hit.type, title: hit.title } });
          }}
          onHeader={(i) => {
            setSearchFrom(null);
            setView("home");
            setFocus({ area: "header", i });
            pressHeader(i);
          }}
          onClose={closeSearch}
        />
      ) : (
        <Home
          focus={focus}
          time={time}
          ask={askView}
          menu={menuOpen ? menuItems : null}
          menuInfo={menuInfo}
          links={links}
          glow={glow}
          columns={columns}
          open={openReminders}
          status={status}
          me={me}
          styleMenu={styleMenu}
          removeMenu={removeMenu}
          tileMenu={tileMenu?.menu ?? null}
          moving={moving?.key ?? null}
          pictureMode={pictureMode}
          soundOn={soundOn}
          mood={moodKey}
          moodStrip={stripOpen ? { moods: stripMoods, active: moodKey } : null}
        />
      )}
      {showAssistantBar && (
        <AssistantDock
          wave={wave}
          status={liveStatus}
          reply={lastAnswer?.reply ?? summary ?? ""}
          tailored={tailored}
          focused={dockFocused}
          focusIndex={activeDockIndex}
          compact={view !== "home" || openCol >= 0}
          hidden={chatOpen || (view === "home" && openCol >= 0)}
          listening={listening}
          audio={audioRoute}
        />
      )}
      <ConversationOverlay
        open={chatOpen}
        turns={talk.turns}
        wave={wave}
        status={liveStatus}
        listening={listening}
        asking={asking}
        pendingPrompt={pendingPrompt}
        tailored={tailored}
        focus={convFocus}
        audio={audioRoute}
        speakOn={speakReplies}
        canSpeak={VOICE_KEYS.speak}
      />
      <HoldPill since={holdSince} />
      {toast && (
        <Glass x={560} y={1000} w={800} h={60} class="nest-toast">
          <span>{toast}</span>
        </Glass>
      )}
    </GlassRoot>
  );
}
