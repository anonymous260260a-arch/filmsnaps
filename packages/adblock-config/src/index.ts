/**
 * @filmsnaps/adblock-config — shared types, validator, and loader for blocklist.json.
 *
 * This package is the single source of truth for the blocklist.json schema.
 * Every consumer (filter-compiler, web app, build scripts) reads from here,
 * ensuring the Kotlin-native BlocklistConfig stays in sync with the JSON.
 */

export type { BlocklistConfig, VideoDetectionConfig, AlwaysBlockConfig, ProviderConfig } from './types.js';

export { validateConfig } from './validator.js';
export type { ValidationResult } from './validator.js';

export { loadBlocklistConfig } from './loader.js';
