/**
 * @filmsnaps/adblock-config — shared types, validator, and loader for the
 * v5 split config (providers.json + filters.txt).
 *
 * This package is the single source of truth for the config schema.
 * Every consumer (filter-compiler, web app, build scripts) reads from here,
 * ensuring the Kotlin-native BlocklistConfig stays in sync with the JSON.
 */

export type {
  BlocklistConfig,
  VideoDetectionConfig,
  AlwaysBlockConfig,
  ProviderConfig,
  NavigationGuardConfig,
  ApiInterceptRule,
} from "./types.js";

export { validateConfig } from "./validator.js";
export type { ValidationResult } from "./validator.js";

export {
  loadBlocklistConfig,
  loadFiltersTxt,
  resolveConfigPath,
} from "./loader.js";
