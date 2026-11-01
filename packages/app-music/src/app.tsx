// Secretary Music: home (trending, recently played, playlists), search and the now-playing screen, over one YouTube
// player that lives for the app's life. docs/music.md describes the setup and the keys.
import {
  type Backdrop,
  drawBackdrop,
  Glass,
  GlassRoot,
  IconButton,
  ListCard,
  Scroller,
  Segmented,
  TINTS,
} from "@secretary/tv-kit/src/glass/index.ts";
import { exitApp, getTvInputBridge, type NowPlaying, readJson, serveNowPlaying, useKeys, writeJson } from "@secretary/tv-kit";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { connectPlayer, errorText, type Player, type PlayerEvent, type PlayerState } from "./bridge.ts";
import { PLAYER_URL, RETURN_TO, YOUTUBE_API_KEY } from "./config.ts";
import {
  addRecent,
  current,
  cycleRepeat,
  inOrder,
  jumpTo,
  next,
  prev,
  type Queue,
  type Repeat,
  startQueue,
  toggleShuffle,
} from "./queue.ts";
import { Icons, Progress, ROW_H, type RowItem, TileRow } from "./ui.tsx";
import { createYouTube, formatTime, type Playlist, regionOf, storageCache, type Track } from "./youtube.ts";
import "./style.css";

type Screen = "home" | "search" | "playing";
const SCREENS: readonly Screen[] = ["home", "search", "playing"];
const NAV = ["Home", "Search", "Now playing"] as const;

const RECENT_KEY = "music.recent";
const MODES_KEY = "music.modes";
const QUERY_KEY = "music.query";
/** Home's playlists row searches the last query, or this before the first search. */
const DEFAULT_QUERY = "top hits";
/** Errors that mean this track will never play here: move on to the next one. */
const SKIP_CODES = new Set([2, 5, 100, 101, 150]);

type Focus =
  | { zone: "nav"; i: number }
  | { zone: "now" }
  | { zone: "field" }
  | { zone: "rows"; row: number; col: number }
  | { zone: "controls"; i: number }
  | { zone: "list"; i: number };

const trackItem = (t: Track): RowItem => ({
  key: t.id,
  thumb: t.thumb,
  title: t.title,
  sub: t.durSec ? `${t.artist} · ${formatTime(t.durSec)}` : t.artist,
});
const playlistItem = (p: Playlist): RowItem => ({ key: p.id, thumb: p.thumb, title: p.title, sub: p.channel, badge: "Playlist" });

interface Row {
  key: string;
  label: string;
  items: RowItem[];
  /** OK on column i. */
  open(i: number): void;
}

/** Where the player sits on each screen. YouTube's player must stay visible while it plays. */
const VIDEO_SLOT: Record<Screen, { x: number; y: number; w: number; h: number }> = {
  home: { x: 120, y: 230, w: 512, h: 288 },
  search: { x: 1440, y: 170, w: 384, h: 216 },
  playing: { x: 96, y: 96, w: 832, h: 468 },
};

const playState = (s: PlayerState): NowPlaying["state"] =>
  s === "playing" ? "playing" : s === "paused" || s === "cued" ? "paused" : s === "ended" ? "stopped" : "buffering";

export function App() {
  const yt = useMemo(() => (YOUTUBE_API_KEY ? createYouTube(YOUTUBE_API_KEY, storageCache()) : null), []);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [from, setFrom] = useState<Screen>("home");
  const [focus, setFocus] = useState<Focus>({ zone: "rows", row: 0, col: 0 });
  const [rowCols, setRowCols] = useState<Record<string, number>>({});

  const [trending, setTrending] = useState<Track[] | null>(null);
  const [recent, setRecent] = useState<Track[]>(() => readJson<Track[]>(RECENT_KEY) ?? []);
  const [query, setQuery] = useState(() => readJson<string>(QUERY_KEY) ?? "");
  const [homeLists, setHomeLists] = useState<Playlist[]>([]);
  const [found, setFound] = useState<{ tracks: Track[]; lists: Playlist[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const [queue, setQueue] = useState<Queue | null>(null);
  const [state, setState] = useState<PlayerState>("unstarted");
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const modes = useRef(readJson<{ shuffle: boolean; repeat: Repeat }>(MODES_KEY) ?? { shuffle: false, repeat: "off" as Repeat });

  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<Player | null>(null);
  const live = useRef({ queue, state, pos, dur });
  live.current = { queue, state, pos, dur };
  const track = queue ? current(queue) : undefined;

  useEffect(() => {
    void drawBackdrop(TINTS.green).then(setBackdrop, (e) => console.warn("[music] backdrop failed", e));
  }, []);

  // Home's rows, fetched once per start (the cache keeps the key's quota).
  useEffect(() => {
    if (!yt) return;
    yt.trending(regionOf(navigator.language)).then(setTrending, (e) => {
      setTrending([]);
      setNote(e.message);
    });
    yt.searchPlaylists(query || DEFAULT_QUERY).then(setHomeLists, () => setHomeLists([]));
  }, [yt]);

  // What is playing, for Nest's "Playing Music" card (tv-kit now-playing.ts).
  const nowPlaying = useRef<{ push(): void } | null>(null);
  useEffect(() => {
    const s = serveNowPlaying(() => {
      const { queue: q, state: st, pos: p, dur: d } = live.current;
      const t = q && current(q);
      if (!t) return null;
      return { v: 1, title: t.title, artist: t.artist, cover: t.cover, posSec: p, durSec: d || t.durSec, state: playState(st), updated: Date.now() };
    });
    nowPlaying.current = s;
    return s.stop;
  }, []);

  const onPlayerEvent = useRef<(e: PlayerEvent) => void>(() => {});
  onPlayerEvent.current = (e) => {
    if (e.ev === "time") {
      setPos(e.t);
      if (e.d) setDur(e.d);
      if (Math.floor(e.t) % 10 === 0) nowPlaying.current?.push();
      return;
    }
    if (e.ev === "error") {
      setNote(errorText(e.code));
      if (SKIP_CODES.has(e.code)) setTimeout(() => advance(true), 1500);
      return;
    }
    if (e.ev !== "state") return;
    setState(e.state);
    setPos(e.t);
    if (e.d) setDur(e.d);
    if (e.state === "playing") {
      setNote("");
      const t = queue && current(queue);
      if (t && recent[0]?.id !== t.id) {
        const r = addRecent(recent, t);
        setRecent(r);
        writeJson(RECENT_KEY, r);
      }
    }
    if (e.state === "ended") advance(true);
    nowPlaying.current?.push();
  };

  useEffect(() => {
    if (!frame.current || !PLAYER_URL) return;
    player.current = connectPlayer(frame.current, PLAYER_URL, (e) => onPlayerEvent.current(e));
    // YouTube pauses while another app (Nest) is in front; carry on when the listener comes back.
    let wasPlaying = false;
    const onVisibility = () => {
      if (document.hidden) wasPlaying = live.current.state === "playing";
      else if (wasPlaying) player.current?.send({ cmd: "play" });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      player.current?.destroy();
    };
  }, []);

  // A new track: load it (the queue changing order alone keeps the track playing).
  const loaded = useRef("");
  useEffect(() => {
    if (!track || loaded.current === track.id) return;
    loaded.current = track.id;
    setPos(0);
    setDur(track.durSec);
    setState("buffering");
    player.current?.send({ cmd: "load", id: track.id });
  }, [track?.id]);

  function advance(ended: boolean) {
    const q = live.current.queue;
    if (!q) return;
    const n = next(q, ended);
    if (!n) {
      setState("ended");
      return;
    }
    if (n === q || current(n)?.id === current(q)?.id) {
      player.current?.send({ cmd: "seek", t: 0 });
      player.current?.send({ cmd: "play" });
    }
    setQueue(n);
  }

  function play(tracks: readonly Track[], start: number) {
    if (!PLAYER_URL) return setNote("No player page: set SECRETARY_TV_SERVER_URL or MUSIC_PLAYER_URL (docs/music.md).");
    if (!tracks.length) return;
    loaded.current = "";
    setQueue(startQueue(tracks, start, modes.current));
    setNote("");
    show("playing");
    setFocus({ zone: "controls", i: 2 });
  }

  async function openPlaylist(p: Playlist) {
    if (!yt) return;
    setBusy(`Opening ${p.title}…`);
    try {
      const tracks = await yt.playlistTracks(p.id);
      if (!tracks.length) setNote("Nothing in this playlist can be played here.");
      else play(tracks, 0);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function runSearch(q: string) {
    const text = q.trim();
    if (!yt || !text) return;
    setQuery(text);
    writeJson(QUERY_KEY, text);
    setBusy(`Searching for “${text}”…`);
    try {
      const [tracks, lists] = await Promise.all([yt.searchTracks(text), yt.searchPlaylists(text)]);
      setFound({ tracks, lists });
      setHomeLists(lists);
      setNote(tracks.length || lists.length ? "" : `Nothing found for “${text}”.`);
      if (tracks.length || lists.length) setFocus({ zone: "rows", row: 0, col: 0 });
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function typeSearch() {
    getTvInputBridge().open(query, { onCommit: (v) => void runSearch(v) });
  }

  function show(s: Screen) {
    if (s === screen) return;
    setFrom(screen === "playing" ? from : screen);
    setScreen(s);
    if (s === "home") setFocus({ zone: "rows", row: 0, col: rowCols.home0 ?? 0 });
    if (s === "search") setFocus(found ? { zone: "rows", row: 0, col: 0 } : { zone: "field" });
    if (s === "playing") setFocus({ zone: "controls", i: 2 });
  }

  const togglePlay = () => {
    if (!track) return;
    if (state === "ended") {
      player.current?.send({ cmd: "seek", t: 0 });
      player.current?.send({ cmd: "play" });
    } else player.current?.send({ cmd: state === "playing" || state === "buffering" ? "pause" : "play" });
  };
  const seekBy = (d: number) => {
    if (!track) return;
    const t = Math.max(0, Math.min(pos + d, (dur || track.durSec) - 1));
    setPos(t);
    player.current?.send({ cmd: "seek", t });
  };
  const goPrev = () => {
    if (!queue) return;
    const { queue: q, restart } = prev(queue, pos);
    if (restart) {
      setPos(0);
      player.current?.send({ cmd: "seek", t: 0 });
    } else setQueue(q);
  };
  const setModes = (q: Queue) => {
    modes.current = { shuffle: q.shuffle, repeat: q.repeat };
    writeJson(MODES_KEY, modes.current);
    setQueue(q);
  };

  const all: Row[] =
    screen === "search"
      ? [
          { key: "s-tracks", label: "Songs", items: (found?.tracks ?? []).map(trackItem), open: (i) => play(found!.tracks, i) },
          { key: "s-lists", label: "Playlists", items: (found?.lists ?? []).map(playlistItem), open: (i) => void openPlaylist(found!.lists[i]) },
        ]
      : [
          { key: "home0", label: "Trending music", items: (trending ?? []).map(trackItem), open: (i) => play(trending!, i) },
          { key: "home1", label: "Recently played", items: recent.map(trackItem), open: (i) => play(recent, i) },
          {
            key: "home2",
            label: `Playlists · ${query || DEFAULT_QUERY}`,
            items: homeLists.map(playlistItem),
            open: (i) => void openPlaylist(homeLists[i]),
          },
        ];
  const rows = all.filter((r) => r.items.length > 0);

  const list = queue ? inOrder(queue) : [];
  const navIndex = SCREENS.indexOf(screen);

  useKeys(true, (key) => {
    // The remote's media keys work on every screen.
    if (key === "PlayPause") return togglePlay();
    if (key === "Play") return track && state !== "playing" ? togglePlay() : undefined;
    if (key === "Pause") return state === "playing" ? togglePlay() : undefined;
    if (key === "Stop") return player.current?.send({ cmd: "pause" });
    if (key === "FastForward") return seekBy(10);
    if (key === "Rewind") return seekBy(-10);
    if (key === "ChannelUp") return advance(false);
    if (key === "ChannelDown") return goPrev();
    if (key === "Search" || key === "SearchVoice") {
      show("search");
      if (key === "SearchVoice" || !found) setTimeout(typeSearch, 0);
      return;
    }
    if (key === "Back") {
      if (screen === "playing") return show(from);
      if (screen === "search") return show("home");
      return exitApp(RETURN_TO);
    }
    const f = focus;
    const enter = key === "Enter";

    if (f.zone === "nav") {
      if (key === "Left") return setFocus({ zone: "nav", i: Math.max(0, f.i - 1) });
      if (key === "Right") return setFocus({ zone: "nav", i: Math.min(NAV.length - 1, f.i + 1) });
      if (key === "Down") {
        if (screen === "search") return setFocus({ zone: "field" });
        return setFocus(rows.length ? { zone: "rows", row: 0, col: rowCols[rows[0].key] ?? 0 } : { zone: "now" });
      }
      if (enter) {
        const s = SCREENS[f.i];
        if (s === "playing" && !queue) return setNote("Pick a song first.");
        return show(s);
      }
      return;
    }
    if (f.zone === "now") {
      if (key === "Up") return setFocus({ zone: "nav", i: navIndex });
      if (key === "Right" && rows.length) return setFocus({ zone: "rows", row: 0, col: rowCols[rows[0].key] ?? 0 });
      if (enter && queue) return show("playing");
      return;
    }
    if (f.zone === "field") {
      if (key === "Up") return setFocus({ zone: "nav", i: navIndex });
      if (key === "Down" && rows.length) return setFocus({ zone: "rows", row: 0, col: 0 });
      if (enter) return typeSearch();
      return;
    }
    if (f.zone === "rows") {
      const row = rows[Math.min(f.row, rows.length - 1)];
      if (!row) return setFocus(screen === "search" ? { zone: "field" } : { zone: "nav", i: navIndex });
      const move = (r: number, c: number) => {
        setRowCols((m) => ({ ...m, [rows[r].key]: c }));
        setFocus({ zone: "rows", row: r, col: c });
      };
      if (key === "Left") {
        if (f.col > 0) return move(f.row, f.col - 1);
        if (screen === "home") return setFocus({ zone: "now" });
        return;
      }
      if (key === "Right") return move(f.row, Math.min(row.items.length - 1, f.col + 1));
      if (key === "Up") {
        if (f.row > 0) return move(f.row - 1, Math.min(rowCols[rows[f.row - 1].key] ?? 0, rows[f.row - 1].items.length - 1));
        return setFocus(screen === "search" ? { zone: "field" } : { zone: "nav", i: navIndex });
      }
      if (key === "Down" && f.row + 1 < rows.length) {
        return move(f.row + 1, Math.min(rowCols[rows[f.row + 1].key] ?? 0, rows[f.row + 1].items.length - 1));
      }
      if (enter) return row.open(f.col);
      return;
    }
    if (f.zone === "controls") {
      if (key === "Left") return setFocus({ zone: "controls", i: Math.max(0, f.i - 1) });
      if (key === "Right") {
        if (f.i < 4) return setFocus({ zone: "controls", i: f.i + 1 });
        if (list.length) setFocus({ zone: "list", i: queue!.pos });
        return;
      }
      if (key === "Up" && list.length) return setFocus({ zone: "list", i: queue!.pos });
      if (enter && queue) {
        if (f.i === 0) return setModes(toggleShuffle(queue));
        if (f.i === 1) return goPrev();
        if (f.i === 2) return togglePlay();
        if (f.i === 3) return advance(false);
        return setModes({ ...queue, repeat: cycleRepeat(queue.repeat) });
      }
      return;
    }
    if (f.zone === "list") {
      if (key === "Up") return setFocus({ zone: "list", i: Math.max(0, f.i - 1) });
      if (key === "Down") return setFocus({ zone: "list", i: Math.min(list.length - 1, f.i + 1) });
      if (key === "Left") return setFocus({ zone: "controls", i: 2 });
      if (enter && queue) {
        if (f.i === queue.pos) return togglePlay();
        return setQueue(jumpTo(queue, f.i));
      }
    }
  });

  const slot = VIDEO_SLOT[screen];
  const playing = state === "playing" || state === "buffering";
  const length = dur || track?.durSec || 0;
  const rowFocus = (r: number) => (focus.zone === "rows" && focus.row === r ? focus.col : -1);
  const rowsX = screen === "home" ? 720 : 96;
  const rowsY = screen === "home" ? 164 : 410;
  const rowsW = screen === "home" ? 1104 : 1728;

  return (
    <GlassRoot mode="fake" wallpaper={backdrop?.wallpaper} frost={backdrop?.frost} class={`music on-${screen}`}>
      <iframe
        ref={frame}
        class={`mu-video${track ? " is-on" : ""}`}
        allow="autoplay; encrypted-media"
        title="YouTube player"
        style={{ left: `${slot.x}px`, top: `${slot.y}px`, width: `${slot.w}px`, height: `${slot.h}px` }}
      />

      {screen !== "playing" && (
        <>
          <h1 class="mu-brand">Music</h1>
          <Segmented
            x={720}
            y={56}
            w={540}
            h={72}
            items={NAV}
            picked={navIndex}
            focusIndex={focus.zone === "nav" ? focus.i : -1}
          />
          <Clock />
        </>
      )}

      {screen === "home" && (
        <Glass x={96} y={170} w={560} h={820} focused={focus.zone === "now"} class="mu-now">
          <small class="mu-kicker">{track ? (playing ? "Playing" : "Paused") : "Nothing playing"}</small>
          {track ? (
            <div class="mu-now-text">
              <b>{track.title}</b>
              <small>{track.artist}</small>
              <Progress x={0} y={150} w={512} value={length ? pos / length : 0} />
              <small class="mu-times">
                {formatTime(pos)} / {formatTime(length)}
              </small>
            </div>
          ) : (
            <div class="mu-now-text mu-empty">
              <b>Pick a song</b>
              <small>Trending music and your recent plays are on the right. Search finds anything on YouTube.</small>
            </div>
          )}
        </Glass>
      )}

      {screen === "search" && (
        <Glass x={96} y={170} w={1300} h={96} focused={focus.zone === "field"} class="mu-field">
          <span class="mu-field-icon">{Icons.search}</span>
          <span class={query ? "" : "mu-placeholder"}>{query || "Search songs, artists and playlists"}</span>
        </Glass>
      )}

      {screen !== "playing" &&
        rows.map((r, i) => (
          <TileRow key={r.key} label={r.label} items={r.items} x={rowsX} y={rowsY + i * ROW_H} w={rowsW} focus={rowFocus(i)} />
        ))}

      {screen !== "playing" && !rows.length && (
        <p class="mu-message" style={{ left: `${rowsX}px`, top: `${rowsY + 40}px`, width: `${rowsW}px` }}>
          {!YOUTUBE_API_KEY
            ? "Add YOUTUBE_API_KEY to .env.tizen and deploy again to browse and search (docs/music.md)."
            : screen === "search"
              ? found
                ? ""
                : "Press OK on the search field to type."
              : trending === null
                ? "Loading…"
                : ""}
        </p>
      )}

      {screen === "playing" && track && (
        <>
          <div class="mu-title">
            <b>{track.title}</b>
            <small>{track.artist}</small>
          </div>
          <Progress x={96} y={720} w={832} value={length ? pos / length : 0} />
          <small class="mu-time-l">{formatTime(pos)}</small>
          <small class="mu-time-r">{formatTime(length)}</small>
          {(
            [
              [Icons.shuffle, queue!.shuffle],
              [Icons.prev, false],
              [playing ? Icons.pause : Icons.play, false],
              [Icons.next, false],
              [Icons.repeat, queue!.repeat !== "off"],
            ] as const
          ).map(([icon, on], i) => (
            <IconButton
              key={i}
              x={CONTROL_X[i]}
              y={i === 2 ? 790 : 800}
              w={i === 2 ? 120 : 100}
              h={i === 2 ? 120 : 100}
              icon={i === 4 && queue!.repeat === "one" ? <span class="mu-one">{icon}1</span> : icon}
              badge={on}
              focused={focus.zone === "controls" && focus.i === i}
              class={i === 2 ? "mu-main" : undefined}
            />
          ))}
          <TrackList list={list} playingIndex={queue!.pos} focus={focus.zone === "list" ? focus.i : -1} />
        </>
      )}

      {(busy || note) && <div class="mu-note">{busy || note}</div>}
    </GlassRoot>
  );
}

/** Shuffle, previous, play (larger), next and repeat, centred under the video with 40 px between them. */
const CONTROL_X = [172, 312, 452, 612, 752];

const LIST_ROW = 92;
const LIST_H = 760;

/** The queue on the right of the now-playing screen, the current track highlighted; renders the rows near focus. */
function TrackList({ list, playingIndex, focus }: { list: readonly Track[]; playingIndex: number; focus: number }) {
  const anchor = focus >= 0 ? focus : playingIndex;
  const visible = Math.floor(LIST_H / LIST_ROW);
  const top = Math.max(0, Math.min(anchor - 3, list.length - visible));
  const from = Math.max(0, top - 2);
  const to = Math.min(list.length, top + visible + 2);
  return (
    <Glass x={1000} y={96} w={824} h={888} class="mu-list">
      <small class="mu-kicker">
        Up next · {list.length} {list.length === 1 ? "track" : "tracks"}
      </small>
      <Scroller x={24} y={100} w={776} h={LIST_H} axis="y" offset={top * LIST_ROW} pad={8}>
        {list.slice(from, to).map((t, k) => {
          const i = from + k;
          return (
            <ListCard
              key={`${i}:${t.id}`}
              x={0}
              y={i * LIST_ROW}
              w={776}
              h={LIST_ROW - 10}
              frost={false}
              title={t.title}
              sub={t.artist}
              meta={t.durSec ? formatTime(t.durSec) : undefined}
              color={i === playingIndex ? "#34d399" : undefined}
              focused={i === focus}
              class={i === playingIndex ? "is-current" : undefined}
            />
          );
        })}
      </Scroller>
    </Glass>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return <div class="mu-clock">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>;
}
