import { type Dir, type Focus, getTvInputBridge, move, useKeys, windowOf } from "@secretary/tv-kit";
import {
  ButtonRow,
  Glass,
  GlassRoot,
  Header,
  type HeaderAt,
  headerStart,
  Kicker,
  LANDSCAPE,
  LandscapeTile,
  ListCard,
  POSTER,
  PosterTile,
  RowLabel,
  Scroller,
  Segmented,
  stepHeader,
  Tabs,
} from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { fetchMeta, fetchRow, mergeMeta, pickSimilar, posterUrl, ratingLabel, similarUrl } from "../lib/cinemeta.ts";
import { cachedTitleArt, titleArt } from "../lib/fanart.ts";
import { searchSummary } from "../lib/searchsummary.ts";
import { LoadingScreen } from "./Loading.tsx";
import {
  type SagaDef,
  fetchTmdbCollection,
  findSagaForTitle,
} from "../lib/sagas.ts";
import { defaultEpisode, episodeLabel, episodesOf, fileHintFor, hasAired, seasonsOf } from "../lib/episodes.ts";
import { inLibrary, toggleLibrary } from "../lib/library.ts";
import {
  episodeKey,
  isTitleWatched,
  markEpisodesWatched,
  type ResumeEntry,
  resumeLabel,
  resumeStart,
  toggleTitleWatched,
  watchedEpisodes,
} from "../lib/resume.ts";
import { audioLangsOf, type ClockFormat, type SpoilerMode, subLangsOf } from "../lib/settings.ts";
import type { HostHeader } from "../host.ts";
import { aboutFacts, creditLines, type EpisodeLook, episodeLook, episodePanel, episodeTag, factLine, seasonsLabel, type SpoilerState } from "../lib/titlepage.ts";
import { BLANK, blurredStill, blurredText, readableStill } from "./stillblur.ts";
import type { ProviderStatus } from "@secretary/plugins";
import { decide, type StartAfter, waitMs } from "../lib/autoplay.ts";
import { releaseOf } from "../lib/party.ts";
import { ago } from "../lib/failures.ts";
import { onPluginStatus, pluginStore, pluginsActive, shortName } from "../lib/plugins.ts";
import { compilePattern, pickIndex, rankSources, type Rules } from "../lib/rules.ts";
import { matchPref } from "../lib/sourcepref.ts";
import { type MenuLine, stepTitleMenu, type TitleAction, titleMenu } from "../lib/titlemenu.ts";
import { deviceCapSet } from "../lib/device.ts";
import { parseStreamInfo, type Stream, type StreamClient } from "../lib/streams.ts";
import { kindFor, typeLabel } from "../lib/animeguard.ts";
import { type CatalogType, isSeries, streamType, type Title, type Video } from "../lib/types.ts";
import { cancelPreload, deadLinks, preload, prepareAheadEnabled, sourcePrefs } from "../player/session.ts";
import { HeroLayers, TitleMark, useBase, useHeroArt, useLogo } from "./art.tsx";
import { island } from "./Island.tsx";
import { applyFilters, type Filter, filterChips, filterLabel, focusable, isVerified, type SheetOrder, sheetRows, sourceLanguages } from "./sheet.ts";
import "./detail.css";
import "./party.css";

const PRELOAD_DWELL_MS = 1000;
/** Browsing episodes should not look up streams for every card passed over. */
const EPISODE_DWELL_MS = 400;
/** The longest the page stays veiled waiting for its art and frost; after it, what is ready shows and the rest fades in. */
const REVEAL_CAP_MS = 900;
/** The veil's fade (detail.css .det-veil) and the loading screen's (.det-loading.is-out). */
const VEIL_FADE_MS = 360;
const LOADER_OUT_MS = 320;
const PAD = 80;
/** Episodes are the home row's landscape tiles (tv-kit pieces), the title on the art. */
const EP_STRIDE = LANDSCAPE.w + LANDSCAPE.gap;
/**
 * The caption, straight on the art as on the catalog home's hero (no panel), under the collapsed header (the clock
 * alone, top right). It is anchored by its foot, just over what comes under it (a film's "More like this", a show's
 * seasons), and every line in it keeps its height, so nothing moves as focus does. The mark is the title's logo, else
 * its name in the display face.
 */
const CAPTION_MOVIE = { x: PAD, foot: 772, w: 1060, mark: { w: 720, h: 160 }, name: { w: 1060, h: 200 } };
// A logo keeps its box; a show's name without one wraps to two lines across the caption rather than being cut.
const CAPTION_SERIES = { x: PAD, foot: 612, w: 1060, mark: { w: 600, h: 110 }, name: { w: 1060, h: 180 } };
/** The synopsis' lines, as `.det-about` sets them (detail.css): the blurred copy (Blur) is laid out the same. */
const ABOUT_SERIES = { lines: 2, lineH: 39 };
const ABOUT_MOVIE = { lines: 3, lineH: 39 };
const SEASONS_Y = 636;
const EPS_Y = 728;
/** How long the page waits for a title's details before it shows what it has. */
const META_WAIT_MS = 6000;
/** "More like this" under a film's panel: a row label, then the home row's posters, smaller. */
const SIM_SCALE = 0.6;
const SIM = { labelY: 792, y: 836, stride: Math.round((POSTER.w + POSTER.gap) * SIM_SCALE) };
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
  /** Secretary's header (host.ts): drawn collapsed to the clock, expanded by Up from the top of the page. */
  header?: HostHeader;
  /** Settings › Watching "Spoiler protection": unwatched episodes' stills and synopses blurred or left out (lib/titlepage.ts). */
  spoilerProtection?: SpoilerMode;
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
  /** A title of "More like this": its own page opens (Back comes back here). */
  onOpenTitle?(title: Title): void;
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
      <span class="cat-kicker det-details-k">Source details</span>
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

/**
 * One episode, as the home row's landscape tiles: the still with the title and its place on the art. Spoiler protection
 * on an unwatched episode (lib/titlepage.ts `episodeLook`): Blur swaps the still for its pre-blurred copy
 * (ui/stillblur.ts), Hide shows no still at all; the number and the title always stay.
 */
function EpisodeTile({
  x,
  v,
  fallback,
  look,
  progress,
  watched,
  focused,
}: {
  x: number;
  v: Video;
  fallback: string;
  look: EpisodeLook;
  progress?: number;
  watched: boolean;
  focused: boolean;
}) {
  // The show's own art is no spoiler: an episode without a still shows it under Blur; Hide shows no picture at all.
  const src = v.thumbnail ?? fallback;
  const blur = look === "blur" && Boolean(v.thumbnail);
  const [shown, setShown] = useState(() => (look === "hide" || blur ? BLANK : src));
  useEffect(() => {
    if (look === "hide") return void setShown(BLANK);
    let live = true;
    if (!blur) {
      // The title sits on the still: its readable copy (darkened under the title, made once), the still until then.
      setShown(src);
      if (v.thumbnail) readableStill(src).then((u) => live && setShown(u), () => {});
      return () => {
        live = false;
      };
    }
    setShown(BLANK);
    blurredStill(src).then(
      (u) => live && setShown(u),
      () => live && setShown(BLANK),
    );
    return () => {
      live = false;
    };
  }, [src, blur, look]);
  const aired = hasAired(v);
  return (
    <LandscapeTile
      x={x}
      y={0}
      src={shown}
      title={v.name}
      sub={aired ? episodeTag(v) : `${episodeTag(v)} · soon`}
      progress={progress}
      watched={watched}
      focused={focused}
      class={`det-ep${aired ? "" : " is-soon"}${look === "clear" ? "" : ` is-${look}`}`}
    />
  );
}

/**
 * A protected synopsis under Blur: its blurred picture (ui/stillblur.ts `blurredText`), laid out as the caption sets
 * text, with soft bars in its place until it is made (or if it cannot be).
 */
function BlurredAbout({ text, w, lines, lineH }: { text: string; w: number; lines: number; lineH: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    const face = getComputedStyle(document.documentElement).getPropertyValue("--sg-font-body").trim() || "sans-serif";
    blurredText(text, { w, lines, lineH, font: `${Math.round(lineH / 1.38)}px ${face}`, color: "rgba(244,244,246,0.85)" }).then(
      (u) => live && setSrc(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [text, w, lines, lineH]);
  return (
    <div class="det-about det-redact" style={{ height: `${lines * lineH}px` }}>
      {src ? <img class="det-redact-img" src={src} alt="" /> : Array.from({ length: lines }, (_, i) => <i key={i} />)}
    </div>
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
  header,
  spoilerProtection = "off",
  startAfter = "5",
  limits,
  remember = true,
  sheetOrder = "grouped",
  onPlay,
  party,
  onOpenTimeline,
  onOpenTitle,
  onWatchedChange,
  onBack,
}: Props) {
  const [meta, setMeta] = useState<Title>(title);
  const [metaState, setMetaState] = useState<"loading" | "done" | "failed">("loading");
  // The page waits for the title's own details (seasons, episodes, runtime) so it never shows them at 0 and then jumps;
  // a slow catalog is waited for only so long.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), META_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  // Opened to play (Continue watching): the page never shows, only the loading screen until the player takes over.
  const [autoFailed, setAutoFailed] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  // Sources found so far while plugins are still answering; `found` is the final list.
  const [partial, setPartial] = useState<{ id: string; value: Stream[] } | null>(null);
  // Where each plugin stands (lib/plugins.ts): the status line while sources load, and the sheet's provider tabs.
  const [pluginStatus, setPluginStatus] = useState<ProviderStatus[]>([]);
  useEffect(() => onPluginStatus(setPluginStatus), []);
  const pluginStatusNow = useRef<ProviderStatus[]>([]);
  pluginStatusNow.current = pluginStatus;
  const pluginProgress = searchSummary(pluginStatus);
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
  // The context menu (a long OK on an action or an episode): its lines and the focused one.
  const [ctx, setCtx] = useState<{ lines: MenuLine[]; at: number } | null>(null);
  /** The press that opened the menu is still down: its keydowns are not a choice in the menu. */
  const ctxHolding = useRef(false);
  // Play pressed (or autoplay asked) before the sources are all in: decided by lib/autoplay.ts as they arrive.
  const [pending, setPending] = useState<{ episode: Video | undefined; from: number; together?: boolean } | null>(null);
  const waiting = (metaState === "loading" && !gaveUp) || (Boolean(autoPlay) && !autoFailed && !(gaveUp && !pending));
  // The Watch together card: start a party or type a code (focus 0 or 1), null when closed.
  const [partyCard, setPartyCard] = useState<number | null>(null);
  const searchStarted = useRef(0);
  const [tick, setTick] = useState(0);
  const lastWait = useRef("");
  // Why the sheet opened by itself, shown in its heading until it closes.
  const [sheetNote, setSheetNote] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>({ row: 0, col: 0 });
  // The header has the remote (Up from the top of the page): it is drawn expanded, else collapsed to the clock.
  const [head, setHead] = useState<HeaderAt | null>(null);
  useEffect(() => {
    if (!active) setHead(null);
  }, [active]);
  const [autoPlayed, setAutoPlayed] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // A film's About panel (its action, or Info): the whole synopsis and everything the metadata says about it.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [watched, setWatched] = useState<boolean>(() => isTitleWatched(title.id));
  // Episodes watched to the end (`season:episode`): their tiles carry a tick, and "up next" skips them.
  const [epWatched, setEpWatched] = useState<ReadonlySet<string>>(() => watchedEpisodes(title.id));
  /** The viewer has moved focus: the page no longer puts it on the up-next episode by itself. */
  const moved = useRef(false);
  const [saved, setSaved] = useState<boolean>(() => inLibrary(type, title.id));
  const [clockText, setClockText] = useState(() => formatClock(clockFormat));
  // The page shows itself once, whole: a veil in the page's base colour stays until the details, the art and its frost
  // are in (or REVEAL_CAP_MS has passed), then fades out. What comes later fades in on its own, never snaps.
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCapped(true), REVEAL_CAP_MS);
    return () => clearTimeout(t);
  }, []);
  // The loading screen fades out rather than vanishing (LOADER_OUT_MS).
  const [loaderOut, setLoaderOut] = useState(false);
  const [sagaCol, setSagaCol] = useState<SagaDef | undefined>(() =>
    findSagaForTitle(title.id, type),
  );

  const series = isSeries(type);
  // The title's full-size art (lib/fanart.ts): the cache's at once, the lookup's if it answers before the art is up.
  const [art, setArt] = useState(() => cachedTitleArt(type, title, "hero"));
  useEffect(() => {
    let live = true;
    void titleArt(type, meta, "hero").then((a) => live && setArt(a));
    return () => {
      live = false;
    };
  }, [type, meta.id, meta.background, meta.logo]);
  const artSrc = art.background;
  const base = useBase(type);
  // One title on a page that does not move: its art, its readable copy and its frost go up at once, under the veil.
  const hero = useHeroArt(meta.id, artSrc, active, true, 0, true);
  const logo = useLogo(type, meta);
  const videos = meta.videos ?? [];

  const seasons = useMemo(() => seasonsOf(videos), [videos]);
  const start = useMemo(() => defaultEpisode(videos, resume?.episode?.id, Date.now(), epWatched), [videos, resume?.episode?.id, epWatched]);
  const [season, setSeason] = useState<number | null>(null);
  const shownSeason = season ?? start?.season ?? seasons[0] ?? 1;
  const episodes = useMemo(() => episodesOf(videos, shownSeason), [videos, shownSeason]);

  // The title or episode Play would start, which the stream lookup and prepare-ahead follow.
  const focused = series && focus.row === 2 ? episodes[focus.col] : undefined;
  /** Where focus lands in a season's episodes: the up-next one when it is in there, else its first aired unwatched one. */
  const upNextIn = (eps: readonly Video[]): number => {
    const at = start ? eps.findIndex((v) => v.id === start.id) : -1;
    if (at >= 0) return at;
    return Math.max(0, eps.findIndex((v) => hasAired(v) && !epWatched.has(episodeKey(v))));
  };
  // Focus resting on the up-next episode (where the page opens) searches at once; another episode waits for the dwell.
  const dwell = !!focused && focused.id !== start?.id;
  const target: Video | undefined = series ? (focused ?? start ?? undefined) : undefined;
  const targetId = series ? target?.id : title.id;
  const resumeHere = !!resume && (series ? resume.episode?.id === target?.id : true);
  const startSec = resumeHere && resume ? resumeStart(resume.posSec, resume.durSec) : 0;

  const revealed = capped || ((metaState !== "loading" || gaveUp) && hero.settled && logo.settled);
  const [veilGone, setVeilGone] = useState(false);
  useEffect(() => {
    if (!revealed || veilGone) return;
    const t = setTimeout(() => setVeilGone(true), VEIL_FADE_MS + 60);
    return () => clearTimeout(t);
  }, [revealed]);
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting) {
      setLoaderOut(true);
      const t = setTimeout(() => setLoaderOut(false), LOADER_OUT_MS);
      wasWaiting.current = waiting;
      return () => clearTimeout(t);
    }
    wasWaiting.current = waiting;
  }, [waiting]);

  useEffect(() => {
    setClockText(formatClock(clockFormat));
    const t = setInterval(() => setClockText(formatClock(clockFormat)), 30_000);
    return () => clearInterval(t);
  }, [clockFormat]);

  useEffect(() => {
    if (active) {
      setWatched(isTitleWatched(title.id));
      setEpWatched(watchedEpisodes(title.id));
      setSaved(inLibrary(type, title.id));
    }
  }, [active, title.id]);

  // A series opens on its up-next episode, once the episodes are known, unless the viewer has already moved.
  useEffect(() => {
    if (!series || moved.current || !start) return;
    const col = episodes.findIndex((v) => v.id === start.id);
    if (col >= 0) setFocus({ row: 2, col });
  }, [series, start?.id, episodes]);

  useEffect(() => {
    let live = true;
    const curated = findSagaForTitle(title.id, type);
    setSagaCol(curated);

    fetchMeta(type, title.id).then(
      (m) => {
        if (!live) return;
        if (!m) return setMetaState("failed");
        setMeta(mergeMeta(title, m));
        setMetaState("done");
        if (!curated && m.tmdbCollection?.id) {
          void fetchTmdbCollection(m.tmdbCollection.id, m.tmdbCollection.name).then((dynCol) => {
            if (live && dynCol) setSagaCol(dynCol);
          });
        }
      },
      () => live && setMetaState("failed"),
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
        const yearNum = Number(/\d{4}/.exec(title.year)?.[0]);
        const hint = {
          ...(target ? fileHintFor(target) : undefined),
          ...(yearNum ? { year: yearNum } : {}),
          anime: kindFor(title.catalogType ?? type, title) === "anime",
        };
        stop = streams.watch(targetId, hint, streamType(type), (s, done) => {
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
      dwell ? EPISODE_DWELL_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
      stop();
    };
  }, [type, targetId, dwell]);

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
      title: { name: title.name, year: title.year },
    };
  }, [title.name, title.year, limits?.maxSizeGb, limits?.minSizeGb, limits?.require, limits?.prefer, limits?.audioLangs, limits?.subLangs, providerOrder, failedOf]);
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
    if ("sheet" in d || "none" in d || !listed) setAutoFailed(true);
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

  type ActionSpec = { id: "play" | "restart" | "sources" | "together" | "timeline" | "watched" | "mylist" | "about"; label: string };
  const actionSpecs: ActionSpec[] = [];

  // Resume carries its progress on the line above the buttons (resumeLabel); Start over sits beside it.
  const progress = startSec > 0 && resume ? resumeLabel(resume.posSec, resume.durSec) : "";
  const progressPct = progress && resume ? resume.posSec / resume.durSec : 0;
  if (series && !target) {
    actionSpecs.push({ id: "play", label: "No episodes" });
  } else {
    const what = series && target ? ` ${episodeLabel(target)}` : "";
    actionSpecs.push({ id: "play", label: `${startSec > 0 ? "Resume" : "Play"}${what}` });
    if (startSec > 0) actionSpecs.push({ id: "restart", label: "Start over" });
  }

  // One label whatever the search finds, so the row never reflows: the count is on the line under the buttons.
  actionSpecs.push({ id: "sources", label: "Sources" });

  if (party) actionSpecs.push({ id: "together", label: "Watch together" });

  actionSpecs.push({ id: "watched", label: watched ? "✓ Watched" : "Mark watched" });

  actionSpecs.push({ id: "mylist", label: saved ? "✓ My List" : "My List" });

  // A film's page says more than its caption has room for: the whole synopsis, the writers, the full cast.
  if (!series) actionSpecs.push({ id: "about", label: "About" });

  // Last, since the saga lookup can answer after the page is up: arriving, it never pushes the other pills along.
  if (sagaCol) {
    actionSpecs.push({
      id: "timeline",
      label: `Timeline (${sagaCol.steps.length})`,
    });
  }

  // "More like this": titles of the film's first genre, a row under the panel (Down from the actions).
  const [similar, setSimilar] = useState<Title[]>([]);
  const genre0 = meta.genre?.[0];
  useEffect(() => {
    if (series || !genre0) return setSimilar([]);
    let live = true;
    fetchRow(similarUrl(type, genre0)).then(
      (l) => live && setSimilar(pickSimilar(l, meta.id)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [type, genre0, meta.id, series]);

  // The actions row scrolls when its buttons are wider than the panel: one read of the focused button's box per move.
  const actionsRun = useRef<HTMLDivElement>(null);
  const [actShift, setActShift] = useState(0);
  const actAt = focus.row === 0 ? focus.col : 0;
  const actKey = actionSpecs.map((a) => a.label).join("|");
  useLayoutEffect(() => {
    const run = actionsRun.current;
    const b = run?.querySelectorAll<HTMLElement>(".sg-btn")[actAt];
    if (!run || !b) return;
    const view = run.parentElement?.clientWidth ?? 0;
    let at = actShift;
    if (b.offsetLeft < at) at = b.offsetLeft;
    if (b.offsetLeft + b.offsetWidth - at > view) at = b.offsetLeft + b.offsetWidth - view;
    if (at !== actShift) setActShift(Math.max(0, at));
  }, [actAt, actKey]);

  const lengths = series ? [actionSpecs.length, seasons.length, episodes.length] : similar.length ? [actionSpecs.length, similar.length] : [actionSpecs.length];

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

  /** An action, from its button or the context menu. */
  const runAction = (id: TitleAction) => {
    if (id === "sources") {
      setSourceIdx(0);
      setProviderTab(0);
      setFilters(new Set());
      setChipAt(null);
      setSheetNote(null);
      setSourcesOpen(true);
    } else if (id === "timeline") {
      if (sagaCol) onOpenTimeline(sagaCol, meta.id);
    } else if (id === "watched") {
      const now = toggleTitleWatched(meta.id);
      setWatched(now);
      // A whole series marked (or cleared) marks every aired episode with it.
      if (series) {
        markEpisodesWatched(meta.id, videos.filter((v) => hasAired(v)), now);
        setEpWatched(watchedEpisodes(meta.id));
      }
      onWatchedChange();
    } else if (id === "mylist") {
      setSaved(toggleLibrary(type, meta));
      // The home rows (My List) are rebuilt on the same signal as a watched change.
      onWatchedChange();
    } else if (id === "restart") requestPlay(series ? target : undefined, 0);
    else requestPlay(series ? target : undefined, startSec);
  };

  // OK on an action, an episode or a source acts when released: a short press does it; held for 600 ms the timer has
  // already opened the context menu (actions, episodes) or the details card (sources) instead.
  useEffect(() => {
    if (!active) return;
    const onUp = (e: KeyboardEvent) => {
      if (e.keyCode !== 13) return;
      ctxHolding.current = false;
      if (!holdTimer.current) return;
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
  }, [active]);

  useKeys(active, (key) => {
    // The context menu takes every key while it is open.
    if (ctx) {
      if (key === "Enter" && ctxHolding.current) return;
      const r = stepTitleMenu(ctx.at, ctx.lines.length, key);
      if (r === "close") setCtx(null);
      else if (r === "run") {
        const line = ctx.lines[ctx.at];
        setCtx(null);
        if (line) runAction(line.id);
      } else setCtx({ ...ctx, at: r });
      return;
    }
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
    // The About panel only reads: any of these closes it.
    if (aboutOpen) {
      if (key === "Back" || key === "Enter" || key === "Info") setAboutOpen(false);
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

    // The header: Left and Right along it, OK acts (Secretary does), Down collapses it again. Back leaves the page in
    // one press, as it does with the header collapsed.
    if (head != null) {
      if (key === "Enter") return void header?.press(head);
      if (key === "Back") {
        setHead(null);
        return void onBack();
      }
      const r = stepHeader(head, key, Boolean(header?.person), header?.buttons.length ?? 0);
      setHead(r === "leave" ? null : r);
      return;
    }
    if (key === "Back") {
      if (pending) return void setPending(null);
      return void onBack();
    }
    if (key === "Info" && !series) return void setAboutOpen(true);
    if (key === "Up" && focus.row === 0) {
      const at = header ? headerStart(Boolean(header.person), header.buttons.length) : null;
      if (at != null) setHead(at);
      return;
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      let next = move(lengths, focus, key.toLowerCase() as Dir);
      if (next === focus) return;
      moved.current = true;
      if (series && focus.row !== 1 && next.row === 1) {
        const idx = seasons.indexOf(shownSeason);
        if (idx >= 0) next = { row: 1, col: idx };
      }
      // Down from the seasons lands on that season's up-next episode, not under the season pill.
      if (series && focus.row === 1 && next.row === 2) next = { row: 2, col: upNextIn(episodes) };
      setFocus(next);
      if (series && next.row === 1) setSeason(seasons[next.col]);
      return;
    }
    if (key === "Enter" && !series && focus.row === 1) {
      const t = similar[focus.col];
      if (t) onOpenTitle?.({ ...t, catalogType: type });
      return;
    }
    if (key === "Enter") {
      // What a short press does, run on release (the keyup listener above) so a long press can open the context menu.
      const enter = () => {
        if (focus.row === 0) {
          const act = actionSpecs[focus.col];
          if (!act) return;
          if (act.id === "together") return void setPartyCard(0);
          if (act.id === "about") return void setAboutOpen(true);
          return runAction(act.id);
        }
        if (series && focus.row === 2) {
          const ep = episodes[focus.col];
          if (ep) requestPlay(ep, startSec);
        } else if (series) {
          requestPlay(target, startSec);
        }
      };
      if (holdTimer.current || ctxHolding.current) return;
      pickRef.current = enter;
      // Seasons just act; actions and episodes wait for the release: held for 600 ms they open their menu.
      if (focus.row === 1 || (focus.row === 0 && actionSpecs[focus.col]?.id === "together")) return void enter();
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        ctxHolding.current = true;
        setCtx({
          at: 0,
          lines: titleMenu({
            series,
            episode: series && focus.row === 2 && target ? episodeLabel(target) : undefined,
            hasProgress: startSec > 0,
            watched,
            saved,
            saga: !!sagaCol,
          }),
        });
      }, 600);
      return;
    }
    return false;
  });

  const statusText =
    !targetId
      ? ""
      : pending
        ? `Starting when a good source is found${pluginProgress ? ` · ${pluginProgress}` : ""}`
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

  // Seasons as tabs (tv-kit pieces): one width each, the row scrolls to keep the focused one in view.
  const seasonLabel = (s: number) => (s === 0 ? "Specials" : `Season ${s}`);
  const cap = series ? CAPTION_SERIES : CAPTION_MOVIE;
  const aboutBox = series ? ABOUT_SERIES : ABOUT_MOVIE;
  // A show's caption follows the focused episode (else the one Play would start) under the show's mark; a film's is the film's.
  const spoilers: SpoilerState = { mode: spoilerProtection, watched: epWatched, resumeId: resume?.episode?.id, titleWatched: watched };
  const panel = series && target ? episodePanel(meta, target, spoilers) : null;
  const look: EpisodeLook = series && target ? episodeLook(target, spoilers) : "clear";
  const credits = series ? [] : creditLines(meta);
  const facts = series ? "" : factLine(meta, sagaCol?.title);
  const kind = typeLabel(type, meta);
  const seasonsText = seasonsLabel(videos);
  const kicker = series
    ? [kind === "Anime" ? "Anime" : "Show", seasonsText].filter(Boolean).join(" · ")
    : sagaCol
      ? `Film · ${sagaCol.title}`
      : kind === "Anime" ? "Anime film" : "Film";
  // A show's progress is the focused episode's, in its line; a film's has its own bar over the buttons.
  const metaLine = (
    panel
      ? [...panel.meta.slice(1), progress, target && epWatched.has(episodeKey(target)) ? "✓ Watched" : ""]
      : [ratingLabel(meta.rating), meta.year, meta.runtime, meta.genre?.slice(0, 3).join(", "), watched && "✓ Watched"]
  ).filter((x): x is string => Boolean(x));
  const about = panel ? (panel.hidden ? undefined : panel.about) : meta.description;
  const aboutEmpty = !about && !panel?.hidden ? (metaState === "loading" ? "Loading synopsis…" : "No synopsis for this title.") : undefined;
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
    <div class={`detail-glass${waiting ? " is-waiting" : ""}`} style={active ? undefined : "display:none"}>
      <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={hero.frost ?? base.backdrop?.frost} class={`det${series ? " is-series" : ""}`}>
        <HeroLayers hero={hero} shade={base.shade} />
        {/* Secretary's one header (host.ts): the clock alone, top right, so the art stays clear; Up expands it. */}
        <Header time={header?.time ?? clockText} expanded={head != null} person={header?.person} buttons={header?.buttons ?? []} focus={head} />
        {(waiting || loaderOut) && (
          <div class={`det-loading${waiting ? "" : " is-out"}`}>
            <LoadingScreen
              heading={series && target && autoPlay ? `${meta.name} · ${episodeLabel(target)} ${target.name}` : meta.name}
              status={pending && pluginProgress ? pluginProgress : "Spreading wings…"}
              bar="loading"
            />
          </div>
        )}

        {/* The caption, on the art's readable copy (art.tsx), anchored by its foot; every line keeps its height. */}
        <div class="det-caption" style={{ left: `${cap.x}px`, bottom: `${1080 - cap.foot}px`, width: `${cap.w}px` }}>
          <Kicker>{kicker}</Kicker>
          <TitleMark name={meta.name} logo={logo.src} {...(logo.src ? cap.mark : cap.name)} shrink class={`det-mark${series ? " is-small" : ""}`} />
          {series && (
            <b class="det-ep-name">
              {target && <span class="det-ep-tag">{episodeTag(target)}</span>}
              {panel?.title ?? (seasons.length ? "" : "No episodes yet")}
            </b>
          )}
          <small class="det-meta">{metaLine.join(" · ") || " "}</small>
          {panel?.hidden && look === "blur" && panel.about ? (
            <BlurredAbout text={panel.about} w={cap.w} lines={aboutBox.lines} lineH={aboutBox.lineH} />
          ) : (
            // Hide leaves the synopsis out; its room stays, so the buttons never move between episodes.
            <p class="det-about" style={{ WebkitLineClamp: aboutBox.lines, height: `${aboutBox.lines * aboutBox.lineH}px` }}>
              {panel?.hidden ? "" : (about ?? aboutEmpty)}
            </p>
          )}
          {credits.length > 0 && (
            // Director and cast on one line, the director first: the caption keeps to the left of the art.
            <small class="det-credit">
              {credits.map((c) => (
                <span key={c.label}>
                  <em>{c.label}</em>
                  {c.names}
                </span>
              ))}
            </small>
          )}
          {!series && facts && <small class="det-credit det-fact">{facts}</small>}
          {progress && !series && (
            <div class="det-progress">
              <span class="det-progress-bar">
                <i style={{ transform: `scaleX(${progressPct})` }} />
              </span>
              <span>{progress}</span>
            </div>
          )}
          {/* One row of buttons, scrolled by transform to keep the focused one in view when they outrun the caption. */}
          <div class="det-actions">
            <div ref={actionsRun} class="det-actions-run" style={{ transform: `translate3d(${-actShift}px,0,0)` }}>
              <ButtonRow
                items={actionSpecs.map((a) => ({ id: a.id, label: a.label, primary: a.id === "play", icon: a.id === "together" ? ("party" as const) : undefined }))}
                focusIndex={focus.row === 0 && head == null && !sourcesOpen && !ctx ? focus.col : -1}
              />
            </div>
          </div>
          <div class="det-will" key={ready && topParsed ? "will" : "status"}>
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
                  cached · {ready.length} source{ready.length === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              <>
                <span class="det-will-k">Sources</span>
                <span class="det-will-dim">{statusText}</span>
              </>
            )}
          </div>
        </div>

        {!series && similar.length > 0 && (
          <>
            <RowLabel x={PAD} y={SIM.labelY} label="More like this" count={similar.length} />
            <div class="sg-clip" style={{ left: "0px", top: `${SIM.y - 20}px`, width: "1920px", height: `${Math.round(POSTER.h * SIM_SCALE) + 40}px` }}>
              <div class="sg-scroll" style={{ transform: `translate3d(${PAD - (focus.row === 1 ? Math.max(0, focus.col - 1) * SIM.stride : 0)}px,20px,0)` }}>
                {(() => {
                  const [sf, st] = windowOf(focus.row === 1 ? focus.col : 0, similar.length, 2, 10);
                  return similar.slice(sf, st).map((t, k) => (
                    <PosterTile
                      key={t.id}
                      x={(sf + k) * SIM.stride}
                      y={0}
                      scale={SIM_SCALE}
                      src={posterUrl(t)}
                      focused={focus.row === 1 && sf + k === focus.col && head == null && !sourcesOpen}
                    />
                  ));
                })()}
              </div>
            </div>
          </>
        )}

        {series && seasons.length > 0 && (
          <Tabs
            x={PAD}
            y={SEASONS_Y}
            w={1920 - 2 * PAD}
            items={seasons.map(seasonLabel)}
            picked={Math.max(0, seasons.indexOf(shownSeason))}
            focusIndex={focus.row === 1 && head == null && !sourcesOpen ? focus.col : -1}
          />
        )}

        {series && (
          <div class="sg-clip" style={{ left: "0px", top: `${EPS_Y - 20}px`, width: "1920px", height: `${LANDSCAPE.h + 40}px` }}>
            <div class="sg-scroll" style={{ transform: `translate3d(${PAD - shift}px,20px,0)` }}>
              {/* Only the episodes around focus are rendered (a season can have a hundred). */}
              {episodes.slice(from, to).map((v, k) => {
                const c = from + k;
                return (
                  <EpisodeTile
                    key={v.id}
                    x={c * EP_STRIDE}
                    v={v}
                    fallback={artSrc}
                    look={episodeLook(v, spoilers)}
                    progress={resume?.episode?.id === v.id && resume.durSec > 0 ? resume.posSec / resume.durSec : undefined}
                    watched={epWatched.has(episodeKey(v))}
                    focused={focus.row === 2 && c === focus.col && head == null && !sourcesOpen}
                  />
                );
              })}
            </div>
          </div>
        )}

        {ctx && (
          <>
            <div class="det-scrim" />
            <Glass x={1180} y={300} w={640} h={96 + ctx.lines.length * 64} class="det-menu">
              <span class="cat-kicker">{series && focus.row === 2 && target ? `${episodeLabel(target)} ${target.name}` : meta.name}</span>
              {ctx.lines.map((l, i) => (
                <div key={l.id} class={`cat-style-line${ctx.at === i ? " is-focus" : ""}`}>
                  {l.label}
                </div>
              ))}
            </Glass>
          </>
        )}

        {aboutOpen && (
          <>
            <div class="det-scrim" />
            <Glass {...SHEET} class="det-sheet det-about-sheet">
              <span class="cat-kicker">About</span>
              <h2>{meta.name}</h2>
              {meta.description && <p class="det-about-full">{meta.description}</p>}
              <dl class="det-facts">
                {aboutFacts(meta, sagaCol?.title).flatMap((f) => [<dt key={`${f.label}t`}>{f.label}</dt>, <dd key={`${f.label}d`}>{f.value}</dd>])}
              </dl>
            </Glass>
          </>
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
                          color={st === best ? "var(--sg-accent)" : undefined}
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
            <ButtonRow
              items={[
                { id: "start", label: "Start a party", primary: true, icon: "party" },
                { id: "join", label: "Join with a code" },
              ]}
              focusIndex={partyCard}
            />
          </Glass>
        )}
        {!veilGone && <div class={`det-veil${revealed ? " is-off" : ""}`} />}
      </GlassRoot>
    </div>
  );
}
