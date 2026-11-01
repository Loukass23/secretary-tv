import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { tizenBuild, tizenHtml } from "../tv-kit/src/vite.ts";

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
    __WEATHER_LAT__: JSON.stringify(process.env.WEATHER_LAT ?? ""),
    __WEATHER_LON__: JSON.stringify(process.env.WEATHER_LON ?? ""),
    __WEATHER_CITY__: JSON.stringify(process.env.WEATHER_CITY ?? ""),
    __SYNC_BACKEND__: JSON.stringify(process.env.SYNC_BACKEND || "nuvio"),
    __MOVIES_ID__: JSON.stringify(`${process.env.SECRETARY_TV_PACKAGE_ID || "ScrtMovies"}.Movies`),
    __SERIES_ID__: JSON.stringify(`${process.env.SECRETARY_TV_SERIES_ID || "ScrtSeries"}.Series`),
    __ANIME_ID__: JSON.stringify(`${process.env.SECRETARY_TV_ANIME_ID || "ScrtAnimes"}.Anime`),
  },
});
