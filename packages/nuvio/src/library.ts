import type { NuvioClient } from "./http.ts";
import { type Kind, kindOf, type SlimTitle } from "./progress.ts";

// The profile's library, "My List" on the TV (docs/nuvio-cloud.md). Items are keyed by (content_id, content_type);
// writes add or remove only the items they name.

export interface LibraryRow {
  content_id: string;
  content_type: "movie" | "series";
  name?: string | null;
  poster?: string | null;
  poster_shape?: "POSTER" | "LANDSCAPE" | "SQUARE";
  background?: string | null;
  description?: string | null;
  release_info?: string | null;
  imdb_rating?: number | null;
  genres?: string[];
  addon_base_url?: string | null;
  /** Epoch ms. */
  added_at?: number;
}

export interface LibraryItem {
  type: Kind;
  title: SlimTitle;
  /** Epoch ms. */
  addedAt: number;
}

const PAGE = 500;

export const libraryKey = (item: Pick<LibraryItem, "type" | "title">) => ({
  content_id: item.title.id,
  content_type: item.type === "movie" ? ("movie" as const) : ("series" as const),
});

export function toLibraryRow(item: LibraryItem): LibraryRow {
  const t = item.title;
  const rating = Number.parseFloat(t.rating);
  return {
    ...libraryKey(item),
    name: t.name,
    poster: t.poster ?? null,
    poster_shape: "POSTER",
    background: t.background ?? null,
    release_info: t.year || null,
    imdb_rating: Number.isFinite(rating) ? rating : null,
    added_at: item.addedAt,
  };
}

export function fromLibraryRow(r: LibraryRow): LibraryItem {
  return {
    type: kindOf(r),
    title: {
      id: r.content_id,
      name: r.name ?? "",
      year: r.release_info ?? "",
      rating: r.imdb_rating != null ? String(r.imdb_rating) : "",
      ...(r.poster ? { poster: r.poster } : {}),
      ...(r.background ? { background: r.background } : {}),
    },
    addedAt: r.added_at ?? 0,
  };
}

/** The whole library, newest first, read page by page. */
export async function pullLibrary(c: NuvioClient, profile: number): Promise<LibraryItem[]> {
  const out: LibraryItem[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = (await c.rpc<LibraryRow[] | null>("sync_pull_library", { p_profile_id: profile, p_limit: PAGE, p_offset: offset })) ?? [];
    out.push(...page.filter((r) => r?.content_id).map(fromLibraryRow));
    if (page.length < PAGE) return out;
  }
}

export async function addToLibrary(c: NuvioClient, profile: number, items: readonly LibraryItem[], origin?: string): Promise<void> {
  for (let i = 0; i < items.length; i += PAGE) {
    await c.rpc("sync_push_library_items", {
      p_profile_id: profile,
      p_items: items.slice(i, i + PAGE).map(toLibraryRow),
      ...(origin ? { p_origin_client_id: origin } : {}),
    });
  }
}

export async function removeFromLibrary(
  c: NuvioClient,
  profile: number,
  items: readonly Pick<LibraryItem, "type" | "title">[],
  origin?: string,
): Promise<void> {
  for (let i = 0; i < items.length; i += PAGE) {
    await c.rpc("sync_delete_library_items", {
      p_profile_id: profile,
      p_keys: items.slice(i, i + PAGE).map(libraryKey),
      ...(origin ? { p_origin_client_id: origin } : {}),
    });
  }
}
