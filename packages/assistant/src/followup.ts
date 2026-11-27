// Conversational follow-ups ("the second one", "something lighter", "who's in it?"):
// 1. Ordinal picks resolve locally against the latest watch turn's results with zero model latency.
// 2. Multi-turn `contents` carries the last few turns (including shown titles) to Gemini's structured router.
// 3. Offline comparative/pronoun fallbacks keep follow-ups working even without a Gemini key.
import { describeIntent, type Answer, type AskAction, type Effects } from "./route.ts";
import { localTitleReply, type TitleQuestionKind } from "./title-qa.ts";
import type { CatalogKind, SearchResult } from "./types.ts";

export const MAX_HISTORY_TURNS = 4;

export interface TurnHistoryItem {
  prompt: string;
  reply: string;
  action: AskAction | string;
  query?: string;
  results?: readonly SearchResult[];
}

const ORDINAL_WORDS: Readonly<Record<string, number>> = {
  first: 0,
  "1st": 0,
  second: 1,
  "2nd": 1,
  third: 2,
  "3rd": 2,
  fourth: 3,
  "4th": 3,
  fifth: 4,
  "5th": 4,
};

export interface OrdinalPick {
  /** Zero-based index, or "last". */
  at: number | "last";
  /** True when the viewer asked to open/play it rather than merely select it. */
  open: boolean;
}

export function parseOrdinalFollowUp(prompt: string): OrdinalPick | null {
  const p = prompt
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, "")
    .replace(/^(?:hey\s+nest,?\s+|nest,?\s+|please\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();

  const m = p.match(
    /^(?:(play|open|watch|put on)\s+|(?:pick|choose|show(?:\s+me)?)\s+)?(?:the\s+)?(?:(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)|(?:number|no\.?)\s*([1-8]))(?:\s+(?:one|title|movie|film|show|series|anime|pick|option))?$/,
  );
  if (!m) return null;
  const open = Boolean(m[1]);
  if (m[2] === "last") return { at: "last", open };
  if (m[2] && m[2] in ORDINAL_WORDS) return { at: ORDINAL_WORDS[m[2]], open };
  if (m[3]) return { at: Number(m[3]) - 1, open };
  return null;
}

/** Most recent turn in `history` that carried `results`. */
export function lastResultsTurn(history: readonly TurnHistoryItem[] | undefined): TurnHistoryItem | undefined {
  if (!history?.length) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].results?.length) return history[i];
  }
  return undefined;
}

export function resolveOrdinalFollowUp(
  pick: OrdinalPick,
  history: readonly TurnHistoryItem[] | undefined,
): Answer | null {
  const prev = lastResultsTurn(history);
  if (!prev?.results?.length) return null;
  const idx = pick.at === "last" ? prev.results.length - 1 : pick.at;
  const chosen = prev.results[idx];
  if (!chosen) {
    return {
      reply: `I only showed ${prev.results.length} title${prev.results.length === 1 ? "" : "s"} just now.`,
      action: "briefing",
    };
  }
  const query = `“${chosen.title.name}”`;
  return {
    reply: pick.open
      ? `Opening ${query}${chosen.title.year ? ` (${chosen.title.year})` : ""}.`
      : `Here is ${query}${chosen.title.year ? ` (${chosen.title.year})` : ""}.`,
    action: pick.open ? "resume" : "watch",
    query,
    results: [chosen],
  };
}

/** Pronoun questions ("who's in it?", "what's it about?", "is it any good?") referring to a title in `history`. */
export function parsePronounTitleFollowUp(prompt: string): TitleQuestionKind | null {
  const p = prompt
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, "")
    .replace(/^(?:hey\s+nest,?\s+|nest,?\s+|please\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:who(?:'s| is| stars| acts)\s+in\s+(?:it|that|that one)|who\s+(?:directed|made)\s+(?:it|that|that one))$/.test(p)) {
    return "people";
  }
  if (/^(?:what(?:'s| is)\s+(?:it|that|that one)\s+about|tell\s+me\s+(?:more\s+)?about\s+(?:it|that|that one))$/.test(p)) {
    return "about";
  }
  if (/^(?:is\s+it\s+(?:any\s+)?good|is\s+it\s+worth\s+(?:watching|it|a\s+watch)|how\s+is\s+it\s+rated)$/.test(p)) {
    return "worth";
  }
  return null;
}

/** Offline comparative watch shift ("something lighter", "what about an anime instead?") when no Gemini key is set. */
export function parseComparativeWatch(
  prompt: string,
  prev: TurnHistoryItem | undefined,
): { kind?: CatalogKind; genre?: string } | null {
  const p = prompt.trim().toLowerCase().replace(/[?!.]+$/, "").trim();
  const prevKind = prev?.results?.[0]?.type;

  let kind: CatalogKind | undefined = prevKind;
  if (/\banime\b/.test(p) && /\b(?:what about|how about|instead|make it|switch to)\b/.test(p)) kind = "anime";
  else if (/\b(?:series|shows?|tv)\b/.test(p) && /\b(?:what about|how about|instead|make it|switch to)\b/.test(p)) kind = "series";
  else if (/\b(?:movies?|films?)\b/.test(p) && /\b(?:what about|how about|instead|make it|switch to)\b/.test(p)) kind = "movie";

  if (/\b(?:lighter|funnier|more cheerful|more upbeat|less serious|less heavy)\b/.test(p)) {
    return { kind, genre: "Comedy" };
  }
  if (/\b(?:darker|grittier|tenser|more suspenseful|more serious)\b/.test(p)) {
    return { kind, genre: "Thriller" };
  }
  if (/\b(?:scarier|spookier|creepier)\b/.test(p)) {
    return { kind, genre: "Horror" };
  }
  if (/\b(?:calmer|cozier|gentler|for kids|family)\b/.test(p)) {
    return { kind, genre: "Family" };
  }
  if (kind !== prevKind && kind) {
    return { kind };
  }
  return null;
}

/** Offline fallback for follow-ups when `geminiKey` is absent or Gemini fails. */
export async function runOfflineFollowUp(prompt: string, fx: Effects): Promise<Answer | null> {
  const prev = lastResultsTurn(fx.history);
  const pronounQ = prev ? parsePronounTitleFollowUp(prompt) : null;
  if (pronounQ && prev?.results?.[0]) {
    const hit = prev.results[0];
    return {
      reply: localTitleReply(pronounQ, {
        id: hit.title.id,
        kind: hit.type,
        name: hit.title.name,
        year: hit.title.year || undefined,
        rating: hit.title.rating || undefined,
        description: hit.title.description,
        spoilerMode: "off",
      }),
      action: "title_info",
      query: hit.title.name,
      results: [hit],
    };
  }

  const shift = fx.find ? parseComparativeWatch(prompt, prev) : null;
  if (shift && fx.find) {
    const query = describeIntent(shift);
    const results = await fx.find(shift).catch(() => [] as SearchResult[]);
    return {
      reply: results.length ? `Here are ${query} worth a look.` : `I couldn't find anything for ${query}.`,
      action: "watch",
      query,
      results,
    };
  }
  return null;
}

export interface GeminiMessage {
  role?: "user" | "model";
  parts: { text: string }[];
}

function formatModelTurn(t: TurnHistoryItem): string {
  if (!t.results?.length) return t.reply;
  const shown = t.results
    .slice(0, 4)
    .map((r, i) => {
      const meta = [r.type, r.title.year, r.title.rating && `${r.title.rating}/10`].filter(Boolean).join(", ");
      const desc = r.title.description ? ` — ${r.title.description.slice(0, 100)}` : "";
      return `${i + 1}. ${r.title.name}${meta ? ` (${meta})` : ""}${desc}`;
    })
    .join("; ");
  return `${t.reply} [Shown: ${shown}]`;
}

/** Builds Gemini `contents` with up to the last `MAX_HISTORY_TURNS` turns so follow-ups resolve in context. */
export function buildGeminiContents(
  history: readonly TurnHistoryItem[] | undefined,
  instruction: string,
): GeminiMessage[] {
  const recent = history?.slice(-MAX_HISTORY_TURNS) ?? [];
  if (!recent.length) {
    return [{ parts: [{ text: instruction }] }];
  }
  const out: GeminiMessage[] = [];
  for (const t of recent) {
    out.push({ role: "user", parts: [{ text: t.prompt }] });
    out.push({ role: "model", parts: [{ text: formatModelTurn(t) }] });
  }
  out.push({ role: "user", parts: [{ text: instruction }] });
  return out;
}
