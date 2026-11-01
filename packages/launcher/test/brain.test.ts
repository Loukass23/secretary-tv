import { test } from "node:test";
import assert from "node:assert/strict";
import { localBrain, localReminders, mergeTurns, NestError } from "../src/brain.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("reminders on the TV: add, toggle, survive a reload", () => {
  const store = memory();
  const rem = localReminders(store);
  rem.add("water the plants", "18:00", 1);
  const [r] = rem.add("call mum", undefined, 2);
  assert.equal(r.source, "local");
  assert.ok(rem.owns(r.id));
  rem.toggle(r.id);
  assert.deepEqual(
    localReminders(store).list().map((x) => [x.text, x.completed, x.due]),
    [["call mum", true, undefined], ["water the plants", false, "18:00"]],
  );
  assert.equal(rem.owns("srv-1"), false);
  store.setItem("nest.reminders", "not json");
  assert.deepEqual(localReminders(store).list(), []);
});

test("the TV answers with no server and keeps the turns", async () => {
  const rem = localReminders(memory());
  const brain = localBrain({
    reminders: rem,
    lights: async () => {
      throw new NestError("Lights need SmartThings on this TV, or Secretary Server.");
    },
    fetch: () => Promise.reject(new Error("offline")),
  });
  const t1 = await brain.ask("remind me to feed the cat");
  assert.equal(t1.action, "reminder_added");
  assert.equal(rem.list()[0].text, "feed the cat");
  const t2 = await brain.ask("cinema mode");
  assert.deepEqual([t2.action, t2.reply], ["error", "Lights need SmartThings on this TV, or Secretary Server."]);
  // The catalogs are unreachable: the watch answer says so instead of failing.
  assert.equal((await brain.ask("show me a comedy")).reply, "I couldn't find anything for comedy films and series.");
  const st = brain.state();
  assert.equal(st.turns.length, 3);
  assert.ok(st.turns.every((t) => t.id < 0 && t.source === "tv"));
  assert.equal(brain.note("couch light off", "Turning off Couch.", "domotics_updated").id, -4);
});

test("server and TV turns merge in time order", () => {
  const turn = (id: number, at: number) => ({ id, prompt: "", reply: "", action: "briefing", source: "tv" as const, at });
  const server = { rev: 2, pending: null, turns: [turn(1, 10), turn(2, 30)] };
  const local = { rev: 1, pending: null, turns: [turn(-1, 20)] };
  assert.deepEqual(mergeTurns(server, local).turns.map((t) => t.id), [1, -1, 2]);
  assert.equal(mergeTurns(null, local), local);
  assert.equal(mergeTurns(server, { rev: 0, pending: null, turns: [] }), server);
});
