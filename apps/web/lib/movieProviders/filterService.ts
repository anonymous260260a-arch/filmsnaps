/**
 * Filter Service — @cliqz/adblocker engine for URL-level ad/tracker/popup
 * blocking in server-side proxy routes.
 *
 * The engine is loaded at module import time (top-level side effect), not
 * lazily. This avoids closure/scope issues with turbopack module caching.
 *
 * Falls back to legacy pattern-based matching if the engine binary hasn't
 * been compiled yet or fails to load.
 *
 * ## Debugging
 * Set `DEBUG=filmsnaps:filter` env var to see verbose per-URL match logs:
 *   DEBUG=filmsnaps:filter pnpm dev:web
 */

import { FiltersEngine, Request } from '@cliqz/adblocker';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Debug logging ──────────────────────────────────────────────────

const DEBUG = typeof process !== 'undefined' && process.env?.DEBUG === 'filmsnaps:filter';

function debugLog(...args: any[]) {
  if (DEBUG) console.log('[FilterEngine]', ...args);
}

let _matchCount = 0;
let _blockCount = 0;

// ── Types ──────────────────────────────────────────────────────────

export interface FilterMatchResult {
  blocked: boolean;
  matchedRule?: string;
  source: 'engine' | 'legacy' | 'none';
}

// ── Engine cache (globalThis to survive module re-evaluation) ───────

declare global {
  var __filmsnapsFilterEngine: FiltersEngine | null;
  var __filmsnapsFilterLoaded: boolean;
}

globalThis.__filmsnapsFilterEngine ??= null;
globalThis.__filmsnapsFilterLoaded ??= false;

// ── Load engine at module init ─────────────────────────────────────

function loadEngine(): FiltersEngine | null {
  const paths = [
    // Hardcoded absolute path
    'M:/filmsnaps-main/packages/filter-compiler/build/compiled-engine.bin',
    // join from process.cwd()
    join(process.cwd(), '..', '..', 'packages', 'filter-compiler', 'build', 'compiled-engine.bin'),
  ];

  let enginePath = '';
  for (const p of paths) {
    if (existsSync(p)) {
      enginePath = p;
      break;
    }
  }

  if (!enginePath) {
    console.warn('[FilterService] Engine binary not found. Run: pnpm compile:filters');
    return null;
  }

  try {
    const buffer = readFileSync(enginePath);
    const engine = FiltersEngine.deserialize(new Uint8Array(buffer));
    const stats = engine.getFilters();
    console.log(
      `[FilterService] Loaded: ${stats.networkFilters.length} network + ${stats.cosmeticFilters.length} cosmetic filters`,
    );
    return engine;
  } catch (err) {
    console.error('[FilterService] Error loading engine:', err);
    return null;
  }
}

// Initialize — runs once when this module is first imported
if (!globalThis.__filmsnapsFilterLoaded) {
  globalThis.__filmsnapsFilterEngine = loadEngine();
  globalThis.__filmsnapsFilterLoaded = true;
}

function getEngine(): FiltersEngine | null {
  return globalThis.__filmsnapsFilterEngine;
}

// ── Public API ─────────────────────────────────────────────────────

export function isFilterEngineLoaded(): boolean {
  return getEngine() !== null;
}

export function getFilterStats(): { matches: number; blocked: number } {
  return { matches: _matchCount, blocked: _blockCount };
}

export function getFilterEngine(): FiltersEngine | null {
  return getEngine();
}

/**
 * Match a URL against the filter engine.
 * Returns the match result, or null if the engine isn't loaded.
 */
export function matchFilterUrl(
  url: string,
  sourceUrl: string,
  type?: string,
): FilterMatchResult | null {
  const engine = getEngine();
  if (!engine) return null;

  try {
    const request = Request.fromRawDetails({
      url,
      sourceUrl,
      type: (type ?? 'other') as any,
    });

    const match = engine.match(request);

    _matchCount++;

    if (match.redirect) {
      _blockCount++;
      const rule = `redirect: ${JSON.stringify(match.redirect.contentType)}`;
      debugLog('BLOCKED (redirect)  type=%s  url=%s  rule=%s', type || 'other', url, rule);
      return { blocked: true, matchedRule: rule, source: 'engine' };
    }

    if (match.match) {
      _blockCount++;
      const rule = match.filter?.toString() || 'filter match';
      debugLog('BLOCKED (match)     type=%s  url=%s  rule=%s', type || 'other', url, rule);
      return { blocked: true, matchedRule: rule, source: 'engine' };
    }

    if (match.exception) {
      debugLog('ALLOWED (exception)  type=%s  url=%s', type || 'other', url);
      return { blocked: false, source: 'engine' };
    }

    debugLog('PASS (no match)  type=%s  url=%s', type || 'other', url);
    return { blocked: false, source: 'engine' };
  } catch (err) {
    debugLog('ERROR matching  url=%s  err=%s', url, err);
    return null;
  }
}

/**
 * Check if a URL is explicitly allowlisted by the engine.
 */
export function isUrlAllowlisted(url: string, sourceUrl: string): boolean {
  const engine = getEngine();
  if (!engine) return false;

  try {
    const request = Request.fromRawDetails({ url, sourceUrl, type: 'document' });
    const match = engine.match(request);
    return match.exception !== undefined;
  } catch {
    return false;
  }
}

/**
 * Get cosmetic CSS rules for a given page URL.
 */
export function getFilterCosmeticCSS(pageUrl: string): string {
  const engine = getEngine();
  if (!engine) return '';

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

    return cosmetics?.styles || '';
  } catch {
    return '';
  }
}

export function resetFilterEngine(): void {
  globalThis.__filmsnapsFilterEngine = null;
  globalThis.__filmsnapsFilterLoaded = false;
  _matchCount = 0;
  _blockCount = 0;
}
