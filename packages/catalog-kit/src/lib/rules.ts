import { type DeviceCaps, defaultCaps, playsCodec } from "@secretary/core";
import { parseStreamInfo, type Stream } from "./streams.ts";

/**
 * What autoplay may pick (Settings › Playback and › Sources). Size limits are preferences, never filters: a source
 * outside them only goes after those inside. Require is the one hard rule, and only for autoplay: the sheet lists
 * everything, and when nothing matches the viewer picks there.
 */
export interface Rules {
  /** Only sources matching this are autoplay's to pick; when none does, the viewer picks in the sheet. */
  require?: RegExp | null;
  /** Sources matching this go before the others. */
  prefer?: RegExp | null;
  /** In GB; null is no limit. */
  maxSizeGb?: number | null;
  minSizeGb?: number | null;
  /** Provider (scraper) ids, most wanted first; providers not listed come after, in their own order. */
  providerOrder?: readonly string[];
  /** Sources that failed recently (lib/deadlinks.ts) go after the rest. */
  isDead?: (s: Stream) => boolean;
  /** What the TV decodes (lib/device.ts); a codec outside it ranks as no resolution. The reference TV's by default. */
  caps?: DeviceCaps;
  /** Settings › Playback languages: sources whose provider names their languages (`_meta`) are ranked by them. */
  langs?: { audio: readonly string[]; subs: readonly string[] };
}

/**
 * How well a source's languages fit, lower first, from its provider's `_meta` only, so a provider that does not say
 * ranks as it always did: a wanted audio language by its place in the list, then subtitles in a wanted language, then
 * a source that names no language (the same place as one without `_meta`), then one in other languages only.
 */
export function langRank(s: Stream, langs: Rules["langs"]): number {
  const l = s.meta?.langs;
  if (!langs?.audio.length && !langs?.subs.length) return 0;
  const audio = langs?.audio ?? [];
  const neutral = audio.length + 1;
  if (!l || (!l.audio.length && !l.subs.length)) return neutral;
  const at = audio.findIndex((a) => l.audio.includes(a));
  if (at >= 0) return at;
  if (langs?.subs.some((x) => l.subs.includes(x))) return audio.length;
  return neutral + 1;
}

/**
 * A pattern typed in Settings, matched case-insensitively against a source's name and title ("MULTI|DUAL", "REMUX").
 * Empty is no pattern; one that is not a valid regular expression is ignored, and Settings says so.
 */
export function compilePattern(src: string | null | undefined): RegExp | null | "invalid" {
  const text = (src ?? "").trim();
  if (!text) return null;
  try {
    return new RegExp(text, "i");
  } catch {
    return "invalid";
  }
}

export const patternLabel = (src: string | null | undefined) => {
  const p = compilePattern(src);
  return p === null ? "None" : p === "invalid" ? `“${src}” is not a valid pattern, ignored` : `“${src}”`;
};

const textOf = (s: Stream) => `${s.name} ${s.title}`;
/** True when autoplay may pick a source: it is no provider notice, and it passes Require (always, without one). */
export const inScope = (s: Stream, rules: Rules = {}) => !s.notice && (!rules.require || rules.require.test(textOf(s)));

export const SIZE_STEPS_GB: readonly (number | null)[] = [null, 2, 4, 8, 15, 30];
export const sizeLabel = (gb: number | null | undefined) => (gb == null ? "None" : `${gb} GB`);

const TIER: Record<string, number> = { "4K": 4, "1080p": 3, "720p": 2, SD: 1 };

/** "12.3 GB" or "700 MB" from a source's text, in GB; null when it does not say. */
export function sizeGb(s: Stream): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(GB|MB)/i.exec(parseStreamInfo(s).size ?? "");
  if (!m) return null;
  return Number(m[1]) / (m[2].toUpperCase() === "MB" ? 1024 : 1);
}

/**
 * The order autoplay tries sources in. Each step only breaks ties left by the one before:
 * 1. real sources that match Require (provider notices never autoplay);
 * 2. sources that have not failed recently;
 * 3. sources that match Prefer;
 * 4. sources their provider verified (the right title and episode, from a trusted source; `_meta`);
 * 5. the viewer's languages (langRank; only for providers that send `_meta`);
 * 6. inside the size limits (a source that does not say its size counts as inside);
 * 7. the best resolution, a codec the TV cannot decode last (AVPlay never prepares AV1 on the reference TV);
 * 8. the user's provider order;
 * 9. the list's own order, which is the providers' own ranking.
 * The first source is what autoplay plays; the rest are the failover queue.
 */
export function rankSources<T extends Stream>(list: readonly T[], rules: Rules = {}): T[] {
  const { maxSizeGb, minSizeGb, prefer, providerOrder = [], isDead = () => false, caps = defaultCaps, langs } = rules;
  const keyed = list.map((s, i) => {
    const p = parseStreamInfo(s);
    const inSize = inLimits(s, { maxSizeGb, minSizeGb });
    const pos = s.provider ? providerOrder.indexOf(s.provider) : -1;
    return {
      s,
      keys: [
        inScope(s, rules) ? 0 : 1,
        isDead(s) ? 1 : 0,
        !prefer || prefer.test(textOf(s)) ? 0 : 1,
        s.meta?.verified ? 0 : 1,
        langRank(s, langs),
        inSize ? 0 : 1,
        -(playsCodec(p.codec, caps) ? TIER[p.resolution] : 0),
        pos < 0 ? providerOrder.length : pos,
        i,
      ],
    };
  });
  keyed.sort((a, b) => {
    for (let k = 0; k < a.keys.length; k++) if (a.keys[k] !== b.keys[k]) return a.keys[k] - b.keys[k];
    return 0;
  });
  return keyed.map((x) => x.s);
}

/** Index in `list` of the source autoplay would play under `rules`, or -1 for an empty list. */
export function pickIndex(list: readonly Stream[], rules: Rules = {}): number {
  const first = rankSources(list, rules)[0];
  return first ? list.indexOf(first) : -1;
}

/** True when a source is inside the size limits: what lets a 4K source start before the wait is over. */
export function inLimits(s: Stream, rules: Rules = {}): boolean {
  const gb = sizeGb(s);
  return gb == null || ((rules.maxSizeGb == null || gb <= rules.maxSizeGb) && (rules.minSizeGb == null || gb >= rules.minSizeGb));
}
