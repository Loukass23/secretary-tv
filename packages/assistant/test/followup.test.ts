import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeminiContents,
  MAX_HISTORY_TURNS,
  parseOrdinalFollowUp,
  type TurnHistoryItem,
} from "../src/followup.ts";
import type { WatchIntent } from "../src/intent.ts";
import { type Effects, route } from "../src/route.ts";
import type { SearchResult } from "../src/types.ts";

const THRILLERS: SearchResult[] = [
  {
    type: "movie",
    title: {
      id: "tt3397884",
      name: "Sicario",
      year: "2015",
      rating: "7.7",
      description: "An idealistic FBI agent joins a border task force.",
    },
  },
  {
    type: "movie",
    title: {
      id: "tt1392214",
      name: "Prisoners",
      year: "2013",
      rating: "8.2",
      description: "A desperate father hunts for two missing girls.",
    },
  },
  {
    type: "movie",
    title: {
      id: "tt2872718",
      name: "Nightcrawler",
      year: "2014",
      rating: "7.8",
    },
  },
];

const DUNE: SearchResult = {
  type: "movie",
  title: {
    id: "tt1160419",
    name: "Dune",
    year: "2021",
    rating: "8.0",
    description: "Paul Atreides journeys to the desert planet Arrakis.",
  },
};

function baseEffects(overrides: Partial<Effects> = {}): Effects {
  return {
    addReminder: () => undefined,
    openReminders: () => [],
    lights: async () => undefined,
    find: async () => [],
    ...overrides,
  };
}

test("parseOrdinalFollowUp matches ordinal selections and ignores normal titles", () => {
  assert.deepEqual(parseOrdinalFollowUp("the second one"), { at: 1, open: false });
  assert.deepEqual(parseOrdinalFollowUp("Play the first one"), { at: 0, open: true });
  assert.deepEqual(parseOrdinalFollowUp("number 3"), { at: 2, open: false });
  assert.deepEqual(parseOrdinalFollowUp("watch the last movie"), { at: "last", open: true });

  assert.equal(parseOrdinalFollowUp("Play The Sixth Sense"), null);
  assert.equal(parseOrdinalFollowUp("Play First Man"), null);
});

test("ordinal follow-ups resolve locally from the latest watch turn without calling Gemini", async () => {
  const history: TurnHistoryItem[] = [
    {
      prompt: "show me a thriller",
      reply: "Here are thriller films worth a look.",
      action: "watch",
      query: "thriller films",
      results: THRILLERS,
    },
    {
      prompt: "what's the weather?",
      reply: "It's 18° and partly cloudy in Berlin.",
      action: "weather",
    },
  ];
  let geminiCalls = 0;
  const fakeFetch = (async () => {
    geminiCalls++;
    return new Response("{}", { status: 500 });
  }) as typeof fetch;

  const picked = await route(
    "the second one",
    baseEffects({ history, geminiKey: "k-test", fetch: fakeFetch }),
  );
  assert.equal(geminiCalls, 0);
  assert.equal(picked.action, "watch");
  assert.equal(picked.query, "“Prisoners”");
  assert.deepEqual(picked.results?.map((r) => r.title.name), ["Prisoners"]);

  const opened = await route(
    "play the first one",
    baseEffects({ history, geminiKey: "k-test", fetch: fakeFetch }),
  );
  assert.equal(geminiCalls, 0);
  assert.equal(opened.action, "resume");
  assert.deepEqual(opened.results?.map((r) => r.title.name), ["Sicario"]);

  const outOfRange = await route("the fifth one", baseEffects({ history }));
  assert.equal(outOfRange.action, "briefing");
  assert.match(outOfRange.reply, /only showed 3 titles/i);
});

test("comparative follow-up ('something lighter') sends prior turns to Gemini and dispatches structured watch intent", async () => {
  const history: TurnHistoryItem[] = [
    {
      prompt: "show me a thriller",
      reply: "Here are thriller films worth a look.",
      action: "watch",
      query: "thriller films",
      results: THRILLERS,
    },
  ];
  const bodies: { contents: { role?: string; parts: { text: string }[] }[] }[] = [];
  const watches: WatchIntent[] = [];

  const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: "watch",
                    kind: "movie",
                    genre: "Comedy",
                    reply: "Fine, a comedy film before your nerves fray completely.",
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const a = await route(
    "something lighter",
    baseEffects({
      history,
      geminiKey: "k-test",
      fetch: fakeFetch,
      find: async (intent) => {
        watches.push(intent);
        return [{ type: "movie", title: { id: "tt4468740", name: "Paddington 2", year: "2017", rating: "7.8" } }];
      },
    }),
  );

  assert.equal(bodies.length, 1);
  assert.deepEqual(
    bodies[0].contents.map((c) => c.role),
    ["user", "model", "user"],
  );
  assert.equal(bodies[0].contents[0].parts[0].text, "show me a thriller");
  assert.match(bodies[0].contents[1].parts[0].text, /Sicario/);
  assert.deepEqual(watches, [{ term: undefined, kind: "movie", genre: "Comedy" }]);
  assert.equal(a.action, "watch");
  assert.match(a.reply, /comedy film/i);
  assert.deepEqual(a.results?.map((r) => r.title.name), ["Paddington 2"]);
});

test("comparative follow-up ('something lighter') still shifts genre offline without a Gemini key", async () => {
  const history: TurnHistoryItem[] = [
    {
      prompt: "show me a thriller",
      reply: "Here are thriller films worth a look.",
      action: "watch",
      query: "thriller films",
      results: THRILLERS,
    },
  ];
  const watches: WatchIntent[] = [];
  const a = await route(
    "something lighter",
    baseEffects({
      history,
      find: async (intent) => {
        watches.push(intent);
        return [{ type: "movie", title: { id: "tt4468740", name: "Paddington 2", year: "2017", rating: "7.8" } }];
      },
    }),
  );
  assert.deepEqual(watches, [{ kind: "movie", genre: "Comedy" }]);
  assert.equal(a.action, "watch");
  assert.equal(a.query, "comedy films");
});

test("pronoun follow-ups ('who's in it?', 'is it any good?') use conversation history rather than a different focused card", async () => {
  const history: TurnHistoryItem[] = [
    {
      prompt: "play Dune",
      reply: "Here is what I found for “dune”.",
      action: "watch",
      query: "“dune”",
      results: [DUNE],
    },
  ];
  const bodies: string[] = [];
  const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: "chat",
                    reply: "Denis Villeneuve's Dune stars Timothée Chalamet and Rebecca Ferguson.",
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const focusedOtherCard = async () => ({
    id: "tt11280740",
    kind: "series" as const,
    name: "Severance",
    rating: "8.7",
    spoilerMode: "blur" as const,
  });

  // "who's in it?" and "is it any good?" refer to Dune in history, not Severance on the home row.
  const cast = await route(
    "who's in it?",
    baseEffects({ history, focusedTitle: focusedOtherCard, geminiKey: "k-test", fetch: fakeFetch }),
  );
  assert.equal(cast.action, "briefing");
  assert.match(bodies[0], /Dune/);
  assert.doesNotMatch(bodies[0], /Severance/);
  assert.match(cast.reply, /Timothée Chalamet/);

  const worthOffline = await route("is it any good?", baseEffects({ history, focusedTitle: focusedOtherCard }));
  assert.equal(worthOffline.action, "title_info");
  assert.match(worthOffline.reply, /Dune.*8\.0\/10/);

  // Explicit "this" ("is this any good?") still inspects the focused card on screen.
  const explicitThis = await route("is this any good?", baseEffects({ history, focusedTitle: focusedOtherCard }));
  assert.equal(explicitThis.action, "title_info");
  assert.match(explicitThis.reply, /Severance/);
});

test("buildGeminiContents caps conversation memory at MAX_HISTORY_TURNS and standalone intents ignore stale history", async () => {
  const many: TurnHistoryItem[] = Array.from({ length: 7 }, (_, i) => ({
    prompt: `turn-${i + 1}`,
    reply: `reply-${i + 1}`,
    action: "briefing",
  }));
  const contents = buildGeminiContents(many, "final prompt");
  assert.equal(contents.length, MAX_HISTORY_TURNS * 2 + 1);
  assert.equal(contents[0].parts[0].text, "turn-4");
  assert.equal(contents[contents.length - 1].parts[0].text, "final prompt");

  // Standalone local intents run directly even when history has prior watch results.
  const history: TurnHistoryItem[] = [{ prompt: "play Dune", reply: "Found Dune.", action: "watch", results: [DUNE] }];
  let lightsCalled = false;
  const lights = await route(
    "Cinema mode",
    baseEffects({
      history,
      lights: async () => {
        lightsCalled = true;
      },
    }),
  );
  assert.equal(lights.action, "domotics_updated");
  assert.equal(lightsCalled, true);
});
