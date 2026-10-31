// My List: titles the viewer saved, kept per app on the TV and synced with the Nuvio profile's library
// (lib/cloud.ts). Changes made here wait in a queue until the cloud has them, so an add or a removal made offline
// is neither lost nor undone by the next pull.
import { readJson, writeJson } from "@secretary/tv-kit";
import type { CatalogType, Title } from "./types.ts";

export interface LibraryEntry {
  type: CatalogType;
  title: Title;
  addedAt: number;
}

export type LibraryChange = { op: "add"; entry: LibraryEntry } | { op: "remove"; type: CatalogType; id: string };

export interface LibraryRemote {
  /** The whole library, or null when it cannot be read. */
  pull(): Promise<LibraryEntry[] | null>;
  /** Sends queued changes in order; false when they did not all arrive (they are kept and sent again). */
  apply(changes: readonly LibraryChange[]): Promise<boolean>;
}

const LIST = "sectv.library.v1";
const PENDING = "sectv.library.pending";
const MAX = 500;

let remote: LibraryRemote | null = null;

export function setLibraryRemote(r: LibraryRemote | null): void {
  remote = r;
}

// Titles shown with IMDb-id artwork carry no poster URL; the library row gets that artwork's address, so other
// devices (the official Nuvio apps) have a poster too.
const slim = (t: Title): Title => ({
  id: t.id,
  name: t.name,
  year: t.year,
  rating: t.rating,
  poster: t.poster ?? (t.id.startsWith("tt") ? `https://images.metahub.space/poster/medium/${t.id}/img` : undefined),
  background: t.background,
});

const same = (e: Pick<LibraryEntry, "type">, type: CatalogType, id: string, eid: string) => e.type === type && eid === id;

export function loadLibrary(): LibraryEntry[] {
  const list = readJson<LibraryEntry[]>(LIST);
  return Array.isArray(list) ? list.filter((e) => e?.title?.id) : [];
}

export const inLibrary = (type: CatalogType, id: string) => loadLibrary().some((e) => same(e, type, id, e.title.id));

/** The list after one change. Pure so it can be tested. */
export function applyChange(list: readonly LibraryEntry[], c: LibraryChange): LibraryEntry[] {
  if (c.op === "add") {
    const rest = list.filter((e) => !same(e, c.entry.type, c.entry.title.id, e.title.id));
    return [c.entry, ...rest].slice(0, MAX);
  }
  return list.filter((e) => !same(e, c.type, c.id, e.title.id));
}

/** Adds or removes a title; returns whether it is in My List now. */
export function toggleLibrary(type: CatalogType, title: Title, now = Date.now()): boolean {
  const add = !inLibrary(type, title.id);
  const change: LibraryChange = add
    ? { op: "add", entry: { type, title: slim(title), addedAt: now } }
    : { op: "remove", type, id: title.id };
  writeJson(LIST, applyChange(loadLibrary(), change));
  const pending = [...(readJson<LibraryChange[]>(PENDING) ?? []), change];
  writeJson(PENDING, pending);
  if (remote) void flush(remote);
  return add;
}

async function flush(r: LibraryRemote): Promise<boolean> {
  const pending = readJson<LibraryChange[]>(PENDING) ?? [];
  if (!pending.length) return true;
  if (!(await r.apply(pending))) return false;
  // Changes queued while these were on their way stay for the next flush.
  writeJson(PENDING, (readJson<LibraryChange[]>(PENDING) ?? []).slice(pending.length));
  return true;
}

/** The cloud's library with this TV's queued changes on top, then the queue sent. Returns the list. */
export async function syncLibrary(): Promise<LibraryEntry[]> {
  if (!remote) return loadLibrary();
  const cloudList = await remote.pull();
  if (cloudList) {
    const pending = readJson<LibraryChange[]>(PENDING) ?? [];
    const merged = pending.reduce(applyChange, [...cloudList].sort((a, b) => b.addedAt - a.addedAt));
    writeJson(LIST, merged.slice(0, MAX));
  }
  await flush(remote);
  return loadLibrary();
}

/** Another account or profile took over: My List starts from its cloud library. */
export function clearLocalLibrary(): void {
  writeJson(LIST, []);
  writeJson(PENDING, []);
}
