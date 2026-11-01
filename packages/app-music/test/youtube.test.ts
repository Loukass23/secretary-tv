import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiError,
  cleanChannel,
  type Cache,
  createYouTube,
  formatTime,
  mergeDetails,
  parseDetails,
  parseDuration,
  parsePlaylistItems,
  parseSearchPlaylists,
  parseSearchVideos,
  parseVideos,
  regionOf,
  splitTitle,
  unescapeHtml,
} from "../src/youtube.ts";

const thumbs = (id: string) => ({
  medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
  high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
});

test("durations in ISO 8601", () => {
  assert.equal(parseDuration("PT3M12S"), 192);
  assert.equal(parseDuration("PT1H2M"), 3720);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("P1DT2S"), 86402);
  assert.equal(parseDuration("P0D"), 0);
  assert.equal(parseDuration(undefined), 0);
  assert.equal(parseDuration("3:12"), 0);
});

test("times as the player shows them", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(192.7), "3:12");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(-4), "0:00");
});

test("HTML entities from search.list", () => {
  assert.equal(unescapeHtml("Rock &amp; Roll &#39;Live&#39; &quot;x&quot;"), `Rock & Roll 'Live' "x"`);
  assert.equal(unescapeHtml("caf&#233; &#x2665;"), "café ♥");
  assert.equal(unescapeHtml("&unknown;"), "&unknown;");
});

test("channel names lose Topic and VEVO", () => {
  assert.equal(cleanChannel("Artist One - Topic"), "Artist One");
  assert.equal(cleanChannel("ArtistOneVEVO"), "ArtistOne");
  assert.equal(cleanChannel("Artist One Official"), "Artist One");
  assert.equal(cleanChannel("Band Two Music"), "Band Two");
});

test("titles split into song and artist", () => {
  assert.deepEqual(splitTitle("Artist One - Song A (Official Music Video)", "ArtistOneVEVO"), {
    title: "Song A",
    artist: "Artist One",
  });
  assert.deepEqual(splitTitle("Artist One – Song B [4K] (Lyrics)", "x"), { title: "Song B", artist: "Artist One" });
  assert.deepEqual(splitTitle("Song C", "Artist Two - Topic"), { title: "Song C", artist: "Artist Two" });
  // A bracket that is part of the song stays.
  assert.deepEqual(splitTitle("Song D (Acoustic)", "Artist Two"), { title: "Song D (Acoustic)", artist: "Artist Two" });
  assert.deepEqual(splitTitle("Rock &amp; Roll - Song E", "x"), { title: "Song E", artist: "Rock & Roll" });
});

test("videos.list: trending tracks, without what cannot be embedded or is live", () => {
  const tracks = parseVideos({
    items: [
      {
        id: "vid00000001",
        snippet: { title: "Artist One - Song A (Official Video)", channelTitle: "ArtistOneVEVO", thumbnails: thumbs("vid00000001") },
        contentDetails: { duration: "PT3M30S" },
        status: { embeddable: true },
      },
      {
        id: "vid00000002",
        snippet: { title: "Song B", channelTitle: "Artist Two", thumbnails: {} },
        contentDetails: { duration: "PT4M" },
        status: { embeddable: false },
      },
      {
        id: "vid00000003",
        snippet: { title: "Live radio", channelTitle: "Station" },
        contentDetails: { duration: "P0D" },
        status: { embeddable: true },
      },
      { snippet: { title: "no id" } },
    ],
  });
  assert.deepEqual(tracks, [
    {
      id: "vid00000001",
      title: "Song A",
      artist: "Artist One",
      thumb: "https://i.ytimg.com/vi/vid00000001/mqdefault.jpg",
      cover: "https://i.ytimg.com/vi/vid00000001/hqdefault.jpg",
      durSec: 210,
    },
  ]);
  assert.deepEqual(parseVideos(null), []);
  assert.deepEqual(parseVideos({ error: {} }), []);
});

test("thumbnails fall back to the video's own URLs", () => {
  const [t] = parseSearchVideos({ items: [{ id: { kind: "youtube#video", videoId: "vid00000004" }, snippet: { title: "Song", channelTitle: "A" } }] });
  assert.equal(t.thumb, "https://i.ytimg.com/vi/vid00000004/mqdefault.jpg");
  assert.equal(t.cover, "https://i.ytimg.com/vi/vid00000004/hqdefault.jpg");
  assert.equal(t.durSec, 0);
});

test("search.list: videos and playlists", () => {
  const json = {
    items: [
      { id: { kind: "youtube#video", videoId: "vid00000005" }, snippet: { title: "Artist &amp; Co - Song F", channelTitle: "Artist", thumbnails: thumbs("vid00000005") } },
      { id: { kind: "youtube#playlist", playlistId: "PL0000000001" }, snippet: { title: "Mix &amp; Match", channelTitle: "Curator - Topic", thumbnails: thumbs("x") } },
    ],
  };
  assert.deepEqual(
    parseSearchVideos(json).map((t) => [t.id, t.title, t.artist]),
    [["vid00000005", "Song F", "Artist & Co"]],
  );
  assert.deepEqual(parseSearchPlaylists(json), [
    { id: "PL0000000001", title: "Mix & Match", channel: "Curator", thumb: "https://i.ytimg.com/vi/x/mqdefault.jpg" },
  ]);
});

test("playlistItems.list keeps order and drops deleted and private videos", () => {
  const tracks = parsePlaylistItems({
    items: [
      { snippet: { title: "Song G", videoOwnerChannelTitle: "Artist Three - Topic", channelTitle: "Curator", resourceId: { videoId: "vid00000007" } } },
      { snippet: { title: "Deleted video", resourceId: { videoId: "vid00000008" } } },
      { snippet: { title: "Private video", resourceId: { videoId: "vid00000009" } }, status: { privacyStatus: "private" } },
      { snippet: { title: "Song H", channelTitle: "Curator", resourceId: { videoId: "vid00000010" } } },
    ],
  });
  assert.deepEqual(
    tracks.map((t) => [t.id, t.artist]),
    [
      ["vid00000007", "Artist Three"],
      ["vid00000010", "Curator"],
    ],
  );
});

test("details add durations and drop what videos.list left out", () => {
  const details = parseDetails({
    items: [
      { id: "b", contentDetails: { duration: "PT2M" }, status: { embeddable: true } },
      { id: "c", contentDetails: { duration: "PT3M" }, status: { embeddable: false } },
      { id: "a", contentDetails: { duration: "PT1M" }, status: { embeddable: true } },
    ],
  });
  const t = (id: string) => ({ id, title: id, artist: "", thumb: "", cover: "", durSec: 0 });
  assert.deepEqual(
    mergeDetails([t("a"), t("b"), t("c"), t("d")], details).map((x) => [x.id, x.durSec]),
    [
      ["a", 60],
      ["b", 120],
    ],
  );
});

test("API errors read as one line", () => {
  assert.equal(apiError({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403), "The YouTube key has used up today's quota.");
  assert.equal(apiError({ error: { errors: [{ reason: "keyInvalid" }] } }, 400), "The YouTube key was refused.");
  assert.equal(apiError({ error: { message: "Forbidden &amp; more" } }, 403), "Forbidden & more");
  assert.equal(apiError(null, 503), "YouTube answered 503.");
});

test("region from the TV's language", () => {
  assert.equal(regionOf("de-DE"), "DE");
  assert.equal(regionOf("en_gb"), "GB");
  assert.equal(regionOf("fr"), "US");
  assert.equal(regionOf(undefined), "US");
});

function memory(): Cache & { keys: string[] } {
  const m = new Map<string, unknown>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => void m.set(k, v),
    get keys() {
      return [...m.keys()];
    },
  };
}

test("search asks for embeddable music videos, then their durations, and caches the answer", async () => {
  const calls: URL[] = [];
  const f = async (input: string | URL | Request) => {
    const u = new URL(String(input));
    calls.push(u);
    const body = u.pathname.endsWith("/search")
      ? { items: [{ id: { videoId: "vid00000011" }, snippet: { title: "Artist - Song", channelTitle: "Artist" } }] }
      : { items: [{ id: "vid00000011", contentDetails: { duration: "PT3M" }, status: { embeddable: true } }] };
    return new Response(JSON.stringify(body));
  };
  const cache = memory();
  const yt = createYouTube("test-key", cache, f as typeof fetch);
  const first = await yt.searchTracks("Some Song");
  assert.deepEqual(first.map((t) => [t.id, t.durSec]), [["vid00000011", 180]]);
  const [search, videos] = calls;
  assert.equal(search.searchParams.get("type"), "video");
  assert.equal(search.searchParams.get("videoCategoryId"), "10");
  assert.equal(search.searchParams.get("videoEmbeddable"), "true");
  assert.equal(search.searchParams.get("key"), "test-key");
  assert.equal(videos.searchParams.get("id"), "vid00000011");
  assert.deepEqual(await yt.searchTracks("some song"), first);
  assert.equal(calls.length, 2);
  assert.deepEqual(cache.keys, ["tracks:some song"]);
});

test("a refused request becomes a readable error and is not cached", async () => {
  const f = async () => new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 });
  const cache = memory();
  const yt = createYouTube("k", cache, f as typeof fetch);
  await assert.rejects(yt.trending("US"), /quota/);
  assert.deepEqual(cache.keys, []);
});
