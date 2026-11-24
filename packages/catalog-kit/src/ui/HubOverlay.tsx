// The Hub: the catalog's settings. Search is Secretary's one search (launcher/src/search.tsx): the search pill and the
// search keys hand over to it through `onSearch`.
import {
  type Dir,
  type Focus,
  getTvInputBridge,
  move,
  useKeys,
} from "@secretary/tv-kit";
import { Glass, GlassRoot, Icon, IconButton, ListCard, Segmented } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { addonStore, loadDebrid, pluginStore, saveDebrid } from "../lib/plugins.ts";
import {
  type DashboardSettings,
  DEFAULT_SETTINGS,
  saveSettings,
  SETTING_ITEMS,
} from "../lib/settings.ts";
import type { CatalogType } from "../lib/types.ts";
import { useBase } from "./art.tsx";
import { addonRows, type SourceRow, sourceRows } from "./sources.ts";
import "./hub.css";

const PAD = 80;
const TOP_Y = 52;
const SETTING_H = 112;
const SETTING_STRIDE = SETTING_H + 16;
/** A section's heading above its lines. */
const HEAD_H = 56;

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
  { id: "nest", label: "Home", short: "Home", icon: "🪶" },
  { id: "cat_movie", label: "Cinema", short: "Cinema", icon: "🎬", type: "movie" },
  { id: "cat_series", label: "Shows", short: "Shows", icon: "📺", type: "series" },
  { id: "cat_anime", label: "Anime", short: "Anime", icon: "⛩", type: "anime" },
  { id: "settings", label: "Perch Settings", short: "Settings", icon: "⚙" },
];

interface Props {
  active: boolean;
  activeType?: CatalogType;
  settings: DashboardSettings;
  onUpdateSettings(next: DashboardSettings): void;
  /** The search pill and the search keys: Secretary's one search. */
  onSearch(): void;
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
  settings,
  onUpdateSettings,
  onSearch,
  onSwitchType,
  onOpenNest,
  onClose,
}: Props) {
  const [focus, setFocus] = useState<Focus>({ row: 1, col: 0 });
  const [clockText, setClockText] = useState(() => formatClock(settings.general.clockFormat));
  const [toast, setToast] = useState<string | null>(null);
  const base = useBase(activeType);
  // Settings › Sources: plugin repositories and debrid keys (ui/sources.ts).
  const [plugins, setPlugins] = useState(() => pluginStore.get());
  const [debrid, setDebrid] = useState(() => loadDebrid());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // "Restore default settings" asks twice: the first OK arms it, the second does it; moving away disarms it.
  const [confirmReset, setConfirmReset] = useState(false);
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

  // Each time the Hub opens, focus starts on the first setting.
  useEffect(() => {
    if (active) setFocus({ row: 1, col: 0 });
  }, [active]);

  // Clock updater.
  useEffect(() => {
    setClockText(formatClock(settings.general.clockFormat));
    if (!active) return;
    const t = setInterval(() => setClockText(formatClock(settings.general.clockFormat)), 15_000);
    return () => clearInterval(t);
  }, [active, settings.general.clockFormat]);

  useEffect(() => setConfirmReset(false), [focus.row]);

  const lengths = useMemo(
    () => [TOP_BAR_ITEMS.length, ...SETTING_ITEMS.map(() => 1), ...sources.map(() => 1), 1],
    [sources.length],
  );

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
    // CH-, Search and the voice key: Secretary's search.
    if (key === "ChannelDown" || key === "Search" || key === "SearchVoice") return onSearch();

    // Channel Up (CH+) opens Secretary Nest, the dashboard.
    if (key === "ChannelUp") {
      getTvInputBridge()?.close();
      onOpenNest();
      return;
    }

    if (key === "Back") {
      onClose();
      return;
    }

    // Top Floating Bar navigation (row 0)
    if (focus.row === 0 && key === "Enter") {
      const picked = TOP_BAR_ITEMS[focus.col];
      if (!picked) return;
      if (picked.id === "search_bar" || picked.id === "voice_ime") return onSearch();
      if (picked.id === "nest") {
        onOpenNest();
        return;
      }
      if (picked.id === "settings") {
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
    if (focus.row >= 1) {
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
        if (!confirmReset) {
          setConfirmReset(true);
          flash("OK again to restore every setting");
          return;
        }
        setConfirmReset(false);
        applySettingChange(DEFAULT_SETTINGS);
        flash("Restored default settings");
        return;
      }
    }

    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = move(lengths, focus, key.toLowerCase() as Dir);
      if (next !== focus) setFocus(next);
      return;
    }
    return false;
  });

  const sectionIdx = activeType === "movie" ? 0 : activeType === "series" ? 1 : 2;
  // The settings page in sections: a heading, then its lines (`ys` is where each focusable line sits, row 1 first).
  const heads: { label: string; y: number }[] = [];
  const ys: number[] = [];
  {
    let y = 0;
    let last = "";
    for (const it of SETTING_ITEMS) {
      if (it.section !== last) {
        heads.push({ label: it.section, y });
        y += HEAD_H;
        last = it.section;
      }
      ys.push(y);
      y += SETTING_STRIDE;
    }
    if (sources.length) {
      heads.push({ label: "Sources and addons", y });
      y += HEAD_H;
      for (let i = 0; i < sources.length; i++, y += SETTING_STRIDE) ys.push(y);
    }
    heads.push({ label: "Reset", y });
    ys.push(y + HEAD_H);
  }
  const settingsShift = Math.max(0, (ys[focus.row - 1] ?? 0) - 3 * SETTING_STRIDE);

  return (
    <div class="hub-glass" style={active ? undefined : "display:none"}>
      <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={base.backdrop?.frost} sheen={base.sheen} mood={base.mood} class="hub">
        <Glass x={PAD} y={TOP_Y} w={760} h={68} focused={focus.row === 0 && focus.col === 0} class="hub-search">
          <Icon name="search" class="hub-search-icon" />
          <span class="hub-search-hint">Search films, shows and anime</span>
          <span class="hub-keycap">CH-</span>
        </Glass>
        <IconButton x={860} y={TOP_Y} w={140} h={68} icon={<Icon name="mic" />} focused={focus.row === 0 && focus.col === 1} />
        <Segmented
          x={1030}
          y={TOP_Y}
          w={560}
          h={68}
          items={["Home", "Cinema", "Shows", "Anime"]}
          picked={sectionIdx + 1}
          focusIndex={focus.row === 0 && focus.col >= 2 && focus.col <= 5 ? focus.col - 2 : -1}
        />
        <IconButton x={1610} y={TOP_Y} w={110} h={68} icon={<Icon name="settings" />} focused={focus.row === 0 && focus.col === 6} />
        <div class="hub-clock">{clockText}</div>

          <>
            <div class="hub-title" style={{ left: `${PAD}px`, top: "150px" }}>
              Settings
              <small>Playback, appearance, collections, lights and the sources streams come from.</small>
            </div>
            <div class="sg-clip" style={{ left: `${PAD - 20}px`, top: "250px", width: "1800px", height: "830px" }}>
              <div class="sg-scroll" style={{ transform: `translate3d(20px,${20 - settingsShift}px,0)` }}>
                {heads.map((h) => (
                  <span key={h.label} class="hub-section" style={{ top: `${h.y}px` }}>
                    {h.label}
                  </span>
                ))}
                {SETTING_ITEMS.map((item, idx) => (
                  <ListCard
                    key={item.id}
                    x={0}
                    y={ys[idx]}
                    w={1760}
                    h={SETTING_H}
                    frost={false}
                    title={item.label}
                    sub={item.description}
                    meta={item.text ? item.getValue(settings) : `‹ ${item.getValue(settings)} ›`}
                    focused={focus.row === idx + 1}
                  />
                ))}
                {sources.map((row, i) => (
                  <ListCard
                    key={row.key}
                    x={0}
                    y={ys[SETTING_ITEMS.length + i]}
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
                  y={ys[SETTING_ITEMS.length + sources.length]}
                  w={1760}
                  h={SETTING_H}
                  frost={false}
                  title="Restore default settings"
                  sub="Every setting above goes back to its default; sources, keys and addons are kept"
                  meta={confirmReset ? "OK again to confirm" : "OK"}
                  focused={focus.row === SETTING_ITEMS.length + sources.length + 1}
                />
              </div>
            </div>
          </>

        {toast && (
          <Glass x={560} y={990} w={800} h={60} class="hub-toast">
            <span>{toast}</span>
          </Glass>
        )}
      </GlassRoot>
    </div>
  );
}

