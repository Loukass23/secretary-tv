import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../src/route.ts";
import { type FocusedTitleContext, parseTitleQuestion, sanitizeTitleContext } from "../src/title-qa.ts";

const SHOW: FocusedTitleContext = {
  id: "tt11280740",
  kind: "series",
  name: "Severance",
  year: "2022",
  rating: "8.7",
  genres: ["Sci-Fi", "Thriller"],
  director: ["Ben Stiller"],
  cast: ["Adam Scott", "Britt Lower", "John Turturro"],
  description: "Mark leads a team of office workers whose memories have been surgically divided between work and personal lives.",
  spoilerMode: "off",
  lastWatched: {
    label: "S1 · E1",
    name: "Good News About Hell",
    overview: "Mark is promoted to lead Macrodata Refinement after Petey's sudden departure.",
  },
  nextEpisode: {
    label: "S1 · E2",
    name: "Half Loop",
    overview: "Helly undergoes the severance procedure and tries to escape the severed floor.",
    unwatched: true,
  },
};

test("parseTitleQuestion matches title Q&A prompts and leaves near misses alone", () => {
  assert.equal(parseTitleQuestion("What's this about?"), "about");
  assert.equal(parseTitleQuestion("Tell me about this show"), "about");
  assert.equal(parseTitleQuestion("Is it any good?"), "worth");
  assert.equal(parseTitleQuestion("What's the rating?"), "worth");
  assert.equal(parseTitleQuestion("Who's in this?"), "people");
  assert.equal(parseTitleQuestion("Who directed this?"), "people");
  assert.equal(parseTitleQuestion("Catch me up"), "catchup");
  assert.equal(parseTitleQuestion("What's the next episode about?"), "next_episode");

  // Near misses keep going to their own handlers.
  assert.equal(parseTitleQuestion("Catch me up on my day"), null);
  assert.equal(parseTitleQuestion("What's the weather?"), null);
  assert.equal(parseTitleQuestion("What's on tonight?"), null);
  assert.equal(parseTitleQuestion("Tell me a dry joke"), null);
});

test("title questions answer offline from catalog metadata when no Gemini key is set", async () => {
  const fx = {
    addReminder: () => undefined,
    openReminders: () => [],
    lights: async () => undefined,
    focusedTitle: async () => SHOW,
  };

  const about = await route("What's this about?", fx);
  assert.equal(about.action, "title_info");
  assert.match(about.reply, /Severance.*surgically divided/);

  const worth = await route("Is it any good?", fx);
  assert.equal(worth.action, "title_info");
  assert.match(worth.reply, /8\.7\/10/);

  const cast = await route("Who's in this?", fx);
  assert.match(cast.reply, /Ben Stiller/);
  assert.match(cast.reply, /Adam Scott/);

  const catchup = await route("Catch me up", fx);
  assert.match(catchup.reply, /S1 · E1/);
  assert.match(catchup.reply, /Up next: S1 · E2/);
});

test("Spoilers Off / Blur / Hide: unwatched episode plot is stripped before Gemini sees it", async () => {
  assert.equal(sanitizeTitleContext({ ...SHOW, spoilerMode: "off" }).nextEpisode?.overview, SHOW.nextEpisode?.overview);
  assert.equal(sanitizeTitleContext({ ...SHOW, spoilerMode: "blur" }).nextEpisode?.overview, undefined);
  assert.equal(sanitizeTitleContext({ ...SHOW, spoilerMode: "hide" }).nextEpisode?.overview, undefined);

  const bodies: string[] = [];
  const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Mark leads Macrodata Refinement; S1 · E2 awaits." }] } }] }), {
      status: 200,
    });
  }) as typeof fetch;

  // Blur: "Catch me up" calls Gemini with watched S1E1 overview, NEVER unwatched S1E2 overview.
  const blurCatchup = await route("Catch me up", {
    addReminder: () => undefined,
    openReminders: () => [],
    lights: async () => undefined,
    focusedTitle: async () => ({ ...SHOW, spoilerMode: "blur" }),
    geminiKey: "k-test",
    fetch: fakeFetch,
  });
  assert.equal(blurCatchup.action, "title_info");
  assert.equal(bodies.length, 1);
  assert.match(bodies[0], /Macrodata Refinement/);
  assert.doesNotMatch(bodies[0], /tries to escape the severed floor/);

  // Blur and Hide on "What's the next episode about?": answered locally with zero Gemini calls and zero plot leak.
  const blurNext = await route("What's the next episode about?", {
    addReminder: () => undefined,
    openReminders: () => [],
    lights: async () => undefined,
    focusedTitle: async () => ({ ...SHOW, spoilerMode: "blur" }),
    geminiKey: "k-test",
    fetch: fakeFetch,
  });
  assert.equal(bodies.length, 1, "no model call when next episode is spoiler-protected");
  assert.match(blurNext.reply, /Spoiler protection is on Blur/);
  assert.doesNotMatch(blurNext.reply, /tries to escape/);

  const hideNext = await route("What's the next episode about?", {
    addReminder: () => undefined,
    openReminders: () => [],
    lights: async () => undefined,
    focusedTitle: async () => ({ ...SHOW, spoilerMode: "hide" }),
    geminiKey: "k-test",
    fetch: fakeFetch,
  });
  assert.equal(bodies.length, 1);
  assert.match(hideNext.reply, /plot hidden while Spoiler protection is on Hide/);
  assert.doesNotMatch(hideNext.reply, /tries to escape/);

  // Off: unwatched next episode overview IS allowed in the prompt.
  await route("What's the next episode about?", {
    addReminder: () => undefined,
    openReminders: () => [],
    lights: async () => undefined,
    focusedTitle: async () => ({ ...SHOW, spoilerMode: "off" }),
    geminiKey: "k-test",
    fetch: fakeFetch,
  });
  assert.equal(bodies.length, 2);
  assert.match(bodies[1], /tries to escape the severed floor/);
});
