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
  MediaType,
  ProviderType,
  ProviderPlatform,
  StreamSourceConfig,
  EmbedOptions,
} from "./types/provider";

// ── Providers ──
export {
  PROVIDERS,
  getProvider,
  getEnabledProviders,
  getProvidersForPlatform,
  isProtectionEnabled,
  isSkipIntroEnabled,
  isUiEnabled,
  getProgressMode,
  getResumeMode,
  filterAnimeProviders,
  getNonAnimeProviders,
  getProvidersForMode,
  getDefaultProviderId,
  resolveInitialProviderId,
  getProviderType,
  isDirectProvider,
  PLATFORM_DEFAULT_PROVIDER_IDS,
  ANIME_DEFAULT_PROVIDER_ID,
  type AppMode,
} from "./providers/registry";
export {
  checkProviderHealth,
  rankProviders,
  checkAllProviders,
} from "./providers/health";
export type { HealthResult, HealthCache } from "./providers/health";

// ── Stream selection / resolution pipeline (canonical) ──
export {
  rankStreams,
  selectBestStream,
  effectiveQuality,
  sizeOf,
  parseLinkLanguages,
  parseLanguages,
  extractCDN,
  isDownloadOnlyLink,
  isCamPrint,
  isDemotedHost,
  linkContainerLabel,
  getLanguageSection,
  QUALITY_ORDER,
  CDN_RANK,
  SEEK_HEADROOM,
  CDN_SUSTAIN_FACTOR,
  DEFAULT_SPEED_MBPS,
  DEFAULT_RUNTIME_MINUTES,
  TV_RUNTIME_MINUTES,
} from "./providers/streamSelector";
export type {
  SelectOptions,
  StreamSelection,
  LinkLanguage,
  PreferredLanguage,
} from "./providers/streamSelector";
export {
  resolveStreams,
  buildStreamSourceUrl,
} from "./providers/resolveStreams";
export type {
  ResolveStreamsParams,
  ResolveStreamsResult,
} from "./providers/resolveStreams";
export {
  getStreamSelector,
  registerStreamSelector,
  defaultSelector,
} from "./providers/selectors";
export type { DirectStreamSelector } from "./providers/selectors";
export {
  getStreamSourceAdapter,
  registerStreamSourceAdapter,
  hasStreamSourceAdapter,
  hdhubAdapter,
  falixAdapter,
} from "./providers/sources";
export type {
  StreamLink,
  StreamBundle,
  StreamSourceAdapter,
  StreamSelectionSettings,
} from "./providers/sources/types";
export type { FalixFile, FalixData } from "./providers/sources/falix";
export {
  cleanStreamUrl,
  extractSource,
  parseStreamEntry,
  computePriority,
  createHdHubAdapter,
} from "./providers/sources/hdhub";
export {
  mapFalixFiles,
  extractEpisodeFiles,
  parseFalixSize,
  parseFalixCodec,
  parseFalixAudio,
  createFalixAdapter,
} from "./providers/sources/falix";
export {
  FALIX_API_BASE,
  buildFalixDownloadUrl,
  sortByQuality,
  parseSizeToBytes,
  extractLanguages,
  getFileByTier,
  TIER_LABELS,
  TIER_DESCRIPTIONS,
} from "./utils/falix";

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
export {
  useWatchHistory,
  buildStorageKey,
  aggregateHistory,
} from "./state/useWatchHistory";
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
