import assert from "node:assert/strict";
import { test } from "node:test";
import { loadVideos, parseVideos, popularUrl, refreshVideos, regionOf, watchUrl, YOUTUBE_KEY, YOUTUBE_TTL_MS } from "../src/youtube.ts";

const reply = {
  items: [
    { id: "v1", snippet: { title: "First", channelTitle: "Channel A", thumbnails: { medium: { url: "https://example.com/1m.jpg" }, high: { url: "https://example.com/1h.jpg" } } } },
    { id: "v2", snippet: { title: "No picture", thumbnails: {} } },
    { snippet: { title: "No id", thumbnails: { default: { url: "https://example.com/x.jpg" } } } },
    { id: "v4", snippet: { title: "Last", thumbnails: { default: { url: "https://example.com/4.jpg" } } } },
  ],
};

const memory = () => {
  const mem = new Map<string, string>();
  return { mem, store: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } };
};

test("videos with an id, a title and a picture are kept, the best picture first", () => {
  const v = parseVideos(reply);
  assert.deepEqual(v.map((x) => x.id), ["v1", "v4"]);
  assert.equal(v[0].thumb, "https://example.com/1h.jpg");
  assert.equal(v[0].channel, "Channel A");
  assert.equal(v[1].channel, "");
  assert.deepEqual(parseVideos(null), []);
  assert.deepEqual(parseVideos({ items: "no" }), []);
});

test("the region comes from the TV's language and the url carries the key", () => {
  assert.equal(regionOf("en-GB"), "GB");
  assert.equal(regionOf("fr"), "US");
  assert.equal(regionOf(undefined), "US");
  assert.match(popularUrl("k 1", "GB"), /regionCode=GB&key=k%201$/);
  assert.equal(watchUrl("a b"), "https://www.youtube.com/watch?v=a%20b");
});

test("a pull is kept for an hour, and a failed one keeps the last copy", async () => {
  const { mem, store } = memory();
  let calls = 0;
  const ok = (async () => (calls++, { ok: true, json: async () => reply })) as unknown as typeof fetch;
  assert.deepEqual((await refreshVideos(store, "k", "GB", ok, 1000)).map((v) => v.id), ["v1", "v4"]);
  assert.equal(loadVideos(store, 2000).fresh, true);
  await refreshVideos(store, "k", "GB", ok, 2000);
  assert.equal(calls, 1, "fresh: no second pull");
  const down = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const later = 1000 + YOUTUBE_TTL_MS + 1;
  assert.equal(loadVideos(store, later).fresh, false);
  assert.deepEqual((await refreshVideos(store, "k", "GB", down, later)).map((v) => v.id), ["v1", "v4"]);
  assert.ok(mem.has(YOUTUBE_KEY));
});

test("without a key nothing is pulled", async () => {
  const { store } = memory();
  const never = (async () => {
    throw new Error("should not be called");
  }) as unknown as typeof fetch;
  assert.deepEqual(await refreshVideos(store, "", "US", never), []);
});
