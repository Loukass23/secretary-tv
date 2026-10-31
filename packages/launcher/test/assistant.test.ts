import { test } from "node:test";
import assert from "node:assert/strict";
import { themeFor, themePrompt, waveState } from "../src/assistant.ts";

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
