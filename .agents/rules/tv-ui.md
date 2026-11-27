---
trigger: glob
description: "Rules for any UI that runs on the Samsung Tizen TV: glass components, performance limits, focus"
globs: "packages/launcher/src/**/*.tsx, packages/launcher/src/**/*.css, packages/catalog-kit/src/**/*.tsx, packages/catalog-kit/src/**/*.css, packages/tv-kit/src/**, packages/design/src/**"
---

# TV UI

The TV is slow. These limits were measured on a real Tizen TV (`docs/performance.md`, `docs/lessons.md`); breaking
them drops frames the viewer sees.

- Build on `packages/tv-kit/src/glass` (`Glass`, `GlassRoot`, `MediaTile`, `ListCard`, `Segmented`, `Scroller`,
  `IconButton`, backdrops), imported as `@secretary/tv-kit/src/glass/index.ts`. Preact and plain DOM.
- **Faked blur only** (`GlassRoot mode="fake"`). Never `backdrop-filter`.
- **No large soft shadows** (`box-shadow: 0 18px 40px` and the like). Inset hairlines are fine.
- **Focus by opacity and transform** on elements with their own layer (`will-change`). Never animate layout, size or
  filters. Flat fills, no gradients.
- Full-page art on its own layer, decoded before it is shown. Long lists render only the rows around focus.
- Tokens live in `glass/tokens.ts` and `glass.css` together; a test keeps them in step.
- Everything is reached with the remote: arrows, OK, Back, colour keys. Every new control is focusable through the
  focus grid (`tv-kit`), and Back always leaves.
- Text is read from across a room: no small grey text. What the viewer reads says "Secretary", not "Nest".
- Try designs in the workbench first (`pnpm design`, `docs/design.md`, 1920x1080, keyboard as remote, Night and
  Daylight, its linter). The workbench does not measure frames: changes to focus, rendering or the player are
  measured on a TV (`/tv-deploy` skill) and the numbers go in `docs/performance.md`.
