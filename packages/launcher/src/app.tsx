import { type Dir, exitApp, type Focus as GridFocus, getTvInputBridge, move, useKeys } from "@secretary/tv-kit";
import { artColour, type Backdrop, drawBackdrop, Glass, GlassRoot, glowImage, TINTS } from "@secretary/tv-kit/src/glass/index.ts";
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
import { cloud, cloudEnabled, signInSkipped, skipSignIn } from "./cloud.ts";
import { APP_IDS, HIDE, PINS, SERVER_URL } from "./config.ts";
import { Home } from "./home.tsx";
import { clamp, type Focus, type Lengths, SECTIONS, step, TOP_BELL, TOP_LENGTH, TOP_LIGHTS, TOP_PARTY, TOP_SEARCH } from "./nest-nav.ts";
import { home, homeConfigured } from "./home-control.ts";
import { LightsPanel } from "./lights.tsx";
import { WatchTogether } from "./party.tsx";
import { KEY_ROWS, RECENT_ROW, Search } from "./search.tsx";
import { play, record, type Recording } from "./voice.ts";
import { homeAction, homeAlerts, roomLux, type StDevice, type StScene } from "@secretary/smartthings";

const EXIT_WINDOW_MS = 2000;
const SEARCH_DEBOUNCE_MS = 250;
const RECENT_SEARCH_KEY = "sectv:recent-searches:v1";
const MAX_RECENT_SEARCHES = 8;
const THEME_KEY = "nest.theme";
const SPEAK_KEY = "nest.speak";
/** How often Nest asks the server what the assistant is doing (prompts from the phone show up this fast). */
const ASSISTANT_POLL_MS = 2500;
const WEATHER_POLL_MS = 10 * 60_000;
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

const SECTION_APPS =[undefined, APP_IDS.movie, APP_IDS.series, APP_IDS.anime] as const;
const SCENES: readonly [Scene, string][] = [
  ["cinema", "🎬 Cinema lights"],
  ["warm", "🕯 Warm lights"],
  ["off", "🌙 Lights off"],
];

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
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [summary, setSummary] = useState<string | undefined>();
  const [serverOnline, setServerOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "search" | "signin" | "profiles" | "party" | "lights">(() =>
    cloudEnabled && !cloud.session.signedIn() && !signInSkipped() ? "signin" : "home",
  );
  const [me, setMe] = useState<{ name: string; color?: string; img?: string } | null>(null);
  const [focus, setFocus] = useState<Focus>({ area: "apps", i: 0 });
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
  const [weather, setWeather] = useState<Weather | null>(null);
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

  /** Types a new reminder with the TV keyboard and saves it on the server. */
  const newReminder = () => {
    if (!SERVER_URL) return flash("Reminders need Secretary Server");
    const opened = getTvInputBridge().open("", {
      onCommit: (val) => {
        const text = val.trim();
        if (!text) return;
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
    if (turn.action === "reminder_added" && SERVER_URL) fetchReminders(SERVER_URL).then(applyReminders, () => {});
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
      const done =
        act.kind === "scene"
          ? home.runScene(act.scene.id)
          : Promise.all(act.targets.map((t) => home.command(t.device.id, t.commands)));
      return void done.then(pollHomeSoon, () => flash("SmartThings didn't take that; try again"));
    }
    if (!SERVER_URL) return flash("Ask Nest needs Secretary Server");
    setAsking(true);
    let speech: string | null | undefined;
    try {
      speech = (await askNest(SERVER_URL, prompt, fetch, spoken && speakReplies)).speech;
      applyAssistant(await fetchAssistant(SERVER_URL));
    } catch {
      flash("Couldn't reach the assistant");
    } finally {
      setAsking(false);
    }
    if (speech) {
      // The wave keeps speaking for as long as the reply plays, not just SPEAK_MS.
      clearTimeout(speakTimer.current);
      setAnswered(true);
      await play(speech);
      setAnswered(false);
    }
  };

  /**
   * The mic key: a clip from the room microphone (docs/launcher.md, "Room microphone"), the key again to stop early.
   * Falls back to the TV keyboard's dictation when the TV gives the app no microphone or the server cannot transcribe.
   */
  const listen = async () => {
    if (!SERVER_URL) return flash("Ask Nest needs Secretary Server");
    if (recording.current) return recording.current.stop();
    if (keyboardOnly.current) return openAsk();
    let rec: Recording;
    try {
      rec = await record();
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
      words = await transcribeClip(SERVER_URL, clip);
    } catch (e) {
      const reason = e instanceof VoiceError ? e.reason : "failed";
      if (reason === "unavailable") {
        keyboardOnly.current = true;
        flash("Voice needs a Gemini key on the server");
      } else {
        flash(reason === "no-speech" ? "Didn't catch that" : "Couldn't reach the assistant");
      }
    } finally {
      setAsking(false);
    }
    if (words) await send(words, true);
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
    if (!SERVER_URL) return flash("Ask Nest needs Secretary Server");
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
      flash(`No TV keyboard here: ask from your phone at ${SERVER_URL}/companion`);
    } else {
      flash("🎤 Speak or type, then OK");
    }
  };

  const nextScene = () => {
    if (!SERVER_URL) return flash("Lights need Secretary Server");
    const [id, label] = SCENES[scene.current];
    scene.current = (scene.current + 1) % SCENES.length;
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
    setFocus({ area: "me", i: 0 });
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

  useEffect(() => {
    if (!SERVER_URL) return;
    const get = () => void fetchWeather(SERVER_URL).then(setWeather);
    get();
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
        if (lastDevices.current) for (const a of homeAlerts(lastDevices.current, next)) flash(a.text);
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
  const focusedArt: { src: string; type: CatalogKind } | null =
    focus.area === "continue" && continueItems[focus.i]
      ? { src: backdropUrl(continueItems[focus.i]), type: continueItems[focus.i].type }
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
      ask: (q: string) => send(q),
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
    if (!q || !SERVER_URL) {
      setResults([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`${SERVER_URL}/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((body: { results?: SearchResult[] }) => {
          if (!live) return;
          setResults(body.results ?? []);
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

  const lengths: Lengths = useMemo(
    () => ({
      top: TOP_LENGTH,
      apps: apps.length,
      cards: reminders.length,
      ask: SERVER_URL ? CHIPS.length : 0,
      results: shownResults?.length ?? 0,
      continue: shownTurn ? 0 : continueItems.length,
      fab: 1,
      me: cloudEnabled ? 1 : 0,
    }),
    [apps.length, reminders.length, continueItems.length, shownTurn],
  );

  // Keep focus valid when reminders and Continue Watching change. Focus waits on the app strip
  // while the apps are still loading, so the first chip is focused once they arrive.
  useEffect(() => {
    if (focus.area === "apps" && !apps.length && !error) return;
    const next = clamp(focus, lengths);
    if (next !== focus) setFocus(next);
  }, [lengths]);

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

  const activate = () => {
    const { area, i } = focus;
    if (area === "top") {
      if (i === TOP_PARTY) return void setView("party");
      if (i === TOP_SEARCH) return openSearch();
      if (i === TOP_LIGHTS) return homeConfigured() ? void setView("lights") : nextScene();
      if (i === TOP_BELL) {
        const due = reminders.findIndex((r) => !r.completed);
        if (due < 0) return flash("No open reminders");
        return setFocus({ area: "cards", i: due });
      }
      const id = SECTION_APPS[i];
      if (id) openApp(id).catch(() => flash(`Couldn't open ${SECTIONS[i]}`));
      return;
    }
    if (area === "apps") {
      const app = apps[i];
      if (app) openApp(app.id).catch(() => flash(`Couldn't open ${app.name}`));
      return;
    }
    if (area === "cards") {
      const r = reminders[i];
      if (r && SERVER_URL) {
        toggleReminder(SERVER_URL, r.id).then(applyReminders, () => flash("Couldn't update the reminder"));
      }
      return;
    }
    if (area === "ask") return void (i === 0 ? listen() : send(CHIPS[i].prompt));
    if (area === "results") {
      const hit = shownResults?.[i];
      if (hit) openTitleInApp(SERVER_URL, hit.type, hit.title).catch(() => flash(`Couldn't open ${hit.title.name}`));
      return;
    }
    if (area === "me") return void setView(cloud.session.signedIn() ? "profiles" : "signin");
    if (area === "continue") {
      const entry = continueItems[i];
      if (entry) {
        openTitleInApp(SERVER_URL, entry.type, entry.title, true).catch(() => flash(`Couldn't open ${entry.title.name}`));
      }
      return;
    }
    newReminder();
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
      setFocus({ area: "top", i: TOP_SEARCH });
      return;
    }
    if (key === "Enter") return void activate();
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
      const next = step(focus, key, lengths);
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

  const lastAnswer = assistant?.turns[assistant.turns.length - 1];
  const pending = assistant?.pending ?? null;
  const wave = waveState({ listening, asking, pending: Boolean(pending), answered });
  const askView = {
    wave,
    status: WAVE_STATUS[wave] || (lastAnswer?.source === "companion" ? "From your phone" : ""),
    prompt: listening ? undefined : (pending?.prompt ?? lastAnswer?.prompt),
    reply: pending ? "" : (lastAnswer?.reply ?? summary ?? "Ask for something to watch, a reminder, or the lights."),
    turnId: lastAnswer?.id ?? 0,
    online: Boolean(SERVER_URL),
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
          apps={apps}
          reminders={reminders}
          ask={askView}
          results={shownTurn ? { query: shownTurn.query ?? "", items: shownResults ?? [] } : null}
          weather={weather}
          glow={glow}
          continueItems={continueItems}
          serverOnline={serverOnline}
          status={status}
          me={me}
          emptyContinue={
            (cloudEnabled ? Boolean(me) : serverOnline)
              ? "Nothing in progress. Start something in Cinema, Shows or Anime."
              : cloudEnabled
                ? "Sign in to Nuvio to see what you were watching."
                : "Continue Watching needs Secretary Server."
          }
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
