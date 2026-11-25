// The glass design tokens as data, for the design workbench (packages/design) and docs.
// The TV reads the same values from the CSS variables in glass.css (no JS cost at runtime);
// test/tokens.test.ts fails when the two disagree, so change both together.

/** Colour roles, as `--sg-<name>` in glass.css. */
export interface ColourTokens {
  fill: string;
  line: string;
  raised: string;
  ink: string;
  "ink-dim": string;
  focus: string;
  "focus-ink": string;
  "focus-ink-dim": string;
}

/**
 * The one accent, as `--sg-<name>` on `.sg-root`: the theme accent the viewer picks in Settings › Appearance
 * (catalog-kit `applyThemeToDocument` writes it to the page as `--accent` and its ink as `--tinta`). Every focus fill,
 * the keyboard and tile focus, badges, kickers, progress bars and tabs take it from here; nothing else names a colour
 * for them.
 */
export const ACCENT = {
  accent: "var(--accent, #ff5a26)",
  "accent-ink": "var(--tinta, #ffffff)",
} as const;

/** The focus fill and its inks, the same in both themes: the accent. */
const FOCUS = {
  focus: "var(--sg-accent)",
  "focus-ink": "var(--sg-accent-ink)",
  "focus-ink-dim": "color-mix(in srgb, var(--sg-accent-ink) 74%, transparent)",
} as const;

/** Night: the dark glass (`.sg-root`). */
export const NIGHT: ColourTokens = {
  fill: "rgba(255, 255, 255, 0.07)",
  line: "rgba(255, 255, 255, 0.11)",
  raised: "rgba(255, 255, 255, 0.16)",
  ink: "#f4f4f6",
  "ink-dim": "rgba(244, 244, 246, 0.62)",
  ...FOCUS,
};

/** Daylight: the light glass (`.sg-root.sg-day`). Both dim inks hold 4.5:1 on their grounds, even over the lavender glow. */
export const DAY: ColourTokens = {
  fill: "rgba(255, 255, 255, 0.42)",
  line: "rgba(255, 255, 255, 0.8)",
  raised: "rgba(120, 50, 10, 0.09)",
  ink: "#2a1810",
  "ink-dim": "rgba(42, 24, 16, 0.7)",
  ...FOCUS,
};

/** Page colour behind the wallpaper, per theme. */
export const PAGE_BG = { night: "#0b0807", day: "#f4e9dc" } as const;

/** Corner radii, as `--sg-r-<name>`. */
export const RADII = {
  pill: "34px",
  panel: "22px",
  card: "20px",
  chip: "18px",
} as const;

/** Motion, as `--sg-<name>`. Only opacity and transform are ever animated. */
export const MOTION = {
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  move: "280ms",
  fade: "180ms",
} as const;

/**
 * The type scale, as `--sg-t-<name>` on `:root` (CSS px on the 1920x1080 page at the Normal text size), raised for
 * reading from the couch: nothing under 21px. Every font size in the glass and the screens' CSS is one of these
 * (`var(--sg-t-m)`), so the text size setting scales them all at once. Decorative numerals (a Top 10 rank, the weather's
 * big temperature) keep their own size.
 */
export const TYPE_SCALE = {
  xs: { px: 21, use: "Badges, counts, small print" },
  s: { px: 24, use: "Captions, meta lines, tile subtitles" },
  m: { px: 28, use: "Body, buttons, tabs, synopsis" },
  l: { px: 32, use: "Card and list titles, info title" },
  xl: { px: 38, use: "The clock, chip dates, panel titles" },
  xxl: { px: 48, use: "Screen headings" },
  title: { px: 60, use: "A title page's name" },
  hero: { px: 72, use: "The largest headings" },
} as const;

export type TypeStep = keyof typeof TYPE_SCALE;

/** The text size setting (Settings, wave 3): a factor on the whole scale, as `--sg-text`; `data-sg-text` on `<html>`. */
export const TEXT_SIZES = {
  normal: { factor: 1, label: "Normal" },
  large: { factor: 1.15, label: "Large" },
} as const;

export type TextSize = keyof typeof TEXT_SIZES;

/**
 * The two faces. The body face is the TV's own (today's); the display face is Space Grotesk (SIL OFL 1.1, Latin subset,
 * weights 300 to 700 in one 22 KB variable file: glass/fonts), bundled with the app, for titles and numbers.
 */
export const FONTS = {
  body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  display: '"Space Grotesk", "Segoe UI", system-ui, sans-serif',
} as const;

/** What a type style sets, as `--sg-<name>` on `:root`. */
export interface TypeStyleTokens {
  /** Titles: a card's, a title page's, a panel's heading. */
  "font-title": string;
  /** Numbers: the clock, rank numerals, dates, temperatures, counts. */
  "font-num": string;
  /** Labels: buttons, tabs, kickers, row labels. */
  "font-label": string;
  "title-weight": string;
  "title-track": string;
}

/**
 * The three type styles (Settings, wave 3), as `data-sg-type` on `<html>`; Studio, the default, has no attribute. Each
 * mixes the two faces differently; the body text stays in the body face in all three.
 */
export const TYPE_STYLES = {
  studio: {
    label: "Studio",
    about: "Titles and numbers in the display face",
    tokens: { "font-title": "var(--sg-font-display)", "font-num": "var(--sg-font-display)", "font-label": "var(--sg-font-body)", "title-weight": "600", "title-track": "-0.01em" },
  },
  classic: {
    label: "Classic",
    about: "Everything in the TV's own face",
    tokens: { "font-title": "var(--sg-font-body)", "font-num": "var(--sg-font-body)", "font-label": "var(--sg-font-body)", "title-weight": "600", "title-track": "0em" },
  },
  bold: {
    label: "Bold",
    about: "The display face for titles, numbers and labels, heavier",
    tokens: { "font-title": "var(--sg-font-display)", "font-num": "var(--sg-font-display)", "font-label": "var(--sg-font-display)", "title-weight": "700", "title-track": "-0.02em" },
  },
} as const satisfies Record<string, { label: string; about: string; tokens: TypeStyleTokens }>;

export type TypeStyle = keyof typeof TYPE_STYLES;

/** The warm glow top right, "r,g,b": each app tints its backdrop (Nest and Cinema orange, Shows gold, Anime clay red). */
export const TINTS = {
  orange: "255,90,38",
  // Shows and Anime keep their own tint, in the same warm family: savanna gold and clay red.
  gold: "255,186,60",
  clay: "226,72,72",
} as const;

export type TintName = keyof typeof TINTS;
