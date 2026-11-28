import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpChips, statusForInteraction, tailorAssistant } from "../src/assistant-context.ts";
import { clampConversation, type ConversationFocus, dockItemCount, stepConversation, stepDock } from "../src/conversation-nav.ts";
import type { AssistantTurn } from "../src/assistant.ts";

const makeTurn = (patch: Partial<AssistantTurn>): AssistantTurn => ({
  id: 1,
  prompt: "Something for tonight",
  reply: "Here are top films worth a look.",
  action: "watch",
  source: "tv",
  at: 1000,
  ...patch,
});

test("tailorAssistant adapts badge, hint and dock chips to each screen and card", () => {
  const general = tailorAssistant({ screen: "home", hasContinue: true, userName: "Robin" });
  assert.equal(general.badge, "Secretary");
  assert.ok(general.dockChips.includes("What was I watching?"));
  assert.match(general.welcome, /Robin/);

  const cinema = tailorAssistant({
    screen: "home",
    card: "cinema",
    focused: { kind: "movie", title: { id: "tt1", name: "The Quiet Harbour", year: "2024", rating: "8.1" } },
  });
  assert.equal(cinema.badge, "Cinema · The Quiet Harbour");
  assert.ok(cinema.dockChips.includes("What's this about?"));
  assert.match(cinema.hint, /Cinema/);

  const detailSeries = tailorAssistant({
    screen: "detail",
    kind: "series",
    focused: { kind: "series", title: { id: "tt2", name: "Northern Watch", year: "2025", rating: "8.6" }, resume: true },
  });
  assert.equal(detailSeries.badge, "Northern Watch");
  assert.equal(detailSeries.dockChips[0], "Catch me up");
  assert.ok(detailSeries.chatChips.includes("What's the next episode about?"));

  const detailMovie = tailorAssistant({
    screen: "detail",
    kind: "movie",
    focused: { kind: "movie", title: { id: "tt3", name: "Copper Sky", year: "2023", rating: "7.9" } },
  });
  assert.equal(detailMovie.badge, "Copper Sky");
  assert.ok(detailMovie.chatChips.includes("Who directed this?"));

  const lights = tailorAssistant({ screen: "lights", lightsOn: 3, lightsTotal: 5 });
  assert.equal(lights.badge, "Room & Lights");
  assert.match(lights.hint, /3 of 5 lights on/);
  assert.deepEqual(lights.dockChips, ["Cinema mode", "Warm lights", "Turn off the lights"]);

  const weather = tailorAssistant({ screen: "home", card: "weather" });
  assert.equal(weather.badge, "Weather");
  assert.ok(weather.dockChips.includes("Do I need an umbrella?"));
});

test("followUpChips offers relevant next actions without repeating the prompt just asked", () => {
  const watchTurn = makeTurn({
    prompt: "Show me a comedy film",
    action: "watch",
    results: [
      { type: "movie", title: { id: "m1", name: "Harbour Day", year: "2022", rating: "7.5" } },
      { type: "movie", title: { id: "m2", name: "Sunlit Pier", year: "2023", rating: "7.8" } },
    ],
  });
  const chips = followUpChips(watchTurn, { screen: "home", card: "cinema" });
  assert.equal(chips.length, 4);
  assert.equal(chips[0], "Play the first one");
  assert.ok(chips.includes("What about a series instead?"));
  assert.ok(!chips.some((c) => c.toLowerCase() === "show me a comedy film"));

  const titleTurn = makeTurn({
    prompt: "What's this about?",
    action: "title_info",
    results: [{ type: "series", title: { id: "s1", name: "Northern Watch", year: "2025", rating: "8.6" } }],
  });
  const afterAbout = followUpChips(titleTurn, {
    screen: "detail",
    kind: "series",
    focused: { kind: "series", title: { id: "s1", name: "Northern Watch", year: "2025", rating: "8.6" }, resume: true },
  });
  assert.ok(!afterAbout.includes("What's this about?"));
  assert.ok(afterAbout.includes("Catch me up"));
  assert.ok(afterAbout.includes("Who's in it?"));
});

test("statusForInteraction distinguishes waiting for speech, hearing voice, transcribing, thinking and speaking", () => {
  assert.equal(statusForInteraction({ listening: true, hearing: false, transcribing: false, asking: false, speaking: false }), "Listening · speak now");
  assert.equal(statusForInteraction({ listening: true, hearing: true, transcribing: false, asking: false, speaking: false }), "Hearing you…");
  assert.equal(statusForInteraction({ listening: false, hearing: false, transcribing: true, asking: true, speaking: false }), "Transcribing…");
  assert.equal(statusForInteraction({ listening: false, hearing: false, transcribing: false, asking: true, speaking: false }), "Thinking…");
  assert.equal(statusForInteraction({ listening: false, hearing: false, transcribing: false, asking: false, speaking: true }), "Speaking…");
  assert.equal(statusForInteraction({ listening: false, hearing: false, transcribing: false, asking: false, speaking: false }), "");
});

test("stepConversation navigates controls, suggestion chips and multi-turn inline recommendation rows", () => {
  const shape = { resultRows: [3, 5], chips: 4, controls: 3 };
  let f: ConversationFocus = { zone: "controls", i: 0 };
  f = stepConversation(f, "Right", shape);
  assert.deepEqual(f, { zone: "controls", i: 1 });
  f = stepConversation(f, "Up", shape);
  assert.deepEqual(f, { zone: "chips", i: 1 });
  f = stepConversation(f, "Right", shape);
  assert.deepEqual(f, { zone: "chips", i: 2 });
  f = stepConversation(f, "Up", shape);
  assert.deepEqual(f, { zone: "results", row: 1, i: 2 }, "Up from chips enters the newest recommendation row");
  f = stepConversation(f, "Right", shape);
  assert.deepEqual(f, { zone: "results", row: 1, i: 3 });
  f = stepConversation(f, "Up", shape);
  assert.deepEqual(f, { zone: "results", row: 0, i: 2 }, "Up moves to an earlier turn's inline posters, clamped to its length");
  f = stepConversation(f, "Down", shape);
  assert.deepEqual(f, { zone: "results", row: 1, i: 2 });
  f = stepConversation(f, "Down", shape);
  assert.deepEqual(f, { zone: "chips", i: 2 }, "Down from the newest poster row returns to suggestion chips");
  f = stepConversation(f, "Down", shape);
  assert.deepEqual(f, { zone: "controls", i: 0 });
  assert.deepEqual(clampConversation({ zone: "results", row: 4, i: 9 }, { resultRows: [], chips: 4, controls: 2 }), { zone: "chips", i: 0 });
});

test("stepDock walks Speak, tailored chips and Conversation, and leaves on Up", () => {
  assert.equal(dockItemCount(3), 5);
  assert.equal(stepDock(0, "Left", 3), 0);
  assert.equal(stepDock(0, "Right", 3), 1);
  assert.equal(stepDock(3, "Right", 3), 4);
  assert.equal(stepDock(4, "Right", 3), 4);
  assert.equal(stepDock(2, "Up", 3), "leave");
});
