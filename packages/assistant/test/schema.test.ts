import { test } from "node:test";
import assert from "node:assert/strict";
import { type LightsCommand, route } from "../src/route.ts";
import { validateStructuredIntent } from "../src/schema.ts";

test("validateStructuredIntent accepts valid shapes and rejects malformed or unexpected JSON", () => {
  assert.deepEqual(validateStructuredIntent('{"intent":"watch","term":"Miyazaki","kind":"anime","genre":"fantasy"}'), {
    intent: "watch",
    term: "miyazaki",
    kind: "anime",
    genre: "Fantasy",
  });
  assert.deepEqual(validateStructuredIntent('{"intent":"reminder","reminderText":"take out laundry","due":"in 20 minutes"}'), {
    intent: "reminder",
    reminderText: "take out laundry",
    due: "in 20 minutes",
  });
  assert.deepEqual(validateStructuredIntent('{"intent":"lights","level":150}'), {
    intent: "lights",
    command: { level: 100 },
  });
  assert.deepEqual(validateStructuredIntent('{"intent":"chat","reply":"At once."}'), {
    intent: "chat",
    reply: "At once.",
  });

  // Rejections: non-JSON, arrays, unknown intents, missing required intent fields, bad enums.
  assert.equal(validateStructuredIntent(undefined), null);
  assert.equal(validateStructuredIntent("not json"), null);
  assert.equal(validateStructuredIntent("{broken"), null);
  assert.equal(validateStructuredIntent("[]"), null);
  assert.equal(validateStructuredIntent('{"intent":"dance"}'), null);
  assert.equal(validateStructuredIntent('{"intent":"reminder"}'), null);
  assert.equal(validateStructuredIntent('{"intent":"lights"}'), null);
  assert.equal(validateStructuredIntent('{"intent":"lights","scene":"disco"}'), null);
  assert.equal(validateStructuredIntent('{"intent":"watch","kind":"podcast"}'), null);
});

test("structured routing dispatches natural watch, reminder, lights, weather and chat prompts with responseSchema", async () => {
  const requests: { body: Record<string, unknown> }[] = [];
  const added: [string, string | undefined, number | undefined][] = [];
  const lights: LightsCommand[] = [];
  let nextJson = "{}";

  const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: nextJson }] } }] }), { status: 200 });
  }) as typeof fetch;

  const now = new Date(2026, 10, 27, 14, 0, 0, 0);
  const fx = {
    addReminder: (t: string, d?: string, at?: number) => added.push([t, d, at]),
    openReminders: () => ["water the plants"],
    lights: async (cmd: LightsCommand) => void lights.push(cmd),
    find: async (i: { term?: string; genre?: string }) => [
      { type: "anime" as const, title: { id: "kitsu:1", name: i.term ?? i.genre ?? "Pick", year: "2001", rating: "8.6" } },
    ],
    weather: async () => ({ tempC: 4, label: "Clear", icon: "☀️", place: "Berlin" }),
    now: () => now,
    geminiKey: "k-test",
    fetch: fakeFetch,
  };

  // 1. Non-regex watch phrasing -> structured watch intent -> fx.find -> posters returned.
  nextJson = JSON.stringify({ intent: "watch", term: "spirited away", kind: "anime", reply: "Miyazaki's finest awaits." });
  const w = await route("I'm in the mood for Miyazaki", fx);
  assert.equal(w.action, "watch");
  assert.equal(w.results?.[0].title.name, "spirited away");
  assert.equal(w.reply, "Miyazaki's finest awaits.");
  const genCfg = requests[0].body.generationConfig as { responseMimeType?: string; responseSchema?: unknown };
  assert.equal(genCfg.responseMimeType, "application/json");
  assert.ok(genCfg.responseSchema);

  // 2. Non-regex reminder phrasing -> structured reminder -> dueAt computed via parseDueTime.
  nextJson = JSON.stringify({ intent: "reminder", reminderText: "check the laundry", due: "in 15 minutes" });
  const rem = await route("Don't let me forget the laundry in 15 minutes", fx);
  assert.equal(rem.action, "reminder_added");
  assert.deepEqual(added, [["check the laundry", "in 15 minutes", now.getTime() + 15 * 60_000]]);

  // 3. Non-regex room brightness phrasing (no "light"/"lamp"/"dim"/"bright" word) -> structured lights.
  nextJson = JSON.stringify({ intent: "lights", scene: "cinema", reply: "Lowering the glare at once." });
  const l = await route("My eyes hurt from the glare", fx);
  assert.equal(l.action, "domotics_updated");
  assert.deepEqual(lights, [{ scene: "cinema" }]);

  // 4. Non-regex weather phrasing -> structured weather -> local forecast formatted.
  nextJson = JSON.stringify({ intent: "weather" });
  const wx = await route("Will I freeze my feathers off out there?", fx);
  assert.equal(wx.action, "weather");
  assert.match(wx.reply, /4° and clear in Berlin/);

  // 5. Junk / invalid JSON falls back to the canned briefing.
  nextJson = "{not valid json";
  const fallback = await route("Who composed the score for Interstellar?", fx);
  assert.equal(fallback.action, "briefing");
  assert.match(fallback.reply, /Secretary Briefing/);
});
