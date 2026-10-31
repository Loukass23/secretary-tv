const API = "https://api.torbox.app/v1/api";

export interface TorboxOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export interface CloudTorrent {
  id: number;
  hash: string;
  name: string;
  size: number;
  files: { id: number; name: string; size: number }[];
}

export function createTorbox({ apiKey, fetch: f = fetch }: TorboxOptions) {
  const headers = { Authorization: `Bearer ${apiKey}` };

  async function json<T>(url: string): Promise<T> {
    const res = await f(url, { headers });
    if (!res.ok) throw new Error(`TorBox ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    /** Adds a magnet (no-op if TorBox already has it) and returns the torrent id. */
    async createTorrent(infoHash: string): Promise<number> {
      const form = new FormData();
      form.set("magnet", `magnet:?xt=urn:btih:${infoHash}`);
      const res = await f(`${API}/torrents/createtorrent`, {
        method: "POST",
        headers,
        body: form,
      });
      if (!res.ok) throw new Error(`TorBox ${res.status}`);
      const body = (await res.json()) as { data?: { torrent_id?: number } };
      const id = body.data?.torrent_id;
      if (id == null) throw new Error("TorBox returned no torrent id");
      return id;
    },

    /** Active cached torrents in the user's TorBox cloud library. */
    async listCloud(): Promise<CloudTorrent[]> {
      const body = await json<{
        data?: {
          id?: number;
          hash?: string;
          name?: string;
          size?: number;
          download_present?: boolean;
          files?: { id: number; name: string; size: number }[];
        }[];
      }>(`${API}/torrents/mylist`);
      return (body.data ?? [])
        .filter((t) => t.id != null && t.hash && t.name && t.download_present !== false)
        .map((t) => ({
          id: t.id!,
          hash: t.hash!.toLowerCase(),
          name: t.name!,
          size: t.size ?? 0,
          files: t.files ?? [],
        }));
    },

    /** Files of a torrent, in TorBox's own file-id space. */
    async listFiles(torrentId: number): Promise<{ id: number; name: string; size: number }[]> {
      const body = await json<{ data?: { files?: { id: number; name: string; size: number }[] } }>(
        `${API}/torrents/mylist?id=${torrentId}`,
      );
      return body.data?.files ?? [];
    },

    /** Short-lived CDN URL for one file. */
    async requestDownload(torrentId: number, fileId: number): Promise<string> {
      const qs = new URLSearchParams({
        token: apiKey,
        torrent_id: String(torrentId),
        file_id: String(fileId),
      });
      const body = await json<{ data?: string }>(`${API}/torrents/requestdl?${qs}`);
      if (!body.data) throw new Error("TorBox returned no download link");
      return body.data;
    },

    /** Which of these info-hashes are already cached on TorBox. */
    async checkCached(hashes: string[]): Promise<Set<string>> {
      if (hashes.length === 0) return new Set();
      const out = new Set<string>();
      const BATCH = 100;
      for (let i = 0; i < hashes.length; i += BATCH) {
        const chunk = hashes.slice(i, i + BATCH);
        const qs = new URLSearchParams({ hash: chunk.join(","), format: "list" });
        const body = await json<{ data?: { hash: string }[] | null }>(
          `${API}/torrents/checkcached?${qs}`,
        );
        for (const t of body.data ?? []) out.add(t.hash.toLowerCase());
      }
      return out;
    },
  };
}
