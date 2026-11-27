import { test } from "node:test";
import assert from "node:assert/strict";
import { localBrain, localReminders, NestError } from "../src/brain.ts";

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

test("due reminders fire once against a fake clock, survive reload, and skip completed items", async () => {
  const store = memory();
  let nowMs = new Date(2026, 10, 27, 14, 0, 0, 0).getTime();
  const rem = localReminders(store);
  const brain = localBrain({
    reminders: rem,
    lights: async () => undefined,
    now: () => new Date(nowMs),
  });

  await brain.ask("Remind me to check the oven in 20 minutes");
  nowMs += 1_000;
  await brain.ask("Remind me to call mum tomorrow at 8");
  nowMs += 1_000;
  await brain.ask("Remind me to water the plants in 10 minutes");

  // Mark "water the plants" completed before its due time: it must never fire.
  const plants = rem.list().find((r) => r.text === "water the plants")!;
  rem.toggle(plants.id);

  // 15 minutes in: nothing open is due yet, and nextDueAt points to the 20-minute oven reminder.
  const base = new Date(2026, 10, 27, 14, 0, 0, 0).getTime();
  assert.equal(rem.nextDueAt(), base + 20 * 60_000);
  assert.deepEqual(rem.fireDue(base + 15 * 60_000), []);

  // 20 minutes in: the oven reminder fires once, and survives a reload without firing a second time.
  const fired = rem.fireDue(base + 20 * 60_000);
  assert.deepEqual(fired.map((r) => r.text), ["check the oven"]);
  assert.deepEqual(localReminders(store).fireDue(base + 25 * 60_000), []);

  // Next morning at 08:00: tomorrow's reminder fires.
  const morning = new Date(2026, 10, 28, 8, 0, 0, 0).getTime();
  assert.equal(localReminders(store).nextDueAt(), morning);
  assert.deepEqual(localReminders(store).fireDue(morning).map((r) => r.text), ["call mum"]);
  assert.equal(localReminders(store).nextDueAt(), null);
});

test("the TV answers directly and gives each new turn a higher positive id", async () => {
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
  assert.deepEqual(
    st.turns.map((t) => t.id),
    [1, 2, 3],
  );
  assert.ok(st.turns.every((t) => t.source === "tv"));
  assert.equal(brain.note("couch light off", "Turning off Couch.", "domotics_updated").id, 4);
});
