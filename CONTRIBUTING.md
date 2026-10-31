# Contributing to Secretary TV

Thanks for helping. A few rules keep the project small and safe to host:

- **No sources.** Don't add, name or link stream addons, plugin repositories, indexers or sites, in code, tests, docs,
  issues or PRs. Tests use the fixtures in `packages/plugins/test/fixtures` and documentation-only addresses
  (192.0.2.0/24, `example.com`).
- **No credentials.** Keys live in `.env` / `.env.tizen` (gitignored) and on the TV. Never commit a built `.wgt`.
- **Debrid code** goes in `packages/core`, one file per service behind the shared interface in `debrid.ts`.
- **Measure on a TV** when a change touches the player, focus or rendering, and note the numbers in
  `docs/performance.md`. `docs/lessons.md` lists what Tizen does not allow.

Before opening a PR:

```bash
pnpm install
pnpm test
pnpm typecheck
```

Keep PRs focused, describe what you checked and on which TV model, and follow the style of the surrounding code.
By contributing you agree that your work is released under the MIT license (`LICENSE`).
