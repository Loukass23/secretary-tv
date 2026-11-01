// Build-time settings from .env.tizen (vite.config.ts). docs/music.md explains each.

/** YouTube Data API v3 key for browsing and search. It ships inside the .wgt: restrict it to that API. */
export const YOUTUBE_API_KEY = __YOUTUBE_API_KEY__;

/** The player page (player/index.html as published on Cloudflare Pages); MUSIC_PLAYER_URL can name another copy. */
export const PLAYER_URL = __PLAYER_URL__;

/** Where Back at the root goes (the launcher), or "" to just exit. */
export const RETURN_TO = __RETURN_TO__;
