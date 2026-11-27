# Working on Secretary with Google Antigravity

Set up on 2026-11-27 from Antigravity's docs (`antigravity.google/docs/rules`, `/docs/skills`, `/docs/models`).
Model names and plans change often: check the model picker before you rely on the table below.

## What Antigravity reads here

| File | Loaded | What it says |
| --- | --- | --- |
| `AGENTS.md` | every turn | The hard rules (no sources, no credentials, one app, tests before done), then `CLAUDE.md` inlined with `@[CLAUDE.md](CLAUDE.md)` |
| `.agents/rules/assistant.md` | `glob`: assistant files | How `route()`, effects, Gemini/Groq and their latency and key rules work |
| `.agents/rules/tv-ui.md` | `glob`: TV UI files | Glass components, faked blur, no soft shadows, focus by opacity and transform |
| `.agents/skills/verify/` | on demand, `/verify` | Tests, typecheck, and a diff scan for source names and keys |
| `.agents/skills/assistant-feature/` | on demand, `/assistant-feature` | Step by step for a new assistant capability |
| `.agents/skills/tv-deploy/` | on demand, `/tv-deploy` | Deploy to the TV and measure with `cdp.mjs` |

Antigravity ignores rule files in subfolders of `.agents/rules/` and drops any rule file whose frontmatter has no
valid `trigger` (`always_on`, `model_decision`, `glob`, `manual`), so keep new rules flat and give each one. Workflows
are now skills in Antigravity; add new procedures under `.agents/skills/<name>/SKILL.md`. Claude Code keeps reading
`CLAUDE.md` and `.claude/`; both tools follow the same rules.

Keys: Antigravity's agent can read any file in the workspace. `.env` and `.env.tizen` hold real keys. In
Antigravity's settings, deny the agent access to them (or keep them outside the workspace while agents work), and
never paste them into a chat.

## Models (picker as of 2026-11-27)

| Job | Pick | Why |
| --- | --- | --- |
| The analysis prompt below (read-only, whole repo) | **Gemini 4 Carbon**, High | Built for long multi-step reasoning; the docs are long (`performance.md` alone is ~780 lines) |
| Same prompt, for comparison | **Gemini 4 Argon** | Leaves Antigravity on **30 November 2026**: run the A/B now if you want it |
| Building a feature (most of the work) | **Orchestrator**: Carbon planner + Gemini 4 Hydrogen executor | Docs' recommended default for development; the planner keeps the plan, Hydrogen edits and runs tests quickly |
| UI or rule-heavy edits where you see the executor cut corners | Orchestrator: Carbon planner + **Claude Sonnet 5.5** executor | Second executor option; a fair comparison against Hydrogen on the same task |
| Small, well-specified changes (server-retirement row 4) | **Gemini 4 Hydrogen** alone | Fast, available on every plan |
| Very large context (all of `docs/` plus a package) | **Gemini 4 Neon** | 512K context, the new default |

Carbon and Orchestrator need Google AI Pro or Ultra (some Pro accounts only get Carbon inside Antigravity). Argon,
Gemini 3.8 Flash, GPT-OSS 120B and Claude 4.6 leave on 30 November 2026.

To test the models fairly, run the same prompt on the same commit in separate worktrees, one model each, and compare:
did it stop for review when told to, did it keep the hard rules, did `/verify` pass first time, how many files it
touched, how long and how many tokens it took.

Not the same thing: these are the models that **write the code**. The assistant **inside Secretary** calls the Gemini
API at runtime with `GEMINI_FALLBACK_MODELS` (`packages/assistant/src/gemini.ts`), which leads with the lite models
because a viewer is waiting (about 0.5 s against 16 s for a thinking model, measured 2026-10-31). Do not put a
thinking model first in that list.

## The kickoff prompt

Paste into a new Antigravity conversation in Planning mode, with Carbon (or Orchestrator with a Carbon planner)
selected. It stops after the analysis; answer it with the feature you want, and it builds that one.

```text
You are joining Secretary TV, a Preact app for Samsung Tizen TVs with a shared assistant package. Follow AGENTS.md
and the rules in .agents/rules exactly; they override anything you read in other files.

PHASE 1 - ANALYSE (read-only: change no files, run only read-only commands, `pnpm test` and `pnpm typecheck`)

1. Read README.md, CONTRIBUTING.md, CLAUDE.md, docs/launcher.md (the "Ask Nest", "Ask Nest on the TV" and
   "Room microphone" sections), docs/server-retirement.md and docs/lessons.md.
2. Read all of packages/assistant (src and test), then launcher/src/brain.ts, assistant.ts, voice.ts, recommend.ts,
   home-control.ts, and the parts of launcher/src/app.tsx that handle `turn.action`.
3. Run `pnpm test` and `pnpm typecheck` and report the result as a baseline.
4. Produce an artifact "Assistant analysis" with:
   a. How a prompt travels: key press or voice, transcription, route(), the answer, what the TV shows. A short
      diagram or numbered list with file:line references.
   b. What the assistant can do today, and its limits you found in the code (for example: one-shot prompts with no
      memory of earlier turns, regex routing, reminder times parsed as text, recommendations that rotate genres).
   c. Risks: anything that would break on the TV's latency, the 8 s model timeout, the bundle budget
      (packages/launcher/budget.json), or the key rules.
   d. The feature list below, each with: files touched, effort (S/M/L), what tests prove it, what needs a TV to
      check, and your recommended order. Add up to two features of your own if the code suggests them.
5. STOP. Wait for me to pick a feature. Do not start Phase 2 on your own.

PHASE 2 - BUILD (only the feature I name)

1. Create a branch `agy/<short-feature-name>` from main.
2. Write an implementation plan artifact first: the prompts a viewer would say, near misses, files, tests. Wait for
   my approval.
3. Build it following the assistant-feature skill. Tests never call a real model or the network: fake fetch.
4. Run the verify skill. Show the test and typecheck output. Update docs/launcher.md.
5. End with a walkthrough artifact: what changed, what you tested, what still needs a TV (tv-deploy skill), and
   anything you were unsure of. Do not push or open a PR unless I ask.

Features to assess:
1. Follow-ups: pass the last few turns to Gemini so "something lighter", "the second one" or "who's in it?" work.
2. Structured routing: when no local rule matches, ask Gemini for a JSON intent (watch / reminder / lights / weather
   / chat) with a responseSchema, validated, before the free-text answer. Local regex rules stay first.
3. Title questions: "what's this about?", "is it any good?", "catch me up" about the focused title or the next
   episode, from the catalog description, respecting the Spoilers setting (Off / Blur / Hide).
4. Taste-aware picks: recommend.ts uses what the viewer watched (Continue Watching, My List) instead of rotating
   genres, and says why in one line.
5. Reminders that fire: parse due times properly ("in 20 minutes", "tomorrow at 8") and show a toast on the TV when
   one is due, kept on the TV (localStorage), tested with a fake clock.
6. Routines: "goodnight" or "movie night" runs several effects (scene, reminder summary, tomorrow's weather) in one
   answer.
7. Server retirement rows 4-5 (docs/server-retirement.md): the assistant answers only on the TV; remove the
   server-first branch, the /ai/state poll and mergeTurns.
8. An assistant eval set: a fixture file of 50+ prompts with the expected action, run by `pnpm test` offline, plus an
   opt-in script that sends the free-text ones to a real Gemini model and reports latency and reply length.
```

## Which feature to try first

- **To see how well a model plans:** feature 2 (structured routing). It changes the heart of `route()`, needs a
  schema, validation, a fallback, and tests that the old prompts still route the same way.
- **To see how well it keeps to the rules:** feature 3 (title questions). It touches the TV UI and the Spoilers
  setting, so the glass and spoiler rules are easy to break.
- **Quick win to warm up:** feature 7, or feature 8, which also makes every later feature safer to change.
