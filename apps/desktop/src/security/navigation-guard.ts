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

import { BrowserWindow, WebContents } from "electron";
import { auditMainFramePopUnder } from "./structural-warnings";

const BOOTSTRAP_DURATION_MS = 5000;

interface NavigationGuardOptions {
  /** The provider's embed URL (used to determine allowed origin) */
  providerUrl: string;
  /** Optional: specific additional hostnames to allow */
  additionalAllowedHosts?: string[];
  /** Optional callback when navigation is blocked */
  onBlocked?: (type: "popup" | "navigation" | "redirect", url: string) => void;
  /** Optional callback when the bootstrap phase ends */
  onBootstrapComplete?: (whitelistedHosts: string[]) => void;
  /**
   * Redirect-mesh providers (vidsrc→viduki.net, videasy→videasy.to) bounce the
   * embed through an upstream host before the real player page. That host was
   * never "visited" during the bootstrap window, so the old guard blocked the
   * redirect → ERR_FAILED. With this flag, a MAIN-FRAME redirect from the
   * initial embed domain is allowed + added to the whitelist (the upstream
   * host then serves the player). Ad-popups / home-escapes are still blocked.
   * Config: providers.json providers[].allowServerRedirects.
   */
  allowServerRedirects?: boolean;
  /**
   * The original requested embed URL (== providerUrl). Path-level baseline
   * for the home-page escape guard: a same-host navigation away from the embed
   * path toward a home/list shape ("Go Home" on a provider error UI) is caught
   * even though the host-based guards let it through.
   */
  requestedEmbedUrl?: string;
  /**
   * Per-provider home/list paths (blocklist.json providers[].blockHomePaths)
   * that escape the player frame. Additive deny-list; the universal bare-root
   * block (["/"]) also applies to every provider via the injected checker.
   */
  blockHomePaths?: string[];
  /** Universal root/home paths blocked for EVERY provider (default: ["/"]). */
  universalBlockPaths?: string[];
  /**
   * Called AFTER the single auto-reload failed again (cooldown) — the renderer
   * must show the error/source-unavailable UI. (count, url) of the escaped page.
   */
  onEscaped?: (count: number, url: string) => void;
}

/**
 * Apply all navigation/popup/redirect guards to a webContents.
 * Must be called from the main process.
 *
 * Returns `{ bootstrapWhitelist, updateConfig }`. The WebContentsView hybrid
 * owns a PERSISTENT provider view (main.ts openProviderView), so unlike the
 * old per-attach <webview> model the guard is installed ONCE and re-pointed
 * per provider switch via `updateConfig` (provider URL/hosts/redirect policy).
 * The whitelist persists across switches so a previously-visited CDN is not
 * re-blocked; new hosts are merged in.
 */
export function applyNavigationGuard(
  webContents: WebContents,
  options: NavigationGuardOptions,
): {
  bootstrapWhitelist: Set<string>;
  updateConfig: (next: NavigationGuardOptions) => void;
} {
  // Mutable config — re-pointed by updateConfig on provider switch.
  const config: {
    providerUrl: string;
    providerOrigin: string;
    providerHostname: string;
    additionalAllowedHosts: string[];
    requestedEmbedUrl: string;
    blockHomePaths: string[];
    universalBlockPaths: string[];
    allowServerRedirects: boolean;
  } = {
    providerUrl: options.providerUrl,
    providerOrigin: "",
    providerHostname: "",
    additionalAllowedHosts: options.additionalAllowedHosts ?? [],
    requestedEmbedUrl: options.requestedEmbedUrl ?? options.providerUrl,
    blockHomePaths: options.blockHomePaths ?? [],
    universalBlockPaths: options.universalBlockPaths ?? ["/"],
    allowServerRedirects: options.allowServerRedirects ?? false,
  };

  // Mutable callbacks — re-pointed by updateConfig so a provider switch on the
  // persistent view routes events to the freshest renderer/onBlocked target.
  const callbacks: {
    onBlocked?: (
      type: "popup" | "navigation" | "redirect",
      url: string,
    ) => void;
    onEscaped?: (count: number, url: string) => void;
    onBootstrapComplete?: (whitelistedHosts: string[]) => void;
  } = {
    onBlocked: options.onBlocked,
    onEscaped: options.onEscaped,
    onBootstrapComplete: options.onBootstrapComplete,
  };

  const parseProvider = (): void => {
    try {
      const parsed = new URL(config.providerUrl);
      config.providerOrigin = parsed.origin;
      config.providerHostname = parsed.hostname;
    } catch {
      console.error("[NavGuard] Invalid provider URL:", config.providerUrl);
      config.providerOrigin = "";
      config.providerHostname = "";
    }
  };
  parseProvider();

  // Bootstrap whitelist: domains visited during the first N seconds
  const bootstrapWhitelist = new Set<string>([
    config.providerHostname,
    ...config.additionalAllowedHosts,
  ]);
  let bootstrapEnded = false;

  // Track if the page has loaded
  let pageLoaded = false;

  // ── Home-page escape state ─────────────────────────────────────────────────
  // The provider error UI can navigate the embed (SAME host) to its home page —
  // host-level guards can't catch it. Detect a path-level escape (bare "/" or a
  // per-provider home shape) after the embed has initially loaded, auto-reload
  // the original embed ONCE, then escalate to the renderer on a repeat within a
  // 15s cooldown. 60s reset prevents a permanent loop.
  let initialLoadComplete = false;
  let escapeOnce = false;
  let lastEscapeAt = 0;
  let escapeCount = 0;

  const requestedUrl = (): string =>
    config.requestedEmbedUrl || config.providerUrl;

  const isHomeEscapeNow = (url: string): boolean =>
    isHomeEscapeCjs(
      url,
      config.requestedEmbedUrl,
      config.blockHomePaths,
      config.universalBlockPaths,
    );

  const handleEscape = (url: string): boolean => {
    const now = Date.now();

    // Cooldown reset — any escape older than 60s clears the once-guard.
    if (escapeOnce && now - lastEscapeAt > 60000) {
      escapeOnce = false;
    }

    if (escapeOnce && now - lastEscapeAt < 15000) {
      // Already auto-reloaded once recently — escalate: stop reloading, tell
      // the renderer to show the source-unavailable/error UI.
      escapeCount++;
      console.warn(
        `[NavGuard] Home-page escape escalated (${escapeCount}x): ${url.slice(0, 120)}`,
      );
      callbacks.onEscaped?.(escapeCount, url);
      return false; // still blocked (path was prevented by caller)
    }

    escapeOnce = true;
    lastEscapeAt = now;
    escapeCount++;
    console.warn(
      `[NavGuard] Home-page escape — reloading embed once: ${url.slice(0, 120)}`,
    );
    // Reload the original requested embed (re-enters the guarded session).
    try {
      webContents.loadURL(requestedUrl());
    } catch (e) {
      callbacks.onEscaped?.(escapeCount, url);
    }
    return false;
  };

  // ── Popup blocking ──
  // This is the STRONGEST popup defense. Electron handles this at the
  // OS/Chromium level — no JavaScript in the page can override this.
  webContents.setWindowOpenHandler(({ url, features }) => {
    console.log("[NavGuard] Blocked popup window");
    callbacks.onBlocked?.("popup", url);

    // Structural audit (Phase 2e): a window.open carrying width/height
    // features is the classic pop-under ad shape. The handler denies it
    // regardless — the warning just surfaces the signature so a
    // FILMSNAPS_AUDIT=1 run can flag a new ad vector or a guard gap.
    // Electron 42's HandlerDetails exposes the feature list as `features`
    // (comma-separated string) and the resolved popup URL as `url`.
    auditMainFramePopUnder({ windowFeatures: features, frameUrl: url });

    return { action: "deny" };
  });

  // ── Navigation blocking ──
  // Fires BEFORE navigation starts. We check if the target is in the
  // bootstrap whitelist. If not, the navigation is prevented.
  webContents.on("will-navigate", (event, url) => {
    try {
      const targetHost = new URL(url).hostname.toLowerCase();

      if (bootstrapWhitelist.has(targetHost)) {
        // Host allowed — check for a same-host home-page escape (path-level).
        if (initialLoadComplete && isHomeEscapeNow(url)) {
          event.preventDefault();
          handleEscape(url);
        }
        return; // Allowed (or escape handled)
      }

      console.log(
        `[NavGuard] Blocked navigation to: ${targetHost} (${url.substring(0, 80)})`,
      );
      event.preventDefault();
      callbacks.onBlocked?.("navigation", url);
    } catch {
      // Invalid URL — block it
      console.log(
        `[NavGuard] Blocked navigation (invalid URL): ${url.substring(0, 80)}`,
      );
      event.preventDefault();
    }
  });

  // ── Redirect blocking ──
  // Fires before HTTP redirects are followed. Same host check.
  //
  // Electron 42 signature: (event, url, isInPlace, isMainFrame, ...). There is
  // NO `navigationType` (the Plan agent verified this against the 42 d.ts), so
  // `isMainFrame` distinguishes the provider's OWN initial server redirect
  // (main frame, from the embed domain) from an in-page/iframe redirect.
  webContents.on(
    "will-redirect",
    (event, url, _isInPlace, isMainFrame, _frameProcessId, _frameRoutingId) => {
      try {
        const targetHost = new URL(url).hostname.toLowerCase();

        // Always allow same-host redirects
        if (
          targetHost === config.providerHostname ||
          bootstrapWhitelist.has(targetHost)
        ) {
          // Same-host — check for a path-level home-page escape.
          if (initialLoadComplete && isHomeEscapeNow(url)) {
            event.preventDefault();
            handleEscape(url);
          }
          return;
        }

        // Redirect-mesh: a MAIN-FRAME redirect away from the embed domain,
        // for a provider configured to allow server redirects, is the mesh
        // hop to the real player host (vidsrc→viduki.net). Allow it and add
        // the target to the whitelist so subsequent same-host navigation/
        // requests for the player are not blocked either. This is the fix for
        // the expert-confirmed ERR_FAILED root cause: the upstream host was
        // never visited during the bootstrap window.
        if (isMainFrame && config.allowServerRedirects) {
          bootstrapWhitelist.add(targetHost);
          console.log(
            `[NavGuard] Server redirect allowed (allowServerRedirects) → whitelisted: ${targetHost}`,
          );
          return;
        }

        // During bootstrap, add to whitelist
        if (!bootstrapEnded) {
          bootstrapWhitelist.add(targetHost);
          console.log(`[NavGuard] Bootstrap whitelist added: ${targetHost}`);
          return;
        }

        console.log(
          `[NavGuard] Blocked redirect to: ${targetHost} (${url.substring(0, 80)})`,
        );
        event.preventDefault();
        callbacks.onBlocked?.("redirect", url);
      } catch {
        event.preventDefault();
      }
    },
  );

  // ── Page lifecycle tracking ──

  // Track when page finishes loading
  webContents.on("did-finish-load", () => {
    pageLoaded = true;
    // The embed has loaded once — enable the home-page escape guard. Before
    // this point the host-level bootstrap governs (the very first load must
    // never be misjudged as an escape).
    initialLoadComplete = true;
    console.log("[NavGuard] Page loaded");
  });

  // Post-commit fallback: SPA transitions / location.replace() / client-side
  // redirects can commit a new document without firing will-navigate or
  // will-redirect. If the committed URL is a home-page escape, reload-or-escalate.
  webContents.on("did-navigate", (_event, url) => {
    if (!initialLoadComplete) return;
    if (isHomeEscapeNow(url)) {
      handleEscape(url);
    }
  });

  // Bootstrap phase: record all domains visited in the first N seconds
  const bootstrapTimer = setTimeout(() => {
    bootstrapEnded = true;
    console.log(
      `[NavGuard] Bootstrap ended. Whitelisted hosts:`,
      Array.from(bootstrapWhitelist),
    );
    callbacks.onBootstrapComplete?.(Array.from(bootstrapWhitelist));
  }, BOOTSTRAP_DURATION_MS);

  // Clean up the timer when the window is closed
  webContents.on("destroyed", () => {
    clearTimeout(bootstrapTimer);
  });

  /**
   * Re-point the guard for a provider switch on the SAME persistent view.
   * Updates the provider origin/hosts/redirect policy and merges the new
   * allowed hosts into the (persisting) whitelist. Escape state resets so a
   * fresh provider gets a fresh home-page-escape window.
   */
  const updateConfig = (next: NavigationGuardOptions): void => {
    config.providerUrl = next.providerUrl || config.providerUrl;
    config.requestedEmbedUrl =
      next.requestedEmbedUrl ?? next.providerUrl ?? config.providerUrl;
    config.blockHomePaths = next.blockHomePaths ?? [];
    config.universalBlockPaths = next.universalBlockPaths ?? ["/"];
    config.allowServerRedirects = next.allowServerRedirects ?? false;
    config.additionalAllowedHosts = next.additionalAllowedHosts ?? [];
    for (const host of config.additionalAllowedHosts) {
      bootstrapWhitelist.add(host.toLowerCase());
    }
    // Re-point the callbacks so blocked/escaped events route to the freshest
    // renderer target after a provider switch.
    callbacks.onBlocked = next.onBlocked;
    callbacks.onEscaped = next.onEscaped;
    callbacks.onBootstrapComplete = next.onBootstrapComplete;
    parseProvider();
    if (config.providerHostname)
      bootstrapWhitelist.add(config.providerHostname);
    // Fresh provider → fresh escape window.
    initialLoadComplete = false;
    escapeOnce = false;
    lastEscapeAt = 0;
    escapeCount = 0;
    console.log(
      `[NavGuard] Config updated → provider=${config.providerHostname || "?"} allowServerRedirects=${config.allowServerRedirects}`,
    );
  };

  return { bootstrapWhitelist, updateConfig };
}

/**
 * Check if a hostname should be allowed for video content.
 * Used by the JS injection layer as a secondary check.
 */
export function isAllowedHost(
  targetHost: string,
  allowedHosts: Set<string>,
): boolean {
  if (allowedHosts.has(targetHost)) return true;

  // Check against provider hostname
  for (const allowed of allowedHosts) {
    // Allow subdomains of allowed hosts
    if (targetHost.endsWith("." + allowed)) return true;
  }

  return false;
}

// ── Provider home-page escape guard ─────────────────────────────────────────
// CJS replica of the shared `isHomeEscape` (packages/shared/src/security/
// navigation-home.ts). Desktop main is CommonJS and never imports @filmsnaps/*
// at runtime (same precedent as provider-config.ts), so the canonical ESM
// function is reproduced here dependency-free. Keep in sync with the shared
// source — the two must never diverge.

/** Normalize a path/URL to a lowercased pathname ("/movies" or "/embed/x/1"). */
function normalizeHomeEscapePath(raw: string): string {
  let p = raw || "";
  if (p.startsWith("http")) {
    try {
      p = new URL(p).pathname;
    } catch {
      return "";
    }
  }
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p.toLowerCase();
}

/**
 * Normalize a FULL URL to pathname + search (lowercased path, trailing slash
 * stripped). Query is part of the identity: a query-only embed
 * (screenscape `?tmdb={id}`) has a bare "/" path but a NON-EMPTY query — the
 * thing that separates it from the home page (bare "/" with no query).
 * Comparing path ONLY would make home "/" path-identical to the embed, so the
 * HARD-ALLOW would let it through. Mirrors shared normalizeFullUrl.
 */
function normalizeHomeEscapeFull(raw: string): string {
  const u = (raw || "").startsWith("http") ? raw || "" : toFullUrl(raw || "");
  try {
    const parsed = new URL(u);
    let p = parsed.pathname || "/";
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    const q = parsed.search || "";
    return p.toLowerCase() + q;
  } catch {
    return "";
  }
}

/**
 * True when a normalized full URL still carries a numeric media id (path or
 * query). An embed always identifies its title (`/embed/movie/1234` or
 * `?tmdb=1234`); a home/list page never does. Keeps the HARD-ALLOW from
 * swallowing a bare-root home URL that happens to share the embed's path.
 */
function looksEmbedLikeCjs(normalizedFull: string): boolean {
  if (!normalizedFull) return false;
  return (
    /\/(?:movie|tv|embed|player|watch|tou|api)\/\d+(\/|$)/.test(
      normalizedFull,
    ) || /(?:tmdb|video_id|id)=\d+/.test(normalizedFull)
  );
}

/**
 * True when the target path is a universal home/root shape (bare "/" by
 * default) — an escape for every provider regardless of per-provider config.
 */
export function isUniversalHomeEscapeCjs(
  targetPath: string,
  universalBlockPaths: string[],
): boolean {
  const t = normalizeHomeEscapePath(targetPath);
  for (const bp of universalBlockPaths) {
    const b = normalizeHomeEscapePath(bp);
    if (b === "") continue;
    if (t === b || t === b + "/") return true;
  }
  return false;
}

/**
 * Provider home-page escape detection (path-level, same-host). HARD ALLOW the
 * SAME embed (full URL) or a sub-route that still carries the media id; then
 * UNIVERSAL block, then PER-PROVIDER block, else allow.
 */
export function isHomeEscapeCjs(
  targetUrl: string,
  requestedEmbedUrl: string,
  blockHomePaths: string[],
  universalBlockPaths: string[],
): boolean {
  const targetPath = normalizeHomeEscapePath(toFullUrl(targetUrl));
  const embedPath = normalizeHomeEscapePath(toFullUrl(requestedEmbedUrl));
  const targetFull = normalizeHomeEscapeFull(targetUrl);
  const embedFull = normalizeHomeEscapeFull(requestedEmbedUrl);

  // DIAG: log every evaluation so an escape that slips through can be traced.
  // Filtered: FILMSNAPS_AUDIT=1 (console-message forward) → grep '[NavGuard]'
  console.warn(
    `[NavGuard][HOME-GUARD] evaluate target='${(targetUrl || "").slice(0, 120)}' -> path='${targetPath}' ` +
      `embed='${embedPath}' universal=[${universalBlockPaths}] perProvider=[${blockHomePaths}]`,
  );

  // HARD ALLOW — same embed (exact full URL), or a sub-route that keeps the
  // media id. A bare-root home URL has no media id → NOT hard-allowed.
  if (embedFull && targetFull === embedFull) {
    console.warn(
      `[NavGuard][HOME-GUARD] ALLOW hard (target==embed full URL) path='${targetPath}' embed='${embedPath}'`,
    );
    return false;
  }
  if (targetPath === embedPath && looksEmbedLikeCjs(targetFull)) {
    console.warn(
      `[NavGuard][HOME-GUARD] ALLOW hard (same path, still embeds-like) path='${targetPath}'`,
    );
    return false;
  }
  if (
    embedFull &&
    targetFull.startsWith(embedFull + "/") &&
    looksEmbedLikeCjs(targetFull)
  ) {
    console.warn(
      `[NavGuard][HOME-GUARD] ALLOW hard (sub-route under embed) path='${targetPath}' embed='${embedPath}'`,
    );
    return false;
  }

  if (isUniversalHomeEscapeCjs(targetPath, universalBlockPaths)) {
    console.warn(
      `[NavGuard][HOME-GUARD] BLOCK universal path='${targetPath}' url='${(targetUrl || "").slice(0, 120)}'`,
    );
    return true;
  }

  for (const bp of blockHomePaths) {
    const b = normalizeHomeEscapePath(bp);
    if (b === "") continue;
    if (targetPath === b || targetPath === b + "/") {
      console.warn(
        `[NavGuard][HOME-GUARD] BLOCK perProvider bp='${bp}' path='${targetPath}' url='${(targetUrl || "").slice(0, 120)}'`,
      );
      return true;
    }
  }

  console.warn(
    `[NavGuard][HOME-GUARD] ALLOW (no rule) path='${targetPath}' url='${(targetUrl || "").slice(0, 120)}'`,
  );
  return false;
}

/** Coerce a bare path (e.g. "/movies") to a URL for uniform parsing. */
function toFullUrl(url: string): string {
  const u = url || "";
  if (u.startsWith("http")) return u;
  return "https://x.invalid" + (u.startsWith("/") ? u : "/" + u);
}
