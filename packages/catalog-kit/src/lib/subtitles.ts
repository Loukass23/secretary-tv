// Subtitles from addons, drawn by the page. AVPlay cannot take them: on the reference TV setExternalSubtitlePath answers
// PLAYER_ERROR_INVALID_PARAMETER for every form of path, remote or local (docs/lessons.md), and selecting a TEXT track
// is forbidden. So the file is fetched, read into cues, and the cue for the player's position is shown over the video.
import { langName } from "../player/tracks.ts";
import type { Subtitle } from "./addons.ts";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const MAX_BYTES = 1_500_000;
const FETCH_MS = 8000;

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&lrm;": "", "&rlm;": "" };

/** Markup out of a cue's text: tags, {\an8} style overrides and the common entities. */
export function cleanCue(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp|lrm|rlm);/g, (e) => ENTITIES[e] ?? e)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** Cues from SubRip or WebVTT text, in time order. A block that does not parse is skipped, never fatal. */
export function parseCues(raw: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of raw.replace(/^﻿/, "").split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((l) => TIME.test(l));
    if (at < 0) continue;
    const m = TIME.exec(lines[at])!;
    // The hours group is optional in WebVTT, so the groups shift by one each side: read them by position.
    const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
    const end = Number(m[5] ?? 0) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8].padEnd(3, "0")) / 1000;
    const text = cleanCue(lines.slice(at + 1).join("\n"));
    if (text && end > start) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue showing at `pos` (seconds, the delay already added), or -1. Cues may overlap; the first that fits wins. */
export function cueAt(cues: readonly Cue[], pos: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= pos) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // An earlier, longer cue can still cover `pos`: look back a few.
  for (let i = found; i >= 0 && i > found - 4; i--) if (pos < cues[i].end) return i;
  return -1;
}

/** Downloads and reads one subtitle file; rejects when it is too big, slow or empty. */
export async function loadCues(url: string, f: typeof fetch = fetch): Promise<Cue[]> {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), FETCH_MS);
  try {
    const res = await f(url, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) throw new Error(`subtitle ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("subtitle file too big");
    const cues = parseCues(text);
    if (!cues.length) throw new Error("no subtitle lines in that file");
    return cues;
  } finally {
    clearTimeout(timer);
  }
}

export interface SubChoice {
  /** The language's name, or its code, for the list. */
  label: string;
  /** Two-letter code where known: what carries to the next episode. */
  lang: string;
  subs: Subtitle[];
}

/** Subtitles grouped by language, the viewer's preferred languages first, then A to Z; undetermined last. */
export function groupSubtitles(subs: readonly Subtitle[], preferred: readonly string[] = []): SubChoice[] {
  const groups = new Map<string, SubChoice>();
  for (const s of subs) {
    const n = langName(s.lang);
    const key = n.code || s.lang.toLowerCase();
    const g = groups.get(key) ?? { label: n.name || (s.lang === "und" ? "Unknown" : s.lang.toUpperCase()), lang: n.code, subs: [] };
    g.subs.push(s);
    groups.set(key, g);
  }
  const rank = (g: SubChoice) => (g.lang === "" ? 2 : preferred.includes(g.lang) ? 0 : 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? preferred.indexOf(a.lang) - preferred.indexOf(b.lang) : a.label.localeCompare(b.label)));
}

export const SUB_SIZES = [80, 100, 125, 150, 200] as const;
export const DELAY_STEP = 0.5;
export const MAX_DELAY = 30;
export const delayLabel = (d: number) => (d === 0 ? "In sync" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} s`);

/** The viewer's subtitle language, kept for the next episode in this session; null is off. */
let chosen: string | null = null;
export const chosenSubLang = (): string | null => chosen;
export const rememberSubLang = (lang: string | null): void => void (chosen = lang);
