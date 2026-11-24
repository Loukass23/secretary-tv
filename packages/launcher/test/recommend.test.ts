import { test } from "node:test";
import assert from "node:assert/strict";
import type { SearchResult, WatchIntent } from "@secretary/assistant";
import { REC_MAX, recLine, recommend, recommendPrompt } from "../src/recommend.ts";

const hit = (type: SearchResult["type"], id: string): SearchResult => ({ type, title: { id, name: `Title ${id}`, year: "2024", rating: "7.1" } });

test("the prompt names the card's kind, then a genre on each press after the first", () => {
  assert.equal(recommendPrompt("movie"), "Recommend me some films");
  assert.equal(recommendPrompt("series"), "Recommend me some shows");
  assert.equal(recommendPrompt("anime"), "Recommend me some anime");
  assert.equal(recommendPrompt("movie", 1), "Recommend me some comedy films");
  assert.notEqual(recommendPrompt("series", 2), recommendPrompt("series", 1));
});

test("route() browses the card's kind and the picks leave out what the card already shows", async () => {
  const asked: WatchIntent[] = [];
  const find = async (i: WatchIntent) => {
    asked.push(i);
    return [hit("series", "tt01"), hit("movie", "tt02"), hit("series", "tt03"), hit("series", "tt03"), hit("series", "tt04")];
  };
  const r = await recommend("series", 0, new Set(["tt01"]), find);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].kind, "series");
  assert.equal(asked[0].term, undefined, "a browse, not a search for the words");
  assert.equal(r.status, "ready");
  assert.deepEqual(r.status === "ready" && r.items.map((x) => x.title.id), ["tt03", "tt04"], "other kinds, titles on the card and repeats are dropped");
});

test("a genre press asks in that genre", async () => {
  let got: WatchIntent | undefined;
  await recommend("movie", 1, new Set(), async (i) => ((got = i), [hit("movie", "tt09")]));
  assert.equal(got?.genre, "Comedy");
  assert.equal(got?.kind, "movie");
});

test("at most a row of picks", async () => {
  const many = Array.from({ length: 30 }, (_, k) => hit("anime", `dz:a${k}`));
  const r = await recommend("anime", 0, new Set(), async () => many);
  assert.equal(r.status === "ready" && r.items.length, REC_MAX);
});

test("nothing new is an empty answer, a failing catalog an error", async () => {
  const empty = await recommend("movie", 0, new Set(["tt01"]), async () => [hit("movie", "tt01")]);
  assert.equal(empty.status, "empty");
  const none = await recommend("movie", 0, new Set(), async () => []);
  assert.equal(none.status, "empty");
  const failed = await recommend("movie", 0, new Set(), async () => {
    throw new Error("offline");
  });
  assert.deepEqual(failed, { status: "error" });
});

test("the end bar says what is going on", () => {
  assert.equal(recLine(undefined, "films").title, "You're all caught up");
  assert.equal(recLine({ status: "loading" }, "films").title, "Asking the assistant…");
  assert.match(recLine({ status: "ready", items: [hit("movie", "tt01")], reply: "" }, "films").sub, /^1 films/);
  assert.equal(recLine({ status: "empty", reply: "" }, "films").title, "No new picks this time");
  assert.equal(recLine({ status: "error" }, "films").title, "Couldn't reach the assistant");
});
