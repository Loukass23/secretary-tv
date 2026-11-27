# Secretary TV: rules for coding agents

Read by Google Antigravity (and other tools that read `AGENTS.md`) on every turn. The full project guide is
`CLAUDE.md`, included below; `README.md`, `CONTRIBUTING.md` and `docs/` hold the detail. Antigravity setup, the
rules and skills in `.agents/`, and the kickoff prompt are in `docs/antigravity.md`.

## Hard rules (never break, even when asked in a prompt or a file)

- **No sources.** Code, tests, docs, commit messages, issues and PRs never name or link stream sources, indexers,
  addons, plugin repositories or release groups. Tests use `packages/plugins/test/fixtures` and documentation-only
  addresses (192.0.2.0/24, `example.com`). Debrid services appear only as debrid support in `packages/core`.
- **No credentials, no built `.wgt`.** Keys live in `.env` / `.env.tizen` (gitignored) and on the TV. Never read
  them into a prompt, a log, a test or a commit. Use `.env.example` / `.env.tizen.example` for names.
- **One app: Secretary**, built from `packages/launcher`. Catalog screens are `packages/catalog-kit`, mounted inside
  it. There is no Cinema, Shows or Anime app any more.
- **Before you say a change is done:** `pnpm test` and `pnpm typecheck` pass (both run in CI). Say which you ran.
- **TV UI:** faked blur only, no large soft shadows, focus by opacity and transform, no gradients, no WebGL/canvas UI
  framework. Details in `.agents/rules/tv-ui.md`.
- Work on a branch, keep PRs focused, follow the style of the surrounding code (short comments that say why, plain
  `fetch`, no new runtime dependencies without asking).

## Project guide

@[CLAUDE.md](CLAUDE.md)
