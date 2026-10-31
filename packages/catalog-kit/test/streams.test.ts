import { test } from "node:test";
import assert from "node:assert/strict";
import { createPluginStreamClient, type FindStreams, type Stream, type StreamClient } from "../src/lib/streams.ts";

const s = (name: string, url = `https://x.example/${name}`): Stream => ({ name, title: name, url });
const noServer: StreamClient = {
  get: async () => [s("server")],
  watch: (_i, _h, _t, cb) => (cb([s("server")], true), () => {}),
  warm: async () => {},
};

test("watch: partial lists while providers answer, then the final one; get shares the same search", async () => {
  let calls = 0;
  const find: FindStreams = async (_id, _type, _hint, onPartial) => {
    calls++;
    onPartial([s("a")]);
    await new Promise((r) => setTimeout(r, 10));
    onPartial([s("a"), s("b")]);
    return { streams: [s("a"), s("b"), s("c")] };
  };
  const client = createPluginStreamClient(find, () => true, noServer, async (u) => u, "movie");
  const seen: string[] = [];
  const done = new Promise<void>((resolve) =>
    client.watch("tt1", undefined, undefined, (list, final) => {
      seen.push(`${final ? "done " : ""}${list.map((x) => x.name).join("")}`);
      if (final) resolve();
    }),
  );
  const got = await client.get("tt1");
  await done;
  assert.deepEqual(got.map((x) => x.name), ["a", "b", "c"]);
  assert.equal(seen.at(-1), "done abc");
  assert.ok(seen.includes("ab"));
  assert.equal(calls, 1);
  // A later watcher of a finished search gets the final list at once, never a partial one.
  const late: string[] = [];
  client.watch("tt1", undefined, undefined, (list, final) => late.push(`${final}:${list.length}`));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(late, ["true:3"]);
});

test("watch: plugin torrents get the episode numbers; nothing found falls back to the server", async () => {
  const find: FindStreams = async (id, _t, _h, onPartial) => {
    onPartial([]);
    return { streams: id === "none" ? [] : [s("t", "debrid:tb:abc"), s("h")] };
  };
  const client = createPluginStreamClient(find, () => true, noServer, async (u) => u, "series");
  const ep = await client.get("tt2:1:3", { season: 1, episode: 3 });
  assert.deepEqual(ep.map((x) => x.url), ["debrid:tb:abc?s=1&e=3", "https://x.example/h"]);
  assert.deepEqual((await client.get("none")).map((x) => x.name), ["server"]);
});

test("a fallback that never answers ends the search empty after its time, so Play is not left waiting", async () => {
  const hanging: StreamClient = { get: () => new Promise(() => {}), watch: () => () => {}, warm: async () => {} };
  const client = createPluginStreamClient(async () => ({ streams: [] }), () => true, hanging, async (u) => u, "movie", Date.now, 30);
  const t0 = Date.now();
  assert.deepEqual(await client.get("tt9"), []);
  assert.ok(Date.now() - t0 >= 25);
});
