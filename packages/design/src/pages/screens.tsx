// The real screens on fixture data: Nest's home (launcher/src/home.tsx) with its own remote navigation
// (nest-nav.ts), and the catalog home (catalog-kit/src/ui/Home.tsx), which handles its own keys.
import { DEFAULT_SETTINGS } from "@secretary/catalog-kit/src/lib/settings.ts";
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
import { Home as NestHome } from "@secretary/launcher/src/home.tsx";
import { enter, type Focus, HEADER_PROFILE, type Layout, leave, step } from "@secretary/launcher/src/nest-nav.ts";
import "@secretary/launcher/src/style.css";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Art } from "../art.ts";
import type { PageProps } from "../app.tsx";
import { headerButtons } from "@secretary/launcher/src/header-buttons.ts";
import { SearchScreen } from "@secretary/launcher/src/search.tsx";
import { ASK_ANSWER, ASK_IDLE, catalogRows, nestColumns, RECENT_SEARCHES, searchFixture } from "../fixtures.ts";

/** Nest home is the row; Nest assistant has the assistant under the cards focused; Nest chat is the full-screen one. */
/** Secretary's screens: its home (with the assistant and the chat), then the catalog pages it opens inside itself. */
export const SCREENS = ["Home", "Home · assistant", "Home · chat", "Cinema", "Shows", "Anime", "Film page", "Show page", "Film page · slim", "Film page · offline", "Search", "Search · results"] as const;

const MENU = ["Profiles", "TV settings", "Theme: Night", "🔇 Spoken replies: off"];
const CATALOG: Record<string, CatalogType> = { Cinema: "movie", Shows: "series", Anime: "anime" };

export function ScreensPage(props: PageProps & { art: Art; screen: number }) {
  const name = SCREENS[props.screen] ?? SCREENS[0];
  const type = CATALOG[name];
  if (name.startsWith("Search")) return <SearchPage key={name} {...props} results={name !== "Search"} />;
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
  const base = useMemo(() => nestColumns(art, shown), [art, JSON.stringify(shown)]);
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
 * results" with a query typed. Type with the keyboard's letters or the panel's keys; the results follow.
 */
function SearchPage({ mode, theme, backdrop, art, results }: PageProps & { art: Art; results: boolean }) {
  const find = useMemo(() => searchFixture(art), [art]);
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
        buttons={headerButtons({ open: 2 })}
        find={find}
        initialQuery={results ? "the" : ""}
        desk={DESK}
        onOpen={noop}
        onHeader={noop}
        onClose={noop}
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
      onFocus={setFocus}
      onOpen={noop}
      onOpenFolder={noop}
      look={DEFAULT_SETTINGS.collections}
      rowStyles={rowStyles}
      onRowStyle={(id, style) => setRowStyles((s) => ({ ...s, [id]: style }))}
      onDwell={noop}
      onOpenHub={noop}
      onOpenNest={noop}
      onSwitchType={noop}
      onBack={noop}
    />
  );
}

const LONG =
  "Neil McCauley is a career thief with a crew he trusts and a code he keeps. Lieutenant Vincent Hanna hunts him across Los Angeles, " +
  "obsessed and out of marriages, and the two men recognise each other long before they meet. As the next score closes in, loyalty, " +
  "love and the clock all start to cost more than the money is worth, and neither can walk away from the chase.";

const streams: StreamClient = { get: async () => [], watch: (_i, _h, _t, cb) => (cb([], true), () => {}), warm: async () => {} };

/** Detail on fixture data. `fetch` is stubbed while it is mounted: "Detail slim" gets its synopsis from the network, "offline" never does. */
function DetailScreen({ variant, art }: { variant: string; art: Art }) {
  const series = variant === "Show page";
  const slim = variant !== "Film page" && !series;
  const offline = variant === "Film page · offline";
  // A show with two seasons, the first two episodes watched: the page opens on S1E3, up next, and ticks the two.
  const videos = series
    ? [1, 2].flatMap((season) =>
        Array.from({ length: 8 }, (_, k) => ({
          id: `${"tt0113277"}:${season}:${k + 1}`,
          season,
          episode: k + 1,
          name: `Chapter ${k + 1}`,
          thumbnail: art.stills[(season * 8 + k) % art.stills.length],
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
    ...(slim ? {} : { description: LONG, genre: ["Crime", "Drama", "Thriller"], runtime: "170 min" }),
  };
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (series) localStorage.setItem("sectv.watched.episodes.v1", JSON.stringify({ tt0113277: ["1:1", "1:2"] }));
    const real = window.fetch;
    window.fetch = (async () =>
      offline
        ? Promise.reject(new Error("offline"))
        : { ok: true, json: async () => ({ meta: { id: title.id, imdb_id: title.id, name: title.name, description: LONG, genre: ["Crime", "Drama"], runtime: "170 min", year: "1995", imdbRating: "8.3", ...(videos ? { videos } : {}) } }) }) as typeof fetch;
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
      active
      onPlay={noop}
      onOpenTimeline={noop}
      onWatchedChange={noop}
      onBack={noop}
    />
  );
}
