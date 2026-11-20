import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseYears, titleMatch } from "../src/lib/titlematch.ts";
import { rankSources } from "../src/lib/rules.ts";
import { animeImdbIds, resetAnimeGuard, withoutAnime } from "../src/lib/animeguard.ts";
import type { Stream } from "../src/lib/streams.ts";
import type { Title } from "../src/lib/types.ts";

test("release years: 1080p, 2160 and hashes are not years", () => {
  assert.deepEqual(releaseYears("Monsters.2016.S01E02.1080p.WEB-DL"), [2016]);
  assert.deepEqual(releaseYears("Show 2160p x265 [ABCD2016]"), []);
  assert.deepEqual(releaseYears("Show (2019-2021) Complete"), [2019, 2021]);
});

test("title match: only a release year from before the title began is against it", () => {
  const anime = { name: "Monsters", year: "2024" };
  assert.equal(titleMatch("Monsters.2016.S01E02.1080p", anime), "mismatch");
  assert.equal(titleMatch("Monsters.2024.S01E02.1080p", anime), "exact");
  assert.equal(titleMatch("Monsters S01E02 1080p", anime), "exact");
  assert.equal(titleMatch("1080p WEB-DL | Provider", anime), "unknown");
  // A long series: later seasons carry later years.
  assert.equal(titleMatch("Show.2021.S05E01.1080p", { name: "Show", year: "2016" }), "exact");
  assert.equal(titleMatch("Show.S05E01", { name: "Show", year: "" }), "exact");
});

const src = (title: string, provider = "p"): Stream => ({ name: "src", title, url: `https://x.example/${title}`, provider }) as Stream;

test("ranking: a source from an earlier show of the same name goes last, however good its quality", () => {
  const list = [src("Monsters.2016.S01E02.2160p"), src("Monsters.S01E02.720p"), src("Monsters.2024.S01E02.1080p")];
  const ranked = rankSources(list, { title: { name: "Monsters", year: "2024" } });
  assert.equal(ranked[2].title, "Monsters.2016.S01E02.2160p");
  assert.equal(rankSources(list)[0].title, "Monsters.2016.S01E02.2160p", "without a title the order is as before");
});

const t = (id: string, genre: string[]): Title => ({ id, name: id, year: "2020", rating: "", genre });
const kitsu = () =>
  Promise.resolve(
    new Response(JSON.stringify({ metas: [{ id: "kitsu:1", imdb_id: "tt100", name: "Anime One", genre: ["Animation"] }] })),
  );

test("Shows and Cinema drop animation the anime catalogs list; cartoons and other series stay", async () => {
  resetAnimeGuard();
  const f = (() => kitsu()) as unknown as typeof fetch;
  assert.deepEqual([...(await animeImdbIds(f))], ["tt100"]);
  const list = [t("tt100", ["Animation", "Action"]), t("tt200", ["Animation", "Comedy"]), t("tt100b", ["Drama"]), t("tt300", ["Drama"])];
  assert.deepEqual((await withoutAnime("series", list, f)).map((x) => x.id), ["tt200", "tt100b", "tt300"]);
  assert.equal((await withoutAnime("anime", list, f)).length, 4);
  // Nothing animated in the row: no catalog is read.
  resetAnimeGuard();
  const never = (() => assert.fail("read")) as unknown as typeof fetch;
  assert.equal((await withoutAnime("series", [t("tt300", ["Drama"])], never)).length, 1);
});
