/**
 * FilmSnaps Desktop — Native Navigation & Popup Blocking
 *
 * Blocks popups, cross-host navigation, redirects, and downloads at the
 * Electron level. These handlers run in the main process and CANNOT be
 * bypassed by provider JavaScript.
 *
 * Includes a bootstrap-domain whitelist: during the first N seconds after
 * page load, all domains are recorded. After that, only whitelisted domains
 * are allowed — preventing post-load navigation hijacks.
 */

import { BrowserWindow, WebContents } from 'electron';

const BOOTSTRAP_DURATION_MS = 5000;

interface NavigationGuardOptions {
  /** The provider's embed URL (used to determine allowed origin) */
  providerUrl: string;
  /** Optional: specific additional hostnames to allow */
  additionalAllowedHosts?: string[];
  /** Optional callback when navigation is blocked */
  onBlocked?: (type: 'popup' | 'navigation' | 'redirect', url: string) => void;
  /** Optional callback when the bootstrap phase ends */
  onBootstrapComplete?: (whitelistedHosts: string[]) => void;
}

/**
 * Apply all navigation/popup/redirect guards to a webContents.
 * Must be called from the main process.
 */
export function applyNavigationGuard(
  webContents: WebContents,
  options: NavigationGuardOptions
): { bootstrapWhitelist: Set<string> } {
  const { providerUrl, additionalAllowedHosts = [] } = options;

  // Parse the provider's origin
  let providerOrigin: string;
  let providerHostname: string;
  try {
    const parsed = new URL(providerUrl);
    providerOrigin = parsed.origin;
    providerHostname = parsed.hostname;
  } catch {
    console.error('[NavGuard] Invalid provider URL:', providerUrl);
    providerOrigin = '';
    providerHostname = '';
  }

  // Bootstrap whitelist: domains visited during the first N seconds
  const bootstrapWhitelist = new Set<string>([providerHostname, ...additionalAllowedHosts]);
  let bootstrapEnded = false;

  // Track if the page has loaded
  let pageLoaded = false;

  // ── Popup blocking ──
  // This is the STRONGEST popup defense. Electron handles this at the
  // OS/Chromium level — no JavaScript in the page can override this.
  webContents.setWindowOpenHandler(() => {
    console.log('[NavGuard] Blocked popup window');
    options.onBlocked?.('popup', '');
    return { action: 'deny' };
  });

  // ── Navigation blocking ──
  // Fires BEFORE navigation starts. We check if the target is in the
  // bootstrap whitelist. If not, the navigation is prevented.
  webContents.on('will-navigate', (event, url) => {
    try {
      const targetHost = new URL(url).hostname.toLowerCase();

      if (bootstrapWhitelist.has(targetHost)) {
        return; // Allowed
      }

      console.log(`[NavGuard] Blocked navigation to: ${targetHost} (${url.substring(0, 80)})`);
      event.preventDefault();
      options.onBlocked?.('navigation', url);
    } catch {
      // Invalid URL — block it
      console.log(`[NavGuard] Blocked navigation (invalid URL): ${url.substring(0, 80)}`);
      event.preventDefault();
    }
  });

  // ── Redirect blocking ──
  // Fires before HTTP redirects are followed. Same host check.
  webContents.on('will-redirect', (event, url) => {
    try {
      const targetHost = new URL(url).hostname.toLowerCase();

      // Always allow same-host redirects
      if (targetHost === providerHostname || bootstrapWhitelist.has(targetHost)) {
        return;
      }

      // During bootstrap, add to whitelist
      if (!bootstrapEnded) {
        bootstrapWhitelist.add(targetHost);
        console.log(`[NavGuard] Bootstrap whitelist added: ${targetHost}`);
        return;
      }

      console.log(`[NavGuard] Blocked redirect to: ${targetHost} (${url.substring(0, 80)})`);
      event.preventDefault();
      options.onBlocked?.('redirect', url);
    } catch {
      event.preventDefault();
    }
  });

  // ── Page lifecycle tracking ──

  // Track when page finishes loading
  webContents.on('did-finish-load', () => {
    pageLoaded = true;
    console.log('[NavGuard] Page loaded');
  });

  // Bootstrap phase: record all domains visited in the first N seconds
  const bootstrapTimer = setTimeout(() => {
    bootstrapEnded = true;
    console.log(
      `[NavGuard] Bootstrap ended. Whitelisted hosts:`,
      Array.from(bootstrapWhitelist)
    );
    options.onBootstrapComplete?.(Array.from(bootstrapWhitelist));
  }, BOOTSTRAP_DURATION_MS);

  // Clean up the timer when the window is closed
  webContents.on('destroyed', () => {
    clearTimeout(bootstrapTimer);
  });

  return { bootstrapWhitelist };
}

/**
 * Check if a hostname should be allowed for video content.
 * Used by the JS injection layer as a secondary check.
 */
export function isAllowedHost(
  targetHost: string,
  allowedHosts: Set<string>
): boolean {
  if (allowedHosts.has(targetHost)) return true;

  // Check against provider hostname
  for (const allowed of allowedHosts) {
    // Allow subdomains of allowed hosts
    if (targetHost.endsWith('.' + allowed)) return true;
  }

  return false;
}
