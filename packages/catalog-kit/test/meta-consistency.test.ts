import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSynopsis, mergeMeta, ratingLabel, ratingOf, toTitle } from "../src/lib/cinemeta.ts";
import { isAnime, onlyKind } from "../src/lib/animeguard.ts";
import { loadAllResume } from "../src/lib/resume.ts";
import { seasonCount, seasonsLabel } from "../src/lib/titlepage.ts";
import type { CatalogType, Title } from "../src/lib/types.ts";

const store = new Map<string, string>();
(globalThis as { localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: (k) => void store.delete(k),
};

const t = (id: string, more: Partial<Title> = {}): Title => ({ id, name: id, year: "2020", rating: "", ...more });

test("one rating format: one decimal, a star, nothing for unknown", () => {
  assert.equal(ratingOf("7"), "7.0");
  assert.equal(ratingOf("7.35"), "7.3");
  assert.equal(ratingOf(8.25), "8.3");
  assert.equal(ratingOf(""), "");
  assert.equal(ratingOf("0"), "");
  assert.equal(ratingOf("n/a"), "");
  assert.equal(ratingLabel("8"), "★ 8.0");
  assert.equal(ratingLabel(undefined), "");
  assert.equal(toTitle({ imdb_id: "tt1", name: "A", imdbRating: "6" })?.rating, "6.0");
});

test("a synopsis loses its box-office lead-in, and only that", () => {
  assert.equal(cleanSynopsis("Currently in theaters. A thief takes one last job."), "A thief takes one last job.");
  assert.equal(cleanSynopsis("Now playing in theatres! A thief."), "A thief.");
  assert.equal(cleanSynopsis("CURRENTLY IN THEATERS - A thief."), "A thief.");
  assert.equal(cleanSynopsis("A thief is currently in theaters."), "A thief is currently in theaters.");
  assert.equal(cleanSynopsis("Currently in theaters."), undefined);
  // The review's film page (screen 10): an emoji, a hyphen and how long ago it came out.
  assert.equal(cleanSynopsis("🎬 Currently in theaters - Released 6 days ago\n\nA thief takes one last job."), "A thief takes one last job.");
  assert.equal(cleanSynopsis("🎬 Currently in theaters – Released yesterday. A thief."), "A thief.");
  assert.equal(cleanSynopsis("🍿 In theaters now | Released 2 weeks ago · A thief."), "A thief.");
  assert.equal(cleanSynopsis("Released 1 day ago - A thief."), "A thief.");
  assert.equal(cleanSynopsis("Released from prison, a thief takes one last job."), "Released from prison, a thief takes one last job.");
  assert.equal(toTitle({ imdb_id: "tt1", name: "A", description: "Currently in theaters. B." })?.description, "B.");
});

test("season count leaves out specials", () => {
  const v = (season: number) => ({ season });
  assert.equal(seasonCount([v(0), v(1), v(1), v(2), v(3)]), 3);
  assert.equal(seasonsLabel([v(0), v(1)]), "1 season");
  assert.equal(seasonsLabel([v(1), v(2)]), "2 seasons");
  assert.equal(seasonsLabel([v(0)]), "");
});

test("one name per title: a page keeps its card's name", () => {
  const card = t("tt1", { name: "Example Show", description: undefined });
  const page = mergeMeta(card, { ...card, name: "Example Show (2020)", description: "About it." });
  assert.equal(page.name, "Example Show");
  assert.equal(page.description, "About it.");
  assert.equal(mergeMeta(t("tt1", { name: "" }), { name: "Filled" }).name, "Filled", "an empty name is still filled");
});

test("the metadata's logo and Japanese origin are kept", () => {
  const m = toTitle({ imdb_id: "tt1", name: "A", logo: "https://example.com/logo.png", country: "Japan, United States", genre: ["Animation"] });
  assert.equal(m?.logo, "https://example.com/logo.png");
  assert.equal(m?.japanese, true);
  assert.equal(toTitle({ imdb_id: "tt1", name: "A", country: "United States" })?.japanese, undefined);
});

test("anime rule: Japanese animation is anime even when no anime list names it; a cartoon is not", () => {
  const none = new Set<string>();
  assert.ok(isAnime(t("tt1", { genre: ["Animation", "Action"], japanese: true }), none));
  assert.ok(!isAnime(t("tt2", { genre: ["Animation"] }), none), "a western cartoon stays in Shows");
  assert.ok(!isAnime(t("tt3", { genre: ["Drama"], japanese: true }), none), "Japanese live action stays in Shows");
});

test("anime rule: a title listed twice (as a series and as anime) is one entry under Anime", () => {
  const ids = new Set(["tt100"]);
  const e = (type: CatalogType, title: Title) => ({ type, title });
  const list = [e("anime", t("tt100")), e("series", t("tt100")), e("series", t("tt300"))];
  assert.deepEqual(onlyKind("anime", list, ids).map((x) => x.title.id), ["tt100"]);
  assert.deepEqual(onlyKind("series", list, ids).map((x) => x.title.id), ["tt300"]);
});

test("Continue watching: one entry per title, by id or by name with the season dropped", () => {
  const entry = (title: Title, updated: number) => ({ title, posSec: 60, durSec: 1400, updated });
  store.set("sectv.anime.resume.v2", JSON.stringify([entry(t("kitsu:7", { name: "Example Anime Season 2" }), 3)]));
  store.set(
    "sectv.series.resume.v2",
    JSON.stringify([entry(t("kitsu:8", { name: "Example Anime" }), 2), entry(t("tt5", { name: "Other" }), 1)]),
  );
  store.set("sectv.movie.resume.v2", JSON.stringify([entry(t("tt6", { name: "Sequel 2" }), 5), entry(t("tt7", { name: "Sequel" }), 4)]));
  const all = loadAllResume(new Set());
  assert.deepEqual(
    all.map((x) => `${x.type}:${x.title.id}`),
    ["movie:tt6", "movie:tt7", "anime:kitsu:7", "series:tt5"],
    "the anime saved as a series folds into the newer anime entry; films keep their numbers",
  );
});

test("a film's facts: released, country, saga and awards, only what the meta has", async () => {
  const { factLine, aboutFacts, releasedLabel } = await import("../src/lib/titlepage.ts");
  const { factsOf } = await import("../src/lib/cinemeta.ts");
  const f = factsOf({ released: "2026-11-20T00:00:00.000Z", country: "United States, United Kingdom, Canada", awards: "N/A", writer: "A Writer, B Writer" });
  assert.deepEqual(f, { writer: ["A Writer", "B Writer"], released: "2026-11-20", country: "United States, United Kingdom, Canada" });
  assert.equal(releasedLabel("2026-11-20"), "20 Nov 2026");
  assert.equal(factsOf({ country: "usa, uk" }).country, "USA, UK");
  assert.equal(releasedLabel("soon"), "");
  assert.equal(factLine(f, "The Example Saga"), "Released 20 Nov 2026 · United States, United Kingdom · Part of The Example Saga");
  assert.deepEqual(aboutFacts({ ...f, runtime: "120 min", rating: "7.4", director: ["One"] }).map((r) => r.label), ["Released", "Runtime", "Rating", "Director", "Writers", "Country"]);
});
