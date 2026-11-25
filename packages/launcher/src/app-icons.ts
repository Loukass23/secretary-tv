// The Apps card's icons. The TV reports an icon path for every app, but for some (YouTube and Samsung Workspace on the
// reference TV, screen 19 of the 25 Nov review) it is the system's generic placeholder. Those apps get their own icon,
// drawn here as small inline SVGs (no network); an app whose reported icon is a placeholder and that is not known
// here shows its initial (glass AppChip's letter) rather than a stranger's pinwheel. Pure, so it is unit tested.
import { YOUTUBE_APP_ID } from "./config.ts";

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${body}</svg>`)}`;

/** YouTube: the red rounded play button on white. */
const YOUTUBE = svg(
  `<rect width="80" height="80" rx="18" fill="#fff"/>` +
    `<rect x="12" y="22" width="56" height="38" rx="11" fill="#ff0033"/>` +
    `<path d="M35 32v18l15-9z" fill="#fff"/>`,
);
/** Samsung Workspace: a blue tile with a white screen and a keyboard line under it. */
const WORKSPACE = svg(
  `<rect width="80" height="80" rx="18" fill="#1d5bd8"/>` +
    `<rect x="17" y="21" width="46" height="30" rx="4" fill="none" stroke="#fff" stroke-width="4.5"/>` +
    `<path d="M30 59h20" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>`,
);

/** Apps known by name (the TV's own spelling varies a little), with their icon. */
const BY_NAME: readonly [RegExp, string][] = [
  [/^youtube$/i, YOUTUBE],
  [/^(?:samsung\s+)?workspace$/i, WORKSPACE],
];

/** The system's stand-in icons: a "default" or "noicon" image, or nothing at all. */
const PLACEHOLDER = /(?:^|[/_.-])(?:default|noicon|no_icon|unknown)(?:[/_.-]|$)|tizen[_-]?(?:logo|default)/i;

/** Whether a reported icon path is the system's generic placeholder (or missing). */
export const isPlaceholderIcon = (path: string | undefined): boolean => !path || PLACEHOLDER.test(path);

/**
 * The icon the Apps card shows for an app: the app's own for the apps known here (their reported icon is a placeholder
 * on the TV), else the reported one, else none (the card shows the app's initial).
 */
export function appIcon(app: { id: string; name: string; iconPath?: string }): string | undefined {
  if (app.id === YOUTUBE_APP_ID) return YOUTUBE;
  const known = BY_NAME.find(([re]) => re.test(app.name.trim()));
  if (known) return known[1];
  return isPlaceholderIcon(app.iconPath) ? undefined : app.iconPath;
}
