import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDueTime, parseReminder } from "../src/reminder.ts";
import { route } from "../src/route.ts";

const BASE = new Date(2026, 10, 27, 14, 30, 0, 0); // 2026-11-27 14:30:00 local

test("parseReminder: relative durations against a fake clock", () => {
  const r1 = parseReminder("Remind me to check the oven in 20 minutes", BASE);
  assert.deepEqual(r1, {
    text: "check the oven",
    due: "in 20 minutes",
    dueAt: BASE.getTime() + 20 * 60_000,
  });

  const r2 = parseReminder("remind me to stretch in half an hour", BASE);
  assert.deepEqual(r2, {
    text: "stretch",
    due: "in half an hour",
    dueAt: BASE.getTime() + 30 * 60_000,
  });

  const r3 = parseReminder("Add reminder feed the cat in two hours", BASE);
  assert.deepEqual(r3, {
    text: "feed the cat",
    due: "in two hours",
    dueAt: BASE.getTime() + 120 * 60_000,
  });
});

test("parseReminder: tomorrow, tonight, and clock rollover", () => {
  const tom = parseReminder("Remind me to call mum tomorrow at 8", BASE);
  assert.deepEqual(tom, {
    text: "call mum",
    due: "tomorrow at 8",
    dueAt: new Date(2026, 10, 28, 8, 0, 0, 0).getTime(),
  });

  const tomPm = parseReminder("Remind me to join the quiz tomorrow at 8:30 pm", BASE);
  assert.deepEqual(tomPm, {
    text: "join the quiz",
    due: "tomorrow at 8:30 pm",
    dueAt: new Date(2026, 10, 28, 20, 30, 0, 0).getTime(),
  });

  // Asked at 14:30, "at 7" rolls to 19:00 today rather than 07:00 tomorrow.
  const aft = parseReminder("Remind me to water the plants at 7", BASE);
  assert.deepEqual(aft, {
    text: "water the plants",
    due: "7",
    dueAt: new Date(2026, 10, 27, 19, 0, 0, 0).getTime(),
  });

  // Asked at 21:00, "at 18:00" rolls to 18:00 tomorrow.
  const late = new Date(2026, 10, 27, 21, 0, 0, 0);
  assert.equal(parseDueTime("18:00", late), new Date(2026, 10, 28, 18, 0, 0, 0).getTime());

  const tonight = parseReminder("Remind me to take the bins out tonight", BASE);
  assert.deepEqual(tonight, {
    text: "take the bins out",
    due: "tonight",
    dueAt: new Date(2026, 10, 27, 20, 0, 0, 0).getTime(),
  });
});

test("parseReminder: near misses do not add reminders", async () => {
  assert.equal(parseReminder("Play In Time", BASE), null);
  assert.equal(parseReminder("Find my reminders", BASE), null);
  assert.equal(parseReminder("What tasks do I have?", BASE), null);

  const seen: [string, string | undefined, number | undefined][] = [];
  const a = await route("Remind me to check the kettle in 5 mins", {
    addReminder: (t, d, at) => seen.push([t, d, at]),
    openReminders: () => [],
    lights: async () => undefined,
    now: () => BASE,
  });
  assert.equal(a.action, "reminder_added");
  assert.deepEqual(seen, [["check the kettle", "in 5 mins", BASE.getTime() + 5 * 60_000]]);
});
