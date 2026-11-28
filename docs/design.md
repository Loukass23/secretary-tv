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

- **Tokens**: the accent and the colours of the current theme, the app tints, radii, the type scale (in the current
  type style and text size) and motion, from `packages/tv-kit/src/glass/tokens.ts`. OK plays the motion sample.
- **Components**: every glass component (`Glass`, `Segmented`, `IconButton`, `DateChip`, `AppChip`, `Avatar`, `Fab`,
  `ListCard`, `MediaTile`, `Scroller`, `VoiceWave`, `Glow`) in its states, in two groups. Arrows move between them; OK
  goes inside the Scroller (Back leaves) and cycles the wave's state. "Focus all" shows every focused state at once.
  A third group shows the line icon set (`glass/icons.ts`, drawn by `Icon`): every action and weather icon, and
  the icon buttons as the apps use them. "Header and panels" shows the one header (`Header`; OK on its specimen collapses
  it to the clock, as a title page does, and expands it again, as Up does) with the info panel, buttons and tabs, and
  "Catalog tiles" the poster and landscape tiles under the collapsed header (`glass/Header.tsx`, `glass/pieces.tsx`).
  "Preview and rank" shows `PreviewList`, the compact list beside a preview of its focused line that Settings and Lights
  build on (OK steps the line), and `RankNumber`, the one Top 10 numeral.
- **Screens**: Secretary, as on the TV. Its home (`launcher/src/home.tsx`) with its own navigation (`nest-nav.ts`), the
  home showing an answer and the full chat, the Mood panel (`launcher/src/mood.tsx`: Cinema, Music, Dining, Off and the routines chosen to show, as a list beside a
  preview of what the focused one does, the active one marked); the one search
  (`launcher/src/search.tsx`), empty on its recent searches, with results and with no catalog answering (its error state), on fixture titles that answer after a
  short wait (type with the panel's keys); then the catalog pages Secretary opens inside itself: the catalog home
  (`catalog-kit/src/ui/Home.tsx`) for Cinema, Shows and Anime, a film page (with its cast) and a show page
  (`ui/Detail.tsx`, the film with a logo, the show with its name in the display face), and the show page with spoiler
  protection on Blur and on Hide. Last, Settings (`catalog-kit/src/ui/HubOverlay.tsx`) under Secretary's header, on fixture settings and apps,
  opened on Watching, on Home screen's feature switches, on the Apps picker, on Appearance and on SmartThings (the
category Secretary adds, `launcher/src/smartthings-settings.tsx`: the light effects, the routines and every light by
room, on a fake SmartThings that switches after a short wait): each category is a
  compact list beside a preview of what the focused setting does (`ui/setting-preview.tsx`). Its look rows (accent, font, type
  style, text size, Reduce motion) and the toolbar's switches are the same values, so a change in either shows in both. Up from a title page's buttons expands the header. The data is fixtures
  (`packages/design/src/fixtures.ts`, typed against the screens' props, so `pnpm typecheck` catches drift), and the
  artwork is drawn on canvases at boot (`art.ts`): no network, no keys, no real titles.

The toolbar switches the theme (Night, Daylight), the wallpaper tint, the accent (the four of Settings › Appearance), the
font (Grotesk, Condensed, Geometric), the type style (Studio, Classic, Bold) and the text size (Normal, Large), the glass mode (fake, flat, live), the safe-area
and grid overlays, and fit or 1:1 scale. The accent and the type go on the page as the TV's settings put them there
(catalog-kit `applyLook`). The catalog pages draw their own glass (fake, in the section's
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

## Accent and type

One accent colour, `--sg-accent` (and its ink `--sg-accent-ink`), on `:root`: the theme accent the viewer picks in
Settings › Appearance (`applyThemeToDocument` writes `--accent` and `--tinta`, Secretary applies it at start and on every
change). The four accents come from the secretary bird's plumage (`tokens.ts` `ACCENTS`, Nov 2026):

| Accent | Colour | Ink | Ink contrast |
| --- | --- | --- | --- |
| Burnt Orange (default, the bird's face) | `#e2703a` | `#1c120c` | 5.8:1 |
| Ochre | `#d4a03c` | `#1c120c` | 7.8:1 |
| Slate Blue (its wings) | `#7d97bd` | `#1c120c` | 6.2:1 |
| Sage | `#93ad86` | `#1c120c` | 7.5:1 |

All four take the dark ink (white on any of them is under 3.2:1). Settings saved before the plumage set map over:
Raptor Orange and Rose to Burnt Orange, Cinema Blue to Slate Blue, Aristocrat Gold to Ochre. Where the accent is
text on the glass rather than a fill (the assistant's words and the bold in its answers), it goes through
`--sg-accent-text` on `.sg-root`: mixed 70% with white at night and 50% with the daylight ink by day, so every accent
holds 4.5:1 on both pages (`test/tokens.test.ts` checks the inks and both tints). Every focus fill and ring, badge, kicker, progress bar and picked tab takes it; no CSS names its own colour for
these. One exception: on Secretary's home at night, with Poster colour on, the focused element's ring and fill take
the focused poster's colour (`glass/ring.ts` `useFocusRing`, set on the focused elements only), and the accent comes back
in daylight or with Poster colour off. Type: a scale of eight steps (`--sg-t-xs` 21px to `--sg-t-hero` 72px) times `--sg-text`; every font size in the
glass and the screens' CSS is a step (a test checks `glass.css`), so the text size scales everything. Two faces: the TV's
own for body text and a display face for titles and numbers; a type style says which face titles (`--sg-font-title`),
numbers (`--sg-font-num`) and labels (`--sg-font-label`) use. The display face is the Font setting (`tokens.ts`
`DISPLAY_FONTS`), all SIL OFL 1.1, Latin subset, one variable woff2 each in `glass/fonts` with its licence:

| Font | Face | File |
| --- | --- | --- |
| Grotesk (default) | Space Grotesk | 22 KB |
| Condensed | Oswald, a tall cinema face | 28 KB |
| Geometric | Outfit, a round geometric sans | 32 KB |

The browser fetches only the face in use. Style, size and font are `data-sg-type`, `data-sg-text` and `data-sg-font`
on `<html>` (`glass/type.ts` `applyType`, `applyFont`), so a switch is one restyle. At Large, tabs grow to their
labels (`Tabs` measures them once per set of labels and type, never on a key) instead of spilling.

## What it does not tell you

A desktop browser is many times faster than the TV, and its compositor is not the TV's. The workbench catches the
known costly patterns; it does not measure frames. When a change touches the player, focus or rendering, deploy it and
measure with `node ../tv-kit/scripts/cdp.mjs <port> walk`, then add the numbers to `docs/performance.md`. Chrome
DevTools' 6x CPU throttle gives a rough early feel, nothing more.
