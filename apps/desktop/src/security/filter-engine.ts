/**
 * FilmSnaps Desktop — @cliqz/adblocker Filter Engine
 *
 * CJS-compatible singleton wrapper around FiltersEngine (Aho-Corasick-based).
 * Loads the serialized engine binary that the filter-compiler package produces.
 *
 * Module compatibility:
 *   - @cliqz/adblocker ships CJS — imported via require()
 *   - @filmsnaps/filter-compiler is ESM — bridged via dynamic import() when needed
 *
 * Path resolution:
 *   - Dev: relative to dist/ dir (__dirname), walking up to repo root
 *   - Production: from process.resourcesPath (extraResources in electron-builder)
 */

import { join, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { app } from "electron";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MatchResult {
  blocked: boolean;
  matchedRule?: string;
  category: "network" | "cosmetic" | "allowlist" | "none";
}

export interface EngineStats {
  networkFilters: number;
  cosmeticFilters: number;
  totalFilters: number;
}

// ── Singleton state ─────────────────────────────────────────────────────────

let _engine: any = null;
let _loadAttempted = false;
let _engineReadyPromise: Promise<any | null> | null = null;

/**
 * Resolve the path to compiled-engine.bin.
 * Dev: walk up from __dirname (dist/security/) to repo root, then into
 *      packages/filter-compiler/build/
 * Prod: read extraResources at process.resourcesPath/filter-engine/
 */
function resolveEnginePath(): string {
  if ((app as any).isPackaged) {
    // Production: extraResources copies to resourcesPath/filter-engine/
    return join(process.resourcesPath, "filter-engine", "compiled-engine.bin");
  }
  // Dev: __dirname = apps/desktop/dist/security/ → walk up to repo root
  // apps/desktop/dist/security → apps/desktop/dist → apps/desktop → repo root
  const repoRoot = resolveRepoRoot();
  return join(
    repoRoot,
    "packages",
    "filter-compiler",
    "build",
    "compiled-engine.bin",
  );
}

/**
 * Walk up from __dirname looking for pnpm-workspace.yaml (repo root marker).
 */
function resolveRepoRoot(): string {
  let dir = dirname(__dirname); // dist/ → apps/desktop
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume CWD is repo root
  return process.cwd();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Kick off (or return the cached) filter-engine load as a promise.
 *
 * The 7MB serialized engine binary is read and deserialized OFF the startup
 * critical path: callers await `initFilterEngine()` when they actually need
 * R4 matching, so the app window paints first. The promise is cached, so any
 * number of callers share one load.
 */
export function initFilterEngine(): Promise<any | null> {
  if (_engineReadyPromise) return _engineReadyPromise;
  if (_engine) return Promise.resolve(_engine);
  if (_loadAttempted) return Promise.resolve(null); // Already tried and failed

  _loadAttempted = true;

  _engineReadyPromise = (async () => {
    const enginePath = resolveEnginePath();
    if (!existsSync(enginePath)) {
      console.warn(
        `[FilterEngine] Binary not found at: ${enginePath}. ` +
          "Run `pnpm --filter @filmsnaps/filter-compiler compile` first. " +
          "Falling back to legacy blocklist.",
      );
      return null;
    }

    try {
      const { FiltersEngine } = require("@cliqz/adblocker");
      const buffer = readFileSync(enginePath);
      _engine = FiltersEngine.deserialize(new Uint8Array(buffer));
      const stats = getEngineStats();
      console.log(
        `[FilterEngine] Loaded from ${enginePath} — ` +
          `${stats.networkFilters} network + ${stats.cosmeticFilters} cosmetic filters`,
      );
      return _engine;
    } catch (err) {
      console.error("[FilterEngine] Failed to load:", err);
      return null;
    }
  })();

  return _engineReadyPromise;
}

/**
 * Load (or return cached) filter engine from serialized binary.
 * Returns null if the engine binary is not found (callers should fall back
 * to legacy blocking or a no-op engine).
 *
 * Deferred variant of initFilterEngine() — kept for callers that prefer to
 * fire-and-forget (the promise is shared with initFilterEngine()).
 */
export async function loadFilterEngine(): Promise<any | null> {
  return initFilterEngine();
}

/**
 * Block until the filter engine is ready. Returns the engine (or null).
 * Safe to call from any async context — resolves immediately if already loaded.
 */
export async function awaitFilterEngineReady(): Promise<any | null> {
  return initFilterEngine();
}

/**
 * Synchronous variant — loads the engine immediately, blocking the event loop.
 *
 * CRITICAL: Used at app startup (app.whenReady) before the main window loads,
 * so the 100k+ adblocking rules are deserialized and ready BEFORE any webview
 * navigates. Without this, the first N requests to the provider embed will
 * bypass the filter engine (R4) entirely.
 *
 * In CJS environment (Electron main process), require() is synchronous so
 * the entire load is just readFileSync + FiltersEngine.deserialize.
 */
export function loadFilterEngineSync(): any | null {
  if (_engine) return _engine;
  if (_loadAttempted) return null;
  // If an async load is already in flight, don't double-load — the async
  // path will resolve the same engine shortly. Sync callers are non-critical.
  if (_engineReadyPromise) return null;

  _loadAttempted = true;

  const enginePath = resolveEnginePath();
  if (!existsSync(enginePath)) {
    console.warn(
      `[FilterEngine] Binary not found at: ${enginePath}. ` +
        "Run `pnpm --filter @filmsnaps/filter-compiler compile` first. " +
        "Falling back to legacy blocklist.",
    );
    return null;
  }

  try {
    const { FiltersEngine } = require("@cliqz/adblocker");
    const buffer = readFileSync(enginePath);
    _engine = FiltersEngine.deserialize(new Uint8Array(buffer));
    const stats = getEngineStats();
    console.log(
      `[FilterEngine] Sync loaded from ${enginePath} — ` +
        `${stats.networkFilters} network + ${stats.cosmeticFilters} cosmetic filters` +
        ` (${stats.totalFilters} total filters)`,
    );
    return _engine;
  } catch (err) {
    console.error("[FilterEngine] Sync load failed:", err);
    return null;
  }
}

/**
 * Check whether the engine has been loaded.
 */
export function isEngineLoaded(): boolean {
  return _engine !== null;
}

/**
 * Reset the cached engine (useful for testing / hot-reload).
 */
export function resetEngine(): void {
  _engine = null;
  _loadAttempted = false;
  _engineReadyPromise = null;
}

/**
 * Check whether a URL should be blocked by the filter engine.
 * Returns MatchResult with block decision.
 *
 * @param url - The full URL to check
 * @param sourceUrl - The URL of the page making the request
 * @param type - Resource type hint ('script', 'image', 'sub_frame', 'xmlhttprequest', etc.)
 */
export function matchUrl(
  url: string,
  sourceUrl: string,
  type?: string,
): MatchResult {
  if (!_engine) return { blocked: false, category: "none" };

  try {
    const { Request } = require("@cliqz/adblocker");
    const request = Request.fromRawDetails({
      url,
      sourceUrl,
      type: (type ?? "other") as any,
    });

    const match = _engine.match(request);

    if (match.redirect) {
      return {
        blocked: true,
        matchedRule: `redirect: ${JSON.stringify(match.redirect.contentType)}`,
        category: "network",
      };
    }

    if (match.match) {
      return {
        blocked: true,
        matchedRule: match.filter?.toString() || "filter match",
        category: "network",
      };
    }

    // URL was explicitly allowed (exception rule)
    if (match.exception) {
      return { blocked: false, category: "allowlist" };
    }

    return { blocked: false, category: "none" };
  } catch {
    // If URL parsing or matching fails, don't block (safety)
    return { blocked: false, category: "none" };
  }
}

/**
 * Get the cosmetic CSS rules that should be injected into a page.
 *
 * @param pageUrl - The URL of the page being loaded
 * @returns CSS string to inject, or empty string
 */
export function getCosmeticCSS(pageUrl: string): string {
  if (!_engine) return "";

  try {
    const parsedUrl = new URL(pageUrl);
    const cosmetics = _engine.getCosmeticsFilters({
      url: pageUrl,
      hostname: parsedUrl.hostname,
      domain: parsedUrl.hostname,
      getBaseRules: true,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromDOM: false,
      getRulesFromHostname: true,
      hidingStyle: "{ display: none !important; }",
    });

    const css = cosmetics?.styles || "";
    if (css) {
      return `/* FilmSnaps Adblocker — Cosmetic CSS */\n${css}`;
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Check whether a URL is allowlisted by exception rules.
 */
export function isAllowlisted(url: string, sourceUrl: string): boolean {
  if (!_engine) return false;

  try {
    const { Request } = require("@cliqz/adblocker");
    const request = Request.fromRawDetails({
      url,
      sourceUrl,
      type: "document",
    });
    const match = _engine.match(request);
    return match.exception !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if a hostname appears in a Set as a suffix match (subdomain allow).
 * Handles subdomain matching: "cdn.example.com" matches Set containing "example.com".
 */
export function checkDomainSuffix(hostname: string, set: Set<string>): boolean {
  if (!hostname || !set || set.size === 0) return false;

  const lower = hostname.toLowerCase();

  // Exact match first (fast path)
  if (set.has(lower)) return true;

  // Suffix match: check if any entry is a suffix of the hostname
  for (const entry of set) {
    if (lower === entry || lower.endsWith("." + entry)) return true;
  }

  return false;
}

/**
 * Get filter stats from the engine.
 */
export function getEngineStats(): EngineStats {
  if (!_engine)
    return { networkFilters: 0, cosmeticFilters: 0, totalFilters: 0 };

  try {
    const filters = _engine.getFilters();
    return {
      networkFilters: filters.networkFilters?.length || 0,
      cosmeticFilters: filters.cosmeticFilters?.length || 0,
      totalFilters:
        (filters.networkFilters?.length || 0) +
        (filters.cosmeticFilters?.length || 0),
    };
  } catch {
    return { networkFilters: 0, cosmeticFilters: 0, totalFilters: 0 };
  }
}
