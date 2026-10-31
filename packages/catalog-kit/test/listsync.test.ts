import { test } from "node:test";
import assert from "node:assert/strict";
import type { ListRow } from "@secretary/nuvio";
import { createListSync, type ListCloud } from "../src/lib/listsync.ts";

const norm = (u: string) => (/\.json$/.test(u) ? u : `${u.replace(/\/+$/, "")}/manifest.json`);
const row = (url: string, sort_order: number, enabled = true): ListRow => ({ url, name: url, enabled, sort_order });

function setup(localUrls: string[], cloudRows: ListRow[], opts: { count?: number | null; readOnly?: boolean; owner?: string } = {}) {
  let list = localUrls.map((u, i) => row(u, i));
  const listeners = new Set<() => void>();
  const side = {
    synced: () => list,
    replace: (rows: readonly ListRow[]) => {
      list = rows.map((r) => ({ ...r }));
      for (const l of listeners) l();
    },
    subscribe: (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn)),
    /** A user's change on the TV. */
    edit(next: ListRow[]) {
      list = next;
      for (const l of listeners) l();
    },
  };
  const kvMap = new Map<string, unknown>();
  const kv = { get: (k: string) => (structuredClone(kvMap.get(k)) ?? null) as never, set: (k: string, v: unknown) => void kvMap.set(k, structuredClone(v)) };
  const state = { cloud: cloudRows, owner: opts.owner ?? "u1:3", pushes: [] as ListRow[][], count: opts.count };
  const cloud: ListCloud = {
    owner: () => state.owner,
    pull: async () => state.cloud,
    push: async (rows) => (state.pushes.push(rows), (state.cloud = rows), true),
    count: async () => (state.count === undefined ? state.cloud.length : state.count),
    readOnly: () => opts.readOnly === true,
  };
  const timers: (() => void)[] = [];
  const sync = createListSync({ key: "k", side, cloud, kv, normalize: norm, timer: (fn) => void timers.push(fn) });
  return { side, state, sync, list: () => list.map((r) => r.url), flush: () => timers.splice(0).forEach((f) => f()) };
}

test("first sync on a TV: both lists kept, the cloud's first, sent back in the cloud's own URL form", async () => {
  const t = setup(["https://mine/manifest.json"], [row("https://theirs", 0)]);
  await t.sync.sync();
  assert.deepEqual(t.list(), ["https://theirs/manifest.json", "https://mine/manifest.json"]);
  assert.deepEqual(t.state.pushes.at(-1)!.map((r) => r.url), ["https://theirs", "https://mine/manifest.json"]);
});

test("after that: the cloud's list is taken; a change on the TV is pushed, debounced, and wins at the next sync", async () => {
  const t = setup([], [row("https://a/manifest.json", 0), row("https://b/manifest.json", 1)]);
  await t.sync.sync();
  assert.equal(t.state.pushes.length, 0, "nothing of its own to add");
  t.state.cloud = [row("https://b/manifest.json", 0), row("https://c/manifest.json", 1)];
  await t.sync.sync();
  assert.deepEqual(t.list(), ["https://b/manifest.json", "https://c/manifest.json"]);

  t.side.edit([row("https://c/manifest.json", 0, false)]);
  t.side.edit([row("https://c/manifest.json", 0, false), row("https://d/manifest.json", 1)]);
  assert.equal(t.state.pushes.length, 0, "waits for the debounce");
  t.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(t.state.pushes.at(-1)!.map((r) => [r.url, r.enabled]), [["https://c/manifest.json", false], ["https://d/manifest.json", true]]);

  // A change made before the next sync (no debounced push yet): the sync sends the TV's list instead of taking the cloud's.
  const t2 = setup([], [row("https://x/manifest.json", 0)]);
  await t2.sync.sync();
  t2.side.edit([]);
  await t2.sync.sync();
  assert.deepEqual(t2.state.pushes.at(-1), [], "the removal of everything is the user's, so it goes up");
});

test("an empty cloud list empties the TV only when the server's count says so", async () => {
  const t = setup([], [row("https://a/manifest.json", 0)], { count: null });
  await t.sync.sync();
  t.state.cloud = [];
  await t.sync.sync();
  assert.deepEqual(t.list(), ["https://a/manifest.json"], "count unknown: keep");
  t.state.count = 0;
  await t.sync.sync();
  assert.deepEqual(t.list(), []);
});

test("another profile takes its own list as it is; a shared (read-only) list is never written", async () => {
  const t = setup(["https://mine/manifest.json"], [row("https://p3/manifest.json", 0)]);
  await t.sync.sync();
  t.state.owner = "u1:2";
  t.state.cloud = [row("https://p2/manifest.json", 0)];
  const before = t.state.pushes.length;
  await t.sync.sync();
  assert.deepEqual(t.list(), ["https://p2/manifest.json"]);
  assert.equal(t.state.pushes.length, before);

  const ro = setup([], [row("https://p1/manifest.json", 0)], { readOnly: true });
  await ro.sync.sync();
  ro.side.edit([]);
  ro.flush();
  await ro.sync.sync();
  assert.equal(ro.state.pushes.length, 0);
  assert.deepEqual(ro.list(), ["https://p1/manifest.json"], "the shared list comes back");
});

test("signed out: nothing happens; manifest refreshes (same list) push nothing", async () => {
  const t = setup(["https://a/manifest.json"], [], { owner: undefined });
  t.state.owner = null as unknown as string;
  await t.sync.sync();
  assert.deepEqual(t.list(), ["https://a/manifest.json"]);
  const u = setup([], [row("https://a/manifest.json", 0)]);
  await u.sync.sync();
  u.side.edit([{ ...row("https://a/manifest.json", 0), name: "Read again" }]);
  u.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(u.state.pushes.length, 0);
});
