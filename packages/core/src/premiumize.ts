const API = "https://www.premiumize.me/api";

export interface PremiumizeOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

/** One file of a cached torrent, as transfer/directdl lists it. */
export interface PremiumizeFile {
  path: string;
  size: number;
  link: string;
}

export function createPremiumize({ apiKey, fetch: f = fetch }: PremiumizeOptions) {
  async function post<T>(path: string, params: URLSearchParams): Promise<T> {
    params.set("apikey", apiKey);
    const res = await f(`${API}/${path}`, { method: "POST", body: params });
    if (!res.ok) throw new Error(`Premiumize ${res.status}`);
    const body = (await res.json()) as T & { status?: string; message?: string };
    if (body.status !== "success") throw new Error(`Premiumize ${body.message ?? "error"}`);
    return body;
  }

  return {
    /** Which of these info-hashes Premiumize has cached. */
    async checkCached(hashes: string[]): Promise<Set<string>> {
      const out = new Set<string>();
      const BATCH = 100;
      for (let i = 0; i < hashes.length; i += BATCH) {
        const chunk = hashes.slice(i, i + BATCH);
        const params = new URLSearchParams();
        for (const h of chunk) params.append("items[]", h);
        const body = await post<{ response?: boolean[] }>("cache/check", params);
        chunk.forEach((h, idx) => body.response?.[idx] === true && out.add(h.toLowerCase()));
      }
      return out;
    },

    /** Direct links to the files of a cached torrent; nothing is added to the account's transfers. */
    async directFiles(infoHash: string): Promise<PremiumizeFile[]> {
      const params = new URLSearchParams({ src: `magnet:?xt=urn:btih:${infoHash}` });
      const body = await post<{ content?: { path?: string; size?: number; link?: string }[] }>("transfer/directdl", params);
      return (body.content ?? [])
        .filter((c) => c.link)
        .map((c) => ({ path: c.path ?? "", size: c.size ?? 0, link: c.link! }));
    },
  };
}
