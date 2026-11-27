// Runs the free-text prompts of EVAL_PROMPTS through route() and reports latency and TV-readability limits.
// Pure over the fetch and clock it is handed, so eval.test.ts checks it offline without touching Gemini.
import { route } from "../src/route.ts";
import type { Weather } from "../src/weather.ts";
import type { EvalCase } from "./fixtures/eval-prompts.ts";

/** Matches the instruction in route.ts ("under 140 chars") so replies stay readable from across the room. */
export const REPLY_MAX_CHARS = 140;

const MARKDOWN = /[*_`#]|\[[^\]]+\]\([^)]+\)/;

export interface EvalRow {
  prompt: string;
  reply: string;
  ms: number;
  chars: number;
  /** Which Gemini model answered, or null when every model failed and the canned briefing answered. */
  model: string | null;
  overLength: boolean;
  hasMarkdown: boolean;
}

export interface EvalSummary {
  rows: EvalRow[];
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  avgChars: number;
  maxChars: number;
  fellBack: number;
  overLength: number;
  hasMarkdown: number;
}

export interface LiveEvalOptions {
  key: string;
  fetch?: typeof fetch;
  now?: () => number;
  openReminders?: string[];
  weather?: Weather | null;
  maxChars?: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const SAMPLE_WEATHER: Weather = {
  tempC: 16,
  label: "Partly cloudy",
  icon: "⛅",
  place: "Berlin",
  days: [{ date: "2026-11-27", minC: 8, maxC: 18, glyph: "partly" }],
};

export async function runLiveEval(cases: readonly EvalCase[], opts: LiveEvalOptions): Promise<EvalSummary> {
  const baseFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => performance.now());
  const limit = opts.maxChars ?? REPLY_MAX_CHARS;
  const free = cases.filter((c) => c.freeText);
  const rows: EvalRow[] = [];

  for (const c of free) {
    let answeredModel: string | null = null;
    const trackedFetch: typeof fetch = async (input, init) => {
      const res = await baseFetch(input, init);
      if (res.ok) {
        const m = String(input).match(/\/models\/([^:?]+):generateContent/);
        if (m) answeredModel = m[1];
      }
      return res;
    };
    const t0 = now();
    const a = await route(c.prompt, {
      addReminder: () => undefined,
      openReminders: () => opts.openReminders ?? ["water the plants", "call mum at 18:00"],
      lights: async () => undefined,
      weather: async () => (opts.weather === undefined ? SAMPLE_WEATHER : opts.weather),
      geminiKey: opts.key,
      fetch: trackedFetch,
    });
    const ms = Math.max(0, Math.round(now() - t0));
    const chars = a.reply.length;
    rows.push({
      prompt: c.prompt,
      reply: a.reply,
      ms,
      chars,
      model: answeredModel,
      overLength: chars > limit,
      hasMarkdown: MARKDOWN.test(a.reply),
    });
  }

  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  const lengths = rows.map((r) => r.chars);
  const totalChars = lengths.reduce((s, n) => s + n, 0);
  return {
    rows,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    maxMs: times.length ? times[times.length - 1] : 0,
    avgChars: rows.length ? Math.round(totalChars / rows.length) : 0,
    maxChars: lengths.length ? Math.max(...lengths) : 0,
    fellBack: rows.filter((r) => r.model === null).length,
    overLength: rows.filter((r) => r.overLength).length,
    hasMarkdown: rows.filter((r) => r.hasMarkdown).length,
  };
}

export function formatEvalReport(s: EvalSummary): string {
  const lines: string[] = [
    "prompt                                        ms  chars  model                    flags     reply",
    "--------------------------------------------  ----  -----  -----------------------  --------  -----",
  ];
  for (const r of s.rows) {
    const flags = [r.model === null ? "FALLBACK" : "", r.overLength ? "LONG" : "", r.hasMarkdown ? "MD" : ""]
      .filter(Boolean)
      .join(",") || "ok";
    const p = r.prompt.length > 44 ? `${r.prompt.slice(0, 41)}...` : r.prompt.padEnd(44);
    const ms = String(r.ms).padStart(4);
    const ch = String(r.chars).padStart(5);
    const mod = (r.model ?? "canned").padEnd(23);
    const fl = flags.padEnd(8);
    lines.push(`${p}  ${ms}  ${ch}  ${mod}  ${fl}  ${r.reply.replace(/\s+/g, " ")}`);
  }
  lines.push("");
  lines.push(
    `Summary (${s.rows.length} prompts): latency p50=${s.p50Ms}ms p95=${s.p95Ms}ms max=${s.maxMs}ms | ` +
      `length avg=${s.avgChars} max=${s.maxChars} chars | ` +
      `warnings: fallback=${s.fellBack} over-${REPLY_MAX_CHARS}=${s.overLength} markdown=${s.hasMarkdown}`,
  );
  return lines.join("\n");
}
