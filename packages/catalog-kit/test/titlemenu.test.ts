import assert from "node:assert/strict";
import { test } from "node:test";
import { stepTitleMenu, titleMenu } from "../src/lib/titlemenu.ts";

const base = { series: false, hasProgress: false, watched: false, saved: false, saga: false };

test("a film with nothing saved offers play, sources, watched and My List", () => {
  assert.deepEqual(titleMenu(base).map((l) => l.id), ["play", "sources", "watched", "mylist"]);
});

test("progress adds Resume and Start over, an episode names itself", () => {
  const lines = titleMenu({ ...base, series: true, episode: "S1 · E3", hasProgress: true });
  assert.deepEqual(lines.map((l) => l.id), ["play", "restart", "sources", "watched", "mylist"]);
  assert.equal(lines[0].label, "▶ Resume S1 · E3");
  assert.equal(lines[1].label, "↺ Start over S1 · E3");
});

test("a saga adds the timeline and the watched and saved lines flip", () => {
  const lines = titleMenu({ ...base, saga: true, watched: true, saved: true });
  assert.deepEqual(lines.map((l) => l.id), ["play", "sources", "timeline", "watched", "mylist"]);
  assert.equal(lines.find((l) => l.id === "watched")?.label, "☐ Mark not watched");
  assert.equal(lines.find((l) => l.id === "mylist")?.label, "− Remove from My List");
});

test("the menu walks with Up and Down, OK runs and Back closes", () => {
  assert.equal(stepTitleMenu(0, 4, "Up"), 0);
  assert.equal(stepTitleMenu(0, 4, "Down"), 1);
  assert.equal(stepTitleMenu(3, 4, "Down"), 3);
  assert.equal(stepTitleMenu(2, 4, "Enter"), "run");
  assert.equal(stepTitleMenu(2, 4, "Back"), "close");
  assert.equal(stepTitleMenu(2, 4, "Left"), 2);
});

test("Nest's tile menu leads with the title's page", () => {
  assert.deepEqual(titleMenu({ ...base, details: true }).map((l) => l.id), ["details", "play", "sources", "watched", "mylist"]);
});
