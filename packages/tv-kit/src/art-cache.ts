// The local art cache (docs/performance.md, "Art cache"): the small pictures of the titles on Secretary's home and in
// Continue watching (posters, stills, logos) kept on the TV as IndexedDB blobs, so the next start draws them on its
// first frame instead of waiting for the network. The most recent `max` (150) are kept, the least recently shown
// dropped first; the index (which pictures, in order, and when each was last fetched) is a small localStorage list,
// read synchronously at start.
//
// How it is used: `warm()` once before the home's first render reads the most recent blobs into object URLs (capped in
// time, so a slow store never holds the start); `src(url)` then gives the blob URL for a picture warmed this session,
// else the URL itself; `keep(urls)` after the home has drawn marks what it shows as most recent, fetches what is new,
// and refreshes from the network in the background what was last fetched more than a day ago. Within a session a
// picture's `src` never changes, so no tile reloads its art under the viewer. Pure apart from the store and fetch it is
// handed, so it is unit tested.

export interface BlobStore {
  /** The blobs for `keys`, in order; a missing one is undefined. One transaction for all of them. */
  getMany(keys: readonly string[]): Promise<(Blob | undefined)[]>;
  put(key: string, blob: Blob): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
}

export interface Kv {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface ArtCacheOptions {
  /** Null where IndexedDB is missing: the cache then does nothing and `src` returns the URL. */
  store: BlobStore | null;
  kv: Kv;
  fetch?: (url: string) => Promise<{ ok: boolean; blob(): Promise<Blob> }>;
  toUrl?: (b: Blob) => string;
  /** Pictures kept at most. */
  max?: number;
  /** A picture bigger than this is not kept (a full-size backdrop): it is not what the cache is for. */
  maxBytes?: number;
  /** How long a fetched picture is good for before a background refresh. */
  refreshMs?: number;
  /** Fetches at once. */
  parallel?: number;
  now?: () => number;
}

/** One kept picture: its URL and when it was last fetched. */
interface Entry {
  u: string;
  t: number;
}

export const ART_INDEX_KEY = "sg.artCache";
export const ART_MAX = 150;
const DAY = 24 * 3600_000;

export interface ArtCache {
  /** The picture to show for `url`: its blob URL when warmed this session, else `url` itself. */
  src<T extends string | undefined>(url: T): T | string;
  /** Reads the most recent `limit` kept pictures into blob URLs, giving up after `ms`; how many it read. */
  warm(limit?: number, ms?: number): Promise<number>;
  /** What the home shows now, most important first: kept as most recent, fetched when new, refreshed when old. */
  keep(urls: readonly (string | undefined)[]): Promise<void>;
  /** The kept URLs, most recent first (for tests and the inspector). */
  list(): string[];
}

export function createArtCache(o: ArtCacheOptions): ArtCache {
  const max = o.max ?? ART_MAX;
  const maxBytes = o.maxBytes ?? 400_000;
  const refreshMs = o.refreshMs ?? DAY;
  const parallel = o.parallel ?? 3;
  const now = o.now ?? Date.now;
  const toUrl = o.toUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const get = o.fetch ?? ((u: string) => fetch(u));
  /** Most recent first. */
  let index: Entry[] = read(o.kv);
  const warmed = new Map<string, string>();
  /** Fetched (or failed) this session: never asked twice. */
  const asked = new Set<string>();

  const save = () => {
    try {
      o.kv.setItem(ART_INDEX_KEY, JSON.stringify(index));
    } catch {
      // the pictures are still in the store; the index is rebuilt as the home shows them
    }
  };

  const fetchOne = async (u: string): Promise<boolean> => {
    if (!o.store) return false;
    try {
      const res = await get(u);
      if (!res.ok) return false;
      const b = await res.blob();
      if (!b.size || b.size > maxBytes || (b.type && !b.type.startsWith("image/"))) return false;
      await o.store.put(u, b);
      return true;
    } catch {
      return false;
    }
  };

  return {
    src: (url) => (url ? (warmed.get(url) ?? url) : url),

    async warm(limit = 60, ms = 250) {
      if (!o.store || !index.length) return 0;
      const keys = index.slice(0, limit).map((e) => e.u);
      const read = o.store.getMany(keys).then((blobs) => {
        let n = 0;
        blobs.forEach((b, i) => {
          if (b && !warmed.has(keys[i])) {
            warmed.set(keys[i], toUrl(b));
            n++;
          }
        });
        return n;
      });
      const late = new Promise<number>((done) => setTimeout(() => done(-1), ms));
      try {
        return Math.max(0, await Promise.race([read, late]));
      } catch {
        return 0;
      }
    },

    async keep(urls) {
      if (!o.store) return;
      const seen = new Set<string>();
      const fresh = urls.filter((u): u is string => !!u && !u.startsWith("data:") && !u.startsWith("blob:") && !seen.has(u) && (seen.add(u), true));
      if (!fresh.length) return;
      const was = new Map(index.map((e) => [e.u, e] as const));
      // What is shown now goes first, in its order; the rest keep theirs after it.
      const next: Entry[] = [...fresh.map((u) => was.get(u) ?? { u, t: 0 }), ...index.filter((e) => !seen.has(e.u))];
      const gone = next.slice(max).map((e) => e.u);
      index = next.slice(0, max);
      save();
      if (gone.length) await o.store.delete(gone).catch(() => {});
      // New pictures (t 0) and old ones, a few at a time, most important first.
      const todo = index.filter((e) => fresh.includes(e.u) && !asked.has(e.u) && (!e.t || now() - e.t > refreshMs));
      for (const e of todo) asked.add(e.u);
      let at = 0;
      const worker = async () => {
        while (at < todo.length) {
          const e = todo[at++];
          if (await fetchOne(e.u)) {
            e.t = now();
            save();
          } else if (!e.t) {
            // Never fetched and it will not be: not worth a place.
            index = index.filter((x) => x !== e);
            save();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, worker));
    },

    list: () => index.map((e) => e.u),
  };
}

function read(kv: Kv): Entry[] {
  try {
    const raw = JSON.parse(kv.getItem(ART_INDEX_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((e): e is Entry => !!e && typeof e.u === "string" && typeof e.t === "number") : [];
  } catch {
    return [];
  }
}

/** The IndexedDB store behind the cache (`secretary-art`), or null where IndexedDB is missing or will not open. */
export function idbStore(name = "secretary-art"): BlobStore | null {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("art");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => T): Promise<T> => {
    const d = await open();
    return new Promise<T>((resolve, reject) => {
      const t = d.transaction("art", mode);
      const out = run(t.objectStore("art"));
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    async getMany(keys) {
      const reqs = await tx("readonly", (s) => keys.map((k) => s.get(k)));
      return reqs.map((r) => (r.result instanceof Blob ? r.result : undefined));
    },
    put: (key, blob) => tx("readwrite", (s) => void s.put(blob, key)),
    delete: (keys) => tx("readwrite", (s) => keys.forEach((k) => s.delete(k))),
  };
}

/** Secretary's art cache: one per page, on IndexedDB and localStorage. */
let shared: ArtCache | null = null;
export function artCache(): ArtCache {
  return (shared ??= createArtCache({
    store: idbStore(),
    kv: typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} },
  }));
}
