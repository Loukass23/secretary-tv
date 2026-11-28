import { test } from "node:test";
import assert from "node:assert/strict";
import { createAniList, type KV } from "@secretary/anilist";
import { anilistPullSoon, anilistSignIn, anilistTracker, createIdMap } from "../src/lib/anilist.ts";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

function memKv(): KV {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string) => (m.has(k) ? (m.get(k) as T) : null), set: (k, v) => void m.set(k, v) };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "RS256" })}.${b64({ exp: 2_000_000_000 })}.${"s".repeat(40)}`;
const T = (id: string) => ({ id, name: id, year: "2020", rating: "8" });

/** The mapping service and AniList's GraphQL, faked: Kitsu 7442 is AniList 16498. */
function fakes() {
  const arm: string[] = [];
  const gql: { query: string; variables: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    if (url.includes("/imdb?")) {
      arm.push(url);
      return new Response(JSON.stringify(url.includes("tt2560140") ? [{ anilist: null }, { anilist: 16498, kitsu: 7442 }] : []));
    }
    if (url.includes("/ids?")) {
      arm.push(url);
      const u = new URL(url);
      const src = u.searchParams.get("source");
      const id = u.searchParams.get("id");
      if (src === "kitsu" && id === "7442") return new Response(JSON.stringify({ anilist: 16498, kitsu: 7442 }));
      if (src === "anilist" && id === "16498") return new Response(JSON.stringify({ anilist: 16498, kitsu: 7442 }));
      if (src === "anilist" && id === "21") return new Response(JSON.stringify({ anilist: 21, imdb: "tt0388629" }));
      return new Response(JSON.stringify({ anilist: null }));
    }
    const body = JSON.parse(String(init.body));
    gql.push(body);
    if (body.query.includes("Viewer")) return new Response(JSON.stringify({ data: { Viewer: { id: 9, name: "Viewer" } } }));
    if (body.query.includes("MediaListCollection")) {
      return new Response(
        JSON.stringify({
          data: {
            MediaListCollection: {
              lists: [{ entries: [{ progress: 3, status: "CURRENT", media: { id: 16498, episodes: 25 } }, { progress: 1000, status: "COMPLETED", media: { id: 21, episodes: null } }] }],
            },
          },
        }),
      );
    }
    if (body.query.includes("SaveMediaListEntry")) return new Response(JSON.stringify({ data: { SaveMediaListEntry: { id: 1 } } }));
    return new Response(JSON.stringify({ data: { Media: { episodes: 25, mediaListEntry: null } } }));
  }) as typeof fetch;
  return { f, arm, gql };
}

test("a finished anime episode moves AniList forward; ids are mapped once and kept", async () => {
  store.clear();
  const { f, arm, gql } = fakes();
  const c = createAniList({ clientId: "1", kv: memKv(), fetch: f });
  c.setToken(TOKEN);
  const t = anilistTracker(c, createIdMap({ fetch: f }));
  await t.finished("anime", T("kitsu:7442"), { season: 1, episode: 4 });
  await t.finished("anime", T("kitsu:7442"), { season: 1, episode: 5 });
  assert.equal(arm.length, 1);
  const saves = gql.filter((g) => g.query.includes("SaveMediaListEntry"));
  assert.deepEqual(saves.map((s) => s.variables), [
    { mediaId: 16498, progress: 4, status: "CURRENT" },
    { mediaId: 16498, progress: 5, status: "CURRENT" },
  ]);
});

test("an anime with an IMDb id is found through the IMDb endpoint", async () => {
  store.clear();
  const { f } = fakes();
  assert.equal(await createIdMap({ fetch: f }).toAniList("tt2560140"), 16498);
  assert.equal(await createIdMap({ fetch: f }).toAniList("tt0000001"), null);
});

test("films and shows that are not anime are left alone; signed out sends nothing", async () => {
  store.clear();
  const { f, arm, gql } = fakes();
  const c = createAniList({ clientId: "1", kv: memKv(), fetch: f });
  c.setToken(TOKEN);
  const t = anilistTracker(c, createIdMap({ fetch: f }));
  await t.finished("movie", T("tt0111161"), undefined);
  await t.watched("tt0903747", true, "series");
  c.setToken(null);
  await t.finished("anime", T("kitsu:7442"), { season: 1, episode: 1 });
  assert.equal(arm.length + gql.length, 0);
});

test("a pasted token is checked, then the lists come back as watched marks", async () => {
  store.clear();
  const { f } = fakes();
  const c = createAniList({ clientId: "1", kv: memKv(), fetch: f });
  assert.equal(await anilistSignIn(c, TOKEN), "Viewer");
  assert.ok(c.signedIn());
  anilistPullSoon();
  const w = await anilistTracker(c, createIdMap({ fetch: f })).pullWatched();
  assert.deepEqual(w, { titles: ["tt0388629"], episodes: { "kitsu:7442": ["1:1", "1:2", "1:3"] } });
});

test("a token AniList refuses is not kept", async () => {
  store.clear();
  const f = (async () => new Response(JSON.stringify({ errors: [{ message: "Invalid token", status: 400 }] }), { status: 400 })) as typeof fetch;
  const c = createAniList({ clientId: "1", kv: memKv(), fetch: f });
  assert.equal(await anilistSignIn(c, TOKEN), null);
  assert.equal(c.signedIn(), false);
});
