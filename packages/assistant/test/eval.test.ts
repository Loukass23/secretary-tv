import { test } from "node:test";
import assert from "node:assert/strict";
import type { WatchIntent } from "../src/intent.ts";
import { type AskAction, type Effects, type LightsCommand, route } from "../src/route.ts";
import type { Weather } from "../src/weather.ts";
import { formatEvalReport, REPLY_MAX_CHARS, runLiveEval } from "./eval-runner.ts";
import { EVAL_PROMPTS } from "./fixtures/eval-prompts.ts";

const FORECAST: Weather = {
  tempC: 18,
  label: "Partly cloudy",
  icon: "⛅",
  place: "Berlin",
  days: [{ date: "2026-11-27", minC: 9, maxC: 21, glyph: "partly" }],
};

test("eval fixture covers 50+ prompts across every AskAction and near misses", () => {
  assert.ok(EVAL_PROMPTS.length >= 50, `expected >= 50 prompts, got ${EVAL_PROMPTS.length}`);
  const actions = new Set<AskAction>(EVAL_PROMPTS.map((c) => c.expectedAction));
  assert.deepEqual(
    [...actions].sort(),
    ["briefing", "domotics_updated", "reminder_added", "watch", "weather"],
  );
  assert.ok(EVAL_PROMPTS.filter((c) => c.nearMiss).length >= 5);
  assert.ok(EVAL_PROMPTS.filter((c) => c.freeText).length >= 8);
});

test("every eval prompt routes offline to its expected action and payload", async () => {
  for (const c of EVAL_PROMPTS) {
    const added: [string, string | undefined][] = [];
    const lights: LightsCommand[] = [];
    const watches: WatchIntent[] = [];
    const bodies: string[] = [];

    const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "At your service." }] } }] }), {
        status: 200,
      });
    }) as typeof fetch;

    const fx: Effects = {
      addReminder: (text, due) => added.push([text, due]),
      openReminders: () => ["water the plants"],
      lights: async (cmd) => void lights.push(cmd),
      find: async (intent) => {
        watches.push(intent);
        return [{ type: intent.kind ?? "movie", title: { id: "tt0000001", name: "Sample", year: "2024", rating: "8.0" } }];
      },
      weather: async () => FORECAST,
      geminiKey: "k-test",
      fetch: fakeFetch,
    };

    const a = await route(c.prompt, fx);
    assert.equal(a.action, c.expectedAction, `prompt "${c.prompt}" routed to ${a.action}`);

    if (c.expectedAction !== "briefing") {
      assert.equal(bodies.length, 0, `local prompt "${c.prompt}" should not call Gemini`);
    } else {
      assert.equal(bodies.length, 1, `briefing prompt "${c.prompt}" should call Gemini once`);
      assert.match(bodies[0], /water the plants/);
      assert.match(bodies[0], /Berlin/);
    }

    if (c.expectedReminder) {
      assert.deepEqual(added, [[c.expectedReminder[0], c.expectedReminder[1]]], `reminder payload for "${c.prompt}"`);
    }
    if (c.expectedWatch) {
      assert.equal(watches.length, 1, `watch call count for "${c.prompt}"`);
      if ("term" in c.expectedWatch) assert.equal(watches[0].term, c.expectedWatch.term, `watch term for "${c.prompt}"`);
      if ("kind" in c.expectedWatch) assert.equal(watches[0].kind, c.expectedWatch.kind, `watch kind for "${c.prompt}"`);
      if ("genre" in c.expectedWatch) assert.equal(watches[0].genre, c.expectedWatch.genre, `watch genre for "${c.prompt}"`);
    }
    if (c.expectedQuery) {
      assert.equal(a.query, c.expectedQuery, `watch query for "${c.prompt}"`);
    }
    if (c.expectedLights) {
      assert.deepEqual(lights, [c.expectedLights], `lights command for "${c.prompt}"`);
    }
  }
});

test("briefing prompts in the eval set fall back cleanly when Gemini is absent or refuses", async () => {
  const refuse = (async () => new Response("{}", { status: 503 })) as typeof fetch;
  for (const c of EVAL_PROMPTS.filter((x) => x.expectedAction === "briefing")) {
    const withoutKey = await route(c.prompt, {
      addReminder: () => undefined,
      openReminders: () => ["water the plants"],
      lights: async () => undefined,
    });
    assert.equal(withoutKey.action, "briefing");
    assert.match(withoutKey.reply, /Secretary Briefing/);

    const refused = await route(c.prompt, {
      addReminder: () => undefined,
      openReminders: () => ["water the plants"],
      lights: async () => undefined,
      geminiKey: "k-test",
      fetch: refuse,
    });
    assert.equal(refused.action, "briefing");
    assert.match(refused.reply, /Secretary Briefing/);
  }
});

test("runLiveEval and formatEvalReport measure latency, reply length, Markdown and fallback", async () => {
  const sample = [
    { prompt: "Briefing", expectedAction: "briefing" as const, freeText: true },
    { prompt: "Tell me a dry joke", expectedAction: "briefing" as const, freeText: true },
    { prompt: "Who directed Dune?", expectedAction: "briefing" as const, freeText: true },
    { prompt: "Play Dune", expectedAction: "watch" as const },
  ];
  const steps = [0, 420, 1000, 1650, 2000, 2900];
  let tick = 0;
  let call = 0;
  const longText = "A".repeat(REPLY_MAX_CHARS + 12);
  const fakeFetch = (async () => {
    call++;
    if (call === 1) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Crisp one-liner." }] } }] }), { status: 200 });
    }
    if (call === 2) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `**Bold** ${longText}` }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 503 });
  }) as typeof fetch;

  const summary = await runLiveEval(sample, {
    key: "k-test",
    fetch: fakeFetch,
    now: () => steps[Math.min(tick++, steps.length - 1)],
  });

  // Only the three freeText prompts run; the watch prompt is skipped.
  assert.equal(summary.rows.length, 3);
  assert.deepEqual(
    summary.rows.map((r) => r.ms),
    [420, 650, 900],
  );
  assert.equal(summary.p50Ms, 650);
  assert.equal(summary.p95Ms, 900);
  assert.equal(summary.maxMs, 900);
  assert.equal(summary.rows[0].model, "gemini-3.5-flash-lite");
  assert.equal(summary.rows[1].overLength, true);
  assert.equal(summary.rows[1].hasMarkdown, true);
  assert.equal(summary.rows[2].model, null);
  assert.equal(summary.fellBack, 1);
  assert.equal(summary.overLength, 1);
  assert.equal(summary.hasMarkdown, 1);

  const report = formatEvalReport(summary);
  assert.match(report, /gemini-3\.5-flash-lite/);
  assert.match(report, /LONG,MD/);
  assert.match(report, /FALLBACK/);
  assert.match(report, /p50=650ms p95=900ms max=900ms/);
});
