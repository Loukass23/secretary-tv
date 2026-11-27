// "Recommend me" on an opened card's end bar (cards.tsx EndBar): picks titles of the card's kind from the viewer's
// watch history (Continue Watching) and My List before falling back to other genres, and gives a one-line reason.
import { route, type SearchResult, type WatchIntent } from "@secretary/assistant";
import type { CatalogKind } from "./apps.ts";

/** What the end bar shows while the assistant is asked, and after. */
export type RecState =
  | { status: "loading" }
  | { status: "ready"; items: SearchResult[]; reply: string; why?: string }
  | { status: "empty"; reply: string }
  | { status: "error" };

export interface TasteSeed {
  id: string;
  name: string;
  kind: CatalogKind;
  genres?: readonly string[];
  description?: string;
}

export interface TasteInput {
  /** Titles in Continue Watching, newest first. */
  watching?: readonly TasteSeed[];
  /** Titles saved to My List, newest first. */
  saved?: readonly TasteSeed[];
}

export interface TasteChoice {
  /** Catalog genre name ("Sci-Fi", "Drama"), or "" for top titles of the kind. */
  genre: string;
  /** One-line reason shown in EndBar (never "Picked for you", which is the row's own heading). */
  why: string;
}

const WORD: Record<CatalogKind, string> = { movie: "films", series: "shows", anime: "anime" };
/** Fallback genres when the viewer has no watch history yet, or after cycling past their top affinities. */
const GENRES = ["", "Comedy", "Thriller", "Drama", "Sci-Fi", "Adventure", "Mystery"] as const;
/** Picks on the row at most. */
export const REC_MAX = 10;

const SYNOPSIS_GENRES: readonly [RegExp, string][] = [
  [/\b(?:space|planet|alien|future|galaxy|cyber|robot|dystopi|time travel|sci-?fi)\b/i, "Sci-Fi"],
  [/\b(?:detective|murder|investigat|clue|disappear|mystery)\b/i, "Mystery"],
  [/\b(?:conspiracy|hostage|assassin|spy|agent|thriller|manhunt)\b/i, "Thriller"],
  [/\b(?:heist|cartel|mafia|gangster|crime|robbery)\b/i, "Crime"],
  [/\b(?:hilarious|comed|laugh|misadventure|awkward|funny)\b/i, "Comedy"],
  [/\b(?:magic|wizard|dragon|kingdom|curse|fantasy)\b/i, "Fantasy"],
  [/\b(?:haunt|ghost|demon|nightmare|horror|terrify)\b/i, "Horror"],
  [/\b(?:expedition|quest|treasure|journey|adventure)\b/i, "Adventure"],
  [/\b(?:family|marriage|ambition|struggle|friendship|drama)\b/i, "Drama"],
];

/** Infers catalog genres from a title's explicit genre tags and its synopsis keywords. */
export function seedGenres(seed: Pick<TasteSeed, "genres" | "description">): string[] {
  const out: string[] = [];
  for (const g of seed.genres ?? []) {
    const clean = g.trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  if (seed.description) {
    for (const [re, genre] of SYNOPSIS_GENRES) {
      if (re.test(seed.description) && !out.includes(genre)) out.push(genre);
    }
  }
  return out;
}

/**
 * Ranks genres from Continue Watching and My List for `kind`, keeping the strongest seed title for the one-line `why`,
 * then appends unvisited fallback genres so pressing "Recommend me" again always brings fresh titles.
 */
export function tasteChoices(kind: CatalogKind, taste?: TasteInput): TasteChoice[] {
  const watching = taste?.watching ?? [];
  const saved = taste?.saved ?? [];
  const scores = new Map<string, { score: number; seed: string; from: "watching" | "saved" }>();

  const add = (list: readonly TasteSeed[], from: "watching" | "saved", baseWeight: number) => {
    list.forEach((s, idx) => {
      if (!s.name.trim()) return;
      const kindBoost = s.kind === kind ? 1 : 0.5;
      const recency = Math.max(0.4, 1 - idx * 0.1);
      const w = baseWeight * kindBoost * recency;
      for (const g of seedGenres(s)) {
        const prev = scores.get(g);
        if (!prev) scores.set(g, { score: w, seed: s.name, from });
        else scores.set(g, { score: prev.score + w, seed: prev.seed, from: prev.from });
      }
    });
  };

  add(watching, "watching", 3);
  add(saved, "saved", 2);

  const ranked: TasteChoice[] = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([genre, info]) => ({
      genre,
      why:
        info.from === "watching"
          ? `Because you watched ${info.seed} · ${genre}`
          : `From ${info.seed} on My List · ${genre}`,
    }));

  // Viewer has history/list items whose genres aren't known yet: lead with top picks naming their latest title.
  if (!ranked.length && (watching.length || saved.length)) {
    const lead = watching.find((s) => s.kind === kind) ?? saved.find((s) => s.kind === kind) ?? watching[0] ?? saved[0];
    if (lead?.name) {
      const fromWatching = watching.includes(lead);
      ranked.push({
        genre: "",
        why: fromWatching ? `More ${WORD[kind]} after ${lead.name}` : `More ${WORD[kind]} · ${lead.name} is on My List`,
      });
    }
  }

  const used = new Set(ranked.map((r) => r.genre.toLowerCase()));
  for (const g of GENRES) {
    if (!used.has(g.toLowerCase())) {
      ranked.push({
        genre: g,
        why: g ? `Popular ${g.toLowerCase()} ${WORD[kind]}` : `Tonight's top ${WORD[kind]}`,
      });
    }
  }
  return ranked;
}

/** The prompt for press `n` (0-based) on a card of `kind`, steered by `taste` when given. */
export function recommendPrompt(kind: CatalogKind, n = 0, taste?: TasteInput): string {
  const choices = tasteChoices(kind, taste);
  const g = choices[n % choices.length].genre.toLowerCase();
  return `Recommend me some ${g ? `${g} ` : ""}${WORD[kind]}`;
}

/**
 * Asks route() for picks of `kind`, leaving out the titles the card already shows or the viewer dismissed/watched
 * (`shown`, by id), and explains why in one line (`why`).
 */
export async function recommend(
  kind: CatalogKind,
  n: number,
  shown: ReadonlySet<string>,
  find: (intent: WatchIntent) => Promise<SearchResult[]>,
  taste?: TasteInput,
): Promise<Exclude<RecState, { status: "loading" }>> {
  let failed = false;
  const choices = tasteChoices(kind, taste);
  const picked = choices[n % choices.length];
  try {
    const a = await route(recommendPrompt(kind, n, taste), {
      addReminder: () => undefined,
      openReminders: () => [],
      lights: async () => undefined,
      find: async (intent) => {
        try {
          // The card's kind and chosen genre, whatever the prompt parsed to.
          return await find({ ...intent, kind, genre: picked.genre || intent.genre });
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
    return items.length
      ? { status: "ready", items: items.slice(0, REC_MAX), reply: a.reply, why: picked.why }
      : { status: "empty", reply: a.reply };
  } catch {
    return { status: "error" };
  }
}

/**
 * The end bar's words beside the orb (cards.tsx EndBar): "Ask Assistant", as under the home's cards, then the one-line
 * reason (`why`) when picks arrived. Picks are named by their own row ("Picked for you"), never again here.
 */
export function recLine(s: RecState | undefined, unit: string): { title: string; sub: string } {
  if (!s) return { title: "Ask Assistant", sub: "" };
  switch (s.status) {
    case "loading":
      return { title: "Asking the assistant…", sub: `Looking for ${unit} you might like` };
    case "ready":
      return { title: "Ask Assistant", sub: s.why || `Recommend me again for other ${unit}` };
    case "empty":
      return { title: "No new picks this time", sub: `Recommend me tries other ${unit}` };
    case "error":
      return { title: "Couldn't reach the assistant", sub: "Check the connection and try again" };
  }
}
