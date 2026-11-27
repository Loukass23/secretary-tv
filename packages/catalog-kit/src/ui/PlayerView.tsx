import { mark, measure, useKeys } from "@secretary/tv-kit";
import { Glass, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { LoadingScreen } from "./Loading.tsx";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SkipSource, tryInOrder } from "../lib/autopick.ts";
import { backgroundUrl } from "../lib/cinemeta.ts";
import { episodeLabel } from "../lib/episodes.ts";
import { addons, loadDebrid, playable } from "../lib/plugins.ts";
import { reportPlayback, saveProgress } from "../lib/resume.ts";
import { logoUrl, pauseFacts, pausePanelShown } from "../lib/pausepanel.ts";
import { setNowPlaying } from "./ControlCentre.tsx";
import { creditsStart, pillAt, type Segment, segmentKey } from "../lib/skip.ts";
import { cardAt, type Countdown, countdownSec, durationWatch, prefetchAt, STABLE_MS } from "../lib/upnext.ts";
import { checkFailure, failureReason, worthProbing } from "../lib/failures.ts";
import { checkSource, createVerifier, safeToCheck } from "../lib/verify.ts";
import { parseStreamInfo, type Stream } from "../lib/streams.ts";
import type { CatalogType, Title, Video } from "../lib/types.ts";
import { createHtml5Player } from "../player/html5.ts";
import { consumePreload, deadLinks, makeAvplay, skipFinder, sourcePrefs } from "../player/session.ts";
import type { PlayerEvents, TvPlayer } from "../player/types.ts";
import type { Phase } from "@secretary/party/src/protocol.ts";
import type { PartySession } from "../lib/party.ts";
import { createFollower, type PartyPlayer } from "../lib/partyplay.ts";
import { PartyOverlay, partyLine, usePartyView } from "./PartyOverlay.tsx";
import { PlayerMenu } from "./PlayerMenu.tsx";
import { PauseMenu } from "./PauseMenu.tsx";
import { type PauseAction, pauseActions, pauseMenuShown, stepPause } from "../lib/pausemenu.ts";
import { type MenuPage, type MenuRow, type PlayerRoom } from "../lib/playermenu.ts";
import type { Subtitle } from "../lib/addons.ts";
import { chosenSubLang, type Cue, cueAt, DELAY_STEP, delayLabel, groupSubtitles, loadCues, MAX_DELAY, rememberSubLang, SUB_SIZES } from "../lib/subtitles.ts";
import { ASPECT_LABEL, ASPECTS, chosenAudioLang, preferredAudio, rememberAudioLang } from "../player/tracks.ts";
import { HeroLayers, useBase, useHeroArt } from "./art.tsx";
import "./player.css";

const MAX_SOURCES = 4;
const SEEK_SEC = 10;
const SAVE_EVERY_MS = 15_000;
const CONTROLS_MS = 4000;
/** Watching together: rapid Left/Right presses become one seek command, sent once they settle. */
const PARTY_SEEK_SETTLE_MS = 400;
/** Until this TV has measured its own. */
const DEFAULT_START_MS = 800;
const DEFAULT_REOPEN_MS = 3000;

interface Props {
  type: CatalogType;
  title: Title;
  episode: Video | undefined;
  /** The episode after this one, when there is one: finishing moves on to it. */
  next: Video | null;
  streams: Stream[];
  startSec: number;
  /** The viewer picked the first source in the sheet (it is already remembered). */
  manualPick?: boolean;
  /** Settings › Playback "Remember my source". */
  remember?: boolean;
  /** Settings › Playback "Up next countdown" (lib/upnext.ts). */
  countdown?: Countdown;
  /** Settings › Playback "Skip intros and recaps by themselves" (lib/skip.ts). */
  autoSkip?: boolean;
  /** Settings › Playback "Pause panel" (lib/pausepanel.ts). */
  pausePanel?: boolean;
  onExit(): void;
  /** Called when playback pauses (false) or resumes (true) after it has started: the room's lights follow it. */
  onPlayState?(playing: boolean): void;
  /**
   * Called when the episode ends and `next` exists, with the source that played, so the next episode starts with the
   * same kind of release; resolves once its player view has been set up.
   */
  onNext(next: Video, playing: Stream | undefined): Promise<void>;
  /**
   * Called once, about 90 s before the Up next card (lib/upnext.ts prefetchAt), so the next episode's sources are found,
   * and fresh, when it shows; with the source that is playing, so the same release can be warmed.
   */
  onPrefetchNext(next: Video, playing: Stream | undefined): void;
  /**
   * Watching together (lib/party.ts): `streams` is the room's release only, the room decides when it plays, pauses
   * and seeks (lib/partyplay.ts), and the keys send commands. Skipping, the Up next card and the pause panel are off;
   * the end of an episode sends `next` from whoever may command.
   */
  party?: PartySession;
  /** Settings › Playback audio languages, most wanted first: the track in the first of them plays. */
  audioLangs?: string[];
  /** Settings › Playback subtitle languages: listed first in the subtitle menu. */
  subLangs?: string[];
  /** The room's lights and scenes, offered in the options menu when Nest gave this app a grant. */
  room?: PlayerRoom;
}

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function PlayerView({
  type,
  title,
  episode,
  next,
  streams,
  startSec,
  manualPick = false,
  remember = true,
  countdown = "5",
  autoSkip = false,
  pausePanel = true,
  onExit,
  onPlayState,
  onNext,
  onPrefetchNext,
  party,
  audioLangs = [],
  subLangs: settingsSubLangs,
  room,
}: Props) {
  if (party) {
    autoSkip = false;
    pausePanel = false;
  }
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<TvPlayer | null>(null);
  const cancelled = useRef(false);
  /** The source that is playing, for Next. */
  const playingSource = useRef<Stream | undefined>(undefined);
  // The Up next card (lib/upnext.ts): the duration must hold still first; Back hides the card for this episode.
  const durStable = useRef(durationWatch());
  const [cardHidden, setCardHidden] = useState(false);
  /** Moving on to the next episode, by the card or by the end of this one: only once. */
  const movingOn = useRef(false);
  const goNextRef = useRef<() => void>(() => {});
  // Intro, recap and credits (lib/skip.ts), asked for once the duration holds still; a segment skipped once is not
  // skipped again after seeking back into it.
  const [segments, setSegments] = useState<Segment[]>([]);
  const askedSkip = useRef(false);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // The pause panel (lib/pausepanel.ts): when playback paused, the last key, and a half-second tick while paused.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const lastKeyAt = useRef(0);
  const [, setPauseTick] = useState(0);
  const [logoReady, setLogoReady] = useState(false);
  const [status, setStatus] = useState("Spreading wings…");
  const [activeIdx, setActiveIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState({ pos: 0, dur: 0 });
  const [playing, setPlaying] = useState(true);
  // The first value is the start, which the app has already handled; only a change after it is a pause or a resume.
  const playStateSeen = useRef(false);
  useEffect(() => {
    if (playStateSeen.current) onPlayState?.(playing);
    playStateSeen.current = true;
  }, [playing]);
  const [buffering, setBuffering] = useState(false);
  const [controls, setControls] = useState(false);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSecond = useRef(-1);
  // Watching together: the player as the room's follower sees it (lib/partyplay.ts).
  const partyView = usePartyView(party ?? null);
  /** In a live party; once it closes (ended, expired, left) this player plays on alone with the usual keys. */
  const together = Boolean(party && partyView && partyView.status !== "closed");
  const togetherNow = useRef(false);
  togetherNow.current = together;
  const [panelOpen, setPanelOpen] = useState(false);
  // The options menu (ui/PlayerMenu.tsx): Up opens it; its rows are rebuilt from the player on every render.
  const [menuOpen, setMenuOpen] = useState(false);
  /** The page the options menu opens on: its top, or Subtitles or Audio from the pause menu. */
  const [menuStart, setMenuStart] = useState("top");
  const openMenu = (page = "top") => {
    setMenuStart(page);
    setMenuOpen(true);
  };
  /** The pause menu's focused button. */
  const [pauseAt, setPauseAt] = useState(0);
  const [, setMenuTick] = useState(0);
  // Subtitles from addons, drawn by the page (lib/subtitles.ts): the list, the one showing, its cues, size and delay.
  const [subList, setSubList] = useState<Subtitle[] | null>(null);
  const [subPick, setSubPick] = useState<{ lang: string; key: string; n: number } | null>(null);
  const [subState, setSubState] = useState<"" | "loading" | "failed">("");
  const [cap, setCap] = useState("");
  const [subSize, setSubSize] = useState(1);
  const [subDelay, setSubDelay] = useState(0);
  const cues = useRef<Cue[]>([]);
  const delayNow = useRef(0);
  delayNow.current = subDelay;
  const loaded = useRef(false);
  const firstStart = useRef<(() => void) | null>(null);
  const starting = useRef(false);
  const bufferingNow = useRef(false);
  const ended = useRef(false);
  const failedNow = useRef(false);
  const startMs = useRef(DEFAULT_START_MS);
  const reopenMs = useRef(DEFAULT_REOPEN_MS);
  const seekAt = useRef<number | null>(null);
  const seekWanted = useRef<number | null>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const target = useRef<() => number>(() => 0);
  const base = useBase(type);
  // The starting screen shows the title's art at once; it is only on screen until the first frame.
  const hero = useHeroArt(title.id, backgroundUrl(title), !started, true);
  const heading = episode ? `${title.name} · ${episodeLabel(episode)} ${episode.name}` : title.name;
  const activeStreamInfo = useMemo(
    () => (streams[activeIdx] ? parseStreamInfo(streams[activeIdx]) : null),
    [streams, activeIdx],
  );

  const flashControls = () => {
    setControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControls(false), CONTROLS_MS);
  };

  // Where playback last was, for the watch trackers (Simkl) when the player closes.
  const lastPlayed = useRef<{ pos: number; dur: number } | null>(null);
  const persist = () => {
    const p = player.current;
    if (!p || !started) return;
    const pos = p.position();
    const dur = p.duration();
    saveProgress(type, title, episode, pos, dur, next);
    lastPlayed.current = { pos, dur };
    reportPlayback(type, title, episode, pos, dur, p.isPlaying() ? "playing" : "paused");
  };
  useEffect(
    () => () => {
      const l = lastPlayed.current;
      if (l) reportPlayback(type, title, episode, l.pos, l.dur, "stopped");
    },
    [],
  );

  useEffect(() => {
    cancelled.current = false;
    const root = document.documentElement;
    root.classList.add("avplay");

    const events: PlayerEvents = {
      onTime(pos, dur) {
        const sec = Math.floor(pos);
        if (sec === lastSecond.current) return;
        lastSecond.current = sec;
        setTime({ pos, dur });
      },
      onEnded() {
        ended.current = true;
        // Together, the end only moves the room on when this TV may command; the others wait for its `next`.
        if (party && togetherNow.current) return void (next && party.canControl() && goNextRef.current());
        if (!next) {
          const dur = player.current?.duration() ?? 0;
          saveProgress(type, title, episode, dur, dur, next);
          return onExit();
        }
        goNextRef.current();
      },
      onBuffering(on) {
        bufferingNow.current = on;
        if (!on && seekAt.current != null) {
          reopenMs.current = performance.now() - seekAt.current;
          seekAt.current = null;
        }
        setBuffering(on);
      },
      onError(message) {
        failedNow.current = true;
        console.warn("[player] error during playback", message);
        setStatus("Playback error");
        setFailed(true);
      },
    };

    // Sources are checked before AVPlay gets them (lib/verify.ts): a bad one is skipped in a second, not 15.
    const verifier = createVerifier(streams, {
      check: (url) => checkSource(url, playable),
      safe: safeToCheck(Boolean(loadDebrid().torboxAhead)),
    });
    const run = async () => {
      const winner = await tryInOrder(
        streams,
        async (s, i) => {
          // The first source is the viewer's pick, or autoplay's, which already avoids recent failures: it always
          // plays. After it, a source that failed in the last six hours (lib/deadlinks.ts) is passed over.
          const failedBefore = i > 0 ? deadLinks.get(s) : null;
          if (failedBefore) throw new SkipSource(`failed recently: ${failedBefore.reason}`);
          // A provider's message is only played when the viewer picked it.
          if (i > 0 && s.notice) throw new SkipSource("a provider notice");
          setActiveIdx(i);
          player.current?.stop();
          player.current = null;
          let p: TvPlayer | null = null;
          try {
            const pre = i === 0 ? consumePreload(s.url, startSec) : null;
            if (pre) {
              Object.assign(pre.events, events);
              p = pre.player;
              await pre.ready;
            } else {
              const checked = await verifier.get(i);
              if (checked.verdict !== "ok") throw new SkipSource(checkFailure(checked));
              p = makeAvplay(events);
              if (!p) throw new Error("webapis.avplay unavailable");
              await p.load(checked.url, startSec);
            }
            // Back while it loaded: it must not start playing behind the page.
            if (cancelled.current) throw new Error("cancelled");
            player.current = p;
            if (party) {
              // The room starts it (lib/partyplay.ts): prepared at the room's position, then play() at t0.
              const loadedP = p;
              await new Promise<void>((resolve, reject) => {
                firstStart.current = () => {
                  const t = performance.now();
                  starting.current = true;
                  loadedP.start().then(() => {
                    startMs.current = performance.now() - t;
                    starting.current = false;
                    resolve();
                  }, reject);
                };
                loaded.current = true;
              });
            } else await p.start();
          } catch (err) {
            // A source that failed releases the one AVPlay, or the next source cannot open it.
            if (p !== player.current) p?.stop();
            const raw = err instanceof Error ? err.message : String(err);
            if (!cancelled.current) {
              deadLinks.mark(s, failureReason(raw));
              // "The connection failed" does not say whose fault it was: one check of the link, in the background,
              // may (a refusal, an error page), and its reason then replaces the vague one.
              if (worthProbing(raw)) {
                void checkSource(s.url, playable).then((c) => {
                  if (c.verdict !== "ok") deadLinks.mark(s, failureReason(checkFailure(c)));
                });
              }
            }
            throw err;
          }
        },
        {
          max: MAX_SOURCES,
          cancelled: () => cancelled.current,
          onTry: (i, total) =>
            setStatus(i === 0 ? "Spreading wings…" : `Serpent stomped — striking source ${i + 1} of ${total}…`),
        },
      );
      if (cancelled.current) return;
      if (winner != null) {
        deadLinks.clear(streams[winner]);
        playingSource.current = streams[winner];
        // An automatic pick that keeps playing for a few seconds becomes the series' source (lib/sourcepref.ts).
        if (remember && !manualPick && type !== "movie") {
          const playing = streams[winner];
          setTimeout(() => {
            if (!cancelled.current && player.current?.isPlaying()) sourcePrefs.remember("auto", title.id, playing);
          }, 3000);
        }
      }
      if (winner == null && party) {
        // Together, everyone plays the same file: no other source, no built-in player.
        failedNow.current = true;
        setStatus("This release is not available on your account.");
        setFailed(true);
        return;
      }
      if (winner == null) {
        // Last resort: the TV's own <video>, which decodes some files AVPlay refuses.
        try {
          root.classList.remove("avplay");
          setStatus("Trying the built-in player…");
          const p = createHtml5Player(host.current!, events);
          player.current = p;
          await p.load(await playable(streams[0].url), startSec);
          await p.start();
        } catch (err) {
          console.warn("[player] html5 fallback failed", err);
          if (!cancelled.current) {
            setStatus("All sources refused to cooperate.");
            setFailed(true);
          }
          return;
        }
      }
      // Debug handle for the CDP scripts (isPlaying, position, seekBy).
      const dbg = globalThis as unknown as { __sectv?: Record<string, unknown> };
      dbg.__sectv ??= {};
      dbg.__sectv.player = player.current;
      mark("frame");
      if (!party) measure("ok-to-frame", "ok", "frame");
      setStarted(true);
      setPlaying(true);
    };
    void run();

    return () => {
      cancelled.current = true;
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      player.current?.stop();
      player.current = null;
      root.classList.remove("avplay");
    };
  }, []);

  useEffect(() => {
    if (!started) return;
    const t = setInterval(persist, SAVE_EVERY_MS);
    return () => clearInterval(t);
  }, [started]);

  // The card's time, from the duration once it holds still, at the credits when a source placed them; films get none.
  const stableMs = durStable.current(time.dur);
  const cardSec = next
    ? cardAt({ durSec: time.dur, stableMs, isMovie: type === "movie", creditsSec: creditsStart(segments) })
    : null;

  useEffect(() => {
    if (askedSkip.current || !started || !episode || type === "movie" || stableMs < STABLE_MS || !(time.dur > 0)) return;
    askedSkip.current = true;
    void skipFinder
      .find({ id: episode.id, season: episode.season, episode: episode.episode, durSec: time.dur })
      .then((found) => {
        if (cancelled.current) return;
        console.info(`[skip] ${found.map((s) => `${s.type} ${Math.round(s.start)}-${Math.round(s.end)} (${s.source})`).join(", ") || "nothing known"}`);
        setSegments(found);
      });
  }, [started, stableMs >= STABLE_MS]);

  useEffect(() => {
    setPausedAt(started && !playing ? Date.now() : null);
    if (!started || playing || !pausePanel) return;
    const t = setInterval(() => setPauseTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [started, playing, pausePanel]);
  const panelShown = pausePanelShown({ enabled: pausePanel, playing, pausedAt, lastKeyAt: lastKeyAt.current, now: Date.now() });
  // The pause menu (ui/PauseMenu.tsx) replaces the panel: it shows as soon as playback pauses, with the Pause panel on.
  const pauseShown = pauseMenuShown({ enabled: pausePanel, started, playing, together });
  const pauseButtons: PauseAction[] = pauseActions({ next: Boolean(next), picture: Boolean(player.current?.setAspect) });
  useEffect(() => {
    if (pauseShown) setPauseAt(0);
  }, [pauseShown]);
  /** A pause menu button. Restart reopens at the start and stays paused, Play focused, so nothing starts unasked. */
  const runPause = (a: PauseAction | undefined) => {
    const p = player.current;
    if (!p || !a) return;
    if (a === "play") {
      p.toggle();
      setPlaying(p.isPlaying());
    } else if (a === "restart") {
      p.seekBy(-p.position());
      setTime((t) => ({ ...t, pos: 0 }));
      setPauseAt(0);
    } else if (a === "next") goNextRef.current();
    else if (a === "subs") openMenu("subs");
    else if (a === "audio") openMenu("audio");
    else if (a === "picture") menuPick("top", { id: "aspect", label: "Picture" }, 1);
  };
  // The logo is decoded before it shows, so the panel never paints a half-loaded image over the video.
  const logo = logoUrl(title.id);
  useEffect(() => {
    if (!panelShown || !logo || logoReady) return;
    const img = new Image();
    img.src = logo;
    img.decode().then(() => setLogoReady(true), () => {});
  }, [panelShown]);

  const pill = started ? pillAt(segments, time.pos, skipped) : null;
  /** One seek to the segment's end: AVPlay's seekTo blocks the page until it re-buffers, so never a series of them. */
  const skip = (s: Segment) => {
    setSkipped((done) => new Set(done).add(segmentKey(s)));
    const p = player.current;
    if (p) p.seekBy(s.end - p.position());
    console.info(`[skip] ${s.type} to ${Math.round(s.end)} s`);
  };
  useEffect(() => {
    if (pill && autoSkip) skip(pill);
  }, [pill && segmentKey(pill), autoSkip]);
  const cardShown = Boolean(!party && started && next && cardSec != null && time.pos >= cardSec && !cardHidden);
  const cardCount = countdownSec(countdown);

  /** The next episode now: this one counts as watched, its player is released first (one decoder), then onNext. */
  goNextRef.current = () => {
    if (!next || movingOn.current) return;
    movingOn.current = true;
    const dur = player.current?.duration() ?? time.dur;
    saveProgress(type, title, episode, dur, dur, next);
    player.current?.stop();
    player.current = null;
    setStarted(false);
    setStatus(`Up next: ${episodeLabel(next)} ${next.name}`);
    onNext(next, playingSource.current).catch(() => onExit());
  };

  // The next episode's sources, looked up late enough to still be fresh at the card (not at playback start, where a long
  // episode outlived the stream cache and the resolved link).
  const prefetched = useRef(false);
  const prefetchDue = Boolean(started && next && cardSec != null && time.pos >= prefetchAt(cardSec));
  useEffect(() => {
    if (!prefetchDue || prefetched.current || !next) return;
    prefetched.current = true;
    console.info(`[upnext] looking up ${episodeLabel(next)} at ${Math.round(time.pos)} s`);
    onPrefetchNext(next, playingSource.current);
  }, [prefetchDue]);

  // What is playing, for the control centre's "Now playing" line.
  useEffect(() => {
    if (!started) return;
    setNowPlaying({ title: heading, badges: activeStreamInfo?.badges ?? [] });
    return () => setNowPlaying(null);
  }, [started, heading, activeIdx]);

  // The countdown: when it runs out the next episode starts; hiding the card stops it.
  useEffect(() => {
    if (!cardShown || cardCount == null) return;
    const t = setTimeout(() => goNextRef.current(), cardCount * 1000);
    return () => clearTimeout(t);
  }, [cardShown, cardCount]);

  // Watching together: this player follows the room's timeline; timelines for other content are the app's to open.
  useEffect(() => {
    if (!party) return;
    if (!together) {
      // Alone now: a player still waiting for the room's start plays.
      const go = firstStart.current;
      firstStart.current = null;
      go?.();
      return;
    }
    const contentId = episode?.id ?? title.id;
    const adapter: PartyPlayer = {
      phase(): Phase {
        if (failedNow.current) return "error";
        if (!loaded.current) return "loading";
        if (firstStart.current) return "ready";
        if (starting.current) return "playing";
        if (ended.current) return "ended";
        if (bufferingNow.current) return "buffering";
        return player.current?.isPlaying() ? "playing" : "paused";
      },
      position: () => player.current?.position() ?? 0,
      play() {
        const go = firstStart.current;
        if (go) {
          firstStart.current = null;
          return go();
        }
        const p = player.current;
        if (p && !starting.current && !p.isPlaying()) {
          p.toggle();
          setPlaying(true);
        }
      },
      pause() {
        const p = player.current;
        if (p && !starting.current && p.isPlaying()) {
          p.toggle();
          setPlaying(false);
        }
      },
      seek(to) {
        const p = player.current;
        if (!p) return;
        seekAt.current = performance.now();
        ended.current = false;
        p.seekBy(to - p.position());
      },
      reopenMs: () => reopenMs.current,
      startMs: () => startMs.current,
    };
    const follower = createFollower({ player: adapter, serverNow: party.serverNow, rtt: party.rtt, send: party.send });
    target.current = follower.target;
    follower.start();
    party.follow((tl) => {
      if (tl.contentId === contentId) follower.timeline(tl);
    });
    return () => {
      party.follow(null);
      follower.stop();
      if (seekTimer.current) clearTimeout(seekTimer.current);
    };
  }, [party, together]);

  /** Keys while together: playback keys are commands to the room, Up opens the party panel. */
  const partyKey = (key: string): boolean | void => {
    if (!party || !together) return false;
    const tl = partyView?.tl;
    if (key === "Back" || key === "Stop") {
      persist();
      party.leave();
      onExit();
      return;
    }
    if (key === "Up" || key === "Blue") return void setPanelOpen(true);
    if (key === "Info" && started) return void setMenuOpen(true);
    if (!tl) return false;
    flashControls();
    const moving = tl.state === "playing" || tl.state === "waiting";
    if (key === "Enter" || key === "PlayPause" || key === "Play" || key === "Pause") {
      const pause = key === "Pause" || (key !== "Play" && moving);
      if (pause) party.command("pause", { pos: player.current?.position() });
      else if (!moving) party.command("play");
      return;
    }
    const d = key === "Left" || key === "Rewind" ? -SEEK_SEC : key === "Right" || key === "FastForward" ? SEEK_SEC : 0;
    if (!d) return false;
    if (!party.canControl()) return void party.command("seek");
    seekWanted.current = Math.max(0, (seekWanted.current ?? target.current()) + d);
    setTime((t) => ({ ...t, pos: seekWanted.current! }));
    if (seekTimer.current) clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => {
      seekTimer.current = null;
      const pos = seekWanted.current;
      seekWanted.current = null;
      if (pos != null) party.command("seek", { pos });
    }, PARTY_SEEK_SETTLE_MS);
  };

  useKeys(!panelOpen && !menuOpen, (key) => {
    if (together) return partyKey(key);
    const p = player.current;
    // Paused, the pause menu takes the keys: Left and Right along its buttons, OK runs one, Up the options.
    if (pauseShown && p) {
      lastKeyAt.current = Date.now();
      if (key === "Back" || key === "Stop") {
        persist();
        onExit();
        return;
      }
      if (key === "Up" || key === "Info") return void openMenu();
      if (key === "PlayPause" || key === "Play") {
        p.toggle();
        setPlaying(p.isPlaying());
        return;
      }
      if (key === "Rewind" || key === "FastForward") return void p.seekBy(key === "Rewind" ? -SEEK_SEC : SEEK_SEC);
      const step = stepPause(pauseAt, pauseButtons.length, key);
      if (!step) return false;
      if ("at" in step) return void setPauseAt(step.at);
      return void runPause(pauseButtons[step.run]);
    }
    // Any key restarts the pause panel's wait; OK on the panel resumes.
    const wasPanel = panelShown;
    lastKeyAt.current = Date.now();
    if (wasPanel && key === "Enter" && p) {
      p.toggle();
      setPlaying(p.isPlaying());
      return;
    }
    // While the skip pill shows, OK skips the segment.
    if (pill && key === "Enter") return void skip(pill);
    // While the Up next card shows: OK plays the next episode now, Back hides the card and keeps watching.
    if (cardShown && key === "Enter") return void goNextRef.current();
    if (cardShown && key === "Back") return void setCardHidden(true);
    if (key === "Back" || key === "Stop") {
      persist();
      onExit();
      return;
    }
    if (!started || !p) return false;
    if (key === "Up" || key === "Info") return void setMenuOpen(true);
    flashControls();
    if (key === "Enter" || key === "PlayPause") {
      p.toggle();
      setPlaying(p.isPlaying());
      if (!p.isPlaying()) persist();
    } else if (key === "Play" || key === "Pause") {
      if (p.isPlaying() !== (key === "Play")) p.toggle();
      setPlaying(p.isPlaying());
    } else if (key === "Left" || key === "Rewind") p.seekBy(-SEEK_SEC);
    else if (key === "Right" || key === "FastForward") p.seekBy(SEEK_SEC);
    else return false;
  });

  const pct = time.dur > 0 ? Math.min(1, time.pos / time.dur) : 0;
  const badges = activeStreamInfo?.badges ?? [];

  // Audio: the language the viewer chose last (this session), then the Settings list, plays by itself once there is a
  // picture; a file with one track, or none listed, keeps its own.
  useEffect(() => {
    const p = player.current;
    if (!started || !p?.audioTracks || !p.selectAudio) return;
    const tracks = p.audioTracks();
    if (tracks.length < 2) return;
    const wanted = preferredAudio(tracks, [chosenAudioLang(), ...audioLangs].filter((l): l is string => Boolean(l)));
    if (wanted && wanted.index !== p.audioIndex?.()) p.selectAudio(wanted.index);
  }, [started]);

  // Subtitles: the list is asked for once there is a picture; a language the viewer chose last time comes back by itself.
  const groups = useMemo(() => groupSubtitles(subList ?? [], [...(chosenSubLang() ? [chosenSubLang()!] : []), ...(settingsSubLangs ?? [])]), [subList]);
  useEffect(() => {
    if (!started) return;
    let live = true;
    addons
      .subtitles(type === "movie" ? "movie" : "series", episode?.id ?? title.id)
      .then((list) => live && setSubList(list), () => live && setSubList([]));
    return () => void (live = false);
  }, [started]);
  const showSub = (lang: string, key: string, n: number, list: Subtitle[]) => {
    const sub = list[n % list.length];
    setSubPick({ lang, key, n: n % list.length });
    setSubState("loading");
    player.current?.silentSubtitles?.(true);
    loadCues(sub.url).then(
      (c) => {
        if (cancelled.current) return;
        cues.current = c;
        setSubState("");
      },
      (err) => {
        console.warn("[subtitles]", err);
        if (cancelled.current) return;
        cues.current = [];
        setCap("");
        setSubState("failed");
      },
    );
  };
  const subsOff = () => {
    cues.current = [];
    setSubPick(null);
    setSubState("");
    setCap("");
    rememberSubLang(null);
  };
  useEffect(() => {
    const want = chosenSubLang();
    if (!want || subPick || !groups.length) return;
    const g = groups.find((x) => x.lang === want);
    if (g) showSub(g.lang, g.lang, 0, g.subs);
  }, [groups]);
  // The caption for the player's position, four times a second; it only draws when the line changes. The page reads the
  // player's position rather than the once-a-second time state, so a line comes and goes on time.
  useEffect(() => {
    if (!subPick) return;
    const t = setInterval(() => {
      const p = player.current;
      if (!p || !cues.current.length) return;
      const i = cueAt(cues.current, p.position() - delayNow.current);
      setCap(i >= 0 ? cues.current[i].text : "");
    }, 250);
    return () => clearInterval(t);
  }, [subPick]);

  const menuPage = (id: string): MenuPage | undefined => {
    const p = player.current;
    const tracks = p?.audioTracks?.() ?? [];
    const current = p?.audioIndex?.() ?? -1;
    const aspect = p?.aspect?.();
    if (id === "top") {
      const rows: MenuRow[] = [];
      rows.push({ id: "audio", label: "Audio", go: "audio", value: tracks.find((t) => t.index === current)?.label.split(" · ")[0] ?? "" });
      const shown = subPick ? groups.find((g) => g.lang === subPick.key || g.label === subPick.key) : undefined;
      rows.push({ id: "subs", label: "Subtitles", go: "subs", value: shown?.label ?? "Off" });
      if (aspect) rows.push({ id: "aspect", label: "Picture", cycles: true, value: ASPECT_LABEL[aspect] });
      if (room && (room.lights || room.scenes)) rows.push({ id: "room", label: "Room", go: "room" });
      rows.push({ id: "info", label: "Info", go: "info" });
      return { id, title: "Options", rows };
    }
    if (id === "audio") {
      return {
        id,
        title: "Audio",
        rows: tracks.map((t) => ({ id: String(t.index), label: t.label, checked: t.index === current })),
        empty: "This file lists no audio tracks to choose from.",
      };
    }
    if (id === "subs") {
      const rows: MenuRow[] = [{ id: "sub-off", label: "Off", checked: !subPick }];
      for (const g of groups) {
        const key = g.lang || g.label;
        const on = subPick?.key === key;
        rows.push({ id: `sub:${key}`, label: g.label, checked: on, value: g.subs.length > 1 ? `${on ? subPick!.n + 1 : 1} of ${g.subs.length}` : "", cycles: g.subs.length > 1 });
      }
      if (subPick) {
        rows.push({ id: "sub-size", label: "Size", cycles: true, value: `${SUB_SIZES[subSize]}%` });
        rows.push({ id: "sub-delay", label: "Delay", cycles: true, value: delayLabel(subDelay) });
      }
      const empty = subList == null ? "Looking for subtitles…" : "No installed addon has subtitles for this title.";
      return { id, title: subState === "loading" ? "Subtitles · loading" : subState === "failed" ? "Subtitles · could not load" : "Subtitles", rows: subList?.length || subPick ? rows : [], empty };
    }
    if (id === "room" && room) {
      const rows: MenuRow[] = [];
      if (room.lights) rows.push({ id: "dark", label: "Lights off" }, { id: "soft", label: "Lights soft" });
      if (room.scenes) rows.push({ id: "movie", label: "Movie scene" }, { id: "restore", label: "Back to normal" });
      return { id, title: "Room", rows };
    }
    if (id === "info") {
      const s = streams[activeIdx];
      const rows: MenuRow[] = [{ id: "title", label: "Title", value: heading }];
      // The file's name, never the link.
      if (s) rows.push({ id: "file", label: "File", value: s.file ?? activeStreamInfo?.cleanTitle ?? "" });
      if (badges.length) rows.push({ id: "quality", label: "Quality", value: badges.join(" · ") });
      if (activeStreamInfo?.size) rows.push({ id: "size", label: "Size", value: activeStreamInfo.size });
      return { id, title: "Info", rows };
    }
    return undefined;
  };

  const menuPick = (page: string, row: MenuRow, dir: -1 | 0 | 1) => {
    const p = player.current;
    if (page === "audio" && p?.selectAudio) {
      p.selectAudio(Number(row.id));
      rememberAudioLang(p.audioTracks?.().find((t) => t.index === Number(row.id))?.lang ?? "");
    } else if (page === "subs") {
      if (row.id === "sub-off") subsOff();
      else if (row.id === "sub-size") setSubSize((n) => (n + (dir || 1) + SUB_SIZES.length) % SUB_SIZES.length);
      else if (row.id === "sub-delay") setSubDelay((d) => Math.max(-MAX_DELAY, Math.min(MAX_DELAY, Math.round((d + (dir || 1) * DELAY_STEP) * 10) / 10)));
      else if (row.id.startsWith("sub:")) {
        const key = row.id.slice(4);
        const g = groups.find((x) => (x.lang || x.label) === key);
        if (g) {
          // OK on the one showing, or Left and Right, moves to that language's next file; OK on another language shows it.
          const same = subPick?.key === key;
          showSub(g.lang, key, same ? subPick!.n + (dir || 1) + g.subs.length : 0, g.subs);
          rememberSubLang(g.lang || null);
        }
      }
    } else if (page === "top" && row.id === "aspect" && p?.setAspect) {
      const at = ASPECTS.indexOf(p.aspect?.() ?? "fit");
      p.setAspect(ASPECTS[(at + (dir || 1) + ASPECTS.length) % ASPECTS.length]);
    } else if (page === "room" && room) {
      if (row.id === "dark") room.darkLights();
      else if (row.id === "soft") room.softLights();
      else if (row.id === "movie") room.movieScene();
      else if (row.id === "restore") room.restoreScene();
    }
    setMenuTick((n) => n + 1);
  };

  return (
    <div class="player" ref={host}>
      {!started && (
        // While the stream prepares: the title's art and a frosted panel. The page is opaque until the first frame.
        <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={hero.frost ?? base.backdrop?.frost} class="ply-start">
          <HeroLayers hero={hero} shade={base.shade} />
          <LoadingScreen
            calm
            heading={heading}
            status={
              together && partyView && !failed && loaded.current
                ? partyView.tl?.state === "paused" && party!.canControl()
                  ? "Ready for everyone"
                  : partyLine(partyView)
                : status
            }
            badges={badges}
            meta={activeStreamInfo?.size}
            bar={failed ? "failed" : "loading"}
          />
        </GlassRoot>
      )}
      {pill && !autoSkip && (
        // A focused glass pill over the video: OK skips. Smoked, no frost, like the controls.
        <GlassRoot mode="flat" class="ply-skip-root">
          <Glass x={1540} y={760} w={300} h={70} focused class="ply-skip">
            <span>{pill.type === "recap" ? "Skip recap ›" : "Skip intro ›"}</span>
          </Glass>
        </GlassRoot>
      )}
      {cardShown && next && (
        // Over the video, like the controls: smoked glass, no frost. The countdown bar moves by transform.
        <GlassRoot mode="flat" class="ply-next-root">
          <Glass x={1160} y={560} w={680} h={250} class="ply-next">
            {next.thumbnail && <img class="ply-next-art" src={next.thumbnail} alt="" />}
            <div class="ply-next-text">
              <span class="ply-state">Up next</span>
              <span class="ply-title">{`${episodeLabel(next)} · ${next.name}`}</span>
              <span class="ply-dim">{cardCount != null ? `Starts in ${cardCount} s` : ""}</span>
              {cardCount != null && (
                <span class="ply-bar">
                  <i class="ply-count" style={{ animationDuration: `${cardCount}s` }} />
                </span>
              )}
            </div>
          </Glass>
        </GlassRoot>
      )}
      {pauseShown && !menuOpen && (
        <PauseMenu
          logo={logo && logoReady ? logo : null}
          name={title.name}
          episodeLine={pauseFacts(title, episode).episodeLine}
          pos={time.pos}
          dur={time.dur}
          actions={pauseButtons}
          at={pauseAt}
          values={{
            subs: subPick ? (groups.find((g) => g.lang === subPick.key || g.label === subPick.key)?.label ?? "On") : "Off",
            picture: player.current?.aspect ? ASPECT_LABEL[player.current.aspect()] : undefined,
          }}
          badges={badges}
        />
      )}
      {started && !pauseShown && !panelShown && (controls || !playing || buffering) && (
        // Over the video: the video is a plane behind a transparent page, so this glass has no frost, only a smoked fill.
        <GlassRoot mode="flat" class="ply-osd">
          <Glass x={80} y={850} w={1760} h={182} class="ply-controls">
            <div class="ply-row">
              <span class="ply-title">{heading}</span>
              <span class="ply-state">{party && partyView ? partyLine(partyView) : buffering ? "Buffering…" : playing ? "Playing" : "Paused"}</span>
            </div>
            <span class="ply-bar">
              <i style={{ transform: `scaleX(${pct})` }} />
            </span>
            <div class="ply-row">
              <div class="ply-badges">
                {badges.map((b) => (
                  <span key={b} class="ply-badge">
                    {b}
                  </span>
                ))}
              </div>
              <span class="ply-time">
                {!together && <span class="ply-hint">Up · Options</span>}
                {clock(time.pos)} / {clock(time.dur)}
              </span>
            </div>
          </Glass>
        </GlassRoot>
      )}
      {cap && (
        // The line for this moment, drawn by the page over the video (lib/subtitles.ts): a flat plate, no shadow.
        <div class="ply-cap" style={{ fontSize: `${Math.round(38 * SUB_SIZES[subSize] / 100)}px` }}>
          {cap}
        </div>
      )}
      {started && (
        <PlayerMenu open={menuOpen} start={menuStart} pageOf={menuPage} heading={heading} onPick={menuPick} onClose={() => setMenuOpen(false)} />
      )}
      {party && partyView && together && (
        <PartyOverlay
          session={party}
          view={partyView}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onLeave={() => {
            persist();
            party.leave();
            onExit();
          }}
        />
      )}
    </div>
  );
}
