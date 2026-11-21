import assert from "node:assert/strict";
import { test } from "node:test";
import { pickSimilar, similarUrl } from "../src/lib/cinemeta.ts";
import { searchSummary } from "../src/lib/searchsummary.ts";
import type { Title } from "../src/lib/types.ts";

const t = (id: string, poster?: string): Title => ({ id, name: id, year: "2020", rating: "7", poster });

test("the search line counts answers, not providers", () => {
  assert.equal(searchSummary([]), "");
  assert.equal(searchSummary([{ state: "searching", count: 0 }, { state: "ok", count: 12 }, { state: "searching", count: 0 }]), "Searching · 1 of 3 answered · 12 found so far");
  assert.equal(searchSummary([{ state: "ok", count: 10 }, { state: "empty", count: 0 }]), "10 sources found");
  assert.equal(searchSummary([{ state: "ok", count: 1 }, { state: "error", count: 0 }]), "1 source found · 1 could not be reached");
});

test("more like this skips the page's own title and puts posters first", () => {
  const out = pickSimilar([t("a"), t("self", "p"), t("b", "p"), t("c")], "self", 3);
  assert.deepEqual(out.map((x) => x.id), ["b", "a", "c"]);
  assert.equal(similarUrl("movie", "Sci-Fi").endsWith("/catalog/movie/top/genre=Sci-Fi.json"), true);
  assert.equal(similarUrl("anime", "Action").includes("kitsu"), true);
});

test("taking a title off Continue Watching drops every entry of it", async () => {
  const { withoutTitle } = await import("../src/lib/resume.ts");
  const e = (id: string) => ({ title: t(id), posSec: 10, durSec: 100, updated: 1 });
  assert.deepEqual(withoutTitle([e("a"), e("b"), e("a")], "a").map((x) => x.title.id), ["b"]);
});
