// Tailors Secretary's bottom assistant bar and full-screen conversation to the screen, card or title currently open.
import type { CatalogKind, SlimTitle } from "./apps.ts";
import type { AssistantTurn } from "./assistant.ts";

export type ActiveScreen = "home" | "catalog-home" | "detail" | "folder" | "timeline" | "lights";

export interface FocusedTitleBrief {
  kind: CatalogKind;
  title: SlimTitle;
  resume?: boolean;
  episodeLabel?: string;
}

export interface AssistantPageContext {
  screen: ActiveScreen;
  card?: string;
  kind?: CatalogKind;
  focused?: FocusedTitleBrief | null;
  folderTitle?: string;
  sagaTitle?: string;
  hasContinue?: boolean;
  lightsOn?: number;
  lightsTotal?: number;
  openReminders?: number;
  userName?: string;
}

export interface TailoredAssistant {
  badge: string;
  hint: string;
  welcome: string;
  dockChips: readonly string[];
  chatChips: readonly string[];
}

const KIND_NAME: Record<CatalogKind, string> = { movie: "Cinema", series: "Shows", anime: "Anime" };
const ABOUT = "What's this about?";
const WORTH = "Is this worth watching?";
const CATCH_UP = "Catch me up";
const NEXT_EP = "What's the next episode about?";
const ADD_LIST = "Add this to My List";
const MY_LIST = "Show my list";
const TONIGHT = "Something for tonight";
const CINEMA = "Cinema mode";
const LIGHTER = "Something lighter";
const WATCHING = "What was I watching?";
const PLAY_FIRST = "Play the first one";
const PLAY_SECOND = "Play the second one";
const WEATHER_NOW = "What's the weather?";
const UMBRELLA = "Do I need an umbrella?";
const WEATHER_TMW = "Weather tomorrow";

const norm = (s: string) => s.trim().toLowerCase().replace(/[?!.]+$/, "");
const clamp = (s: string, max = 28) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

function dedup(list: readonly string[], asked?: string): string[] {
  const skip = asked ? norm(asked) : "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of list) {
    const k = norm(c);
    if (k && k !== skip && !seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

const pack = (badge: string, hint: string, welcome: string, starterChips: string[], dockChips = starterChips.slice(0, 3)) => ({
  badge,
  hint,
  welcome,
  dockChips,
  starterChips,
});

function pageDefaults(ctx: AssistantPageContext) {
  const who = ctx.userName?.trim() ? `, ${ctx.userName.trim()}` : "";
  const t = ctx.focused;

  if (ctx.screen === "detail" && t) {
    const short = clamp(t.title.name);
    const chips =
      t.kind !== "movie"
        ? [t.resume ? CATCH_UP : WORTH, t.resume ? NEXT_EP : ABOUT, "Who stars in this?", ADD_LIST]
        : [ABOUT, WORTH, "Who directed this?", CINEMA];
    return pack(short, `Ask Secretary about ${short} · “${chips[0]}” or “${chips[1]}”`, `${t.title.name} is open. Ask about its story, cast, rating, or similar titles.`, chips);
  }

  if (ctx.screen === "timeline" && ctx.sagaTitle) {
    const short = clamp(ctx.sagaTitle);
    const chips = t ? [ABOUT, WORTH, CINEMA, ADD_LIST] : [TONIGHT, CINEMA, MY_LIST, WATCHING];
    return pack(short, `Ask Secretary about ${short} · “${chips[0]}”`, `Exploring ${ctx.sagaTitle}. Ask about any entry.`, chips);
  }

  if (ctx.screen === "folder") {
    const label = ctx.folderTitle ? clamp(ctx.folderTitle) : KIND_NAME[ctx.kind ?? "movie"];
    const chips = t ? [ABOUT, WORTH, ADD_LIST, LIGHTER] : [TONIGHT, "Show me a comedy", MY_LIST, CINEMA];
    return pack(label, `Ask Secretary in ${label} · “${chips[0]}”`, `Browsing ${label}. Ask about the highlighted title or name a mood.`, chips);
  }

  if (ctx.screen === "lights" || (ctx.screen === "home" && ctx.card === "home")) {
    const status = typeof ctx.lightsOn === "number" && ctx.lightsTotal ? `${ctx.lightsOn} of ${ctx.lightsTotal} lights on` : "Room & Lights";
    return pack(
      "Room & Lights",
      `Ask Secretary · ${status} — “${CINEMA}” or “Dim lights to 20%”`,
      `Room controls (${status.toLowerCase()}). Ask for ${CINEMA}, warm light, or a level.`,
      [CINEMA, "Warm lights", "Turn off the lights", "Music mode"],
    );
  }

  const kind: CatalogKind | undefined =
    ctx.screen === "catalog-home"
      ? ctx.kind
      : ctx.card === "cinema"
        ? "movie"
        : ctx.card === "shows"
          ? "series"
          : ctx.card === "anime"
            ? "anime"
            : undefined;

  if (kind) {
    const section = KIND_NAME[kind];
    const short = t ? clamp(t.title.name, 22) : "";
    const first = t?.resume ? CATCH_UP : ABOUT;
    const chips =
      kind === "movie"
        ? t
          ? [ABOUT, WORTH, "Show me a thriller film", CINEMA]
          : [TONIGHT, "Show me a comedy film", "Show me a sci-fi film", CINEMA]
        : kind === "series"
          ? t
            ? [first, WORTH, "Show me a thriller series", MY_LIST]
            : [ctx.hasContinue ? WATCHING : "Show me a drama series", "Show me a comedy series", "Show me a mystery series", MY_LIST]
          : t
            ? [first, WORTH, "Find me action anime", "Find me fantasy anime"]
            : ["Find me action anime", "Find me fantasy anime", "Find me comedy anime", MY_LIST];
    return pack(
      short ? `${section} · ${short}` : section,
      `Ask Secretary · ${section} — “${chips[0]}” or “${chips[2]}”`,
      `Browsing ${section}${who}. Ask about a highlighted title or name a genre.`,
      chips,
    );
  }

  if (ctx.card === "weather") {
    const chips = [WEATHER_NOW, UMBRELLA, WEATHER_TMW, "Is it cold tonight?"];
    return pack("Weather", `Ask Secretary · Weather — “${UMBRELLA}” or “${WEATHER_TMW}”`, `Checking the forecast${who}.`, chips);
  }

  if (ctx.card === "reminders" || ctx.card === "calendar") {
    return pack(
      "Reminders",
      "Ask Secretary · Reminders — “Remind me in 20 minutes…” or “Goodnight”",
      `Reminders${who}. Dictate a reminder or run a routine.`,
      ["Remind me at 20:00 to check the oven", "What's the weather tomorrow?", "Good morning", "Goodnight"],
      ["Remind me tonight at 8 to call", "Good morning", "Goodnight"],
    );
  }

  const chips = [ctx.hasContinue ? WATCHING : TONIGHT, "Movie night", WEATHER_NOW, CINEMA];
  return pack(
    "Secretary",
    `Ask Secretary — “${chips[0]}”, “Movie night” or “${WEATHER_NOW}”`,
    `At your service${who}. Speak or pick a suggestion below for recommendations, title answers, lights, or reminders.`,
    chips,
  );
}

export function followUpChips(turn: AssistantTurn, ctx: AssistantPageContext): string[] {
  const res = turn.results ?? [];
  const base = pageDefaults(ctx).starterChips;
  const c =
    turn.action === "watch"
      ? res.length > 1
        ? [PLAY_FIRST, "What's it about?", LIGHTER, res[0].type === "movie" ? "What about a series instead?" : res[0].type === "series" ? "What about a film instead?" : PLAY_SECOND, PLAY_SECOND]
        : res.length === 1
          ? [PLAY_FIRST, "Is it any good?", "Who's in it?", LIGHTER, CINEMA]
          : [TONIGHT, "Show me a comedy", "Show me a thriller", MY_LIST]
      : turn.action === "title_info"
        ? [ctx.screen === "detail" && ctx.focused?.resume ? CATCH_UP : "Is it worth watching?", "Who's in it?", ABOUT, ADD_LIST, res.length ? PLAY_FIRST : TONIGHT]
        : turn.action === "resume"
          ? [CATCH_UP, CINEMA, "Something else for tonight", MY_LIST]
          : turn.action === "mylist_updated"
            ? [MY_LIST, ABOUT, TONIGHT, CINEMA]
            : turn.action === "weather"
              ? [UMBRELLA, WEATHER_TMW, "Is it cold tonight?", TONIGHT]
              : turn.action === "domotics_updated"
                ? [TONIGHT, CINEMA, "Warm lights", "Turn off the lights", "Music mode"]
                : turn.action === "reminder_added"
                  ? [TONIGHT, WEATHER_NOW, "Goodnight", CINEMA]
                  : base;
  return dedup([...c, ...base], turn.prompt).slice(0, 4);
}

export function tailorAssistant(ctx: AssistantPageContext, activeTurn?: AssistantTurn | null): TailoredAssistant {
  const base = pageDefaults(ctx);
  return {
    badge: base.badge,
    hint: base.hint,
    welcome: base.welcome,
    dockChips: base.dockChips,
    chatChips: activeTurn ? followUpChips(activeTurn, ctx) : base.starterChips.slice(0, 4),
  };
}

export function statusForInteraction(o: { listening: boolean; hearing: boolean; transcribing: boolean; asking: boolean; speaking: boolean }): string {
  return o.listening ? (o.hearing ? "Hearing you…" : "Listening · speak now") : o.transcribing ? "Transcribing…" : o.asking ? "Thinking…" : o.speaking ? "Speaking…" : "";
}
