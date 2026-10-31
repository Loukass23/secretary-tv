/** "anime" is a series catalog backed by Kitsu ids ("kitsu:7442") instead of IMDb ids. */
export type CatalogType = "movie" | "series" | "anime";

export const isSeries = (type: CatalogType): boolean => type !== "movie";

/** The type the stream server and its upstream addon know: anime episodes are asked for as series. */
export const streamType = (type: CatalogType): "movie" | "series" => (type === "movie" ? "movie" : "series");

/** One episode of a series. `id` is the stream id, for example "tt0944947:1:2" or "kitsu:7442:3". */
export interface Video {
  id: string;
  season: number;
  episode: number;
  name: string;
  released?: string;
  thumbnail?: string;
  overview?: string;
  /** Anime: the season and episode numbering IMDb uses, and the running number across the whole show. */
  imdbSeason?: number;
  imdbEpisode?: number;
  absoluteEpisode?: number;
}

/** A movie, a series or an anime. */
export interface Title {
  id: string;
  name: string;
  year: string;
  rating: string;
  description?: string;
  genre?: string[];
  runtime?: string;
  /** Artwork the catalog gave. Titles without it use the IMDb-id artwork service. */
  poster?: string;
  background?: string;
  /** Series only, from the meta endpoint. */
  videos?: Video[];
  /** Optional catalog origin when mixed across categories (e.g. Continue watching or Search). */
  catalogType?: CatalogType;
  /** Optional badge shown on cards (e.g. "Series · S01E02" or "Next · S01E03"). */
  badge?: string;
  /** Optional watch progress percentage (0..100) for Continue watching cards. */
  progressPct?: number;
  /** Optional sequence number shown on pinned timeline rows (1..N). */
  sequenceNum?: number;
  /** Optional watched checkmark flag for timeline / collection items. */
  watched?: boolean;
  /** Optional flag indicating this item is the "NEXT" unwatched step in a timeline. */
  isNextStep?: boolean;
  /** Optional collection ID if this item opens a Collection / Timeline view (.col island). */
  sagaId?: string;
  /** Optional TMDB collection metadata discovered from movie detail. */
  tmdbCollection?: { id: number; name: string };
  /** A folder of a Nuvio collection (lib/nuviocollections.ts): OK opens its page instead of a title. */
  folder?: { collectionId: string; folderId: string; emoji?: string; hideTitle?: boolean };
}

export interface HomeRow {
  id: string;
  title: string;
  items: Title[];
  /** Row rendering style: standard poster cards, wide Nuvio .col collection cards, or pinned sequence timeline row. */
  rowKind?: "standard" | "collections" | "timeline" | "folders";
  /** Folder rows: the card shape every card of the row takes. */
  tileShape?: "POSTER" | "LANDSCAPE" | "SQUARE";
  /** Origin / subtitle displayed next to the row heading. */
  originLabel?: string;
  /** Associated sagaId if this is a pinned timeline row. */
  sagaId?: string;
}
