export type CatalogKind = "movie" | "series" | "anime";

/** A title as the assistant hands it to Nest: enough for a poster and to open it in its app. */
export interface SlimTitle {
  id: string;
  name: string;
  year: string;
  rating: string;
  poster?: string;
  background?: string;
}

export interface SearchResult {
  type: CatalogKind;
  title: SlimTitle;
}
