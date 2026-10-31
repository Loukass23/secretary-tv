import { type Dir, type Focus, getTvInputBridge, move, useKeys, windowOf } from "@secretary/tv-kit";
import { Glass, GlassRoot, ListCard, MediaTile, Scroller, Segmented } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { backgroundUrl, fetchMeta } from "../lib/cinemeta.ts";
import {
  type SagaDef,
  fetchTmdbCollection,
  findSagaForTitle,
} from "../lib/sagas.ts";
import { defaultEpisode, episodeLabel, episodesOf, fileHintFor, hasAired, seasonsOf } from "../lib/episodes.ts";
import { inLibrary, toggleLibrary } from "../lib/library.ts";
import { isTitleWatched, type ResumeEntry, resumeLabel, resumeStart, toggleTitleWatched } from "../lib/resume.ts";
import { audioLangsOf, type ClockFormat, subLangsOf } from "../lib/settings.ts";
import type { ProviderStatus } from "@secretary/plugins";
import { decide, type StartAfter, waitMs } from "../lib/autoplay.ts";
import { releaseOf } from "../lib/party.ts";
import { ago } from "../lib/failures.ts";
import { onPluginStatus, pluginStore, pluginsActive, shortName, statusLine } from "../lib/plugins.ts";
import { compilePattern, pickIndex, rankSources, type Rules } from "../lib/rules.ts";
import { matchPref } from "../lib/sourcepref.ts";
import { deviceCapSet } from "../lib/device.ts";
import { parseStreamInfo, type Stream, type StreamClient } from "../lib/streams.ts";
import { type CatalogType, isSeries, streamType, type Title, type Video } from "../lib/types.ts";
import { cancelPreload, deadLinks, preload, prepareAheadEnabled, sourcePrefs } from "../player/session.ts";
import { HeroLayers, useBase, useHeroArt } from "./art.tsx";
import { island } from "./Island.tsx";
import { applyFilters, type Filter, filterChips, filterLabel, focusable, isVerified, type SheetOrder, sheetRows, sourceLanguages } from "./sheet.ts";
import "./detail.css";
import "./party.css";

const PRELOAD_DWELL_MS = 1000;
/** Browsing episodes should not look up streams for every card passed over. */
const EPISODE_DWELL_MS = 400;
const PAD = 80;
const EP_W = 320;
const EP_H = 180;
const EP_STRIDE = EP_W + 28;
/** The info panel: taller for films, shorter for series to leave room for seasons and episodes. */
const INFO_MOVIE = { x: PAD, y: 120, w: 1060, h: 560 };
const INFO_SERIES = { x: PAD, y: 110, w: 1060, h: 470 };
const SEASONS_Y = 610;
const EPS_Y = 706;
/** The sources sheet, on the right; rows scroll inside it. */
const SHEET = { x: 1060, y: 60, w: 800, h: 960 };
const SOURCE_H = 112;
const SOURCE_STRIDE = SOURCE_H + 14;
/** A section header in the sources sheet ("4K HDR · 12"). */
const HEADER_STRIDE = 46;

function formatClock(fmt: ClockFormat): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: fmt === "12h",
  });
}

interface Props {
  type: CatalogType;
  title: Title;
  streams: StreamClient;
  resume: ResumeEntry | undefined;
  active: boolean;
  autoPlay?: boolean;
  clockFormat?: ClockFormat;
  /** Settings › Playback: how long Play waits for slower providers (lib/autoplay.ts). */
  startAfter?: StartAfter;
  /** Settings › Playback size limits, which autoplay prefers to stay inside (lib/rules.ts). */
  limits?: Pick<Rules, "maxSizeGb" | "minSizeGb"> & { require?: string; prefer?: string; audioLangs?: string[]; subLangs?: string[] };
  /** Settings › Playback "Remember my source" (lib/sourcepref.ts). */
  remember?: boolean;
  /** Settings › Playback "Sources list order" (ui/sheet.ts). */
  sheetOrder?: SheetOrder;
  /** `manual`: the viewer picked the first source in the sheet. */
  onPlay(title: Title, episode: Video | undefined, streams: Stream[], startSec: number, manual: boolean): void;
  /**
   * Watch together (lib/party.ts): start a party on the source autoplay picks among the shareable ones (a torrent:
   * only its fingerprint goes to the room), or join one by its code. Absent, the action is not shown.
   */
  party?: {
    start(title: Title, episode: Video | undefined, chosen: Stream, startSec: number): void;
    join(code: string): void;
  };
  onOpenTimeline(collection: SagaDef, focusTitleId: string): void;
  onWatchedChange(): void;
  onBack(): void;
}

type Found = { id: string; value: Stream[] | "none" | "error" };

/**
 * Everything about one source, over the sheet's list: provider, full title, file, size, audio languages, and the
 * provider's own wording. The stream's URL is never shown (it can hold debrid keys).
 */
function SourceDetails({
  stream,
  providers,
  languages,
  scroll,
}: {
  stream: Stream;
  providers: readonly ProviderStatus[];
  languages: string[];
  scroll: number;
}) {
  const p = parseStreamInfo(stream);
  const provider = providers.find((x) => x.id === stream.provider)?.name ?? stream.provider ?? "The server's addon";
  const facts: [string, string | undefined][] = [
    ["Provider", provider],
    ["Quality", p.badges.join(" · ")],
    ["Size", p.size],
    ["Audio", languages.length ? languages.map((l) => l.toUpperCase()).join(", ") : undefined],
    ["Subtitles", stream.meta?.langs?.subs.length ? stream.meta.langs.subs.map((l) => l.toUpperCase()).join(", ") : undefined],
    [
      "Match",
      isVerified(stream)
        ? "✔ Verified: the right title and episode, from a trusted source"
        : stream.meta?.match === "loose"
          ? "Close match: the provider is not sure of the title or episode"
          : undefined,
    ],
    ["File", stream.file],
    ["Release group", stream.group],
  ];
  return (
    <Glass x={20} y={120} w={SHEET.w - 40} h={SHEET.h - 150} frost={false} class="det-details">
      <span class="cat-kicker det-details-k">Source details · OK closes</span>
      <Scroller x={30} y={84} w={SHEET.w - 120} h={SHEET.h - 290} axis="y" offset={scroll} pad={10}>
        <dl class="det-facts">
          {facts
            .filter(([, v]) => v)
            .flatMap(([k, v]) => [<dt key={`${k}:t`}>{k}</dt>, <dd key={`${k}:d`}>{v}</dd>])}
          <dt>As the provider names it</dt>
          <dd class="det-raw">
            {stream.name}
            {"\n"}
            {stream.title}
          </dd>
        </dl>
      </Scroller>
    </Glass>
  );
}

export function Detail({
  type,
  title,
  streams,
  resume,
  active,
  autoPlay,
  clockFormat = "24h",
  startAfter = "5",
  limits,
  remember = true,
  sheetOrder = "grouped",
  onPlay,
  party,
  onOpenTimeline,
  onWatchedChange,
  onBack,
}: Props) {
  const [meta, setMeta] = useState<Title>(title);
  const [found, setFound] = useState<Found | null>(null);
  // Sources found so far while plugins are still answering; `found` is the final list.
  const [partial, setPartial] = useState<{ id: string; value: Stream[] } | null>(null);
  // Where each plugin stands (lib/plugins.ts): the status line while sources load, and the sheet's provider tabs.
  const [pluginStatus, setPluginStatus] = useState<ProviderStatus[]>([]);
  useEffect(() => onPluginStatus(setPluginStatus), []);
  const pluginStatusNow = useRef<ProviderStatus[]>([]);
  pluginStatusNow.current = pluginStatus;
  const pluginProgress = statusLine(pluginStatus);
  const [providerTab, setProviderTab] = useState(0);
  // Filter chips above the sheet's list (ui/sheet.ts), and which chip has focus (null: the list has it).
  const [filters, setFilters] = useState<ReadonlySet<Filter>>(new Set());
  const [chipAt, setChipAt] = useState<number | null>(null);
  // The details card over the sheet (hold OK or Info on a source), and how far it is scrolled.
  const [detailsOf, setDetailsOf] = useState<Stream | null>(null);
  const [detailsScroll, setDetailsScroll] = useState(0);
  /** OK pressed on a source and not yet released: released soon it plays, held it opens the details card. */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickRef = useRef<() => void>(() => {});
  // Play pressed (or autoplay asked) before the sources are all in: decided by lib/autoplay.ts as they arrive.
  const [pending, setPending] = useState<{ episode: Video | undefined; from: number; together?: boolean } | null>(null);
  // The Watch together card: start a party or type a code (focus 0 or 1), null when closed.
  const [partyCard, setPartyCard] = useState<number | null>(null);
  const searchStarted = useRef(0);
  const [tick, setTick] = useState(0);
  const lastWait = useRef("");
  // Why the sheet opened by itself, shown in its heading until it closes.
  const [sheetNote, setSheetNote] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>({ row: 0, col: 0 });
  const [autoPlayed, setAutoPlayed] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [watched, setWatched] = useState<boolean>(() => isTitleWatched(title.id));
  const [saved, setSaved] = useState<boolean>(() => inLibrary(type, title.id));
  const [clockText, setClockText] = useState(() => formatClock(clockFormat));
  const [sagaCol, setSagaCol] = useState<SagaDef | undefined>(() =>
    findSagaForTitle(title.id, type),
  );

  const series = isSeries(type);
  const artSrc = backgroundUrl(meta);
  const base = useBase(type);
  // One title, so its art goes up at once; its frost still waits until nothing moves.
  const hero = useHeroArt(meta.id, artSrc, active, true);
  const videos = meta.videos ?? [];

  const seasons = useMemo(() => seasonsOf(videos), [videos]);
  const start = useMemo(() => defaultEpisode(videos, resume?.episode?.id), [videos, resume?.episode?.id]);
  const [season, setSeason] = useState<number | null>(null);
  const shownSeason = season ?? start?.season ?? seasons[0] ?? 1;
  const episodes = useMemo(() => episodesOf(videos, shownSeason), [videos, shownSeason]);

  // The title or episode Play would start, which the stream lookup and prepare-ahead follow.
  const focused = series && focus.row === 2 ? episodes[focus.col] : undefined;
  const target: Video | undefined = series ? (focused ?? start ?? undefined) : undefined;
  const targetId = series ? target?.id : title.id;
  const resumeHere = !!resume && (series ? resume.episode?.id === target?.id : true);
  const startSec = resumeHere && resume ? resumeStart(resume.posSec, resume.durSec) : 0;

  useEffect(() => {
    setClockText(formatClock(clockFormat));
    const t = setInterval(() => setClockText(formatClock(clockFormat)), 30_000);
    return () => clearInterval(t);
  }, [clockFormat]);

  useEffect(() => {
    if (active) {
      setWatched(isTitleWatched(title.id));
      setSaved(inLibrary(type, title.id));
    }
  }, [active, title.id]);

  useEffect(() => {
    let live = true;
    const curated = findSagaForTitle(title.id, type);
    setSagaCol(curated);

    fetchMeta(type, title.id).then(
      (m) => {
        if (!live || !m) return;
        setMeta({
          ...title,
          ...m,
          rating: m.rating || title.rating,
          poster: m.poster ?? title.poster,
          background: m.background ?? title.background,
        });
        if (!curated && m.tmdbCollection?.id) {
          void fetchTmdbCollection(m.tmdbCollection.id, m.tmdbCollection.name).then((dynCol) => {
            if (live && dynCol) setSagaCol(dynCol);
          });
        }
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [type, title.id]);

  useEffect(() => {
    if (!targetId) return;
    let live = true;
    let stop = () => {};
    const t = setTimeout(
      () => {
        searchStarted.current = Date.now();
        stop = streams.watch(targetId, target ? fileHintFor(target) : undefined, streamType(type), (s, done) => {
          if (!live) return;
          if (done) {
            setFound({ id: targetId, value: s.length ? s : "none" });
            // Providers that failed this search, one line on the island each (updated in place on the next search).
            for (const p of pluginStatusNow.current.filter((x) => x.state === "error")) {
              island.push({ key: `provider:${p.id}`, text: `${shortName(p)} failed`, level: "error" });
            }
          }
          else setPartial({ id: targetId, value: s });
        });
      },
      focused ? EPISODE_DWELL_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
      stop();
    };
  }, [type, targetId, !!focused]);

  const ready = found && found.id === targetId && Array.isArray(found.value) ? found.value : null;
  // What the sheet lists: the final sources, or those found so far.
  const listed = ready ?? (partial && partial.id === targetId && partial.value.length ? partial.value : null);
  const searching = !ready && found?.id !== targetId;
  // Provider tabs (All, then each plugin) when the sources came from plugins.
  const tabs = useMemo(
    () => (listed?.some((s) => s.provider) ? pluginStatus.slice(0, 8) : []),
    [listed, pluginStatus],
  );
  const tabId = providerTab > 0 ? tabs[providerTab - 1]?.id : undefined;
  // Each source's audio languages, read once per list, for the Audio chips: its provider's `_meta` first, else its text.
  const langOf = useMemo(() => {
    const m = new Map((listed ?? []).map((s) => [s, sourceLanguages(s)]));
    return (s: Stream) => m.get(s) ?? sourceLanguages(s);
  }, [listed]);
  const chips = useMemo(() => (listed ? filterChips(listed, langOf) : []), [listed, langOf]);
  const { shown, hidden } = useMemo(() => {
    if (!listed) return { shown: null, hidden: 0 };
    const { kept, hidden } = applyFilters(tabId ? listed.filter((s) => s.provider === tabId) : listed, filters, langOf);
    return { shown: kept, hidden };
  }, [listed, tabId, filters, langOf]);
  const parsedShown = useMemo(() => new Map((shown ?? []).map((s) => [s, parseStreamInfo(s)])), [shown]);
  // Sources that failed recently get a mark in the sheet with when and why (lib/deadlinks.ts, lib/failures.ts).
  const failedOf = useMemo(() => deadLinks.snapshot(), [sourcesOpen, shown]);
  const parsedStreams = useMemo(() => (ready ? ready.map(parseStreamInfo) : []), [ready]);
  // What autoplay prefers (lib/rules.ts): no recent failure, inside the size limits, best resolution, provider order.
  // Built once per change, not per key press: ranking parses every source, and each failure lookup reads storage.
  const providerOrder = pluginStore.providerOrder().join(",");
  const rules = useMemo<Rules>(() => {
    const pattern = (src?: string) => {
      const p = compilePattern(src);
      return p === "invalid" ? null : p;
    };
    // Automatic languages (Settings › Playback): the TV's for audio, and subtitles in the audio language.
    const langs = { audioLangs: limits?.audioLangs ?? [], subLangs: limits?.subLangs ?? [] };
    return {
      maxSizeGb: limits?.maxSizeGb,
      minSizeGb: limits?.minSizeGb,
      require: pattern(limits?.require),
      prefer: pattern(limits?.prefer),
      providerOrder: providerOrder ? providerOrder.split(",") : [],
      isDead: (s) => failedOf(s) != null,
      caps: deviceCapSet(),
      langs: { audio: audioLangsOf(langs), subs: subLangsOf(langs) },
    };
  }, [limits?.maxSizeGb, limits?.minSizeGb, limits?.require, limits?.prefer, limits?.audioLangs, limits?.subLangs, providerOrder, failedOf]);
  // The viewer's source from last time (lib/sourcepref.ts), read again when the sources change.
  const pref = useMemo(() => (remember ? sourcePrefs.recall(title.id) : null), [remember, title.id, ready, sourcesOpen]);
  const { previous, bestIdx, best } = useMemo(() => {
    const prefIn = (list: Stream[] | null) => (pref && list ? matchPref(pref, list, rules.isDead) : -1);
    const pickIn = (list: Stream[]) => {
      const at = prefIn(list);
      return at >= 0 ? at : pickIndex(list, rules);
    };
    return {
      // The same kind of release as last time, if this list has one: it goes first, marked in the sheet.
      previous: listed ? listed[prefIn(listed)] : undefined,
      // The source autoplay starts, shown as "Will play", marked "Auto-picked" and prepared ahead.
      bestIdx: ready ? pickIn(ready) : -1,
      best: listed ? listed[pickIn(listed)] : undefined,
    };
  }, [pref, ready, listed, rules]);
  const topParsed = parsedStreams[bestIdx];
  // The sheet's lines (ui/sheet.ts): grouped by quality with the best first, or in the providers' order.
  const sheetItems = useMemo(
    () => (shown ? sheetRows(shown, { best, order: sheetOrder, isLow: (s) => failedOf(s) != null }) : []),
    [shown, best, sheetOrder, failedOf],
  );
  const rowsAt = useMemo(() => focusable(sheetItems), [sheetItems]);

  // When launched from a Continue Watching / Up Next card with autoPlay, start as Play would.
  useEffect(() => {
    if (!active || !autoPlay || autoPlayed || !targetId) return;
    if (series && !target) return;
    setAutoPlayed(true);
    setPending({ episode: target, from: startSec });
  }, [active, autoPlay, autoPlayed, targetId, target, startSec]);

  // A pending Play is decided again whenever sources or provider states change, and every 250 ms for the wait.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [!!pending]);
  useEffect(() => {
    if (!pending || !active) return;
    // Together, only a torrent source can be shared (its fingerprint), so autoplay picks among those.
    const pool = (pending.together ? listed?.filter((s) => releaseOf(s)) : listed) ?? [];
    const d = decide({
      candidates: pool,
      status: pluginStatus,
      done: found?.id === targetId,
      elapsedMs: Date.now() - searchStarted.current,
      waitMs: waitMs(startAfter),
      rules,
      // Played as soon as it is found; while its provider still searches, waited for within the wait.
      remembered: pref ? { url: previous?.url ?? "", provider: pref.provider } : undefined,
    });
    if ("wait" in d) {
      // Each new reason once, for cdp.mjs logs.
      if (lastWait.current !== d.wait) console.info(`[autoplay] waiting: ${d.wait}`);
      lastWait.current = d.wait;
      return;
    }
    lastWait.current = "";
    setPending(null);
    if ("sheet" in d && pending.together) {
      island.push({ key: "source", text: "No source to share by itself · start the party from Play's source", level: "error" });
      return;
    }
    if ("sheet" in d) {
      // Sources, but none autoplay may pick: the viewer picks one.
      console.info(`[autoplay] ${d.sheet}: the sources open`);
      setSheetNote(rules.require ? "None matches your Require pattern · pick one" : "No source to play by itself · pick one");
      setSourceIdx(0);
      setProviderTab(0);
      setFilters(new Set());
      setChipAt(null);
      setSourcesOpen(true);
      return;
    }
    if ("none" in d || !listed) {
      // Play pressed and the search came back empty: say so rather than doing nothing.
      island.push({ key: "source", text: pending.together ? "No torrent source to share for this title" : "No source found for this title", level: "error" });
      return;
    }
    if (pending.together && party) return party.start(meta, pending.episode, pool[d.go], pending.from);
    console.info(`[autoplay] source ${d.go + 1} of ${listed.length}: ${listed[d.go] === previous ? "remembered" : d.reason}`);
    if (listed[d.go] === previous) island.push({ key: "source", text: "Playing your source from last time", level: "info" });
    play(pending.episode, pending.from, listed[d.go], listed);
  }, [pending, active, listed, found, pluginStatus, tick]);

  // The top source is warmed on the server, and optionally prepared on the TV, while the viewer reads.
  useEffect(() => {
    if (!active || !ready) return;
    const top = ready[bestIdx];
    const t = setTimeout(() => {
      void streams.warm(top.url);
      if (prepareAheadEnabled()) preload(top.url, startSec);
    }, PRELOAD_DWELL_MS);
    return () => clearTimeout(t);
  }, [active, ready, startSec]);

  // Leaving the page for anything but the player releases a prepared decoder.
  useEffect(() => () => void (document.documentElement.classList.contains("avplay") || cancelPreload()), []);

  type ActionSpec = { id: "play" | "restart" | "sources" | "together" | "timeline" | "watched" | "mylist"; label: string };
  const actionSpecs: ActionSpec[] = [];

  // Resume carries its progress on the line above the buttons (resumeLabel); Start over sits beside it.
  const progress = startSec > 0 && resume ? resumeLabel(resume.posSec, resume.durSec) : "";
  const progressPct = progress && resume ? resume.posSec / resume.durSec : 0;
  if (series && !target) {
    actionSpecs.push({ id: "play", label: "No episodes" });
  } else {
    const what = series && target ? ` ${episodeLabel(target)}` : "";
    actionSpecs.push({ id: "play", label: `▶ ${startSec > 0 ? "Resume" : "Play"}${what}` });
    if (startSec > 0) actionSpecs.push({ id: "restart", label: "↺ Start over" });
  }

  actionSpecs.push({
    id: "sources",
    label: listed ? `☰ Sources (${listed.length}${ready ? "" : "…"})` : "☰ Sources",
  });

  if (party) actionSpecs.push({ id: "together", label: "👥 Watch together" });

  if (sagaCol) {
    actionSpecs.push({
      id: "timeline",
      label: `❖ Timeline (${sagaCol.steps.length})`,
    });
  }

  actionSpecs.push({
    id: "watched",
    label: watched ? "✓ Watched" : "☐ Mark Watched",
  });

  actionSpecs.push({ id: "mylist", label: saved ? "✓ My List" : "＋ My List" });

  const lengths = series ? [actionSpecs.length, seasons.length, episodes.length] : [actionSpecs.length];

  /** Plays `chosen` first (the top source when none), the rest of `list` after it for failover. */
  const play = (episode: Video | undefined, from: number, chosen?: Stream, list: Stream[] | null = ready, manual = false) => {
    if (!list || !list.length) return;
    // The rest follow in the order autoplay would try them, for failover.
    const ranked = rankSources(list, rules);
    const first = chosen ?? ranked[0];
    onPlay(meta, episode, [first, ...ranked.filter((s) => s !== first)], from, manual);
  };
  /**
   * Play, or Restart: always through lib/autoplay.ts, which answers at once when the sources are all in, so its rules
   * (Require among them) hold whether or not the search is over.
   */
  const requestPlay = (episode: Video | undefined, from: number) => {
    if (series && !episode) return;
    setPending({ episode, from });
  };

  // OK on a source acts when released: a short press plays it; the hold timer has already opened the card otherwise.
  useEffect(() => {
    if (!active || !sourcesOpen) return;
    const onUp = (e: KeyboardEvent) => {
      if (e.keyCode !== 13 || !holdTimer.current) return;
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      pickRef.current();
    };
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keyup", onUp);
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };
  }, [active, sourcesOpen]);

  useKeys(active, (key) => {
    if (partyCard != null && party) {
      if (key === "Left" || key === "Right") setPartyCard(key === "Left" ? 0 : 1);
      else if (key === "Back") setPartyCard(null);
      else if (key === "Enter") {
        setPartyCard(null);
        if (partyCard === 1) {
          const ok = getTvInputBridge().open("", { onCommit: (code) => code.trim() && party.join(code) });
          if (!ok) island.push({ key: "party", text: "The TV keyboard isn't available here", level: "error" });
          return;
        }
        if (series && !target) return;
        setPending({ episode: series ? target : undefined, from: startSec, together: true });
      }
      return;
    }
    if (sourcesOpen && detailsOf) {
      // The details card: Up and Down scroll it, OK or Back closes it.
      if (key === "Up" || key === "Down") setDetailsScroll((y) => Math.max(0, y + (key === "Down" ? 80 : -80)));
      else if (key === "Enter" || key === "Back" || key === "Info") setDetailsOf(null);
      return;
    }
    if (sourcesOpen) {
      // The chips row: Left and Right move along it, OK turns a chip on or off, Down goes back to the list.
      if (chipAt != null) {
        if (key === "Left" || key === "Right") setChipAt((c) => Math.max(0, Math.min(chips.length - 1, (c ?? 0) + (key === "Left" ? -1 : 1))));
        else if (key === "Down") setChipAt(null);
        else if (key === "Enter") {
          const f = chips[chipAt];
          setFilters((on) => {
            const next = new Set(on);
            if (!next.delete(f)) next.add(f);
            return next;
          });
          setSourceIdx(0);
        } else if (key === "Back") {
          setSourcesOpen(false);
          setSheetNote(null);
        }
        return;
      }
      // Left and Right move between provider tabs; Left on All closes the sheet, as before tabs.
      if (tabs.length && (key === "Right" || (key === "Left" && providerTab > 0))) {
        setProviderTab((t) => Math.max(0, Math.min(tabs.length, t + (key === "Right" ? 1 : -1))));
        setSourceIdx(0);
        return;
      }
      if (key === "Back" || key === "Left") {
        setSourcesOpen(false);
        setSheetNote(null);
        setDetailsOf(null);
        return;
      }
      if (key === "Up") {
        if (sourceIdx === 0 || !rowsAt.length) setChipAt(0);
        else setSourceIdx((idx) => Math.max(0, idx - 1));
        return;
      }
      if (key === "Down") {
        setSourceIdx((idx) => Math.min(Math.max(0, rowsAt.length - 1), idx + 1));
        return;
      }
      const at = sheetItems[rowsAt[sourceIdx]];
      const chosen = at?.kind === "row" ? at.stream : undefined;
      if (key === "Info" && chosen) {
        setDetailsScroll(0);
        setDetailsOf(chosen);
        return;
      }
      if (key === "Enter") {
        // Everything hidden by the chips: OK shows it all again.
        if (!chosen && hidden) {
          setFilters(new Set());
          return;
        }
        if (!chosen || holdTimer.current) return;
        // Acted on at release (the keyup listener below): held for 600 ms, it opens the details card instead.
        pickRef.current = () => {
          setSourcesOpen(false);
          // A pick by hand is remembered for the title at once (lib/sourcepref.ts).
          if (remember) sourcePrefs.remember("manual", title.id, chosen);
          play(series ? target : undefined, startSec, chosen, listed, true);
        };
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          setDetailsScroll(0);
          setDetailsOf(chosen);
        }, 600);
        return;
      }
      return false;
    }

    if (key === "Back") {
      if (pending) return void setPending(null);
      return void onBack();
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      let next = move(lengths, focus, key.toLowerCase() as Dir);
      if (next === focus) return;
      if (series && focus.row !== 1 && next.row === 1) {
        const idx = seasons.indexOf(shownSeason);
        if (idx >= 0) next = { row: 1, col: idx };
      }
      setFocus(next);
      if (series && next.row === 1) setSeason(seasons[next.col]);
      return;
    }
    if (key === "Enter") {
      if (focus.row === 0) {
        const act = actionSpecs[focus.col];
        if (!act) return;
        if (act.id === "sources") {
          setSourceIdx(0);
          setProviderTab(0);
          setFilters(new Set());
          setChipAt(null);
          setSheetNote(null);
          setSourcesOpen(true);
          return;
        }
        if (act.id === "together") return void setPartyCard(0);
        if (act.id === "timeline" && sagaCol) {
          onOpenTimeline(sagaCol, meta.id);
          return;
        }
        if (act.id === "watched") {
          const nextW = toggleTitleWatched(meta.id);
          setWatched(nextW);
          onWatchedChange();
          return;
        }
        if (act.id === "mylist") {
          setSaved(toggleLibrary(type, meta));
          // The home rows (My List) are rebuilt on the same signal as a watched change.
          onWatchedChange();
          return;
        }
        if (act.id === "restart") {
          requestPlay(series ? target : undefined, 0);
          return;
        }
        // act.id === "play"
        requestPlay(series ? target : undefined, startSec);
        return;
      }
      if (series && focus.row === 2) {
        const ep = episodes[focus.col];
        if (ep) requestPlay(ep, startSec);
      } else if (series) {
        requestPlay(target, startSec);
      }
      return;
    }
    return false;
  });

  const statusText =
    !targetId
      ? ""
      : pending
        ? `Starting when a good source is found${pluginProgress ? ` · ${pluginProgress}` : ""} · Back cancels`
        : found?.id !== targetId
          ? pluginsActive() && pluginProgress
            ? pluginProgress
            : "Hunting cached prey on your debrid…"
          : found.value === "none"
            ? "No cached prey in the tall grass"
            : found.value === "error"
              ? pluginsActive()
                ? "The plugins could not be reached"
                : "Server nest unreachable"
              : null;

  const [from, to] = windowOf(focus.row === 2 ? focus.col : 0, episodes.length, 2, 6);
  const shift = focus.row === 2 ? Math.max(0, focus.col - 1) * EP_STRIDE : 0;

  // The chips sit under the provider tabs, when there are tabs; the list starts under the chips.
  const chipsY = tabs.length ? 196 : 132;
  const listTop = chipsY + 62;

  // Seasons as a glass pill; many seasons get short labels so the pill still fits the page.
  const short = seasons.length > 6;
  const segW = Math.min(1760, seasons.length * (short ? 96 : 170));
  const seasonLabel = (s: number) => (s === 0 ? (short ? "SP" : "Specials") : short ? `S${s}` : `Season ${s}`);
  const info = series ? INFO_SERIES : INFO_MOVIE;
  // The sheet's lines (ui/sheet.ts): headers and sources, laid out top to bottom; only sources take focus.
  const ys: number[] = [];
  sheetItems.reduce((y, it) => (ys.push(y), y + (it.kind === "header" ? HEADER_STRIDE : SOURCE_STRIDE)), 0);
  const focusedAt = rowsAt[sourceIdx] ?? 0;
  const listShift = Math.max(0, (ys[focusedAt] ?? 0) - 3 * SOURCE_STRIDE);
  // A title can have a hundred sources: only the rows around the focused one are rendered.
  const [srcFrom, srcTo] = windowOf(focusedAt, sheetItems.length, 4, 8);
  /** "Example Provider (Source A + Source B)" to "Example", with its count, "…" while searching, or "failed". */
  const tabLabel = (p: ProviderStatus) =>
    `${shortName(p).split(/\s+/)[0]} ${p.state === "searching" ? "…" : p.state === "error" ? "failed" : p.count}`;

  return (
    <div class="detail-glass" style={active ? undefined : "display:none"}>
      <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={hero.frost ?? base.backdrop?.frost} class="det">
        <HeroLayers hero={hero} shade={base.shade} />
        <div class="det-clock">{clockText}</div>

        <Glass {...info} class="det-info">
          <span class="cat-kicker">
            {series
              ? `${type === "anime" ? "Anime" : "Series"} · ${seasons.length} season${seasons.length === 1 ? "" : "s"} · ${videos.length} episodes`
              : sagaCol
                ? `Film · ${sagaCol.title}`
                : "Film · Instant debrid stream"}
          </span>
          <h1>{meta.name}</h1>
          <div class="cat-meta">
            {[meta.rating && `IMDb ${meta.rating}`, meta.year, meta.runtime, meta.genre?.slice(0, 3).join(" · "), watched && "✓ Watched"]
              .filter(Boolean)
              .join("  ·  ")}
          </div>
          {meta.description && <p class={series ? "det-plot short" : "det-plot"}>{meta.description}</p>}
          {progress && (
            <div class="det-progress">
              <span class="det-progress-bar">
                <i style={{ transform: `scaleX(${progressPct})` }} />
              </span>
              <span>{progress}</span>
            </div>
          )}
          <div class="det-actions">
            {actionSpecs.map((act, i) => {
              const primary = act.id === "play";
              const foc = focus.row === 0 && i === focus.col && !sourcesOpen;
              return (
                <span key={act.id} class={`cat-btn${primary ? " is-primary" : ""}${foc ? " is-focus" : ""}`}>
                  {act.label}
                </span>
              );
            })}
          </div>
          <div class="det-will">
            {ready && topParsed ? (
              <>
                <span class="det-will-k">Will play</span>
                {topParsed.badges.map((b) => (
                  <span key={b} class="det-badge">
                    {b}
                  </span>
                ))}
                {topParsed.size && <span>{topParsed.size}</span>}
                <span class="det-will-dim">
                  ⚡ cached · {ready.length} source{ready.length === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              <>
                <span class="det-will-k">Stream</span>
                <span class="det-will-dim">{statusText}</span>
              </>
            )}
          </div>
        </Glass>

        {series && seasons.length > 0 && (
          <Segmented
            x={PAD}
            y={SEASONS_Y}
            w={segW}
            h={64}
            items={seasons.map(seasonLabel)}
            picked={Math.max(0, seasons.indexOf(shownSeason))}
            focusIndex={focus.row === 1 && !sourcesOpen ? focus.col : -1}
          />
        )}

        {series && (
          <div class="sg-clip" style={{ left: "0px", top: `${EPS_Y - 20}px`, width: "1920px", height: `${EP_H + 110}px` }}>
            <div class="sg-scroll" style={{ transform: `translate3d(${PAD - shift}px,20px,0)` }}>
              {episodes.slice(from, to).map((v, k) => {
                const c = from + k;
                const aired = hasAired(v);
                return (
                  <div key={v.id} class={`det-ep${aired ? "" : " is-soon"}`} style={{ left: `${c * EP_STRIDE}px` }}>
                    <MediaTile
                      x={0}
                      y={0}
                      w={EP_W}
                      h={EP_H}
                      src={v.thumbnail ?? artSrc}
                      badge={aired ? episodeLabel(v) : `${episodeLabel(v)} · soon`}
                      progress={resume?.episode?.id === v.id && resume.durSec > 0 ? resume.posSec / resume.durSec : undefined}
                      focused={focus.row === 2 && c === focus.col && !sourcesOpen}
                    />
                    <span class="det-ep-name">{v.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sourcesOpen && (
          <>
            <div class="det-scrim" />
            <Glass {...SHEET} class="det-sheet">
              <span class="cat-kicker">
                {sheetNote ?? `Sources · ${series && target ? `${episodeLabel(target)} ${target.name}` : meta.name}`}
              </span>
              <h2>
                {listed
                  ? `${listed.length} source${listed.length === 1 ? "" : "s"}${searching ? " so far" : ""}${
                      hidden ? ` · ${hidden} hidden by ${[...filters].map(filterLabel).join(", ")}` : ""
                    }`
                  : statusText || "Resolving sources…"}
              </h2>
              {tabs.length > 0 && !detailsOf && (
                <Segmented
                  x={30}
                  y={132}
                  w={SHEET.w - 60}
                  h={56}
                  class="det-tabs"
                  items={["All", ...tabs.map(tabLabel)]}
                  picked={providerTab}
                  focusIndex={-1}
                />
              )}
              {listed && !detailsOf && (
                <Segmented
                  x={30}
                  y={chipsY}
                  w={SHEET.w - 60}
                  h={48}
                  class="det-chips"
                  items={chips.map((f) => `${filters.has(f) ? "✓ " : ""}${filterLabel(f)}`)}
                  picked={-1}
                  focusIndex={chipAt ?? -1}
                />
              )}
              {shown && !shown.length && hidden > 0 && (
                <div class="det-sec" style={{ left: "36px", top: `${listTop}px` }}>
                  All hidden by the filters · OK shows all
                </div>
              )}
              {shown && !detailsOf && (
                <div
                  class="sg-clip"
                  style={{ left: "0px", top: `${listTop - 10}px`, width: `${SHEET.w}px`, height: `${SHEET.h - listTop}px` }}
                >
                  <div class="sg-scroll" style={{ transform: `translate3d(30px,${10 - listShift}px,0)` }}>
                    {sheetItems.slice(srcFrom, srcTo).map((it, k) => {
                      const idx = srcFrom + k;
                      if (it.kind === "header") {
                        return (
                          <div key={it.key} class="det-sec" style={{ top: `${ys[idx]}px` }}>
                            {it.label}
                          </div>
                        );
                      }
                      const st = it.stream;
                      const p = parsedShown.get(st)!;
                      const failed = failedOf(st);
                      const tags = `${isVerified(st) ? "✔ " : ""}${p.badges.join(" · ")}${p.badges.length ? " · " : ""}${st === best ? "Auto-picked" : st.name}`;
                      return (
                        <ListCard
                          key={it.key}
                          x={0}
                          y={ys[idx]}
                          w={SHEET.w - 60}
                          h={SOURCE_H}
                          frost={false}
                          title={p.cleanTitle}
                          sub={
                            st.notice
                              ? "ⓘ A message from the provider, not a film"
                              : failed
                                ? `⚠ Failed ${ago(Date.now() - failed.at)} · ${failed.reason}`
                                : st === previous
                                  ? `★ Your previous choice · ${tags}`
                                  : tags
                          }
                          meta={st.notice ? "Notice" : (p.size ?? "Cached")}
                          color={st === best ? "var(--accent, #ff5a26)" : undefined}
                          focused={idx === focusedAt && chipAt == null}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
              {detailsOf && <SourceDetails stream={detailsOf} providers={pluginStatus} languages={langOf(detailsOf)} scroll={detailsScroll} />}
            </Glass>
          </>
        )}
        {partyCard != null && (
          <Glass x={PAD} y={700} w={1060} h={300} class="pty-card">
            <span class="cat-kicker">Watch together</span>
            <h2>{series && target ? `${meta.name} · ${episodeLabel(target)}` : meta.name}</h2>
            <p>
              Start a party and share its code: every TV plays the same release from its own debrid account, with play,
              pause and seek shared. Or join a friend's party with the code their TV shows.
            </p>
            <div class="pty-actions">
              {["Start a party", "Join with a code"].map((label, i) => (
                <span key={label} class={`cat-btn${i === 0 ? " is-primary" : ""}${partyCard === i ? " is-focus" : ""}`}>
                  {label}
                </span>
              ))}
            </div>
          </Glass>
        )}
      </GlassRoot>
    </div>
  );
}
