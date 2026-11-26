import { type Focus, isTvImeOpen, mark, record, useKeys } from "@secretary/tv-kit";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { animeImdbIds, kindFor, withoutAnime } from "./lib/animeguard.ts";
import { fetchMeta, fetchRow, getTmdbKey, rowsFor } from "./lib/cinemeta.ts";
import {
  type SagaDef,
  getSagaById,
} from "./lib/sagas.ts";
import { contentApp, normalizeCode, partyErrorText } from "@secretary/party/src/client.ts";
import { targetPos, type Timeline } from "@secretary/party/src/protocol.ts";
import { checkOwner, cloud, cloudEnabled, nuvioCollections, nuvioLibrary, nuvioRemote, partyApi, shareCloud, startListSync } from "./lib/cloud.ts";
import { playbackLights, playerRoom, runMovieScene } from "./lib/home.ts";
import { createPartySession, LEAVE_TEXT, type PartySession, releaseOf, type SocketLike, streamFor } from "./lib/party.ts";
import { clearLocalLibrary, loadLibrary, setLibraryRemote, syncLibrary } from "./lib/library.ts";
import { episodeHint } from "@secretary/core";
import { episodeLabel, fileHintFor, nextEpisode } from "./lib/episodes.ts";
import { type CardShape, loadRowStyles, saveRowStyle } from "./lib/collectionlayout.ts";
import {
  clearLocalNuvioCollections,
  collectionRows,
  collectionsFor,
  findFolder,
  loadNuvioCollections,
  resolveSource,
  type ResolvedSource,
  setCollectionsRemote,
  type SourceKeys,
  sourceUsable,
  syncNuvioCollections,
} from "./lib/nuviocollections.ts";
import { loadHome, saveHome } from "./lib/home-cache.ts";
import {
  continueFor,
  loadAllResume,
  loadWatchedIds,
  setResumeServer,
  syncAllResume,
  clearLocalResume,
  setResumeRemote,
  toContinueTitle,
  type UnifiedResumeEntry,
} from "./lib/resume.ts";
import {
  applyLook,
  type DashboardSettings,
  loadSettings,
  onSettings,
  type OverlayTab,
  saveSettings,
} from "./lib/settings.ts";
import { type AddonRowDef, addonRowDefs, nextPage } from "./lib/addons.ts";
import { addons, addonStore, debrids, loadDebrid, playable, pluginHost, pluginsActive, pluginStore, publishStatus } from "./lib/plugins.ts";
import { matchPref, prefOf } from "./lib/sourcepref.ts";
import { isDead } from "./player/session.ts";
import { createPluginStreamClient, createStreamClient, parseStreamInfo, type Stream } from "./lib/streams.ts";
import { safeToCheck } from "./lib/verify.ts";
import { type CatalogType, type HomeRow, streamType, type Title, type Video } from "./lib/types.ts";
import { SagaTimeline } from "./ui/SagaTimeline.tsx";
import { Detail } from "./ui/Detail.tsx";
import { Home } from "./ui/Home.tsx";
import { NuvioFolder } from "./ui/NuvioFolder.tsx";
import { HubOverlay } from "./ui/HubOverlay.tsx";
import { ControlCentre } from "./ui/ControlCentre.tsx";
import { Island, island } from "./ui/Island.tsx";
import { PlayerView } from "./ui/PlayerView.tsx";

export interface CatalogConfig {
  type: CatalogType;
  /** The kind's name (Cinema, Shows, Anime), shown on the catalog home before a title has focus. */
  heading: string;
  /** Base URL of packages/server, no trailing slash. */
  serverUrl: string;
  /** Secretary, which this catalog runs inside (docs/embedding-catalog.md). */
  embedded: EmbeddedHost;
  /** Open this title's detail page first (embedded: the home's Resume and picks). */
  open?: { type: CatalogType; title: Title; autoPlay?: boolean; room?: string };
  /** Open this folder of the profile's collections first. */
  folder?: { collectionId: string; folderId: string };
  /** Open the Hub first, on this tab (embedded: Nest's Settings button), and Settings on this category. */
  hub?: { tab: OverlayTab; category?: string };
}

/** What Secretary gives the catalog it hosts. The catalog plays in Secretary's page too (AVPlay and the player). */
export interface EmbeddedHost {
  /** Secretary's Nuvio client: the catalog uses it instead of making a second one over the same session. */
  cloud?: import("@secretary/nuvio").NuvioClient;
  /** The root Back and CH+: give the screen back to Secretary's home. */
  onExit(): void;
  /** The search keys and buttons: Secretary's one search (launcher/src/search.tsx) takes the screen. */
  onSearch?(query?: string): void;
  /** The person Secretary's header shows top left; the catalog home draws the same header (tv-kit Header). */
  person?: import("@secretary/tv-kit/src/glass/Header.tsx").HeaderPerson;
  /** Secretary's header, which title pages draw collapsed to the clock (host.ts). Absent: the clock alone. */
  header?: import("./host.ts").HostHeader;
  /** The TV's apps, for Settings › Apps to pick which the Apps card shows (`settings.home.hiddenApps`). */
  apps?: readonly import("./host.ts").HostApp[];
  /** Categories Secretary adds to Settings (SmartThings), after Home screen. */
  settingsTabs?: readonly import("./host.ts").HostSettingsTab[];
}

declare const __TRAKT_CLIENT_ID__: string | undefined;

type View =
  | { name: "home" }
  | { name: "folder" }
  | { name: "hub"; tab?: OverlayTab }
  | {
      name: "timeline";
      collection: SagaDef;
      initialFocusTitleId?: string;
      returnToDetail?: { itemType: CatalogType; title: Title };
    }
  | {
      name: "detail";
      itemType: CatalogType;
      title: Title;
      autoPlay?: boolean;
      returnToTimeline?: { collection: SagaDef; focusTitleId: string };
      /** Opened from another title's "More like this": Back goes there. */
      returnTo?: { itemType: CatalogType; title: Title };
    }
  | {
      name: "player";
      itemType: CatalogType;
      title: Title;
      episode?: Video;
      streams: Stream[];
      start: number;
      /** The viewer picked the first source in the sheet. */
      manual?: boolean;
      /** Watching together: the party session drives this player. */
      together?: boolean;
    };

/** A room playing when this TV opens it: start this far ahead of it, about what opening a remote file takes. */
const PARTY_OPEN_AHEAD_MS = 6000;

const EXIT_WINDOW_MS = 2000;

const HEADING_FOR: Record<CatalogType, string> = {
  movie: "Cinema",
  series: "Shows",
  anime: "Anime",
};

export function CatalogApp({ type, heading, serverUrl, embedded, open, folder, hub }: CatalogConfig) {
  // One Nuvio client for the page: Secretary's.
  if (embedded.cloud) shareCloud(embedded.cloud);
  const [activeType, setActiveType] = useState<CatalogType>(type);
  const [settings, setSettings] = useState<DashboardSettings>(() => loadSettings());
  // Plugin and addon lists synced with the Nuvio profile (lib/listsync.ts), started with the stream setup below.
  // The plugin scope follows the kind being browsed (Secretary's embedded API can switch it), not the one it opened on.
  const activeNow = useRef(activeType);
  activeNow.current = activeType;
  const lists = useRef<{ sync(): Promise<void>; stop(): void } | null>(null);
  useEffect(() => () => lists.current?.stop(), []);
  const streams = useMemo(() => {
    setResumeServer(serverUrl);
    if (cloudEnabled) {
      setResumeRemote(nuvioRemote(type));
      setLibraryRemote(nuvioLibrary());
      setCollectionsRemote(nuvioCollections());
      lists.current = startListSync(pluginStore, addonStore);
    }
    const server = createStreamClient(serverUrl.replace(/\/$/, ""), streamType(type));
    void pluginStore.refresh();
    void addonStore.refresh();
    return createPluginStreamClient(
      (id, t, hint, onPartial, signal) =>
        pluginHost.find(id, t, hint, {
          signal,
          // A stopped search says nothing more: the page that showed its progress was left.
          onStatus: (s) => signal?.aborted || publishStatus(s),
          onUpdate: (s) => s.done || onPartial(s.streams),
          // Anime runs the scrapers made for anime, the others the general ones (manifest categories). The opened
          // title decides (a search hit can be either kind); the app only when the title does not say.
          scope: (hint?.anime ?? activeNow.current === "anime") ? "anime" : "general",
        }),
      pluginsActive,
      server,
      playable,
      streamType(type),
    );
  }, []);
  // Installed addons' catalogs follow the built-in rows; they change when an addon is read, installed or toggled.
  // Keyed by which catalogs there are, so a manifest read that changes nothing does not read every row again.
  const catalogKey = () => addonStore.active().map((a) => `${a.url} ${a.manifest!.catalogs.map((c) => `${c.type}/${c.id}`)}`).join("|");
  const [addonRev, setAddonRev] = useState(catalogKey);
  useEffect(() => addonStore.subscribe(() => setAddonRev(catalogKey())), []);
  const rowDefs = useMemo<(Pick<AddonRowDef, "id" | "title" | "url"> & Partial<AddonRowDef>)[]>(
    () => [...rowsFor(activeType), ...addonRowDefs(addons.catalogs(activeType), addons.catalogUrl)],
    [activeType, addonRev],
  );
  const [view, setView] = useState<View>(() =>
    open ? { name: "detail", itemType: open.type, title: { ...open.title, catalogType: open.type }, autoPlay: open.autoPlay } : hub ? { name: "hub", tab: hub.tab } : { name: "home" },
  );
  // Opened by the host on a title or a folder: Back from there gives the screen back instead of showing the home.
  const fromHost = useRef(Boolean(open || folder || hub));
  // Watch together (lib/party.ts): one party at a time, kept across the episodes it plays.
  const [party, setParty] = useState<PartySession | null>(null);
  /** The content id the party's player has open, so a timeline for other content (a `next`) opens that. */
  const partyContent = useRef<string | null>(null);
  const partyNow = useRef<PartySession | null>(null);
  partyNow.current = party;
  const viewNow = useRef(view);
  viewNow.current = view;
  const partyEnabled = cloudEnabled && partyApi.configured && cloud.session.signedIn();
  // Collections from the Nuvio profile (lib/nuviocollections.ts), and the folder open over the home, kept while a
  // title of it is open so Back returns to the same place.
  const [nuvioCols, setNuvioCols] = useState(() => loadNuvioCollections());
  // Each collection row's own card style (a long OK on the row; lib/collectionlayout.ts).
  const [rowStyles, setRowStyles] = useState(() => loadRowStyles());
  // A folder Nest asked for (a home card), opened once the collections are in.
  const [wantFolder, setWantFolder] = useState<{ collectionId: string; folderId: string } | null>(folder ?? null);
  const [folderOpen, setFolderOpen] = useState<{ collectionId: string; folderId: string; rowLook?: CardShape } | null>(null);
  const sourceKeys: SourceKeys = { tmdb: getTmdbKey(), trakt: typeof __TRAKT_CLIENT_ID__ !== "undefined" ? __TRAKT_CLIENT_ID__ : "" };
  const shownCols = useMemo(
    () => collectionsFor(nuvioCols, activeType, sourceUsable(activeType, addonStore.active(), sourceKeys)),
    [nuvioCols, activeType, addonRev],
  );
  const [catalog, setCatalog] = useState<HomeRow[]>(() => loadHome(type));
  const [resume, setResume] = useState<UnifiedResumeEntry[]>(() => loadAllResume());
  const [watchedRev, setWatchedRev] = useState(0);
  // Continue watching lists anime under Anime (lib/animeguard.ts): read it again once the anime ids are known.
  useEffect(() => void animeImdbIds().then(() => setResume(loadAllResume()), () => {}), []);
  const [focus, setFocus] = useState<Focus>({ row: 0, col: 0 });
  const [status, setStatus] = useState<string | null>(catalog.length ? null : "Loading…");
  // The control centre (ui/ControlCentre.tsx): a held CH+ opens it, a short one opens Nest (or closes it).
  const [controlCentre, setControlCentre] = useState(false);
  const [ccClock, setCcClock] = useState("");
  const chPlus = useRef({ open: false, openNest: () => {} });
  chPlus.current.open = controlCentre;

  // Secretary saves settings too (Blue mutes the spoken replies): the catalog keeps the latest, so its own saves never undo them.
  useEffect(() => onSettings(setSettings), []);

  useEffect(() => {
    applyLook(settings.general);
  }, [settings.general.accentTheme, settings.general.typeStyle, settings.general.textSize, settings.general.reduceMotion]);

  // Global Channel Rocker (CH- / CH+) and Search shortcuts when inside Detail or Timeline views.
  useKeys(view.name === "detail" || view.name === "timeline", (key) => {
    if (key === "ChannelDown" || key === "Search" || key === "SearchVoice") {
      embedded.onSearch?.();
      return true;
    }
    return false;
  });

  // Secretary's Watch together opened this on a room's title: join the room.
  useEffect(() => {
    if (open?.room) joinParty(open.room);
  }, []);

  // Sync watch progress, the library and the collections on start and on every wake.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      // The catalog checks for itself that its lists are the signed-in profile's (another profile resets them).
      if (cloudEnabled)
        checkOwner(() => {
          clearLocalResume();
          clearLocalLibrary();
          clearLocalNuvioCollections();
          setNuvioCols([]);
        });
      void syncAllResume().then(setResume);
      if (cloudEnabled) {
        void syncLibrary().then(() => setWatchedRev((n) => n + 1));
        void lists.current?.sync();
        void syncNuvioCollections().then(setNuvioCols);
      }
    };
    wake();
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, [activeType]);

  // Cache first, then refresh whenever the active catalog type changes.
  useEffect(() => {
    let live = true;
    const cached = loadHome(activeType);
    setCatalog(cached);
    setStatus(cached.length ? null : "Loading…");
    // Shows and Cinema leave out what the Anime app lists (lib/animeguard.ts).
    Promise.allSettled(rowDefs.map((r) => fetchRow(r.url).then((items) => withoutAnime(activeType, items)))).then((results) => {
      if (!live) return;
      const rows: HomeRow[] = results.flatMap((res, i) =>
        res.status === "fulfilled" && res.value.length
          ? [{ id: rowDefs[i].id, title: rowDefs[i].title, items: res.value, originLabel: rowDefs[i].origin }]
          : [],
      );
      if (rows.length) {
        setCatalog(rows);
        setStatus(null);
        saveHome(activeType, rows);
      } else if (!cached.length) {
        setStatus("Can't reach the catalogs");
      }
    });
    return () => {
      live = false;
    };
  }, [activeType, rowDefs]);

  const rows = useMemo<HomeRow[]>(() => {
    // Pinned Nuvio collections come right after My List, the others after them. The app's own sagas (lib/sagas.ts)
    // are kept for the Discover page and no longer have home rows.
    const nuvioRows = collectionRows(shownCols);
    const pinnedNuvio = new Set(shownCols.filter((c) => c.pinToTop).map((c) => `nuvio-col:${c.id}`));
    const topRows: HomeRow[] = [];
    // Only the kind the home was opened for (the Secretary card's), as every other row.
    const going = continueFor(resume, activeType);
    if (going.length) {
      topRows.push({
        id: "continue",
        title: "Continue watching",
        items: going.map(toContinueTitle),
      });
    }
    const saved = loadLibrary().filter((e) => kindFor(e.type, e.title) === activeType);
    if (saved.length) {
      topRows.push({ id: "mylist", title: "My List", originLabel: "Nuvio · your profile", items: saved.map((e) => ({ ...e.title, catalogType: e.type })) });
    }
    topRows.push(...nuvioRows.filter((r) => pinnedNuvio.has(r.id)));
    topRows.push(...nuvioRows.filter((r) => !pinnedNuvio.has(r.id)));
    // Titles watched whole carry a tick on their poster (Continue watching is, by its nature, not watched yet).
    const seen = new Set(loadWatchedIds());
    const ticked = (r: HomeRow): HomeRow =>
      r.id === "continue" || !r.items.some((m) => seen.has(m.id)) ? r : { ...r, items: r.items.map((m) => (seen.has(m.id) ? { ...m, watched: true } : m)) };
    return [...topRows, ...catalog].map(ticked);
  }, [resume, catalog, activeType, watchedRev, shownCols]);

  const openFolder = (collectionId: string, folderId: string, rowLook?: CardShape) => {
    if (!findFolder(shownCols, collectionId, folderId)) return;
    setFolderOpen({ collectionId, folderId, rowLook });
    setView({ name: "folder" });
  };
  useEffect(() => {
    if (!wantFolder || !findFolder(shownCols, wantFolder.collectionId, wantFolder.folderId)) return;
    openFolder(wantFolder.collectionId, wantFolder.folderId);
    setWantFolder(null);
  }, [wantFolder, shownCols]);
  const folderShown = useMemo(() => {
    const hit = folderOpen && findFolder(shownCols, folderOpen.collectionId, folderOpen.folderId);
    if (!hit) return null;
    const sources = hit.folder.catalogSources
      .map((s) => resolveSource(s, activeType, addonStore.active(), sourceKeys))
      .filter((r): r is ResolvedSource => r !== null);
    return { ...hit, sources };
  }, [folderOpen, shownCols]);

  useEffect(() => {
    focusedRowId.current = rows[focus.row]?.id;
  }, [focus.row]);

  // An addon row whose catalog pages (`skip`) reads its next page as focus nears its end.
  const paging = useRef(new Set<string>());
  useEffect(() => {
    const row = rows[focus.row];
    const def = row && rowDefs.find((d) => d.id === row.id);
    const url = def && nextPage(def, row.items.length, focus.col);
    if (!url || paging.current.has(url)) return;
    paging.current.add(url);
    void fetchRow(url).then((m) => withoutAnime(activeType, m)).then(
      (more) =>
        setCatalog((rs) =>
          rs.map((r) => {
            if (r.id !== row.id) return r;
            const have = new Set(r.items.map((t) => t.id));
            return { ...r, items: [...r.items, ...more.filter((t) => !have.has(t.id))] };
          }),
        ),
      () => paging.current.delete(url),
    );
  }, [focus, rows]);

  // Rows come and go as syncs land (Continue watching, My List, collections): focus stays on the row it was on, by id.
  const focusedRowId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!rows.length) return;
    const was = focusedRowId.current ? rows.findIndex((x) => x.id === focusedRowId.current) : -1;
    const r = was >= 0 ? was : Math.min(focus.row, rows.length - 1);
    focusedRowId.current = rows[r]?.id;
    const c = Math.min(focus.col, Math.max(0, (rows[r]?.items.length ?? 1) - 1));
    if (r !== focus.row || c !== focus.col) setFocus({ row: r, col: c });
  }, [rows]);

  // Debug hooks for the CDP scripts: open a title, open a collection timeline, open Hub/Frame/Settings, or switch catalog types.
  useEffect(() => {
    const g = globalThis as { __sectv?: Record<string, unknown> };
    g.__sectv = {
      ...g.__sectv,
      openTitle: async (id: string, itemType: CatalogType = activeType) => {
        const title = await fetchMeta(itemType, id);
        if (title) setView({ name: "detail", itemType, title });
      },
      openSaga: (sagaId: string, initialFocusTitleId?: string) => {
        const col = getSagaById(sagaId);
        if (col) setView({ name: "timeline", collection: col, initialFocusTitleId });
      },
      openHub: (query = "") => (query ? embedded.onSearch?.(query) : setView({ name: "hub" })),
      openSettings: () => {
        setView({ name: "hub", tab: "settings" });
      },
      openFolder: (collectionId: string, folderId: string) => openFolder(collectionId, folderId),
      collections: () => shownCols.map((c) => ({ id: c.id, title: c.title, folders: c.folders.map((f) => f.id) })),
      switchType: (nextType: CatalogType) => {
        setActiveType(nextType);
        setFocus({ row: 0, col: 0 });
        setView({ name: "home" });
      },
    };
  }, [activeType, shownCols]);

  // Time from navigation start to the first cards in the DOM: the cached-home number.
  const painted = useRef(false);
  useEffect(() => {
    if (painted.current || !rows.length) return;
    painted.current = true;
    requestAnimationFrame(() => record("first-cards", performance.now()));
  }, [rows.length]);

  const flash = (msg: string) => island.push({ key: "app", text: msg, level: "info", ms: EXIT_WINDOW_MS });

  /** CH+ and the root Back: back to Secretary's home (docs/launcher.md). */
  const openNest = () => embedded.onExit();

  chPlus.current.openNest = openNest;

  // CH+ for every view, before their own keys: held, its first repeat (about 0.35 s, docs/lessons.md Input) opens the
  // control centre; released with no repeat, it opens Nest, or closes the control centre when that is open.
  useEffect(() => {
    let down = false;
    let held = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode !== 427 || isTvImeOpen()) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.type === "keydown") {
        if (!e.repeat) {
          down = true;
          held = false;
        } else if (down && !held) {
          held = true;
          setCcClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: settings.general.clockFormat === "12h" }));
          setControlCentre(true);
        }
      } else if (e.type === "keyup") {
        if (down && !held) {
          if (chPlus.current.open) setControlCentre(false);
          else chPlus.current.openNest();
        }
        down = false;
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [settings.general.clockFormat]);

  // ---- Watch together ----
  const partySession = (code: string, joinUrl: string, firstWsUrl: string) => {
    const s = createPartySession({
      code,
      joinUrl,
      firstWsUrl,
      ticket: async () => (await partyApi.ticket(code, cloud.session.profile())).wsUrl,
      socket: (url) => new WebSocket(url) as unknown as SocketLike,
    });
    partyNow.current?.leave();
    partyNow.current = s;
    setParty(s);
    s.connect();
    return s;
  };

  /** The room's content in the player, as this TV's own source of the room's release. */
  const openPartyContent = async (s: PartySession, tl: Timeline) => {
    partyContent.current = tl.contentId;
    const app = contentApp(tl.contentId);
    // Anime with IMDb ids is numbered like a series: the anime rule (lib/animeguard.ts) gives its kind back.
    const itemType: CatalogType = app.type === "series" && type === "anime" ? "anime" : kindFor(app.type, { id: app.titleId });
    const meta = (await fetchMeta(itemType, app.titleId).catch(() => null)) ?? { id: app.titleId, name: tl.title, year: "", rating: "" };
    const episode = meta.videos?.find((v) => v.id === tl.contentId);
    const stream = streamFor(tl.release, debrids()[0]?.id, tl.title, { ...episodeHint(tl.contentId), ...(episode ? fileHintFor(episode) : undefined) });
    if (!stream) {
      island.push({ key: "party", text: "Add a TorBox or Premiumize key in Settings to watch together", level: "error" });
      s.leave();
      return;
    }
    const start = tl.state === "playing" ? targetPos(tl, s.serverNow() + PARTY_OPEN_AHEAD_MS) : tl.pos0;
    mark("ok");
    setView({ name: "player", itemType, title: { ...meta, catalogType: itemType }, episode, streams: [stream], start, together: true });
  };

  const joinParty = (raw: string) => {
    const code = normalizeCode(raw);
    if (!code) return island.push({ key: "party", text: `"${raw.trim()}" is not a party code`, level: "error" });
    island.push({ key: "party", text: `Joining party ${code}…`, level: "info" });
    partyApi.ticket(code, cloud.session.profile()).then(
      (b) => {
        partyContent.current = null;
        partySession(code, b.joinUrl, b.wsUrl);
      },
      (e) => island.push({ key: "party", text: partyErrorText(e), level: "error" }),
    );
  };

  const startParty = (itemType: CatalogType, title: Title, episode: Video | undefined, chosen: Stream, from: number) => {
    const release = releaseOf(chosen, parseStreamInfo(chosen).size);
    if (!release) return island.push({ key: "party", text: "This source can't be shared: pick a torrent source", level: "error" });
    const contentId = episode?.id ?? title.id;
    island.push({ key: "party", text: "Starting a party…", level: "info" });
    partyApi
      .create({
        profile: cloud.session.profile(),
        contentId,
        title: episode ? `${title.name} · ${episodeLabel(episode)}` : title.name,
        release,
        control: "host",
        startPos: from,
      })
      .then(
        (made) => {
          partyContent.current = contentId;
          partySession(made.code, made.joinUrl, made.wsUrl);
          mark("ok");
          setView({ name: "player", itemType, title, episode, streams: [chosen], start: from, together: true });
        },
        (e) => island.push({ key: "party", text: partyErrorText(e), level: "error" }),
      );
  };

  // The party's timeline decides the content: the first one after joining, and every `next`, open it here.
  useEffect(() => {
    if (!party) return;
    let opening = false;
    const check = () => {
      const v = party.get();
      if (v.status === "closed") {
        if (v.reason !== "left") island.push({ key: "party", text: LEAVE_TEXT[v.reason ?? "left"], level: v.reason === "ended" ? "info" : "error" });
        partyContent.current = null;
        // Out of the player the session is done; in it, the player keeps playing alone until Back.
        const cur = viewNow.current;
        if (cur.name !== "player" || !cur.together) setParty(null);
        return;
      }
      if (!v.tl || opening || v.tl.contentId === partyContent.current) return;
      opening = true;
      void openPartyContent(party, v.tl).finally(() => (opening = false));
    };
    check();
    const off = party.subscribe(check);
    // The socket drops while the app is hidden; back in front it reconnects with a fresh ticket.
    const vis = () => (document.visibilityState === "hidden" ? party.suspend() : party.resume());
    document.addEventListener("visibilitychange", vis);
    return () => {
      off();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [party]);

  /** True while a title opened from Continue watching is playing, so Back returns straight to Home. */
  const fromContinue = useRef(false);

  const goHome = () => {
    if (fromHost.current) return embedded.onExit();
    setFolderOpen(null);
    setResume(loadAllResume());
    setWatchedRev((v) => v + 1);
    setView({ name: "home" });
  };

  const homeBack = () => embedded.onExit();

  const triggerCinemaAutoDim = () => {
    // The side lights go off (Nest's grant); without one, the movie scene or the server's cinema preset dims as before.
    if (settings.domotics.cinemaAutoDim) void playbackLights.start().then((took) => took || runMovieScene("movie", serverUrl));
  };

  // Leaving the player brings the room back (Nest's restore scene); moving on to the next episode stays in it.
  const wasPlaying = useRef(false);
  useEffect(() => {
    const playing = view.name === "player";
    if (wasPlaying.current && !playing && settings.domotics.cinemaAutoDim) void playbackLights.stop().then((took) => took || runMovieScene("restore", serverUrl));
    wasPlaying.current = playing;
  }, [view.name]);

  const shown =
    view.name === "detail" || view.name === "player"
      ? { title: view.title, itemType: view.itemType }
      : null;
  const nextOf = (title: Title, episode: Video | undefined) =>
    episode && title.videos ? nextEpisode(title.videos, episode.id) : null;
  const currentHeading = activeType === type ? heading : HEADING_FOR[activeType];

  return (
    <>
      {/* AVPlay draws the video where this element is (docs/lessons.md, AVPlay). Mounted for the app's life: the
          detail page prepares ahead before the player exists. Opaque screens above it cover it until they hide. */}
      <object type="application/avplayer" class="av-plane" />
      <Home
        type={activeType}
        rows={rows}
        focus={focus}
        active={view.name === "home"}
        status={status}
        heading={currentHeading}
        clockFormat={settings.general.clockFormat}
        person={embedded.person}
        header={embedded.header}
        onFocus={setFocus}
        onOpen={(title, autoPlay) => {
          fromContinue.current = Boolean(autoPlay);
          setView({
            name: "detail",
            itemType: title.catalogType ?? activeType,
            title,
            autoPlay,
          });
        }}
        onOpenFolder={openFolder}
        look={settings.collections}
        rowStyles={rowStyles}
        onRowStyle={(rowId, style) => setRowStyles(saveRowStyle(rowId, style))}
        onDwell={(title) => {
          const itemType = title.catalogType ?? activeType;
          // A series' episode sources depend on the episode, so only movies look up on dwell.
          if (itemType === "movie") void streams.get(title.id, undefined, "movie").catch(() => {});
        }}
        onOpenHub={(tab) => {
          if (tab !== "settings") return embedded.onSearch?.();
          setView({ name: "hub", tab });
        }}
        onBack={homeBack}
      />
      {folderShown && (
        <NuvioFolder
          key={`${folderShown.collection.id}/${folderShown.folder.id}`}
          type={activeType}
          collection={folderShown.collection}
          folder={folderShown.folder}
          sources={folderShown.sources}
          keys={sourceKeys}
          look={settings.collections}
          rowLook={folderOpen?.rowLook}
          active={view.name === "folder"}
          onOpen={(itemType, title) => setView({ name: "detail", itemType, title })}
          onBack={goHome}
        />
      )}
      <HubOverlay
        active={view.name === "hub"}
        activeType={activeType}
        settings={settings}
        onUpdateSettings={setSettings}
        header={embedded.header}
        apps={embedded.apps}
        hostTabs={embedded.settingsTabs}
        initialTab={hub?.category}
        onSearch={() => embedded.onSearch?.()}
        onOpenNest={openNest}
        onClose={goHome}
      />
      {view.name === "timeline" && (
        <SagaTimeline
          key={view.collection.id}
          collection={view.collection}
          active={true}
          clockFormat={settings.general.clockFormat}
          initialFocusTitleId={view.initialFocusTitleId}
          onOpenTitle={(itemType, title, autoPlay) =>
            setView({
              name: "detail",
              itemType,
              title,
              autoPlay,
              returnToTimeline: { collection: view.collection, focusTitleId: title.id },
            })
          }
          onStateChange={() => setWatchedRev((v) => v + 1)}
          onBack={() => {
            if (view.returnToDetail) {
              setView({
                name: "detail",
                itemType: view.returnToDetail.itemType,
                title: view.returnToDetail.title,
              });
            } else {
              goHome();
            }
          }}
        />
      )}
      {shown && (
        <Detail
          key={`${shown.itemType}:${shown.title.id}`}
          type={shown.itemType}
          title={shown.title}
          streams={streams}
          resume={resume.find((e) => e.type === shown.itemType && e.title.id === shown.title.id)}
          active={view.name === "detail"}
          autoPlay={view.name === "detail" && Boolean(view.autoPlay)}
          clockFormat={settings.general.clockFormat}
          header={embedded.header}
          spoilerProtection={settings.playback.spoilerProtection}
          startAfter={settings.playback.startAfter}
          limits={settings.playback}
          remember={settings.playback.rememberSource}
          sheetOrder={settings.playback.sheetOrder}
          onPlay={(title, episode, found, start, manual) => {
            mark("ok");
            triggerCinemaAutoDim();
            setView({
              name: "player",
              itemType: shown.itemType,
              title,
              episode,
              streams: found,
              start,
              manual,
            });
          }}
          party={
            partyEnabled
              ? {
                  start: (title, episode, chosen, from) => startParty(shown.itemType, title, episode, chosen, from),
                  join: joinParty,
                }
              : undefined
          }
          onOpenTimeline={(collection, focusTitleId) =>
            setView({
              name: "timeline",
              collection,
              initialFocusTitleId: focusTitleId,
              returnToDetail: { itemType: shown.itemType, title: shown.title },
            })
          }
          onOpenTitle={(t) => setView({ name: "detail", itemType: shown.itemType, title: t, returnTo: { itemType: shown.itemType, title: shown.title } })}
          onWatchedChange={() => setWatchedRev((v) => v + 1)}
          onBack={() => {
            if (view.name === "detail" && view.returnTo) {
              setView({ name: "detail", itemType: view.returnTo.itemType, title: view.returnTo.title });
            } else if (view.name === "detail" && view.returnToTimeline) {
              setView({
                name: "timeline",
                collection: view.returnToTimeline.collection,
                initialFocusTitleId: view.returnToTimeline.focusTitleId,
              });
            } else if (folderOpen) {
              setView({ name: "folder" });
            } else {
              goHome();
            }
          }}
        />
      )}
      {view.name === "player" && (
        <PlayerView
          key={view.episode?.id ?? view.title.id}
          onPlayState={(playing) => (settings.domotics.cinemaAutoDim ? (playing ? playbackLights.resume() : playbackLights.pause()) : undefined)}
          type={view.itemType}
          title={view.title}
          episode={view.episode}
          next={nextOf(view.title, view.episode)}
          streams={view.streams}
          startSec={view.start}
          party={view.together ? party ?? undefined : undefined}
          audioLangs={settings.playback.audioLangs}
          subLangs={settings.playback.subLangs.length ? settings.playback.subLangs : settings.playback.audioLangs}
          room={playerRoom(settings.domotics.cinemaAutoDim, serverUrl)}
          onPrefetchNext={(next, playing) =>
            // Sources, and the link of the one Next will play (the same release when there is one), so moving on only
            // has to open and prepare. Warming resolves the link, so only for a source checking adds nothing to an
            // account (lib/verify.ts safeToCheck): a TorBox one would be added to the account before it is chosen.
            void streams
              .get(next.id, fileHintFor(next), streamType(view.itemType))
              .then((found) => {
                const same = settings.playback.rememberSource && playing ? matchPref(prefOf(playing, Date.now()), found, isDead) : -1;
                const first = found[same >= 0 ? same : 0];
                if (first && safeToCheck(Boolean(loadDebrid().torboxAhead))(first)) return streams.warm(first.url);
              })
              .catch(() => {})
          }
          manualPick={view.manual}
          remember={settings.playback.rememberSource}
          countdown={settings.playback.upNextCountdown}
          autoSkip={settings.playback.autoSkip}
          pausePanel={settings.playback.pausePanel}
          onNext={async (next, playing) => {
            const found = await streams.get(next.id, fileHintFor(next), streamType(view.itemType));
            if (!found.length) throw new Error("no sources for the next episode");
            if (view.together && party) {
              // The room moves on: everyone opens the next episode's release, found here, from their own account.
              const same = playing ? matchPref(prefOf(playing, Date.now()), found, isDead) : -1;
              const pick = [found[same], ...found].find((s) => s && releaseOf(s));
              const release = pick && releaseOf(pick, parseStreamInfo(pick).size);
              if (!release) throw new Error("no torrent source to share for the next episode");
              party.command("next", { pos: 0, contentId: next.id, title: `${view.title.name} · ${episodeLabel(next)}`, release });
              return;
            }
            // The next episode starts with the same kind of release as the one that just played (lib/sourcepref.ts).
            const same = settings.playback.rememberSource && playing ? matchPref(prefOf(playing, Date.now()), found, isDead) : -1;
            if (same >= 0) console.info("[autoplay] next episode: the same release as before");
            mark("ok");
            setView({
              name: "player",
              itemType: view.itemType,
              title: view.title,
              episode: next,
              streams: same > 0 ? [found[same], ...found.filter((_, i) => i !== same)] : found,
              start: 0,
            });
          }}
          onExit={() => {
            if (view.together) {
              party?.leave();
              setParty(null);
              partyContent.current = null;
            }
            setResume(loadAllResume());
            setWatchedRev((v) => v + 1);
            setView({ name: "detail", itemType: view.itemType, title: view.title });
          }}
        />
      )}
      <Island onVideo={view.name === "player"} />
      <ControlCentre
        open={controlCentre}
        settings={settings}
        clock={ccClock}
        onChange={(next) => setSettings(saveSettings(next))}
        onClose={() => setControlCentre(false)}
      />
    </>
  );
}
