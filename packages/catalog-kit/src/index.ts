export { CatalogApp, type CatalogConfig, type EmbeddedHost } from "./app.tsx";
export { folderTitles } from "./lib/folder-titles.ts";
export { type ArtSize, ART_MAX, cachedTitleArt, clearArtCache, setFanartKeys, type TitleArt, titleArt } from "./lib/fanart.ts";
export {
  clearRecentSearches,
  type DashboardSettings,
  DEFAULT_SETTINGS,
  fetchRemindersForMode,
  loadRecentSearches,
  loadSettings,
  mergeSettings,
  saveRecentSearch,
  saveSettings,
  SETTING_ITEMS,
  toggleReminderForMode,
} from "./lib/settings.ts";
export type { CatalogType } from "./lib/types.ts";
import "./style.css";
export type { HostHeader } from "./host.ts";
