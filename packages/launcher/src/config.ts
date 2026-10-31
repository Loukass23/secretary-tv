declare const __SERVER_URL__: string | undefined;
declare const __MOVIES_ID__: string | undefined;
declare const __SERIES_ID__: string | undefined;
declare const __ANIME_ID__: string | undefined;
declare const __NUVIO_URL__: string | undefined;
declare const __NUVIO_KEY__: string | undefined;
declare const __SYNC_BACKEND__: string | undefined;
declare const __PARTY_URL__: string | undefined;

export const SERVER_URL = (typeof __SERVER_URL__ !== "undefined" ? __SERVER_URL__ : "").replace(/\/$/, "");

export const NUVIO_URL = typeof __NUVIO_URL__ !== "undefined" ? __NUVIO_URL__ : "";
export const NUVIO_KEY = typeof __NUVIO_KEY__ !== "undefined" ? __NUVIO_KEY__ : "";
/** The watch-party room service (packages/party), no trailing slash; empty when this build has none. */
export const PARTY_URL = (typeof __PARTY_URL__ !== "undefined" ? __PARTY_URL__ : "").replace(/\/$/, "");
/** "nuvio" (accounts and sync on Nuvio Cloud) or "secretary" (the home server only, for dev and tests). */
export const SYNC_BACKEND = typeof __SYNC_BACKEND__ !== "undefined" && __SYNC_BACKEND__ === "secretary" ? "secretary" : "nuvio";

export const APP_IDS = {
  movie: typeof __MOVIES_ID__ !== "undefined" && __MOVIES_ID__ ? __MOVIES_ID__ : "ScrtMovies.Movies",
  series: typeof __SERIES_ID__ !== "undefined" && __SERIES_ID__ ? __SERIES_ID__ : "ScrtSeries.Series",
  anime: typeof __ANIME_ID__ !== "undefined" && __ANIME_ID__ ? __ANIME_ID__ : "ScrtAnimes.Anime",
} as const;

// Ids shown first, in order, even when the filters would drop them.
// ScrtMovies.Movies is this repo's movies app; the last is the TV's Settings.
export const PINS: readonly string[] = [
  APP_IDS.movie,
  APP_IDS.series,
  APP_IDS.anime,
  "com.samsung.tv.coba.setting.networksettings",
];
// Ids never shown.
export const HIDE: readonly string[] = ["w2VwCK465D.OTApp"];
export const COLUMNS = 6;
