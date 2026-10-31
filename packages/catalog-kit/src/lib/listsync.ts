// Keeps a list on the TV (plugin repositories, addons) and the profile's list on Nuvio Cloud the same
// (docs/nuvio-cloud.md). Both lists are full-replace on the server, so the rules guard against wiping either side:
// - the first sync ever on this TV merges the two lists and sends the result (nothing set up before is lost);
// - another account or profile later takes its own cloud list as it is;
// - after that the cloud's list is taken, unless the TV's list changed since the last agreed one, which is sent;
// - an empty cloud list only empties the TV once the server's own count confirms it.
// URLs are compared normalised (…/manifest.json) but sent back in the form the cloud stored them.
import type { ListRow } from "@secretary/nuvio";

export interface ListSide {
  synced(): ListRow[];
  replace(rows: readonly ListRow[]): void;
  subscribe(fn: () => void): () => void;
}

export interface ListCloud {
  /** "user:profile", or null when signed out. */
  owner(): string | null;
  pull(): Promise<ListRow[] | null>;
  /** False when the list did not reach the server. */
  push(rows: ListRow[]): Promise<boolean>;
  /** The server's count for the list, or null when unknown. */
  count(): Promise<number | null>;
  /** The profile uses profile 1's list: read it, never write it. */
  readOnly?(): boolean;
}

interface State {
  owner: string | null;
  /** The last list both sides agreed on, normalised. */
  base: ListRow[];
  /** Normalised URL to the form the cloud stores. */
  urls: Record<string, string>;
}

interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

const shape = (rows: readonly ListRow[]) => rows.map((r) => `${r.url}|${r.enabled ? 1 : 0}`).join("\n");
const ordered = (rows: readonly ListRow[]) => [...rows].sort((a, b) => a.sort_order - b.sort_order).map((r, i) => ({ ...r, sort_order: i }));

export function createListSync({
  key,
  side,
  cloud,
  kv,
  normalize,
  debounceMs = 1500,
  timer = (fn, ms) => setTimeout(fn, ms),
}: {
  key: string;
  side: ListSide;
  cloud: ListCloud;
  kv: KV;
  normalize: (url: string) => string;
  debounceMs?: number;
  timer?: (fn: () => void, ms: number) => unknown;
}) {
  const load = (): State => kv.get<State>(key) ?? { owner: null, base: [], urls: {} };
  const local = () => ordered(side.synced().map((r) => ({ ...r, url: normalize(r.url) })));
  let applying = false;
  let pending = false;

  const outgoing = (rows: ListRow[], st: State) => rows.map((r) => ({ ...r, url: st.urls[r.url] ?? r.url }));

  function apply(rows: ListRow[]) {
    applying = true;
    try {
      side.replace(rows);
    } finally {
      applying = false;
    }
  }

  async function send(rows: ListRow[], st: State): Promise<boolean> {
    if (cloud.readOnly?.()) return false;
    const ok = await cloud.push(outgoing(rows, st));
    if (ok) kv.set(key, { ...st, base: rows });
    return ok;
  }

  async function sync(): Promise<void> {
    const owner = cloud.owner();
    if (!owner) return;
    const remote = await cloud.pull();
    if (!remote) return;
    const st = load();
    const urls = owner === st.owner ? { ...st.urls } : {};
    const fromCloud = ordered(
      remote.map((r) => {
        const n = normalize(r.url);
        urls[n] = r.url;
        return { ...r, url: n };
      }),
    );
    const mine = local();
    const next: State = { owner, base: st.owner === owner ? st.base : [], urls };

    if (st.owner === null) {
      // The first sync on this TV: keep both sides, the cloud's first.
      const extra = mine.filter((r) => !fromCloud.some((c) => c.url === r.url));
      const union = ordered([...fromCloud, ...extra.map((r, i) => ({ ...r, sort_order: fromCloud.length + i }))]);
      apply(union);
      kv.set(key, { ...next, base: fromCloud });
      if (extra.length) await send(union, { ...next, base: fromCloud });
      return;
    }
    if (st.owner !== owner) {
      apply(fromCloud);
      kv.set(key, { ...next, base: fromCloud });
      return;
    }
    if (shape(mine) !== shape(st.base) && !cloud.readOnly?.()) {
      // Changed on this TV since the last agreed list: this TV's list goes up.
      await send(mine, next);
      return;
    }
    if (!fromCloud.length && mine.length && (await cloud.count()) !== 0) return;
    apply(fromCloud);
    kv.set(key, { ...next, base: fromCloud });
  }

  // A change on the TV goes up shortly after (several quick changes in one push). Manifest reads also notify, so
  // only a change to the list itself counts.
  const unsubscribe = side.subscribe(() => {
    if (applying || pending) return;
    pending = true;
    timer(() => {
      pending = false;
      const st = load();
      if (!cloud.owner() || st.owner !== cloud.owner()) return;
      const mine = local();
      if (shape(mine) !== shape(st.base)) void send(mine, st);
    }, debounceMs);
  });

  return { sync, stop: unsubscribe };
}
