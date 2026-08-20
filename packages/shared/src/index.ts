// ── Types ──
export type {
  Movie,
  Person,
  CastMember,
  CrewMember,
  PersonCredit,
} from "./types/movie";
export type {
  ProviderDefinition,
  ProviderProtection,
  ProviderCapabilities,
} from "./types/provider";

// ── Providers ──
export {
  PROVIDERS,
  getProvider,
  getEnabledProviders,
  isProtectionEnabled,
  isSkipIntroEnabled,
  isUiEnabled,
  getProgressMode,
  getResumeMode,
} from "./providers/registry";
export {
  checkProviderHealth,
  rankProviders,
  checkAllProviders,
} from "./providers/health";
export type { HealthResult, HealthCache } from "./providers/health";

// ── API ──
export { createTmdbApi } from "./api/tmdb";

// ── Utils ──
export { getImageUrl, getTrailerKey, cn } from "./utils";

// ── Constants ──
export {
  IMAGE_BASE_URL,
  TMDB_API_BASE,
  MOVIE_GENRES,
  TV_GENRES,
} from "./constants/tmdb";

// ── Theme (Cinematic Void design tokens) ──
export {
  colors,
  typography,
  glass,
  shadows,
  spacing,
  radii,
  animation,
} from "./theme/tokens";
export type { ColorKey, TypographyKey, TypographyToken } from "./theme/tokens";

// ── State / Storage ──
export {
  createLocalStorageAdapter,
  createAsyncStorageAdapter,
  createMemoryAdapter,
} from "./state/storage";
export { useWatchHistory, buildStorageKey } from "./state/useWatchHistory";
export type {
  StorageAdapter,
  WatchProgress,
  WatchHistoryMap,
} from "./state/types";
export type {
  WatchHistoryState,
  WatchHistoryActions,
} from "./state/useWatchHistory";

// ── Security ──
export {
  buildGuardScript,
  buildContentReadyScript,
  buildBridgeScript,
  buildProgressTrackerScript,
  buildAllScripts,
  buildAllScriptsWithScriptlets,
  DEVTOOL_CONSOLE_MASK_SCRIPT,
  DEFAULT_AD_FULL_PATTERNS,
  DEFAULT_AD_SHORT_PATTERNS,
} from "./security/playerGuard";

// ── Playback (watch-progress engine + app media hook) ──
export { PlaybackEngine, buildEpisodeKey } from "./playback/engine";
export type { PlaybackState, PlaybackListener } from "./playback/engine";
export { MEDIA_HOOK_SCRIPT, buildMediaHookScript } from "./playback/mediaHook";
export type {
  ApiInterceptRule,
  CosmeticRuleBundle,
} from "./security/playerGuard";
export type { NavigationGuardConfig } from "./security/navigation-home";
export {
  isHomeEscape,
  isUniversalHomeEscape,
  looksHomeLikeWithoutId,
} from "./security/navigation-home";
export {
  buildAllScriptlets,
  getProviderScriptlets,
} from "./security/scriptlets";
