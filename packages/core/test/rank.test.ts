import { test } from "node:test";
import assert from "node:assert/strict";
import { createTorbox } from "../src/torbox.ts";
import { parseCaps, playsCodec } from "../src/caps.ts";
import { parseRelease, rank, score } from "../src/rank.ts";

test("cached beats uncached regardless of quality", () => {
  const out = rank([
    { hash: "a", name: "Movie 2160p HEVC", cached: false },
    { hash: "b", name: "Movie 720p x264", cached: true },
  ]);
  assert.equal(out[0].hash, "b");
});

test("prefers DD+ over DTS at equal resolution", () => {
  const out = rank([
    { hash: "dts", name: "Movie 1080p HEVC DTS", cached: true },
    { hash: "ddp", name: "Movie 1080p HEVC DDP", cached: true },
  ]);
  assert.equal(out[0].hash, "ddp");
});

test("penalises Dolby Vision without HDR10 fallback (including DoVi tag)", () => {
  const out = rank([
    { hash: "dv", name: "Movie 2160p HEVC DoVi", cached: true },
    { hash: "hdr", name: "Movie 2160p HEVC HDR DoVi", cached: true },
  ]);
  assert.equal(out[0].hash, "hdr");
});

test("multi-track release with both TrueHD and DDP is scored as playable DDP", () => {
  assert.equal(parseRelease("Movie.2160p.UHD.BluRay.TrueHD.7.1.Atmos.DDP.5.1.x265").audio, "ddp");
});

test("checkCached chunks large hash lists into batches of 100", async () => {
  const calls: string[] = [];
  const tb = createTorbox({
    apiKey: "k",
    fetch: (async (url: string) => {
      calls.push(url);
      const qs = new URL(url).searchParams.get("hash") ?? "";
      const list = qs.split(",").filter((_, i) => i === 0).map((hash) => ({ hash }));
      return new Response(JSON.stringify({ data: list }), { status: 200 });
    }) as typeof fetch,
  });
  const hashes = Array.from({ length: 150 }, (_, i) => `h${i}`);
  const cached = await tb.checkCached(hashes);
  assert.equal(calls.length, 2);
  assert.deepEqual([...cached], ["h0", "h100"]);
});

test("a Cyrillic-titled release ranks below an English one at higher quality", () => {
  const out = rank([
    { hash: "ru", name: "Игра престолов Game of Thrones 2160p HEVC DDP", cached: true },
    { hash: "en", name: "Game of Thrones 1080p HEVC DDP", cached: true },
  ]);
  assert.equal(out[0].hash, "en");
});

test("dual audio edges out an otherwise equal release", () => {
  const out = rank([
    { hash: "plain", name: "Show 1080p HEVC AAC", cached: true },
    { hash: "dual", name: "Show 1080p HEVC AAC Dual Audio", cached: true },
  ]);
  assert.equal(out[0].hash, "dual");
});

test("AV1 ranks below HEVC even at higher resolution", () => {
  const out = rank([
    { hash: "av1", name: "Movie 2160p AV1 DDP", cached: true },
    { hash: "hevc", name: "Movie 1080p HEVC DDP", cached: true },
  ]);
  assert.equal(out[0].hash, "hevc");
});

test("caps: AV1 goes last unless the TV decodes it; DTS is no penalty where it plays", () => {
  const list = [
    { hash: "av1", name: "Movie 2160p AV1", cached: true },
    { hash: "h264", name: "Movie 1080p x264", cached: true },
  ];
  assert.deepEqual(rank(list).map((c) => c.hash), ["h264", "av1"]);
  assert.deepEqual(rank(list, parseCaps("av1,hevc")).map((c) => c.hash), ["av1", "h264"]);
  const dts = { hash: "dts", name: "Movie 1080p DTS", cached: true };
  assert.equal(score(dts, parseCaps("dts")) - score(dts), 40);
  assert.deepEqual([...parseCaps("hevc  AV1,4k")], ["hevc", "av1", "4k"]);
  assert.ok(playsCodec("H264", parseCaps("")) && !playsCodec("HEVC", parseCaps("av1")) && playsCodec("hevc"));
});
