import { mark, measure, useKeys } from "@secretary/tv-kit";
import { Glass, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SkipSource, tryInOrder } from "../lib/autopick.ts";
import { backgroundUrl } from "../lib/cinemeta.ts";
import { episodeLabel } from "../lib/episodes.ts";
import { loadDebrid, playable } from "../lib/plugins.ts";
import { saveProgress } from "../lib/resume.ts";
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
  onNext,
  onPrefetchNext,
  party,
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

  const persist = () => {
    const p = player.current;
    if (p && started) saveProgress(type, title, episode, p.position(), p.duration(), next);
  };

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

  useKeys(!panelOpen, (key) => {
    if (together) return partyKey(key);
    const p = player.current;
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

  return (
    <div class="player" ref={host}>
      {!started && (
        // While the stream prepares: the title's art and a frosted panel. The page is opaque until the first frame.
        <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={hero.frost ?? base.backdrop?.frost} class="ply-start">
          <HeroLayers hero={hero} shade={base.shade} />
          <Glass x={80} y={650} w={1060} h={340} class="ply-panel">
            <span class="cat-kicker">Direct stream · AVPlay</span>
            <h1>{heading}</h1>
            <p>
              {together && partyView && !failed && loaded.current
                ? partyView.tl?.state === "paused" && party!.canControl()
                  ? "Ready · OK starts it for everyone · Up shows the code"
                  : partyLine(partyView)
                : status}
            </p>
            {activeStreamInfo && (
              <div class="ply-badges">
                {badges.map((b) => (
                  <span key={b} class="ply-badge">
                    {b}
                  </span>
                ))}
                {activeStreamInfo.size && <span class="ply-dim">{activeStreamInfo.size}</span>}
              </div>
            )}
            <span class="ply-bar">
              <i class={failed ? "is-failed" : "is-loading"} />
            </span>
          </Glass>
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
              <span class="ply-dim">{cardCount != null ? `Starts in ${cardCount} s · OK plays now · Back hides` : "OK plays now · Back hides"}</span>
              {cardCount != null && (
                <span class="ply-bar">
                  <i class="ply-count" style={{ animationDuration: `${cardCount}s` }} />
                </span>
              )}
            </div>
          </Glass>
        </GlassRoot>
      )}
      {panelShown && (
        // What is playing, over the paused video: smoked glass with no frost, like the controls, which it replaces.
        <GlassRoot mode="flat" class="ply-pause-root">
          <Glass x={80} y={520} w={1060} h={500} class="ply-pause">
            <span class="ply-state">You're watching</span>
            {logo && logoReady ? <img class="ply-pause-logo" src={logo} alt={title.name} /> : <h1>{title.name}</h1>}
            {(() => {
              const f = pauseFacts(title, episode);
              return (
                <>
                  {f.episodeLine && <span class="ply-title">{f.episodeLine}</span>}
                  {f.facts && <span class="ply-dim">{f.facts}</span>}
                  {f.synopsis && <p class="ply-pause-plot">{f.synopsis}</p>}
                </>
              );
            })()}
            <span class="ply-bar">
              <i style={{ transform: `scaleX(${pct})` }} />
            </span>
            <span class="ply-dim">
              {clock(time.pos)} / {clock(time.dur)} · OK resumes
            </span>
          </Glass>
        </GlassRoot>
      )}
      {started && !panelShown && (controls || !playing || buffering) && (
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
                {clock(time.pos)} / {clock(time.dur)}
              </span>
            </div>
          </Glass>
        </GlassRoot>
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
