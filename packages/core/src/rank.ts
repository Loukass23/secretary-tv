import { type DeviceCaps, defaultCaps, playsCodec } from "./caps.ts";

export interface ParsedRelease {
  resolution: 2160 | 1080 | 720 | 480 | null;
  hdr: boolean;
  dolbyVision: boolean;
  codec: "hevc" | "av1" | "h264" | null;
  audio: "ddp" | "aac" | "dts" | "truehd" | null;
}

export interface Candidate {
  hash: string;
  name: string;
  cached: boolean;
  seeders?: number;
}

export function parseRelease(name: string): ParsedRelease {
  const n = name.toLowerCase();
  const res = /\b(2160p|4k|uhd)\b/.test(n)
    ? 2160
    : /\b1080p\b/.test(n)
      ? 1080
      : /\b720p\b/.test(n)
        ? 720
        : /\b480p\b/.test(n)
          ? 480
          : null;
  const codec = /\b(hevc|x265|h\.?265)\b/.test(n)
    ? "hevc"
    : /\bav1\b/.test(n)
      ? "av1"
      : /\b(x264|h\.?264|avc)\b/.test(n)
        ? "h264"
        : null;
  const audio = /\b(ddp|dd\+|eac3|e-ac-?3)\b/.test(n)
    ? "ddp"
    : /\baac\b/.test(n)
      ? "aac"
      : /\btruehd\b/.test(n)
        ? "truehd"
        : /\bdts\b/.test(n)
          ? "dts"
          : null;
  return {
    resolution: res,
    hdr: /\bhdr(10)?\b/.test(n),
    dolbyVision: /\b(dv|dovi|dolby[ .]?vision)\b/.test(n),
    codec,
    audio,
  };
}

/** Cyrillic, Arabic/Hebrew, Thai, Japanese kana, CJK ideographs and Hangul. */
const OTHER_SCRIPTS = /[Ѐ-ӿ֐-ۿ฀-๿぀-ヿ一-鿿가-힯]/;

/** TV-oriented score: cached first, then resolution, then codecs the panel plays well (`caps`, core/caps.ts). */
export function score(c: Candidate, caps: DeviceCaps = defaultCaps): number {
  const p = parseRelease(c.name);
  let s = c.cached ? 10_000 : 0;
  s += (p.resolution ?? 0) / 2;
  if (p.codec === "hevc" && caps.has("hevc")) s += 50;
  // A codec the TV cannot decode: AVPlay never leaves prepare for AV1 on the reference TV (docs/lessons.md).
  if (!playsCodec(p.codec, caps)) s -= 1000;
  if (p.audio === "ddp" || p.audio === "aac") s += 30;
  if ((p.audio === "dts" || p.audio === "truehd") && !caps.has(p.audio)) s -= 40;
  if (p.dolbyVision && !p.hdr && !caps.has("dv")) s -= 100;
  // Releases titled in Cyrillic, CJK and similar scripts are usually dubs with other-language audio.
  if (OTHER_SCRIPTS.test(c.name)) s -= 700;
  // Anime batches: dual or multi audio keeps both the original and an English track.
  if (/\b(?:dual|multi)[ ._-]?audio\b/i.test(c.name)) s += 40;
  s += Math.min(c.seeders ?? 0, 100) / 10;
  return s;
}

export function rank(candidates: Candidate[], caps: DeviceCaps = defaultCaps): Candidate[] {
  return [...candidates].sort((a, b) => score(b, caps) - score(a, caps));
}
