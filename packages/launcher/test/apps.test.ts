import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeFor, visibleApps, type RawApp } from "../src/apps.ts";

const raw: RawApp[] = [
  { id: "AbCdEfGhIj.Youtube", name: "YouTube" },
  { id: "ScrtMovies.Movies", name: "Secretary Cinema" },
  { id: "org.tizen.some-service", name: "Some Service" },
  { id: "1234567890.Hidden", name: "Hidden", show: false },
  { id: "3201606009684", name: "Netflix" },
  { id: "XyZxYzXyZx.Worker", name: "Sync Worker" },
  { id: "ScrtLaunch.Launcher", name: "Secretary Nest" },
  { id: "AbCdEfGhIk.Alpha", name: "Alpha" },
];

test("internals are dropped, pins come first, the rest is alphabetical", () => {
  const out = visibleApps(raw, { pins: ["ScrtMovies.Movies"], hide: [], self: "ScrtLaunch.Launcher" });
  assert.deepEqual(out.map((a) => a.name), ["Secretary Cinema", "Alpha", "Netflix", "YouTube"]);
});

test("a pin that is not installed is skipped, and hide wins over the filters", () => {
  const out = visibleApps(raw, { pins: ["Nope123456.Missing"], hide: ["3201606009684"], self: undefined });
  assert.ok(!out.some((a) => a.id === "3201606009684"));
  assert.ok(!out.some((a) => a.id === "Nope123456.Missing"));
});

test("the launcher never lists itself", () => {
  const out = visibleApps(raw, { pins: ["ScrtLaunch.Launcher"], hide: [], self: "ScrtLaunch.Launcher" });
  assert.ok(!out.some((a) => a.id === "ScrtLaunch.Launcher"));
});

test("badgeFor formats movie years, in-progress episode codes, and Up Next episodes", () => {
  assert.equal(badgeFor({ type: "movie", title: { id: "tt1", name: "M", year: "2026", rating: "" } }), "Movie · 2026");
  assert.equal(
    badgeFor({ type: "anime", posSec: 420, episode: { id: "k:1", season: 1, episode: 5, name: "Ep 5" } }),
    "Anime · S01E05",
  );
  assert.equal(
    badgeFor({ type: "series", posSec: 0, episode: { id: "tt1:2:4", season: 2, episode: 4, name: "Ep 4" } }),
    "Next · S02E04",
  );
});
