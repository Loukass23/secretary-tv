// The Secretary line icons: one set for every app, drawn on a 24px grid with a 2px round stroke and shown by
// Icon (controls.tsx) as a one-colour mask in the text colour around them (currentColor), so a focused button
// switches their ink with its text. Emoji and text glyphs differ in size, weight and colour from one TV to the next; these
// don't. Each mask is made once per icon and drawn by the compositor like any image.

/** Weather, as Nest's forecast names it (WeatherGlyph in @secretary/assistant). */
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
const MOON = '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>';
const CLOUD = '<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 18.5z"/>';
const SMALL_SUN = '<circle cx="8" cy="8" r="3"/><path d="M8 1.8v1.4M1.8 8h1.4M3.6 3.6l1 1M12.4 3.6l-1 1"/>';
const SMALL_MOON = '<path d="M11 9.6A4.6 4.6 0 1 1 6.4 3.5a3.6 3.6 0 0 0 4.6 6.1z"/>';
const HIGH_CLOUD = '<path d="M9 19.5h9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1A3.1 3.1 0 0 0 9 19.5z"/>';
const RAIN_CLOUD = '<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 14.5z"/>';

export const ICON_PATHS = {
  // --- actions ---
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  lights: '<path d="M9.5 17.5h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v1.6h5v-1.6c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
  party: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  settings: '<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  sync: '<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 18.5z"/><path d="M10 14.5l2 2 3.5-4"/>',
  // --- weather ---
  clear: SUN,
  "clear-night": MOON,
  partly: SMALL_SUN + HIGH_CLOUD,
  "partly-night": SMALL_MOON + HIGH_CLOUD,
  cloud: CLOUD,
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
  rain: RAIN_CLOUD + '<path d="M9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5"/>',
  snow: RAIN_CLOUD + '<path d="M9 18.5h.01M13 20h.01M17 18.5h.01M11 21.5h.01M15 21.5h.01"/>',
  storm: RAIN_CLOUD + '<path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** The stroke every icon is drawn with: 2px on the 24px grid (about 2.8px on screen at 34px). */
export const ICON_STROKE = 2;

const STROKE = `fill="none" stroke="#000" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
const MASKS = new Map<IconName, string>();

/** The icon as a CSS mask image, made once per icon. */
export function iconMask(name: IconName): string {
  let m = MASKS.get(name);
  if (!m) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${STROKE}>${ICON_PATHS[name]}</svg>`;
    m = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    MASKS.set(name, m);
  }
  return m;
}
