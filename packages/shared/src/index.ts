// ── Types ──
export type { Movie, Person, CastMember, CrewMember, PersonCredit } from './types/movie';
export type { ProviderDefinition, ProviderProtection } from './types/provider';

// ── Providers ──
export { PROVIDERS, getProvider, getEnabledProviders, isProtectionEnabled } from './providers/registry';
export { checkProviderHealth, rankProviders, checkAllProviders } from './providers/health';
export type { HealthResult, HealthCache } from './providers/health';

// ── API ──
export { createTmdbApi } from './api/tmdb';

// ── Utils ──
export { getImageUrl, getTrailerKey, cn } from './utils';

// ── Constants ──
export { IMAGE_BASE_URL, TMDB_API_BASE, MOVIE_GENRES, TV_GENRES } from './constants/tmdb';

// ── Theme (Cinematic Void design tokens) ──
export { colors, typography, glass, shadows, spacing, radii, animation } from './theme/tokens';
export type { ColorKey, TypographyKey, TypographyToken } from './theme/tokens';

// ── State / Storage ──
export { createLocalStorageAdapter, createAsyncStorageAdapter, createMemoryAdapter } from './state/storage';
export { useWatchlist } from './state/useWatchlist';
export { useWatchHistory, buildStorageKey } from './state/useWatchHistory';
export type {
  StorageAdapter,
  WatchProgress,
  Bookmark,
  WatchHistoryMap,
  BookmarkMap,
} from './state/types';
export type { WatchlistState, WatchlistActions } from './state/useWatchlist';
export type { WatchHistoryState, WatchHistoryActions } from './state/useWatchHistory';

// ── Security ──
export { buildGuardScript, buildContentReadyScript, buildBridgeScript, buildAllScripts, buildAllScriptsWithScriptlets, DEFAULT_AD_FULL_PATTERNS, DEFAULT_AD_SHORT_PATTERNS } from './security/playerGuard';
export { buildAllScriptlets, getProviderScriptlets } from './security/scriptlets';
