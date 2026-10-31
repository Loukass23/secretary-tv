import type { Debrid, DebridId } from "@secretary/core";

/** A resolved CDN link stays valid well past a viewing; TorBox's last about 30 minutes before a new one is needed. */
const LINK_TTL_MS = 25 * 60_000;

/**
 * Turns a stream URL into one AVPlay can open. Plugin torrents arrive as debrid:<service>:<hash>[/<fileIdx>] with the
 * episode numbers as ?s=&e=&a= (lib/streams.ts withHint); they are resolved only when played or prepared, so browsing
 * never adds anything to a debrid account. Every other URL is already playable.
 */
export function createPlayable(services: () => Debrid[], now: () => number = Date.now) {
  const cache = new Map<string, { at: number; p: Promise<string> }>();

  return function playable(url: string): Promise<string> {
    if (!url.startsWith("debrid:")) return Promise.resolve(url);
    const hit = cache.get(url);
    if (hit && now() - hit.at < LINK_TTL_MS) return hit.p;
    const p = (async () => {
      const [path, query = ""] = url.slice("debrid:".length).split("?");
      const [svc, rest] = [path.slice(0, path.indexOf(":")), path.slice(path.indexOf(":") + 1)] as [DebridId, string];
      const [hash, idx] = rest.split("/");
      const q = new URLSearchParams(query);
      const n = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
      const hint = q.size ? { season: n("s"), episode: n("e"), absolute: n("a") } : null;
      const service = services().find((d) => d.id === svc);
      if (!service) throw new Error(`no ${svc} key in Settings`);
      const link = await service.resolve(hash, idx ? Number(idx) : undefined, hint);
      if (!link) throw new Error("no playable file in the torrent");
      return link;
    })();
    cache.set(url, { at: now(), p });
    p.catch(() => cache.delete(url));
    return p;
  };
}
