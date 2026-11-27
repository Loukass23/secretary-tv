// Opt-in live Gemini check for Ask Nest's free-text prompts. Never run by `pnpm test` or CI.
// Usage: NEST_GEMINI_API_KEY=... pnpm --filter @secretary/assistant eval
import { formatEvalReport, runLiveEval } from "./eval-runner.ts";
import { EVAL_PROMPTS } from "./fixtures/eval-prompts.ts";

const key = process.env.NEST_GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
if (!key) {
  console.error("Set NEST_GEMINI_API_KEY (or GEMINI_API_KEY) in the environment to run the live Gemini eval.");
  process.exit(1);
}

const summary = await runLiveEval(EVAL_PROMPTS, { key });
console.log(formatEvalReport(summary));
