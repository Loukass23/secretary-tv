// Questions about the focused title or next episode ("what's this about?", "is it any good?", "catch me up"),
// answered from catalog metadata while enforcing Settings › Watching › Spoiler protection (Off / Blur / Hide)
// before any text reaches Gemini or spoken replies.
import { firstPart, GEMINI_FALLBACK_MODELS } from "./gemini.ts";
import type { Answer } from "./route.ts";
import type { CatalogKind, SearchResult } from "./types.ts";

export type TitleQuestionKind = "about" | "worth" | "people" | "catchup" | "next_episode";
export type SpoilerSetting = "off" | "blur" | "hide";

export interface EpisodeBrief {
  /** "S1 · E3" */
  label: string;
  name?: string;
  overview?: string;
  /** True when the episode is unwatched under catalog-kit's `isSpoiler` rules. */
  unwatched?: boolean;
}

export interface FocusedTitleContext {
  id: string;
  kind: CatalogKind;
  name: string;
  year?: string;
  rating?: string;
  runtime?: string;
  genres?: readonly string[];
  director?: readonly string[];
  cast?: readonly string[];
  poster?: string;
  background?: string;
  /** Spoiler-free premise of the film or series from the catalog. */
  description?: string;
  spoilerMode: SpoilerSetting;
  /** Latest watched or in-progress episode (always safe to recap). */
  lastWatched?: EpisodeBrief;
  /** Up-next or focused episode (protected when `unwatched` and `spoilerMode !== "off"`). */
  nextEpisode?: EpisodeBrief;
}

export function parseTitleQuestion(prompt: string): TitleQuestionKind | null {
  const p = prompt
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, "")
    .replace(/^(?:hey\s+nest,?\s+|nest,?\s+|please\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /^(?:catch\s+me\s+up(?:\s+on\s+(?:this|it|the\s+(?:show|series|story|anime)))?|recap(?:\s+(?:this|me))?|where\s+(?:was\s+i|am\s+i|did\s+i\s+leave\s+off)|what\s+happened\s+last(?:\s+time)?)$/.test(
      p,
    )
  ) {
    return "catchup";
  }
  if (/^(?:what(?:'s| is)\s+(?:the\s+)?next\s+episode(?:\s+about)?|what\s+happens\s+next|next\s+episode(?:\s+plot)?)$/.test(p)) {
    return "next_episode";
  }
  if (
    /^(?:is\s+(?:this|it)\s+(?:any\s+)?good|is\s+(?:this|it)\s+worth\s+(?:watching|it|a\s+watch)|what(?:'s| is)\s+(?:its|the|this\s+(?:movie|film|show|series|anime)'?s)\s+rating|how\s+is\s+(?:this|it)\s+rated)$/.test(
      p,
    )
  ) {
    return "worth";
  }
  if (/^(?:who(?:'s| is| stars| acts)\s+in\s+this|who\s+(?:directed|made)\s+this|cast\s+of\s+this)$/.test(p)) {
    return "people";
  }
  if (
    /^(?:what(?:'s| is)\s+this(?:\s+(?:movie|film|show|series|anime|one))?(?:\s+about)?|tell\s+me\s+about\s+this(?:\s+(?:movie|film|show|series|anime|one))?|synopsis|what(?:'s| is)\s+the\s+plot)$/.test(
      p,
    )
  ) {
    return "about";
  }
  return null;
}

/** Strips unwatched episode synopses whenever Spoiler protection is Blur or Hide, before any model call. */
export function sanitizeTitleContext(ctx: FocusedTitleContext): FocusedTitleContext {
  if (ctx.spoilerMode === "off" || !ctx.nextEpisode?.unwatched) return ctx;
  return {
    ...ctx,
    nextEpisode: {
      label: ctx.nextEpisode.label,
      name: ctx.nextEpisode.name,
      unwatched: true,
    },
  };
}

function epHeading(ep: EpisodeBrief): string {
  return ep.name && !/^episode\s+\d+$/i.test(ep.name) ? `${ep.label} (${ep.name})` : ep.label;
}

function clampSentence(text: string, max = 136): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const first = clean.match(/^[^.!?]+[.!?]/)?.[0]?.trim();
  if (first && first.length <= max) return first;
  return `${clean.slice(0, max - 1).replace(/\s\S*$/, "")}…`;
}

function toResult(ctx: FocusedTitleContext): SearchResult {
  return {
    type: ctx.kind,
    title: {
      id: ctx.id,
      name: ctx.name,
      year: ctx.year ?? "",
      rating: ctx.rating ?? "",
      poster: ctx.poster,
      background: ctx.background,
      description: ctx.description,
    },
  };
}

export function localTitleReply(q: TitleQuestionKind, safe: FocusedTitleContext): string {
  if (q === "worth") {
    const bits = [
      safe.rating ? `rated ${safe.rating}/10` : "",
      safe.genres?.length ? safe.genres.slice(0, 2).join(" / ") : "",
      safe.year ?? "",
    ].filter(Boolean);
    if (bits.length) {
      const verdict = Number(safe.rating) >= 7.5 ? "Well worth your evening" : Number(safe.rating) >= 6.5 ? "A respectable pick" : "Judge for yourself";
      return `${safe.name} (${bits.join(", ")}): ${verdict.toLowerCase()}.`;
    }
    return safe.description ? clampSentence(`${safe.name}: ${safe.description}`) : `No rating on file yet for ${safe.name}.`;
  }

  if (q === "people") {
    const dir = safe.director?.length ? `Directed by ${safe.director.slice(0, 2).join(", ")}` : "";
    const cast = safe.cast?.length ? `starring ${safe.cast.slice(0, 3).join(", ")}` : "";
    if (dir || cast) {
      const joined = [dir, cast].filter(Boolean).join(", ");
      return `${safe.name}: ${joined.charAt(0).toLowerCase() === joined.charAt(0) ? `${joined.charAt(0).toUpperCase()}${joined.slice(1)}` : joined}.`;
    }
    return `The catalog lists no cast or director credits for ${safe.name} yet.`;
  }

  if (q === "next_episode") {
    if (!safe.nextEpisode) {
      return safe.kind === "movie"
        ? `${safe.name} is a standalone film, not an episodic series.`
        : `No upcoming episode is listed for ${safe.name}.`;
    }
    const head = epHeading(safe.nextEpisode);
    if (safe.nextEpisode.overview) return clampSentence(`Up next on ${safe.name} is ${head}: ${safe.nextEpisode.overview}`);
    return `Up next on ${safe.name} is ${head}.`;
  }

  if (q === "catchup") {
    if (safe.lastWatched) {
      const head = epHeading(safe.lastWatched);
      const next = safe.nextEpisode ? ` Up next: ${safe.nextEpisode.label}.` : "";
      if (safe.lastWatched.overview) {
        return `${clampSentence(`${safe.name} (${head}): ${safe.lastWatched.overview}`, next ? 112 : 136)}${next}`;
      }
      return `You reached ${head} of ${safe.name}.${next}`;
    }
    if (safe.spoilerMode === "hide" && safe.nextEpisode?.unwatched) {
      return `You haven't started ${safe.name} yet (up next: ${epHeading(safe.nextEpisode)}); plot details stay hidden.`;
    }
    if (safe.description) return clampSentence(`${safe.name}: ${safe.description}`);
    return `No recap is on file yet for ${safe.name}.`;
  }

  // "about"
  if (safe.description) return clampSentence(`${safe.name}: ${safe.description}`);
  const meta = [safe.year, safe.genres?.slice(0, 2).join(", "), safe.rating && `${safe.rating}/10`].filter(Boolean).join(" · ");
  return meta ? `${safe.name} (${meta}) — no synopsis in the catalog yet.` : `No synopsis in the catalog yet for ${safe.name}.`;
}

export async function answerTitleQuestion(
  q: TitleQuestionKind,
  raw: FocusedTitleContext,
  opts: { geminiKey?: string; fetch?: typeof fetch },
): Promise<Answer> {
  const result = toResult(raw);

  // Hard gate before any model call: asking directly about an unwatched next episode while Spoilers is Blur or Hide.
  if (q === "next_episode" && raw.nextEpisode?.unwatched && raw.spoilerMode !== "off") {
    const head = epHeading(raw.nextEpisode);
    const reply =
      raw.spoilerMode === "hide"
        ? `Up next on ${raw.name} is ${head} — plot hidden while Spoiler protection is on Hide.`
        : `Up next on ${raw.name} is ${head}. Spoiler protection is on Blur, so I'll keep its plot under wraps.`;
    return { reply, action: "title_info", query: raw.name, results: [result] };
  }

  // Catch-up with no watched episodes under Hide never leaks premise/episode spoilers through a model.
  if (q === "catchup" && !raw.lastWatched && raw.nextEpisode?.unwatched && raw.spoilerMode === "hide") {
    return {
      reply: localTitleReply(q, sanitizeTitleContext(raw)),
      action: "title_info",
      query: raw.name,
      results: [result],
    };
  }

  const safe = sanitizeTitleContext(raw);

  if (opts.geminiKey) {
    const facts = [
      `Title: ${safe.name}${safe.year ? ` (${safe.year})` : ""} [${safe.kind}]`,
      safe.rating ? `Rating: ${safe.rating}/10` : "",
      safe.runtime ? `Runtime: ${safe.runtime}` : "",
      safe.genres?.length ? `Genres: ${safe.genres.join(", ")}` : "",
      safe.director?.length ? `Director: ${safe.director.slice(0, 2).join(", ")}` : "",
      safe.cast?.length ? `Cast: ${safe.cast.slice(0, 5).join(", ")}` : "",
      safe.description ? `Premise: ${safe.description}` : "",
      safe.lastWatched
        ? `Last watched: ${epHeading(safe.lastWatched)}${safe.lastWatched.overview ? ` — ${safe.lastWatched.overview}` : ""}`
        : "",
      safe.nextEpisode
        ? `Up next: ${epHeading(safe.nextEpisode)}${safe.nextEpisode.overview ? ` — ${safe.nextEpisode.overview}` : ""}`
        : "",
      safe.spoilerMode !== "off" ? "Spoiler rule: NEVER reveal unwatched plot twists or endings." : "",
    ]
      .filter(Boolean)
      .join("\n");

    const askLabel: Record<TitleQuestionKind, string> = {
      about: "Explain what this title is about without spoiling endings.",
      worth: "Give a sharp verdict on whether it is worth watching using its rating and genres.",
      people: "Say who directed and stars in it.",
      catchup: "Catch the viewer up on where they are so far without spoiling unwatched episodes.",
      next_episode: "Briefly preview what the next episode is about.",
    };

    const part = await firstPart(
      GEMINI_FALLBACK_MODELS,
      opts.geminiKey,
      {
        contents: [
          {
            parts: [
              {
                text: `You are the Secretary Bird, a witty, aristocratic TV butler. Use ONLY the catalog facts below.\n${facts}\nTask: ${askLabel[q]} Reply in 1 plain-text sentence (no Markdown, under 135 chars).`,
              },
            ],
          },
        ],
      },
      opts.fetch ?? fetch,
    );
    const text = part?.text?.trim();
    if (text) return { reply: text, action: "title_info", query: safe.name, results: [result] };
  }

  return {
    reply: localTitleReply(q, safe),
    action: "title_info",
    query: safe.name,
    results: [result],
  };
}
