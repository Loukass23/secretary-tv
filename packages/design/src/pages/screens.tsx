// The real screens on fixture data: Nest's home (launcher/src/home.tsx) with its own remote navigation
// (nest-nav.ts), and the catalog home (catalog-kit/src/ui/Home.tsx), which handles its own keys.
import { type DashboardSettings, DEFAULT_SETTINGS, type SettingTab } from "@secretary/catalog-kit/src/lib/settings.ts";
import { HubOverlay } from "@secretary/catalog-kit/src/ui/HubOverlay.tsx";
import { PauseMenu } from "@secretary/catalog-kit/src/ui/PauseMenu.tsx";
import { pauseActions, stepPause } from "@secretary/catalog-kit/src/lib/pausemenu.ts";
import type { CatalogType } from "@secretary/catalog-kit/src/lib/types.ts";
import { Home as CatalogHome } from "@secretary/catalog-kit/src/ui/Home.tsx";
import { Detail } from "@secretary/catalog-kit/src/ui/Detail.tsx";
import type { StreamClient } from "@secretary/catalog-kit/src/lib/streams.ts";
import type { Title } from "@secretary/catalog-kit/src/lib/types.ts";
import "@secretary/catalog-kit/src/style.css";
import { useKeys, useOkHold, type Focus as GridFocus } from "@secretary/tv-kit";
import { GlassRoot, glowImage, TINTS } from "@secretary/tv-kit/src/glass/index.ts";
import { type CardStyle, openStyleMenu, type StyleMenu, stepStyleMenu } from "@secretary/launcher/src/card-style.ts";
import { applyOrder, keepOrder, moveKey } from "@secretary/launcher/src/card-order.ts";
import { expands, rowLayout } from "@secretary/launcher/src/cards.tsx";
import { HEADER_ITEMS, headerButtons, Home as NestHome } from "@secretary/launcher/src/home.tsx";
import { MoodPanel } from "@secretary/launcher/src/mood.tsx";
import { setActiveMood } from "@secretary/launcher/src/moods.ts";
import { setLightFx } from "@secretary/launcher/src/light-fx.ts";
import { smartThingsTab } from "@secretary/launcher/src/smartthings-settings.tsx";
import type { HostHeader } from "@secretary/catalog-kit/src/host.ts";
import { enter, type Focus, HEADER_PROFILE, type Layout, leave, step } from "@secretary/launcher/src/nest-nav.ts";
import "@secretary/launcher/src/style.css";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Art } from "../art.ts";
import type { PageProps } from "../app.tsx";
import { SearchScreen } from "@secretary/launcher/src/search.tsx";
import { ASK_ANSWER, ASK_IDLE, catalogRows, LIGHT_DEVICES, LIGHT_SCENES, LIGHTS_API, nestColumns, RECENT_SEARCHES, searchFixture, searchOffline, SETTINGS_APPS, SETTINGS_FIXTURE, smartThingsFixture } from "../fixtures.ts";

/** Nest home is the row; Nest assistant has the assistant under the cards focused; Nest chat is the full-screen one. */
/** Secretary's screens: its home (with the assistant and the chat), then the catalog pages it opens inside itself. */
export const SCREENS = [
  "Home",
  "Home · assistant",
  "Home · chat",
  "Mood",
  "Cinema",
  "Shows",
  "Anime",
  "Film page",
  "Show page",
  "Film page · slim",
  "Film page · offline",
  "Show page · blur",
  "Show page · hide",
  "Search",
  "Search · results",
  "Search · offline",
  "Settings",
  "Settings · home screen",
  "Settings · apps",
  "Settings · appearance",
  "Settings · SmartThings",
  "Player · paused",
] as const;

/** Settings' look rows, shared with the toolbar: a change in either shows in both (catalog-kit applyLook). */
type Look = DashboardSettings["general"];
const SETTINGS_TABS: Record<string, SettingTab | "SmartThings"> = {
  "Settings · SmartThings": "SmartThings",
  "Settings · home screen": "Home screen",
  "Settings · apps": "Apps",
  "Settings · appearance": "Appearance",
};

const MENU = ["Profiles", "TV settings", "Theme: Night", "🔇 Spoken replies: off"];
const CATALOG: Record<string, CatalogType> = { Cinema: "movie", Shows: "series", Anime: "anime" };

export function ScreensPage(props: PageProps & { art: Art; screen: number; look: Omit<Look, "bootAnimation" | "clockFormat">; onLook(g: Look): void }) {
  const name = SCREENS[props.screen] ?? SCREENS[0];
  const type = CATALOG[name];
  if (name.startsWith("Settings")) return <SettingsPage key={name} tab={SETTINGS_TABS[name] ?? "Watching"} look={props.look} onLook={props.onLook} />;
  if (name.startsWith("Search")) return <SearchPage key={name} {...props} results={name !== "Search"} offline={name === "Search · offline"} />;
  if (name === "Mood") return <Lights {...props} />;
  if (name === "Player · paused") return <PausedPlayer art={props.art} />;
  if (name.includes("page")) return <DetailScreen key={name} variant={name} art={props.art} />;
  if (type) return <Catalog key={type} type={type} art={props.art} />;
  return <Nest key={name} {...props} start={name === "Home · chat" ? "chat" : name === "Home · assistant" ? "ask" : "row"} />;
}

function Nest({ mode, theme, backdrop, art, start }: PageProps & { art: Art; start: "row" | "ask" | "chat" }) {
  // The card styles live in this page only: the TV keeps its own (nest.cardStyles).
  const [styles, setStyles] = useState<Record<string, CardStyle>>({});
  const [styleMenu, setStyleMenu] = useState<StyleMenu | null>(null);
  const shown = styleMenu ? { ...styles, [styleMenu.key]: styleMenu.style } : styles;
  // Move mode, as on the TV (long OK, then Left and Right): the order lives in this page only.
  const [order, setOrder] = useState<string[]>([]);
  const [moving, setMoving] = useState<{ key: string; orig: string[] } | null>(null);
  // The folded cards' covers move on every 6 s here (every few minutes on the TV), to show how they change.
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTurn((n) => n + 1), 6000);
    return () => clearInterval(t);
  }, []);
  const base = useMemo(() => nestColumns(art, shown, turn), [art, JSON.stringify(shown), turn]);
  const columns = useMemo(() => applyOrder(base, order), [base, order]);
  const [focus, setFocus] = useState<Focus>(start === "row" ? { area: "row", col: 0, i: 0 } : { area: start, i: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [glow, setGlow] = useState<string | undefined>();
  useEffect(() => void glowImage(TINTS.orange).then(setGlow), []);

  const openCol = focus.area === "row" && focus.inside && expands(columns[focus.col ?? 0]) ? (focus.col ?? 0) : -1;
  // As in Nest (app.tsx): on a media card as a whole, a short OK opens it and a long one opens its style menu.
  const pickedMedia = !styleMenu && !moving && focus.area === "row" && !focus.inside && expands(columns[focus.col ?? 0]);
  const holdable = !styleMenu && !moving && focus.area === "row" && !focus.inside;
  const layout: Layout = {
    ask: 1,
    cols: rowLayout(columns, openCol).nav,
    menu: menuOpen ? MENU.length : 0,
    header: HEADER_ITEMS,
  };

  const open = () => setFocus(enter(focus, layout));
  // Any card but the assistant: a long OK lifts it to move (media cards open their style menu, whose Move line does the same).
  const hold = useOkHold(holdable && columns[focus.col ?? 0]?.kind !== "assistant", open, () => {
    const c = columns[focus.col ?? 0];
    if (c?.kind === "media") setStyleMenu(openStyleMenu(c.key, c.style));
    else if (c) setMoving({ key: c.key, orig: order });
  });

  useKeys(true, (key) => {
    if (moving) {
      if (key === "Enter" && hold.holding()) return true;
      if (key === "Left" || key === "Right") {
        const keys = columns.map((c) => c.key);
        const next = moveKey(keys, moving.key, key === "Left" ? -1 : 1);
        setOrder(keepOrder(next, order));
        setFocus({ area: "row", col: next.indexOf(moving.key), i: 0 });
      } else if (key === "Enter") setMoving(null);
      else if (key === "Back") {
        setOrder(moving.orig);
        setMoving(null);
      }
      return true;
    }
    if (styleMenu) {
      if (key === "Enter" && hold.holding()) return true;
      const r = stepStyleMenu(styleMenu, key);
      if (r === "keep") {
        setStyles({ ...styles, [styleMenu.key]: styleMenu.style });
        setStyleMenu(null);
      } else if (r === "move") {
        setStyles({ ...styles, [styleMenu.key]: styleMenu.style });
        setStyleMenu(null);
        setMoving({ key: styleMenu.key, orig: order });
      } else if (r === "undo" || r === "remove") setStyleMenu(null);
      else setStyleMenu(r);
      return true;
    }
    if (key === "Enter" && ((holdable && columns[focus.col ?? 0]?.kind !== "assistant") || hold.holding())) return true;
    if (key === "Back") {
      if (menuOpen) {
        setMenuOpen(false);
        setFocus({ area: "header", i: HEADER_PROFILE });
      } else if (focus.area === "chat" || focus.area === "ask") setFocus({ area: "row", col: 0, i: 0 });
      else setFocus(leave(focus));
      return true;
    }
    if (key === "Enter") {
      if (focus.area === "header" && focus.i === HEADER_PROFILE) {
        setMenuOpen(true);
        setFocus({ area: "menu", i: 0 });
      } else if (focus.area === "row" && !focus.inside && columns[focus.col ?? 0]?.kind === "assistant") setFocus({ area: "chat", i: 0 });
      else if (focus.area !== "ask" && focus.area !== "chat") setFocus(enter(focus, layout));
      return true;
    }
    const next = step(focus, key, layout);
    if (next !== focus) setFocus(next);
    return true;
  });

  return (
    <GlassRoot mode={mode} wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} sheen={{ palette: null }} class={theme === "day" ? "nest sg-day" : "nest"}>
      <NestHome
        focus={focus}
        time="16:20"
        ask={{ ...(start === "row" ? ASK_IDLE : ASK_ANSWER), focused: focus.area === "ask", full: focus.area === "chat" }}
        menu={menuOpen ? MENU : null}
        glow={glow}
        columns={columns}
        styleMenu={styleMenu}
        moving={moving?.key ?? null}
        open={2}
        status=""
        links={[{ icon: "sync" }, { icon: "server", off: true }]}
        menuInfo={["Nuvio · synced as Robin", "Server offline · apps still work"]}
        me={{ name: "Robin", color: "#5b52e6" }}
      />
    </GlassRoot>
  );
}

const noop = () => {};

/** A documentation-only address for the phone keyboard's QR code; its polling is answered here, never sent. */
const DESK = "http://192.0.2.10:7000";

/**
 * The one search (launcher/src/search.tsx) on fixture titles: "Search" opens empty on the recent searches, "Search ·
 * results" with a query typed, "Search · offline" with no catalog answering (the error state). Type with the keyboard's
 * letters or the panel's keys; the results follow.
 */
function SearchPage({ mode, theme, backdrop, art, results, offline }: PageProps & { art: Art; results: boolean; offline: boolean }) {
  const find = useMemo(() => (offline ? searchOffline : searchFixture(art)), [art, offline]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    localStorage.setItem("sectv:recent-searches:v1", JSON.stringify(RECENT_SEARCHES));
    const real = window.fetch;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith(DESK) ? Promise.resolve(new Response(JSON.stringify({ text: "", rev: 0 }))) : real(input, init)) as typeof fetch;
    setReady(true);
    return () => {
      window.fetch = real;
    };
  }, []);
  if (!ready) return null;
  return (
    <GlassRoot mode={mode} wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} sheen={{ palette: null }} class={theme === "day" ? "nest sg-day" : "nest"}>
      <SearchScreen
        time="16:20"
        person={{ name: "Robin", color: "#5b52e6" }}
        buttons={headerButtons(undefined, true, 2)}
        find={find}
        initialQuery={offline ? "harbour" : results ? "the" : ""}
        desk={DESK}
        onOpen={noop}
        onHeader={noop}
        onClose={noop}
      />
    </GlassRoot>
  );
}

/**
 * Settings (catalog-kit ui/HubOverlay.tsx) under Secretary's header, on fixture settings and apps: "Settings" opens on
 * Watching, the others on Home screen's feature switches, the Apps picker and Appearance. Changes live in this page
 * only, except the look (accent, type style, text size, Reduce motion), which goes to the toolbar and the page.
 */
function SettingsPage({ tab, look, onLook }: { tab: SettingTab | "SmartThings"; look: Omit<Look, "bootAnimation" | "clockFormat">; onLook(g: Look): void }) {
  const [own, setSettings] = useState<DashboardSettings>(SETTINGS_FIXTURE);
  // Settings › SmartThings, as Secretary adds it, on the fixture home (its switches redraw this page).
  const [, setRev] = useState(0);
  const devices = useMemo(() => LIGHT_DEVICES.map((d) => ({ ...d })), []);
  const st = smartThingsTab(smartThingsFixture(devices, () => setRev((n) => n + 1)));
  const settings = { ...own, general: { ...own.general, ...look } };
  return (
    <HubOverlay
      active
      settings={settings}
      onUpdateSettings={(next) => {
        setSettings(next);
        onLook(next.general);
      }}
      header={HEADER}
      apps={SETTINGS_APPS}
      hostTabs={[st]}
      initialTab={tab}
      onSearch={noop}
      onOpenNest={noop}
      onClose={noop}
    />
  );
}

/**
 * The pause menu (catalog-kit ui/PauseMenu.tsx) over a paused frame: a fixture still stands in for the video plane.
 * Left and Right move along the buttons; OK on Picture steps its fit.
 */
function PausedPlayer({ art }: { art: Art }) {
  const actions = pauseActions({ next: true, picture: true });
  const [at, setAt] = useState(0);
  const [aspect, setAspect] = useState(0);
  useKeys(true, (key) => {
    const step = stepPause(at, actions.length, key);
    if (!step) return false;
    if ("at" in step) return void setAt(step.at);
    if (actions[step.run] === "picture") setAspect((a) => (a + 1) % 3);
  });
  return (
    <div class="player" style={{ position: "absolute", inset: 0, background: "#000" }}>
      <img src={art.backgrounds[1 % art.backgrounds.length]} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <PauseMenu
        name="The Quiet Harbour"
        episodeLine="S1E3 · A Door in the Fog"
        pos={1394}
        dur={3120}
        actions={actions}
        at={at}
        values={{ subs: "English", picture: ["Fit", "Fill", "Stretch"][aspect] }}
        badges={["4K", "HDR10", "Atmos"]}
      />
    </div>
  );
}

/** The Mood panel over home's wallpaper, as Secretary opens it from the header's lights button. */
function Lights({ mode, theme, backdrop }: PageProps & { art: Art }) {
  // The panel re-mounts on every visit (fresh routine states), and Back reopens it here rather than leaving.
  const [visit, setVisit] = useState(0);
  return (
    <GlassRoot mode={mode} wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} sheen={{ palette: null }} class={theme === "day" ? "nest sg-day" : "nest"}>
      <MoodPanel
        key={visit}
        devices={LIGHT_DEVICES}
        scenes={LIGHT_SCENES}
        header={PANEL_HEADER}
        onMood={(m) => {
          setLightFx(m.fx);
          setActiveMood(m.key);
          return new Promise((ok) => setTimeout(ok, 600));
        }}
        onSetup={noop}
        onClose={() => setVisit((v) => v + 1)}
      />
    </GlassRoot>
  );
}

function Catalog({ type, art }: { type: CatalogType; art: Art }) {
  const rows = useMemo(() => catalogRows(art), [art]);
  const [focus, setFocus] = useState<GridFocus>({ row: 0, col: 0 });
  const [rowStyles, setRowStyles] = useState({});
  return (
    <CatalogHome
      type={type}
      rows={rows}
      focus={focus}
      active
      status={null}
      heading={type === "movie" ? "Cinema" : type === "series" ? "Shows" : "Anime"}
      person={{ name: "Robin", color: "#5b52e6" }}
      header={HEADER}
      onFocus={setFocus}
      onOpen={noop}
      onOpenFolder={noop}
      look={DEFAULT_SETTINGS.collections}
      rowStyles={rowStyles}
      onRowStyle={(id, style) => setRowStyles((s) => ({ ...s, [id]: style }))}
      onDwell={noop}
      onOpenHub={noop}
      onBack={noop}
    />
  );
}

const LONG =
  "A placeholder synopsis drawn by the design workbench. A harbour town waits out the longest winter anyone remembers, and two " +
  "neighbours who have not spoken in years are the only ones who can keep the lighthouse running. It is long enough to show how " +
  "four lines of a film's description sit in the panel, and what happens when it runs on past them.";

/** Each episode's own synopsis; the fourth has none, so the panel falls back to the show's. */
const EPISODE_ABOUT = (season: number, n: number) =>
  n === 4
    ? undefined
    : `Placeholder synopsis of season ${season}, chapter ${n}: what happens in this episode, written long enough to fill the three lines the panel gives it, so the focus can be seen following the episode.`;

/** Secretary's header as the host lends it (catalog-kit host.ts): Up from the top of the page expands it. */
const HEADER: HostHeader = {
  time: "20:41",
  person: { name: "Alex", color: "#5a7dff" },
  buttons: headerButtons(undefined, true, 2),
  press: () => {},
};
/** The same header over a panel (launcher panel-header.tsx). */
const PANEL_HEADER = { ...HEADER, person: { name: "Alex", color: "#5a7dff" }, press: () => {} };

const streams: StreamClient = { get: async () => [], watch: (_i, _h, _t, cb) => (cb([], true), () => {}), warm: async () => {} };

/** Detail on fixture data. `fetch` is stubbed while it is mounted: "Detail slim" gets its synopsis from the network, "offline" never does. */
function DetailScreen({ variant, art }: { variant: string; art: Art }) {
  const series = variant.startsWith("Show page");
  // Spoiler protection as Settings › Watching sets it: Off on the plain show page.
  const spoilers = variant === "Show page · blur" ? "blur" : variant === "Show page · hide" ? "hide" : "off";
  const slim = variant !== "Film page" && !series;
  const offline = variant === "Film page · offline";
  // A show with two seasons, the first two episodes watched: the page opens on S1E3, up next, and ticks the two. Each
  // episode has its own synopsis (but the fourth), and the last two of season 2 are still to come.
  const videos = series
    ? [1, 2].flatMap((season) =>
        Array.from({ length: 8 }, (_, k) => ({
          id: `${"tt0113277"}:${season}:${k + 1}`,
          season,
          episode: k + 1,
          name: `Chapter ${k + 1}`,
          thumbnail: art.stills[(season * 8 + k) % art.stills.length],
          overview: EPISODE_ABOUT(season, k + 1),
          released: season === 2 && k >= 6 ? "2099-01-0" + (k - 4) + "T00:00:00Z" : `2024-0${season}-${10 + k}T00:00:00Z`,
        })),
      )
    : undefined;
  const title: Title = {
    id: "tt0113277",
    name: "The Quiet Harbour at the End of the Longest Winter",
    year: "1995",
    rating: "8.3",
    poster: art.posters[0],
    background: art.backgrounds[0],
    // The film has a logo (shown as its mark); the show has none, so its name shows in the display face.
    ...(series ? {} : { logo: art.logos[0] }),
    ...(slim ? {} : { description: LONG, genre: ["Crime", "Drama", "Thriller"], runtime: "170 min" }),
  };
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (series) localStorage.setItem("sectv.watched.episodes.v1", JSON.stringify({ tt0113277: ["1:1", "1:2"] }));
    const real = window.fetch;
    window.fetch = (async () =>
      offline
        ? Promise.reject(new Error("offline"))
        : { ok: true, json: async () => ({ meta: { id: title.id, imdb_id: title.id, name: title.name, description: LONG, genre: ["Crime", "Drama"], runtime: series ? "52 min" : "170 min", year: "1995", imdbRating: "8.3", ...(videos ? { videos } : { cast: ["Example Actor One", "Example Actor Two", "Example Actor Three", "Example Actor Four", "Example Actor Five", "Example Actor Six"], director: ["Example Director"], writer: ["Example Writer", "Second Writer"], released: "1995-12-15T00:00:00.000Z", country: "United States", awards: "Nominated for 2 awards" }) } }) }) as typeof fetch;
    setReady(true);
    return () => {
      window.fetch = real;
    };
  }, [variant]);
  if (!ready) return null;
  return (
    <Detail
      type={series ? "series" : "movie"}
      title={title}
      streams={streams}
      resume={series ? undefined : { title, posSec: 4200, durSec: 10200, updated: 1 }}
      header={HEADER}
      spoilerProtection={spoilers}
      active
      onPlay={noop}
      onOpenTimeline={noop}
      onWatchedChange={noop}
      onBack={noop}
    />
  );
}
