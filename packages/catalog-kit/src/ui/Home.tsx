// Catalog home in glass, Apple TV "top shelf" style: the focused title's art fills the top of the page,
// a frosted panel describes it, and poster rows scroll underneath. Same rules as Secretary Nest
// (tv-kit/src/glass, docs/performance.md): transform-only motion, no live blur, no soft shadows.
import { type Dir, type Focus, move, useKeys, windowOf } from "@secretary/tv-kit";
import {
  Glass,
  GlassRoot,
  IconButton,
  MediaTile,
  Segmented,
} from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { backgroundUrl, posterUrl } from "../lib/cinemeta.ts";
import {
  CARD_SHAPE_LABELS,
  CARD_SHAPES,
  CARD_SIZE_LABELS,
  CARD_SIZES,
  cardBox,
  resolveCard,
  type RowStyle,
} from "../lib/collectionlayout.ts";
import type { ClockFormat, DashboardSettings, OverlayTab } from "../lib/settings.ts";
import type { CatalogType, HomeRow, Title } from "../lib/types.ts";
import { DWELL_MS, HeroLayers, useBase, useHeroArt } from "./art.tsx";
import "./home.css";

const PAD = 80;
const CARD_W = 180;
const CARD_H = 270;
const STRIDE = CARD_W + 22;
/** The style menu of a collection row (a long OK): beside the info panel, over the art. */
const MENU = { x: 1000, y: 150, w: 620 };
const MENU_LINE = 58;
/** Rows start under the info panel; the focused row is always the first one shown. */
const ROWS_Y = 560;
const ROW_H = 372;
const LABEL_H = 52;
/** Rows rendered below the focused one. */
const ROWS_BELOW = 2;
const INFO = { x: PAD, y: 150, w: 880, h: 330 };
const SEG = { x: 650, y: 52, w: 620, h: 68 };
const ICON_W = 120;
const ICON_X = [1580, 1720];

/** The top bar, left to right: the section pill, then Search and Settings. */
export const SECTIONS = ["Nest", "Cinema", "Shows", "Anime"] as const;
const SECTION_TYPES: readonly (CatalogType | null)[] = [null, "movie", "series", "anime"];
const TOP_LENGTH = SECTIONS.length + 2;
const TOP_SEARCH = SECTIONS.length;
const TOP_SETTINGS = SECTIONS.length + 1;


function formatClock(fmt: ClockFormat): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: fmt === "12h" });
}

function rowOriginLabel(row: HomeRow, type: CatalogType): string {
  if (row.originLabel) return row.originLabel;
  if (row.id === "continue") return "Debrid · This TV";
  if (type === "anime") return "Kitsu · TVDB";
  return "Cinemeta · TMDB";
}

interface Props {
  type: CatalogType;
  rows: HomeRow[];
  focus: Focus;
  active: boolean;
  status: string | null;
  heading: string;
  clockFormat?: ClockFormat;
  onFocus(f: Focus): void;
  onOpen(title: Title, autoPlay?: boolean): void;
  onOpenFolder(collectionId: string, folderId: string): void;
  /** How Nuvio collection rows look (Settings › Collections), and each row's own choice (a long OK on it). */
  look: DashboardSettings["collections"];
  rowStyles: Record<string, RowStyle>;
  onRowStyle(rowId: string, style: RowStyle): void;
  onDwell(title: Title): void;
  onOpenHub(tab?: OverlayTab, autoVoice?: boolean): void;
  onOpenNest(): void;
  onSwitchType(type: CatalogType): void;
  onBack(): void;
}

/** The backdrop for a focused card; a Nuvio folder shows only the art its collection gave. */
const heroArt = (t: Title): string | undefined => (t.folder ? t.background : backgroundUrl(t));

/** The style menu's lines: Automatic and the shapes, then the size. */
const MENU_SHAPES = ["auto", ...CARD_SHAPES] as const;
const MENU_SIZES = ["auto", ...CARD_SIZES] as const;
const SIZE_LINE = MENU_SHAPES.length;

interface StyleMenu {
  rowId: string;
  title: string;
  /** What the row had when the menu opened: Back puts it back. */
  orig: RowStyle;
  style: RowStyle;
  line: number;
}

export function Home({
  type,
  rows,
  focus,
  active,
  status,
  heading,
  clockFormat = "24h",
  onFocus,
  onOpen,
  onOpenFolder,
  look,
  rowStyles,
  onRowStyle,
  onDwell,
  onOpenHub,
  onOpenNest,
  onSwitchType,
  onBack,
}: Props) {
  /** Focus in the top bar (0..TOP_LENGTH-1), or null when it is in the rows. */
  const [topIdx, setTopIdx] = useState<number | null>(null);
  const [clockText, setClockText] = useState(() => formatClock(clockFormat));
  const lengths = rows.map((r) => r.items.length);
  const activeRow = rows[focus.row];
  const current = activeRow?.items[focus.col];
  const { backdrop, shade } = useBase(type);
  // The focused card's art becomes the backdrop once focus rests on it.
  const hero = useHeroArt(current?.id, current ? heroArt(current) : undefined, active);

  useEffect(() => {
    setClockText(formatClock(clockFormat));
    const t = setInterval(() => setClockText(formatClock(clockFormat)), 30_000);
    return () => clearInterval(t);
  }, [clockFormat]);

  const activateTop = (i: number) => {
    setTopIdx(null);
    if (i === TOP_SEARCH) return onOpenHub("search");
    if (i === TOP_SETTINGS) return onOpenHub("settings");
    const t = SECTION_TYPES[i];
    if (!t) return onOpenNest();
    if (t !== type) onSwitchType(t);
  };

  // A long OK on a collection row opens its style menu; a short one opens the folder on release. As OK on a source
  // in the sheet (Detail.tsx): the remote sends no key repeats for a held OK, so the hold is a 600 ms timer from the
  // keydown, cancelled by the keyup.
  const [menu, setMenu] = useState<StyleMenu | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The press that opened the menu is still down: its keydowns and keyup are not a choice in the menu. */
  const holding = useRef(false);
  useEffect(() => {
    if (!active) return;
    const onUp = (e: KeyboardEvent) => {
      if (e.keyCode !== 13) return;
      holding.current = false;
      if (!holdTimer.current) return;
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      if (current?.folder) onOpenFolder(current.folder.collectionId, current.folder.folderId);
    };
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keyup", onUp);
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };
  }, [active, current?.id]);

  const openMenu = () => {
    if (!activeRow) return;
    const own = rowStyles[activeRow.id] ?? {};
    setMenu({ rowId: activeRow.id, title: activeRow.title, orig: own, style: own, line: MENU_SHAPES.indexOf(own.shape ?? "auto") });
  };
  /** Each step shows on the row at once (the row is the preview); OK keeps it, Back puts the old one back. */
  const menuStep = (m: StyleMenu, style: RowStyle, line = m.line) => {
    setMenu({ ...m, style, line });
    onRowStyle(m.rowId, style);
  };
  const menuKey = (m: StyleMenu, key: string) => {
    if (key === "Back") {
      onRowStyle(m.rowId, m.orig);
      return void setMenu(null);
    }
    if (key === "Enter") {
      if (holding.current) return;
      return void setMenu(null);
    }
    if (key === "Up" || key === "Down") {
      const line = Math.max(0, Math.min(SIZE_LINE, m.line + (key === "Up" ? -1 : 1)));
      if (line === SIZE_LINE) return void setMenu({ ...m, line });
      const shape = MENU_SHAPES[line];
      return menuStep(m, { ...m.style, shape: shape === "auto" ? undefined : shape }, line);
    }
    if ((key === "Left" || key === "Right") && m.line === SIZE_LINE) {
      const i = Math.max(0, MENU_SIZES.indexOf(m.style.size ?? "auto"));
      const size = MENU_SIZES[Math.max(0, Math.min(MENU_SIZES.length - 1, i + (key === "Left" ? -1 : 1)))];
      return menuStep(m, { ...m.style, size: size === "auto" ? undefined : size });
    }
  };

  useKeys(active, (key, e) => {
    if (menu) return void menuKey(menu, key);
    // CH- or Search opens Spotlight search, CH+ opens Secretary Nest.
    if (key === "ChannelDown" || key === "Search" || key === "SearchVoice") {
      setTopIdx(null);
      onOpenHub("search", key === "SearchVoice");
      return;
    }

    if (topIdx !== null) {
      if (key === "Down" || key === "Back") return void setTopIdx(null);
      if (key === "Left") return void setTopIdx(Math.max(0, topIdx - 1));
      if (key === "Right") return void setTopIdx(Math.min(TOP_LENGTH - 1, topIdx + 1));
      if (key === "Enter") return void activateTop(topIdx);
      return false;
    }

    if (key === "Enter") {
      if (!current) return;
      if (current.folder) {
        if (holdTimer.current || holding.current) return;
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          holding.current = true;
          openMenu();
        }, 600);
        return;
      }
      if (!e.repeat) onOpen(current, activeRow?.id === "continue");
      return;
    }
    if (key === "Back") return void onBack();
    // Up from the first row enters the top bar on this app's own section.
    if (key === "Up" && focus.row === 0) {
      setTopIdx(Math.max(1, SECTION_TYPES.indexOf(type)));
      return;
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = move(lengths, focus, key.toLowerCase() as Dir);
      if (next !== focus) onFocus(next);
      return;
    }
    return false;
  });

  // A card that holds focus for a moment starts its stream lookup (movies), so OK is quick.
  useEffect(() => {
    if (!active || !current || current.folder) return;
    const t = setTimeout(() => onDwell(current), DWELL_MS);
    return () => clearTimeout(t);
  }, [active, current?.id]);

  const inRows = topIdx === null;
  const isContinue = activeRow?.id === "continue";
  const frost = hero.frost ?? backdrop?.frost;
  const rowScroll = focus.row * ROW_H;
  const sectionIdx = Math.max(1, SECTION_TYPES.indexOf(type));

  const kicker = !current
    ? heading
    : isContinue
      ? "Continue watching · Debrid cached"
      : current.folder
        ? `${activeRow?.title} · Nuvio collection`
        : `${activeRow?.title ?? heading} · ${activeRow ? rowOriginLabel(activeRow, type) : ""}`;
  const meta = current
    ? [current.badge, current.year, current.rating && `IMDb ${current.rating}`, current.runtime, current.genre?.slice(0, 2).join(" · ")]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  return (
    <GlassRoot mode="fake" wallpaper={backdrop?.wallpaper} frost={frost} class="cat-home">
      <HeroLayers hero={hero} shade={shade} />

      <div class="cat-clock" style={{ left: `${PAD}px`, top: "56px" }}>
        {clockText}
      </div>
      <Segmented {...SEG} items={SECTIONS} picked={sectionIdx} focusIndex={topIdx !== null && topIdx < SECTIONS.length ? topIdx : -1} />
      <IconButton x={ICON_X[0]} y={SEG.y} w={ICON_W} h={SEG.h} icon="⌕" focused={topIdx === TOP_SEARCH} />
      <IconButton x={ICON_X[1]} y={SEG.y} w={ICON_W} h={SEG.h} icon="⚙" focused={topIdx === TOP_SETTINGS} />

      <Glass {...INFO} class="cat-info">
        <span class="cat-kicker">{kicker}</span>
        <h1>{current?.name ?? status ?? heading}</h1>
        {meta && <div class="cat-meta">{meta}</div>}
        {current?.description && <p>{current.description}</p>}
        {current && (
          <div class="cat-hint">
            <span class="cat-ok">{isContinue ? "▶ OK to resume" : current.folder ? "OK to open the folder · hold OK for the card style" : "OK for details"}</span>
            <span>CH- search · CH+ Nest</span>
          </div>
        )}
      </Glass>

      <div class="sg-clip cat-rows-clip" style={{ left: "0px", top: `${ROWS_Y - 20}px`, width: "1920px", height: `${1080 - ROWS_Y + 20}px` }}>
        <div class="sg-scroll" style={{ transform: `translate3d(0,${20 - rowScroll}px,0)` }}>
          {rows.slice(focus.row, focus.row + ROWS_BELOW + 1).map((row, k) => {
            const r = focus.row + k;
            const style = row.rowKind === "folders" ? resolveCard(row.tileShape ?? "SQUARE", look, rowStyles[row.id]) : null;
            const card = style ? cardBox(style.shape, style.size) : null;
            const stride = card ? card.w + 22 : STRIDE;
            const [from, to] = windowOf(r === focus.row ? focus.col : 0, row.items.length);
            const shift = r === focus.row ? Math.max(0, focus.col - 1) * stride : 0;
            const rowY = r * ROW_H;
            return (
              <section key={row.id} class="cat-row" style={{ top: `${rowY}px` }}>
                <div class="cat-row-head" style={{ left: `${PAD}px` }}>
                  <h2>{row.title}</h2>
                  <span>{rowOriginLabel(row, type)}</span>
                </div>
                <div class="sg-scroll" style={{ top: `${LABEL_H}px`, transform: `translate3d(${PAD - shift}px,0,0)` }}>
                  {row.items.slice(from, to).map((m, j) => {
                    const c = from + j;
                    const focused = inRows && !menu && r === focus.row && c === focus.col;
                    if (card && m.folder) {
                      return <FolderTile key={m.id} item={m} x={c * stride} w={card.w} h={card.h} focused={focused} />;
                    }
                    return (
                      <MediaTile
                        key={`${row.id}:${m.catalogType ?? type}:${m.id}`}
                        x={c * STRIDE}
                        y={0}
                        w={CARD_W}
                        h={CARD_H}
                        src={posterUrl(m)}
                        badge={m.badge}
                        progress={m.progressPct != null ? m.progressPct / 100 : undefined}
                        focused={focused}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {menu && <RowStyleMenu menu={menu} />}
    </GlassRoot>
  );
}

/** The style menu of a collection row: a line per card shape, then the size; the row behind is the preview. */
function RowStyleMenu({ menu }: { menu: StyleMenu }) {
  const shape = menu.style.shape ?? "auto";
  const size = menu.style.size ?? "auto";
  return (
    <Glass x={MENU.x} y={MENU.y} w={MENU.w} h={(SIZE_LINE + 1) * MENU_LINE + 110} class="cat-style">
      <span class="cat-kicker">{menu.title} · card style</span>
      {MENU_SHAPES.map((s, i) => (
        <div key={s} class={`cat-style-line${menu.line === i ? " is-focus" : ""}${shape === s ? " is-picked" : ""}`}>
          <span>{CARD_SHAPE_LABELS[s]}</span>
          {shape === s && <b>✓</b>}
        </div>
      ))}
      <div class={`cat-style-line${menu.line === SIZE_LINE ? " is-focus" : ""}`}>
        <span>Size</span>
        <b>‹ {CARD_SIZE_LABELS[size]} ›</b>
      </div>
      <small>OK keeps · Back undoes</small>
    </Glass>
  );
}

/** A Nuvio folder: its cover, else its emoji, else its name, on a flat glass-like fill. */
function FolderTile({ item, x, w, h, focused }: { item: Title; x: number; w: number; h: number; focused: boolean }) {
  const cover = item.poster;
  const named = !item.folder?.hideTitle || !cover;
  return (
    <div class={`sg-tile cat-folder${focused ? " is-focus" : ""}`} style={{ left: `${x}px`, top: "0px", width: `${w}px`, height: `${h}px` }}>
      {cover ? (
        <img src={cover} alt="" decoding="async" onError={hideImg} />
      ) : (
        item.folder?.emoji && <span class="cat-folder-emoji">{item.folder.emoji}</span>
      )}
      {named && <b class={cover ? "cat-folder-cap" : item.folder?.emoji ? "cat-folder-name" : "cat-folder-title"}>{item.name}</b>}
      {item.badge && <span class="sg-tile-badge">{item.badge}</span>}
    </div>
  );
}

function hideImg(e: Event) {
  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
}
