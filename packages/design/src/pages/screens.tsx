// The real screens on fixture data: Nest's home (launcher/src/home.tsx) with its own remote navigation
// (nest-nav.ts), and the catalog home (catalog-kit/src/ui/Home.tsx), which handles its own keys.
import { DEFAULT_SETTINGS } from "@secretary/catalog-kit/src/lib/settings.ts";
import type { CatalogType } from "@secretary/catalog-kit/src/lib/types.ts";
import { Home as CatalogHome } from "@secretary/catalog-kit/src/ui/Home.tsx";
import "@secretary/catalog-kit/src/style.css";
import { useKeys, type Focus as GridFocus } from "@secretary/tv-kit";
import { GlassRoot, glowImage, TINTS } from "@secretary/tv-kit/src/glass/index.ts";
import { rowLayout } from "@secretary/launcher/src/cards.tsx";
import { Home as NestHome } from "@secretary/launcher/src/home.tsx";
import { enter, type Focus, HEADER_PROFILE, HEADER_SEARCH, HEADER_WEATHER, type Layout, leave, step } from "@secretary/launcher/src/nest-nav.ts";
import "@secretary/launcher/src/style.css";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Art } from "../art.ts";
import type { PageProps } from "../app.tsx";
import { ASK_ANSWER, ASK_IDLE, catalogRows, nestColumns, nestResults, WEATHER } from "../fixtures.ts";

export const SCREENS = ["Nest home", "Nest answer", "Cinema", "Shows", "Anime"] as const;

const MENU = ["Profiles", "TV settings", "Theme: Night", "🔇 Spoken replies: off"];
const CATALOG: Record<string, CatalogType> = { Cinema: "movie", Shows: "series", Anime: "anime" };

export function ScreensPage(props: PageProps & { art: Art; screen: number }) {
  const name = SCREENS[props.screen] ?? SCREENS[0];
  const type = CATALOG[name];
  if (type) return <Catalog key={type} type={type} art={props.art} />;
  return <Nest key={name} {...props} answer={name === "Nest answer"} />;
}

function Nest({ mode, theme, backdrop, art, answer }: PageProps & { art: Art; answer: boolean }) {
  const columns = useMemo(() => nestColumns(art), [art]);
  const results = useMemo(() => nestResults(art), [art]);
  const [focus, setFocus] = useState<Focus>(answer ? { area: "results", i: 0 } : { area: "row", col: 0, i: 0 });
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [glow, setGlow] = useState<string | undefined>();
  useEffect(() => void glowImage(TINTS.orange).then(setGlow), []);

  const layout: Layout = {
    weather: true,
    ask: 1,
    cols: answer ? [] : rowLayout(columns).nav,
    results: answer ? results.length : 0,
    menu: menuOpen ? MENU.length : 0,
  };

  useKeys(true, (key) => {
    if (key === "Back") {
      if (weatherOpen) setWeatherOpen(false);
      else if (menuOpen) {
        setMenuOpen(false);
        setFocus({ area: "header", i: HEADER_PROFILE });
      } else setFocus(leave(focus));
      return true;
    }
    if (key === "Enter") {
      if (focus.area === "header" && focus.i === HEADER_WEATHER) setWeatherOpen(!weatherOpen);
      else if (focus.area === "header" && focus.i === HEADER_PROFILE) {
        setMenuOpen(true);
        setFocus({ area: "menu", i: 0 });
      } else setFocus(enter(focus, layout));
      return true;
    }
    const next = step(focus, key, layout);
    if (next !== focus) setFocus(next);
    return true;
  });

  return (
    <GlassRoot mode={mode} wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} class={theme === "day" ? "nest sg-day" : "nest"}>
      <NestHome
        focus={focus}
        time="16:20"
        ask={answer ? ASK_ANSWER : ASK_IDLE}
        results={answer ? { query: "films by the sea", items: results } : null}
        weather={WEATHER}
        weatherOpen={weatherOpen}
        menu={menuOpen ? MENU : null}
        glow={glow}
        columns={columns}
        open={2}
        status={focus.area === "header" && focus.i === HEADER_SEARCH ? "Search" : ""}
        me={{ name: "Robin", color: "#5b52e6" }}
      />
    </GlassRoot>
  );
}

const noop = () => {};

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
