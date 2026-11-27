---
trigger: glob
description: "How the Secretary assistant (Ask Nest) is built: route(), effects, Gemini/Groq over fetch, latency and key rules"
globs: "packages/assistant/**, packages/launcher/src/assistant.ts, packages/launcher/src/brain.ts, packages/launcher/src/voice.ts, packages/launcher/src/recommend.ts, packages/launcher/src/home-control.ts, packages/server/src/companion.ts, packages/server/src/app.ts"
---

# The assistant (Ask Nest)

Read `docs/launcher.md` ("Ask Nest", "Ask Nest on the TV", "Room microphone") and `docs/server-retirement.md`
(rows 4 to 7) before changing it.

## Shape

- `packages/assistant` is shared by the TV and the server. It is plain TypeScript with **no dependencies**: Gemini
  (`gemini.ts`) and Groq Whisper (`groq.ts`) are called with plain `fetch`, never an SDK.
- `route(prompt, effects)` in `route.ts` answers every prompt. Order matters: reminders, watch intents
  (`intent.ts`), weather, music mode, lights, then Gemini, then the canned briefing. Cheap local matches come first so
  most prompts never wait for a model.
- **Effects are injected** (`Effects`): reminders, lights, `find`, `weather`, `geminiKey`, `fetch`. The TV
  (`launcher/src/brain.ts`) and the server pass their own. New capabilities are new optional effects, so a caller
  without them still works (the prompt falls through).
- An `Answer` is `{ reply, action, query?, results? }`. A new `action` needs handling in `launcher/src/app.tsx`
  (search for `turn.action ===`): where focus goes after the answer and what its Recent card opens.

## Constraints

- **Someone is waiting at the TV.** Each model gets `GEMINI_TIMEOUT_MS` (8 s) before the next is tried;
  `GEMINI_FALLBACK_MODELS` leads with the lite models because they answer in about 0.5 s (measured 2026-10-31).
  Do not put a slow thinking model first. Say the measured latency of any model you add.
- Replies are read on a TV from across the room: one or two short sentences, no Markdown.
- The persona (the Secretary Bird) is part of the product; keep its voice when you touch prompts.
- The TV's key is `NEST_GEMINI_API_KEY` / `NEST_GROQ_API_KEY` in `.env.tizen`, built into the `.wgt`
  (`launcher/src/config.ts`). The server's `GEMINI_API_KEY` must never end up in a TV build.
- The server is being retired (`docs/server-retirement.md`): new features must work on the TV alone (`brain.ts`).
  Do not add new server routes.
- Spoilers: the viewer's setting is Off / Blur / Hide. Anything that recaps a title respects it.

## Tests

- `packages/assistant/test/*.test.ts`, `node:test` + `node:assert/strict`, run by `pnpm test`.
- Build effects with the `effects()` helper pattern in `route.test.ts`; fake `fetch` for Gemini and Groq and assert on
  the request body. **Tests never call a real model or network.**
- Every new prompt shape gets a test that it routes to the right `action`, and one that a near miss does not
  (for example "show me the lights" is not a watch prompt).
