import { test } from "node:test";
import assert from "node:assert/strict";
import { episodeHint, matchesAbsolute, matchesEpisode, pickFile } from "../src/files.ts";

test("episode hint comes from a series id and not from a movie id", () => {
  assert.deepEqual(episodeHint("tt0944947:1:2"), { season: 1, episode: 2 });
  assert.equal(episodeHint("tt0133093"), null);
});

test("episode names: S01E02, s1e2, 1x02 match; E20, S01E12 and S10E02 do not", () => {
  assert.ok(matchesEpisode("Show.S01E02.1080p.mkv", 1, 2));
  assert.ok(matchesEpisode("show s1e2 web.mkv", 1, 2));
  assert.ok(matchesEpisode("Show 1x02.mkv", 1, 2));
  assert.ok(!matchesEpisode("Show.S01E20.mkv", 1, 2));
  assert.ok(!matchesEpisode("Show.S01E12.mkv", 1, 2));
  assert.ok(!matchesEpisode("Show.S10E02.mkv", 1, 2));
});

const pack = [
  { id: 0, name: "Show.S01E01.mkv", size: 300 },
  { id: 1, name: "Show.S01E02.mkv", size: 100 },
  { id: 2, name: "Show.S01E02.sample.mkv", size: 10 },
  { id: 3, name: "readme.txt", size: 1 },
  { id: 4, name: "Show.S01E03.mkv", size: 500 },
];

test("a season pack plays the requested episode, not the largest file", () => {
  assert.equal(pickFile(pack, 0, { season: 1, episode: 2 })?.id, 1);
  assert.equal(pickFile(pack, undefined, { season: 1, episode: 3 })?.id, 4);
});

test("without a hint the upstream index is used when it is a video, else the largest video", () => {
  assert.equal(pickFile(pack, 1, null)?.id, 1);
  assert.equal(pickFile(pack, 3, null)?.id, 4);
  assert.equal(pickFile(pack, undefined, null)?.id, 4);
});

test("anime running numbers: ' - 05' matches 5, not 50, 15, a resolution, a hash or a codec", () => {
  assert.ok(matchesAbsolute("[FansubGroup] One Piece - 05 (1080p) [ABCD1234].mkv", 5));
  assert.ok(matchesAbsolute("[Group] Show - 1100 [1080p].mkv", 1100));
  assert.ok(!matchesAbsolute("[FansubGroup] One Piece - 50 (1080p) [ABCD1234].mkv", 5));
  assert.ok(!matchesAbsolute("[FansubGroup] One Piece - 15 (1080p).mkv", 5));
  assert.ok(!matchesAbsolute("[G] Show - 02 [1080p x265 10bit AAC 2.0].mkv", 10));
  assert.ok(!matchesAbsolute("[G] Show - 02 [1080p x265 10bit AAC 2.0].mkv", 265));
  assert.ok(matchesAbsolute("Season 1/[Trix] Shingeki no Kyojin S01E03 (03) (BD 1080p).mkv", 3));
  assert.ok(matchesAbsolute("Show.EP07.mkv", 7));
});

const animePack = [
  { id: 0, name: "[G] Show - 01 [1080p].mkv", size: 300 },
  { id: 1, name: "[G] Show - 02 [1080p].mkv", size: 100 },
  { id: 2, name: "[G] Show - 12 [1080p].mkv", size: 900 },
  { id: 3, name: "[G] Show - 02 [1080p].sample.mkv", size: 1 },
];

test("an anime batch plays the requested running number, ignoring bigger neighbours", () => {
  assert.equal(pickFile(animePack, undefined, { absolute: 2 })?.id, 1);
  assert.equal(pickFile(animePack, undefined, { absolute: 12 })?.id, 2);
});

test("season and episode win over the running number when both match files", () => {
  const files = [
    { id: 0, name: "Show.S01E02.mkv", size: 100 },
    { id: 1, name: "Show.S02E02.mkv", size: 400 },
  ];
  assert.equal(pickFile(files, undefined, { season: 1, episode: 2, absolute: 2 })?.id, 0);
});

const ROOT = "[Anime Time] Attack On Titan (Complete Collection) (S01-S04+OVA+Movies+Junior High) [BD] [Dual Audio][1080p][HEVC 10bit x265][AAC][Eng Sub]";
const collection = [
  { id: 0, name: `${ROOT}/Attack on Titan – FawFaw Subtitles.docx`, size: 1 },
  { id: 85, name: `${ROOT}/Attack on Titan Season 1/[Anime Time] Attack on Titan - 01.mkv`, size: 571 },
  { id: 74, name: `${ROOT}/Attack on Titan Season 1/[Anime Time] Attack on Titan - 03.mkv`, size: 456 },
  { id: 115, name: `${ROOT}/Attack on Titan Season 3/[Anime Time] Attack on Titan - 41.mkv`, size: 470 },
  { id: 96, name: `${ROOT}/Attack On Titan Movies/[Anime Time] Attack on Titan Movie  03 - Kakusei no Houkou.mkv`, size: 2880 },
  { id: 20, name: `${ROOT}/Attack On Titan Junior High/[Anime Time] Junior High - 03.mkv`, size: 300 },
  { id: 62, name: `${ROOT}/Attack on Titan Season 4/Extras/[Anime Time] Creditless Ending 3.mkv`, size: 35 },
];

test("a collection with running numbers: the season folder's file wins over a bigger movie 03 and extras", () => {
  const hint = { season: 1, episode: 3, absolute: 3 };
  assert.equal(pickFile(collection, 21, hint)?.id, 74);
});

test("a collection numbered across seasons finds episode 41 in the season 3 folder", () => {
  assert.equal(pickFile(collection, undefined, { season: 3, episode: 15, absolute: 41 })?.id, 115);
});

test("a file that only a movie or extra folder matches never wins through the hint", () => {
  const files = [
    { id: 1, name: `${ROOT}/Attack On Titan Movies/Movie 05.mkv`, size: 3000 },
    { id: 2, name: `${ROOT}/Attack on Titan Season 1/Attack on Titan - 05.mkv`, size: 500 },
  ];
  assert.equal(pickFile(files, undefined, { absolute: 5 })?.id, 2);
});

test("per-season anime names like 'S1 - 03' match their own season only", () => {
  assert.ok(matchesEpisode("[Judas] Shingeki no Kyojin S1 - 03.mkv", 1, 3));
  assert.ok(!matchesEpisode("[Judas] Shingeki no Kyojin S2 - 03.mkv", 1, 3));
  assert.ok(matchesEpisode("Show Season 2 - 07.mkv", 2, 7));
  const files = [
    { id: 1, name: "[J] Show S1 - 03.mkv", size: 100 },
    { id: 2, name: "[J] Show S2 - 03.mkv", size: 900 },
  ];
  assert.equal(pickFile(files, undefined, { season: 1, episode: 3, absolute: 3 })?.id, 1);
});

test("an episode no file names falls back to the old rules", () => {
  assert.equal(pickFile(pack, undefined, { season: 2, episode: 9 })?.id, 4);
});
