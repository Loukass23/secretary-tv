import assert from "node:assert/strict";
import { test } from "node:test";
import { ART_INDEX_KEY, type BlobStore, createArtCache } from "../src/art-cache.ts";

function memStore(): BlobStore & { m: Map<string, Blob> } {
  const m = new Map<string, Blob>();
  return {
    m,
    getMany: async (keys) => keys.map((k) => m.get(k)),
    put: async (k, b) => void m.set(k, b),
    delete: async (keys) => keys.forEach((k) => m.delete(k)),
  };
}
function memKv(): { getItem(k: string): string | null; setItem(k: string, v: string): void; m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
const png = (n = 10) => new Blob([new Uint8Array(n)], { type: "image/png" });
const u = (k: number) => `https://example.com/art/${k}.jpg`;

function setup(over: Partial<Parameters<typeof createArtCache>[0]> = {}) {
  const store = memStore();
  const kv = memKv();
  const asked: string[] = [];
  let clock = 1_000_000;
  const opts = {
    store,
    kv,
    fetch: async (url: string) => {
      asked.push(url);
      return { ok: !url.includes("bad"), blob: async () => png() };
    },
    toUrl: (b: Blob) => `blob:test/${b.size}/${Math.random()}`,
    now: () => clock,
    ...over,
  };
  return { store, kv, asked, opts, tick: (ms: number) => (clock += ms), make: () => createArtCache(opts) };
}

test("art cache: new pictures are fetched once and kept, and the next start shows them from blobs", async () => {
  const s = setup();
  const a = s.make();
  await a.keep([u(1), u(2), undefined, u(1)]);
  assert.deepEqual(s.asked, [u(1), u(2)]);
  assert.equal(s.store.m.size, 2);
  // This session's src never changes under a tile.
  assert.equal(a.src(u(1)), u(1));
  const next = s.make();
  assert.equal(await next.warm(), 2);
  assert.match(next.src(u(1)), /^blob:test\//);
  assert.equal(next.src(u(9)), u(9));
  assert.equal(next.src(undefined), undefined);
});

test("art cache: least recently shown go first past the limit, from the index and the store", async () => {
  const s = setup({ max: 3 });
  const a = s.make();
  await a.keep([u(1), u(2), u(3)]);
  await a.keep([u(4), u(2)]);
  assert.deepEqual(a.list(), [u(4), u(2), u(1)]);
  assert.deepEqual([...s.store.m.keys()].sort(), [u(1), u(2), u(4)].sort());
  assert.deepEqual(JSON.parse(s.kv.m.get(ART_INDEX_KEY)!).map((e: { u: string }) => e.u), [u(4), u(2), u(1)]);
});

test("art cache: a picture is refreshed from the network once a day, and a failed refresh keeps the old one", async () => {
  const s = setup();
  await s.make().keep([u(1)]);
  s.tick(3600_000);
  await s.make().keep([u(1)]);
  assert.equal(s.asked.length, 1, "fresh: not asked again");
  s.tick(25 * 3600_000);
  const later = s.make();
  await later.keep([u(1)]);
  assert.equal(s.asked.length, 2, "a day old: refreshed");
  await later.keep([u(1)]);
  assert.equal(s.asked.length, 2, "never twice in a session");
});

test("art cache: what never loads, is too big or is not a picture takes no place", async () => {
  const s = setup({
    maxBytes: 100,
    fetch: async (url: string) => ({
      ok: !url.includes("bad"),
      blob: async () => (url.includes("big") ? png(500) : url.includes("html") ? new Blob(["<p>"], { type: "text/html" }) : png()),
    }),
  });
  const a = s.make();
  await a.keep([u(1), "https://example.com/bad.jpg", "https://example.com/big.jpg", "https://example.com/html", "data:image/gif;base64,R0lG"]);
  assert.deepEqual(a.list(), [u(1)]);
  assert.equal(s.store.m.size, 1);
});

test("art cache: without a store it does nothing, and a slow store never holds the start", async () => {
  const none = createArtCache({ store: null, kv: memKv() });
  await none.keep([u(1)]);
  assert.equal(await none.warm(), 0);
  assert.equal(none.src(u(1)), u(1));
  const s = setup();
  await s.make().keep([u(1)]);
  const slow = createArtCache({ ...s.opts, store: { ...s.store, getMany: () => new Promise(() => {}) } });
  const t0 = Date.now();
  assert.equal(await slow.warm(60, 30), 0);
  assert.ok(Date.now() - t0 < 500);
  assert.equal(slow.src(u(1)), u(1));
});
