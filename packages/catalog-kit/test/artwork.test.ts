import { test } from "node:test";
import assert from "node:assert/strict";
import { ART_MAX, cachedTitleArt, clearArtCache, setFanartKeys, titleArt } from "../src/lib/fanart.ts";

// localStorage for the cache's stored copy (tv-kit storage.ts reads it).
const saved = new Map<string, string>();
(globalThis as { localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> }).localStorage = {
  getItem: (k) => saved.get(k) ?? null,
  setItem: (k, v) => void saved.set(k, v),
  removeItem: (k) => void saved.delete(k),
};

const FA = "https://assets.fanart.tv/fanart";
const json = (body: unknown) => new Response(JSON.stringify(body));

/** Recorded-style answers: a film and a show Fanart.tv knows, a film it does not, a show only Kitsu maps. */
function fakeFetch(calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    if (u.includes("webservice.fanart.tv/v3/movies/tt0000101?"))
      return json({
        hdmovielogo: [
          { url: `${FA}/movies/101/hdmovielogo/fr.png`, lang: "fr", likes: "9" },
          { url: `${FA}/movies/101/hdmovielogo/en.png`, lang: "en", likes: "2" },
        ],
        hdmovieclearart: [{ url: `${FA}/movies/101/hdmovieclearart/a.png`, lang: "en" }],
        moviethumb: [{ url: `${FA}/movies/101/moviethumb/t.jpg`, lang: "en" }],
        moviebackground: [
          { url: `${FA}/movies/101/moviebackground/b1.jpg`, likes: "1" },
          { url: `${FA}/movies/101/moviebackground/b2.jpg`, likes: "7" },
        ],
      });
    if (u.includes("v3-cinemeta.strem.io/meta/series/tt0000202.json")) return json({ meta: { tvdb_id: 9202 } });
    if (u.includes("anime-kitsu.strem.fun/meta/series/kitsu:303.json")) return json({ meta: { tvdb_id: 9303 } });
    if (u.includes("webservice.fanart.tv/v3/tv/9202?"))
      return json({ hdtvlogo: [{ url: `${FA}/tv/9202/hdtvlogo/l.png`, lang: "en" }], showbackground: [{ url: `${FA}/tv/9202/showbackground/b.jpg` }] });
    if (u.includes("webservice.fanart.tv/v3/tv/9303?")) return json({ tvthumb: [{ url: `${FA}/tv/9303/tvthumb/t.jpg`, lang: "00" }], showbackground: [{ url: `${FA}/tv/9303/showbackground/b.jpg` }] });
    if (u.includes("webservice.fanart.tv")) return new Response("gateway timeout", { status: 504 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

test("artwork: Fanart.tv first, each image at the size it is shown", async () => {
  clearArtCache();
  setFanartKeys({ fanartApiKey: "test-key" });
  const calls: string[] = [];
  const film = { id: "tt0000101", logo: "https://example.com/meta-logo.png" };
  const hero = await titleArt("movie", film, "hero", fakeFetch(calls));
  assert.equal(hero.logo, `${FA}/movies/101/hdmovielogo/en.png`, "English before a better-liked French logo");
  assert.equal(hero.background, `${FA}/movies/101/moviebackground/b2.jpg`, "the most liked");
  assert.equal(hero.clearArt, `${FA}/movies/101/hdmovieclearart/a.png`);
  assert.equal(hero.thumb, `${FA}/movies/101/moviethumb/t.jpg`);

  const card = await titleArt("movie", film, "card", fakeFetch(calls));
  assert.equal(card.logo, "https://assets.fanart.tv/preview/movies/101/hdmovielogo/en.png", "a card's logo is the preview");
  assert.equal(card.background, `${FA}/movies/101/moviethumb/t.jpg`, "a card never gets the 1920 px background");
  assert.equal(card.poster, "https://images.metahub.space/poster/small/tt0000101/img");
  assert.equal(card.plain, "https://images.metahub.space/background/medium/tt0000101/img", "a thumb has the logo painted in: the tile under a logo gets the textless backdrop");
  assert.equal(calls.length, 1, "one lookup per title: the second size came from the cache");
});

test("artwork: shows go by TVDB id, from Cinemeta for IMDb ids and from Kitsu for Kitsu ids", async () => {
  clearArtCache();
  setFanartKeys({ fanartApiKey: "test-key" });
  const calls: string[] = [];
  const show = await titleArt("series", { id: "tt0000202" }, "hero", fakeFetch(calls));
  assert.equal(show.logo, `${FA}/tv/9202/hdtvlogo/l.png`);
  assert.equal(show.background, `${FA}/tv/9202/showbackground/b.jpg`);
  assert.equal(show.thumb, `${FA}/tv/9202/showbackground/b.jpg`, "a hero without a thumb uses the background");

  const anime = await titleArt("anime", { id: "kitsu:303", poster: "https://media.kitsu.app/anime/poster_images/303/medium.jpg" }, "card", fakeFetch(calls));
  assert.equal(anime.logo, undefined, "no logo anywhere: the screen shows the name");
  assert.equal(anime.thumb, `${FA}/tv/9303/tvthumb/t.jpg`);
  assert.equal(anime.plain, `${FA}/tv/9303/showbackground/b.jpg`, "a Kitsu title without a backdrop: Fanart.tv's textless background");
  assert.equal(anime.poster, "https://media.kitsu.app/anime/poster_images/303/small.jpg");
});

test("artwork: without Fanart.tv, the metadata's logo and today's art", async () => {
  clearArtCache();
  setFanartKeys({ fanartApiKey: "test-key" });
  const calls: string[] = [];
  const t = { id: "tt0000404", logo: "https://example.com/meta-logo.png", background: "https://image.tmdb.org/t/p/w1280/bg.jpg" };
  const card = await titleArt("movie", t, "card", fakeFetch(calls));
  assert.equal(card.logo, "https://example.com/meta-logo.png");
  assert.equal(card.thumb, "https://image.tmdb.org/t/p/w780/bg.jpg", "TMDB asked at card size");
  assert.equal((await titleArt("movie", t, "hero", fakeFetch(calls))).background, "https://image.tmdb.org/t/p/w1280/bg.jpg");
  assert.equal(calls.length, 1, "a miss is cached too");

  const plain = cachedTitleArt("movie", { id: "tt0000505" }, "hero");
  assert.equal(plain.background, "https://images.metahub.space/background/medium/tt0000505/img", "nothing cached yet: today's art at once");

  setFanartKeys({ fanartApiKey: "" });
  clearArtCache();
  const noKey: string[] = [];
  await titleArt("movie", { id: "tt0000101" }, "card", fakeFetch(noKey));
  assert.equal(noKey.length, 0, "no key, no request");
});

test("artwork: the cache keeps the newest ART_MAX titles and expires", async () => {
  clearArtCache();
  setFanartKeys({ fanartApiKey: "test-key" });
  const calls: string[] = [];
  const f = fakeFetch(calls);
  const now = 1_000_000;
  for (let i = 0; i <= ART_MAX; i++) await titleArt("movie", { id: `tt9${i}` }, "card", f, now);
  calls.length = 0;
  await titleArt("movie", { id: `tt9${ART_MAX}` }, "card", f, now);
  assert.equal(calls.length, 0, "the newest is kept");
  await titleArt("movie", { id: "tt90" }, "card", f, now);
  assert.equal(calls.length, 1, "the oldest was dropped past the cap");
  await titleArt("movie", { id: "tt90" }, "card", f, now + 2 * 864e5);
  assert.equal(calls.length, 2, "an empty answer is asked again after a day");
  setFanartKeys({ fanartApiKey: "" });
});
