import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorText, parsePlayerMessage, SOURCE, stateName } from "../src/bridge.ts";
import { decodeNowPlaying, encodeNowPlaying, type NowPlaying, positionAt } from "../../tv-kit/src/now-playing.ts";
import { MUSIC_PLAYER_HTML } from "../../server/src/music.ts";
import { createApp } from "../../server/src/app.ts";
// @ts-expect-error plain .mjs without types
import { renderManifest, readApplicationId } from "../../tv-kit/scripts/manifest.mjs";

const msg = (m: object) => JSON.stringify({ src: SOURCE, ...m });

test("player page messages", () => {
  assert.deepEqual(parsePlayerMessage(msg({ ev: "ready" })), { ev: "ready" });
  assert.deepEqual(parsePlayerMessage(msg({ ev: "state", state: 1, t: 12.5, d: 200 })), { ev: "state", state: "playing", t: 12.5, d: 200 });
  assert.deepEqual(parsePlayerMessage(msg({ ev: "time", t: -1, d: "x" })), { ev: "time", t: 0, d: 0 });
  assert.deepEqual(parsePlayerMessage(msg({ ev: "error", code: 150 })), { ev: "error", code: 150 });
});

test("messages from anything else are ignored", () => {
  assert.equal(parsePlayerMessage(JSON.stringify({ ev: "ready" })), null);
  assert.equal(parsePlayerMessage(msg({ ev: "other" })), null);
  assert.equal(parsePlayerMessage("not json"), null);
  assert.equal(parsePlayerMessage({ src: SOURCE, ev: "ready" }), null);
});

test("YouTube states and errors", () => {
  assert.equal(stateName(-1), "unstarted");
  assert.equal(stateName(0), "ended");
  assert.equal(stateName(2), "paused");
  assert.equal(stateName(3), "buffering");
  assert.equal(stateName(5), "cued");
  assert.equal(stateName(42), "unstarted");
  assert.match(errorText(150), /outside YouTube/);
  assert.match(errorText(100), /removed/);
});

test("the server's player page speaks the same protocol", () => {
  assert.ok(MUSIC_PLAYER_HTML.includes(`var SRC = "${SOURCE}"`));
  for (const cmd of ["load", "play", "pause", "seek", "stop"]) assert.ok(MUSIC_PLAYER_HTML.includes(`c.cmd === "${cmd}"`), cmd);
  for (const ev of ["ready", "state", "time", "error"]) assert.ok(MUSIC_PLAYER_HTML.includes(`ev: "${ev}"`), ev);
});

test("the server serves the player page, keyed when hosted", async () => {
  const home = createApp({ apiKey: "k", baseUrl: "http://192.0.2.10:7000", upstream: "" });
  const res = await home(new Request("http://192.0.2.10:7000/music/player"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(await res.text(), MUSIC_PLAYER_HTML);
  const key = "k".repeat(32);
  const hosted = createApp({ apiKey: "k", baseUrl: `https://example.com/${key}`, upstream: "", key });
  assert.equal((await hosted(new Request("https://example.com/music/player"))).status, 404);
  assert.equal((await hosted(new Request(`https://example.com/${key}/music/player`))).status, 200);
});

const record: NowPlaying = {
  v: 1,
  title: "Song A",
  artist: "Artist One",
  cover: "https://i.ytimg.com/vi/vid00000001/hqdefault.jpg",
  posSec: 30,
  durSec: 200,
  state: "playing",
  updated: 1_000_000,
};

test("now-playing record round trip", () => {
  assert.deepEqual(decodeNowPlaying(encodeNowPlaying(record)), record);
  assert.equal(encodeNowPlaying(null), "");
  assert.equal(decodeNowPlaying(""), null);
  assert.equal(decodeNowPlaying("{bad"), null);
  assert.equal(decodeNowPlaying(JSON.stringify({ ...record, v: 2 })), null);
  assert.equal(decodeNowPlaying(JSON.stringify({ ...record, state: "rewinding" })), null);
  assert.deepEqual(decodeNowPlaying(JSON.stringify({ ...record, posSec: -5, artist: 7 })), { ...record, posSec: 0, artist: "" });
});

test("now-playing position moves on only while playing", () => {
  assert.equal(positionAt(record, 1_010_000), 40);
  assert.equal(positionAt(record, 2_000_000), 200);
  assert.equal(positionAt({ ...record, state: "paused" }, 1_010_000), 30);
});

test("the manifest gets the music package id", () => {
  const tpl = readFileSync(new URL("../tizen/config.xml.tpl", import.meta.url), "utf8");
  const xml = renderManifest(tpl, { packageId: "ScrtMusics", version: "0.0.1" });
  assert.equal(readApplicationId(xml), "ScrtMusics.Music");
  assert.throws(() => renderManifest(tpl, { packageId: "ScrtMusic", version: "0.0.1" }), /10 letters/);
});
