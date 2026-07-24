// lib/movieProviders/index.ts
// Barrel export — everything you need from one place

// Re-export provider registry from shared package (single source of truth)
export { PROVIDERS, getProvider, getEnabledProviders, isProtectionEnabled } from '@filmsnaps/shared/providers';
export type { ProviderDefinition, ProviderProtection } from '@filmsnaps/shared/types';
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
