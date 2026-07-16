/**
 * Filter Compiler — Runtime API
 *
 * Loads the compiled filter engine (serialized by compile.ts) and
 * provides high-level matching functions for URL blocking, cosmetic CSS,
 * and per-provider allowlist/blocklist lookups.
 *
 * Web (Next.js API routes): loads from filesystem at startup
 * Mobile: loads from serialized buffer at app init
 */

import { FiltersEngine, Request } from '@cliqz/adblocker';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ──────────────────────────────────────────────────────────

export interface MatchResult {
  blocked: boolean;
  matchedRule?: string;
  category: 'network' | 'cosmetic' | 'allowlist' | 'none';
}

export interface FilterEngineOptions {
  /** Path to the serialized engine binary file */
  enginePath?: string;
  /** Pre-deserialized engine (for mobile/browser use) */
  engine?: FiltersEngine;
}

// ── Singleton ──────────────────────────────────────────────────────

let _engine: FiltersEngine | null = null;
let _enginePath: string | null = null;

/**
 * Get the default engine path relative to this package's build directory.
 */
export function getDefaultEnginePath(): string {
  return join(__dirname, '..', 'build', 'compiled-engine.bin');
}

/**
 * Load (or return cached) filter engine.
 *
 * In Node.js environments, reads the serialized engine from disk.
 * In browser/mobile, pass a pre-deserialized engine via options.
 */
export async function loadFilterEngine(options?: FilterEngineOptions): Promise<FiltersEngine> {
  if (_engine) return _engine;

  if (options?.engine) {
    _engine = options.engine;
    return _engine;
  }

  const enginePath = options?.enginePath || getDefaultEnginePath();

  if (!existsSync(enginePath)) {
    throw new Error(
      `Filter engine not found at: ${enginePath}. ` +
      'Run `pnpm compile` in packages/filter-compiler first.',
    );
  }

  const buffer = readFileSync(enginePath);
  _engine = FiltersEngine.deserialize(new Uint8Array(buffer));
  _enginePath = enginePath;

  console.log(`[FilterEngine] Loaded from ${enginePath}`);
  return _engine;
}

/**
 * Check if the filter engine is loaded.
 */
export function isEngineLoaded(): boolean {
  return _engine !== null;
}

/**
 * Reset the cached engine (useful for testing / hot-reload).
 */
export function resetEngine(): void {
  _engine = null;
  _enginePath = null;
}

// ── URL Matching ───────────────────────────────────────────────────

/**
 * Check whether a URL should be blocked by the filter engine.
 *
 * @param engine - The loaded filter engine
 * @param url - The full URL to check
 * @param sourceUrl - The URL of the page making the request
 * @param type - Resource type hint (e.g., 'script', 'image', 'sub_frame', 'xmlhttprequest')
 * @returns MatchResult with block decision and category
 */
export function matchUrl(
  engine: FiltersEngine,
  url: string,
  sourceUrl: string,
  type?: string,
): MatchResult {
  try {
    // Construct a Request object for the engine
    const request = Request.fromRawDetails({
      url,
      sourceUrl,
      type: (type ?? 'other') as any,
    });

    // Run through @cliqz/adblocker engine
    const match = engine.match(request);

    if (match.redirect) {
      return {
        blocked: true,
        matchedRule: `redirect: ${JSON.stringify(match.redirect.contentType)}`,
        category: 'network',
      };
    }

    if (match.match) {
      return {
        blocked: true,
        matchedRule: match.filter?.toString() || 'filter match',
        category: 'network',
      };
    }

    // URL was explicitly allowed (exception rule)
    if (match.exception) {
      return { blocked: false, category: 'allowlist' };
    }

    return { blocked: false, category: 'none' };
  } catch {
    // If URL parsing or matching fails, don't block (safety)
    return { blocked: false, category: 'none' };
  }
}

/**
 * Check whether a URL matches the allowlist (exception rules).
 * Returns true if the URL should NOT be blocked (allowlisted).
 */
export function isAllowlisted(
  engine: FiltersEngine,
  url: string,
  sourceUrl: string,
): boolean {
  try {
    const request = Request.fromRawDetails({ url, sourceUrl, type: 'document' });
    const match = engine.match(request);
    return match.exception !== undefined;
  } catch {
    return false;
  }
}

// ── Cosmetics ──────────────────────────────────────────────────────

/**
 * Get the cosmetic CSS rules that should be injected into a page
 * loaded from the given URL.
 *
 * @param engine - The loaded filter engine
 * @param pageUrl - The URL of the page being loaded
 * @returns CSS string to inject into the page
 */
export function getCosmeticCSS(
  engine: FiltersEngine,
  pageUrl: string,
): string {
  try {
    const parsedUrl = new URL(pageUrl);
    const cosmetics = engine.getCosmeticsFilters({
      url: pageUrl,
      hostname: parsedUrl.hostname,
      domain: parsedUrl.hostname,
      getBaseRules: true,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromDOM: false,
      getRulesFromHostname: true,
      hidingStyle: '{ display: none !important; }',
    });

    const css = cosmetics?.styles || '';

    if (css) {
      return `/* Filmsnaps Adblocker — Cosmetic CSS */\n${css}`;
    }

    return '';
  } catch {
    return '';
  }
}

/**
 * Get filter stats from the engine.
 */
export function getEngineStats(engine: FiltersEngine): {
  networkFilters: number;
  cosmeticFilters: number;
  totalFilters: number;
} {
  const filters = engine.getFilters();
  return {
    networkFilters: filters.networkFilters.length,
    cosmeticFilters: filters.cosmeticFilters.length,
    totalFilters: filters.networkFilters.length + filters.cosmeticFilters.length,
  };
}
