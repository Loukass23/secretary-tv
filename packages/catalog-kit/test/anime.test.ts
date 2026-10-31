import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundUrl, posterUrl, rowsFor, toTitle, toVideo } from "../src/lib/cinemeta.ts";
import { fileHintFor } from "../src/lib/episodes.ts";
import { createStreamClient, withHint } from "../src/lib/streams.ts";
import { isSeries, streamType } from "../src/lib/types.ts";

test("kitsu catalog items keep their kitsu id (not the unrelated imdb one) and their artwork", () => {
  const t = toTitle({
    id: "kitsu:7442",
    imdb_id: "tt2560140",
    name: "Attack on Titan",
    poster: "https://media.kitsu.app/anime/poster_images/7442/medium.jpg",
    background: "https://assets.fanart.tv/x.jpg",
    genres: ["Action"],
  });
  assert.equal(t?.id, "kitsu:7442");
  assert.deepEqual(t?.genre, ["Action"]);
  assert.equal(posterUrl(t!), "https://media.kitsu.app/anime/poster_images/7442/small.jpg");
  assert.equal(backgroundUrl(t!), "https://assets.fanart.tv/x.jpg");
});

test("imdb titles derive artwork from the id and drop catalog artwork urls", () => {
  const t = toTitle({ imdb_id: "tt1", name: "A", poster: "https://example/p.jpg" });
  assert.equal(t?.poster, undefined);
  assert.equal(posterUrl(t!), "https://images.metahub.space/poster/small/tt1/img");
});

test("ids of unknown kinds are dropped", () => {
  assert.equal(toTitle({ id: "mal:1", name: "x" }), null);
});

test("anime episodes keep imdb numbering and the running number", () => {
  const v = toVideo({ id: "kitsu:7442:3", season: 1, episode: 3, title: "T", imdbSeason: 1, imdbEpisode: 3, absoluteEpisode: 3 });
  assert.equal(v?.name, "T");
  assert.deepEqual(fileHintFor(v!), { season: 1, episode: 3, absolute: 3 });
});

test("only kitsu episodes get a file hint; the running number falls back to the episode number", () => {
  assert.equal(fileHintFor({ id: "tt1:1:2", season: 1, episode: 2, name: "" }), undefined);
  assert.deepEqual(fileHintFor({ id: "kitsu:12:5", season: 1, episode: 5, name: "" }), {
    season: undefined,
    episode: undefined,
    absolute: 5,
  });
});

test("withHint appends only the numbers that exist, with ? or &", () => {
  assert.equal(withHint("http://s/resolve/abc", { absolute: 5 }), "http://s/resolve/abc?a=5");
  assert.equal(withHint("http://s/resolve/abc/0?s=1&e=2", { absolute: 5 }), "http://s/resolve/abc/0?s=1&e=2&a=5");
  assert.equal(withHint("http://s/r", { season: 1, episode: 3, absolute: 3 }), "http://s/r?s=1&e=3&a=3");
  assert.equal(withHint("http://s/r", {}), "http://s/r");
});

test("stream client: the hint goes on every url and is part of the cache key", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    return new Response(JSON.stringify({ streams: [{ name: "n", title: "t", url: "http://s/resolve/abc" }] }));
  }) as unknown as typeof fetch;
  const c = createStreamClient("http://s", "series", f);
  const a = await c.get("kitsu:1:2", { absolute: 2 });
  const b = await c.get("kitsu:1:2", { absolute: 3 });
  assert.equal(a[0].url, "http://s/resolve/abc?a=2");
  assert.equal(b[0].url, "http://s/resolve/abc?a=3");
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes("/stream/series/kitsu%3A1%3A2.json"));
});

test("anime is a series catalog for streams and has its own rows", () => {
  assert.ok(isSeries("anime") && isSeries("series") && !isSeries("movie"));
  assert.equal(streamType("anime"), "series");
  assert.equal(streamType("movie"), "movie");
  assert.ok(rowsFor("anime").every((r) => r.url.includes("anime-kitsu.strem.fun")));
  assert.ok(rowsFor("movie").every((r) => r.url.includes("/movie/")));
});
