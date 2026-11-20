// The real screens on fixture data: Nest's home (launcher/src/home.tsx) with its own remote navigation
// (nest-nav.ts), and the catalog home (catalog-kit/src/ui/Home.tsx), which handles its own keys.
import { DEFAULT_SETTINGS } from "@secretary/catalog-kit/src/lib/settings.ts";
import type { CatalogType } from "@secretary/catalog-kit/src/lib/types.ts";
import { Home as CatalogHome } from "@secretary/catalog-kit/src/ui/Home.tsx";
import "@secretary/catalog-kit/src/style.css";
import { useKeys, useOkHold, type Focus as GridFocus } from "@secretary/tv-kit";
import { GlassRoot, glowImage, TINTS } from "@secretary/tv-kit/src/glass/index.ts";
import { type CardStyle, openStyleMenu, type StyleMenu, stepStyleMenu } from "@secretary/launcher/src/card-style.ts";
import { expands, rowLayout } from "@secretary/launcher/src/cards.tsx";
import { Home as NestHome } from "@secretary/launcher/src/home.tsx";
import { enter, type Focus, HEADER_PROFILE, type Layout, leave, step } from "@secretary/launcher/src/nest-nav.ts";
import "@secretary/launcher/src/style.css";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Art } from "../art.ts";
import type { PageProps } from "../app.tsx";
import { ASK_ANSWER, ASK_IDLE, catalogRows, nestColumns } from "../fixtures.ts";

/** Nest home is the row; Nest assistant has the assistant under the cards focused; Nest chat is the full-screen one. */
export const SCREENS = ["Nest home", "Nest assistant", "Nest chat", "Cinema", "Shows", "Anime"] as const;

const MENU = ["Profiles", "TV settings", "Theme: Night", "🔇 Spoken replies: off"];
const CATALOG: Record<string, CatalogType> = { Cinema: "movie", Shows: "series", Anime: "anime" };

export function ScreensPage(props: PageProps & { art: Art; screen: number }) {
  const name = SCREENS[props.screen] ?? SCREENS[0];
  const type = CATALOG[name];
  if (type) return <Catalog key={type} type={type} art={props.art} />;
  return <Nest key={name} {...props} start={name === "Nest chat" ? "chat" : name === "Nest assistant" ? "ask" : "row"} />;
}

function Nest({ mode, theme, backdrop, art, start }: PageProps & { art: Art; start: "row" | "ask" | "chat" }) {
  // The card styles live in this page only: the TV keeps its own (nest.cardStyles).
  const [styles, setStyles] = useState<Record<string, CardStyle>>({});
  const [styleMenu, setStyleMenu] = useState<StyleMenu | null>(null);
  const shown = styleMenu ? { ...styles, [styleMenu.key]: styleMenu.style } : styles;
  const columns = useMemo(() => nestColumns(art, shown), [art, JSON.stringify(shown)]);
  const [focus, setFocus] = useState<Focus>(start === "row" ? { area: "row", col: 0, i: 0 } : { area: start, i: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [glow, setGlow] = useState<string | undefined>();
  useEffect(() => void glowImage(TINTS.orange).then(setGlow), []);

  const openCol = focus.area === "row" && focus.inside && expands(columns[focus.col ?? 0]) ? (focus.col ?? 0) : -1;
  // As in Nest (app.tsx): on a media card as a whole, a short OK opens it and a long one opens its style menu.
  const pickedMedia = !styleMenu && focus.area === "row" && !focus.inside && expands(columns[focus.col ?? 0]);
  const layout: Layout = {
    ask: 1,
    cols: rowLayout(columns, openCol).nav,
    menu: menuOpen ? MENU.length : 0,
  };

  const hold = useOkHold(
    pickedMedia,
    () => setFocus(enter(focus, layout)),
    () => {
      const c = columns[focus.col ?? 0];
      if (c?.kind === "media") setStyleMenu(openStyleMenu(c.key, c.style));
    },
  );

  useKeys(true, (key) => {
    if (styleMenu) {
      if (key === "Enter" && hold.holding()) return true;
      const r = stepStyleMenu(styleMenu, key);
      if (r === "keep") {
        setStyles({ ...styles, [styleMenu.key]: styleMenu.style });
        setStyleMenu(null);
      } else if (r === "undo" || r === "remove") setStyleMenu(null);
      else setStyleMenu(r);
      return true;
    }
    if (key === "Enter" && (pickedMedia || hold.holding())) return true;
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
    <GlassRoot mode={mode} wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} class={theme === "day" ? "nest sg-day" : "nest"}>
      <NestHome
        focus={focus}
        time="16:20"
        ask={{ ...(start === "row" ? ASK_IDLE : ASK_ANSWER), focused: focus.area === "ask", full: focus.area === "chat" }}
        menu={menuOpen ? MENU : null}
        glow={glow}
        columns={columns}
        styleMenu={styleMenu}
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
