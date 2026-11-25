import { test } from "node:test";
import assert from "node:assert/strict";
import { findCatalogs, SearchUnavailable, searchCatalogs } from "../src/search.ts";

/** Answers each catalog request by its kind (movie, series, anime) from the URL; never touches the network. */
function fakeCatalogs(answer: (kind: "movie" | "series" | "anime", init?: RequestInit) => Promise<Response>) {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (init?.signal) signals.push(init.signal);
    const kind = url.includes("/anime/") ? "anime" : url.includes("/series/") ? "series" : "movie";
    return answer(kind, init);
  }) as typeof fetch;
  return { f, urls, signals };
}

const metas = (...m: object[]) => new Response(JSON.stringify({ metas: m }));
/** A request that only ends when its signal aborts. */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

test("catalog search: films, shows and anime in one ranked list", async () => {
  const { f, urls } = fakeCatalogs(async (kind) =>
    kind === "movie"
      ? metas({ imdb_id: "tt0000001", name: "Quiet Harbour", year: "2001" })
      : kind === "series"
        ? metas({ imdb_id: "tt0000002", name: "Harbour Lights", releaseInfo: "2019-2021" })
        : metas({ id: "kitsu:7", name: "Harbour Season 2" }),
  );
  const got = await findCatalogs("harbour", { fetch: f });
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => u.includes("search=harbour")));
  assert.deepEqual(
    got.map((r) => [r.type, r.title.name]).sort(),
    [
      ["anime", "Harbour"],
      ["movie", "Quiet Harbour"],
      ["series", "Harbour Lights"],
    ],
  );
  assert.equal(got[0].title.name, "Harbour");
});

test("catalog search: one catalog down still answers with the others", async () => {
  const { f } = fakeCatalogs(async (kind) =>
    kind === "movie" ? metas({ imdb_id: "tt0000001", name: "Dune" }) : kind === "series" ? new Response("", { status: 502 }) : Promise.reject(new TypeError("offline")),
  );
  const got = await findCatalogs("dune", { fetch: f });
  assert.deepEqual(
    got.map((r) => r.title.name),
    ["Dune"],
  );
});

test("catalog search: no catalog answering is an error, not an empty list", async () => {
  const { f } = fakeCatalogs(() => Promise.reject(new TypeError("offline")));
  await assert.rejects(findCatalogs("dune", { fetch: f }), SearchUnavailable);
  // The assistant's watch prompts still read it as nothing found.
  assert.deepEqual(await searchCatalogs("dune", f), []);
});

test("catalog search: gives up after the timeout instead of waiting forever", async () => {
  const { f, signals } = fakeCatalogs((_, init) => hang(init));
  const t0 = Date.now();
  await assert.rejects(findCatalogs("dune", { fetch: f, timeout: 30 }), SearchUnavailable);
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(signals.length === 3 && signals.every((s) => s.aborted));
});

test("catalog search: a fetch that ignores its signal still times out", async () => {
  const { f } = fakeCatalogs(() => new Promise<Response>(() => {}));
  await assert.rejects(findCatalogs("dune", { fetch: f, timeout: 30 }), SearchUnavailable);
});

test("catalog search: cancelling aborts every request and is not reported as unavailable", async () => {
  const { f, signals } = fakeCatalogs((_, init) => hang(init));
  const ctrl = new AbortController();
  const p = findCatalogs("dune", { fetch: f, signal: ctrl.signal, timeout: 5000 });
  ctrl.abort();
  await assert.rejects(p, (e: unknown) => !(e instanceof SearchUnavailable));
  assert.ok(signals.every((s) => s.aborted));
  // Already cancelled: nothing is asked.
  const before = signals.length;
  await assert.rejects(findCatalogs("dune", { fetch: f, signal: ctrl.signal }));
  assert.equal(signals.length, before);
});

test("catalog search: an empty query asks nothing", async () => {
  const { f, urls } = fakeCatalogs(async () => metas());
  assert.deepEqual(await findCatalogs("  ", { fetch: f }), []);
  assert.equal(urls.length, 0);
});
