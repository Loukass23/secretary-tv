---
name: verify
description: Check a change before calling it done in Secretary TV - run the tests and the typecheck, and scan the diff for source names and credentials. Use before every commit or PR, and whenever asked to verify, test or check work.
---

# Verify a change

Run from the repository root (Windows PowerShell or a POSIX shell both work).

1. `pnpm install` if `node_modules` is missing or `pnpm-lock.yaml` changed.
2. `pnpm test` - `node --test` over `packages/*/test/*.test.ts`. No browser, no network.
3. `pnpm typecheck` - `tsc --noEmit` over every package.
4. Look at the diff (`git diff main...HEAD` plus `git status` for new files) and check:
   - no stream source, indexer, addon, plugin repository or release-group names or links (tests use
     `packages/plugins/test/fixtures`, `example.com`, 192.0.2.0/24);
   - no keys, tokens or values from `.env` / `.env.tizen`, and no `.wgt` file;
   - no new runtime dependency in any `package.json` unless the user asked for it;
   - new behaviour has a test, and docs in `docs/` that describe the changed area are updated.
5. Report what you ran and the result. If a test fails, show the failing output; do not call the work done.

Tizen builds do not run here or in CI. If the change touches the player, focus or rendering, say that it still needs
a TV measurement (`tv-deploy` skill).
