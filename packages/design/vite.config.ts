// The design workbench (docs/design.md). Dev server only: it renders the TV's own components in a
// desktop browser and is never built into a .wgt, so it has no budget.json.
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The build-time globals the screens read, all empty: no keys, no server, no network.
const GLOBALS = [
  "ANIME_ID", "FANART_API_KEY", "GEMINI_KEY", "MOVIES_ID", "NUVIO_KEY", "NUVIO_URL", "PARTY_URL", "PLUGIN_REPOS",
  "PM_API_KEY", "RETURN_TO", "SERIES_ID", "SERVER_URL", "ST_CLIENT_ID", "ST_CLIENT_SECRET", "ST_TOKEN",
  "TMDB_API_KEY", "TORBOX_API_KEY", "TRAKT_CLIENT_ID", "TVDB_API_KEY", "WEATHER_CITY", "WEATHER_LAT", "WEATHER_LON",
];

export default defineConfig({
  plugins: [preact()],
  define: {
    ...Object.fromEntries(GLOBALS.map((k) => [`__${k}__`, JSON.stringify("")])),
    __SYNC_BACKEND__: JSON.stringify("secretary"),
  },
  server: { port: 5180, strictPort: true },
});
