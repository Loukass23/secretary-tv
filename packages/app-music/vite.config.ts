import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { tizenBuild, tizenHtml } from "../tv-kit/src/vite.ts";

// The player page (player/index.html) as published on Cloudflare Pages by `pnpm player`.
const HOSTED_PLAYER = "https://secretary-music-player.pages.dev/";

export default defineConfig({
  ...tizenBuild,
  plugins: [preact(), tizenHtml()],
  define: {
    // YouTube Data API v3 key (docs/music.md). It ships inside the .wgt: restrict it to that API.
    __YOUTUBE_API_KEY__: JSON.stringify(process.env.YOUTUBE_API_KEY ?? ""),
    // The https page that hosts YouTube's player: the published one, unless MUSIC_PLAYER_URL names another copy.
    __PLAYER_URL__: JSON.stringify(process.env.MUSIC_PLAYER_URL || HOSTED_PLAYER),
    // Where Back at the root goes. Empty without a launcher: the app just exits.
    __RETURN_TO__: JSON.stringify(
      process.env.SECRETARY_TV_LAUNCHER_ID ? `${process.env.SECRETARY_TV_LAUNCHER_ID}.Launcher` : "",
    ),
  },
});
