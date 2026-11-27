// Offline evaluation set for Ask Nest's route(): 64 viewer prompts and near misses across every AskAction.
// Kept under test/ so Vite never bundles it into Secretary's .wgt while tsc still typechecks it.
import type { AskAction, LightsCommand } from "../../src/route.ts";
import type { CatalogKind } from "../../src/types.ts";

export interface EvalCase {
  prompt: string;
  expectedAction: AskAction;
  /** Expected [taskText, due] passed to Effects.addReminder. */
  expectedReminder?: readonly [string, string | undefined];
  /** Expected intent fields passed to Effects.find, and Answer.query when relevant. */
  expectedWatch?: { term?: string; kind?: CatalogKind; genre?: string };
  expectedQuery?: string;
  /** Expected command passed to Effects.lights. */
  expectedLights?: LightsCommand;
  /** True for natural questions/briefings that test-drive a live Gemini model in eval-live.ts. */
  freeText?: boolean;
  /** Prompts whose surface words resemble another handler ("show me the weather", "warm lights"). */
  nearMiss?: boolean;
}

export const EVAL_PROMPTS: readonly EvalCase[] = [
  // 1. Reminders (10)
  {
    prompt: "Remind me to water the plants",
    expectedAction: "reminder_added",
    expectedReminder: ["water the plants", undefined],
  },
  {
    prompt: "Remind me to call mum at 18:00",
    expectedAction: "reminder_added",
    expectedReminder: ["call mum", "18:00"],
  },
  {
    prompt: "remind me to take the bins out by tonight",
    expectedAction: "reminder_added",
    expectedReminder: ["take the bins out", "tonight"],
  },
  {
    prompt: "Add a reminder to check the oven at 8pm",
    expectedAction: "reminder_added",
    expectedReminder: ["check the oven", "8pm"],
  },
  {
    prompt: "Add reminder feed the cat",
    expectedAction: "reminder_added",
    expectedReminder: ["feed the cat", undefined],
  },
  {
    prompt: "Remind me to check the oven in 20 minutes",
    expectedAction: "reminder_added",
    expectedReminder: ["check the oven", "in 20 minutes"],
  },
  {
    prompt: "Remind me to call mum tomorrow at 8",
    expectedAction: "reminder_added",
    expectedReminder: ["call mum", "tomorrow at 8"],
  },
  {
    prompt: "Reminder: renew passport by tomorrow",
    expectedAction: "reminder_added",
    expectedReminder: ["renew passport", "tomorrow"],
  },
  {
    prompt: "Remind me pick up laundry at 9:30 am",
    expectedAction: "reminder_added",
    expectedReminder: ["pick up laundry", "9:30 am"],
  },
  {
    prompt: "remind me to send the invoice by today",
    expectedAction: "reminder_added",
    expectedReminder: ["send the invoice", "today"],
  },
  {
    prompt: "Remind me to stretch at 7",
    expectedAction: "reminder_added",
    expectedReminder: ["stretch", "7"],
  },
  {
    prompt: "add a reminder to lock the back door at 22:15",
    expectedAction: "reminder_added",
    expectedReminder: ["lock the back door", "22:15"],
  },

  // 2. Watch: named titles and kinds (11)
  {
    prompt: "Play Dune",
    expectedAction: "watch",
    expectedWatch: { term: "dune" },
    expectedQuery: "“dune”",
  },
  {
    prompt: "Watch the movie Arrival",
    expectedAction: "watch",
    expectedWatch: { term: "arrival", kind: "movie" },
    expectedQuery: "“arrival”",
  },
  {
    prompt: "Show me Severance",
    expectedAction: "watch",
    expectedWatch: { term: "severance" },
    expectedQuery: "“severance”",
  },
  {
    prompt: "Find the series Fargo",
    expectedAction: "watch",
    expectedWatch: { term: "fargo", kind: "series" },
    expectedQuery: "“fargo”",
  },
  {
    prompt: "Put on Spirited Away",
    expectedAction: "watch",
    expectedWatch: { term: "spirited away" },
    expectedQuery: "“spirited away”",
  },
  {
    prompt: "Search for Cowboy Bebop anime",
    expectedAction: "watch",
    expectedWatch: { term: "cowboy bebop", kind: "anime" },
    expectedQuery: "“cowboy bebop”",
  },
  {
    prompt: "Could you play Paddington 2?",
    expectedAction: "watch",
    expectedWatch: { term: "paddington 2" },
    expectedQuery: "“paddington 2”",
  },
  {
    prompt: "Hey Nest, I want to watch Blade Runner",
    expectedAction: "watch",
    expectedWatch: { term: "blade runner" },
    expectedQuery: "“blade runner”",
  },
  {
    prompt: "Looking for Akira",
    expectedAction: "watch",
    expectedWatch: { term: "akira" },
    expectedQuery: "“akira”",
  },
  {
    prompt: "Please find me the film Heat",
    expectedAction: "watch",
    expectedWatch: { term: "heat", kind: "movie" },
    expectedQuery: "“heat”",
  },
  {
    prompt: "I'd like to see Andor",
    expectedAction: "watch",
    expectedWatch: { term: "andor" },
    expectedQuery: "“andor”",
  },

  // 3. Watch: genre, kind and open discovery (11)
  {
    prompt: "Something for tonight",
    expectedAction: "watch",
    expectedWatch: { kind: undefined, genre: undefined },
    expectedQuery: "top films and series",
  },
  {
    prompt: "What should I watch?",
    expectedAction: "watch",
    expectedWatch: { kind: undefined, genre: undefined },
    expectedQuery: "top films and series",
  },
  {
    prompt: "What's trending tonight?",
    expectedAction: "watch",
    expectedWatch: { kind: undefined, genre: undefined },
    expectedQuery: "top films and series",
  },
  {
    prompt: "Show me a comedy",
    expectedAction: "watch",
    expectedWatch: { kind: undefined, genre: "Comedy" },
    expectedQuery: "comedy films and series",
  },
  {
    prompt: "Show me a comedy movie",
    expectedAction: "watch",
    expectedWatch: { kind: "movie", genre: "Comedy" },
    expectedQuery: "comedy films",
  },
  {
    prompt: "Find me scary anime",
    expectedAction: "watch",
    expectedWatch: { kind: "anime", genre: "Horror" },
    expectedQuery: "horror anime",
  },
  {
    prompt: "Recommend me some sci-fi shows",
    expectedAction: "watch",
    expectedWatch: { kind: "series", genre: "Sci-Fi" },
    expectedQuery: "sci-fi series",
  },
  {
    prompt: "Suggest a good thriller film",
    expectedAction: "watch",
    expectedWatch: { kind: "movie", genre: "Thriller" },
    expectedQuery: "thriller films",
  },
  {
    prompt: "Any good documentaries?",
    expectedAction: "watch",
    expectedWatch: { kind: undefined, genre: "Documentary" },
    expectedQuery: "documentary films and series",
  },
  {
    prompt: "Give me a family movie",
    expectedAction: "watch",
    expectedWatch: { kind: "movie", genre: "Family" },
    expectedQuery: "family films",
  },
  {
    prompt: "Anything good on TV?",
    expectedAction: "watch",
    expectedWatch: { kind: "series", genre: undefined },
    expectedQuery: "top series",
  },

  // 4. Weather (7)
  { prompt: "What's the weather?", expectedAction: "weather" },
  { prompt: "Do I need an umbrella?", expectedAction: "weather" },
  { prompt: "What is the forecast for tomorrow?", expectedAction: "weather" },
  { prompt: "Is it raining outside?", expectedAction: "weather" },
  { prompt: "Is it cold tonight?", expectedAction: "weather" },
  { prompt: "Will it snow tomorrow?", expectedAction: "weather" },
  { prompt: "Temperature today", expectedAction: "weather" },

  // 5. Lights and music mode (8)
  { prompt: "Cinema mode", expectedAction: "domotics_updated", expectedLights: { scene: "cinema" } },
  { prompt: "Movie mode lights", expectedAction: "domotics_updated", expectedLights: { scene: "cinema" } },
  { prompt: "Music mode", expectedAction: "domotics_updated", expectedLights: { scene: "music" } },
  { prompt: "Turn off the lights", expectedAction: "domotics_updated", expectedLights: { scene: "off" } },
  { prompt: "All lamps off", expectedAction: "domotics_updated", expectedLights: { scene: "off" } },
  { prompt: "Dim the lights to 20%", expectedAction: "domotics_updated", expectedLights: { level: 20 } },
  { prompt: "Set living room lamp to 65%", expectedAction: "domotics_updated", expectedLights: { level: 65 } },
  { prompt: "Bright lights please", expectedAction: "domotics_updated", expectedLights: { scene: "warm" } },
  { prompt: "Goodnight", expectedAction: "domotics_updated", expectedLights: { scene: "off" } },
  { prompt: "Movie night", expectedAction: "watch", expectedWatch: { kind: "movie" }, expectedQuery: "top films", expectedLights: { scene: "cinema" } },
  { prompt: "Good morning", expectedAction: "weather", expectedLights: { scene: "warm" } },
  { prompt: "What's this about?", expectedAction: "title_info" },
  { prompt: "Is it any good?", expectedAction: "title_info" },
  { prompt: "Catch me up", expectedAction: "title_info" },
  { prompt: "What's the next episode about?", expectedAction: "title_info" },
  { prompt: "What was I watching?", expectedAction: "watch", expectedQuery: "Continue watching" },
  { prompt: "Resume Severance", expectedAction: "resume", expectedQuery: "“Severance”" },
  { prompt: "Show my list", expectedAction: "watch", expectedQuery: "My List" },
  { prompt: "Add this to My List", expectedAction: "mylist_updated" },

  // 6. Free-text / briefing prompts (8)
  { prompt: "Briefing", expectedAction: "briefing", freeText: true },
  { prompt: "Good evening", expectedAction: "briefing", freeText: true },
  { prompt: "Catch me up on my day", expectedAction: "briefing", freeText: true },
  { prompt: "Who directed Dune?", expectedAction: "briefing", freeText: true },
  { prompt: "Tell me a dry joke", expectedAction: "briefing", freeText: true },
  { prompt: "How long is Seven Samurai?", expectedAction: "briefing", freeText: true },
  { prompt: "What time does sunset usually happen in winter?", expectedAction: "briefing", freeText: true },
  { prompt: "Surprise me with a fun movie fact", expectedAction: "briefing", freeText: true },

  // 7. Near misses (9)
  { prompt: "Give me a briefing", expectedAction: "briefing", freeText: true, nearMiss: true },
  { prompt: "Show me the news", expectedAction: "briefing", freeText: true, nearMiss: true },
  { prompt: "Show me the weather", expectedAction: "weather", nearMiss: true },
  { prompt: "Show me the forecast", expectedAction: "weather", nearMiss: true },
  { prompt: "Show me the lights", expectedAction: "domotics_updated", expectedLights: { scene: "warm" }, nearMiss: true },
  { prompt: "Find my reminders", expectedAction: "briefing", freeText: true, nearMiss: true },
  { prompt: "What tasks do I have?", expectedAction: "briefing", freeText: true, nearMiss: true },
  { prompt: "Warm lights", expectedAction: "domotics_updated", expectedLights: { scene: "warm" }, nearMiss: true },
  { prompt: "Is The Lighthouse scary?", expectedAction: "briefing", freeText: true, nearMiss: true },
  { prompt: "What's on my plate today?", expectedAction: "briefing", freeText: true, nearMiss: true },
  { prompt: "Play Goodnight Mommy", expectedAction: "watch", expectedWatch: { term: "goodnight mommy" }, nearMiss: true },
  { prompt: "Play", expectedAction: "briefing", nearMiss: true },
];
