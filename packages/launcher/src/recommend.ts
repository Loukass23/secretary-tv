// "Recommend me" on an opened card's end bar (cards.tsx EndBar): the assistant's route() is asked for titles of the
// card's kind, and the answer becomes a row of picks on the card. Pure apart from the `find` it is given, so the
// prompts, the filtering and the three outcomes (picks, no answer, failure) are unit tested.
import { route, type SearchResult, type WatchIntent } from "@secretary/assistant";
import type { CatalogKind } from "./apps.ts";

/** What the end bar shows while the assistant is asked, and after. */
export type RecState =
  | { status: "loading" }
  | { status: "ready"; items: SearchResult[]; reply: string }
  | { status: "empty"; reply: string }
  | { status: "error" };

const WORD: Record<CatalogKind, string> = { movie: "films", series: "shows", anime: "anime" };
/** Each press after the first asks in a genre, in turn, so pressing again brings different titles. */
const GENRES = ["", "comedy", "thriller", "drama", "sci-fi", "adventure", "mystery"] as const;
/** Picks on the row at most. */
export const REC_MAX = 10;

/** The prompt for press `n` (0-based) on a card of `kind`: "Recommend me some films", then "… some comedy films". */
export function recommendPrompt(kind: CatalogKind, n = 0): string {
  const g = GENRES[n % GENRES.length];
  return `Recommend me some ${g ? `${g} ` : ""}${WORD[kind]}`;
}

/**
 * Asks route() for picks of `kind`, leaving out the titles the card already shows (`shown`, by id). A failing `find`
 * is an error; an answer with no new titles of this kind is "empty".
 */
export async function recommend(
  kind: CatalogKind,
  n: number,
  shown: ReadonlySet<string>,
  find: (intent: WatchIntent) => Promise<SearchResult[]>,
): Promise<Exclude<RecState, { status: "loading" }>> {
  let failed = false;
  try {
    const a = await route(recommendPrompt(kind, n), {
      addReminder: () => undefined,
      openReminders: () => [],
      lights: async () => undefined,
      find: async (intent) => {
        try {
          // The card's kind, whatever the prompt parsed to.
          return await find({ ...intent, kind });
        } catch (e) {
          failed = true;
          throw e;
        }
      },
    });
    if (failed) return { status: "error" };
    const seen = new Set<string>();
    const items = (a.results ?? []).filter((r) => {
      if (r.type !== kind || shown.has(r.title.id) || seen.has(r.title.id)) return false;
      seen.add(r.title.id);
      return true;
    });
    return items.length ? { status: "ready", items: items.slice(0, REC_MAX), reply: a.reply } : { status: "empty", reply: a.reply };
  } catch {
    return { status: "error" };
  }
}

/** The end bar's line for a state: what is going on, in words. */
export function recLine(s: RecState | undefined, unit: string): { title: string; sub: string } {
  if (!s) return { title: "You're all caught up", sub: "That's every row in this card" };
  switch (s.status) {
    case "loading":
      return { title: "Asking the assistant…", sub: `Looking for ${unit} you might like` };
    case "ready":
      return { title: "Picked for you", sub: `${s.items.length} ${unit} the assistant found, in the row above` };
    case "empty":
      return { title: "No new picks this time", sub: `The assistant found nothing new; Recommend me tries other ${unit}` };
    case "error":
      return { title: "Couldn't reach the assistant", sub: "Check the connection and try again" };
  }
}
