import { sizeGb } from "../lib/rules.ts";
import { audioLanguages } from "../lib/sourcepref.ts";
import { parseStreamInfo, type Stream } from "../lib/streams.ts";

/** Settings › Playback "Sources sheet order": grouped by quality, or the list's own order (providers' ranking). */
export type SheetOrder = "grouped" | "provider";

/** One line of the sources sheet: a section header (never focused) or a source. */
export type SheetItem =
  | { kind: "header"; key: string; label: string }
  | { kind: "row"; key: string; stream: Stream; best: boolean };

const SECTIONS = ["4K HDR", "4K", "1080p HDR", "1080p", "720p", "Other"] as const;

function sectionOf(s: Stream): (typeof SECTIONS)[number] {
  const p = parseStreamInfo(s);
  if (p.resolution === "4K") return p.hdr ? "4K HDR" : "4K";
  if (p.resolution === "1080p") return p.hdr ? "1080p HDR" : "1080p";
  if (p.resolution === "720p") return "720p";
  return "Other";
}

/**
 * The sheet's lines. Grouped: "Best for this TV" with the source autoplay would start, then a section per quality with
 * its count ("4K HDR · 12"), the largest file first in each, sizes the source does not say after, and sources that
 * failed recently or are provider messages last. Provider order: the list as it is, with no headers.
 */
export function sheetRows(
  streams: readonly Stream[],
  { best, order = "grouped", isLow = () => false }: { best?: Stream; order?: SheetOrder; isLow?: (s: Stream) => boolean },
): SheetItem[] {
  const key = (s: Stream, i: number) => `${i}:${s.url}`;
  const indexed = streams.map((s, i) => ({ s, i }));
  if (order === "provider") return indexed.map(({ s, i }) => ({ kind: "row", key: key(s, i), stream: s, best: s === best }));
  const items: SheetItem[] = [];
  const top = indexed.find(({ s }) => s === best);
  if (top) {
    items.push({ kind: "header", key: "h:best", label: "Best for this TV" });
    items.push({ kind: "row", key: key(top.s, top.i), stream: top.s, best: true });
  }
  for (const section of SECTIONS) {
    const rows = indexed
      .filter(({ s }) => s !== best && sectionOf(s) === section)
      .map((x) => ({ ...x, gb: sizeGb(x.s), low: isLow(x.s) || Boolean(x.s.notice) }))
      .sort((a, b) => Number(a.low) - Number(b.low) || (b.gb ?? -1) - (a.gb ?? -1) || a.i - b.i);
    if (!rows.length) continue;
    items.push({ kind: "header", key: `h:${section}`, label: `${section} · ${rows.length}` });
    for (const { s, i } of rows) items.push({ kind: "row", key: key(s, i), stream: s, best: false });
  }
  return items;
}

/** The positions in `items` that can take focus (the sources, not the headers). */
export const focusable = (items: readonly SheetItem[]) =>
  items.flatMap((it, i) => (it.kind === "row" ? [i] : []));

/**
 * A filter chip above the sheet's list. Verified exists only when some sources are and some are not; Audio chips only
 * for languages some source announces.
 */
export type Filter = "no-hdr" | "mp4" | "cached" | "verified" | `audio:${string}`;

const LANG_NAMES: Record<string, string> = { en: "EN", fr: "FR", it: "IT", es: "ES", de: "DE", ja: "JA", multi: "Multi" };

export const filterLabel = (f: Filter) =>
  f === "no-hdr"
    ? "HDR off"
    : f === "mp4"
      ? "MP4 only"
      : f === "cached"
        ? "Cached only"
        : f === "verified"
          ? "✔ Verified"
          : `Audio ${LANG_NAMES[f.slice(6)] ?? f.slice(6).toUpperCase()}`;

/** The right title and episode from a trusted source, as its provider says (`_meta`). */
export const isVerified = (s: Stream) => s.meta?.verified === true;

/**
 * A source's audio languages: what its provider names (`_meta`, with "multi" when it says so), else what the text
 * announces (lib/sourcepref.ts).
 */
export function sourceLanguages(s: Stream): string[] {
  const l = s.meta?.langs;
  if (!l || (!l.audio.length && !l.multi)) return audioLanguages(s);
  return [...new Set([...l.audio, ...(l.multi ? ["multi"] : [])])].sort();
}

/** Cached on a debrid service: a debrid source, or one a provider marks with ⚡ or a [TB]/[PM]-style tag. */
const isCached = (s: Stream) => s.url.startsWith("debrid:") || /⚡|\[(?:TB|PM|RD|AD)\+?\]/.test(`${s.name} ${s.title}`);

/**
 * The chips for this list: the three fixed ones, Verified when it would hide some sources but not all, then Audio for
 * up to three languages, the most common first.
 */
export function filterChips(streams: readonly Stream[], languages: (s: Stream) => string[]): Filter[] {
  const verified = streams.filter(isVerified).length;
  const verifiedChip: Filter[] = verified && verified < streams.length ? ["verified"] : [];
  const count = new Map<string, number>();
  for (const s of streams) for (const l of languages(s)) count.set(l, (count.get(l) ?? 0) + 1);
  const langs = [...count]
    .filter(([, n]) => n < streams.length)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([l]) => `audio:${l}` as Filter);
  return ["no-hdr", "mp4", "cached", ...verifiedChip, ...langs];
}

/** The sources the chips keep, and how many they hide. */
export function applyFilters(
  streams: readonly Stream[],
  on: ReadonlySet<Filter>,
  languages: (s: Stream) => string[],
): { kept: Stream[]; hidden: number } {
  if (!on.size) return { kept: [...streams], hidden: 0 };
  const kept = streams.filter((s) => {
    const p = parseStreamInfo(s);
    for (const f of on) {
      if (f === "no-hdr" && p.hdr) return false;
      if (f === "mp4" && p.container !== "MP4") return false;
      if (f === "cached" && !isCached(s)) return false;
      if (f === "verified" && !isVerified(s)) return false;
      if (f.startsWith("audio:") && !languages(s).includes(f.slice(6))) return false;
    }
    return true;
  });
  return { kept, hidden: streams.length - kept.length };
}
