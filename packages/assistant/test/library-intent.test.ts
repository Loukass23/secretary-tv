import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibraryIntent } from "../src/library-intent.ts";
import { route } from "../src/route.ts";
import type { SearchResult } from "../src/types.ts";

const SEVERANCE: SearchResult = {
  type: "series",
  title: { id: "tt11280740", name: "Severance", year: "2022", rating: "8.7" },
};
const DUNE: SearchResult = {
  type: "movie",
  title: { id: "tt1160419", name: "Dune", year: "2021", rating: "8.0" },
};

test("parseLibraryIntent parses Continue Watching and My List prompts and skips near misses", () => {
  assert.deepEqual(parseLibraryIntent("What was I watching?"), { kind: "continue_list" });
  assert.deepEqual(parseLibraryIntent("Continue watching"), { kind: "continue_list" });
  assert.deepEqual(parseLibraryIntent("Resume Severance"), { kind: "resume_named", term: "severance" });
  assert.deepEqual(parseLibraryIntent("Show my list"), { kind: "show_mylist" });
  assert.deepEqual(parseLibraryIntent("Add this to My List"), { kind: "set_mylist", wantSaved: true });
  assert.deepEqual(parseLibraryIntent("Remove this from My List"), { kind: "set_mylist", wantSaved: false });

  assert.equal(parseLibraryIntent("Play Schindler's List"), null);
  assert.equal(parseLibraryIntent("Remind me to make a list"), null);
});

test("route() resumes in-progress titles, shows My List, toggles saved state, and falls back to search", async () => {
  const toggled: boolean[] = [];
  const fx = {
    addReminder: () => undefined,
    openReminders: () => [],
    lights: async () => undefined,
    continueWatching: () => [SEVERANCE],
    myList: () => [DUNE],
    setMyList: (want: boolean) => {
      toggled.push(want);
      return { name: "Dune", saved: want, item: DUNE };
    },
    find: async (intent: { term?: string }) =>
      intent.term === "arrival" ? [{ type: "movie" as const, title: { id: "tt2543164", name: "Arrival", year: "2016", rating: "7.9" } }] : [],
  };

  const cw = await route("What was I watching?", fx);
  assert.equal(cw.action, "watch");
  assert.equal(cw.query, "Continue watching");
  assert.equal(cw.results?.[0].title.name, "Severance");

  const res = await route("Resume Severance", fx);
  assert.equal(res.action, "resume");
  assert.equal(res.results?.[0].title.id, "tt11280740");

  // Not in Continue Watching: falls back to catalog search.
  const fallback = await route("Resume Arrival", fx);
  assert.equal(fallback.action, "watch");
  assert.equal(fallback.results?.[0].title.name, "Arrival");

  const list = await route("What's on my list?", fx);
  assert.equal(list.action, "watch");
  assert.equal(list.query, "My List");
  assert.equal(list.results?.[0].title.name, "Dune");

  const saved = await route("Add this to My List", fx);
  assert.equal(saved.action, "mylist_updated");
  assert.match(saved.reply, /Saved “Dune” to My List/);
  assert.deepEqual(toggled, [true]);
});
