// Catalog home in glass, Apple TV "top shelf" style: the focused title's art fills the top of the page,
// a frosted panel describes it, and poster rows scroll underneath. Same rules as Secretary Nest
// (tv-kit/src/glass, docs/performance.md): transform-only motion, no live blur, no soft shadows.
import { type Dir, type Focus, move, rowColumn, useKeys, windowOf } from "@secretary/tv-kit";
import {
  Glass,
  GlassRoot,
  Icon,
  IconButton,
  MediaTile,
  Segmented,
  showImg,
} from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { backgroundUrl, fetchMeta, posterUrl } from "../lib/cinemeta.ts";
import {
  CARD_SHAPE_LABELS,
  CARD_SHAPES,
  CARD_SIZE_LABELS,
  CARD_SIZES,
  type CardShape,
  cardLook,
  itemsFor,
  resolveCard,
  type RowStyle,
} from "../lib/collectionlayout.ts";
import type { LookBox } from "@secretary/tv-kit/src/row-look.ts";
import type { ClockFormat, DashboardSettings, OverlayTab } from "../lib/settings.ts";
import type { CatalogType, HomeRow, Title } from "../lib/types.ts";
import { DWELL_MS, HeroLayers, useBase, useHeroArt } from "./art.tsx";
import "./home.css";

const PAD = 80;
/** The style menu of a collection row (a long OK): beside the info panel, over the art. */
const MENU = { x: 1000, y: 150, w: 620 };
const MENU_LINE = 58;
/** Rows start under the info panel; the focused row is always the first one shown. */
const ROWS_Y = 560;
const ROW_H = 372;
const LABEL_H = 52;
/** Rows rendered below the focused one; the one above stays too, so a row leaving slides out instead of vanishing. */
const ROWS_BELOW = 2;
const ROWS_ABOVE = 1;
/** The bar under the last row: "You're all caught up", with Back to top and Browse all. */
const END_H = 120;
const END_ACTIONS = ["↑ Back to top", "⌕ Browse all"] as const;
const INFO = { x: PAD, y: 150, w: 880, h: 330 };
/** Inside Secretary Nest the top bar takes Nest's header: the pill at the left, then the time and two quiet buttons at the
 *  right, at Nest's own size and height (launcher/src/home.tsx). */
const NEST_HEAD = { y: 44, h: 78, iconW: 88, gap: 28, pad: PAD, seg: { x: PAD, w: 620 } };
const NEST_ICONS_X = 1920 - NEST_HEAD.pad - 2 * NEST_HEAD.iconW - NEST_HEAD.gap;

/** The top bar, left to right: the section pill, then Search and Settings. */
export const SECTIONS = ["Home", "Cinema", "Shows", "Anime"] as const;
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
  onOpenFolder(collectionId: string, folderId: string, rowLook?: CardShape): void;
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
  // Each row's look (shared with Nest, tv-kit/src/row-look.ts): its own choice, the setting, or Automatic, which
  // makes the page's first collection a spotlight and a chart a Top 10.
  const looks = useMemo(() => {
    const lead = rows.find((r) => r.rowKind === "folders")?.id;
    return rows.map((r) => {
      const folders = r.rowKind === "folders";
      const style = resolveCard({ title: r.title, tileShape: folders ? (r.tileShape ?? "SQUARE") : undefined, lead: r.id === lead }, look, rowStyles[r.id]);
      return { shape: style.shape, box: cardLook(style.shape, style.size), items: itemsFor(style.shape, r.items) };
    });
  }, [rows, look, rowStyles]);
  const lengths = looks.map((l) => l.items.length);
  const activeRow = rows[focus.row];
  const current = looks[focus.row]?.items[focus.col];
  // Where each row was left: a row comes back scrolled as it was, and arriving on a new one keeps focus in its slot.
  const lastCol = useRef(new Map<string, number>());
  if (activeRow) lastCol.current.set(activeRow.id, focus.col);
  /** Focus on the bar under the last row (0 Back to top, 1 Browse all), or null. */
  const [endIdx, setEndIdx] = useState<number | null>(null);
  useEffect(() => setEndIdx(null), [type]);
  const { backdrop, shade, sheen, mood } = useBase(type, current ? heroArt(current) : undefined);
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
      if (!current) return;
      if (current.folder) onOpenFolder(current.folder.collectionId, current.folder.folderId, looks[focus.row]?.shape);
      else onOpen(current, activeRow?.id === "continue");
    };
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keyup", onUp);
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };
  }, [active, current?.id, looks]);

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

    if (endIdx !== null) {
      if (key === "Up" || key === "Back") return void setEndIdx(null);
      if (key === "Left" || key === "Right") return void setEndIdx(key === "Left" ? 0 : 1);
      if (key === "Enter" && !e.repeat) {
        setEndIdx(null);
        if (endIdx === 1) return void onOpenHub("search");
        lastCol.current.clear();
        return void onFocus({ row: 0, col: 0 });
      }
      return;
    }

    if (key === "Enter") {
      if (!current) return;
      // Every row opens on release; held for 600 ms, OK opens the row's look menu instead.
      if (holdTimer.current || holding.current || e.repeat) return;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        holding.current = true;
        openMenu();
      }, 600);
      return;
    }
    if (key === "Back") return void onBack();
    // Up from the first row enters the top bar on this app's own section.
    if (key === "Up" && focus.row === 0) {
      setTopIdx(Math.max(1, SECTION_TYPES.indexOf(type)));
      return;
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      let next = move(lengths, focus, key.toLowerCase() as Dir);
      // Down past the last row: the end bar, never out of the page.
      if (next === focus && key === "Down") return void setEndIdx(0);
      if (next === focus) return;
      if (next.row !== focus.row) {
        const id = rows[next.row]?.id;
        next = { row: next.row, col: rowColumn(id ? lastCol.current.get(id) : undefined, focus.col, lengths[next.row]) };
      }
      onFocus(next);
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
  // On the end bar the page lifts just enough to show it whole under the last row.
  const endLift = endIdx !== null ? Math.max(0, ROW_H + END_H + 40 - (1080 - ROWS_Y)) : 0;
  const rowScroll = focus.row * ROW_H + endLift;
  const sectionIdx = Math.max(1, SECTION_TYPES.indexOf(type));

  // Entries saved without a synopsis (older Continue rows, My List) get one once focus rests on them.
  const [extra, setExtra] = useState<Record<string, string>>({});
  const needsText = current && !current.folder && !current.description ? current : null;
  useEffect(() => {
    if (!needsText || extra[needsText.id] !== undefined) return;
    let live = true;
    const t = setTimeout(() => {
      fetchMeta(needsText.catalogType ?? type, needsText.id).then(
        (m) => live && setExtra((e) => ({ ...e, [needsText.id]: m?.description ?? "" })),
        () => {},
      );
    }, DWELL_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [needsText?.id]);
  const extraText = needsText ? extra[needsText.id] : "";

  const kicker = !current
    ? heading
    : isContinue
      ? `Continue watching${current?.progressPct ? ` · ${current.progressPct}% watched` : ""}`
      : current.folder
        ? `${activeRow?.title} · Nuvio collection`
        : `${activeRow?.title ?? heading} · ${activeRow ? rowOriginLabel(activeRow, type) : ""}`;
  const meta = current
    ? [current.badge, current.badge?.includes(current.year) ? "" : current.year, current.rating && `IMDb ${current.rating}`, current.runtime, current.genre?.slice(0, 2).join(" · ")]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  return (
    <GlassRoot mode="fake" wallpaper={backdrop?.wallpaper} frost={frost} sheen={sheen} mood={mood} class="cat-home">
      <HeroLayers hero={hero} shade={shade} />

      {/* Secretary's header: the section pill at the left, then the time and two quiet buttons. */}
        <>
          <Segmented x={NEST_HEAD.seg.x} y={NEST_HEAD.y} w={NEST_HEAD.seg.w} h={NEST_HEAD.h} items={SECTIONS} picked={sectionIdx} focusIndex={topIdx !== null && topIdx < SECTIONS.length ? topIdx : -1} />
          <div class="nest-head" style={{ right: `${1920 - NEST_ICONS_X + 48}px`, top: `${NEST_HEAD.y}px` }}>
            <div class="nest-time">
              <b>{clockText}</b>
            </div>
          </div>
          <IconButton x={NEST_ICONS_X} y={NEST_HEAD.y} w={NEST_HEAD.iconW} h={NEST_HEAD.h} class="nest-quiet" icon={<Icon name="search" />} focused={topIdx === TOP_SEARCH} />
          <IconButton x={NEST_ICONS_X + NEST_HEAD.iconW + NEST_HEAD.gap} y={NEST_HEAD.y} w={NEST_HEAD.iconW} h={NEST_HEAD.h} class="nest-quiet" icon={<Icon name="settings" />} focused={topIdx === TOP_SETTINGS} />
        </>

      <Glass {...INFO} class="cat-info">
        <span class="cat-kicker">{kicker}</span>
        <h1>{current?.name ?? status ?? heading}</h1>
        {meta && <div class="cat-meta">{meta}</div>}
        {(current?.description || extraText) && <p>{current?.description || extraText}</p>}
        {current && (
          <div class="cat-hint">
            <span class="cat-ok">{isContinue ? "▶ OK to resume" : current.folder ? "OK to open the folder · hold OK for the row's look" : "OK for details · hold OK for the row's look"}</span>
            <span>CH- search · CH+ home</span>
          </div>
        )}
      </Glass>

      <div class="sg-clip cat-rows-clip" style={{ left: "0px", top: `${ROWS_Y - 20}px`, width: "1920px", height: `${1080 - ROWS_Y + 20}px` }}>
        <div class="sg-scroll" style={{ transform: `translate3d(0,${20 - rowScroll}px,0)` }}>
          {rows.slice(Math.max(0, focus.row - ROWS_ABOVE), focus.row + ROWS_BELOW + 1).map((row, k) => {
            const r = Math.max(0, focus.row - ROWS_ABOVE) + k;
            const { box, items } = looks[r];
            // Rows keep the column they were left at (lastCol), so moving between rows never sweeps one sideways.
            const col = r === focus.row ? focus.col : (lastCol.current.get(row.id) ?? 0);
            const [from, to] = windowOf(col, items.length);
            const shift = Math.max(0, col - 1) * box.stride;
            return (
              <section key={row.id} class="cat-row" style={{ top: `${r * ROW_H}px` }}>
                <div class="cat-row-head" style={{ left: `${PAD}px` }}>
                  <h2>{row.title}</h2>
                  <span>{rowOriginLabel(row, type)}</span>
                </div>
                <div class="sg-scroll" style={{ top: `${LABEL_H}px`, transform: `translate3d(${PAD - shift}px,0,0)` }}>
                  {items.slice(from, to).map((m, j) => {
                    const c = from + j;
                    const focused = inRows && endIdx === null && !menu && r === focus.row && c === focus.col;
                    return <RowTile key={`${row.id}:${m.catalogType ?? type}:${m.id}`} item={m} rank={c + 1} x={c * box.stride} box={box} focused={focused} />;
                  })}
                </div>
              </section>
            );
          })}
          {rows.length > 0 && focus.row >= rows.length - 1 - ROWS_BELOW && (
            <Glass x={PAD} y={rows.length * ROW_H + 12} w={1920 - 2 * PAD} h={END_H} frost={false} class="cat-end">
              <div class="cat-end-text">
                <b>You're all caught up</b>
                <small>That's every row for now</small>
              </div>
              <div class="cat-end-actions">
                {END_ACTIONS.map((label, i) => (
                  <span key={label} class={`cat-btn${endIdx === i ? " is-focus" : ""}`}>
                    {label}
                  </span>
                ))}
              </div>
            </Glass>
          )}
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
      <span class="cat-kicker">{menu.title} · row look</span>
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

/**
 * One card of a home row in its look: a poster or a still, with the ranking numeral before it (Top 10) or the title
 * on the art (spotlight); a Nuvio folder draws as FolderTile in the same box.
 */
function RowTile({ item, rank, x, box, focused }: { item: Title; rank: number; x: number; box: LookBox; focused: boolean }) {
  const w = box.w - box.lead;
  const at = box.lead ? box.lead : x;
  const tile = item.folder ? (
    <FolderTile item={item} x={at} w={w} h={box.h} focused={focused} />
  ) : (
    <MediaTile
      x={at}
      y={0}
      w={w}
      h={box.h}
      src={box.art === "still" ? backgroundUrl(item) : posterUrl(item)}
      title={box.caption ? item.name : undefined}
      sub={box.caption ? [item.year, item.genre?.[0]].filter(Boolean).join(" · ") : undefined}
      badge={item.badge}
      progress={item.progressPct != null ? item.progressPct / 100 : undefined}
      watched={item.watched}
      class={box.caption ? "cat-spot" : undefined}
      focused={focused}
    />
  );
  if (!box.lead) return tile;
  return (
    <div class="cat-rank" style={{ left: `${x}px`, width: `${box.w}px`, height: `${box.h}px` }}>
      <span style={{ width: `${box.lead + 30}px` }}>{rank}</span>
      {tile}
    </div>
  );
}

/** A Nuvio folder: its cover, else its emoji, else its name, on a flat glass-like fill. */
function FolderTile({ item, x, w, h, focused }: { item: Title; x: number; w: number; h: number; focused: boolean }) {
  const cover = item.poster;
  const named = !item.folder?.hideTitle || !cover;
  return (
    <div class={`sg-tile cat-folder${focused ? " is-focus" : ""}`} style={{ left: `${x}px`, top: "0px", width: `${w}px`, height: `${h}px` }}>
      {cover ? (
        <img class="sg-fade" src={cover} alt="" decoding="async" onLoad={showImg} onError={hideImg} />
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
