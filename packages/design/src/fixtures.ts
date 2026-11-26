// Fixture data for the real screens, typed against their own props so `pnpm typecheck` catches drift.
// Invented titles and places only (CLAUDE.md: no sources).
import type { HostApp } from "@secretary/catalog-kit/src/host.ts";
import { type DashboardSettings, DEFAULT_SETTINGS } from "@secretary/catalog-kit/src/lib/settings.ts";
import type { HomeRow, Title } from "@secretary/catalog-kit/src/lib/types.ts";
import type { SearchResult } from "@secretary/launcher/src/apps.ts";
import type { Weather } from "@secretary/launcher/src/assistant.ts";
import { type CardStyle, collapsedShape, styleFor } from "@secretary/launcher/src/card-style.ts";
import { coverPicks } from "@secretary/launcher/src/card-covers.ts";
import type { MediaItem, RowColumn } from "@secretary/launcher/src/cards.tsx";
import type { RecState } from "@secretary/launcher/src/recommend.ts";
import { appIcon } from "@secretary/launcher/src/app-icons.ts";
import { episodeLabel } from "@secretary/launcher/src/card-rows.ts";
import { YOUTUBE_APP_ID } from "@secretary/launcher/src/config.ts";
import type { AskView } from "@secretary/launcher/src/home.tsx";
import { lightCount, lightsOnLabel } from "@secretary/launcher/src/light-count.ts";
import type { SmartThings } from "@secretary/smartthings";
import type { SmartThingsSetup } from "@secretary/launcher/src/smartthings-settings.tsx";
import type { StDevice, StRoom, StScene } from "@secretary/smartthings";
import { type Art, TITLES } from "./art.ts";

const noop = () => {};

export const WEATHER: Weather = {
  tempC: 14,
  label: "Partly cloudy",
  icon: "⛅",
  glyph: "partly",
  place: "Example Bay",
  hours: ["15", "16", "17", "18", "19", "20"].map((hour, i) => ({
    hour,
    tempC: 14 - Math.floor(i / 2),
    glyph: i < 2 ? "partly" : i < 4 ? "cloud" : "rain",
  })),
  days: ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((date, i) => ({
    date,
    minC: 6 + i,
    maxC: 14 - i,
    glyph: (["partly", "rain", "cloud", "clear"] as const)[i],
  })),
};

export const ASK_IDLE: AskView = {
  wave: "idle",
  status: "",
  reply: "",
  turnId: 1,
  focused: false,
  full: false,
};

export const ASK_ANSWER: AskView = {
  wave: "speaking",
  status: "",
  prompt: "Films set by the sea",
  reply: "Here are six by the sea. The Quiet Harbour is the one you started last week.",
  turnId: 2,
  focused: false,
  full: false,
};

const title = (art: Art, i: number): Title => ({
  id: `dz:${i}`,
  name: TITLES[i % TITLES.length],
  year: String(1998 + ((i * 7) % 27)),
  rating: (6 + ((i * 3) % 30) / 10).toFixed(1),
  description: "A placeholder title drawn by the design workbench.",
  genre: ["Drama"],
  runtime: `${95 + i * 4} min`,
  poster: art.posters[i % art.posters.length],
  background: art.backgrounds[i % art.backgrounds.length],
});

/** A media card's titles: the first `going` in progress, the rest picks, ranked on the day's list (`list`). */
function media(art: Art, from: number, n: number, going: number, sub: (i: number) => string, list?: string): MediaItem[] {
  return Array.from({ length: n }, (_, k) => {
    const i = (from + k) % TITLES.length;
    return {
      poster: art.posters[i],
      still: art.stills[i],
      title: TITLES[i],
      sub: sub(k),
      rating: (6 + ((i * 3) % 30) / 10).toFixed(1),
      about: "A placeholder synopsis drawn by the design workbench, long enough to show how three lines of a title's description sit under its name on the opened card.",
      // Most titles have a Fanart.tv logo (titleArt); every third has none, so its name shows instead.
      ...(i % 3 !== 2 ? { logo: art.logos[i] } : {}),
      ...(k < going ? { resume: true, progress: 0.25 + 0.15 * k, left: `${42 - k * 9} min left` } : k === going ? { badge: "Top pick" } : {}),
      ...(k >= going && list ? { rank: `No. ${k - going + 1} in ${list}` } : {}),
    };
  });
}

/** The first `n` titles as episodes in progress, as app.tsx names them (card-rows.ts episodeLabel): one with no real name. */
function withEpisodes(items: MediaItem[], n: number): MediaItem[] {
  const names = ["The Long Night", "Episode 5", "A Door in the Fog"];
  return items.map((it, k) => {
    if (k >= n) return it;
    const episode = episodeLabel({ season: k + 1, episode: k + 3, name: names[k % names.length] });
    return { ...it, sub: episode, episode };
  });
}

/** The end bar's "Recommend me" in each state, as the cards show it: Cinema asked nothing, Shows is asking, Anime has picks. */
const RECS: Record<string, RecState | undefined> = {
  cinema: undefined,
  shows: { status: "loading" },
  anime: {
    status: "ready",
    items: TITLES.slice(5, 13).map((name, k) => ({ type: "anime", title: { id: `dz:rec${k}`, name, year: "2023", rating: "7.8" } })),
    reply: "Here are top anime worth a look.",
  },
};

/** Today's styles unless the workbench's own menu changed them (`styles`). `turn` is the covers' turn (card-covers.ts):
 *  the folded cards show other titles on each, none twice. */
export function nestColumns(art: Art, styles: Record<string, CardStyle> = {}, turn = 0): RowColumn[] {
  const onCovers = new Set<string>();
  const covers = (all: MediaItem[], style: CardStyle) =>
    coverPicks(all, collapsedShape(style).count, turn, onCovers, (it) => ({ id: it.title, name: it.title }));
  // As app.tsx builds them: Continue watching first (landscape stills), then the picks, My List, the genres, and on
  // Anime the assistant's picks above the end bar.
  const card = (key: string, name: string, unit: string, all: MediaItem[], going: number): RowColumn => ({
    kind: "media",
    key,
    name,
    unit,
    // One word, whatever the card holds (app.tsx MEDIA).
    label: name,
    episodes: key !== "cinema",
    items: going ? all.slice(0, going) : all,
    small: covers(all, styleFor(styles, key)),
    heading: going ? "Continue watching" : "Tonight's picks",
    wide: going > 0,
    style: styleFor(styles, key),
    run: noop,
    recommend: noop,
    seeAll: noop,
    recs: RECS[key],
    more: [
      ...(going ? [{ label: "Tonight's picks", items: all.slice(going), run: noop }] : []),
      ...["My List", `Action ${unit}`, `Comedy ${unit}`].map((label, r) => ({
        label,
        items: media(art, r * 3, 10, 0, () => "2024"),
        run: noop,
      })),
      ...(RECS[key]?.status === "ready" ? [{ label: "Picked for you", items: media(art, 5, 8, 0, () => "2023"), run: noop }] : []),
    ],
  });
  return [
    {
      kind: "assistant",
      key: "assistant",
      label: "Assistant",
      run: noop,
      greeting: "Good afternoon, Sworm",
      lines: ["2 reminders", "Call the plumber · Today, 17:00"],
    },
    { kind: "weather", key: "weather", label: "Weather", run: noop, weather: WEATHER },
    { kind: "calendar", key: "calendar", label: "Calendar", run: noop, date: new Date(2026, 10, 20) },
    card("cinema", "Cinema", "films", media(art, 0, 10, 2, () => "2019", "today's popular films"), 2),
    card("shows", "Shows", "shows", withEpisodes(media(art, 2, 8, 3, (k) => (k < 3 ? "" : "2022"), "today's popular shows"), 3), 3),
    card("anime", "Anime", "titles", media(art, 4, 8, 0, () => "12 episodes", "today's trending anime"), 0),
    {
      kind: "videos",
      key: "youtube",
      label: "YouTube",
      run: noop,
      videos: [0, 1, 2].map((k) => ({ title: ["A long walk through Example Bay", "Ten tips for tidy shelves", "Live: the evening news"][k], channel: ["Example Channel", "Home Hacks", "News Desk"][k], thumb: art.stills[k % art.stills.length] })),
    },
    {
      kind: "folders",
      key: "nuvio:example",
      label: "Weekend marathons",
      run: noop,
      folders: ["Space operas", "Slow burns", "Heists", "Road trips"].map((title, k) => ({ title, cover: art.posters[k % art.posters.length] })),
    },
    { key: "home", label: "Home", run: noop, kind: "home", title: lightsOnLabel(lightCount(LIGHT_DEVICES)), sub: "120 lux in the room", actions: [{ icon: "cinema", label: "Cinema" }, { icon: "warm", label: "Warm" }, { icon: "power", label: "Off" }, { icon: "music", label: "Music" }] },
    {
      key: "reminders",
      label: "Reminders",
      run: noop,
      kind: "list",
      items: [
        { title: "Call the plumber", sub: "Today, 17:00", color: "#ff5a26" },
        { title: "Bins out", sub: "Tonight", color: "#5a8cff" },
        { title: "Water the plants", sub: "Done", done: true },
      ],
      add: "Add a reminder",
    },
    {
      key: "apps",
      label: "Apps",
      run: noop,
      kind: "apps",
      apps: [
        // The TV's other apps. Cinema, Shows and Anime are cards inside Secretary, never apps here.
        { icon: art.icons[0], label: "Music" },
        { icon: art.icons[1], label: "Browser" },
        { icon: art.icons[2], label: "Gallery" },
        { icon: art.icons[3], label: "User Guide" },
        // Their own icons (launcher app-icons.ts): the TV reports a placeholder for these two.
        { icon: appIcon({ id: YOUTUBE_APP_ID, name: "YouTube" }), label: "YouTube" },
        { icon: appIcon({ id: "dz.workspace", name: "Workspace" }), label: "Workspace" },
      ],
    },
    // Last, as on the TV: it puts back the cards taken off the home row (none here).
    { key: "add", label: "Add to home", run: noop, kind: "list", items: [], add: "Everything is on the home screen" },
  ];
}

export function catalogRows(art: Art): HomeRow[] {
  const row = (id: string, name: string, from: number, n: number, extra: Partial<Title> = {}): HomeRow => ({
    id,
    title: name,
    items: Array.from({ length: n }, (_, k) => ({ ...title(art, from + k), ...extra })),
  });
  const cont = row("continue", "Continue watching", 0, 4);
  // The first has a logo (the catalog home hero shows it once focus rests); the others show their names.
  cont.items = cont.items.map((t, k) => ({ ...t, progressPct: 20 + k * 18, badge: k === 1 ? "Next · S01E03" : undefined, ...(k === 0 ? { logo: art.logos[0] } : {}) }));
  const fresh = row("new", "New releases", 2, 10);
  fresh.items = fresh.items.map((t, k) => (k % 3 === 1 ? { ...t, watched: true } : t));
  return [cont, row("popular", "Popular", 4, 12), fresh, row("mylist", "My list", 6, 6)];
}

/**
 * The search screen's finder (launcher/src/search.tsx): the invented titles, in films, shows and anime, matched by
 * word start after a short wait, as a server would answer. Honours the abort, as the real one does.
 */
/** A search with no catalog answering, as on a TV without internet: each request fails after a short wait. */
export const searchOffline = (_q: string, signal: AbortSignal): Promise<SearchResult[]> =>
  new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error("The catalogs are not answering")), 400);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export function searchFixture(art: Art): (q: string, signal: AbortSignal) => Promise<SearchResult[]> {
  const kinds = ["movie", "series", "anime"] as const;
  const all: SearchResult[] = Array.from({ length: 36 }, (_, i) => ({
    type: kinds[i % 3],
    title: {
      id: `dz:s${i}`,
      name: i < TITLES.length ? TITLES[i] : `${TITLES[i % TITLES.length]} ${["II", "Returns", "Stories"][Math.floor(i / TITLES.length) - 1]}`,
      year: String(1996 + ((i * 5) % 29)),
      rating: (6 + ((i * 7) % 35) / 10).toFixed(1),
      poster: art.posters[i % art.posters.length],
    },
  }));
  return (q, signal) =>
    new Promise((resolve, reject) => {
      const words = q.toLowerCase().split(" ").filter(Boolean);
      const t = setTimeout(
        () => resolve(all.filter((r) => words.every((w) => r.title.name.toLowerCase().split(" ").some((n) => n.startsWith(w))))),
        180 + Math.random() * 220,
      );
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
}

/** Recent searches for the empty search screen. */
export const RECENT_SEARCHES = ["northern lights", "night ferry", "copper"];

// The lights panel (launcher/src/lights.tsx): a made-up home of four rooms, a few devices in none, and enough routines
// to scroll. Ids are invented; nothing here reaches SmartThings.
const HOME = "loc-home";
export const LIGHT_ROOMS: StRoom[] = [
  { id: "room-living", name: "Living room", locationId: HOME },
  { id: "room-kitchen", name: "Kitchen", locationId: HOME },
  { id: "room-bed", name: "Bedroom", locationId: HOME },
  { id: "room-study", name: "Study", locationId: HOME },
  { id: "room-hall", name: "Hallway", locationId: HOME },
];

const lamp = (id: string, name: string, roomId: string | undefined, on: boolean, extra: Partial<StDevice> = {}): StDevice => ({
  id,
  name,
  kind: "light",
  local: false,
  dimmable: false,
  on,
  locationId: HOME,
  ...(roomId ? { roomId } : {}),
  ...extra,
});

export const LIGHT_DEVICES: StDevice[] = [
  lamp("d-couch", "Couch light", "room-living", true, { dimmable: true, level: 40, local: true }),
  lamp("d-side-l", "Side light left", "room-living", true, { dimmable: true, level: 65, colour: true, local: true }),
  lamp("d-side-r", "Side light right", "room-living", false, { colour: true, local: true }),
  lamp("d-reading", "Reading lamp", "room-living", false),
  { ...lamp("d-amp", "Sound system", "room-living", true), kind: "audio" },
  lamp("d-ceiling", "Ceiling", "room-kitchen", false, { dimmable: true }),
  lamp("d-counter", "Counter strip", "room-kitchen", true, { dimmable: true, level: 100 }),
  lamp("d-bedside-1", "Bedside one", "room-bed", false, { dimmable: true }),
  lamp("d-bedside-2", "Bedside two", "room-bed", false, { dimmable: true }),
  lamp("d-desk", "Desk lamp", "room-study", true),
  lamp("d-porch", "Porch", undefined, false),
  lamp("d-garden", "Garden string lights", undefined, true),
  { ...lamp("d-tv", "Television", "room-living", true), kind: "tv" },
];

export const LIGHT_SCENES: StScene[] = [
  { id: "scene-film", name: "Film night", locationId: HOME, lastRun: Date.now() - 26 * 3600_000 },
  { id: "scene-after", name: "After the film: hallway and kitchen", locationId: HOME },
  { id: "scene-wake", name: "Good morning", locationId: HOME, lastRun: Date.now() - 9 * 3600_000 },
  { id: "scene-dinner", name: "Dinner", locationId: HOME },
  { id: "scene-read", name: "Reading corner", locationId: HOME },
  { id: "scene-off", name: "Everything off", locationId: HOME, lastRun: Date.now() - 40 * 60_000 },
  { id: "scene-fail", name: "Away (fails here)", locationId: HOME },
];

/** SmartThings as the Mood panel and Settings call it, answering after a short wait; "Away" is refused, to show the failure. */
export const LIGHTS_API: Pick<SmartThings, "runScene" | "command" | "roomsIn"> = {
  runScene: (id) => new Promise((ok, no) => setTimeout(() => (id === "scene-fail" ? no(new Error("refused")) : ok({ status: "success" })), 900)),
  command: () => new Promise((ok) => setTimeout(() => ok({ results: [] }), 300)),
  roomsIn: () => new Promise((ok) => setTimeout(() => ok(LIGHT_ROOMS), 400)),
};

/** Settings › SmartThings on the fixture home: switches land after a short wait and stay for the page's life. */
export function smartThingsFixture(devices: StDevice[], onChange: () => void): SmartThingsSetup {
  return {
    devices,
    scenes: LIGHT_SCENES,
    rooms: LIGHT_ROOMS,
    command: (id, c) => LIGHTS_API.command(id, c).then(() => {
      const d = devices.find((x) => x.id === id);
      if (d) d.on = !d.on;
      onChange();
    }),
    onChange,
  };
}

/** The TV's apps as Settings › Apps lists them (made-up ids; the TV's own settings are left out, as Secretary does). */
export const SETTINGS_APPS: HostApp[] = [
  { id: "AAAAAAAAAA.browser", name: "Browser" },
  { id: "BBBBBBBBBB.gallery", name: "Gallery" },
  { id: "CCCCCCCCCC.music", name: "Music" },
  { id: "DDDDDDDDDD.photos", name: "Photos" },
  { id: "EEEEEEEEEE.radio", name: "Radio" },
  { id: "FFFFFFFFFF.guide", name: "User Guide" },
  { id: "111299001912", name: "YouTube", note: "Has its own card on the home screen too" },
];

/** Settings as a viewer left them: spoiler protection on Blur, home notifications off, the guide and YouTube hidden. */
export const SETTINGS_FIXTURE: DashboardSettings = {
  ...DEFAULT_SETTINGS,
  playback: { ...DEFAULT_SETTINGS.playback, spoilerProtection: "blur" },
  home: { ...DEFAULT_SETTINGS.home, homeAlerts: false, hiddenApps: ["FFFFFFFFFF.guide", "111299001912"] },
};
