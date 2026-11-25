# Design workbench

`packages/design` renders the TV's own glass components and screens in a desktop browser, at 1920x1080, driven by
the keyboard like the remote. Use it to try a design before deploying to a TV. It is a dev server only: it is never
built into a `.wgt` and has no `budget.json`.

```bash
pnpm design          # http://localhost:5180
```

The view is kept in the query string (`?page=screens&screen=2&theme=day`), so a reload or a shared link opens the
same screen.

## What it shows

- **Tokens**: the colours of the current theme, the app tints, radii, type sizes and motion, from
  `packages/tv-kit/src/glass/tokens.ts`. OK plays the motion sample.
- **Components**: every glass component (`Glass`, `Segmented`, `IconButton`, `DateChip`, `AppChip`, `Avatar`, `Fab`,
  `ListCard`, `MediaTile`, `Scroller`, `VoiceWave`, `Glow`) in its states, in two groups. Arrows move between them; OK
  goes inside the Scroller (Back leaves) and cycles the wave's state. "Focus all" shows every focused state at once.
  A third group shows the line icon set (`glass/icons.ts`, drawn by `Icon`): every action and weather icon, and
  the icon buttons as the apps use them. "Header and panels" shows the one header (`Header`; OK on its specimen collapses
  it to the clock, as a title page does, and expands it again, as Up does) with the info panel, buttons and tabs, and
  "Catalog tiles" the poster and landscape tiles under the collapsed header (`glass/Header.tsx`, `glass/pieces.tsx`).
- **Screens**: Secretary, as on the TV. Its home (`launcher/src/home.tsx`) with its own navigation (`nest-nav.ts`), the
  home showing an answer and the full chat, the Lights panel (`launcher/src/lights.tsx`: routines and lights by room,
  with a fake SmartThings that answers after a short wait and refuses "Away", to show a failed run); the one search
  (`launcher/src/search.tsx`), empty on its recent searches and with results, on fixture titles that answer after a
  short wait (type with the panel's keys); then the catalog pages Secretary opens inside itself: the catalog home
  (`catalog-kit/src/ui/Home.tsx`) for Cinema, Shows and Anime, a film page (with its cast) and a show page
  (`ui/Detail.tsx`), and the show page with spoiler protection on. Last, Settings (`catalog-kit/src/ui/HubOverlay.tsx`) under Secretary's header, on fixture settings and apps,
  opened on Watching, on Home screen's feature switches and on the Apps picker. Up from a title page's buttons expands the header. The data is fixtures
  (`packages/design/src/fixtures.ts`, typed against the screens' props, so `pnpm typecheck` catches drift), and the
  artwork is drawn on canvases at boot (`art.ts`): no network, no keys, no real titles.

The toolbar switches the theme (Night, Daylight), the tint (orange, blue, rose), the glass mode (fake, flat, live), the
safe-area and grid overlays, and fit or 1:1 scale. The catalog pages draw their own glass (fake, in the section's
tint), so the theme and mode switches apply to the home screen and the other pages only.

## Desktop remote

Keys are re-sent as the keyCodes the TV sends, so tv-kit's own paths run as on the TV: `installBackAdapter` (Back is
debounced and becomes Escape) and the key names in `use-keys.ts`. The side panel has a clickable remote and shows the
key names the screen receives.

| Remote | Desktop |
| --- | --- |
| Arrows, OK | Arrows, Enter |
| Back | Backspace or Esc |
| Red, Green, Yellow, Blue | 1, 2, 3, 4 |
| Play/Pause | Space |
| CH-, CH+ | `[`, `]` (also PageDown, PageUp) |
| Search | `/` |
| Info | `i` |

## TV rules linter

The side panel lints everything on the stage, pseudo-elements included, every 0.7 s, against the rules measured on the
reference TV (`docs/performance.md`, Glass lab; `docs/lessons.md`). Breaking rules are outlined in red on the stage;
hovering a line in the panel outlines its element.

| Rule | Level | Why |
| --- | --- | --- |
| `backdrop-filter` (outside the "live" mode) | breaking | A live blur drops the TV to about 15 fps; use the frost |
| Outer `box-shadow` blurred more than 8px | breaking | Soft shadows cost 16-20 long frames per walk; use an inset hairline or `Glow` |
| CSS gradient | breaking | The slowest fill on the TV; paint it once on a canvas |
| `filter: blur()` | breaking | Blur once on a canvas (`backdrop.ts`) |
| Transition or `@keyframes` on layout, size, filter or shadow | breaking | Only transform and opacity move |
| `transition: all` | to check | It can animate layout |
| Transform or opacity animated without `will-change` or an inline `translate3d` | to check | Moving and fading elements go on their own layer |

The node count is shown too (the long soak tracked about 80 on the catalog home).

## Tokens

`packages/tv-kit/src/glass/tokens.ts` holds the glass tokens as data. The TV reads the same values from the CSS
variables in `glass.css` (`.sg-root` for Night, `.sg-root.sg-day` for Daylight), so they cost nothing at runtime.
`packages/tv-kit/test/tokens.test.ts` fails when the two disagree or when a new `--sg-*` variable has no token: change
both together.

## What it does not tell you

A desktop browser is many times faster than the TV, and its compositor is not the TV's. The workbench catches the
known costly patterns; it does not measure frames. When a change touches the player, focus or rendering, deploy it and
measure with `node ../tv-kit/scripts/cdp.mjs <port> walk`, then add the numbers to `docs/performance.md`. Chrome
DevTools' 6x CPU throttle gives a rough early feel, nothing more.
