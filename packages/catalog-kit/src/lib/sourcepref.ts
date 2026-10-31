import { parseStreamInfo, type Stream } from "./streams.ts";

/**
 * The source the viewer chose for a title, remembered so the next play (and the next episode) starts with the same kind
 * of release: same group, same audio. A pick made by hand in the sheet goes in the manual table; an automatic pick that
 * played for a few seconds, in the automatic one. Manual wins.
 */
export interface SourcePref {
  /** The provider's binge group, when it sends one. */
  group?: string;
  /** The release's name with the episode cut off ("Show.S01E02.1080p-GRP.mkv" → "show."), for series. */
  releaseKey?: string;
  /** Resolution, origin, codec, HDR and release group, read from the text. */
  fingerprint: string;
  /** Audio languages read from the text ("en", "fr", "multi"). */
  audio: string[];
  provider?: string;
  name: string;
  resolution: string;
  at: number;
}

export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

type Tables = { manual: Record<string, SourcePref>; auto: Record<string, SourcePref> };

const KEY = "sectv.sourcepref.v1";
const MAX_TITLES = 200;
export const PREF_TTL_MS = 180 * 24 * 3600_000;

/** "tt0944947:1:2" and "kitsu:7442:5" are remembered under the show: "tt0944947", "kitsu:7442". */
export function titleKey(id: string): string {
  const parts = id.split(":");
  if (/^tt\d+$/.test(parts[0])) return parts[0];
  return parts.length > 1 && /^[a-z]+$/.test(parts[0]) ? `${parts[0]}:${parts[1]}` : parts[0];
}

const textOf = (s: Stream) => `${s.name} ${s.title} ${s.file ?? ""}`;

/** The release name with the episode marker and everything after it cut off; "1280x720" is not a marker. */
export function releaseKey(s: Pick<Stream, "title" | "file">): string | undefined {
  const name = (s.file ?? s.title.split(/\r?\n/)[0] ?? "").trim();
  const m = /(?:\bS\d{1,2}[ ._-]?E\d{1,3}|(?<![\dx])\b\d{1,2}x\d{2,3}\b(?!\d))/i.exec(name);
  return m ? name.slice(0, m.index).toLowerCase() : undefined;
}

/** Flag emoji are two regional indicators: 🇫🇷 → "fr", 🇬🇧 → "gb" (counted as "en"). */
const FLAG = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/gu;
const LANG_WORDS: [RegExp, string][] = [
  [/\b(?:multi|dual[ ._-]?audio|dual)\b/i, "multi"],
  [/\b(?:vff|vfq|vf2?|truefrench|french)\b/i, "fr"],
  [/\b(?:eng|english)\b/i, "en"],
  [/\b(?:ita|italian)\b/i, "it"],
  [/\b(?:spa|spanish|esp|castellano|latino)\b/i, "es"],
  [/\b(?:ger|german|deutsch)\b/i, "de"],
  [/\b(?:jpn|japanese)\b/i, "ja"],
];

/** The audio languages a source's text announces. */
export function audioLanguages(s: Stream): string[] {
  const text = textOf(s);
  const out = new Set<string>();
  for (const [, a, b] of text.matchAll(FLAG)) {
    const code = String.fromCharCode(a.codePointAt(0)! - 0x1f1e6 + 97, b.codePointAt(0)! - 0x1f1e6 + 97);
    out.add(code === "gb" || code === "us" ? "en" : code);
  }
  for (const [re, code] of LANG_WORDS) if (re.test(text)) out.add(code);
  return [...out].sort();
}

const ORIGIN = /\b(remux|blu-?ray|web-?dl|webrip|hdtv|dvdrip|hdrip|cam)\b/i;
/** "-GROUP" at the end of a release name, before its extension. */
const GROUP = /-([a-z0-9]{2,15})(?:\.(?:mkv|mp4|avi|ts|m4v))?\s*$/i;

/** What makes two sources the same kind of release: group, resolution, origin, codec, HDR. */
export function fingerprint(s: Stream): string {
  const p = parseStreamInfo(s);
  const name = (s.file ?? s.title.split(/\r?\n/)[0] ?? "").trim();
  const origin = ORIGIN.exec(textOf(s))?.[1]?.toLowerCase().replace("-", "") ?? "";
  const group = GROUP.exec(name)?.[1]?.toLowerCase() ?? "";
  return [group, p.resolution, origin, p.codec ?? "", p.hdr ?? ""].join("|");
}

export function prefOf(s: Stream, now: number): SourcePref {
  return {
    ...(s.group ? { group: s.group } : {}),
    ...(releaseKey(s) ? { releaseKey: releaseKey(s) } : {}),
    fingerprint: fingerprint(s),
    audio: audioLanguages(s),
    ...(s.provider ? { provider: s.provider } : {}),
    name: s.name,
    resolution: parseStreamInfo(s).resolution,
    at: now,
  };
}

/**
 * The candidate that is the same kind of release as `pref`, or -1. A candidate must keep every remembered audio
 * language, and must share the group, or the provider and the fingerprint, or the provider and the audio. Among those,
 * the closest wins, step by step: group, provider and fingerprint, provider and audio, then release key, name and
 * resolution.
 */
/** Lexicographic: the first step that differs decides. */
const compare = (a: readonly number[], b: readonly number[]) => {
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] - b[j];
  return 0;
};

export function matchPref(
  pref: SourcePref,
  candidates: readonly Stream[],
  /** Sources that failed recently (lib/deadlinks.ts) are never the match: the next closest is. */
  isDead: (s: Stream) => boolean = () => false,
): number {
  let best = -1;
  let bestKeys: number[] = [];
  candidates.forEach((s, i) => {
    if (s.notice || isDead(s)) return;
    const audio = audioLanguages(s);
    if (!pref.audio.every((a) => audio.includes(a))) return;
    const sameProvider = Boolean(pref.provider) && s.provider === pref.provider;
    const group = pref.group != null && s.group === pref.group ? 1 : 0;
    const print = sameProvider && fingerprint(s) === pref.fingerprint ? 1 : 0;
    const voice = sameProvider && audio.join() === pref.audio.join() ? 1 : 0;
    if (!group && !print && !voice) return;
    const keys = [
      group,
      print,
      voice,
      pref.releaseKey != null && releaseKey(s) === pref.releaseKey ? 1 : 0,
      s.name === pref.name ? 1 : 0,
      parseStreamInfo(s).resolution === pref.resolution ? 1 : 0,
    ];
    if (best < 0 || compare(keys, bestKeys) > 0) {
      best = i;
      bestKeys = keys;
    }
  });
  return best;
}

export function createSourcePrefs(kv: KV, now: () => number = Date.now) {
  /** A time in the future or zero (a TV that booted with a wrong clock) still counts; only old entries expire. */
  const fresh = (p: SourcePref) => p.at <= 0 || p.at > now() || now() - p.at < PREF_TTL_MS;
  const load = (): Tables => {
    const t = kv.get<Tables>(KEY) ?? { manual: {}, auto: {} };
    return { manual: t.manual ?? {}, auto: t.auto ?? {} };
  };
  const capped = (table: Record<string, SourcePref>) =>
    Object.fromEntries(
      Object.entries(table)
        .filter(([, p]) => fresh(p))
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, MAX_TITLES),
    );

  return {
    /** The viewer's pick for this title: their own from the sheet first, else an automatic one that played. */
    recall(id: string): SourcePref | null {
      const t = load();
      const k = titleKey(id);
      for (const p of [t.manual[k], t.auto[k]]) if (p && fresh(p)) return p;
      return null;
    },
    remember(kind: "manual" | "auto", id: string, s: Stream): void {
      const t = load();
      const k = titleKey(id);
      t[kind] = capped({ ...t[kind], [k]: prefOf(s, now()) });
      // A pick by hand replaces what autoplay had learned for the title.
      if (kind === "manual") delete t.auto[k];
      kv.set(KEY, t);
    },
    forget(id: string): void {
      const t = load();
      const k = titleKey(id);
      delete t.manual[k];
      delete t.auto[k];
      kv.set(KEY, t);
    },
  };
}

export type SourcePrefs = ReturnType<typeof createSourcePrefs>;
