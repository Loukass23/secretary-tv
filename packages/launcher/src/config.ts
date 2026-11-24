import { MOOD_SETTLE_MS, MOOD_STEP_MS, moodMs } from "@secretary/smartthings";

declare const __SERVER_URL__: string | undefined;
declare const __MOVIES_ID__: string | undefined;
declare const __SERIES_ID__: string | undefined;
declare const __ANIME_ID__: string | undefined;
declare const __NUVIO_URL__: string | undefined;
declare const __NUVIO_KEY__: string | undefined;
declare const __SYNC_BACKEND__: string | undefined;
declare const __PARTY_URL__: string | undefined;
declare const __ST_CLIENT_ID__: string | undefined;
declare const __ST_CLIENT_SECRET__: string | undefined;
declare const __ST_TOKEN__: string | undefined;
declare const __GEMINI_KEY__: string | undefined;
declare const __GROQ_KEY__: string | undefined;
declare const __EMBED_CATALOG__: boolean | undefined;
declare const __EMBED_PLAYER__: boolean | undefined;
declare const __YOUTUBE_KEY__: string | undefined;
declare const __YOUTUBE_ID__: string | undefined;
declare const __WEATHER_LAT__: string | undefined;
declare const __WEATHER_LON__: string | undefined;
declare const __WEATHER_CITY__: string | undefined;
declare const __MOOD_STEP_MS__: string | undefined;
declare const __MOOD_SETTLE_MS__: string | undefined;

export const SERVER_URL = (typeof __SERVER_URL__ !== "undefined" ? __SERVER_URL__ : "").replace(/\/$/, "");

export const NUVIO_URL = typeof __NUVIO_URL__ !== "undefined" ? __NUVIO_URL__ : "";
export const NUVIO_KEY = typeof __NUVIO_KEY__ !== "undefined" ? __NUVIO_KEY__ : "";
/** The watch-party room service (packages/party), no trailing slash; empty when this build has none. */
export const PARTY_URL = (typeof __PARTY_URL__ !== "undefined" ? __PARTY_URL__ : "").replace(/\/$/, "");
/** "nuvio" (accounts and sync on Nuvio Cloud) or "secretary" (the home server only, for dev and tests). */
export const SYNC_BACKEND = typeof __SYNC_BACKEND__ !== "undefined" && __SYNC_BACKEND__ === "secretary" ? "secretary" : "nuvio";

/**
 * SmartThings straight from Nest (docs/smartthings.md). The OAuth app's client id and secret, for refreshing the token
 * pair the setup script stores on the TV; a personal access token instead (about 24 h) for trying things out.
 */
export const ST_CLIENT_ID = typeof __ST_CLIENT_ID__ !== "undefined" ? __ST_CLIENT_ID__ : "";
export const ST_CLIENT_SECRET = typeof __ST_CLIENT_SECRET__ !== "undefined" ? __ST_CLIENT_SECRET__ : "";
export const ST_TOKEN = typeof __ST_TOKEN__ !== "undefined" ? __ST_TOKEN__ : "";

/**
 * Gemini straight from the TV (docs/launcher.md, "Ask Nest on the TV"): voice, spoken replies and free questions with no
 * server. The key ships inside the .wgt, so use one restricted to the Generative Language API.
 */
export const GEMINI_KEY = typeof __GEMINI_KEY__ !== "undefined" ? __GEMINI_KEY__ : "";
/** Groq's Whisper for turning the room microphone's clip into words, ahead of Gemini; empty uses Gemini or the server. */
export const GROQ_KEY = typeof __GROQ_KEY__ !== "undefined" ? __GROQ_KEY__ : "";

/** Browsing the catalog inside Nest (docs/embedding-catalog.md, option B); off, Cinema, Shows and Anime open as apps. */
export const EMBED_CATALOG = typeof __EMBED_CATALOG__ !== "undefined" && __EMBED_CATALOG__ === true;

/** Option C: playback runs inside Nest too (AVPlay in this page), so the catalog apps are not needed to play. */
export const EMBED_PLAYER = typeof __EMBED_PLAYER__ !== "undefined" && __EMBED_PLAYER__ === true;

/** The YouTube card: a Data API key for what is popular (empty: the card is a way into the app), and the TV's YouTube app id. */
export const YOUTUBE_API_KEY = typeof __YOUTUBE_KEY__ !== "undefined" ? __YOUTUBE_KEY__ : "";
export const YOUTUBE_APP_ID = typeof __YOUTUBE_ID__ !== "undefined" && __YOUTUBE_ID__ ? __YOUTUBE_ID__ : "111299001912";

/**
 * How the side lights follow the poster in focus (docs/smartthings.md): ms between the three moves of a colour change
 * (`NEST_MOOD_STEP_MS`, 100-5000) and ms focus must rest before it starts (`NEST_MOOD_SETTLE_MS`, 0-10000).
 */
export const MOOD_TIMING = {
  stepMs: moodMs(typeof __MOOD_STEP_MS__ !== "undefined" ? __MOOD_STEP_MS__ : "", MOOD_STEP_MS, 100, 5_000),
  settleMs: moodMs(typeof __MOOD_SETTLE_MS__ !== "undefined" ? __MOOD_SETTLE_MS__ : "", MOOD_SETTLE_MS, 0, 10_000),
};

/** Where the weather is for when SmartThings has no location: coordinates, or a city looked up once. */
export const WEATHER_ENV = {
  WEATHER_LAT: typeof __WEATHER_LAT__ !== "undefined" ? __WEATHER_LAT__ : "",
  WEATHER_LON: typeof __WEATHER_LON__ !== "undefined" ? __WEATHER_LON__ : "",
  WEATHER_CITY: typeof __WEATHER_CITY__ !== "undefined" ? __WEATHER_CITY__ : "",
};

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
