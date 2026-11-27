// A Nuvio folder's first titles, for its row in Secretary's opened collection card (launcher collections.ts): the
// first page of each source the TV can read, taken in turn (as the folder page's All tab). Secretary imports this
// lazily when a collection card opens, so the addon client stays out of its first bundle.
import type { CollectionSource } from "@secretary/nuvio";
import { getTmdbKey } from "./cinemeta.ts";
import { interleave, loadSourcePage, resolveSource, type ResolvedSource, type SourceKeys } from "./nuviocollections.ts";
import { addonStore } from "./plugins.ts";
import type { CatalogType, Title } from "./types.ts";

declare const __TRAKT_CLIENT_ID__: string | undefined;

const keys = (): SourceKeys => ({ tmdb: getTmdbKey(), trakt: typeof __TRAKT_CLIENT_ID__ !== "undefined" ? __TRAKT_CLIENT_ID__ : "" });

/** Up to `max` titles of the folder; a source that fails is left out. Empty when none can be read on this TV. */
export async function folderTitles(sources: readonly CollectionSource[], kind: CatalogType, max = 20): Promise<Title[]> {
  const k = keys();
  // The addons the TV has: the catalog refreshes them on its own start; here the last read is enough.
  const active = addonStore.active();
  const resolved = sources.map((s) => resolveSource(s, kind, active, k)).filter((r): r is ResolvedSource => r !== null).slice(0, 6);
  const pages = await Promise.all(resolved.map((r) => loadSourcePage(r, 1, 0, k).then((p) => p.items, () => [] as Title[])));
  return interleave(pages).slice(0, max);
}
