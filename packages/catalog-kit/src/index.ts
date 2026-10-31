export { CatalogApp, type CatalogConfig } from "./app.tsx";
export { clearFanartCache, type FrameArtworkResult, resolveFrameArtwork, setFanartKeys } from "./lib/fanart.ts";
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
