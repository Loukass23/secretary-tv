import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { tizenBuild, tizenHtml } from "../tv-kit/src/vite.ts";

const server = (process.env.SECRETARY_TV_SERVER_URL ?? "").replace(/\/$/, "");

export default defineConfig({
  ...tizenBuild,
  plugins: [preact(), tizenHtml()],
  define: {
    // YouTube Data API v3 key (docs/music.md). It ships inside the .wgt: restrict it to that API.
    __YOUTUBE_API_KEY__: JSON.stringify(process.env.YOUTUBE_API_KEY ?? ""),
    // The http page that hosts YouTube's player: the home server's, unless MUSIC_PLAYER_URL names another copy.
    __PLAYER_URL__: JSON.stringify(process.env.MUSIC_PLAYER_URL || (server ? `${server}/music/player` : "")),
    // Where Back at the root goes. Empty without a launcher: the app just exits.
    __RETURN_TO__: JSON.stringify(
      process.env.SECRETARY_TV_LAUNCHER_ID ? `${process.env.SECRETARY_TV_LAUNCHER_ID}.Launcher` : "",
    ),
  },
});
