// The catalog home in Secretary's home look: Secretary's one header (tv-kit Header) at the top, the focused title's
// art behind the page with its logo (else its name), line and synopsis straight on the art's readable copy (art.tsx), as
// a title page shows them, and rows of posters at the home row's size underneath; Continue watching is a row of landscape stills. Which kind it
// shows (films, shows or anime) comes from the Secretary card the viewer opened it from (CatalogConfig.type); there are
// no section tabs. Same rules as Secretary's home (tv-kit/src/glass, docs/performance.md): transform and opacity only,
// faked blur, no soft shadows, and only the rows around focus are rendered.
import { type Dir, type Focus, move, rowColumn, useKeys, windowOf } from "@secretary/tv-kit";
import {
  Button,
  Glass,
  GlassRoot,
  Header,
  type HeaderAt,
  type HeaderButton,
  headerStart,
  type HeaderPerson,
  Kicker,
  LANDSCAPE,
  LandscapeTile,
  MediaTile,
  RankNumber,
  RowLabel,
  stepHeader,
  showImg,
} from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { backgroundUrl, fetchMeta, posterUrl, ratingLabel } from "../lib/cinemeta.ts";
import { cachedTitleArt } from "../lib/fanart.ts";
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
import type { HostHeader } from "../host.ts";
import { DWELL_MS, HeroLayers, TitleMark, useBase, useHeroArt, useLogo } from "./art.tsx";
import "./home.css";

const PAD = 80;
/** The style menu of a collection row (a long OK): beside the info panel, over the art. */
const MENU = { x: 1000, y: 150, w: 620 };
const MENU_LINE = 58;
/**
 * The focused title's caption, over the art between the header and the rows, anchored by its foot so the rows' label
 * never meets it; the mark is the logo (else the name) in its box, and the synopsis keeps its two lines' height.
 */
const CAPTION = { x: PAD, foot: 536, w: 1000, mark: { w: 620, h: 150 }, lines: 2 };
/** The focused row's top: its label, then its tiles; the next row's label peeks in under it. */
const ROWS_Y = 580;
/** A row's label over its tiles, then the tiles, then the gap to the next row's label. */
const LABEL_H = 50;
const ROW_GAP = 60;
/** Rows rendered below the focused one; the one above stays too, so a row leaving slides out instead of vanishing. */
const ROWS_BELOW = 2;
const ROWS_ABOVE = 1;
/** The bar under the last row: "You're all caught up", with Back to top and Search. */
const END_H = 120;
const END_ACTIONS = [
  { id: "top", label: "Back to top", icon: undefined },
  { id: "search", label: "Search", icon: "search" },
] as const;
/** The header of a catalog run on its own (no Secretary around it): Search and Settings, then the clock. */
const HEAD_BUTTONS: readonly HeaderButton[] = [
  { key: "search", icon: "search" },
  { key: "settings", icon: "settings" },
];
/** Continue watching is a row of stills with the title on the art. */
const CONTINUE_BOX: LookBox = { w: LANDSCAPE.w, h: LANDSCAPE.h, stride: LANDSCAPE.w + LANDSCAPE.gap, art: "still", lead: 0, caption: true };

function formatClock(fmt: ClockFormat): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: fmt === "12h" });
}

interface Props {
  type: CatalogType;
  rows: HomeRow[];
  focus: Focus;
  active: boolean;
  status: string | null;
  /** The kind's name (Cinema, Shows, Anime), shown before a title has focus. */
  heading: string;
  clockFormat?: ClockFormat;
  /** The person at the top left of the header, as on Secretary's home (EmbeddedHost.person). */
  person?: HeaderPerson;
  /** Secretary's one header (host.ts), drawn whole as on its home; without it, Search and Settings. */
  header?: HostHeader;
  onFocus(f: Focus): void;
  onOpen(title: Title, autoPlay?: boolean): void;
  onOpenFolder(collectionId: string, folderId: string, rowLook?: CardShape): void;
  /** How Nuvio collection rows look (Settings › Collections), and each row's own choice (a long OK on it). */
  look: DashboardSettings["collections"];
  rowStyles: Record<string, RowStyle>;
  onRowStyle(rowId: string, style: RowStyle): void;
  onDwell(title: Title): void;
  onOpenHub(tab?: OverlayTab, autoVoice?: boolean): void;
  onBack(): void;
}

/** The backdrop for a focused card (the art lookup's, when it has the title cached); a Nuvio folder shows only its collection's art. */
const heroArt = (type: CatalogType, t: Title): string | undefined =>
  t.folder ? t.background : cachedTitleArt(t.catalogType ?? type, t, "hero").background;

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

/** Each row's top from the first row's, and where the rows end: a row is its label, its tiles and the gap after. */
export function rowTops(heights: readonly number[]): { tops: number[]; end: number } {
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += LABEL_H + h + ROW_GAP;
  }
  return { tops, end: y };
}

export function Home({
  type,
  rows,
  focus,
  active,
  status,
  heading,
  clockFormat = "24h",
  person,
  header,
  onFocus,
  onOpen,
  onOpenFolder,
  look,
  rowStyles,
  onRowStyle,
  onDwell,
  onOpenHub,
  onBack,
}: Props) {
  /** Focus in the header (the person, or a button's index), or null when it is in the rows. */
  const [topIdx, setTopIdx] = useState<HeaderAt | null>(null);
  const headButtons = header?.buttons ?? HEAD_BUTTONS;
  const headPerson = header?.person ?? person;
  const [clockText, setClockText] = useState(() => formatClock(clockFormat));
  // Each row's look (shared with Secretary's cards, tv-kit/src/row-look.ts): its own choice, the setting, or Automatic,
  // which makes the page's first collection a spotlight and a chart a Top 10. Continue watching is always stills.
  const looks = useMemo(() => {
    const lead = rows.find((r) => r.rowKind === "folders")?.id;
    return rows.map((r) => {
      if (r.id === "continue") return { shape: "landscape" as CardShape, box: CONTINUE_BOX, items: r.items };
      const folders = r.rowKind === "folders";
      const style = resolveCard({ title: r.title, tileShape: folders ? (r.tileShape ?? "SQUARE") : undefined, lead: r.id === lead }, look, rowStyles[r.id]);
      return { shape: style.shape, box: cardLook(style.shape, style.size), items: itemsFor(style.shape, r.items) };
    });
  }, [rows, look, rowStyles]);
  const lengths = looks.map((l) => l.items.length);
  const { tops, end: rowsEnd } = useMemo(() => rowTops(looks.map((l) => l.box.h)), [looks]);
  const activeRow = rows[focus.row];
  const current = looks[focus.row]?.items[focus.col];
  // Where each row was left: a row comes back scrolled as it was, and arriving on a new one keeps focus in its slot.
  const lastCol = useRef(new Map<string, number>());
  if (activeRow) lastCol.current.set(activeRow.id, focus.col);
  /** Focus on the bar under the last row (0 Back to top, 1 Search), or null. */
  const [endIdx, setEndIdx] = useState<number | null>(null);
  useEffect(() => setEndIdx(null), [type]);
  const heroSrc = current ? heroArt(type, current) : undefined;
  const { backdrop, shade, sheen, mood } = useBase(type, heroSrc);
  // The focused card's art becomes the backdrop once focus rests on it, with its readable copy under the caption.
  const hero = useHeroArt(current?.id, heroSrc, active, false, undefined, true);
  // Its logo, looked up once focus has rested as long (a folder has none).
  const logo = useLogo(current?.catalogType ?? type, current && !current.folder ? current : undefined, DWELL_MS);

  useEffect(() => {
    setClockText(formatClock(clockFormat));
    const t = setInterval(() => setClockText(formatClock(clockFormat)), 30_000);
    return () => clearInterval(t);
  }, [clockFormat]);

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
    // Continue watching is always stills: it has no look menu, so a long OK on it resumes like a short one.
    if (activeRow.id === "continue") {
      holding.current = false;
      if (current) onOpen(current, true);
      return;
    }
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
    // CH- or Search opens search; CH+ back to Secretary's home is the catalog's own (app.tsx).
    if (key === "ChannelDown" || key === "Search" || key === "SearchVoice") {
      setTopIdx(null);
      onOpenHub("search", key === "SearchVoice");
      return;
    }

    if (topIdx !== null) {
      if (key === "Enter") {
        setTopIdx(null);
        if (header) return void header.press(topIdx);
        return void (topIdx !== "person" && onOpenHub(HEAD_BUTTONS[topIdx].key as OverlayTab));
      }
      const r = stepHeader(topIdx, key, Boolean(headPerson && header), headButtons.length);
      if (r === "leave") return void setTopIdx(null);
      if (r !== topIdx) return void setTopIdx(r);
      return key === "Left" || key === "Right" ? undefined : false;
    }

    if (endIdx !== null) {
      if (key === "Up" || key === "Back") return void setEndIdx(null);
      if (key === "Left" || key === "Right") return void setEndIdx(key === "Left" ? 0 : 1);
      if (key === "Enter" && !e.repeat) {
        setEndIdx(null);
        if (END_ACTIONS[endIdx].id === "search") return void onOpenHub("search");
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
    // Up from the first row enters the header, on Search.
    if (key === "Up" && focus.row === 0) return void setTopIdx(headButtons.length ? 0 : headerStart(Boolean(headPerson && header), 0));
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
  // The focused row sits at ROWS_Y; on the end bar the page lifts just enough to show the bar whole.
  const focusTop = tops[focus.row] ?? 0;
  const endLift = endIdx !== null ? Math.max(0, rowsEnd + END_H + 40 - focusTop - (1080 - ROWS_Y)) : 0;
  const rowScroll = focusTop + endLift;

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

  // The kind (Cinema, Shows, Anime) over the title: the row's name is already over its tiles.
  const kicker = current?.folder ? `${heading} · Collection` : heading;
  const meta = current
    ? [
        isContinue && current.progressPct ? `${current.progressPct}% watched` : "",
        current.badge ?? "",
        current.badge?.includes(current.year) ? "" : current.year,
        ratingLabel(current.rating),
        current.runtime ?? "",
        current.genre?.slice(0, 2).join(", ") ?? "",
      ].filter(Boolean)
    : [];

  return (
    <GlassRoot mode="fake" wallpaper={backdrop?.wallpaper} frost={frost} sheen={sheen} mood={mood} class="cat-home">
      <HeroLayers hero={hero} shade={shade} />

      {/* Secretary's one header: the person, its buttons, the clock last. */}
      <Header time={header?.time ?? clockText} person={headPerson} buttons={headButtons} focus={topIdx} />

      {/* The caption straight on the art's readable copy, as on a title page; every line keeps its height. */}
      <div class="cat-caption" style={{ left: `${CAPTION.x}px`, bottom: `${1080 - CAPTION.foot}px`, width: `${CAPTION.w}px` }}>
        <Kicker>{kicker}</Kicker>
        <TitleMark name={current?.name ?? status ?? heading} logo={logo.src} w={CAPTION.mark.w} h={CAPTION.mark.h} class="cat-caption-mark" />
        <small class="cat-caption-meta">{meta.join(" · ") || " "}</small>
        <p class="cat-caption-about" style={{ WebkitLineClamp: CAPTION.lines }}>
          {current?.description || extraText || ""}
        </p>
      </div>

      <div class="sg-clip" style={{ left: "0px", top: `${ROWS_Y - 30}px`, width: "1920px", height: `${1080 - ROWS_Y + 30}px` }}>
        <div class="sg-scroll" style={{ transform: `translate3d(0,${30 - rowScroll}px,0)` }}>
          {rows.slice(Math.max(0, focus.row - ROWS_ABOVE), focus.row + ROWS_BELOW + 1).map((row, k) => {
            const r = Math.max(0, focus.row - ROWS_ABOVE) + k;
            const { box, items } = looks[r];
            const still = row.id === "continue";
            // Rows keep the column they were left at (lastCol), so moving between rows never sweeps one sideways.
            const col = r === focus.row ? focus.col : (lastCol.current.get(row.id) ?? 0);
            const [from, to] = windowOf(col, items.length);
            const shift = Math.max(0, col - 1) * box.stride;
            return (
              <section key={row.id} class="cat-row" style={{ top: `${tops[r]}px`, height: `${LABEL_H + box.h}px` }}>
                <RowLabel x={PAD} y={0} label={row.title} count={items.length} />
                <div class="sg-scroll" style={{ top: `${LABEL_H}px`, transform: `translate3d(${PAD - shift}px,0,0)` }}>
                  {items.slice(from, to).map((m, j) => {
                    const c = from + j;
                    const focused = inRows && endIdx === null && !menu && r === focus.row && c === focus.col;
                    const key = `${row.id}:${m.catalogType ?? type}:${m.id}`;
                    return still ? (
                      <LandscapeTile
                        key={key}
                        x={c * box.stride}
                        y={0}
                        src={backgroundUrl(m)}
                        title={m.name}
                        sub={m.progressPct ? `${m.progressPct}% watched` : m.year}
                        progress={m.progressPct != null ? m.progressPct / 100 : undefined}
                        watched={m.watched}
                        focused={focused}
                      />
                    ) : (
                      <RowTile key={key} item={m} rank={c + 1} x={c * box.stride} box={box} focused={focused} />
                    );
                  })}
                </div>
              </section>
            );
          })}
          {rows.length > 0 && focus.row >= rows.length - 1 - ROWS_BELOW && (
            <Glass x={PAD} y={rowsEnd} w={1920 - 2 * PAD} h={END_H} frost={false} class="cat-end">
              <div class="cat-end-text">
                <b>You're all caught up</b>
                <small>That's every row for now</small>
              </div>
              <div class="cat-end-actions">
                {END_ACTIONS.map((a, i) => (
                  <Button key={a.id} label={a.label} icon={a.icon} focused={endIdx === i} />
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
    <Glass x={MENU.x} y={MENU.y} w={MENU.w} h={(SIZE_LINE + 1) * MENU_LINE + 72} class="cat-style">
      <Kicker>{menu.title} · row look</Kicker>
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
      <RankNumber x={0} w={box.lead} h={box.h} n={rank} focused={focused} />
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
