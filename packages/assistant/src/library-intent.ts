// Voice intents for Continue Watching and My List ("what was I watching?", "resume Severance", "show my list",
// "add this to My List"), answered locally before any catalog search or model call.
import type { Answer } from "./route.ts";
import type { SearchResult } from "./types.ts";

export type LibraryIntent =
  | { kind: "continue_list" }
  | { kind: "resume_named"; term: string }
  | { kind: "show_mylist" }
  | { kind: "set_mylist"; wantSaved: boolean };

export function parseLibraryIntent(prompt: string): LibraryIntent | null {
  const p = prompt
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, "")
    .replace(/^(?:hey\s+nest,?\s+|nest,?\s+|please\s+|(?:can|could)\s+you\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:continue\s+watching|what\s+(?:was\s+i|am\s+i)\s+watching|pick\s+up\s+where\s+i\s+left\s+off|resume(?:\s+watching)?)$/.test(p)) {
    return { kind: "continue_list" };
  }
  if (/^(?:(?:show|open|view)(?:\s+me)?\s+my\s+list|what(?:'s| is)\s+(?:on|in)\s+my\s+list|my\s+list)$/.test(p)) {
    return { kind: "show_mylist" };
  }
  if (/^(?:(?:add|save|put)\s+(?:this|it)\s+(?:to|in|on)\s+my\s+list|bookmark\s+(?:this|it))$/.test(p)) {
    return { kind: "set_mylist", wantSaved: true };
  }
  if (/^(?:(?:remove|delete|take)\s+(?:this|it)\s+(?:from|off)\s+my\s+list)$/.test(p)) {
    return { kind: "set_mylist", wantSaved: false };
  }
  const m = p.match(/^(?:resume|continue(?:\s+watching)?)\s+(.+)$/);
  if (m) {
    const term = m[1]
      .replace(/\b(?:the )?(?:movie|film|series|show|anime)\b/g, " ")
      .replace(/[“”"]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (term) return { kind: "resume_named", term };
  }
  return null;
}

function matchByName(items: readonly SearchResult[], query: string): SearchResult | undefined {
  const q = query.toLowerCase();
  return (
    items.find((r) => r.title.name.toLowerCase() === q) ??
    items.find((r) => r.title.name.toLowerCase().startsWith(q)) ??
    items.find((r) => r.title.name.toLowerCase().includes(q))
  );
}

export interface LibraryEffects {
  continueWatching?(): Promise<SearchResult[]> | SearchResult[];
  myList?(): Promise<SearchResult[]> | SearchResult[];
  setMyList?(wantSaved: boolean): Promise<{ name: string; saved: boolean; item?: SearchResult } | null> | { name: string; saved: boolean; item?: SearchResult } | null;
}

export async function runLibraryIntent(intent: LibraryIntent, fx: LibraryEffects): Promise<Answer | null> {
  if (intent.kind === "continue_list") {
    if (!fx.continueWatching) return null;
    const results = await Promise.resolve(fx.continueWatching()).catch(() => []);
    return {
      reply: results.length
        ? `Here is what you have in progress (${results.length} title${results.length === 1 ? "" : "s"}).`
        : "Nothing is in Continue watching right now.",
      action: "watch",
      query: "Continue watching",
      results,
    };
  }

  if (intent.kind === "show_mylist") {
    if (!fx.myList) return null;
    const results = await Promise.resolve(fx.myList()).catch(() => []);
    return {
      reply: results.length
        ? `Here is your My List (${results.length} saved).`
        : "Your My List is empty right now.",
      action: "watch",
      query: "My List",
      results,
    };
  }

  if (intent.kind === "set_mylist") {
    if (!fx.setMyList) return null;
    const out = await Promise.resolve(fx.setMyList(intent.wantSaved)).catch(() => null);
    if (!out) {
      return {
        reply: "Highlight a film or show first, then ask me to add it to My List.",
        action: "mylist_updated",
      };
    }
    const reply = intent.wantSaved
      ? `Saved “${out.name}” to My List.`
      : `Removed “${out.name}” from My List.`;
    return {
      reply,
      action: "mylist_updated",
      query: out.name,
      ...(out.item ? { results: [out.item] } : {}),
    };
  }

  // "resume_named"
  if (fx.continueWatching) {
    const inProgress = await Promise.resolve(fx.continueWatching()).catch(() => []);
    const hit = matchByName(inProgress, intent.term);
    if (hit) {
      return {
        reply: `Resuming “${hit.title.name}”.`,
        action: "resume",
        query: `“${hit.title.name}”`,
        results: [hit],
      };
    }
  }
  return null;
}
