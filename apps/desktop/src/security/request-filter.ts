/**
 * FilmSnaps Desktop — Network-Level Request Filtering
 *
 * Applies Electron's session.webRequest.onBeforeRequest to block
 * ads, trackers, malware, and downloads at the Chromium network layer.
 *
 * KEY ADVANTAGE over mobile WebView: This runs in the Electron main process
 * BEFORE any JavaScript executes in the renderer. Provider scripts CANNOT
 * bypass, override, or race-condition this filter. It is the strongest
 * available defense layer.
 */

import { session as electronSession, Session } from 'electron';
import { shouldBlockUrl, isDownloadUrl, getBlockCategory } from './blocklist';

const SESSION_PARTITION = 'filmsnaps-provider';

/**
 * Create an isolated session partition for provider content.
 * This session has:
 *   - No persistent cache (cleared on close)
 *   - Network-level request filtering
 *   - No cookie sharing with the main app session
 */
export function createProviderSession(): Session {
  const providerSession = electronSession.fromPartition(
    `persist:${SESSION_PARTITION}`,
    { cache: false }
  );

  // Apply network-level request filtering
  setupRequestFilter(providerSession);

  return providerSession;
}

/**
 * Set up the webRequest.onBeforeRequest handler on a session.
 * This blocks matching requests BEFORE they reach the network.
 */
function setupRequestFilter(session: Session): void {
  // Block outgoing requests that match our blocklist
  session.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const url = details.url;

      // Skip app-internal URLs and data: URIs
      if (
        url.startsWith('data:') ||
        url.startsWith('blob:') ||
        url.startsWith('about:') ||
        url.startsWith('file:')
      ) {
        return callback({});
      }

      // Block ads, trackers, malware
      if (shouldBlockUrl(url)) {
        const category = getBlockCategory(url);
        console.log(
          `[SecurityFilter] Blocked ${category} request: ${url.substring(0, 120)}`
        );
        return callback({ cancel: true });
      }

      // Block file downloads initiated by provider scripts
      if (isDownloadUrl(url)) {
        console.log(
          `[SecurityFilter] Blocked download: ${url.substring(0, 120)}`
        );
        return callback({ cancel: true });
      }

      return callback({});
    }
  );

  // Log allowed requests for debugging (optional)
  session.webRequest.onCompleted(
    { urls: ['*://*/*'] },
    (details) => {
      // Only log if it's a potentially interesting request
      if (
        details.url.includes('analytics') ||
        details.url.includes('track') ||
        details.url.includes('pixel')
      ) {
        console.log(
          `[SecurityFilter] Allowed (completed): ${details.url.substring(0, 100)}`
        );
      }
    }
  );

  console.log('[SecurityFilter] Network-level request filtering active');
}

/**
 * Clear all stored data from the provider session partition.
 * Call this when the video window is closed to prevent:
 *   - Cross-provider tracking via cookies
 *   - Stale service worker registrations
 *   - Cached ad scripts persisting
 */
export async function clearProviderSession(session: Session): Promise<void> {
  try {
    await session.clearStorageData({
      storages: [
        'cookies',
        'localstorage',
        'indexdb',
        'websql',
        'cachestorage',
        'serviceworkers',
      ],
    });
    await session.clearCache();
    console.log('[SecurityFilter] Provider session cleared');
  } catch (err) {
    console.error('[SecurityFilter] Failed to clear session:', err);
  }
}

/**
 * Setup CSP and security headers on the provider session.
 * These headers are injected into HTTP responses and CANNOT be
 * stripped by provider JavaScript — unlike meta-tag-based CSP.
 */
export function setupSecurityHeaders(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        // Intentionaly permissive — provider players need inline scripts/eval.
        // Real protection comes from Layers 2 (request filter) and 4 (nav guard).
        `default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; ` +
        `script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; ` +
        `frame-src *; ` +
        `object-src 'none'; ` +
        `form-action 'none'; ` +
        `base-uri 'self'`,
      ],
      // Prevent MIME-type sniffing
      'X-Content-Type-Options': ['nosniff'],
      // Block embedding in other contexts
      'X-Frame-Options': ['DENY'],
      // Send no referrer header
      'Referrer-Policy': ['no-referrer'],
      // Disable DNS prefetching (prevents data leakage)
      'X-DNS-Prefetch-Control': ['off'],
    };

    callback({ responseHeaders });
  });
}
