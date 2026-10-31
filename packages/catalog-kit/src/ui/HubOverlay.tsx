import {
  type Dir,
  type Focus,
  getTvInputBridge,
  move,
  useKeys,
  windowOf,
} from "@secretary/tv-kit";
import { Glass, GlassRoot, IconButton, ListCard, MediaTile, Segmented } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { posterUrl, searchCatalogsClient } from "../lib/cinemeta.ts";
import { addonStore, loadDebrid, pluginStore, saveDebrid } from "../lib/plugins.ts";
import { badgeForResume, toContinueTitle, type UnifiedResumeEntry } from "../lib/resume.ts";
import {
  clearRecentSearches,
  type DashboardSettings,
  DEFAULT_SETTINGS,
  loadRecentSearches,
  type OverlayTab,
  saveRecentSearch,
  saveSettings,
  SETTING_ITEMS,
} from "../lib/settings.ts";
import type { CatalogType, Title } from "../lib/types.ts";
import { useBase } from "./art.tsx";
import { addonRows, type SourceRow, sourceRows } from "./sources.ts";
import "./hub.css";

const PAD = 80;
const TOP_Y = 52;
const CARD_W = 200;
const CARD_H = 300;
const STRIDE = CARD_W + 24;
const RAIL_H = 440;
const SEARCH_DEBOUNCE_MS = 220;
const KEY_W = 76;
const KEY_H = 72;
const KEY_STRIDE = 84;
const WIDE_W = 250;
const WIDE_STRIDE = 264;
const KEYS_Y = 156;
const ROW_STRIDE = 84;
const RECENT_Y = KEYS_Y + 3 * ROW_STRIDE + 4;
const RAILS_Y = RECENT_Y + 76;
const SETTING_H = 112;
const SETTING_STRIDE = SETTING_H + 16;

type TopBarAction =
  | { id: "search_bar"; label: string; short: string; icon: string }
  | { id: "voice_ime"; label: string; short: string; icon: string }
  | { id: "nest"; label: string; short: string; icon: string }
  | { id: "cat_movie"; label: string; short: string; icon: string; type: CatalogType }
  | { id: "cat_series"; label: string; short: string; icon: string; type: CatalogType }
  | { id: "cat_anime"; label: string; short: string; icon: string; type: CatalogType }
  | { id: "settings"; label: string; short: string; icon: string };

const TOP_BAR_ITEMS: readonly TopBarAction[] = [
  { id: "search_bar", label: "Search movies, series, anime…", short: "Search", icon: "⌕" },
  { id: "voice_ime", label: "Voice / TV Keyboard", short: "Voice", icon: "🎤" },
  { id: "nest", label: "Secretary Nest", short: "Nest", icon: "🪶" },
  { id: "cat_movie", label: "Secretary Cinema", short: "Cinema", icon: "🎬", type: "movie" },
  { id: "cat_series", label: "Secretary Shows", short: "Shows", icon: "📺", type: "series" },
  { id: "cat_anime", label: "Secretary Anime", short: "Anime", icon: "⛩", type: "anime" },
  { id: "settings", label: "Perch Settings", short: "Settings", icon: "⚙" },
];

const KEY_ROWS: readonly (readonly string[])[] = [
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"],
  ["U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  ["SPACE", "⌫", "CLEAR", "🎤 TV keyboard"],
];
/** Focus rows: 0 is the top bar, then the keyboard rows, then recent searches (when shown), then the rails. */
const RECENT_ROW = KEY_ROWS.length + 1;

export interface SearchHit {
  type: CatalogType;
  title: Title;
}

interface Props {
  active: boolean;
  activeType?: CatalogType;
  serverUrl: string;
  continueItems: UnifiedResumeEntry[];
  settings: DashboardSettings;
  onUpdateSettings(next: DashboardSettings): void;
  initialQuery?: string;
  initialTab?: OverlayTab;
  autoVoice?: boolean;
  onSelectTitle(type: CatalogType, title: Title, autoPlay?: boolean): void;
  onSwitchType?(type: CatalogType): void;
  /** Opens Secretary Nest, the dashboard (CH+ and the Nest pill). */
  onOpenNest(): void;
  onClose(): void;
}

function formatClock(fmt: "24h" | "12h"): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: fmt === "12h",
  });
}

export function HubOverlay({
  active,
  activeType = "movie",
  serverUrl,
  continueItems,
  settings,
  onUpdateSettings,
  initialQuery = "",
  initialTab,
  autoVoice = false,
  onSelectTitle,
  onSwitchType,
  onOpenNest,
  onClose,
}: Props) {
  const [tab, setTab] = useState<OverlayTab>(
    initialQuery ? "search" : (initialTab ?? "search"),
  );
  const [query, setQuery] = useState(initialQuery);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [imeActive, setImeActive] = useState(false);
  const [focus, setFocus] = useState<Focus>({ row: 1, col: 0 });
  const [clockText, setClockText] = useState(() => formatClock(settings.general.clockFormat));
  const [toast, setToast] = useState<string | null>(null);
  const base = useBase(activeType);
  // Settings › Sources: plugin repositories and debrid keys (ui/sources.ts).
  const [plugins, setPlugins] = useState(() => pluginStore.get());
  const [debrid, setDebrid] = useState(() => loadDebrid());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // Settings › Addons, after Sources: installed Stremio addons (lib/addons.ts).
  const [addonList, setAddonList] = useState(() => addonStore.list());
  useEffect(() => pluginStore.subscribe(() => setPlugins(pluginStore.get())), []);
  useEffect(() => addonStore.subscribe(() => setAddonList(addonStore.list())), []);
  const sources = useMemo(
    () => [
      ...sourceRows(
        plugins,
        (url, id) => {
          const r = plugins.repos.find((x) => x.url === url);
          return Boolean(r && pluginStore.isScraperOn(r, id));
        },
        debrid,
        confirmRemove,
        pluginStore.providerOrder(),
      ),
      ...addonRows(addonList, confirmRemove),
    ],
    [plugins, debrid, confirmRemove, addonList],
  );

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const summonTvKeyboard = (seedQuery = query) => {
    const bridge = getTvInputBridge();
    if (!bridge) return;
    setTab("search");
    setImeActive(true);
    const opened = bridge.open(seedQuery, {
      onChange: (val) => setQuery(val),
      onCommit: (val) => {
        setImeActive(false);
        setQuery(val);
        if (val.trim().length >= 2) {
          setRecentSearches(saveRecentSearch(val));
        }
        // Focus moves down to the results; it settles on the keyboard if there are none.
        setFocus({ row: RECENT_ROW, col: 0 });
      },
      onCancel: () => {
        setImeActive(false);
      },
    });
    if (!opened) {
      setImeActive(false);
      setFocus({ row: 1, col: 0 });
      flash("Use on-screen keyboard or press microphone on remote");
    } else {
      flash("🎤 Press microphone on remote to dictate or type on TV keyboard");
    }
  };

  // Sync tab and initial query when overlay opens.
  useEffect(() => {
    if (!active) return;
    setRecentSearches(loadRecentSearches());
    if (initialQuery) {
      setQuery(initialQuery);
      setTab("search");
      setFocus({ row: 1, col: 0 });
    } else if (initialTab) {
      setTab(initialTab);
      setFocus({ row: 1, col: 0 });
    } else {
      setTab("search");
      setFocus({ row: 1, col: 0 });
    }
    if (autoVoice) {
      setTimeout(() => summonTvKeyboard(initialQuery || query), 60);
    }
  }, [active, initialQuery, initialTab, autoVoice]);

  // Clock updater.
  useEffect(() => {
    setClockText(formatClock(settings.general.clockFormat));
    if (!active) return;
    const t = setInterval(() => setClockText(formatClock(settings.general.clockFormat)), 15_000);
    return () => clearInterval(t);
  }, [active, settings.general.clockFormat]);

  // Unified search debounce with client-side Cinemeta/Kitsu fallback if LAN server is unreachable.
  useEffect(() => {
    if (!active || tab !== "search") return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const base = serverUrl ? serverUrl.replace(/\/$/, "") : "";
    const t = setTimeout(() => {
      const fetchServerSearch = async (): Promise<SearchHit[] | null> => {
        if (!base) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1600);
        try {
          const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}`, {
            signal: ctrl.signal,
          });
          if (!r.ok) return null;
          const body = (await r.json()) as { results?: SearchHit[] };
          return body.results?.length ? body.results : null;
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      };

      void (async () => {
        const srvHits = await fetchServerSearch();
        if (!live) return;
        if (srvHits && srvHits.length > 0) {
          setResults(srvHits);
          setSearching(false);
          return;
        }
        const clientHits = await searchCatalogsClient(q);
        if (!live) return;
        setResults(clientHits);
        setSearching(false);
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [active, tab, query, serverUrl]);

  const searchRails = useMemo(() => {
    const out: {
      id: "results" | "continue";
      title: string;
      items: { type: CatalogType; title: Title; autoPlay: boolean }[];
    }[] = [];
    if (results.length > 0) {
      out.push({
        id: "results",
        title: `Spotlight Matches (${results.length})`,
        items: results.map((hit, idx) => ({
          type: hit.type,
          title: {
            ...hit.title,
            catalogType: hit.type,
            badge:
              idx === 0
                ? `★ Top Match · ${badgeForResume({ type: hit.type, title: hit.title })}`
                : badgeForResume({ type: hit.type, title: hit.title }),
          },
          autoPlay: false,
        })),
      });
    }
    if (continueItems.length > 0) {
      out.push({
        id: "continue",
        title: "Continue playing across Cinema, Shows & Anime",
        items: continueItems.map((entry) => ({
          type: entry.type,
          title: toContinueTitle(entry),
          autoPlay: true,
        })),
      });
    }
    return out;
  }, [results, continueItems]);

  const hasRecentChipRow = tab === "search" && !query.trim() && recentSearches.length > 0;

  const lengths = useMemo(() => {
    if (tab === "settings") {
      return [TOP_BAR_ITEMS.length, ...SETTING_ITEMS.map(() => 1), ...sources.map(() => 1), 1];
    }
    return [
      TOP_BAR_ITEMS.length,
      ...KEY_ROWS.map((r) => r.length),
      ...(hasRecentChipRow ? [recentSearches.length + 1] : []),
      ...searchRails.map((r) => r.items.length),
    ];
  }, [tab, hasRecentChipRow, recentSearches.length, searchRails, sources.length]);

  useEffect(() => {
    const r = Math.min(focus.row, lengths.length - 1);
    const c = Math.min(focus.col, Math.max(0, (lengths[r] ?? 1) - 1));
    if (r !== focus.row || c !== focus.col) setFocus({ row: r, col: c });
  }, [lengths]);

  const applySettingChange = (next: DashboardSettings) => {
    const saved = saveSettings(next);
    onUpdateSettings(saved);
  };

  /** The TV keyboard for one line of text (a repository URL, a key); false when there is none. */
  const askText = (seed: string, onCommit: (value: string) => void) => {
    const opened = getTvInputBridge()?.open(seed, { onCommit: (v) => onCommit(v.trim()) });
    if (!opened) flash("No TV keyboard here");
  };

  const runSource = (row: SourceRow, key: string) => {
    const a = row.action;
    if (a.kind !== "remove" && a.kind !== "addonRemove") setConfirmRemove(null);
    if (a.kind === "order") {
      setDebrid(saveDebrid({ ...debrid, order: [...debrid.order].reverse() }));
      return;
    }
    // Left and Right on a provider move it in the provider order; OK still turns it on or off.
    if (a.kind === "scraper" && key !== "Enter") return pluginStore.moveProvider(a.id, key === "Left" ? -1 : 1);
    if (a.kind === "addon" && key !== "Enter") return addonStore.move(a.url, key === "Left" ? -1 : 1);
    if (key !== "Enter") return;
    if (a.kind === "torboxAhead") return void setDebrid(saveDebrid({ ...debrid, torboxAhead: !debrid.torboxAhead }));
    if (a.kind === "plugins") pluginStore.setEnabled(!plugins.enabled);
    else if (a.kind === "repo") pluginStore.toggleRepo(a.url);
    else if (a.kind === "scraper") pluginStore.toggleScraper(a.url, a.id);
    else if (a.kind === "remove") {
      if (confirmRemove !== a.url) return setConfirmRemove(a.url);
      pluginStore.remove(a.url);
      setConfirmRemove(null);
      flash("Repository removed");
    } else if (a.kind === "add") {
      askText("https://", (url) => {
        if (!url || url === "https://") return;
        flash("Reading the repository…");
        pluginStore.add(url).then(
          (r) => flash(`Added ${r.manifest?.name ?? "the repository"} · ${r.manifest?.scrapers.length ?? 0} providers`),
          (err) => flash(`Not added: ${(err as Error).message}`),
        );
      });
    } else if (a.kind === "addon") addonStore.toggle(a.url);
    else if (a.kind === "addonRemove") {
      if (confirmRemove !== a.url) return setConfirmRemove(a.url);
      addonStore.remove(a.url);
      setConfirmRemove(null);
      flash("Addon removed");
    } else if (a.kind === "addonAdd") {
      askText("https://", (url) => {
        if (!url || url === "https://") return;
        flash("Reading the addon…");
        addonStore.install(url).then(
          (x) => flash(`Installed ${x.name}`),
          (err) => flash(`Not installed: ${(err as Error).message}`),
        );
      });
    } else if (a.kind === "addonRefresh") {
      flash("Reading addons…");
      void addonStore.refresh(true).then(() => flash("Addons read"));
    } else if (a.kind === "refresh") {
      flash("Reading repositories…");
      void pluginStore.refresh(true).then(() => flash("Repositories read"));
    } else if (a.kind === "key") {
      const service = a.service;
      askText("", (value) =>
        setDebrid(saveDebrid({ ...debrid, keys: { ...debrid.keys, [service]: value } })),
      );
    }
  };

  useKeys(active, (key) => {
    // Channel Down (CH-) or Search key immediately opens Spotlight Search from any tab!
    if (key === "ChannelDown" || key === "Search") {
      if (tab !== "search") {
        setTab("search");
        setFocus({ row: 1, col: 0 });
        flash("⌕ Spotlight Search · Type or press 🎤 for TV Voice");
      } else {
        setFocus({ row: 0, col: 0 });
      }
      return;
    }

    // Voice Search key (10225 / F6) opens Spotlight + summons Samsung TV IME/Voice!
    if (key === "SearchVoice") {
      summonTvKeyboard(query);
      return;
    }

    // Channel Up (CH+) opens Secretary Nest, the dashboard.
    if (key === "ChannelUp") {
      getTvInputBridge()?.close();
      setImeActive(false);
      onOpenNest();
      return;
    }

    if (key === "Back") {
      if (tab === "search" && query.trim().length > 0) {
        setQuery("");
        setFocus({ row: 1, col: 0 });
        return;
      }
      onClose();
      return;
    }

    // Top Floating Bar navigation (row 0)
    if (focus.row === 0 && key === "Enter") {
      const picked = TOP_BAR_ITEMS[focus.col];
      if (!picked) return;
      if (picked.id === "search_bar") {
        if (tab === "search") {
          summonTvKeyboard(query);
        } else {
          setTab("search");
          setFocus({ row: 1, col: 0 });
        }
        return;
      }
      if (picked.id === "voice_ime") {
        summonTvKeyboard(query);
        return;
      }
      if (picked.id === "nest") {
        onOpenNest();
        return;
      }
      if (picked.id === "settings") {
        setTab("settings");
        setFocus({ row: 1, col: 0 });
        return;
      }
      if (
        (picked.id === "cat_movie" || picked.id === "cat_series" || picked.id === "cat_anime") &&
        picked.type
      ) {
        if (onSwitchType) {
          onSwitchType(picked.type);
        } else {
          onClose();
        }
        return;
      }
    }

    // Settings view controls
    if (tab === "settings" && focus.row >= 1) {
      const idx = focus.row - 1;
      const item = SETTING_ITEMS[idx];
      if (item?.text) {
        // A typed setting: OK opens the TV keyboard with its text, Left clears it.
        const text = item.text;
        if (key === "Enter") return askText(text.get(settings), (v) => applySettingChange(text.set(settings, v)));
        if (key === "Left") return applySettingChange(item.cycle(settings, -1));
        if (key === "Right") return;
      }
      if (item && (key === "Enter" || key === "Right" || key === "Left")) {
        const dir = key === "Left" ? -1 : 1;
        applySettingChange(item.cycle(settings, dir));
        return;
      }
      const source = sources[idx - SETTING_ITEMS.length];
      const sideways = (key === "Left" || key === "Right") && (source?.action.kind === "order" || source?.action.kind === "scraper" || source?.action.kind === "addon");
      if (source && (key === "Enter" || sideways)) {
        runSource(source, key);
        return;
      }
      if (!item && !source && key === "Enter") {
        applySettingChange(DEFAULT_SETTINGS);
        flash("Restored default settings");
        return;
      }
    }

    // Spotlight Search view controls
    if (tab === "search" && focus.row >= 1 && key === "Enter") {
      if (focus.row <= KEY_ROWS.length) {
        const k = KEY_ROWS[focus.row - 1]?.[focus.col];
        if (!k) return;
        if (k === "SPACE") setQuery((q) => `${q} `);
        else if (k === "⌫") setQuery((q) => q.slice(0, -1));
        else if (k === "CLEAR") setQuery("");
        else if (k.startsWith("🎤")) summonTvKeyboard(query);
        else setQuery((q) => q + k.toLowerCase());
        return;
      }
      if (hasRecentChipRow && focus.row === RECENT_ROW) {
        if (focus.col < recentSearches.length) {
          const pickedTerm = recentSearches[focus.col];
          if (pickedTerm) {
            setQuery(pickedTerm);
            setRecentSearches(saveRecentSearch(pickedTerm));
          }
        } else {
          setRecentSearches(clearRecentSearches());
          flash("Cleared recent searches");
        }
        return;
      }
      const railOffset = hasRecentChipRow ? RECENT_ROW + 1 : RECENT_ROW;
      const rail = searchRails[focus.row - railOffset];
      const item = rail?.items[focus.col];
      if (item) {
        if (query.trim().length >= 2) {
          setRecentSearches(saveRecentSearch(query));
        }
        onSelectTitle(item.type, item.title, item.autoPlay);
      }
      return;
    }

    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = move(lengths, focus, key.toLowerCase() as Dir);
      if (next !== focus) setFocus(next);
      return;
    }
    return false;
  });

  // Physical keyboard typing support while Search tab is active (when native IME isn't already capturing).
  useEffect(() => {
    if (!active || tab !== "search" || imeActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Backspace") {
        e.preventDefault();
        setQuery((q) => q.slice(0, -1));
      } else if (e.key.length === 1 && /^[a-z0-9 ]$/i.test(e.key)) {
        setQuery((q) => q + e.key.toLowerCase());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, tab, imeActive]);

  const railRow0 = hasRecentChipRow ? RECENT_ROW + 1 : RECENT_ROW;
  const railAt = focus.row >= railRow0 ? focus.row - railRow0 : 0;
  const sectionIdx = activeType === "movie" ? 0 : activeType === "series" ? 1 : 2;
  const settingsShift = Math.max(0, focus.row - 6) * SETTING_STRIDE;
  const status = !query.trim()
    ? "Type with the remote, pick a recent search, or press 🎤 to speak"
    : searching
      ? `Scouring Cinema, Shows and Anime for “${query}”…`
      : `${results.length} match${results.length === 1 ? "" : "es"} for “${query}”`;
  let chipX = PAD + 120;

  return (
    <div class="hub-glass" style={active ? undefined : "display:none"}>
      <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={base.backdrop?.frost} class="hub">
        <Glass x={PAD} y={TOP_Y} w={760} h={68} focused={focus.row === 0 && focus.col === 0} class="hub-search">
          <span class="hub-search-icon">⌕</span>
          {query ? (
            <span class="hub-search-query">
              {query}
              <i class="hub-caret" />
            </span>
          ) : (
            <span class="hub-search-hint">{imeActive ? "Listening… speak into the remote" : "Search movies, series and anime"}</span>
          )}
          <span class="hub-keycap">CH-</span>
        </Glass>
        <IconButton x={860} y={TOP_Y} w={140} h={68} icon={imeActive ? "🎤…" : "🎤"} focused={focus.row === 0 && focus.col === 1} />
        <Segmented
          x={1030}
          y={TOP_Y}
          w={560}
          h={68}
          items={["Nest", "Cinema", "Shows", "Anime"]}
          picked={sectionIdx + 1}
          focusIndex={focus.row === 0 && focus.col >= 2 && focus.col <= 5 ? focus.col - 2 : -1}
        />
        <IconButton x={1610} y={TOP_Y} w={110} h={68} icon="⚙" focused={focus.row === 0 && focus.col === 6} />
        <div class="hub-clock">{clockText}</div>

        {tab === "settings" && (
          <>
            <div class="hub-title" style={{ left: `${PAD}px`, top: "150px" }}>
              Settings
              <small>Accent colour, clock, boot animation, cinema dimming and the sources streams come from. The dashboard lives in Secretary Nest.</small>
            </div>
            <div class="sg-clip" style={{ left: `${PAD - 20}px`, top: "250px", width: "1800px", height: "830px" }}>
              <div class="sg-scroll" style={{ transform: `translate3d(20px,${20 - settingsShift}px,0)` }}>
                {SETTING_ITEMS.map((item, idx) => (
                  <ListCard
                    key={item.id}
                    x={0}
                    y={idx * SETTING_STRIDE}
                    w={1760}
                    h={SETTING_H}
                    frost={false}
                    title={item.label}
                    sub={`${item.section} · ${item.description}`}
                    meta={item.text ? item.getValue(settings) : `‹ ${item.getValue(settings)} ›`}
                    focused={focus.row === idx + 1}
                  />
                ))}
                {sources.map((row, i) => (
                  <ListCard
                    key={row.key}
                    x={0}
                    y={(SETTING_ITEMS.length + i) * SETTING_STRIDE}
                    w={1760}
                    h={SETTING_H}
                    frost={false}
                    title={row.title}
                    sub={row.sub}
                    meta={row.meta}
                    focused={focus.row === SETTING_ITEMS.length + i + 1}
                  />
                ))}
                <ListCard
                  x={0}
                  y={(SETTING_ITEMS.length + sources.length) * SETTING_STRIDE}
                  w={1760}
                  h={SETTING_H}
                  frost={false}
                  title="Restore default settings"
                  sub="Accent, clock, boot animation and dimming go back to their defaults"
                  meta="OK"
                  focused={focus.row === SETTING_ITEMS.length + sources.length + 1}
                />
              </div>
            </div>
          </>
        )}

        {tab === "search" && (
          <>
            {KEY_ROWS.map((row, r) =>
              row.map((k, c) => {
                const wide = r === KEY_ROWS.length - 1;
                return (
                  <Glass
                    key={`${r}:${k}`}
                    x={PAD + c * (wide ? WIDE_STRIDE : KEY_STRIDE)}
                    y={KEYS_Y + r * ROW_STRIDE}
                    w={wide ? WIDE_W : KEY_W}
                    h={KEY_H}
                    class="hub-key"
                    focused={focus.row === r + 1 && focus.col === c}
                  >
                    <span>{k}</span>
                  </Glass>
                );
              }),
            )}

            {hasRecentChipRow && (
              <>
                <div class="hub-recent-label" style={{ left: `${PAD}px`, top: `${RECENT_Y + 14}px` }}>
                  Recent
                </div>
                {[...recentSearches.map((t) => `🕒 ${t.length > 16 ? `${t.slice(0, 15)}…` : t}`), "✕ Clear"].map((label, c) => {
                  const w = 64 + label.length * 13;
                  const x = chipX;
                  chipX += w + 14;
                  return (
                    <Glass key={c} x={x} y={RECENT_Y} w={w} h={56} class="hub-chip" focused={focus.row === RECENT_ROW && focus.col === c}>
                      <span>{label}</span>
                    </Glass>
                  );
                })}
              </>
            )}

            <div class="sg-clip" style={{ left: "0px", top: `${RAILS_Y}px`, width: "1920px", height: `${1080 - RAILS_Y}px` }}>
              <div class="sg-scroll" style={{ transform: `translate3d(0,${-railAt * RAIL_H}px,0)` }}>
                {searchRails.length === 0 && <div class="hub-rail-head" style={{ left: `${PAD}px`, top: "0px" }}><h2>{status}</h2></div>}
                {searchRails.map((rail, rIdx) => {
                  const isFocusedRail = focus.row === railRow0 + rIdx;
                  const [from, to] = windowOf(isFocusedRail ? focus.col : 0, rail.items.length, 2, 9);
                  const shift = isFocusedRail ? Math.max(0, focus.col - 3) * STRIDE : 0;
                  return (
                    <section key={rail.id} class="hub-rail" style={{ top: `${rIdx * RAIL_H}px` }}>
                      <div class="hub-rail-head" style={{ left: `${PAD}px` }}>
                        <h2>{rail.id === "results" ? status : rail.title}</h2>
                      </div>
                      <div class="sg-scroll" style={{ top: "56px", transform: `translate3d(${PAD - shift}px,10px,0)` }}>
                        {rail.items.slice(from, to).map((entry, k) => {
                          const c = from + k;
                          const m = entry.title;
                          return (
                            <MediaTile
                              key={`${entry.type}:${m.id}`}
                              x={c * STRIDE}
                              y={0}
                              w={CARD_W}
                              h={CARD_H}
                              src={posterUrl(m)}
                              badge={m.badge}
                              progress={m.progressPct != null ? m.progressPct / 100 : undefined}
                              focused={isFocusedRail && c === focus.col}
                            />
                          );
                        })}
                      </div>
                      {isFocusedRail && rail.items[focus.col] && (
                        <div class="hub-rail-name" style={{ left: `${PAD}px`, top: `${56 + CARD_H + 26}px` }}>
                          {rail.items[focus.col].title.name}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {toast && (
          <Glass x={560} y={990} w={800} h={60} class="hub-toast">
            <span>{toast}</span>
          </Glass>
        )}
      </GlassRoot>
    </div>
  );
}

