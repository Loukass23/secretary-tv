import { test } from "node:test";
import assert from "node:assert/strict";
import { briefing, flipTheme, ripplePrompt, themeFor, themePrompt, waveState } from "../src/assistant.ts";

test("the wave follows the keyboard, the request and the answer", () => {
  const none = { listening: false, asking: false, pending: false, answered: false };
  assert.equal(waveState(none), "idle");
  assert.equal(waveState({ ...none, listening: true, pending: true }), "listening");
  assert.equal(waveState({ ...none, pending: true }), "thinking");
  assert.equal(waveState({ ...none, asking: true, answered: true }), "thinking");
  assert.equal(waveState({ ...none, answered: true }), "speaking");
});

test("Daylight follows the clock on auto", () => {
  assert.equal(themeFor("auto", 6), "night");
  assert.equal(themeFor("auto", 7), "day");
  assert.equal(themeFor("auto", 18), "day");
  assert.equal(themeFor("auto", 19), "night");
  assert.equal(themeFor("night", 12), "night");
  assert.equal(themeFor("day", 23), "day");
});

test("auto follows the room's light when it is clearly bright or dark", () => {
  assert.equal(themeFor("auto", 12, 35), "night");
  assert.equal(themeFor("auto", 22, 400), "day");
  assert.equal(themeFor("auto", 12, 100), "day");
  assert.equal(themeFor("auto", 22, 100), "night");
  assert.equal(themeFor("night", 12, 400), "night");
});

test("theme prompts are answered on the TV", () => {
  assert.equal(themePrompt("Light theme"), "day");
  assert.equal(themePrompt("switch to dark mode"), "night");
  assert.equal(themePrompt("daylight"), "day");
  assert.equal(themePrompt("automatic theme"), "auto");
  assert.equal(themePrompt("cinema mode"), null);
  assert.equal(themePrompt("turn the lights on"), null);
});

test("ripple prompts play the lights' ripple on request", () => {
  assert.equal(ripplePrompt("ripple test"), "open");
  assert.equal(ripplePrompt("Test the ripple"), "open");
  assert.equal(ripplePrompt("launch ripple"), "launch");
  assert.equal(ripplePrompt("test the quick ripple"), "launch");
  assert.equal(ripplePrompt("cinema mode"), null);
  assert.equal(ripplePrompt("turn the lights on"), null);
});

test("the briefing greets by the hour and counts the open reminders", () => {
  const at = (h: number) => new Date(2026, 10, 20, h, 0);
  assert.equal(briefing(at(9), "Sworm", []).greeting, "Good morning, Sworm");
  assert.equal(briefing(at(14), undefined, []).greeting, "Good afternoon");
  assert.equal(briefing(at(21), " ", []).greeting, "Good evening");
  assert.deepEqual(briefing(at(14), "A", []).lines, ["No reminders"]);
  assert.deepEqual(briefing(at(14), "A", [{ text: "Water the plants" }]).lines, ["1 reminder", "Water the plants"]);
  const three = [{ text: "Call mum", due: "6pm" }, { text: "Bins" }, { text: "Post" }];
  assert.deepEqual(briefing(at(14), "A", three).lines, ["3 reminders", "Call mum · 6pm", "Bins", "Post"]);
});

test("the Theme item always flips the look, and comes back to automatic", () => {
  // Daytime, automatic shows Daylight: Night, then automatic (Daylight) again.
  assert.equal(flipTheme("auto", 12), "night");
  assert.equal(flipTheme("night", 12), "auto");
  assert.equal(flipTheme("day", 12), "night");
  // Night time, automatic shows Night: Daylight, then automatic.
  assert.equal(flipTheme("auto", 22), "day");
  assert.equal(flipTheme("day", 22), "auto");
  // A dark room by day: automatic follows the room.
  assert.equal(flipTheme("auto", 12, 20), "day");
  for (const pref of ["auto", "day", "night"] as const) for (const h of [3, 12, 22]) assert.notEqual(themeFor(flipTheme(pref, h), h), themeFor(pref, h));
});
