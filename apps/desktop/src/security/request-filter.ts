/**
 * FilmSnaps Desktop — Network-Level Request Filtering
 *
 * Applies Electron's session.webRequest.onBeforeRequest to block
 * ads, trackers, malware, and downloads at the Chromium network layer.
 *
 * Uses the R0-R8 rule cascade:
 *   R0:  Session trust — allow unconditionally
 *   R1:  Provider allowlist — allow
 *   R2:  Global CDN allowlist — allow
 *   R3:  Provider embed domain — allow
 *   R4:  @cliqz/adblocker FiltersEngine — Aho-Corasick O(L) matching
 *   R5:  Always-block domains (blocklist.json) — block
 *   R6:  Always-block path patterns (blocklist.json) — block
 *   R7:  Legacy blocklist.ts fallback — block
 *   R8:  Default allow
 *
 * KEY ADVANTAGE over mobile WebView: This runs in the Electron main process
 * BEFORE any JavaScript executes in the renderer. Provider scripts CANNOT
 * bypass, override, or race-condition this filter. It is the strongest
 * available defense layer.
 *
 * Session trust: Once a host serves video content (.ts, .m3u8, .mp4),
 * all future requests to that host are allowed unconditionally (R0).
 * This prevents CDN breakage from aggressive EasyList rules.
 */

import { session as electronSession, Session } from "electron";
import { join } from "path";
import { shouldBlockRequest, checkResponseForTrust } from "./rule-cascade";
import { initFilterEngine } from "./filter-engine";
import type { SessionTrustManager } from "./session-trust";

// ── State ───────────────────────────────────────────────────────────────────

/**
 * Trust manager per session. Stored weakly so it's cleaned up when
 * the session partition is destroyed.
 */
const trustManagers = new WeakMap<
  Session,
  InstanceType<typeof SessionTrustManager>
>();

/**
 * Tracks whether we've already installed the webRequest handlers for a session.
 * Key: session partition name string.
 *
 * CRITICAL: Without this guard, every provider:init IPC call (which happens
 * on every provider switch and on every mount) adds ANOTHER onBeforeRequest
 * handler. Handlers accumulate and ALL run on every request — the first one
 * to return { cancel: true } blocks it, but they ALL process every request
 * wasting CPU.
 *
 * Even worse: when the session trust manager is replaced (newed up fresh on
 * each call), the NEW trust manager has no trust entries. So previously
 * trusted CDN hosts get blocked until they serve video content AGAIN.
 */
const initializedSessions = new Set<string>();
const SESSION_PARTITION = "filmsnaps-provider";

/**
 * Mutable provider ID used by the onBeforeRequest handler closure.
 *
 * CRITICAL: The session is pre-created at app startup with createProviderSession()
 * BEFORE any webview navigates. This means the onBeforeRequest handler is
 * installed ONCE with a closure that references this module-level variable.
 *
 * When provider:init fires later (from useDesktopProviderSession in React),
 * setBlockingProviderId() updates this variable, and ALL subsequent requests
 * use the correct provider context for R1/R3 per-provider rules.
 *
 * Without this indirection, the handler would permanently use whatever
 * providerId was passed to createProviderSession (undefined for pre-creation),
 * and per-provider allowlists would never apply.
 */
let _currentBlockingProviderId: string | undefined;

/**
 * Update the mutable provider ID used by the webRequest handler closure.
 * Called from the provider:init IPC handler when the user switches providers.
 */
export function setBlockingProviderId(providerId?: string): void {
  if (providerId && providerId !== _currentBlockingProviderId) {
    console.log(
      `[SecurityFilter] Blocking provider updated: ${_currentBlockingProviderId ?? "none"} → ${providerId}`,
    );
  }
  _currentBlockingProviderId = providerId;
}

/**
 * Read the mutable provider ID used by the webRequest handler closure.
 * Used by the main-process provider security layer (CDP injection / nav guard)
 * to compute the per-provider domain allowlist at webview attach time.
 */
export function getCurrentBlockingProviderId(): string | undefined {
  return _currentBlockingProviderId;
}

// ── Exports ─────────────────────────────────────────────────────────────────

/**
 * Get the session trust manager for a given session.
 * Returns undefined if the session hasn't been registered.
 */
export function getTrustManager(
  session: Session,
): InstanceType<typeof SessionTrustManager> | undefined {
  return trustManagers.get(session);
}

/**
 * Create an isolated session partition for provider content.
 *
 * This session has:
 *   - No persistent cache (cleared on close)
 *   - R0-R8 cascade network-level request filtering
 *   - Session trust for video CDNs
 *   - No cookie sharing with the main app session
 *
 * CRITICAL: The webRequest handler is installed ONLY ONCE per session.
 * Subsequent calls reuse the existing session and trust manager. Without
 * this guard, every provider:init IPC call adds another handler that
 * re-processes every request.
 *
 * @param providerId - Optional provider ID for per-provider blocking rules
 */
export function createProviderSession(providerId?: string): Session {
  const providerSession = electronSession.fromPartition(
    `persist:${SESSION_PARTITION}`,
    { cache: false },
  );

  // Idempotency check: if we already initialized this session, reuse it
  if (initializedSessions.has(SESSION_PARTITION)) {
    console.log(
      `[SecurityFilter] Reusing existing session (provider: ${providerId})`,
    );

    // Still update the provider context for the existing trust manager
    const existingTm = trustManagers.get(providerSession);
    if (existingTm) {
      console.log(
        `[SecurityFilter] Session reusing trust manager with ${existingTm.size} trusted hosts`,
      );
    }

    return providerSession;
  }

  initializedSessions.add(SESSION_PARTITION);

  // ── Provider preload (PRIMARY in-page security) ──
  // The session-level preload runs at document-start in the main frame AND
  // every child frame (nodeIntegrationInSubFrames: true on the webview) of
  // EVERY renderer process spawned for this partition — including cross-site
  // navigations that swap renderer processes. This is the reload-immune
  // guarantee CDP could not provide. Sandboxed: no Node APIs beyond electron.
  try {
    // This module compiles to dist/security/request-filter.js, so __dirname
    // is dist/security — the preload lives one level up at dist/preload/.
    // registerPreloadScript requires an ABSOLUTE path (Electron 42; the old
    // setPreloads is deprecated).
    const preloadPath = join(__dirname, "..", "preload", "provider-preload.js");
    providerSession.registerPreloadScript({
      filePath: preloadPath,
      type: "frame",
    });
    console.log(`[SecurityFilter] Provider preload registered: ${preloadPath}`);
  } catch (err) {
    console.error("[SecurityFilter] Failed to set provider preload:", err);
  }

  // Kick off the filter engine load asynchronously (non-blocking). The engine
  // is also started at app.whenReady() via initFilterEngine(), so this is
  // typically a cache hit. onBeforeRequest awaits the same shared promise
  // before running R4, so no request ever bypasses the engine.
  initFilterEngine().then((engine) => {
    if (engine) {
      const stats = getEngineStats();
      console.log(
        `[SecurityFilter] Filter engine ready: ${stats.networkFilters} network + ${stats.cosmeticFilters} cosmetic filters`,
      );
    }
  });

  // Apply R0-R8 cascade request filtering
  setupRequestFilter(providerSession, providerId);

  // Track responses for session trust (R0)
  setupTrustTracking(providerSession);

  return providerSession;
}

// ── Import helpers (lazy) ────────────────────────────────────────────

/**
 * Get engine stats from the filter engine module.
 */
function getEngineStats(): {
  networkFilters: number;
  cosmeticFilters: number;
  totalFilters: number;
} {
  // Import from filter-engine module
  try {
    const { getEngineStats: stats } = require("./filter-engine");
    return stats();
  } catch {
    return { networkFilters: 0, cosmeticFilters: 0, totalFilters: 0 };
  }
}

// ── Request filter setup ─────────────────────────────────────────────────────

/**
 * Set up the webRequest.onBeforeRequest handler on a session.
 * Uses the R0-R8 rule cascade for blocking decisions.
 */
function setupRequestFilter(session: Session, providerId?: string): void {
  // Create trust manager for this session
  const trustManager = new (require("./session-trust").SessionTrustManager)(
    getVideoDetectionConfig(),
  );
  trustManagers.set(session, trustManager);

  // Pre-seed trust with known provider CDN and embed domains
  // so video-serving CDNs are trusted (R0) from the very first request
  preSeedTrustFromConfig(trustManager);

  // Set the initial provider ID so per-provider rules apply from the start
  if (providerId) {
    _currentBlockingProviderId = providerId;
  }

  // Block outgoing requests using the R0-R8 cascade
  // NOTE: Uses module-level _currentBlockingProviderId so the provider
  // context can be updated without reinstalling the handler.
  // Block outgoing requests using the R0-R8 cascade.
  // NOTE: Uses module-level _currentBlockingProviderId so the provider
  // context can be updated without reinstalling the handler.
  //
  // The callback is async: it awaits the filter engine load before running
  // R4 so the engine is always ready when the cascade reaches it. Electron
  // supports promise-returning onBeforeRequest listeners. Requests that never
  // reach the engine (data/blob/about/file URIs) short-circuit without await.
  session.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    async (details, callback) => {
      const url = details.url;

      // Quick check: never block data/blob/file URIs
      if (
        url.startsWith("data:") ||
        url.startsWith("blob:") ||
        url.startsWith("about:") ||
        url.startsWith("file:")
      ) {
        return callback({});
      }

      // Ensure the filter engine (R4) is loaded before running the cascade.
      // Resolves immediately once initFilterEngine() completes (app startup
      // or the fire-and-forget in createProviderSession). If the engine can't
      // load, matchUrl() no-ops and R5-R8 still apply.
      await initFilterEngine();

      // Run the R0-R8 cascade using the mutable provider ID
      const sourceUrl =
        (details as any).initiator || (details as any).documentUrl || url;
      const decision = shouldBlockRequest({
        url,
        sourceUrl,
        providerId: _currentBlockingProviderId, // mutable, not closure-captured
        trustManager,
        type: details.resourceType,
      });

      if (decision.blocked) {
        console.log(
          `[SecurityFilter] Blocked [${decision.rule}]: ${decision.reason} — ${url.substring(0, 120)}`,
        );
        return callback({ cancel: true });
      }

      return callback({});
    },
  );

  console.log(
    `[SecurityFilter] R0-R8 cascade active${providerId ? ` (provider: ${providerId})` : ""}`,
  );
}

// ── Session trust tracking ──────────────────────────────────────────────────

/**
 * Track responses to build session trust (R0).
 * When a response has video content-type or URL patterns,
 * the host is trusted for subsequent requests.
 */
function setupTrustTracking(session: Session): void {
  // Check responses for video content indicators
  session.webRequest.onCompleted({ urls: ["*://*/*"] }, (details) => {
    const trustManager = trustManagers.get(session);
    if (!trustManager) return;

    // Get the Content-Type from response headers
    let contentType: string | undefined;
    if (details.responseHeaders) {
      const ctHeader =
        details.responseHeaders["content-type"] ||
        details.responseHeaders["Content-Type"];
      if (ctHeader && ctHeader.length > 0) {
        contentType = ctHeader[0];
      }
    }

    // Check if this response indicates video content
    const trusted = checkResponseForTrust(
      trustManager,
      details.url,
      contentType,
    );
    if (trusted) {
      console.log(
        `[SecurityFilter] Trust added: ${new URL(details.url).hostname} (video content detected)`,
      );
    }
  });

  // Also check redirect responses for video content
  session.webRequest.onBeforeRedirect({ urls: ["*://*/*"] }, (details) => {
    const trustManager = trustManagers.get(session);
    if (!trustManager) return;

    // The redirect destination might be a video CDN
    try {
      const redirectHost = new URL(details.redirectURL).hostname;
      trustManager.addTrust(redirectHost);
    } catch {
      // Ignore invalid URLs
    }
  });
}

/**
 * Get video detection config from provider-config module.
 */
function getVideoDetectionConfig(): any {
  try {
    const { getVideoDetectionConfig: getConfig } = require("./provider-config");
    return getConfig();
  } catch {
    return null;
  }
}

// ── Pre-seed trust ────────────────────────────────────────────────────────

/**
 * Pre-seed trust from blocklist.json — collects all known CDN/embed domains
 * across all providers and pre-seeds them into the session trust manager.
 * This ensures video-serving CDNs are trusted (R0) from the very first
 * request without waiting for a video content response.
 */
function preSeedTrustFromConfig(
  trustManager: InstanceType<typeof SessionTrustManager>,
): void {
  try {
    const { loadBlocklistConfig } = require("./provider-config");
    const config = loadBlocklistConfig();
    if (!config?.providers) return;

    const domains = new Set<string>();

    for (const provider of config.providers) {
      if (provider.enabled !== false) {
        if (provider.embedDomains) {
          provider.embedDomains.forEach((d: string) =>
            domains.add(d.toLowerCase()),
          );
        }
        if (provider.cdnDomains) {
          provider.cdnDomains.forEach((d: string) =>
            domains.add(d.toLowerCase()),
          );
        }
      }
    }

    if (config.allowedCdnHosts) {
      config.allowedCdnHosts.forEach((d: string) =>
        domains.add(d.toLowerCase()),
      );
    }

    let count = 0;
    for (const domain of domains) {
      trustManager.addTrust(domain);
      count++;
    }
    console.log(
      `[SecurityFilter] Pre-seeded trust from config: ${count} domains`,
    );
  } catch {
    // Config not available — trust will be built dynamically
  }
}

/**
 * Pre-seed session trust with known provider CDN domains (external call).
 * Called from main.ts provider:init IPC to augment the pre-seeded trust.
 */
export function preSeedTrustForProvider(
  trustManager: InstanceType<typeof SessionTrustManager>,
  cdnDomains: Set<string>,
): void {
  let count = 0;
  for (const domain of cdnDomains) {
    trustManager.addTrust(domain);
    count++;
  }
  console.log(
    `[SecurityFilter] Pre-seeded trust for ${count} CDN/embed domains`,
  );
}

/**
 * Reset the handler tracking for hot-reload scenarios.
 */
export function resetSessionHandlers(): void {
  initializedSessions.clear();
  console.log("[SecurityFilter] Session handler tracking reset");
}

// ── Session cleanup ─────────────────────────────────────────────────────────

/**
 * Clear all stored data from the provider session partition.
 * Call this when the video window is closed to prevent:
 *   - Cross-provider tracking via cookies
 *   - Stale service worker registrations
 *   - Cached ad scripts persisting
 *   - Stale session trust
 */
export async function clearProviderSession(session: Session): Promise<void> {
  try {
    // Clear session trust
    const trustManager = trustManagers.get(session);
    if (trustManager) {
      trustManager.clear();
      trustManagers.delete(session);
      console.log("[SecurityFilter] Session trust cleared");
    }

    await session.clearStorageData({
      storages: [
        "cookies",
        "localstorage",
        "indexdb",
        "websql",
        "cachestorage",
        "serviceworkers",
      ],
    });
    await session.clearCache();
    console.log("[SecurityFilter] Provider session cleared");
  } catch (err) {
    console.error("[SecurityFilter] Failed to clear session:", err);
  }
}

// ── Security headers ────────────────────────────────────────────────────────

/**
 * Setup CSP and security headers on the provider session.
 * These headers are injected into HTTP responses and CANNOT be
 * stripped by provider JavaScript — unlike meta-tag-based CSP.
 */
export function setupSecurityHeaders(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = {
      ...details.responseHeaders,
      "Content-Security-Policy": [
        // Intentionally permissive — provider players need inline scripts/eval.
        // Real protection comes from the R0-R8 cascade (onBeforeRequest)
        // and the navigation guard (will-navigate / will-redirect).
        `default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; ` +
          `script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; ` +
          `frame-src *; ` +
          `object-src 'none'; ` +
          `form-action 'none'; ` +
          `base-uri 'self'`,
      ],
      // Prevent MIME-type sniffing
      "X-Content-Type-Options": ["nosniff"],
      // Send no referrer header
      "Referrer-Policy": ["no-referrer"],
      // Disable DNS prefetching
      "X-DNS-Prefetch-Control": ["off"],
    };

    callback({ responseHeaders });
  });
}
