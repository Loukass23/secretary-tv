import { type Dir, exitApp, type Focus as GridFocus, getTvInputBridge, move, useKeys } from "@secretary/tv-kit";
import { artColour, type Backdrop, drawBackdrop, Glass, GlassRoot, glowImage, setWaveLevel, TINTS } from "@secretary/tv-kit/src/glass/index.ts";
import { avatarCatalog, avatarImage, listProfiles, type Profile, pullProgress, toItems, withMeta } from "@secretary/nuvio";
import { readJson, writeJson } from "@secretary/tv-kit";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Profiles, SignIn } from "./account.tsx";
import {
  addReminder,
  type AppEntry,
  backdropUrl,
  type CatalogKind,
  fetchReminders,
  launchApp,
  listApps,
  openApp,
  openTitleInApp,
  orderReminders,
  ownId,
  posterUrl,
  type Reminder,
  type Scene,
  type SearchResult,
  setScene,
  toggleReminder,
  type UnifiedResumeEntry,
  visibleApps,
} from "./apps.ts";
import {
  artProxy,
  askNest,
  type AssistantState,
  type AssistantTurn,
  CHIPS,
  fetchAssistant,
  fetchWeather,
  THEME_PREFS,
  type ThemePref,
  themeFor,
  themePrompt,
  transcribeClip,
  VoiceError,
  WAVE_STATUS,
  waveState,
  type Weather,
} from "./assistant.ts";
import { localBrain, localReminders, mergeTurns, NestError } from "./brain.ts";
import { cloud, cloudEnabled, signInSkipped, skipSignIn } from "./cloud.ts";
import { APP_IDS, GEMINI_KEY, HIDE, PINS, SERVER_URL, WEATHER_ENV } from "./config.ts";
import type { RowColumn } from "./cards.tsx";
import { rowLayout } from "./cards.tsx";
import { Home } from "./home.tsx";
import {
  clamp,
  type Focus,
  HEADER_BELL,
  HEADER_LIGHTS,
  HEADER_PARTY,
  HEADER_PROFILE,
  HEADER_SEARCH,
  HEADER_WEATHER,
  type Layout,
  step,
} from "./nest-nav.ts";
import { home, homeConfigured, runLights } from "./home-control.ts";
import { LightsPanel } from "./lights.tsx";
import { WatchTogether } from "./party.tsx";
import { KEY_ROWS, RECENT_ROW, Search } from "./search.tsx";
import { play, record, type Recording } from "./voice.ts";
import { cachedWeather, refreshWeather } from "./weather.ts";
import { homeAction, homeAlerts, roomLux, type StDevice, type StScene } from "@secretary/smartthings";
import { discoverCatalog, searchCatalogs, speak as speakGemini, transcribe as transcribeGemini } from "@secretary/assistant";

const EXIT_WINDOW_MS = 2000;
const SEARCH_DEBOUNCE_MS = 250;
const RECENT_SEARCH_KEY = "sectv:recent-searches:v1";
const MAX_RECENT_SEARCHES = 8;
const THEME_KEY = "nest.theme";
const SPEAK_KEY = "nest.speak";
/** How often Nest asks the server what the assistant is doing (prompts from the phone show up this fast). */
const ASSISTANT_POLL_MS = 2500;
/** Open-Meteo updates every 15 min; the header has no need to be fresher than half an hour. */
const WEATHER_POLL_MS = 30 * 60_000;
/** Answers and home alerts in the Recent row, newest first. */
const MAX_RECENT = 4;
/** SmartThings device status while Nest is up: one call per rate-limit window (10 per ~15 s, shared with commands). */
const HOME_POLL_MS = 15_000;
/** How long the wave keeps "speaking" after an answer arrives. */
const SPEAK_MS = 3000;
/** The glow when an artwork's colour cannot be read: the app's own tint. */
const KIND_TINT: Record<CatalogKind, string> = { movie: TINTS.orange, series: TINTS.blue, anime: TINTS.rose };
const THEME_LABEL: Record<ThemePref, string> = { auto: "Theme: automatic (Daylight 7–19h)", day: "Theme: Daylight", night: "Theme: Night" };

function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEME_PREFS.includes(v as ThemePref) ? (v as ThemePref) : "auto";
  } catch {
    return "auto";
  }
}

/** Spoken replies, on unless muted with Blue. */
function loadSpeakReplies(): boolean {
  try {
    return localStorage.getItem(SPEAK_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The catalog apps and the TV's settings have their own places (cards, the profile menu), not the Apps card. */
const OWN_PLACES: readonly string[] = [APP_IDS.movie, APP_IDS.series, APP_IDS.anime, PINS[PINS.length - 1]];
const SETTINGS_ID = PINS[PINS.length - 1];
/** Trending titles for the empty Cinema, Shows and Anime cards, fetched from the TV once a day. */
const TRENDING_KEY = "nest.trending";
const TRENDING_TTL_MS = 24 * 60 * 60_000;
type Trending = Record<CatalogKind, SearchResult[]>;
const NO_TRENDING: Trending = { movie: [], series: [], anime: [] };

/** A card in the Recent column: an answer from the assistant, or something the home reported. */
type RecentCard =
  | { kind: "answer"; key: string; at: number; action: string; prompt: string; reply: string }
  | { kind: "alert"; key: string; at: number; text: string };

const RECENT_COLOR: Record<string, string> = {
  watch: "#ff8a3d",
  reminder_added: "#3ccf6e",
  domotics_updated: "#ffc94d",
  weather: "#4fc3ff",
  briefing: "#b78bff",
  alert: "#ff7ad9",
};
const SOURCE_LABEL: Record<Reminder["source"], [string, string]> = {
  companion: ["From Secretary Desk", "#5b7cff"],
  gemini: ["From the assistant", "#7d6bff"],
  local: ["Added on the TV", "#3ccf6e"],
};
const SCENES: readonly [Scene, string][] = [
  ["cinema", "🎬 Cinema lights"],
  ["warm", "🕯 Warm lights"],
  ["off", "🌙 Lights off"],
];

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

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function saveRecent(term: string): string[] {
  const clean = term.trim();
  if (clean.length < 2) return loadRecent();
  const prev = loadRecent().filter((item) => item.toLowerCase() !== clean.toLowerCase());
  const next = [clean, ...prev].slice(0, MAX_RECENT_SEARCHES);
  try {
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

function clearRecent(): string[] {
  try {
    localStorage.removeItem(RECENT_SEARCH_KEY);
  } catch {
    // ignore
  }
  return [];
}

export function App() {
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [continueItems, setContinueItems] = useState<UnifiedResumeEntry[]>([]);
  const [serverReminders, setReminders] = useState<Reminder[]>([]);
  const [localItems, setLocalItems] = useState<Reminder[]>(() => localRem.list());
  const reminders = useMemo(() => orderReminders([...serverReminders, ...localItems]), [serverReminders, localItems]);
  const [summary, setSummary] = useState<string | undefined>();
  const [serverOnline, setServerOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "search" | "signin" | "profiles" | "party" | "lights">(() =>
    cloudEnabled && !cloud.session.signedIn() && !signInSkipped() ? "signin" : "home",
  );
  const [me, setMe] = useState<{ name: string; color?: string; img?: string } | null>(null);
  const [focus, setFocus] = useState<Focus>({ area: "row", col: 0, i: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [trending, setTrending] = useState<Trending>(() => {
    try {
      const c = JSON.parse(storage.getItem(TRENDING_KEY) ?? "null") as { at: number; v: Trending } | null;
      return c?.v ?? NO_TRENDING;
    } catch {
      return NO_TRENDING;
    }
  });
  const [searchFocus, setSearchFocus] = useState<GridFocus>({ row: 0, col: 0 });
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecent());
  const [imeActive, setImeActive] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [time, setTime] = useState(clock);
  const [assistant, setAssistant] = useState<AssistantState | null>(null);
  const [asking, setAsking] = useState(false);
  const [listening, setListening] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [shownTurn, setShownTurn] = useState<AssistantTurn | null>(null);
  const [weather, setWeather] = useState<Weather | null>(() => cachedWeather(storage));
  const [weatherOpen, setWeatherOpen] = useState(false);
  /** What the home reported lately (the phone came home, the vacuum finished), for the Recent row. */
  const [alerts, setAlerts] = useState<{ text: string; at: number }[]>([]);
  const [themePref, setThemePref] = useState<ThemePref>(loadThemePref);
  const [speakReplies, setSpeakReplies] = useState(loadSpeakReplies);
  /** The clip being recorded from the room microphone. */
  const recording = useRef<Recording | null>(null);
  /** No room microphone (or no transcription): the mic key opens the TV keyboard, as before. */
  const keyboardOnly = useRef(false);
  const [glow, setGlow] = useState<string | undefined>();
  /** The newest turn already handled; undefined until the first poll, whose turns are history. */
  const lastTurn = useRef<number>();
  const speakTimer = useRef<ReturnType<typeof setTimeout>>();
  const [devices, setDevices] = useState<StDevice[]>([]);
  const [scenes, setScenes] = useState<StScene[]>([]);
  const lux = useMemo(() => roomLux(devices), [devices]);
  const theme = useMemo(() => themeFor(themePref, new Date().getHours(), lux), [themePref, time, lux]);
  const scene = useRef(0);
  const lastBack = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  /** What the TV's own assistant reads when it answers: the latest devices, scenes and forecast. */
  const live = useRef({ devices, scenes, weather });
  live.current = { devices, scenes, weather };
  const brain = useMemo(
    () =>
      localBrain({
        reminders: localRem,
        lights: (cmd) => runLights(cmd, live.current.devices, live.current.scenes),
        weather: async () => live.current.weather,
        geminiKey: GEMINI_KEY,
      }),
    [],
  );
  const [localState, setLocalState] = useState(() => brain.state());

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), EXIT_WINDOW_MS);
  };

  const openSearch = () => {
    setSearchFocus({ row: 0, col: 0 });
    setView("search");
  };

  const summonTvKeyboard = (seedQuery = query) => {
    const bridge = getTvInputBridge();
    setView("search");
    setImeActive(true);
    const opened = bridge.open(seedQuery, {
      onChange: (val) => setQuery(val),
      onCommit: (val) => {
        setImeActive(false);
        setQuery(val);
        if (val.trim().length >= 2) setRecentSearches(saveRecent(val));
        setSearchFocus({ row: RECENT_ROW, col: 0 });
      },
      onCancel: () => setImeActive(false),
    });
    if (!opened) {
      setImeActive(false);
      setSearchFocus({ row: 0, col: 0 });
    } else {
      flash("🎤 Speak into the remote or type on the TV keyboard");
    }
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
          setLocalItems(localRem.add(text));
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

  /** A new answer: the wave speaks for a moment, and titles it found replace Continue Watching. */
  const onNewTurn = (turn: AssistantTurn) => {
    setAnswered(true);
    clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => setAnswered(false), SPEAK_MS);
    if (turn.action === "watch") {
      setShownTurn(turn);
      if (turn.results?.length) setFocus({ area: "results", i: 0 });
    }
    if (turn.action === "reminder_added") {
      setLocalItems(localRem.list());
      if (SERVER_URL) fetchReminders(SERVER_URL).then(applyReminders, () => {});
    }
  };

  /** An answer from the TV's own assistant. */
  const showLocal = (turn: AssistantTurn) => {
    setLocalState(brain.state());
    onNewTurn(turn);
  };

  const applyAssistant = (st: AssistantState) => {
    setAssistant((prev) => (prev && prev.rev === st.rev ? prev : st));
    const last = st.turns[st.turns.length - 1];
    if (lastTurn.current === undefined) {
      lastTurn.current = last?.id ?? 0;
    } else if (last && last.id > lastTurn.current) {
      lastTurn.current = last.id;
      onNewTurn(last);
    }
  };

  /** Asks the server; `spoken` prompts get their answer read aloud too, unless replies are muted. */
  const send = async (prompt: string, spoken = false) => {
    const pref = themePrompt(prompt);
    if (pref) return pickTheme(pref);
    // A light, "the lights", a scene or the vacuum by name: straight to SmartThings, no server or Gemini.
    const act = devices.length || scenes.length ? homeAction(prompt, devices, scenes) : null;
    if (act) {
      flash(act.reply);
      showLocal(brain.note(prompt, act.reply, "domotics_updated"));
      const done =
        act.kind === "scene"
          ? home.runScene(act.scene.id)
          : Promise.all(act.targets.map((t) => home.command(t.device.id, t.commands)));
      return void done.then(pollHomeSoon, () => flash("SmartThings didn't take that; try again"));
    }
    setAsking(true);
    const wantSpeech = spoken && speakReplies;
    let speech: string | Uint8Array | null | undefined;
    try {
      // The server first when it is up (the phone shares its turns and reminders), else the TV answers itself.
      let reply: string | undefined;
      if (SERVER_URL && serverOnline) {
        try {
          ({ reply, speech } = await askNest(SERVER_URL, prompt, fetch, wantSpeech));
          applyAssistant(await fetchAssistant(SERVER_URL));
        } catch {
          reply = undefined;
        }
      }
      if (reply === undefined) {
        const turn = await brain.ask(prompt);
        reply = turn.reply;
        showLocal(turn);
      }
      if (wantSpeech && !speech && GEMINI_KEY) {
        const wav = await speakGemini(reply, GEMINI_KEY);
        speech = wav;
      }
    } finally {
      setAsking(false);
    }
    if (speech) {
      // The wave keeps speaking for as long as the reply plays, not just SPEAK_MS.
      clearTimeout(speakTimer.current);
      setAnswered(true);
      await play(speech, setWaveLevel);
      setAnswered(false);
    }
  };

  /**
   * The mic key: a clip from the room microphone (docs/launcher.md, "Room microphone"), the key again to stop early.
   * Falls back to the TV keyboard's dictation when the TV gives the app no microphone or the server cannot transcribe.
   */
  const listen = async () => {
    if (!SERVER_URL && !GEMINI_KEY) return openAsk();
    if (recording.current) return recording.current.stop();
    if (keyboardOnly.current) return openAsk();
    let rec: Recording;
    try {
      rec = await record(setWaveLevel);
    } catch {
      keyboardOnly.current = true;
      return openAsk();
    }
    recording.current = rec;
    setListening(true);
    flash(`🎤 Listening on ${rec.name}`);
    const clip = await rec.done;
    recording.current = null;
    setListening(false);
    if (!clip) return flash("Didn't hear anything");
    setAsking(true);
    let words = "";
    try {
      words = GEMINI_KEY ? await transcribeOnTv(clip) : await transcribeClip(SERVER_URL, clip);
    } catch (e) {
      const reason = e instanceof VoiceError ? e.reason : "failed";
      if (reason === "unavailable") {
        keyboardOnly.current = true;
        flash("Voice needs a Gemini key on the server or in this build");
      } else {
        flash(reason === "no-speech" ? "Didn't catch that" : "Couldn't reach the assistant");
      }
    } finally {
      setAsking(false);
    }
    if (words) await send(words, true);
  };

  /** The words in a clip, from Gemini straight from the TV. */
  const transcribeOnTv = async (clip: Uint8Array) => {
    let words: string;
    try {
      words = await transcribeGemini(clip, "audio/wav", GEMINI_KEY);
    } catch {
      throw new VoiceError("failed");
    }
    if (!words) throw new VoiceError("no-speech");
    return words;
  };

  const toggleSpeech = () => {
    const next = !speakReplies;
    setSpeakReplies(next);
    try {
      localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
    } catch {
      // the choice lasts until the app restarts
    }
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
    } else {
      flash("🎤 Speak or type, then OK");
    }
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
    if (!cloudEnabled || !cloud.session.signedIn()) return setContinueItems([]);
    try {
      const items = toItems(await pullProgress(cloud, cloud.session.profile())).slice(0, 20);
      setContinueItems((await withMeta(items, { get: readJson, set: writeJson })) as UnifiedResumeEntry[]);
    } catch {
      // Offline: keep what is shown.
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
    const onWake = () => {
      if (document.visibilityState !== "hidden") void refreshServer();
    };
    document.addEventListener("visibilitychange", onWake);
    const t = setInterval(() => setTime(clock()), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      clearInterval(t);
    };
  }, []);

  // The backdrop and its frost are drawn again when Daylight turns on or off.
  useEffect(() => {
    void drawBackdrop(TINTS.orange, theme).then(setBackdrop, (e) => console.warn("[nest] backdrop failed", e));
  }, [theme]);

  // What the assistant is doing, while the home screen is up: prompts from the phone show here too.
  useEffect(() => {
    if (view !== "home" || !SERVER_URL) return;
    const poll = () => {
      if (document.visibilityState === "hidden") return;
      fetchAssistant(SERVER_URL).then(applyAssistant, () => {});
    };
    poll();
    const t = setInterval(poll, ASSISTANT_POLL_MS);
    return () => clearInterval(t);
  }, [view]);

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
          const news = homeAlerts(lastDevices.current, next);
          for (const a of news) flash(a.text);
          if (news.length) setAlerts((prev) => [...news.map((a) => ({ text: a.text, at: Date.now() })), ...prev].slice(0, MAX_RECENT));
        }
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

  // The glow takes the focused tile's artwork colour, read through the server (the art hosts send no CORS headers).
  const shownResults = shownTurn?.results ?? null;
  const talk = mergeTurns(assistant, localState);
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
  const idle = !listening && !asking && !answered && !talk.pending;
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
  const resume = (e: UnifiedResumeEntry) => void openTitleInApp(SERVER_URL, e.type, e.title, true).catch(failed(e.title.name));
  const openHit = (r: SearchResult) => void openTitleInApp(SERVER_URL, r.type, r.title).catch(failed(r.title.name));
  const progressOf = (e: UnifiedResumeEntry) => (e.durSec > 0 ? e.posSec / e.durSec : undefined);
  const byKind = (k: CatalogKind) => continueItems.filter((e) => e.type === k);
  const columns: RowColumn[] = [];
  /** The artwork behind each column's items, for the glow. */
  const art: ({ src: string; type: CatalogKind } | undefined)[][] = [];
  const push = (col: RowColumn, pics: ({ src: string; type: CatalogKind } | undefined)[] = []) => {
    columns.push(col);
    art.push(pics);
  };
  if (recent.length) {
    const shown = recent.slice(0, 3);
    push({
      kind: "list",
      key: "recent",
      label: "Recent",
      items: shown.map((c) =>
        c.kind === "alert"
          ? { title: c.text, sub: "Home", color: RECENT_COLOR.alert }
          : { title: `“${c.prompt}”`, sub: c.reply, color: RECENT_COLOR[c.action] ?? "#b78bff" },
      ),
      run: (i) => openRecent(shown[i]),
    });
  }
  const film = byKind("movie")[0];
  const pick = trending.movie[0];
  if (film) {
    push(
      {
        kind: "poster",
        key: "cinema",
        label: "Continue · Cinema",
        // The poster carries its own title; a badge says what OK does.
        tile: { src: posterUrl(film.title), badge: "▶ Resume", progress: progressOf(film) },
        run: () => resume(film),
      },
      [{ src: posterUrl(film.title), type: "movie" }],
    );
  } else if (pick) {
    push(
      { kind: "poster", key: "cinema", label: "Tonight · Cinema", tile: { src: posterUrl(pick.title), badge: "Top film" }, run: () => openHit(pick) },
      [{ src: posterUrl(pick.title), type: "movie" }],
    );
  }
  const shows = byKind("series").slice(0, 2);
  const showPicks = trending.series.filter((r) => !shows.some((e) => e.title.id === r.title.id)).slice(0, 2 - shows.length);
  if (shows.length || showPicks.length) {
    const tiles = [
      ...shows.map((e) => ({
        src: backdropUrl(e),
        title: e.title.name,
        sub: e.episode ? `S${e.episode.season} · E${e.episode.episode}  ${e.episode.name}` : "▶ Resume",
        progress: progressOf(e),
      })),
      ...showPicks.map((r) => ({ src: r.title.background ?? posterUrl(r.title), title: r.title.name, sub: "Top series" })),
    ];
    push(
      {
        kind: "stack",
        key: "shows",
        label: shows.length ? "Next up · Shows" : "Top · Shows",
        tiles,
        run: (i) => (i < shows.length ? resume(shows[i]) : openHit(showPicks[i - shows.length])),
      },
      [...shows.map((e) => ({ src: backdropUrl(e), type: "series" as const })), ...showPicks.map((r) => ({ src: posterUrl(r.title), type: "series" as const }))],
    );
  }
  const anime = byKind("anime").slice(0, 6);
  const animePicks = trending.anime.filter((r) => !anime.some((e) => e.title.id === r.title.id)).slice(0, 6 - anime.length);
  if (anime.length || animePicks.length) {
    const pics = [...anime.map((e) => posterUrl(e.title)), ...animePicks.map((r) => posterUrl(r.title))];
    push(
      {
        kind: "grid",
        key: "anime",
        label: "Anime",
        tiles: [
          ...anime.map((e) => ({ src: posterUrl(e.title), badge: "▶", progress: progressOf(e) })),
          ...animePicks.map((r) => ({ src: posterUrl(r.title) })),
        ],
        run: (i) => (i < anime.length ? resume(anime[i]) : openHit(animePicks[i - anime.length])),
      },
      pics.map((src) => ({ src, type: "anime" as const })),
    );
  }
  const lights = devices.filter((d) => d.kind === "light");
  const lit = lights.filter((d) => d.on).length;
  push({
    kind: "home",
    key: "home",
    label: "Home",
    title: lights.length ? `${lit} light${lit === 1 ? "" : "s"} on` : "Lights",
    sub: lux !== null ? `${Math.round(lux)} lux in the room` : homeConfigured() ? `${lights.length} lights` : SERVER_URL ? "Through Secretary Server" : "SmartThings not set up",
    actions: ["🎬 Cinema", "🕯 Warm", "🌙 Off"],
    run: (i) => runScene(SCENES[i][0], SCENES[i][1]),
  });
  const shownReminders = reminders.slice(0, 3);
  push({
    kind: "list",
    key: "reminders",
    label: "Reminders",
    items: shownReminders.map((r) => {
      const [from, color] = SOURCE_LABEL[r.source] ?? SOURCE_LABEL.local;
      return { title: r.text, sub: from, meta: r.completed ? "✓" : r.due ? `⏰ ${r.due}` : undefined, color: r.completed ? "#6d6c68" : color, done: r.completed };
    }),
    add: "+ Add reminder",
    run: (i) => (i < shownReminders.length ? toggleReminderAt(shownReminders[i]) : newReminder()),
  });
  const otherApps = apps.filter((a) => !OWN_PLACES.includes(a.id)).slice(0, 6);
  if (otherApps.length) {
    push({
      kind: "apps",
      key: "apps",
      label: "Apps",
      apps: otherApps.map((a) => ({ icon: a.iconPath, label: a.name.replace(/^Secretary\s+/, "") })),
      run: (i) => void openApp(otherApps[i].id).catch(failed(otherApps[i].name)),
    });
  }
  const colAt = focus.area === "row" ? (focus.col ?? 0) : -1;
  const rowArt = colAt >= 0 ? art[colAt]?.[focus.i] : undefined;
  const focusedArt: { src: string; type: CatalogKind } | null =
    rowArt
      ? rowArt
      : focus.area === "results" && shownResults?.[focus.i]
        ? { src: posterUrl(shownResults[focus.i].title), type: shownResults[focus.i].type }
        : null;
  useEffect(() => {
    if (!focusedArt) return;
    let live = true;
    const t = setTimeout(() => {
      void artColour(SERVER_URL ? artProxy(SERVER_URL, focusedArt.src) : focusedArt.src)
        .then((rgb) => glowImage(rgb ?? KIND_TINT[focusedArt.type]))
        .then((src) => live && setGlow(src));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [focusedArt?.src]);

  // Debug helpers for the CDP scripts.
  useEffect(() => {
    const g = globalThis as { __sectv?: Record<string, unknown> };
    g.__sectv = {
      ...g.__sectv,
      continueItems,
      reminders,
      assistant,
      // spoken: the reply is read aloud as after a voice prompt (Gemini speech, envelope, playback).
      ask: (q: string, spoken = false) => send(q, spoken),
      // Drives the wave like a voice would, for cdp.mjs walks with nobody speaking (null hands it back).
      wave: setWaveLevel,
      // A reply's WAV through the real playback (envelope, speakerphone, wave), when the speech model is out of quota.
      play: (wav: Uint8Array) => play(wav, setWaveLevel),
      theme: (pref: ThemePref) => pickTheme(pref),
      openSearch: (q = "") => {
        setQuery(q);
        openSearch();
      },
    };
  }, [continueItems, reminders, assistant]);

  useEffect(() => {
    if (view !== "search") return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      // Without a server the TV searches the catalogs itself.
      const found: Promise<SearchResult[]> = SERVER_URL
        ? fetch(`${SERVER_URL}/search?q=${encodeURIComponent(q)}`)
            .then((r) => (r.ok ? r.json() : { results: [] }))
            .then((body: { results?: SearchResult[] }) => body.results ?? [])
        : searchCatalogs(q);
      found
        .then((list) => {
          if (!live) return;
          setResults(list);
          setSearching(false);
        })
        .catch(() => {
          if (!live) return;
          setResults([]);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [view, query]);

  const menuItems = [
    cloudEnabled ? (me ? "Switch profile" : "Sign in to Nuvio") : "Profiles",
    "TV settings",
    THEME_LABEL[themePref],
    speakReplies ? "🔊 Spoken replies: on" : "🔇 Spoken replies: off",
  ];
  const navKey = rowLayout(columns).nav.map((c) => `${c.count}/${c.across}`).join();
  const layout: Layout = useMemo(
    () => ({
      weather: Boolean(weather),
      ask: CHIPS.length,
      // While an answer is shown it takes the row's place.
      cols: shownTurn ? [] : rowLayout(columns).nav,
      results: shownResults?.length ?? 0,
      menu: menuOpen ? menuItems.length : 0,
    }),
    [navKey, shownTurn, Boolean(weather), menuOpen],
  );

  // Keep focus valid when a card's items change. Focus waits on the row while it is still empty, so the first card is
  // focused once Continue Watching, the trending titles or the apps arrive.
  useEffect(() => {
    if (focus.area === "row" && !layout.cols.some((c) => c.count > 0) && !shownTurn && !error) return;
    const next = clamp(focus, layout);
    if (next.area !== focus.area || next.i !== focus.i || next.col !== focus.col) setFocus(next);
  }, [layout]);

  const showRecent = view === "search" && !query.trim() && recentSearches.length > 0;
  const searchLengths = useMemo(
    () => [
      ...KEY_ROWS.map((r) => r.length),
      ...(showRecent ? [recentSearches.length + 1] : []),
      ...(results.length ? [results.length] : []),
    ],
    [showRecent, recentSearches.length, results.length],
  );

  useEffect(() => {
    const r = Math.min(searchFocus.row, searchLengths.length - 1);
    const c = Math.min(searchFocus.col, Math.max(0, (searchLengths[r] ?? 1) - 1));
    if (r !== searchFocus.row || c !== searchFocus.col) setSearchFocus({ row: r, col: c });
  }, [searchLengths]);

  /** OK on a Recent card: back to what that answer was about. */
  const openRecent = (card: RecentCard) => {
    if (card.kind === "alert") return homeConfigured() ? void setView("lights") : undefined;
    const turn = talk.turns.find((t) => `t${t.id}` === card.key);
    if (!turn) return;
    if (turn.action === "watch") {
      setShownTurn(turn);
      if (turn.results?.length) setFocus({ area: "results", i: 0 });
      return;
    }
    if (turn.action === "weather") return weather ? setWeatherOpen(true) : undefined;
    if (turn.action === "domotics_updated") return homeConfigured() ? void setView("lights") : nextScene();
    if (turn.action === "reminder_added") return focusReminders(reminders.findIndex((r) => !r.completed && turn.reply.includes(r.text)));
    void send(turn.prompt);
  };

  /** The Reminders card, at reminder `at` (or its first). */
  function focusReminders(at = 0) {
    const col = columns.findIndex((c) => c.key === "reminders");
    if (col >= 0) setFocus({ area: "row", col, i: Math.max(0, Math.min(at, 2)) });
  }

  function toggleReminderAt(r: Reminder) {
    if (localRem.owns(r.id)) setLocalItems(localRem.toggle(r.id));
    else if (SERVER_URL) toggleReminder(SERVER_URL, r.id).then(applyReminders, () => flash("Couldn't update the reminder"));
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
    if (i === 2) return pickTheme(THEME_PREFS[(THEME_PREFS.indexOf(themePref) + 1) % THEME_PREFS.length]);
    toggleSpeech();
  };

  const activate = () => {
    const { area, i } = focus;
    if (area === "menu") return runMenu(i);
    if (area === "header") {
      if (i === HEADER_PROFILE) {
        setWeatherOpen(false);
        setMenuOpen(true);
        return setFocus({ area: "menu", i: 0 });
      }
      if (i === HEADER_WEATHER) return setWeatherOpen((o) => !o);
      if (i === HEADER_PARTY) return void setView("party");
      if (i === HEADER_SEARCH) return openSearch();
      if (i === HEADER_LIGHTS) return homeConfigured() ? void setView("lights") : nextScene();
      if (i === HEADER_BELL) {
        const due = reminders.findIndex((r) => !r.completed);
        if (due < 0) return flash("No open reminders");
        return focusReminders(due);
      }
      return;
    }
    if (area === "ask") return void (i === 0 ? listen() : send(CHIPS[i].prompt));
    if (area === "results") {
      const hit = shownResults?.[i];
      if (hit) openHit(hit);
      return;
    }
    if (area === "row") columns[focus.col ?? 0]?.run(i);
  };

  useKeys(view === "home", (key) => {
    // Channel Down (CH-) or Search opens Spotlight Search from anywhere.
    if (key === "ChannelDown" || key === "Search") {
      openSearch();
      flash("⌕ Spotlight Search · 🎤 for TV voice");
      return;
    }
    // The microphone key talks to Ask Nest on the home screen; Green cycles the theme, Blue mutes spoken replies.
    if (key === "SearchVoice") return void listen();
    if (key === "Blue") return toggleSpeech();
    if (key === "Green") return pickTheme(THEME_PREFS[(THEME_PREFS.indexOf(themePref) + 1) % THEME_PREFS.length]);
    if (key === "ChannelUp") {
      getTvInputBridge().close();
      setImeActive(false);
      setFocus({ area: "header", i: HEADER_SEARCH });
      return;
    }
    if (key === "Enter") return void activate();
    if (menuOpen && key === "Back") return closeMenu();
    if (menuOpen && (key === "Left" || key === "Right")) return;
    if (weatherOpen && (key === "Back" || key === "Up" || key === "Down" || key === "Left" || key === "Right")) {
      setWeatherOpen(false);
      if (key === "Back") return;
    }
    if (key === "Back" && shownTurn) {
      setShownTurn(null);
      setFocus({ area: "ask", i: 0 });
      return;
    }
    if (key === "Back") {
      const now = performance.now();
      if (now - lastBack.current < EXIT_WINDOW_MS) return void exitApp();
      lastBack.current = now;
      flash("Press Back again to leave the perch");
      return;
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = step(focus, key, layout);
      if (next !== focus) setFocus(next);
      return;
    }
    return false;
  });

  useKeys(view === "search", (key) => {
    if (key === "ChannelUp") return void setView("home");
    if (key === "SearchVoice") return void summonTvKeyboard(query);
    if (key === "Back") {
      if (query.trim().length > 0) {
        setQuery("");
        setSearchFocus({ row: 0, col: 0 });
        return;
      }
      setView("home");
      return;
    }
    if (key === "Enter") {
      const { row, col } = searchFocus;
      if (row < KEY_ROWS.length) {
        const k = KEY_ROWS[row]?.[col];
        if (!k) return;
        if (k === "SPACE") setQuery((q) => `${q} `);
        else if (k === "⌫") setQuery((q) => q.slice(0, -1));
        else if (k === "CLEAR") setQuery("");
        else if (k.startsWith("🎤")) summonTvKeyboard(query);
        else setQuery((q) => q + k.toLowerCase());
        return;
      }
      if (showRecent && row === RECENT_ROW) {
        if (col < recentSearches.length) {
          const picked = recentSearches[col];
          setQuery(picked);
          setRecentSearches(saveRecent(picked));
        } else {
          setRecentSearches(clearRecent());
          flash("Cleared recent searches");
        }
        return;
      }
      const hit = results[col];
      if (hit) {
        if (query.trim().length >= 2) setRecentSearches(saveRecent(query));
        openTitleInApp(SERVER_URL, hit.type, hit.title).catch(() => flash(`Couldn't open ${hit.title.name}`));
      }
      return;
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = move(searchLengths, searchFocus, key.toLowerCase() as Dir);
      if (next !== searchFocus) setSearchFocus(next);
      return;
    }
    return false;
  });

  // A physical keyboard types into the search too.
  useEffect(() => {
    if (view !== "search" || imeActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Backspace") {
        e.preventDefault();
        setQuery((q) => q.slice(0, -1));
      } else if (e.key.length === 1 && /^[a-z0-9 ]$/i.test(e.key)) {
        setQuery((q) => q + e.key.toLowerCase());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, imeActive]);

  const serverStatus = SERVER_URL ? (serverOnline ? "Server online" : "Server offline") : "";
  const status =
    error ??
    (cloudEnabled
      ? me
        ? `Nuvio · OK to switch profile${serverStatus ? ` · ${serverStatus}` : ""}`
        : "Not signed in · OK to sign in to Nuvio"
      : SERVER_URL
        ? serverOnline
          ? "Server online · CH- to search"
          : "Server offline · apps still work"
        : "No server configured");
  const searchStatus = !query.trim()
    ? "Hunt across Secretary Cinema, Shows and Anime"
    : searching
      ? "Scouring the tall grass…"
      : `${results.length} result${results.length === 1 ? "" : "s"}`;

  const lastAnswer = talk.turns[talk.turns.length - 1];
  const pending = talk.pending;
  const wave = waveState({ listening, asking, pending: Boolean(pending), answered });
  const askView = {
    wave,
    status: WAVE_STATUS[wave] || (lastAnswer?.source === "companion" ? "From your phone" : ""),
    history: (pending ? talk.turns : talk.turns.slice(0, -1)).slice(-3).map((t) => t.prompt),
    prompt: listening ? undefined : (pending?.prompt ?? lastAnswer?.prompt),
    reply: pending ? "" : (lastAnswer?.reply ?? summary ?? "Ask for something to watch, a reminder, or the lights."),
    turnId: lastAnswer?.id ?? 0,
  };

  return (
    <GlassRoot mode="fake" wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} class={theme === "day" ? "nest sg-day" : "nest"}>
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
      ) : view === "party" ? (
        <WatchTogether onClose={() => setView("home")} />
      ) : view === "lights" ? (
        <LightsPanel devices={devices} scenes={scenes} onChange={() => pollHomeSoon()} onClose={() => setView("home")} />
      ) : view === "search" ? (
        <Search
          focus={searchFocus}
          time={time}
          query={query}
          imeActive={imeActive}
          recent={recentSearches}
          showRecent={showRecent}
          results={results}
          status={searchStatus}
        />
      ) : (
        <Home
          focus={focus}
          time={time}
          ask={askView}
          results={shownTurn ? { query: shownTurn.query ?? "", items: shownResults ?? [] } : null}
          weather={weather}
          weatherOpen={weatherOpen}
          menu={menuOpen ? menuItems : null}
          glow={glow}
          columns={columns}
          open={reminders.filter((r) => !r.completed).length}
          status={status}
          me={me}
        />
      )}
      {toast && (
        <Glass x={560} y={1000} w={800} h={60} class="nest-toast">
          <span>{toast}</span>
        </Glass>
      )}
    </GlassRoot>
  );
}
