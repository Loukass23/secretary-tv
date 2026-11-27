---
name: assistant-feature
description: Add or change an Ask Nest assistant capability in Secretary TV (a new kind of prompt, a model call, a new answer action). Use when working on packages/assistant, launcher/src/brain.ts or the assistant panel.
---

# Add an assistant feature

Read `.agents/rules/assistant.md` first, then `packages/assistant/src/route.ts`, `launcher/src/brain.ts` and the
"Ask Nest" sections of `docs/launcher.md`.

1. **Write the prompts down first.** List 5-10 things a viewer would say, and 3-5 near misses that must keep going to
   their current handler. These become the tests.
2. **Parse in a pure function** next to `intent.ts` (for example `parseX(prompt): X | null`), so it is tested without
   effects. Keep regexes anchored and lower-cased, like `parseWatchIntent`.
3. **Add an optional effect** to `Effects` for anything that touches the world (storage, SmartThings, catalogs, a
   model). Without it, the prompt falls through to the next handler.
4. **Place the branch in `route()`** by cost: local matches before any model call. Return a new or existing
   `AskAction`; a new action needs handling in `launcher/src/app.tsx`, where `turn.action` decides where focus goes
   and what opening a Recent card does (search for `turn.action ===`).
5. **Model calls** go through `firstPart()` in `gemini.ts` with plain `fetch`, the fallback list and the 8 s timeout.
   For structured answers ask for JSON (`generationConfig.responseMimeType: "application/json"` with a
   `responseSchema`) and validate it; fall back to the canned reply on anything unexpected.
6. **Wire it on the TV** in `launcher/src/brain.ts` (`localBrain`). The server is being retired: do not add server
   routes.
7. **Tests** in `packages/assistant/test/` (and `packages/launcher/test/` for the TV wiring): the prompts from step
   1, the near misses, a fake `fetch` asserting the request body, and the failure path (model refuses, times out,
   returns junk).
8. **Docs:** update `docs/launcher.md` ("Ask Nest") with what the viewer can now say.
9. Run the `verify` skill.
