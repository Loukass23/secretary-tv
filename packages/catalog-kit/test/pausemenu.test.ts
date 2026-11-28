import { test } from "node:test";
import assert from "node:assert/strict";
import { pauseActions, pauseMenuShown, stepPause, timeLeftLabel } from "../src/lib/pausemenu.ts";
import { menuAt } from "../src/lib/playermenu.ts";

test("the pause menu's buttons: Next only with an episode after, Picture only where the fit can change", () => {
  assert.deepEqual(pauseActions({ next: true, picture: true }), ["play", "restart", "next", "subs", "audio", "picture"]);
  assert.deepEqual(pauseActions({ next: false, picture: false }), ["play", "restart", "subs", "audio"]);
});

test("Sources sits after Audio where the player can switch source, and never while watching together", () => {
  assert.deepEqual(pauseActions({ next: true, picture: true, sources: true }), ["play", "restart", "next", "subs", "audio", "sources", "picture"]);
  assert.deepEqual(pauseActions({ next: false, picture: false, sources: false }), ["play", "restart", "subs", "audio"]);
});

test("time left reads as the rest of Secretary writes it", () => {
  assert.equal(timeLeftLabel(600, 3000), "40 min left");
  assert.equal(timeLeftLabel(0, 3900), "1 h 5 min left");
  assert.equal(timeLeftLabel(2990, 3000), "Less than a minute left");
  assert.equal(timeLeftLabel(10, 0), "");
});

test("it shows once paused after the start, with the setting on, never together", () => {
  const base = { enabled: true, started: true, playing: false, together: false };
  assert.equal(pauseMenuShown(base), true);
  assert.equal(pauseMenuShown({ ...base, enabled: false }), false);
  assert.equal(pauseMenuShown({ ...base, playing: true }), false);
  assert.equal(pauseMenuShown({ ...base, started: false }), false);
  assert.equal(pauseMenuShown({ ...base, together: true }), false);
});

test("Left and Right move along the row and stop at its ends; OK runs the focused button", () => {
  assert.deepEqual(stepPause(0, 5, "Left"), { at: 0 });
  assert.deepEqual(stepPause(3, 5, "Right"), { at: 4 });
  assert.deepEqual(stepPause(4, 5, "Right"), { at: 4 });
  assert.deepEqual(stepPause(2, 5, "Enter"), { run: 2 });
  assert.equal(stepPause(2, 5, "Down"), null);
});

test("Subtitles from the pause menu opens the options straight on that page, on the line in use", () => {
  const pages = { subs: { id: "subs", title: "Subtitles", rows: [{ id: "sub-off", label: "Off" }, { id: "sub:en", label: "English", checked: true }] } };
  assert.deepEqual(menuAt("subs", (id) => pages[id as "subs"]), { stack: ["subs"], row: 1 });
  assert.deepEqual(menuAt("top", () => undefined), { stack: ["top"], row: 0 });
});
