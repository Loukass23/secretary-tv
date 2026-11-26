import type { AvplayTrack } from "./webapis.ts";

/** One audio track as the options menu lists it. */
export interface AudioTrackInfo {
  /** AVPlay's track index, what selectAudio takes. */
  index: number;
  /** "English · AC3 5.1", or "Track 2" when the file says nothing. */
  label: string;
  /** ISO 639-1 where known ("en"), else the raw code, else "". */
  lang: string;
}

/** How the picture fills the screen: the whole picture inside it, cropped to fill it, or stretched. */
export type AspectMode = "fit" | "fill" | "stretch";
export const ASPECTS: readonly AspectMode[] = ["fit", "fill", "stretch"];
export const ASPECT_LABEL: Record<AspectMode, string> = { fit: "Fit", fill: "Fill", stretch: "Stretch" };

/** ISO 639-2 (and a few 639-1) codes as audio tracks carry them, to the name and two-letter code of the app's languages. */
const LANGS: Record<string, [string, string]> = {
  eng: ["English", "en"], en: ["English", "en"],
  fra: ["French", "fr"], fre: ["French", "fr"], fr: ["French", "fr"],
  spa: ["Spanish", "es"], es: ["Spanish", "es"],
  deu: ["German", "de"], ger: ["German", "de"], de: ["German", "de"],
  ita: ["Italian", "it"], it: ["Italian", "it"],
  por: ["Portuguese", "pt"], pt: ["Portuguese", "pt"],
  jpn: ["Japanese", "ja"], ja: ["Japanese", "ja"],
  kor: ["Korean", "ko"], ko: ["Korean", "ko"],
  hin: ["Hindi", "hi"], hi: ["Hindi", "hi"],
  rus: ["Russian", "ru"], ru: ["Russian", "ru"],
  zho: ["Chinese", "zh"], chi: ["Chinese", "zh"], zh: ["Chinese", "zh"],
  ara: ["Arabic", "ar"], ar: ["Arabic", "ar"],
  nld: ["Dutch", "nl"], dut: ["Dutch", "nl"], nl: ["Dutch", "nl"],
  pol: ["Polish", "pl"], pl: ["Polish", "pl"],
  tur: ["Turkish", "tr"], tr: ["Turkish", "tr"],
};

/** A language's name and two-letter code from the code an audio track or an addon gives; empty strings when unknown. */
export function langName(code: string): { name: string; code: string } {
  const hit = LANGS[code.toLowerCase()];
  return { name: hit?.[0] ?? "", code: hit?.[1] ?? "" };
}

/** Reads a key of a track's extra_info JSON whatever its case; firmware differs. */
function field(extra: string, name: string): string {
  try {
    const o = JSON.parse(extra) as Record<string, unknown>;
    const hit = Object.entries(o).find(([k]) => k.toLowerCase() === name);
    return hit ? String(hit[1]).trim() : "";
  } catch {
    return "";
  }
}

const CODECS: Record<string, string> = { ac3: "AC3", eac3: "E-AC3", "ec-3": "E-AC3", dtsc: "DTS", dtsh: "DTS-HD", mp4a: "AAC", aac: "AAC", opus: "Opus", mp3: "MP3", flac: "FLAC" };
const CHANNELS: Record<string, string> = { "1": "mono", "2": "stereo", "6": "5.1", "8": "7.1" };

/** The audio tracks of a prepared source, numbered "Track n" in order when a file names none. */
export function audioTracks(tracks: readonly AvplayTrack[]): AudioTrackInfo[] {
  return tracks
    .filter((t) => t.type === "AUDIO")
    .map((t, n) => {
      const raw = field(t.extra_info, "language").toLowerCase();
      const known = raw && raw !== "und" && raw !== "unknown" ? LANGS[raw] : undefined;
      const codec = CODECS[field(t.extra_info, "fourcc").toLowerCase()] ?? "";
      const ch = CHANNELS[field(t.extra_info, "channels")] ?? "";
      const name = known?.[0] ?? (raw && raw !== "und" && raw !== "unknown" ? raw.toUpperCase() : `Track ${n + 1}`);
      return {
        index: t.index,
        label: [name, [codec, ch].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
        lang: known?.[1] ?? (raw && raw !== "und" ? raw : ""),
      };
    });
}

/** The track a language list prefers (most wanted first), or null when none matches: the file's own default then plays. */
export function preferredAudio(tracks: readonly AudioTrackInfo[], langs: readonly string[]): AudioTrackInfo | null {
  for (const l of langs) {
    const hit = tracks.find((t) => t.lang === l);
    if (hit) return hit;
  }
  return null;
}

/** The language of the track the viewer picked, kept for the next episode in this session (a new player starts with it). */
let chosenLang: string | null = null;
export const chosenAudioLang = (): string | null => chosenLang;
export const rememberAudioLang = (lang: string): void => void (chosenLang = lang || null);
