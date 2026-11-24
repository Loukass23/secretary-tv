// Fixture data for the real screens, typed against their own props so `pnpm typecheck` catches drift.
// Invented titles and places only (CLAUDE.md: no sources).
import type { HomeRow, Title } from "@secretary/catalog-kit/src/lib/types.ts";
import type { Weather } from "@secretary/launcher/src/assistant.ts";
import { type CardStyle, styleFor } from "@secretary/launcher/src/card-style.ts";
import type { MediaItem, RowColumn } from "@secretary/launcher/src/cards.tsx";
import type { RecState } from "@secretary/launcher/src/recommend.ts";
import type { AskView } from "@secretary/launcher/src/home.tsx";
import type { LightsApi } from "@secretary/launcher/src/lights.tsx";
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
      ...(k < going ? { resume: true, progress: 0.25 + 0.15 * k } : k === going ? { badge: "Top pick" } : {}),
      ...(k >= going && list ? { rank: `No. ${k - going + 1} in ${list}` } : {}),
    };
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

/** Today's styles unless the workbench's own menu changed them (`styles`). */
export function nestColumns(art: Art, styles: Record<string, CardStyle> = {}): RowColumn[] {
  // As app.tsx builds them: Continue watching first (landscape stills), then the picks, My List, the genres, and on
  // Anime the assistant's picks above the end bar.
  const card = (key: string, name: string, unit: string, label: string, all: MediaItem[], going: number): RowColumn => ({
    kind: "media",
    key,
    name,
    unit,
    label,
    items: going ? all.slice(0, going) : all,
    small: going ? all : undefined,
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
    card("cinema", "Cinema", "films", "Continue · Cinema", media(art, 0, 10, 2, (k) => (k < 2 ? "42 min left" : "2019"), "today's popular films"), 2),
    card("shows", "Shows", "shows", "Next up · Shows", media(art, 2, 8, 3, (k) => (k < 3 ? `S0${k + 1} · E0${k + 3}  An episode` : "2022"), "today's popular shows"), 3),
    card("anime", "Anime", "titles", "Anime", media(art, 4, 8, 0, () => "12 episodes", "today's trending anime"), 0),
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
    { key: "home", label: "Home", run: noop, kind: "home", title: "Living room", sub: "3 lights on · 21°", actions: [{ icon: "cinema", label: "Cinema" }, { icon: "warm", label: "Warm" }, { icon: "power", label: "Off" }, { icon: "music", label: "Music" }] },
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
        { label: "Photos" },
        { label: "Workspace" },
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
  cont.items = cont.items.map((t, k) => ({ ...t, progressPct: 20 + k * 18, badge: k === 1 ? "Next · S01E03" : undefined }));
  const fresh = row("new", "New releases", 2, 10);
  fresh.items = fresh.items.map((t, k) => (k % 3 === 1 ? { ...t, watched: true } : t));
  return [cont, row("popular", "Popular", 4, 12), fresh, row("mylist", "My list", 6, 6)];
}

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
  { id: "scene-after", name: "After the film", locationId: HOME },
  { id: "scene-wake", name: "Good morning", locationId: HOME, lastRun: Date.now() - 9 * 3600_000 },
  { id: "scene-dinner", name: "Dinner", locationId: HOME },
  { id: "scene-read", name: "Reading corner", locationId: HOME },
  { id: "scene-off", name: "Everything off", locationId: HOME, lastRun: Date.now() - 40 * 60_000 },
  { id: "scene-fail", name: "Away (fails here)", locationId: HOME },
];

/** SmartThings as the panel calls it, answering after a short wait; "Away" is refused, to show the failure. */
export const LIGHTS_API: LightsApi = {
  runScene: (id) => new Promise((ok, no) => setTimeout(() => (id === "scene-fail" ? no(new Error("refused")) : ok({ status: "success" })), 900)),
  command: () => new Promise((ok) => setTimeout(() => ok({ results: [] }), 300)),
  roomsIn: () => new Promise((ok) => setTimeout(() => ok(LIGHT_ROOMS), 400)),
};
