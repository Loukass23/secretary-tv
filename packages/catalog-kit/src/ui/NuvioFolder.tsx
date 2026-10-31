// A folder of a Nuvio collection (lib/nuviocollections.ts), in one of seven views (lib/collectionlayout.ts): a poster
// grid, a mural of wide art, a timeline by year, a cover flow and a ranking each show one catalog at a time under the
// tabs ("All" first, every catalog together); rows show every catalog at once, and decades one row per decade. The
// View button (top right) sets this folder's own view; the tabs take one of four styles. Pages are read as focus
// nears the end. Glass rules as the home (docs/performance.md): transform-only motion, windowed lists, no blur.
import { type Dir, type Focus, move, useKeys, windowOf } from "@secretary/tv-kit";
import { Glass, GlassRoot, MediaTile, Segmented } from "@secretary/tv-kit/src/glass/index.ts";
import type { CollectionFolder, NuvioCollection } from "@secretary/nuvio";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { backgroundUrl, posterUrl } from "../lib/cinemeta.ts";
import {
  autoFolderView,
  byDecade,
  byYear,
  FOLDER_VIEW_LABELS,
  FOLDER_VIEWS,
  type FolderView,
  loadFolderView,
  resolveFolderView,
  resolveTabStyle,
  saveFolderView,
  tabbed,
} from "../lib/collectionlayout.ts";
import { folderBackdrop, interleave, loadSourcePage, type ResolvedSource, type SourceKeys, withImdbId } from "../lib/nuviocollections.ts";
import type { DashboardSettings } from "../lib/settings.ts";
import type { CatalogType, Title } from "../lib/types.ts";
import { HeroLayers, useBase, useHeroArt } from "./art.tsx";
import { island } from "./Island.tsx";
import "./folder.css";

const PAD = 80;
const CARD_W = 180;
const CARD_H = 270;
const STRIDE = CARD_W + 22;
/** The poster grid and the mural: columns, card and row height. */
const GRID = { cols: 8, w: CARD_W, h: CARD_H, rowH: CARD_H + 40 };
const MURAL = { cols: 4, w: 400, h: 225, rowH: 225 + 40 };
const BODY_Y = 330;
const ROWS_Y = 300;
const ROW_H = 372;
const LABEL_H = 52;
/** Rows drawn around the focused one. */
const ABOVE = 1;
const BELOW = 2;
/** How near the end of what is read focus gets before the next page is asked for. */
const AHEAD = 10;
const TABS = { x: PAD, y: 210, h: 64 };
// Catalog names run long ("New Adventure Movies"): fewer, wider tabs.
const TAB_W = 340;
const TABS_SHOWN = 5;
const VIEW_BTN = { x: 1460, y: 56, w: 380, h: 64 };
/** The list a dropdown or the View button opens. */
const POPUP = { x: 1180, w: 660, line: 56, shown: 9 };
/** Timeline: step between posters; cover flow: the focused cover and the distances to its neighbours. */
const TL_STEP = 250;
const FLOW = { w: 300, h: 450, first: 280, next: 150 };
const RANK_STEP = 330;

interface SourceState {
  items: Title[];
  page: number;
  more: boolean;
  loading: boolean;
  failed?: boolean;
}

type Zone = "view" | "tabs" | "items";

interface Popup {
  kind: "tabs" | "view";
  cursor: number;
}

interface Props {
  type: CatalogType;
  collection: NuvioCollection;
  folder: CollectionFolder;
  sources: ResolvedSource[];
  keys: SourceKeys;
  /** Settings › Collections: the folder view and the tab style (each may be Automatic). */
  look: DashboardSettings["collections"];
  active: boolean;
  onOpen(type: CatalogType, title: Title): void;
  onBack(): void;
}

const isFilmography = (r: ResolvedSource) =>
  r.source.provider === "tmdb" && (r.source.tmdbSourceType === "PERSON" || r.source.tmdbSourceType === "DIRECTOR");

export function NuvioFolder({ type, collection, folder, sources, keys, look, active, onOpen, onBack }: Props) {
  const [own, setOwn] = useState<FolderView | null>(() => loadFolderView(collection.id, folder.id));
  const auto = autoFolderView(collection.viewMode, sources.length > 0 && sources.every(isFilmography));
  const view = resolveFolderView(own, look.folderView, auto);
  const withTabs = tabbed(view);
  const allTab = withTabs && collection.showAllTab && sources.length > 1;
  const tabs = useMemo(() => (allTab ? ["All", ...sources.map((s) => s.title)] : sources.map((s) => s.title)), [sources, allTab]);
  const tabStyle = resolveTabStyle(look.tabStyle, tabs.length);

  const [state, setState] = useState<Record<string, SourceState>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const [tab, setTab] = useState(0);
  const [zone, setZone] = useState<Zone>("items");
  const [popup, setPopup] = useState<Popup | null>(null);
  /** The focused title in the one-catalog views. */
  const [index, setIndex] = useState(0);
  /** The focused title in rows and decades. */
  const [focus, setFocus] = useState<Focus>({ row: 0, col: 0 });

  /** The sources the current tab shows. */
  const tabSources = !withTabs ? sources : allTab && tab === 0 ? sources : [sources[tab - (allTab ? 1 : 0)]].filter(Boolean);

  const load = (r: ResolvedSource) => {
    const s = stateRef.current[r.key] ?? { items: [], page: 0, more: true, loading: false };
    if (s.loading || !s.more) return;
    const put = (next: Partial<SourceState>) => setState((all) => ({ ...all, [r.key]: { ...(all[r.key] ?? s), ...next } }));
    stateRef.current = { ...stateRef.current, [r.key]: { ...s, loading: true } };
    put({ loading: true });
    loadSourcePage(r, s.page + 1, s.items.length, keys).then(
      (got) =>
        setState((all) => {
          const cur = all[r.key] ?? s;
          const have = new Set(cur.items.map((t) => t.id));
          const fresh = got.items.filter((t) => !have.has(t.id));
          // A page with nothing new is the end, whatever the source says.
          return { ...all, [r.key]: { items: [...cur.items, ...fresh], page: cur.page + 1, more: got.more && fresh.length > 0, loading: false } };
        }),
      () => put({ loading: false, more: false, failed: true }),
    );
  };

  const tabItems = useMemo(
    () => (tabSources.length === 1 ? (state[tabSources[0].key]?.items ?? []) : interleave(tabSources.map((r) => state[r.key]?.items ?? []))),
    [state, tab, view],
  );
  /** The one-catalog views' list, in the order shown; the timeline goes by year. */
  const line = view === "timeline" ? byYear(tabItems) : tabItems;
  const decades = useMemo(() => (view === "decades" ? byDecade(tabItems) : []), [tabItems, view]);
  /** Rows and decades: the rows, their names and their titles. */
  const stacked =
    view === "rows"
      ? sources.map((r) => ({ key: r.key, label: r.title, items: state[r.key]?.items ?? [], source: r }))
      : decades.map((d) => ({ key: d.label, label: d.label, items: d.items, source: undefined }));
  const isStacked = view === "rows" || view === "decades";
  const box = view === "mural" ? MURAL : GRID;
  const cols = view === "grid" || view === "mural" ? box.cols : 1;

  // The first pages of what is on screen, then more as focus nears the end.
  useEffect(() => {
    if (view === "rows") {
      // Rows that came back empty are skipped by the focus, so the rows read reach that many real ones below.
      let real = 0;
      for (let row = Math.max(0, focus.row - ABOVE); row < sources.length && real <= BELOW + 1; row++) {
        const r = sources[row];
        const s = state[r.key];
        if (!s || s.loading || s.items.length) real++;
        // Rows around the focused one need only their first page; the focused row reads on as focus nears its end.
        if (row === focus.row ? focus.col >= (s?.items.length ?? 0) - AHEAD : !s) load(r);
      }
    } else if (view === "decades") {
      // Decades are cut from everything read so far: more is read as focus reaches the last decade.
      if (!tabItems.length || focus.row >= decades.length - 1) tabSources.forEach(load);
    } else if (index >= line.length - AHEAD) tabSources.forEach(load);
  }, [tab, index, focus, tabItems.length, state, view]);

  const current = zone !== "items" || popup ? undefined : isStacked ? stacked[focus.row]?.items[focus.col] : line[index];
  const { backdrop, shade } = useBase(type);
  const folderArt = folderBackdrop(collection, folder);
  const hero = useHeroArt(current?.id ?? `folder:${folder.id}`, current ? backgroundUrl(current) : folderArt, active, !current);

  const pickTab = (i: number) => {
    const next = Math.max(0, Math.min(tabs.length - 1, i));
    if (next === tab) return;
    setTab(next);
    setIndex(0);
    setFocus({ row: 0, col: 0 });
  };
  const pickView = (v: FolderView | null) => {
    saveFolderView(collection.id, folder.id, v);
    setOwn(v);
    setIndex(0);
    setFocus({ row: 0, col: 0 });
    setTab(0);
  };
  /** The View list: "Default" (back to the setting) and the seven views. */
  const viewChoices: (FolderView | null)[] = [null, ...FOLDER_VIEWS];
  const hasTabBar = withTabs && tabs.length > 1;

  /** Opens a title; a TMDB one is matched to its IMDb id first (streams are found by IMDb id). */
  const opening = useRef(false);
  const open = (t: Title) => {
    if (opening.current) return;
    opening.current = true;
    withImdbId(t, keys)
      .then(
        (found) =>
          found
            ? onOpen(found.catalogType ?? type, found)
            : island.push({ key: "folder", text: `No IMDb entry for ${t.name}, so no sources`, level: "info", ms: 2500 }),
        () => island.push({ key: "folder", text: "Couldn't reach TMDB", level: "info", ms: 2500 }),
      )
      .finally(() => (opening.current = false));
  };

  const popupKey = (p: Popup, key: string) => {
    const n = p.kind === "tabs" ? tabs.length : viewChoices.length;
    if (key === "Back") return void setPopup(null);
    if (key === "Up" || key === "Down") return void setPopup({ ...p, cursor: Math.max(0, Math.min(n - 1, p.cursor + (key === "Up" ? -1 : 1))) });
    if (key === "Enter") {
      setPopup(null);
      if (p.kind === "tabs") pickTab(p.cursor);
      else pickView(viewChoices[p.cursor]);
      setZone("items");
    }
  };

  /** Up from the top of the titles: the tabs, else the View button. */
  const up = () => setZone(hasTabBar ? "tabs" : "view");

  useKeys(active, (key) => {
    if (popup) return void popupKey(popup, key);
    if (key === "Back") {
      if (zone !== "items") return void setZone("items");
      return void onBack();
    }
    if (zone === "view") {
      if (key === "Enter") return void setPopup({ kind: "view", cursor: Math.max(0, viewChoices.indexOf(own)) });
      if (key === "Down") return void setZone(hasTabBar ? "tabs" : "items");
      return false;
    }
    if (zone === "tabs") {
      if (key === "Left") return void pickTab(tab - 1);
      if (key === "Right") return void pickTab(tab + 1);
      if (key === "Up") return void setZone("view");
      if (key === "Enter" && tabStyle === "dropdown") return void setPopup({ kind: "tabs", cursor: tab });
      if (key === "Down" || key === "Enter") return void setZone("items");
      return false;
    }
    if (key === "Enter") return void (current && open(current));
    if (isStacked) {
      if (key === "Up" && focus.row === 0) return void up();
      if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
        // Pages: Left from the first title turns back a page.
        if (key === "Left" && focus.col === 0 && tabStyle === "pages" && hasTabBar) return void pickTab(tab - 1);
        const next = move(
          stacked.map((r) => r.items.length),
          focus,
          key.toLowerCase() as Dir,
        );
        if (next !== focus) setFocus(next);
        else if (key === "Right" && tabStyle === "pages" && hasTabBar) pickTab(tab + 1);
        return;
      }
      return false;
    }
    // The timeline, cover flow and ranking are one line: Left and Right walk it. The grid and the mural keep to
    // their row, and Up and Down move between rows.
    const linear = cols === 1;
    const col = index % cols;
    const pages = tabStyle === "pages" && hasTabBar;
    if (key === "Left") return void ((linear ? index > 0 : col > 0) ? setIndex(index - 1) : pages && pickTab(tab - 1));
    if (key === "Right") {
      if ((linear || col < cols - 1) && index + 1 < line.length) return void setIndex(index + 1);
      return void (pages && pickTab(tab + 1));
    }
    if (key === "Up") return void (!linear && index >= cols ? setIndex(index - cols) : up());
    if (key === "Down") {
      if (linear) return;
      if (index + cols < line.length) setIndex(index + cols);
      else if (Math.floor(index / cols) < Math.floor((line.length - 1) / cols)) setIndex(line.length - 1);
      return;
    }
    return false;
  });

  const status = (list: readonly ResolvedSource[]) => {
    const st = list.map((r) => state[r.key]);
    if (st.some((s) => !s || s.loading)) return "Loading…";
    if (st.every((s) => s?.failed)) return "Couldn't reach this folder's catalogs";
    return "Nothing here yet";
  };

  const focusedItems = zone === "items" && !popup;

  return (
    <div class="folder-glass" style={active ? undefined : "display:none"}>
      <GlassRoot mode="fake" wallpaper={backdrop?.wallpaper} frost={hero.frost ?? backdrop?.frost} class="nf">
        <HeroLayers hero={hero} shade={shade} />

        <div class="nf-head" style={{ left: `${PAD}px`, top: "56px" }}>
          <span class="cat-kicker">
            {collection.title} · {folder.title}
          </span>
          <h1>{current?.name ?? folder.title}</h1>
          <p>
            {current
              ? [current.year, current.rating && `IMDb ${current.rating}`].filter(Boolean).join("  ·  ") || folder.title
              : `${sources.length} ${sources.length === 1 ? "catalog" : "catalogs"}`}
          </p>
        </div>

        <Glass {...VIEW_BTN} focused={zone === "view" && !popup} class="nf-view">
          <span>View · {FOLDER_VIEW_LABELS[view]}</span>
        </Glass>

        {hasTabBar && <TabBar style={tabStyle} tabs={tabs} tab={tab} focused={zone === "tabs" && !popup} />}

        {view === "grid" || view === "mural" ? (
          <GridBody items={line} index={index} focused={focusedItems} mural={view === "mural"} empty={status(tabSources)} type={type} />
        ) : view === "timeline" ? (
          <TimelineBody items={line} index={index} focused={focusedItems} empty={status(tabSources)} type={type} />
        ) : view === "coverflow" ? (
          <FlowBody items={line} index={index} focused={focusedItems} empty={status(tabSources)} type={type} />
        ) : view === "ranking" ? (
          <RankBody items={line} index={index} focused={focusedItems} empty={status(tabSources)} type={type} />
        ) : (
          <div class="sg-clip nf-clip" style={{ left: "0px", top: `${ROWS_Y - 20}px`, width: "1920px", height: `${1080 - ROWS_Y + 20}px` }}>
            {!stacked.length && <div class="nf-empty" style={{ left: `${PAD}px`, top: `${BODY_Y - ROWS_Y + 40}px` }}>{status(tabSources)}</div>}
            <div class="sg-scroll" style={{ transform: `translate3d(0,${20 - focus.row * ROW_H}px,0)` }}>
              {stacked.slice(focus.row, focus.row + BELOW + 1).map((r, k) => {
                const row = focus.row + k;
                const [from, to] = windowOf(row === focus.row ? focus.col : 0, r.items.length);
                const shift = row === focus.row ? Math.max(0, focus.col - 1) * STRIDE : 0;
                return (
                  <section key={r.key} class="cat-row" style={{ top: `${row * ROW_H}px` }}>
                    <div class="cat-row-head" style={{ left: `${PAD}px` }}>
                      <h2>{r.label}</h2>
                      <span>
                        {r.source
                          ? r.items.length
                            ? (r.source.addon?.name ?? r.source.source.provider.toUpperCase())
                            : status([r.source])
                          : `${r.items.length} ${r.items.length === 1 ? "title" : "titles"}`}
                      </span>
                    </div>
                    <div class="sg-scroll" style={{ top: `${LABEL_H}px`, transform: `translate3d(${PAD - shift}px,0,0)` }}>
                      {r.items.slice(from, to).map((m, j) => (
                        <MediaTile
                          key={`${r.key}:${m.id}`}
                          x={(from + j) * STRIDE}
                          y={0}
                          w={CARD_W}
                          h={CARD_H}
                          src={posterUrl(m)}
                          focused={focusedItems && row === focus.row && from + j === focus.col}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {popup && (
          <PopupList
            title={popup.kind === "tabs" ? folder.title : "View"}
            items={
              popup.kind === "tabs"
                ? tabs
                : viewChoices.map((v) => (v ? FOLDER_VIEW_LABELS[v] : `Default (${FOLDER_VIEW_LABELS[resolveFolderView(null, look.folderView, auto)]})`))
            }
            cursor={popup.cursor}
            picked={popup.kind === "tabs" ? tab : viewChoices.indexOf(own)}
          />
        )}
      </GlassRoot>
    </div>
  );
}

/** The tab bar in its style: chips at the left, a bar in the centre, a dropdown pill, or a page indicator. */
function TabBar({ style, tabs, tab, focused }: { style: string; tabs: readonly string[]; tab: number; focused: boolean }) {
  if (style === "dropdown" || style === "pages") {
    const label = style === "dropdown" ? `${tabs[tab]}  ▾` : `‹  ${tabs[tab]}  ›`;
    return (
      <Glass {...TABS} w={720} focused={focused} class="nf-pill">
        <span>{label}</span>
        <small>
          {tab + 1} / {tabs.length}
        </small>
      </Glass>
    );
  }
  const from = Math.max(0, Math.min(tab - 2, tabs.length - TABS_SHOWN));
  const shown = tabs.slice(from, from + TABS_SHOWN);
  const w = shown.length * TAB_W;
  return (
    <Segmented
      {...TABS}
      x={style === "centre" ? (1920 - w) / 2 : TABS.x}
      w={w}
      items={shown}
      picked={tab - from}
      focusIndex={focused ? tab - from : -1}
      class={style === "centre" ? "nf-centre" : undefined}
    />
  );
}

/** A list over the page: the tabs of a dropdown, or the views. Windowed around the cursor. */
function PopupList({ title, items, cursor, picked }: { title: string; items: readonly string[]; cursor: number; picked: number }) {
  const from = Math.max(0, Math.min(cursor - 4, items.length - POPUP.shown));
  const shown = items.slice(from, from + POPUP.shown);
  return (
    <Glass x={POPUP.x} y={140} w={POPUP.w} h={shown.length * POPUP.line + 120} class="nf-popup">
      <span class="cat-kicker">{title}</span>
      {shown.map((label, k) => (
        <div key={from + k} class={`cat-style-line${from + k === cursor ? " is-focus" : ""}${from + k === picked ? " is-picked" : ""}`}>
          <span>{label}</span>
          {from + k === picked && <b>✓</b>}
        </div>
      ))}
      <small>OK picks · Back closes</small>
    </Glass>
  );
}

interface BodyProps {
  items: readonly Title[];
  index: number;
  focused: boolean;
  empty: string;
  type: CatalogType;
}

const Clip = ({ children, empty, has }: { children: ComponentChildren; empty: string; has: boolean }) => (
  <div class="sg-clip nf-clip" style={{ left: "0px", top: `${BODY_Y - 20}px`, width: "1920px", height: `${1080 - BODY_Y + 20}px` }}>
    {!has && <div class="nf-empty" style={{ left: `${PAD}px` }}>{empty}</div>}
    {children}
  </div>
);

/** Posters in a grid, or the mural: wide art, four to a line. */
function GridBody({ items, index, focused, mural, empty, type }: BodyProps & { mural: boolean }) {
  const b = mural ? MURAL : GRID;
  const row = Math.floor(index / b.cols);
  const first = Math.max(0, row - ABOVE);
  return (
    <Clip empty={empty} has={items.length > 0}>
      <div class="sg-scroll" style={{ transform: `translate3d(${PAD}px,${20 - first * b.rowH}px,0)` }}>
        {items.slice(first * b.cols, (row + BELOW + 1) * b.cols).map((m, j) => {
          const i = first * b.cols + j;
          return (
            <MediaTile
              key={`${m.catalogType ?? type}:${m.id}`}
              x={(i % b.cols) * (b.w + 22)}
              y={Math.floor(i / b.cols) * b.rowH}
              w={b.w}
              h={b.h}
              src={mural ? backgroundUrl(m) : posterUrl(m)}
              title={mural ? m.name : undefined}
              sub={mural ? m.year : undefined}
              focused={focused && i === index}
            />
          );
        })}
      </div>
    </Clip>
  );
}

/** Oldest first along a line, the year marked where it changes. */
function TimelineBody({ items, index, focused, empty, type }: BodyProps) {
  const [from, to] = windowOf(index, items.length, 4, 7);
  const shift = Math.max(0, index - 2) * TL_STEP;
  return (
    <Clip empty={empty} has={items.length > 0}>
      <div class="sg-scroll" style={{ transform: `translate3d(${PAD - shift}px,20px,0)` }}>
        <div class="nf-tl-line" style={{ left: `${from * TL_STEP}px`, width: `${(to - from) * TL_STEP}px` }} />
        {items.slice(from, to).map((m, j) => {
          const i = from + j;
          const newYear = i === 0 || items[i - 1].year !== m.year;
          return (
            <div key={`${m.catalogType ?? type}:${m.id}`} class="nf-tl-step" style={{ left: `${i * TL_STEP}px` }}>
              <span class={`nf-tl-dot${newYear ? " is-year" : ""}`}>{newYear ? m.year || "—" : ""}</span>
              <MediaTile x={0} y={70} w={200} h={300} src={posterUrl(m)} focused={focused && i === index} />
              <b>{m.name}</b>
            </div>
          );
        })}
      </div>
    </Clip>
  );
}

/** The focused cover large in the middle, its neighbours smaller on each side. Moves by transform only. */
function FlowBody({ items, index, focused, empty, type }: BodyProps) {
  const [from, to] = windowOf(index, items.length, 6, 7);
  return (
    <Clip empty={empty} has={items.length > 0}>
      {items.slice(from, to).map((m, j) => {
        const d = from + j - index;
        const a = Math.abs(d);
        const x = a === 0 ? 0 : Math.sign(d) * (FLOW.first + (a - 1) * FLOW.next);
        const s = a === 0 ? 1 : Math.max(0.45, 0.72 - 0.06 * (a - 1));
        return (
          <div
            key={`${m.catalogType ?? type}:${m.id}`}
            class={`nf-flow${a === 0 && focused ? " is-focus" : ""}`}
            style={{
              left: `${960 - FLOW.w / 2}px`,
              top: "40px",
              width: `${FLOW.w}px`,
              height: `${FLOW.h}px`,
              zIndex: 20 - a,
              transform: `translate3d(${x}px,0,0) scale(${s})`,
              opacity: a > 5 ? 0 : 1,
            }}
          >
            <img src={posterUrl(m)} alt="" decoding="async" />
            {a > 0 && <i />}
          </div>
        );
      })}
    </Clip>
  );
}

/** A big numeral beside each poster, in the catalog's own order. */
function RankBody({ items, index, focused, empty, type }: BodyProps) {
  const [from, to] = windowOf(index, items.length, 3, 7);
  const shift = Math.max(0, index - 1) * RANK_STEP;
  return (
    <Clip empty={empty} has={items.length > 0}>
      <div class="sg-scroll" style={{ transform: `translate3d(${PAD - shift}px,40px,0)` }}>
        {items.slice(from, to).map((m, j) => {
          const i = from + j;
          return (
            <div key={`${m.catalogType ?? type}:${m.id}`} class="nf-rank" style={{ left: `${i * RANK_STEP}px` }}>
              <span>{i + 1}</span>
              <MediaTile x={110} y={0} w={200} h={300} src={posterUrl(m)} focused={focused && i === index} />
            </div>
          );
        })}
      </div>
    </Clip>
  );
}
