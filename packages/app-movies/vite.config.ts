import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { tizenBuild, tizenHtml } from "../tv-kit/src/vite.ts";

export default defineConfig({
  ...tizenBuild,
  plugins: [preact(), tizenHtml()],
  define: {
    __SERVER_URL__: JSON.stringify(process.env.SECRETARY_TV_SERVER_URL ?? ""),
    // Accounts and sync (docs/nuvio-cloud.md): empty is the public Nuvio Cloud; SYNC_BACKEND=secretary keeps the home server.
    __NUVIO_URL__: JSON.stringify(process.env.NUVIO_URL ?? ""),
    __NUVIO_KEY__: JSON.stringify(process.env.NUVIO_KEY ?? ""),
    // Watch together (docs/watch-party.md): the room service's origin. Empty hides the feature.
    __PARTY_URL__: JSON.stringify(process.env.PARTY_URL ?? ""),
    __SYNC_BACKEND__: JSON.stringify(process.env.SYNC_BACKEND || "nuvio"),
    __TMDB_API_KEY__: JSON.stringify(process.env.TMDB_API_KEY ?? ""),
    __TVDB_API_KEY__: JSON.stringify(process.env.TVDB_API_KEY ?? ""),
    // Trakt lists in Nuvio collections (docs/nuvio-cloud.md, phase 8); without it those sources are skipped.
    __TRAKT_CLIENT_ID__: JSON.stringify(process.env.TRAKT_CLIENT_ID ?? ""),
    __FANART_API_KEY__: JSON.stringify(process.env.FANART_API_KEY ?? ""),
    // Streams (docs/plugins.md): the owner's own plugin repositories and debrid keys, from the gitignored env.
    __PLUGIN_REPOS__: JSON.stringify(process.env.SECRETARY_TV_PLUGIN_REPOS ?? ""),
    __TORBOX_API_KEY__: JSON.stringify(process.env.TORBOX_API_KEY ?? ""),
    __PM_API_KEY__: JSON.stringify(process.env.PM_API_KEY ?? ""),
    // Where Back at the root goes. Empty without a launcher: the app just exits.
    __RETURN_TO__: JSON.stringify(
      process.env.SECRETARY_TV_LAUNCHER_ID ? `${process.env.SECRETARY_TV_LAUNCHER_ID}.Launcher` : "",
    ),
  },
});
