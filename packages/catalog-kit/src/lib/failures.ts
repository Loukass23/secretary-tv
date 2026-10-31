import type { Check } from "./verify.ts";

/**
 * Why a source did not play, in words for the sources sheet ("failed 12 min ago · server refused (403)"). The raw
 * text is a check's verdict (lib/verify.ts) or the player's error (player/avplay.ts, with AVPlay's error name).
 */
export function failureReason(raw: string): string {
  const status = /\((\d{3})\)/.exec(raw)?.[1];
  if (/^refused/.test(raw)) return status ? `server refused (${status})` : "server refused";
  if (/^warning clip/.test(raw)) return "a placeholder clip, not the film";
  if (/^not video/.test(raw)) return "not a video (a web page or an error)";
  if (/^no answer/.test(raw)) return "the server did not answer";
  if (/prepare timed out/.test(raw)) return "took too long to prepare";
  if (/no playable audio/.test(raw)) return "its audio cannot play on this TV";
  if (/no first frame/.test(raw)) return "never showed a picture";
  if (/CONNECTION|NETWORK/i.test(raw)) return "the connection failed";
  if (/NOT_SUPPORTED|UNSUPPORTED|INVALID_URI|INVALID_OPERATION/i.test(raw)) return "a format this TV cannot play";
  if (/no .* key in Settings/.test(raw)) return raw;
  if (/no playable file/.test(raw)) return "no video file in the torrent";
  const name = /PLAYER_ERROR_\w+/.exec(raw)?.[0];
  return name ? `player error (${name.replace("PLAYER_ERROR_", "").toLowerCase().replace(/_/g, " ")})` : "it would not play";
}

/** What a check found, as the raw text failureReason reads: the verdict, with the HTTP status when refused. */
export const checkFailure = (c: Pick<Check, "verdict" | "status">) =>
  c.verdict === "refused" && c.status ? `refused (${c.status})` : c.verdict;

/** A connection failure tells nothing about whose fault it was: a check of the link afterwards may say more. */
export const worthProbing = (raw: string) => /CONNECTION|NETWORK|prepare timed out/i.test(raw);

/** "just now", "12 min ago", "3 h ago". */
export function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}
