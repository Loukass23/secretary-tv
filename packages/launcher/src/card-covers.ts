// What the folded Cinema, Shows and Anime cards show: a few titles from what is in progress and tonight's picks,
// changing from visit to visit (and every few minutes while the home rests) instead of always the last two played.
// No title shows twice at once, on one card or across the cards.
import type { MediaItem } from "./cards.tsx";

/** One key per title: two ids for one show (an IMDb entry synced from a phone and a Kitsu entry played here) share
 *  their name, so the name, folded, is the key too. */
export const titleKeys = (t: { id: string; name: string }): string[] => {
  const name = t.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
  return name ? [t.id, `n:${name}`] : [t.id];
};

/** `list` with each title once: the first of two entries for one title (by id, or by name) stays. */
export function oneEach<T>(list: readonly T[], title: (t: T) => { id: string; name: string }): T[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const keys = titleKeys(title(t));
    if (keys.some((k) => seen.has(k))) return false;
    for (const k of keys) seen.add(k);
    return true;
  });
}

/**
 * The `count` titles a folded card shows on turn `turn`: the pool (in progress first, then the picks) without the
 * titles `used` by the cards before it, taken `count` at a time from a start that moves on each turn. The chosen
 * titles are added to `used`. A pool no larger than `count` shows whole, in its order.
 */
export function coverPicks<T>(
  pool: readonly T[],
  count: number,
  turn: number,
  used: Set<string>,
  title: (t: T) => { id: string; name: string },
): T[] {
  const free = oneEach(pool, title).filter((t) => !titleKeys(title(t)).some((k) => used.has(k)));
  let out: T[];
  if (free.length <= count) out = free;
  else {
    const start = (((turn * count) % free.length) + free.length) % free.length;
    out = Array.from({ length: count }, (_, k) => free[(start + k) % free.length]);
  }
  for (const t of out) for (const k of titleKeys(title(t))) used.add(k);
  return out;
}

/** The turn is kept between launches, so opening Secretary shows other titles than last time. */
export const COVER_TURN_KEY = "nest.coverTurn";
/** While the home rests (no media card focused or open), the covers move on this often. */
export const COVER_EVERY_MS = 5 * 60_000;

/**
 * What a landscape tile of `w` x `h` draws: a thumb with the logo painted in shows whole on a 16:9 tile, with no logo
 * or name over it; a tile of another shape would crop the painted title, so it takes the textless art and draws the
 * logo (or the name) itself. Never the logo twice.
 */
export function stillArt(it: Pick<MediaItem, "still" | "plain" | "poster" | "logo" | "stillHasLogo">, w: number, h: number): { src: string; logo?: string; painted: boolean } {
  const fits = Math.abs(w / h - 16 / 9) < 0.12;
  if (it.stillHasLogo && it.still && fits) return { src: it.still, painted: true };
  if (it.stillHasLogo) return { src: it.plain ?? it.still ?? it.poster, logo: it.logo, painted: false };
  return { src: it.still ?? it.poster, logo: it.logo, painted: false };
}
