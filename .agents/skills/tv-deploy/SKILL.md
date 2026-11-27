---
name: tv-deploy
description: Build, install and measure Secretary on the Samsung Tizen TV, and read its logs over the inspector. Use when a change touches the player, focus or rendering, or when asked to try something on the TV.
---

# Deploy and measure on the TV

Needs the Tizen Studio CLI (`tz`, `sdb`), a certificate profile with the TV's DUID, and `.env.tizen` (from
`.env.tizen.example`). If any is missing, stop and tell the user; do not create certificates or edit `.env.tizen`.
Never print the contents of `.env.tizen`.

Everything goes through Secretary (`packages/launcher`); there is no other TV app.

```bash
cd packages/launcher
node ../tv-kit/scripts/tizen.mjs deploy   # build, sign, install in place (keeps the app's data), launch
node ../tv-kit/scripts/tizen.mjs debug    # prints the inspector port
node ../tv-kit/scripts/cdp.mjs <port> logs   # console output
node ../tv-kit/scripts/cdp.mjs <port> walk   # focus walk with frame timings
node ../tv-kit/scripts/cdp.mjs <port> shot   # screenshot
```

- `scripts/check-budget.mjs` enforces `budget.json` after every build; a failure there means the bundle grew too much.
- To measure a change, run `walk` on `main` deployed the same way, then on the branch, and add both numbers (TV model,
  date, what was walked) to `docs/performance.md`.
- Reach catalog screens the way a viewer does, from Secretary's cards (See all on a card's end bar).
