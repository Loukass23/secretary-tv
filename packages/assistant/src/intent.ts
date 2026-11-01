// "Show me a comedy", "play dune", "something for tonight": prompts that ask for something to watch.
// Pure so it can be tested; route() turns the intent into a search or a browse of the top catalogs.
import type { CatalogKind } from "./types.ts";

export interface WatchIntent {
  /** A title or words to search for; absent when the prompt only names a kind or genre. */
  term?: string;
  kind?: CatalogKind;
  /** A Cinemeta / Kitsu genre name. */
  genre?: string;
}

const LEAD =
  /^(?:(?:can|could|would) you\s+|please\s+|hey\s+nest,?\s+|nest,?\s+)*(?:show(?: me)?|find(?: me)?|search(?: for)?|look(?:ing)? for|play|watch|put on|i (?:want|wanna|would like|'d like) to (?:watch|see)|recommend(?: me)?|suggest(?: me)?|give me|any|anything|something)\b\s*(.*)$/;
const BROWSE = /^(?:what should i watch|what(?:'s| is) (?:good|on|popular|trending)|something to watch|anything to watch)\b(.*)$/;

const GENRES: readonly [RegExp, string][] = [
  [/\b(?:comed(?:y|ies)|funny)\b/, "Comedy"],
  [/\baction\b/, "Action"],
  [/\b(?:horror|scary)\b/, "Horror"],
  [/\bthrillers?\b/, "Thriller"],
  [/\bdramas?\b/, "Drama"],
  [/\b(?:romance|romantic|rom-?com)\b/, "Romance"],
  [/\b(?:sci-?fi|science fiction)\b/, "Sci-Fi"],
  [/\bfantasy\b/, "Fantasy"],
  [/\b(?:animation|animated|cartoons?)\b/, "Animation"],
  [/\bdocumentar(?:y|ies)\b/, "Documentary"],
  [/\bcrime\b/, "Crime"],
  [/\bmyster(?:y|ies)\b/, "Mystery"],
  [/\b(?:family|kids)\b/, "Family"],
  [/\badventures?\b/, "Adventure"],
  [/\bwar\b/, "War"],
  [/\bwesterns?\b/, "Western"],
];

const KINDS: readonly [RegExp, CatalogKind][] = [
  [/\banime\b/, "anime"],
  [/\b(?:series|shows?|tv|episodes?|serials?)\b/, "series"],
  [/\b(?:movies?|films?|cinema)\b/, "movie"],
];

/** Words that say "anything", not what to search for. */
const FILLER =
  /\b(?:me|us|a|an|the|some|something|anything|good|great|nice|new|popular|trending|top|best|tonight|today|now|right|to|watch|for|my|home|please|i|can|could|like|one|ones|kind|of|in|on|with|that|is|are|this|week|highest|rated|rating|play|show|find)\b/g;

export function parseWatchIntent(prompt: string): WatchIntent | null {
  const text = prompt
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, "")
    .replace(/[“”"]/g, "");
  const m = text.match(BROWSE) ?? text.match(LEAD);
  if (!m) return null;
  let rest = m[1].trim();
  // Lights and reminders have their own handlers ("show me the lights", "find my reminders"), and the briefing and
  // the weather are not titles ("give me a briefing", "show me the forecast").
  if (/\b(?:lights?|lamps?|reminders?|tasks?|mode|scene|briefing|summary|news|update|weather|forecast)\b/.test(rest)) return null;

  let kind: CatalogKind | undefined;
  for (const [re, k] of KINDS) {
    if (re.test(rest)) {
      kind = k;
      rest = rest.replace(re, " ");
      break;
    }
  }
  let genre: string | undefined;
  for (const [re, g] of GENRES) {
    if (re.test(rest)) {
      genre = g;
      rest = rest.replace(re, " ");
      break;
    }
  }
  const term = rest.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  // A bare verb ("play", "show me") with nothing else is not a request to browse.
  if (!term && !kind && !genre && !m[0].match(/something|anything|what should|watch|tonight/)) return null;
  if (!term) return { kind, genre };
  // Searches keep the words as typed, minus "the movie" / "the series".
  const asked = m[1]
    .trim()
    .replace(/\b(?:the )?(?:movie|film|series|show|anime)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { term: asked || term, kind };
}
