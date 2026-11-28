import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeUrl, createAniList, type KV, nextEntry, recordWatched, statsFrom, tokenExpiry, tokenFromText, watchedEntries } from "../src/index.ts";

function memKv(): KV {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string) => (m.has(k) ? (m.get(k) as T) : null), set: (k, v) => void m.set(k, v) };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (exp: number) => `${b64({ alg: "RS256" })}.${b64({ exp, sub: "1" })}.${"s".repeat(40)}`;

test("the authorize page asks for a token", () => {
  assert.equal(authorizeUrl("123"), "https://anilist.co/api/v2/oauth/authorize?client_id=123&response_type=token");
});

test("a pasted token: bare, from a redirect URL, with stray spaces; anything else is refused", () => {
  const t = jwt(2_000_000_000);
  assert.equal(tokenFromText(`  ${t}\n`), t);
  assert.equal(tokenFromText(`https://anilist.co/api/v2/oauth/pin#access_token=${t}&token_type=Bearer&expires_in=31536000`), t);
  assert.equal(tokenFromText(t.slice(0, 50) + " " + t.slice(50)), t);
  assert.equal(tokenFromText("hello"), null);
  assert.equal(tokenFromText("a.b.c"), null);
  assert.equal(tokenExpiry(t), 2_000_000_000_000);
  assert.equal(tokenExpiry("nope"), undefined);
});

test("an expired token counts as signed out; a 401 forgets the token", async () => {
  let now = 1_000;
  const kv = memKv();
  const f = (async () => new Response(JSON.stringify({ errors: [{ message: "Invalid token", status: 401 }] }), { status: 401 })) as typeof fetch;
  const c = createAniList({ clientId: "1", kv, fetch: f, now: () => now });
  c.setToken(jwt(2));
  assert.ok(c.signedIn());
  now = 3_000;
  assert.equal(c.signedIn(), false);
  c.setToken(jwt(2_000_000_000));
  await assert.rejects(() => c.query("query { Viewer { id } }"));
  assert.equal(c.signedIn(), false);
});

test("progress only moves forward; the last episode completes; a film completes", () => {
  assert.deepEqual(nextEntry(3, { progress: 2, status: "CURRENT" }, 12), { progress: 3, status: "CURRENT" });
  assert.equal(nextEntry(2, { progress: 5, status: "CURRENT" }, 12), null);
  assert.deepEqual(nextEntry(12, null, 12), { progress: 12, status: "COMPLETED" });
  assert.deepEqual(nextEntry(1, null, null), { progress: 1, status: "CURRENT" });
  assert.deepEqual(nextEntry(null, null, 1), { status: "COMPLETED", progress: 1 });
  assert.equal(nextEntry(4, { progress: 1, status: "COMPLETED" }, 12), null);
});

test("recordWatched reads the entry, then saves with the token", async () => {
  const sent: { query: string; variables: Record<string, unknown>; auth?: string }[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ ...body, auth: (init.headers as Record<string, string>).Authorization });
    const data = body.query.includes("SaveMediaListEntry")
      ? { SaveMediaListEntry: { id: 1 } }
      : { Media: { episodes: 12, mediaListEntry: { progress: 4, status: "CURRENT" } } };
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
  const c = createAniList({ clientId: "1", kv: memKv(), fetch: f });
  c.setToken(jwt(2_000_000_000));
  assert.equal(await recordWatched(c, 16498, 5), true);
  assert.deepEqual(sent[1].variables, { mediaId: 16498, progress: 5, status: "CURRENT" });
  assert.ok(sent[1].auth?.startsWith("Bearer "));
  assert.equal(await recordWatched(c, 16498, 3), false);
});

test("lists: started and finished entries, not planned ones; stats summed", async () => {
  const f = (async () =>
    new Response(
      JSON.stringify({
        data: {
          MediaListCollection: {
            lists: [
              { entries: [{ progress: 3, status: "CURRENT", media: { id: 1, episodes: 12 } }, { progress: 0, status: "PLANNING", media: { id: 2 } }] },
              { entries: [{ progress: 24, status: "COMPLETED", media: { id: 3, episodes: 24 } }, { progress: 0, status: "CURRENT", media: { id: 4 } }] },
            ],
          },
        },
      }),
    )) as typeof fetch;
  const c = createAniList({ clientId: "1", kv: memKv(), fetch: f });
  assert.deepEqual(await watchedEntries(c, 9), [
    { mediaId: 1, progress: 3, status: "CURRENT", episodes: 12 },
    { mediaId: 3, progress: 24, status: "COMPLETED", episodes: 24 },
  ]);
  assert.deepEqual(statsFrom({ Viewer: { name: "V", statistics: { anime: { count: 40, episodesWatched: 900, minutesWatched: 21000 } } } }), {
    name: "V",
    avatar: undefined,
    titles: 40,
    episodes: 900,
    minutes: 21000,
  });
});
