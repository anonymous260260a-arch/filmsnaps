// lib/movieProviders/index.ts
// Barrel export — everything you need from one place

export { PROVIDERS, getProvider, getEnabledProviders, isProtectionEnabled } from './providers';
export type { ProviderDefinition, ProviderProtection, ProviderSanitizer } from './types';
export { baseSanitize, stripTrackers } from './common';

// Protection engine
export {
  shouldBlockUrl,
  generateNavBlockerScript,
  generateRuntimeProtectionScript,
  rewriteAssetUrls,
  injectProtectionIntoHtml,
  getContentTypeFromUrl,
  getEmptyResponseBody,
  DEFAULT_BLOCKED_PATTERNS,
} from './protection';
export type { FilterContext } from './protection';

// ── Backward-compatible provider map (baseUrl only) ──
import { PROVIDERS } from './providers';

/**
 * @deprecated Use PROVIDERS array or getProvider() instead
 * Legacy map of provider id → baseUrl
 */
export const iframeProviders: Record<string, string> = Object.fromEntries(
  PROVIDERS.filter((p) => p.enabled !== false).map((p) => [p.id, p.baseUrl]),
);

/**
 * @deprecated Use PROVIDERS array or getProvider() instead
 * Legacy provider configs map
 */
export const providerConfigs: Record<string, any> = {};
