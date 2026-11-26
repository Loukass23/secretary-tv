import { test } from "node:test";
import assert from "node:assert/strict";
import { asAnimeKind, isAnime, kindFor, onlyKind, typeLabel } from "../src/lib/animeguard.ts";
import type { CatalogType, Title } from "../src/lib/types.ts";

const ids = new Set(["tt100"]);
const t = (id: string, genre?: string[]): Title => ({ id, name: id, year: "2020", rating: "", genre });
const e = (type: CatalogType, title: Title) => ({ type, title });

test("anime: a kitsu id, or a listed IMDb id that is not known to be something else", () => {
  assert.ok(isAnime(t("kitsu:1"), ids));
  assert.ok(isAnime(t("tt100"), ids));
  assert.ok(isAnime(t("tt100", ["Animation"]), ids));
  assert.ok(!isAnime(t("tt100", ["Drama"]), ids));
  assert.ok(!isAnime(t("tt200", ["Animation"]), ids), "a cartoon the anime catalogs do not list stays in Shows");
});

test("anime stays off Shows and Cinema rows and Continue watching, and lands on Anime's", () => {
  const list = [e("series", t("tt100")), e("series", t("tt300")), e("movie", t("kitsu:9")), e("anime", t("kitsu:1"))];
  assert.deepEqual(onlyKind("series", list, ids).map((x) => x.title.id), ["tt300"]);
  assert.deepEqual(onlyKind("movie", list, ids).map((x) => x.title.id), []);
  assert.deepEqual(onlyKind("anime", list, ids).map((x) => x.title.id), ["tt100", "kitsu:9", "kitsu:1"]);
  assert.equal(asAnimeKind(list, ids)[1], list[1], "entries already right are kept as they are");
  assert.equal(kindFor("series", t("tt300"), ids), "series");
});

test("title page label: Anime, not Series, for an anime opened as a series", () => {
  assert.equal(typeLabel("series", t("tt100"), ids), "Anime");
  assert.equal(typeLabel("series", t("tt300"), ids), "Show");
  assert.equal(typeLabel("anime", t("tt300"), ids), "Anime");
  assert.equal(typeLabel("movie", t("tt300"), ids), "Film");
});
