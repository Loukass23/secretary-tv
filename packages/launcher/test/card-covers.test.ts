import { test } from "node:test";
import assert from "node:assert/strict";
import { coverPicks, oneEach } from "../src/card-covers.ts";

const t = (id: string, name = id) => ({ id, name });
const me = (x: { id: string; name: string }) => x;
const ids = (l: { id: string }[]) => l.map((x) => x.id);

test("one entry per title, by id and by name", () => {
  // The review's Anime card: one show synced from a phone under its IMDb id and played here under its Kitsu id.
  const list = [t("kitsu:1", "Jujutsu Kaisen"), t("kitsu:2", "Lazarus"), t("tt3", "Jujutsu Kaisen"), t("kitsu:2", "Lazarus")];
  assert.deepEqual(ids(oneEach(list, me)), ["kitsu:1", "kitsu:2"]);
  // Punctuation and case do not make two titles.
  assert.deepEqual(ids(oneEach([t("a", "Frieren: Beyond Journey's End"), t("b", "frieren beyond journeys end")], me)), ["a"]);
});

test("a small pool shows whole and in order", () => {
  const used = new Set<string>();
  assert.deepEqual(ids(coverPicks([t("a"), t("b")], 2, 7, used, me)), ["a", "b"]);
});

test("the covers move on each turn and show every title in time", () => {
  const pool = [t("a"), t("b"), t("c"), t("d"), t("e")];
  const seen = new Set<string>();
  let last = "";
  for (let turn = 0; turn < 5; turn++) {
    const got = ids(coverPicks(pool, 2, turn, new Set(), me));
    assert.equal(new Set(got).size, 2, "no title twice on one card");
    assert.notEqual(got.join(), last, "each turn changes the card");
    last = got.join();
    got.forEach((x) => seen.add(x));
  }
  assert.equal(seen.size, 5);
});

test("no title twice across the cards", () => {
  const used = new Set<string>();
  const shows = coverPicks([t("tt1", "Monster"), t("tt2", "The Bear")], 2, 0, used, me);
  // The same show reaches the next card under another id: it is left out there.
  const anime = coverPicks([t("kitsu:9", "Monster"), t("kitsu:3", "Lazarus"), t("kitsu:4", "Dandadan")], 2, 0, used, me);
  assert.deepEqual(ids(shows), ["tt1", "tt2"]);
  assert.deepEqual(ids(anime), ["kitsu:3", "kitsu:4"]);
});

test("a negative or huge turn still lands inside the pool", () => {
  const pool = [t("a"), t("b"), t("c")];
  assert.equal(coverPicks(pool, 2, -5, new Set(), me).length, 2);
  assert.equal(coverPicks(pool, 2, 1e9 + 1, new Set(), me).length, 2);
});

test("the logo is drawn once: painted on a 16:9 thumb, else over the textless art", async () => {
  const { stillArt } = await import("../src/card-covers.ts");
  const it = { poster: "p.jpg", still: "thumb.jpg", plain: "plain.jpg", logo: "logo.png", stillHasLogo: true };
  // A Shows tile, a Continue watching tile: the thumb whole, nothing over it.
  assert.deepEqual(stillArt(it, 436, 248), { src: "thumb.jpg", painted: true });
  assert.deepEqual(stillArt(it, 600, 338), { src: "thumb.jpg", painted: true });
  // The 4:3 row look would crop the painted title (the review's "UTSU KAISEN"): textless art and the logo.
  assert.deepEqual(stillArt(it, 560, 420), { src: "plain.jpg", logo: "logo.png", painted: false });
  // A catalog backdrop (no Fanart.tv thumb) gets the logo over it.
  assert.deepEqual(stillArt({ ...it, still: "bg.jpg", stillHasLogo: false }, 600, 338), { src: "bg.jpg", logo: "logo.png", painted: false });
});
