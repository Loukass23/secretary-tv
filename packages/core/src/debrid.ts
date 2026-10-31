import { type EpisodeHint, pickFile } from "./files.ts";
import { createPremiumize } from "./premiumize.ts";
import { createTorbox } from "./torbox.ts";

export type DebridId = "tb" | "pm";

/** A debrid service the same way for TorBox and Premiumize: what is cached, and a playable link for one. */
export interface Debrid {
  id: DebridId;
  label: string;
  checkCached(hashes: string[]): Promise<Set<string>>;
  /** A short-lived CDN link to the file to play, or null when the torrent holds none. */
  resolve(infoHash: string, fileIdx: number | undefined, hint: EpisodeHint | null): Promise<string | null>;
}

export const DEBRID_LABELS: Record<DebridId, string> = { tb: "TorBox", pm: "Premiumize" };

export function torboxDebrid(apiKey: string, f: typeof fetch = fetch): Debrid {
  const tb = createTorbox({ apiKey, fetch: f });
  return {
    id: "tb",
    label: DEBRID_LABELS.tb,
    checkCached: (hashes) => tb.checkCached(hashes),
    async resolve(hash, fileIdx, hint) {
      const torrentId = await tb.createTorrent(hash);
      const file = pickFile(await tb.listFiles(torrentId), fileIdx, hint);
      return file ? tb.requestDownload(torrentId, file.id) : null;
    },
  };
}

export function premiumizeDebrid(apiKey: string, f: typeof fetch = fetch): Debrid {
  const pm = createPremiumize({ apiKey, fetch: f });
  return {
    id: "pm",
    label: DEBRID_LABELS.pm,
    checkCached: (hashes) => pm.checkCached(hashes),
    async resolve(hash, fileIdx, hint) {
      // directdl has no file ids: index the list so pickFile can use its position as one.
      const files = (await pm.directFiles(hash)).map((x, id) => ({ id, name: x.path, size: x.size, link: x.link }));
      return pickFile(files, fileIdx, hint)?.link ?? null;
    },
  };
}

/** The services with a key, in the user's order. */
export function debridServices(
  keys: Partial<Record<DebridId, string>>,
  order: readonly DebridId[] = ["tb", "pm"],
  f: typeof fetch = fetch,
): Debrid[] {
  const make = { tb: torboxDebrid, pm: premiumizeDebrid };
  return order.filter((id) => keys[id]?.trim()).map((id) => make[id](keys[id]!.trim(), f));
}
