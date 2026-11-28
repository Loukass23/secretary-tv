// Settings, under Secretary's one header: the categories as tabs (lib/settings.ts SETTING_TABS), then the shown
// category's lines as a compact list beside a preview of what the focused one does (PreviewList, setting-preview.tsx).
// Search is Secretary's (launcher/src/search.tsx): the search keys hand over to it through `onSearch`.
import { getTvInputBridge, useKeys } from "@secretary/tv-kit";
import { Glass, GlassRoot, Header, HEADER, PreviewList, type PreviewListItem, Tabs } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { HostApp, HostHeader, HostSettingsTab, HostVoice } from "../host.ts";
import { addonStore, loadDebrid, pluginStore, saveDebrid } from "../lib/plugins.ts";
import {
  type DashboardSettings,
  DEFAULT_SETTINGS,
  saveSettings,
  SETTING_ITEMS,
  SETTING_TAB_BLURB,
  SETTING_TABS,
  type SettingTab,
  toggleApp,
  voiceSettingNote,
} from "../lib/settings.ts";
import type { CatalogType } from "../lib/types.ts";
import { useBase } from "./art.tsx";
import { type PreviewLine, previewKey, SettingPreview } from "./setting-preview.tsx";
import { SETTINGS_START, type SettingsPlace, stepSettings } from "./settings-nav.ts";
import { addonRows, type SourceRow, sourceRows } from "./sources.ts";
import "./hub.css";

const PAD = HEADER.pad;
const TITLE_Y = 140;
const TABS_Y = 262;
const LIST_Y = 344;
const LIST_H = 696;
const ROW_W = 1760;
/** The list's width: the longest names fit on one line; the preview takes the rest. */
const LIST_W = 760;

/** One line of a category: what it shows (and its preview), and what OK, Left and Right do on it. */
interface Row extends PreviewLine {
  act?(key: "Enter" | "Left" | "Right"): void;
  /** A host category's own preview (host.ts HostSettingRow). */
  preview?: import("preact").ComponentChildren;
}

interface Props {
  active: boolean;
  activeType?: CatalogType;
  settings: DashboardSettings;
  onUpdateSettings(next: DashboardSettings): void;
  /** Secretary's header (catalog-kit host.ts); without it, the clock alone. */
  header?: HostHeader;
  /** The TV's apps, for the Apps category; none off the TV. */
  apps?: readonly HostApp[];
  /** Categories Secretary adds (SmartThings), placed after Home screen. */
  hostTabs?: readonly HostSettingsTab[];
  /** Whether this TV build has keys for voice input and spoken replies (Home screen tab). */
  voice?: HostVoice;
  /** The category Settings opens on (the design workbench's screens, the header's SmartThings entry). */
  initialTab?: SettingTab | string;
  /** The search keys: Secretary's one search. */
  onSearch(): void;
  /** Gives the screen back to Secretary's home (CH+). */
  onOpenNest(): void;
  onClose(): void;
}

function formatClock(fmt: "24h" | "12h"): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: fmt === "12h" });
}

export function HubOverlay({ active, activeType = "movie", settings, onUpdateSettings, header, apps = [], hostTabs = [], voice, initialTab, onSearch, onOpenNest, onClose }: Props) {
  // Settings' own categories, with the host's after Home screen.
  const at = SETTING_TABS.indexOf("Home screen") + 1;
  const tabNames: readonly string[] = [...SETTING_TABS.slice(0, at), ...hostTabs.map((t) => t.name), ...SETTING_TABS.slice(at)];
  const start = (): SettingsPlace => ({ ...SETTINGS_START, tab: Math.max(0, tabNames.indexOf(initialTab ?? "Watching")) });
  // A host category's lines change outside Settings (a light switched): drawn again after each of their actions.
  const [, setRev] = useState(0);
  const [place, setPlace] = useState<SettingsPlace>(start);
  const [clockText, setClockText] = useState(() => formatClock(settings.general.clockFormat));
  const [toast, setToast] = useState<string | null>(null);
  const base = useBase(activeType);
  // Sources: plugin repositories and debrid keys (ui/sources.ts), then installed addons (lib/addons.ts).
  const [plugins, setPlugins] = useState(() => pluginStore.get());
  const [debrid, setDebrid] = useState(() => loadDebrid());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // "Restore default settings" asks twice: the first OK arms it, the second does it; moving away disarms it.
  const [confirmReset, setConfirmReset] = useState(false);
  const [addonList, setAddonList] = useState(() => addonStore.list());
  useEffect(() => pluginStore.subscribe(() => setPlugins(pluginStore.get())), []);
  useEffect(() => addonStore.subscribe(() => setAddonList(addonStore.list())), []);
  const tab = tabNames[place.tab] ?? tabNames[0];
  const hostTab = hostTabs.find((t) => t.name === tab);
  useEffect(() => hostTab?.subscribe?.(() => setRev((n) => n + 1)), [hostTab]);
  const sources = useMemo(
    () =>
      tab !== "Sources"
        ? []
        : [
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
    [tab, plugins, debrid, confirmRemove, addonList],
  );

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  // Each time Settings opens, it starts on the tabs of its first category.
  useEffect(() => {
    if (active) setPlace(start());
  }, [active]);

  useEffect(() => {
    setClockText(formatClock(settings.general.clockFormat));
    if (!active || header) return;
    const t = setInterval(() => setClockText(formatClock(settings.general.clockFormat)), 15_000);
    return () => clearInterval(t);
  }, [active, settings.general.clockFormat, header]);

  const listAt = place.focus.area === "list" ? place.focus.i : -1;
  useEffect(() => setConfirmReset(false), [listAt, place.tab]);

  const apply = (next: DashboardSettings) => onUpdateSettings(saveSettings(next));

  /** The TV keyboard for one line of text (a repository URL, a key, a pattern). */
  const askText = (seed: string, onCommit: (value: string) => void) => {
    const opened = getTvInputBridge()?.open(seed, { onCommit: (v) => onCommit(v.trim()) });
    if (!opened) flash("No TV keyboard here");
  };

  const runSource = (row: SourceRow, key: "Enter" | "Left" | "Right") => {
    const a = row.action;
    // Left and Right move a provider or an addon in the order, and flip the debrid order; elsewhere only OK acts.
    if (key !== "Enter" && a.kind !== "order" && a.kind !== "scraper" && a.kind !== "addon") return;
    if (a.kind !== "remove" && a.kind !== "addonRemove") setConfirmRemove(null);
    if (a.kind === "order") return void setDebrid(saveDebrid({ ...debrid, order: [...debrid.order].reverse() }));
    if (a.kind === "scraper" && key !== "Enter") return pluginStore.moveProvider(a.id, key === "Left" ? -1 : 1);
    if (a.kind === "addon" && key !== "Enter") return addonStore.move(a.url, key === "Left" ? -1 : 1);
    if (a.kind === "cachedOnly") return void setDebrid(saveDebrid({ ...debrid, cachedOnly: debrid.cachedOnly === false }));
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
      askText("", (value) => setDebrid(saveDebrid({ ...debrid, keys: { ...debrid.keys, [service]: value } })));
    }
  };

  // The shown category's lines: its settings, then what only that category has (sources, apps, the reset).
  const rows: Row[] = [
    ...SETTING_ITEMS.filter((it) => it.section === tab).map((item): Row => {
      const locked = voiceSettingNote(item.id, voice);
      if (locked) return { key: item.id, title: item.label, sub: locked.sub, value: locked.value };
      return {
        key: item.id,
        title: item.label,
        sub: item.description,
        value: item.getValue(settings),
        on: item.on?.(settings),
        choices: item.choices?.(settings),
        act: (key) => {
          // A typed setting: OK opens the TV keyboard with its text, Left clears it.
          const text = item.text;
          if (text) {
            if (key === "Enter") return askText(text.get(settings), (v) => apply(text.set(settings, v)));
            if (key === "Left") return apply(item.cycle(settings, -1));
            return;
          }
          apply(item.cycle(settings, key === "Left" ? -1 : 1));
        },
      };
    }),
    ...sources.map((row): Row => ({ key: row.key, title: row.title, sub: row.sub, value: row.meta, act: (key) => runSource(row, key) })),
  ];
  if (hostTab) {
    for (const r of hostTab.rows()) {
      rows.push({
        ...r,
        act: r.act
          ? (key) => {
              r.act!(key);
              setRev((n) => n + 1);
            }
          : undefined,
      });
    }
  }
  if (tab === "Apps") {
    if (!apps.length) rows.push({ key: "no-apps", title: "No other apps listed", sub: "The TV lists its apps when Secretary starts on it", value: "" });
    for (const app of apps) {
      const shown = !settings.home.hiddenApps.includes(app.id);
      rows.push({
        key: `app:${app.id}`,
        title: app.name,
        sub: app.note ?? "Shown on the Apps card, or hidden from it",
        value: shown ? "Shown" : "Hidden",
        on: shown,
        act: () => apply(toggleApp(settings, app.id)),
      });
    }
  }
  if (tab === "Advanced") {
    rows.push({
      key: "reset",
      title: "Restore default settings",
      sub: "Hidden apps come back; sources, keys and addons are kept",
      value: confirmReset ? "OK again to confirm" : "Every setting to its default",
      act: (key) => {
        if (key !== "Enter") return;
        if (!confirmReset) {
          setConfirmReset(true);
          return flash("OK again to restore every setting");
        }
        setConfirmReset(false);
        apply(DEFAULT_SETTINGS);
        flash("Restored default settings");
      },
    });
  }

  // A category with fewer lines than before (an addon removed): focus stays on its last line.
  useEffect(() => {
    if (listAt >= rows.length) setPlace((p) => ({ ...p, focus: rows.length ? { area: "list", i: rows.length - 1 } : { area: "tabs" } }));
  }, [rows.length, listAt]);

  const shape = { tabs: tabNames.length, rows: rows.length, header: header ? { person: Boolean(header.person), buttons: header.buttons.length } : null };

  useKeys(active, (key) => {
    // CH-, Search and the voice key: Secretary's search.
    if (key === "ChannelDown" || key === "Search" || key === "SearchVoice") return onSearch();
    if (key === "ChannelUp") {
      getTvInputBridge()?.close();
      return onOpenNest();
    }
    if (place.focus.area === "head" && key === "Enter") return void header?.press(place.focus.at);
    if (place.focus.area === "list" && (key === "Enter" || key === "Left" || key === "Right")) {
      rows[place.focus.i]?.act?.(key);
      return;
    }
    const next = stepSettings(place, key, shape);
    if (next === "close") return onClose();
    if (next !== place) setPlace(next);
    if (key === "Up" || key === "Down" || key === "Left" || key === "Right" || key === "Back") return;
    return false;
  });

  const head = place.focus.area === "head" ? place.focus.at : null;
  // The list's lines: the name and the value set; a switch's dot lit when it is on.
  const items: PreviewListItem[] = rows.map((r) => ({ key: r.key, title: r.title, sub: r.value || undefined, lit: r.on }));
  const shownRow = rows[Math.max(0, Math.min(rows.length - 1, listAt))];
  // The preview is kept while its line and the settings stay the same: a key that only moves focus on the tabs, or
  // in the header, does not draw it again (it cost 3 long frames per Settings walk, docs/performance.md).
  const shownKey = shownRow && !shownRow.preview ? previewKey(shownRow) : "";
  const keptPreview = useMemo(() => (shownRow && !shownRow.preview ? <SettingPreview line={shownRow} settings={settings} /> : null), [shownKey, settings]);

  return (
    <div class="hub-glass" style={active ? undefined : "display:none"}>
      <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={base.backdrop?.frost} sheen={base.sheen} mood={base.mood} class="hub">
        <Header time={header?.time ?? clockText} person={header?.person} buttons={header?.buttons ?? []} focus={head} />
        <div class="hub-title" style={{ left: `${PAD}px`, top: `${TITLE_Y}px` }}>
          Settings
          <small>{hostTab ? hostTab.blurb : SETTING_TAB_BLURB[tab as SettingTab]}</small>
        </div>
        <Tabs x={PAD} y={TABS_Y} w={ROW_W} items={tabNames} picked={place.tab} focusIndex={place.focus.area === "tabs" ? place.tab : -1} />
        <PreviewList
          key={tab}
          x={PAD}
          y={LIST_Y}
          w={ROW_W}
          h={LIST_H}
          listW={LIST_W}
          items={items}
          focusIndex={listAt}
          preview={shownRow ? (shownRow.preview ?? keptPreview) : null}
        />

        {toast && (
          <Glass x={560} y={990} w={800} h={60} class="hub-toast">
            <span>{toast}</span>
          </Glass>
        )}
      </GlassRoot>
    </div>
  );
}
