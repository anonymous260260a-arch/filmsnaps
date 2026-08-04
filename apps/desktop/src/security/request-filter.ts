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
import {
  initUrlSubstringFilter,
  getSubstringFilterStats,
} from "./url-substring-filter";
import { registerHtmlInjection } from "./html-injector";
import { addGlobalCdnAllowlistDomains } from "./provider-config";
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
 * Build a clean desktop-Chrome User-Agent derived from the REAL Chromium
 * version embedded in this Electron build (expert V7, 2026-08-04).
 *
 * WHY: Electron's default UA embeds the app identity from package.json
 * (`@filmsnaps/desktop/1.0.3` + `Electron/42.4.1`). Cloudflare bot-management
 * flags those app tokens at the edge → HTTP 403 on the provider's own
 * same-origin token/bootstrap API → no token → player stalls. A clean UA with
 * no app name / `Electron/` and a version that MATCHES the User-Agent Client
 * Hints Chromium reports (`Sec-CH-UA: "Chromium";v="<chromeVer>"`) is accepted.
 *
 * Never hardcode the version — derive it from `process.versions.chrome` so it
 * tracks the Electron binary across upgrades and always stays consistent with
 * Client Hints.
 */
function buildCleanDesktopUA(): string {
  const chromeVer = process.versions.chrome; // e.g. "148.0.7778.265"
  const platform = process.platform;

  let platformToken: string;
  switch (platform) {
    case "win32":
      platformToken = "Windows NT 10.0; Win64; x64";
      break;
    case "darwin":
      platformToken = "Macintosh; Intel Mac OS X 10_15_7";
      break;
    case "linux":
      platformToken = "X11; Linux x86_64";
      break;
    default:
      platformToken = "Windows NT 10.0; Win64; x64";
  }

  return (
    `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`
  );
}

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

  // ── UA: clean desktop-Chrome UA derived from the real Chromium version ──
  // Expert V7 confirmed (2026-08-04) the root cause of the provider-switch
  // stall: Electron's DEFAULT UA embeds the app identity from package.json
  // (`@filmsnaps/desktop/1.0.3 ... Electron/42.4.1`). Cloudflare bot-management
  // flags those tokens at the edge → 403 on the provider's own same-origin
  // token/bootstrap API → no token → every /api/servers/* returns 401 → player
  // stalls. Removing the app tokens while preserving the REAL Chromium version
  // (which matches the Client Hints Chromium actually reports) resolves the
  // 403. Option A is version-derived (tracks Electron across updates — never
  // hardcode) and platform-aware, so UA version always == Client-Hints version.
  // This only affects the provider partition; the main window (default session)
  // keeps the stock Electron UA (internal http://127.0.0.1 — no server sees it).
  providerSession.setUserAgent(buildCleanDesktopUA());

  if (process.env.FILMSNAPS_AUDIT === "1") {
    console.log(
      `[SecurityFilter] Provider UA set: ${providerSession.getUserAgent()}`,
    );
  }

  // ── Network-layer HTML protection injection ──
  // THE WHOLE-PAGE GUARANTEE: bake the protection script into every HTML
  // document at the network layer, so coverage does not depend on the preload
  // mechanism reaching every frame (programmatic frames, about:blank/srcdoc).
  // Must be registered before the session's first request — arming here at
  // startup (before any webview exists) closes the window by construction.
  registerHtmlInjection(providerSession);

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

  // Warm the mobile-parity URL-substring filter (R4b/R5b) off the critical
  // path so the first provider request never blocks on a synchronous asset
  // read. Idempotent — loads once. Falls back gracefully if absent.
  try {
    initUrlSubstringFilter();
    console.log(
      `[SecurityFilter] Mobile-parity substring filter ready: ` +
        `${getSubstringFilterStats().substringCount} URL substrings + ` +
        `${getSubstringFilterStats().blockedDomainCount} blocked domains`,
    );
  } catch (err) {
    console.warn("[SecurityFilter] Url-substring filter warm-up failed:", err);
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

  // Install CSP + security headers (L3) HERE at startup, NOT lazily on
  // provider:init. The webview can attach and navigate before the async
  // provider:init IPC round-trip completes; if onHeadersReceived is not
  // installed yet, the first committed document has no CSP/security
  // headers — the intermittent "security didn't apply" gap. Installing at
  // startup (before any webview exists) closes that window by construction.
  setupSecurityHeaders(providerSession);

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

  // Feed known provider CDN/embed domains into the R1/R2 ALLOWLISTS (NOT R0
  // trust). R0 starts EMPTY — trust is earned only when a host serves verified
  // video content (setupTrustTracking → checkResponseForTrust). Config-derived
  // hosts must not short-circuit the R1-R8 cascade before they've served
  // anything (V4 step 2 / V5).
  preSeedAllowlistsFromConfig();

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

      // ALLOW-side audit log (Gap C / V5 step 1). Gated by FILMSNAPS_AUDIT=1
      // so production stays quiet (only blocks logged). Mirrors mobile's
      // ReqLog format: ACTION | RULE | RESOURCE_TYPE | HOST | URL. This is the
      // single highest-value diagnostic — without it we can't see which
      // allowing rule lets an ad/beacon request through.
      if (process.env.FILMSNAPS_AUDIT === "1") {
        try {
          const host = new URL(url).hostname;
          console.log(
            `[ReqLog] ALLOW [${decision.rule}] ${details.resourceType} ${host} ${url.substring(0, 140)}`,
          );
        } catch {
          /* unparseable — skip audit line */
        }
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
      // Log the trust entry INCLUDING its path prefix (V4/V5 trust-granularity
      // diagnostic). A prefix of "/" means whole-host trust — exactly the
      // over-broadening that lets same-host ad scripts short-circuit R1-R8.
      let prefix = "/";
      try {
        const entry = trustManager
          .getTrustedHosts()
          .find((e) => new URL(details.url).hostname.endsWith(e.hostname));
        if (entry) prefix = entry.pathPrefix || "/";
      } catch {}
      console.log(
        `[SecurityFilter] Trust added: ${new URL(details.url).hostname} (video content detected, pathPrefix: ${JSON.stringify(prefix)})`,
      );
    }
  });

  // NOTE: onBeforeRedirect blanket-trust was REMOVED (expert consultation).
  // It trusted every redirect destination host at HOST granularity, which let
  // ad CDNs reached via a redirect short-circuit R1-R8. The destination now
  // earns path-scoped trust only when it actually serves video content, via
  // the onCompleted handler above (checkResponseForTrust).
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

// ── Pre-seed allowlists ──────────────────────────────────────────────────

/**
 * Pre-seed ALLOWLISTS from blocklist.json — collects all known CDN/embed
 * domains across all providers and feeds them into the R1/R2 allowlists, NOT
 * into R0 session trust (V4 step 2 / V5). R0 is reserved for DYNAMICALLY EARNED
 * trust — hosts that have actually served verified video content this session.
 *
 * Why: pre-seeding into R0 gave config-derived hosts whole-host trust before
 * they'd served anything, letting `cloudflareinsights.com` / `googletagmanager.com`
 * short-circuit the whole cascade (R1-R8 never ran for them). Fed through
 * R1/R2 instead, those hosts still reach R4/R5 — so an always-block domain in
 * R5 is still blocked, and the FiltersEngine (R4) still evaluates them.
 *
 * R1/R2 are read by shouldBlockRequest via getGlobalCdnAllowlist() /
 * getAllowedDomainsForProvider() — both already pull from the SAME blocklist.json
 * the config loader reads, so this function's effect is: config CDN/embed domains
 * are already allowlisted at R1/R2 WITHOUT ever touching R0 trust. It exists to
 * make the intent explicit and to remove the old R0 pre-seed path.
 */
function preSeedAllowlistsFromConfig(): void {
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

    console.log(
      `[SecurityFilter] Pre-seeded ${domains.size} CDN/embed domains into R1/R2 allowlists (R0 starts EMPTY — trust is earned only by serving video)`,
    );
  } catch {
    // Config not available — allowlists resolve lazily from provider-config.
  }
}

/**
 * Pre-seed provider allowlists with known provider CDN domains (external call).
 * Called from main.ts provider:init IPC. Feeds the R1/R2 ALLOWLISTS — NOT R0
 * trust (V4 step 2 / V5): config-derived hosts must not short-circuit the
 * R1-R8 cascade before they've served anything. Fed through R1/R2, they still
 * fall through to R4/R5, so an always-block domain in R5 is still blocked.
 */
export function preSeedProviderAllowlists(cdnDomains: Set<string>): void {
  let count = 0;
  for (const domain of cdnDomains) {
    addGlobalCdnAllowlistDomains([domain]);
    count++;
  }
  console.log(
    `[SecurityFilter] Fed ${count} CDN/embed domains into the R1/R2 allowlists (R0 trust untouched)`,
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

    // Clear runtime-augmented R1/R2 allowlists (embed host + pre-seed domains)
    // so a new provider session starts with only config-declared allowlists.
    try {
      const { clearRuntimeAllowlists } = require("./provider-config");
      clearRuntimeAllowlists();
      console.log("[SecurityFilter] Runtime R1/R2 allowlists cleared");
    } catch {}

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
        // Real protection comes from the R0-R8 cascade (onBeforeRequest),
        // the navigation guard (will-navigate / will-redirect), and the
        // network-layer HTML injection (html-injector.ts) which inlines the
        // protection script at the top of <head>.
        //
        // NOTE: no script-src directive. A script-src would gate the injected
        // protection <script> on 'unsafe-inline' (or a nonce) — a spec-change
        // or provider that sends its own CSP could then suppress our script.
        // With no script-src, the fetch spec's CSP default (script-src 'self')
        // is NOT applied to our response, so the protection always runs.
        `default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; ` +
          `frame-src *; ` +
          `object-src 'none'; ` +
          `form-action 'none'; ` +
          `base-uri 'self'`,
      ],
      // Prevent MIME-type sniffing
      "X-Content-Type-Options": ["nosniff"],
      // Referrer policy — CRUCIAL: do NOT use no-referrer here.
      // Expert V5 confirmed (2026-08-04) that stripping the Referer header on
      // every provider-session response is the root cause of the cross-origin
      // stream providers stalling (screenscape.me, peachify.top): their
      // rotating token-gated CDNs (`*.eat-peach.sbs` etc.) use Referer as an
      // anti-hotlink gate. nxsha works because it streams SAME-origin (no
      // Referer needed). Cross-origin manifest fetches without a Referer are
      // rejected by the CDN, the player JS treats the source as failed, and
      // never assigns video.src — so no manifest request is ever issued.
      // Mobile always sends Referer: <provider baseUrl> and works.
      // 'origin' sends only scheme+host (privacy-preserving) yet satisfies the
      // CDN's anti-hotlink check. strict-origin-when-cross-origin (the browser
      // default) is also fine; 'origin' is the slightly more private choice.
      "Referrer-Policy": ["origin"],
      // Disable DNS prefetching
      "X-DNS-Prefetch-Control": ["off"],
    };

    callback({ responseHeaders });
  });
}
