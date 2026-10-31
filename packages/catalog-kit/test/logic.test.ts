import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBackFilter,
  keyName,
  move,
  registerMediaKeys,
  SHORTCUT_KEYS,
  windowOf,
} from "@secretary/tv-kit";
import {
  badgeForResume,
  isTitleWatched,
  markTitleWatched,
  mergeResume,
  resumeStart,
  syncAllResume,
  toContinueTitle,
  toggleTitleWatched,
  upsert,
  type ResumeEntry,
} from "../src/lib/resume.ts";
import {
  buildSagasRow,
  buildPinnedSagaRows,
  computeSagaView,
  findSagaForTitle,
  formatRemainingRuntime,
  getSagaById,
  isSagaPinned,
  togglePinSaga,
} from "../src/lib/sagas.ts";
import { tryInOrder } from "../src/lib/autopick.ts";
import { createStreamClient, parseStreamInfo } from "../src/lib/streams.ts";
import { fetchMeta, groupAnimeMetas, setMetaKeys, stripSeasonSuffix, toTitle } from "../src/lib/cinemeta.ts";
import { clearFanartCache, resolveFrameArtwork, setFanartKeys } from "../src/lib/fanart.ts";
import {
  ACCENT_THEMES,
  clearRecentSearches,
  DEFAULT_SETTINGS,
  fetchRemindersForMode,
  loadRecentSearches,
  loadSettings,
  mergeSettings,
  saveRecentSearch,
  saveSettings,
  SETTING_ITEMS,
  toggleReminderForMode,
} from "../src/lib/settings.ts";

test("grid: vertical moves clamp the column and skip empty rows", () => {
  const lengths = [10, 0, 3];
  assert.deepEqual(move(lengths, { row: 0, col: 7 }, "down"), { row: 2, col: 2 });
  assert.deepEqual(move(lengths, { row: 2, col: 1 }, "up"), { row: 0, col: 1 });
});

test("grid: edges return the same object so callers can skip a render", () => {
  const at = { row: 0, col: 0 };
  assert.equal(move([5], at, "left"), at);
  assert.equal(move([5], at, "up"), at);
  const end = { row: 0, col: 4 };
  assert.equal(move([5], end, "right"), end);
  assert.equal(move([5], end, "down"), end);
});

test("grid: window follows the focused column", () => {
  assert.deepEqual(windowOf(0, 30), [0, 9]);
  assert.deepEqual(windowOf(20, 30), [17, 29]);
  assert.deepEqual(windowOf(29, 30), [26, 30]);
});

test("resume: no seek in the first or last seconds or without a duration", () => {
  assert.equal(resumeStart(3, 6000), 0);
  assert.equal(resumeStart(5995, 6000), 0);
  assert.equal(resumeStart(100, 0), 0);
  assert.equal(resumeStart(100, 6000), 100);
});

const entry = (id: string, posSec = 100, updated = 0): ResumeEntry => ({
  title: { id, name: id, year: "", rating: "" },
  posSec,
  durSec: 6000,
  updated,
});

test("resume: newest first, one per title, finished titles dropped", () => {
  const list = upsert(upsert([], entry("a"), false), entry("b"), false);
  assert.deepEqual(list.map((e) => e.title.id), ["b", "a"]);
  assert.deepEqual(upsert(list, entry("a", 200), false).map((e) => e.title.id), ["a", "b"]);
  assert.deepEqual(upsert(list, entry("b"), true).map((e) => e.title.id), ["a"]);
});

test("resume: mergeResume combines local and remote keeping the newest updated timestamp", () => {
  const local = [entry("a", 300, 50), entry("b", 100, 10)];
  const remote = [entry("a", 150, 20), entry("b", 400, 80), entry("c", 50, 30)];
  const merged = mergeResume(local, remote);
  assert.deepEqual(
    merged.map((e) => `${e.title.id}:${e.posSec}`),
    ["b:400", "a:300", "c:50"],
  );
});

test("resume: badgeForResume and toContinueTitle format cross-category items", () => {
  assert.equal(badgeForResume({ type: "movie", title: { year: "2024" } }), "Movie · 2024");
  assert.equal(
    badgeForResume({
      type: "series",
      episode: { id: "tt1:1:2", season: 1, episode: 2, name: "Ep 2" },
      posSec: 120,
    }),
    "Series · S01E02",
  );
  assert.equal(
    badgeForResume({
      type: "anime",
      episode: { id: "tt2:3:1", season: 3, episode: 1, name: "Next Ep" },
      posSec: 0,
    }),
    "Next · S03E01",
  );

  const card = toContinueTitle({
    type: "series",
    title: { id: "tt1", name: "Show", year: "2023", rating: "8.5" },
    episode: { id: "tt1:1:2", season: 1, episode: 2, name: "Ep 2" },
    posSec: 300,
    durSec: 1000,
    updated: 100,
  });
  assert.equal(card.catalogType, "series");
  assert.equal(card.badge, "Series · S01E02");
  assert.equal(card.progressPct, 30);
});

test("resume: syncAllResume merges cross-category server items with local storage", async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: () => null,
    length: 0,
  };
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.endsWith("/resume")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              type: "movie",
              title: { id: "tt1", name: "Movie 1", year: "2024", rating: "8.0" },
              posSec: 600,
              durSec: 7200,
              updated: 100,
            },
            {
              type: "anime",
              title: { id: "tt2", name: "Anime 1", year: "2023", rating: "8.9" },
              episode: { id: "tt2:1:4", season: 1, episode: 4, name: "Ep 4" },
              posSec: 400,
              durSec: 1400,
              updated: 200,
            },
          ],
        }),
      );
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const all = await syncAllResume("http://s", fakeFetch);
  assert.deepEqual(
    all.map((e) => `${e.type}:${e.title.id}`),
    ["anime:tt2", "movie:tt1"],
  );
});

test("autopick: returns the first source that starts and skips failures", async () => {
  const tried: number[] = [];
  const out = await tryInOrder(["a", "b", "c"], async (_s, i) => {
    tried.push(i);
    if (i < 1) throw new Error("fail");
  }, { max: 3 });
  assert.equal(out, 1);
  assert.deepEqual(tried, [0, 1]);
});

test("autopick: gives up after max and stops when cancelled", async () => {
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error("x");
  };
  assert.equal(await tryInOrder([1, 2, 3, 4, 5], fail, { max: 2 }), null);
  assert.equal(calls, 2);
  assert.equal(await tryInOrder([1, 2], fail, { max: 2, cancelled: () => true }), null);
  assert.equal(calls, 2);
});

test("streams: one request per title inside the TTL, retried after a failure, supports overrideType", async () => {
  let calls = 0;
  let t = 0;
  let ok = false;
  const seenUrls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    calls++;
    seenUrls.push(String(input));
    return ok
      ? new Response(JSON.stringify({ streams: [{ name: "n", title: "t", url: "u" }] }))
      : new Response("no", { status: 500 });
  }) as unknown as typeof fetch;
  const c = createStreamClient("http://s", "movie", f, () => t);
  await assert.rejects(c.get("tt1"));
  ok = true;
  const [a, b] = await Promise.all([c.get("tt1"), c.get("tt1")]);
  assert.equal(a[0].url, "u");
  assert.equal(a, b);
  assert.equal(calls, 2);
  t = 5 * 60_000;
  await c.get("tt1");
  assert.equal(calls, 3);
  await c.get("tt2:1:1", { season: 1, episode: 1 }, "series");
  assert.ok(seenUrls.at(-1)?.includes("/stream/series/tt2%3A1%3A1.json"));
});

test("cinemeta: catalog items use imdb_id; entries without a tt id are dropped", () => {
  assert.equal(toTitle({ imdb_id: "tt1", name: "A", year: "2020", imdbRating: "7.1" })?.rating, "7.1");
  assert.equal(toTitle({ id: "mal:1", name: "B" }), null);
  assert.equal(toTitle({ name: "C" }), null);
  assert.equal(toTitle({ id: "tt2", name: "D", releaseInfo: "2019-2021" })?.year, "2019");
});

test("anime: groupAnimeMetas collapses multi-season entries sharing an imdb_id", () => {
  assert.equal(stripSeasonSuffix("Attack on Titan Season 3 Part 2"), "Attack on Titan");
  assert.equal(stripSeasonSuffix("Boku no Hero Academia 2"), "Boku no Hero Academia");
  assert.equal(stripSeasonSuffix("Re:Zero 4th Season"), "Re:Zero");
  const grouped = groupAnimeMetas([
    { id: "kitsu:8671", imdb_id: "tt2560140", name: "Attack on Titan Season 2", year: "2017" },
    { id: "kitsu:7442", imdb_id: "tt2560140", name: "Attack on Titan", year: "2013" },
    { id: "kitsu:12", imdb_id: "tt0388629", name: "One Piece", year: "1999" },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].id, "tt2560140");
  assert.equal(grouped[0].name, "Attack on Titan");
  assert.equal(grouped[0].year, "2013");
});

test("providers: TMDB primary for movie/series with Cinemeta fallback, TVDB grouped seasons for anime", async () => {
  setMetaKeys({ tmdbApiKey: "tmdb-key", tvdbApiKey: "tvdb-key" });
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("api.themoviedb.org/3/find/tt0133093")) {
      return new Response(JSON.stringify({ movie_results: [{ id: 603, title: "The Matrix" }] }));
    }
    if (u.includes("api.themoviedb.org/3/movie/603")) {
      return new Response(
        JSON.stringify({
          id: 603,
          title: "The Matrix",
          release_date: "1999-03-31",
          vote_average: 8.7,
          overview: "TMDB overview",
          runtime: 136,
          poster_path: "/p.jpg",
          backdrop_path: "/b.jpg",
          genres: [{ name: "Sci-Fi" }],
        }),
      );
    }
    if (u.includes("api.themoviedb.org/3/find/tt9999999")) {
      return new Response("err", { status: 500 });
    }
    if (u.includes("v3-cinemeta.strem.io/meta/movie/tt9999999.json")) {
      return new Response(JSON.stringify({ meta: { id: "tt9999999", name: "Fallback Movie", year: "2021" } }));
    }
    if (u.includes("api4.thetvdb.com/v4/login")) {
      return new Response(JSON.stringify({ data: { token: "tok" } }));
    }
    if (u.includes("api4.thetvdb.com/v4/search/remoteid/tt2560140")) {
      return new Response(JSON.stringify({ data: [{ series: { id: 267440, slug: "attack-on-titan" } }] }));
    }
    if (u.includes("api4.thetvdb.com/v4/series/267440/extended")) {
      return new Response(
        JSON.stringify({
          data: {
            id: 267440,
            firstAired: "2013-04-07",
            averageRuntime: 25,
            genres: [{ name: "Anime" }],
            translations: {
              nameTranslations: [{ language: "eng", name: "Attack on Titan", isAlias: false }],
              overviewTranslations: [{ language: "eng", overview: "Grouped anime overview" }],
            },
          },
        }),
      );
    }
    if (u.includes("api4.thetvdb.com/v4/series/267440/episodes/official/eng")) {
      return new Response(
        JSON.stringify({
          data: {
            episodes: [
              { id: 1, seasonNumber: 1, number: 1, absoluteNumber: 1, name: "Ep 1", aired: "2013-04-07" },
              { id: 2, seasonNumber: 2, number: 1, absoluteNumber: 26, name: "Beast Titan", aired: "2017-04-01" },
            ],
          },
        }),
      );
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const movie = await fetchMeta("movie", "tt0133093", fakeFetch);
  assert.equal(movie?.description, "TMDB overview");
  assert.equal(movie?.poster, "https://image.tmdb.org/t/p/w342/p.jpg");

  const fallback = await fetchMeta("movie", "tt9999999", fakeFetch);
  assert.equal(fallback?.name, "Fallback Movie");

  const anime = await fetchMeta("anime", "tt2560140", fakeFetch);
  assert.equal(anime?.name, "Attack on Titan");
  assert.equal(anime?.videos?.length, 2);
  assert.equal(anime?.videos?.[1].id, "tt2560140:2:1");
  assert.equal(anime?.videos?.[1].absoluteEpisode, 26);
  setMetaKeys({ tmdbApiKey: "", tvdbApiKey: "" });
});

test("fanart: resolves Fanart.tv movie and series artwork with automatic fallback to TMDB and Metahub when Fanart drops", async () => {
  clearFanartCache();
  setFanartKeys({ fanartApiKey: "fa-key", tmdbApiKey: "tmdb-key" });

  const fakeFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("webservice.fanart.tv/v3/movies/tt0133093")) {
      return new Response(
        JSON.stringify({
          moviebackground: [{ url: "https://assets.fanart.tv/matrix-bg.jpg", likes: "12", lang: "en" }],
          hdmovielogo: [{ url: "https://assets.fanart.tv/matrix-logo.png", likes: "5", lang: "en" }],
        }),
      );
    }
    if (u.includes("v3-cinemeta.strem.io/meta/series/tt2560140.json")) {
      return new Response(JSON.stringify({ meta: { tvdb_id: 267440 } }));
    }
    if (u.includes("webservice.fanart.tv/v3/tv/267440")) {
      return new Response(
        JSON.stringify({
          showbackground: [{ url: "https://assets.fanart.tv/aot-bg.jpg", likes: "20", lang: "en" }],
        }),
      );
    }
    // Simulate Fanart.tv dropping/failing for tt0000001
    if (u.includes("webservice.fanart.tv/v3/movies/tt0000001")) {
      return new Response("gateway timeout", { status: 504 });
    }
    if (u.includes("api.themoviedb.org/3/find/tt0000001")) {
      return new Response(JSON.stringify({ movie_results: [{ backdrop_path: "/tmdb-fallback.jpg" }] }));
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const movieArt = await resolveFrameArtwork("movie", { id: "tt0133093", name: "The Matrix" }, "fanart", fakeFetch);
  assert.equal(movieArt.provider, "Fanart.tv");
  assert.equal(movieArt.urls[0], "https://assets.fanart.tv/matrix-bg.jpg");
  assert.equal(movieArt.logoUrl, "https://assets.fanart.tv/matrix-logo.png");
  assert.ok(movieArt.urls.some((u) => u.includes("images.metahub.space/background/medium/tt0133093/img")));

  const animeArt = await resolveFrameArtwork("anime", { id: "tt2560140", name: "Attack on Titan" }, "fanart", fakeFetch);
  assert.equal(animeArt.provider, "Fanart.tv");
  assert.equal(animeArt.urls[0], "https://assets.fanart.tv/aot-bg.jpg");

  const droppedArt = await resolveFrameArtwork("movie", { id: "tt0000001", name: "Dropped" }, "fanart", fakeFetch);
  assert.equal(droppedArt.provider, "TMDB");
  assert.equal(droppedArt.urls[0], "https://image.tmdb.org/t/p/w1280/tmdb-fallback.jpg");
  assert.ok(droppedArt.urls.some((u) => u.includes("images.metahub.space/background/medium/tt0000001/img")));

  setFanartKeys({ fanartApiKey: "", tmdbApiKey: "", tvdbApiKey: "" });
});

test("settings & reminders: organized settings persist and reminders switch cleanly between Companion and Local mode", async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: () => null,
    length: 0,
  };

  // Auto dimming cycles and persists; keys from older builds (the Frame dashboard's) are dropped.
  const initial = loadSettings();
  assert.equal(initial.domotics.cinemaAutoDim, false);
  const dimDef = SETTING_ITEMS.find((i) => i.id === "domotics.cinemaAutoDim")!;
  assert.equal(saveSettings(dimDef.cycle(initial, 1)).domotics.cinemaAutoDim, true);
  assert.equal(loadSettings().domotics.cinemaAutoDim, true);
  const legacy = mergeSettings({ general: { startupView: "dashboard", accentTheme: "gold" } } as never);
  assert.deepEqual(Object.keys(legacy.general).sort(), ["accentTheme", "bootAnimation", "clockFormat"]);
  assert.equal(legacy.general.accentTheme, "gold");

  // Local mode uses localStorage without hitting the server
  const localRems = await fetchRemindersForMode("local", "http://server");
  assert.equal(localRems.items.length, 1);
  const afterToggle = await toggleReminderForMode("local", "http://server", localRems.items[0].id);
  assert.equal(afterToggle[0].completed, true);

  // Companion mode fetches and toggles on the server
  const fakeServerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u.endsWith("/reminders") && (!init?.method || init.method === "GET")) {
      return new Response(
        JSON.stringify({
          items: [{ id: "srv-1", text: "From Companion", completed: false, createdAt: 10 }],
          aiSummary: "Gemini summary active",
        }),
      );
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const compRems = await fetchRemindersForMode("companion", "http://server", fakeServerFetch);
  assert.equal(compRems.items[0].text, "From Companion");
  assert.equal(compRems.aiSummary, "Gemini summary active");
  saveSettings(DEFAULT_SETTINGS);
});

test("keys: Back fires once per press, repeats and quick doubles are dropped", () => {
  const f = createBackFilter();
  const down = { type: "keydown", keyCode: 10009, repeat: false };
  assert.equal(f(down, 1000), "escape");
  assert.equal(f(down, 1100), "drop");
  assert.equal(f({ ...down, repeat: true }, 2000), "drop");
  assert.equal(f({ ...down, type: "keyup" }, 2000), "drop");
  assert.equal(f(down, 2000), "escape");
  assert.equal(f({ type: "keydown", keyCode: 13, repeat: false }, 2000), "pass");
});

test("nuvio design system: parseStreamInfo extracts structured badges and size for Will Play & Sources Sheet", () => {
  const info4k = parseStreamInfo({
    name: "TorBox 2160p",
    title: "Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR10.HEVC.DDP5.1.Atmos.mkv · 18.4 GB",
    url: "http://s/resolve/1",
  });
  assert.equal(info4k.resolution, "4K");
  assert.equal(info4k.hdr, "DV");
  assert.equal(info4k.codec, "HEVC");
  assert.equal(info4k.audio, "ATMOS");
  assert.equal(info4k.size, "18.4 GB");
  assert.deepEqual(info4k.badges, ["4K", "DV", "HEVC", "ATMOS"]);

  const info1080 = parseStreamInfo({
    name: "TorBox 1080p",
    title: "The.Watchmakers.S02E05.1080p.WEB-DL.H264.AAC.mp4 (2,1 GB)",
    url: "http://s/resolve/2",
  });
  assert.equal(info1080.resolution, "1080p");
  assert.equal(info1080.codec, "AVC");
  assert.equal(info1080.audio, "AAC");
  assert.equal(info1080.container, "MP4");
  assert.equal(info1080.size, "2.1 GB");
  assert.deepEqual(info1080.badges, ["1080p", "AVC", "AAC", "MP4"]);
});

test("nuvio design system: accentTheme cycles and persists with contrast-aware ink", () => {
  const initial = loadSettings();
  assert.equal(initial.general.accentTheme, "raptor");

  const themeDef = SETTING_ITEMS.find((i) => i.id === "general.accentTheme")!;
  const roseSettings = saveSettings(themeDef.cycle(initial, 1));
  assert.equal(roseSettings.general.accentTheme, "rose");
  assert.equal(ACCENT_THEMES.rose.hex, "#ec407a");
  assert.equal(ACCENT_THEMES.rose.ink, "#ffffff");

  const blueSettings = saveSettings(themeDef.cycle(roseSettings, 1));
  assert.equal(blueSettings.general.accentTheme, "blue");
  assert.equal(ACCENT_THEMES.blue.ink, "#0d0f13");

  saveSettings(DEFAULT_SETTINGS);
});

test("nuvio collections & timelines: chronological vs release order and next-step progression", () => {
  const matrix = getSagaById("matrix-saga")!;
  assert.ok(matrix);

  // In chronological story order, The Animatrix is Step 2 (bridging Matrix 1 and Reloaded)
  const chronoView = computeSagaView(matrix, "chronological", ["tt0133093"]);
  assert.equal(chronoView.steps[0].id, "tt0133093");
  assert.equal(chronoView.steps[0].watched, true);
  assert.equal(chronoView.steps[1].id, "tt0328832"); // The Animatrix
  assert.equal(chronoView.steps[1].isNext, true);
  assert.equal(chronoView.nextStepIndex, 1);
  assert.equal(chronoView.watchedCount, 1);
  assert.equal(chronoView.totalCount, 5);
  assert.equal(chronoView.yearSpan, "1999 – 2021");

  // In theatrical release order, The Matrix Reloaded is Step 2 and The Animatrix is Step 3
  const releaseView = computeSagaView(matrix, "release", ["tt0133093"]);
  assert.equal(releaseView.steps[1].id, "tt0234215"); // The Matrix Reloaded
  assert.equal(releaseView.steps[1].isNext, true);
  assert.equal(releaseView.steps[2].id, "tt0328832"); // The Animatrix

  // Middle-earth: Hobbit is Step 1 in chronological order, Fellowship is Step 1 in release order
  const lotr = findSagaForTitle("tt0120737", "movie")!;
  assert.equal(lotr.id, "middle-earth");
  const lotrChrono = computeSagaView(lotr, "chronological", []);
  assert.equal(lotrChrono.steps[0].id, "tt0903624"); // An Unexpected Journey
  const lotrRelease = computeSagaView(lotr, "release", []);
  assert.equal(lotrRelease.steps[0].id, "tt0120737"); // Fellowship of the Ring
  assert.equal(formatRemainingRuntime(135), "2h 15m");
});

test("nuvio collections & timelines: watched state and pinned timeline rows on Home", () => {
  markTitleWatched("tt0133093", false);
  assert.equal(isTitleWatched("tt0133093"), false);
  assert.equal(toggleTitleWatched("tt0133093"), true);
  assert.equal(isTitleWatched("tt0133093"), true);

  const colRow = buildSagasRow("movie", ["tt0133093"]);
  assert.equal(colRow.rowKind, "collections");
  assert.ok(colRow.items.length >= 4);
  assert.equal(colRow.items[0].sagaId, "matrix-saga");
  assert.match(colRow.items[0].badge ?? "", /1 of 5 watched/);

  // Default pinned for movie is matrix-saga
  assert.equal(isSagaPinned("movie", "matrix-saga"), true);
  const pinnedRows = buildPinnedSagaRows("movie", ["tt0133093"]);
  assert.equal(pinnedRows.length, 1);
  assert.equal(pinnedRows[0].rowKind, "timeline");
  assert.equal(pinnedRows[0].items[0].sequenceNum, 1);
  assert.equal(pinnedRows[0].items[0].watched, true);
  assert.equal(pinnedRows[0].items[1].sequenceNum, 2);
  assert.equal(pinnedRows[0].items[1].isNextStep, true);

  // Pinning a second collection adds a second timeline row
  assert.equal(togglePinSaga("movie", "dune-saga"), true);
  assert.equal(buildPinnedSagaRows("movie", []).length, 2);
  // Restore default
  togglePinSaga("movie", "dune-saga");
  markTitleWatched("tt0133093", false);
});

test("remote channel rocker & search keys: keyName maps Tizen hardware codes and desktop aliases", () => {
  // ChannelUp: Tizen 427, desktop F3 & PageUp
  assert.equal(keyName({ keyCode: 427, key: "" }), "ChannelUp");
  assert.equal(keyName({ keyCode: 0, key: "F3" }), "ChannelUp");
  assert.equal(keyName({ keyCode: 0, key: "PageUp" }), "ChannelUp");

  // ChannelDown: Tizen 428, desktop F4 & PageDown
  assert.equal(keyName({ keyCode: 428, key: "" }), "ChannelDown");
  assert.equal(keyName({ keyCode: 0, key: "F4" }), "ChannelDown");
  assert.equal(keyName({ keyCode: 0, key: "PageDown" }), "ChannelDown");

  // Search & Voice Search: Tizen 405 (Yellow) / 10225 (Search), desktop F5 / '/' / F6
  assert.equal(keyName({ keyCode: 405, key: "" }), "Search");
  assert.equal(keyName({ keyCode: 0, key: "/" }), "Search");
  assert.equal(keyName({ keyCode: 10225, key: "" }), "SearchVoice");
  assert.equal(keyName({ keyCode: 0, key: "F6" }), "SearchVoice");

  // Color buttons
  assert.equal(keyName({ keyCode: 403, key: "" }), "Red");
  assert.equal(keyName({ keyCode: 404, key: "" }), "Green");
  assert.equal(keyName({ keyCode: 406, key: "" }), "Blue");

  // registerMediaKeys includes ChannelUp, ChannelDown, Search, and ColorF2Yellow
  assert.ok(SHORTCUT_KEYS.includes("ChannelUp"));
  assert.ok(SHORTCUT_KEYS.includes("ChannelDown"));
  assert.ok(SHORTCUT_KEYS.includes("Search"));
  const registered: string[] = [];
  const g = globalThis as { tizen?: unknown };
  const prevTizen = g.tizen;
  g.tizen = {
    tvinputdevice: {
      getSupportedKeys: () => [
        { name: "ChannelUp", code: 427 },
        { name: "ChannelDown", code: 428 },
        { name: "Search", code: 10225 },
      ],
      registerKey: (k: string) => registered.push(k),
    },
  };
  try {
    registerMediaKeys();
  } finally {
    g.tizen = prevTizen;
  }
  assert.ok(registered.includes("ChannelUp"));
  assert.ok(registered.includes("ChannelDown"));
  assert.ok(registered.includes("Search"));
});

test("spotlight: bootAnimation and recent searches persistence", () => {
  const settings = loadSettings();
  assert.equal(settings.general.bootAnimation, "standard");

  const bootItem = SETTING_ITEMS.find((i) => i.id === "general.bootAnimation")!;
  const cycledBoot = bootItem.cycle(settings, 1);
  assert.equal(cycledBoot.general.bootAnimation, "fade");

  // Recent searches deduplicate case-insensitively and cap at 8
  clearRecentSearches();
  assert.deepEqual(loadRecentSearches(), []);
  saveRecentSearch("Severance");
  saveRecentSearch("The Matrix");
  saveRecentSearch("severance"); // moves to front without duplicating
  assert.deepEqual(loadRecentSearches(), ["severance", "The Matrix"]);

  for (let i = 1; i <= 10; i++) {
    saveRecentSearch(`Query ${i}`);
  }
  const capped = loadRecentSearches();
  assert.equal(capped.length, 8);
  assert.equal(capped[0], "Query 10");
  clearRecentSearches();
  assert.deepEqual(loadRecentSearches(), []);
});

test("resume label: percent watched and time left, nothing near either end", async () => {
  const { resumeLabel } = await import("../src/lib/resume.ts");
  assert.equal(resumeLabel(600, 3600), "17% watched · 50 min left");
  assert.equal(resumeLabel(1200, 9000), "13% watched · 2 h 10 min left");
  assert.equal(resumeLabel(5, 3600), "");
  assert.equal(resumeLabel(3597, 3600), "");
  assert.equal(resumeLabel(100, 0), "");
});
