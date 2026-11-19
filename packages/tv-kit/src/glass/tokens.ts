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

/** Night: the dark glass (`.sg-root`). */
export const NIGHT: ColourTokens = {
  fill: "rgba(255, 255, 255, 0.07)",
  line: "rgba(255, 255, 255, 0.11)",
  raised: "rgba(255, 255, 255, 0.16)",
  ink: "#f4f4f6",
  "ink-dim": "rgba(244, 244, 246, 0.55)",
  focus: "#f4f4f6",
  "focus-ink": "#101114",
  "focus-ink-dim": "rgba(16, 17, 20, 0.6)",
};

/** Daylight: the light glass (`.sg-root.sg-day`). Both dim inks hold 4.5:1 on their grounds, even over the lavender glow. */
export const DAY: ColourTokens = {
  fill: "rgba(255, 255, 255, 0.42)",
  line: "rgba(255, 255, 255, 0.8)",
  raised: "rgba(44, 38, 110, 0.09)",
  ink: "#1d1c2b",
  "ink-dim": "rgba(29, 28, 43, 0.7)",
  focus: "#5b52e6",
  "focus-ink": "#ffffff",
  "focus-ink-dim": "rgba(255, 255, 255, 0.88)",
};

/** Page colour behind the wallpaper, per theme. */
export const PAGE_BG = { night: "#07080b", day: "#eee9f3" } as const;

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

/** Type sizes in use on the 1920x1080 page (CSS px), from glass.css. */
export const TYPE = {
  title: { size: 34, weight: 600, use: "Chip day, icon glyph" },
  row: { size: 32, weight: 600, use: "List card title" },
  label: { size: 28, weight: 400, use: "Avatar name" },
  meta: { size: 24, weight: 400, use: "Card meta and subtitle" },
  caption: { size: 22, weight: 400, use: "Tile caption, chip weekday" },
  small: { size: 19, weight: 400, use: "App name, tile subtitle" },
} as const;

/** The warm glow top right, "r,g,b": each app tints its backdrop (Nest and Cinema orange, Shows blue, Anime rose). */
export const TINTS = {
  orange: "255,90,38",
  blue: "90,140,255",
  rose: "236,64,122",
} as const;

export type TintName = keyof typeof TINTS;
