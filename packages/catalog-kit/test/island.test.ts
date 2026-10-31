import { test } from "node:test";
import assert from "node:assert/strict";
import { createIsland, ISLAND_MS } from "../src/lib/island.ts";

test("island: one at a time for 4 s, errors before infos, same key in place, at most 6 waiting", () => {
  let t = 0;
  const island = createIsland(() => t);
  const info = (key: string, text = key) => ({ key, text, level: "info" as const });
  const error = (key: string, text = key) => ({ key, text, level: "error" as const });
  assert.equal(island.current(), null);
  island.push(info("a"));
  island.push(info("b"));
  island.push(error("e1"));
  island.push(error("e2"));
  assert.equal(island.current()?.key, "a");
  t += ISLAND_MS;
  assert.equal(island.current()?.key, "e1", "errors jump the infos");
  // The same key while showing: new text, the time starts over.
  t += 1000;
  island.push(error("e1", "e1 again"));
  t += ISLAND_MS - 1;
  assert.equal(island.current()?.text, "e1 again");
  // The same key while waiting: replaced where it waits.
  island.push(info("b", "b updated"));
  t += 1;
  assert.equal(island.current()?.key, "e2");
  t += ISLAND_MS;
  assert.equal(island.current()?.text, "b updated");
  t += ISLAND_MS;
  assert.equal(island.current(), null);
  // Too many: the oldest infos go first.
  for (const k of ["x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7"]) island.push(info(k));
  island.push(error("boom"));
  assert.equal(island.current()?.key, "x0");
  assert.equal(island.waitingCount(), 6);
  t += ISLAND_MS;
  assert.equal(island.current()?.key, "boom");
  t += ISLAND_MS;
  assert.equal(island.current()?.key, "x3", "x1 and x2 were dropped");
});
