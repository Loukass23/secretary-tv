import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { tizenBuild, tizenHtml } from "../tv-kit/src/vite.ts";

// Option B (docs/embedding-catalog.md): NEST_EMBED_CATALOG=1 browses the catalog inside Nest. The catalog's own keys then
// travel in this package too; without the flag they stay out of it.
// The player and catalog run inside Nest by default (docs/embedding-catalog.md); NEST_EMBED_PLAYER=0 builds the old
// launcher that opens the catalog apps.
const embedPlayer = process.env.NEST_EMBED_PLAYER !== "0";
const embed = embedPlayer || process.env.NEST_EMBED_CATALOG === "1";
const only = (name: string) => JSON.stringify(embed ? (process.env[name] ?? "") : "");

export default defineConfig({
  ...tizenBuild,
  plugins: [preact(), tizenHtml()],
  define: {
    __SERVER_URL__: JSON.stringify(process.env.SECRETARY_TV_SERVER_URL ?? ""),
    // Empty: the public Nuvio Cloud. SYNC_BACKEND=secretary keeps the home server as the only backend (dev and tests).
    __NUVIO_URL__: JSON.stringify(process.env.NUVIO_URL ?? ""),
    __NUVIO_KEY__: JSON.stringify(process.env.NUVIO_KEY ?? ""),
    // Watch together (docs/watch-party.md): the room service's origin. Empty hides the feature.
    __PARTY_URL__: JSON.stringify(process.env.PARTY_URL ?? ""),
    // SmartThings from the TV (docs/smartthings.md): the OAuth app, or a short-lived personal token to try things out.
    __ST_CLIENT_ID__: JSON.stringify(process.env.SMARTTHINGS_CLIENT_ID ?? ""),
    __ST_CLIENT_SECRET__: JSON.stringify(process.env.SMARTTHINGS_CLIENT_SECRET ?? ""),
    __ST_TOKEN__: JSON.stringify(process.env.SMARTTHINGS_CLIENT_ID ? "" : (process.env.SMARTTHINGS_TOKEN ?? "")),
    // Ask Nest on the TV (docs/launcher.md): Gemini without the server, and where the weather is for.
    // Its own name: tizen.mjs also reads .env, and the server's GEMINI_API_KEY must not end up in a .wgt unasked.
    __GEMINI_KEY__: JSON.stringify(process.env.NEST_GEMINI_API_KEY ?? ""),
    __GROQ_KEY__: JSON.stringify(process.env.NEST_GROQ_API_KEY ?? ""),
    // The YouTube card (docs/launcher.md): a Data API key for what is popular, and the TV's YouTube app id.
    __YOUTUBE_KEY__: JSON.stringify(process.env.NEST_YOUTUBE_API_KEY ?? ""),
    __YOUTUBE_ID__: JSON.stringify(process.env.NEST_YOUTUBE_APP_ID ?? ""),
    __WEATHER_LAT__: JSON.stringify(process.env.WEATHER_LAT ?? ""),
    __WEATHER_LON__: JSON.stringify(process.env.WEATHER_LON ?? ""),
    __WEATHER_CITY__: JSON.stringify(process.env.WEATHER_CITY ?? ""),
    // The side lights following the poster in focus (docs/smartthings.md): ms between the moves, and ms of rest first.
    __MOOD_STEP_MS__: JSON.stringify(process.env.NEST_MOOD_STEP_MS ?? ""),
    __MOOD_SETTLE_MS__: JSON.stringify(process.env.NEST_MOOD_SETTLE_MS ?? ""),
    __EMBED_CATALOG__: JSON.stringify(embed),
    __EMBED_PLAYER__: JSON.stringify(embedPlayer),
    __TMDB_API_KEY__: only("TMDB_API_KEY"),
    __TVDB_API_KEY__: only("TVDB_API_KEY"),
    __TRAKT_CLIENT_ID__: only("TRAKT_CLIENT_ID"),
    __FANART_API_KEY__: only("FANART_API_KEY"),
    __PLUGIN_REPOS__: only("SECRETARY_TV_PLUGIN_REPOS"),
    __TORBOX_API_KEY__: only("TORBOX_API_KEY"),
    __PM_API_KEY__: only("PM_API_KEY"),
    __SYNC_BACKEND__: JSON.stringify(process.env.SYNC_BACKEND || "nuvio"),
    __MOVIES_ID__: JSON.stringify(`${process.env.SECRETARY_TV_PACKAGE_ID || "ScrtMovies"}.Movies`),
    __SERIES_ID__: JSON.stringify(`${process.env.SECRETARY_TV_SERIES_ID || "ScrtSeries"}.Series`),
    __ANIME_ID__: JSON.stringify(`${process.env.SECRETARY_TV_ANIME_ID || "ScrtAnimes"}.Anime`),
  },
});
