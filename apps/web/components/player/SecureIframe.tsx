/**
 * SecureIframe — secure iframe wrapper for provider embeds.
 *
 * Inlines navigation guard, popup guard, and CPU abuse watchdog.
 * Renders only the iframe layer — no controls or overlays.
 *
 * Now supports onLoad/onError callbacks for the parent to manage
 * loading states and error UI.
 */

'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { usePlayer } from './PlayerProvider';

/**
 * Default sandbox attributes when a provider doesn't specify custom ones.
 * allow-popups is included by default since the JS navGuard blocks popups
 * at the script level — we can relax it per-provider as needed.
 */
const DEFAULT_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

/** How long to wait before considering the iframe load a failure (ms) */
const LOAD_TIMEOUT_MS = 15000;

interface SecureIframeProps {
  /** The embed URL to load */
  src: string;
  /**
   * Sandbox attribute string for the iframe.
   * Overrides the default. Set to the provider's sandbox config
   * so providers that need less restriction (e.g. for auth) get it,
   * and providers that don't need popups get locked down tighter.
   */
  sandbox?: string;
  /**
   * CSP attribute string for the iframe — forces a Content Security
   * Policy onto the cross-origin iframe from the parent page.
   *
   * This is a browser feature (Chrome 106+, Firefox 131+):
   * - worker-src 'none' → kills crypto miners that need Web Workers
   * - restricted connect-src → blocks tracking beacons to unknown origins
   * - restricted frame-src → blocks nested ad iframes
   *
   * Works alongside sandbox (complementary, not redundant).
   */
  csp?: string;
  /** Whether to enable CPU abuse watchdog */
  enableCpuWatchdog?: boolean;
  /** Whether to enable navigation guard */
  enableNavGuard?: boolean;
  /** Whether to enable popup guard */
  enablePopupGuard?: boolean;
  /**
   * Whether to enable the parent-side redirect breaker.
   * Polls the iframe's contentWindow; if navigation to a new domain
   * is detected (cross-origin error or null window), forces the
   * iframe back to the original URL.
   */
  enableRedirectBreaker?: boolean;
  /** Called when the iframe's onload fires */
  onLoad?: () => void;
  /** Called when the iframe fails to load (timeout or error) */
  onError?: () => void;
}

export function SecureIframe({
  src,
  sandbox = DEFAULT_SANDBOX,
  csp,
  enableCpuWatchdog = true,
  enableNavGuard = true,
  enablePopupGuard = true,
  enableRedirectBreaker = true,
  onLoad,
  onError,
}: SecureIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const originalSrcRef = useRef(src);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);
  const { setCpuWarning, setIframeLoadError, refreshIframe } = usePlayer();

  // Keep originalSrcRef in sync when src changes (e.g. provider switch)
  useEffect(() => {
    originalSrcRef.current = src;
  }, [src]);

  // Set the `csp` attribute imperatively — TypeScript's HTML types
  // don't include it yet (Chrome 106+, Firefox 131+).
  useEffect(() => {
    if (iframeRef.current && csp) {
      iframeRef.current.setAttribute('csp', csp);
    }
  }, [csp]);

  // ── Load timeout detection ──
  // If the iframe doesn't fire onload within LOAD_TIMEOUT_MS, call onError.
  // Reset the timer on src change.
  useEffect(() => {
    loadedRef.current = false;
    setIframeLoadError(false);

    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);

    loadTimerRef.current = setTimeout(() => {
      if (!loadedRef.current && onError) {
        onError();
      }
    }, LOAD_TIMEOUT_MS);

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
    // We want this to run ONLY on src change, not when callbacks change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const handleLoad = useCallback(() => {
    loadedRef.current = true;
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
    onLoad?.();
  }, [onLoad]);

  // ── Navigation guard: block iframe top.location escape ──
  useEffect(() => {
    if (!enableNavGuard) return;

    const ORIGINAL_URL = window.location.href;

    const guardInterval = window.setInterval(() => {
      if (window.location.href !== ORIGINAL_URL) {
        window.history.pushState(null, '', ORIGINAL_URL);
      }
    }, 500);

    const onPopState = () => {
      if (window.location.href !== ORIGINAL_URL) {
        window.history.pushState(null, '', ORIGINAL_URL);
      }
    };
    window.addEventListener('popstate', onPopState);

    const originalOpen = window.open.bind(window);
    window.open = function blockPopup(url?: string | URL, _target?: string, _features?: string): Window | null {
      if (url && typeof url === 'string') {
        console.warn('[NavGuard] Blocked popup:', url.slice(0, 120));
      }
      return null;
    };

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.clearInterval(guardInterval);
      window.open = originalOpen;
    };
  }, [enableNavGuard]);

  // ── Popup guard: reclaim focus when popup steals it ──
  useEffect(() => {
    if (!enablePopupGuard) return;

    let reclaimTimer: number | null = null;

    const startReclaim = () => {
      if (reclaimTimer) return;
      let attempts = 0;
      reclaimTimer = window.setInterval(() => {
        attempts++;
        if (document.hasFocus()) {
          window.clearInterval(reclaimTimer!);
          reclaimTimer = null;
          return;
        }
        window.focus();
        try {
          const w = window.open('', '_self');
          if (w) w.focus();
        } catch (_) {}
        if (attempts >= 300) {
          window.clearInterval(reclaimTimer!);
          reclaimTimer = null;
        }
      }, 50);
    };

    window.addEventListener('blur', startReclaim);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        startReclaim();
      }
    });

    return () => {
      window.removeEventListener('blur', startReclaim);
      document.removeEventListener('visibilitychange', startReclaim);
      if (reclaimTimer) {
        window.clearInterval(reclaimTimer);
      }
    };
  }, [enablePopupGuard]);

  // ── CPU abuse watchdog ──
  useEffect(() => {
    if (!enableCpuWatchdog) return;

    const CPU_CHECK_MS = 3000;
    const CPU_WARN_MS = 300;
    const CPU_CONSECUTIVE_WARN = 3;
    const SESSION_MAX_MS = 60 * 60 * 1000;

    let cpuBadCount = 0;
    let cpuGoodCount = 0;
    let cpuTimeout: number;
    let sessionTimeout: number;
    let alive = true;

    function checkCPU() {
      if (!alive) return;
      const expected = performance.now() + CPU_CHECK_MS;

      cpuTimeout = window.setTimeout(() => {
        if (!alive) return;
        const actual = performance.now();
        const lag = actual - expected;

        if (lag > CPU_WARN_MS) {
          cpuBadCount++;
          cpuGoodCount = 0;
          if (cpuBadCount >= CPU_CONSECUTIVE_WARN) {
            setCpuWarning(true);
          }
        } else {
          cpuGoodCount++;
          if (cpuGoodCount >= 3) {
            cpuBadCount = 0;
            setCpuWarning(false);
          }
        }
        checkCPU();
      }, 0);
    }

    checkCPU();

    sessionTimeout = window.setTimeout(() => {
      if (!alive) return;
      refreshIframe();
    }, SESSION_MAX_MS);

    return () => {
      alive = false;
      window.clearTimeout(cpuTimeout);
      window.clearTimeout(sessionTimeout);
    };
  }, [enableCpuWatchdog, setCpuWarning, refreshIframe]);

  // ── Redirect breaker: detect iframe navigation away from video ──
  //
  // Polls contentWindow periodically. If the iframe navigates to a
  // different origin, accessing contentWindow throws a cross-origin
  // security error — we catch it and force the iframe back to the
  // original video URL. This prevents ad takeover inside the player.
  useEffect(() => {
    if (!enableRedirectBreaker) return;

    const CHECK_INTERVAL_MS = 1500;

    const intervalId = window.setInterval(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      const originalUrl = originalSrcRef.current;

      try {
        // Accessing contentWindow on a cross-origin iframe that has
        // navigated to a different domain will throw a SecurityError.
        const cw = iframe.contentWindow;

        if (!cw) {
          // Window is gone — likely navigated to a blocked page
          if (iframe.src !== originalUrl) {
            console.warn('[RedirectBreaker] contentWindow null, resetting iframe src');
            iframe.src = originalUrl;
          }
          return;
        }

        // If we can still access it, check if the src changed
        // (same-origin navigations within the provider domain are OK,
        // but if src no longer matches the original URL, reset)
        if (cw && iframe.src !== originalUrl) {
          try {
            // Check if the current src is still on the same origin
            const currentOrigin = new URL(iframe.src).origin;
            const originalOrigin = new URL(originalUrl).origin;

            if (currentOrigin !== originalOrigin) {
              console.warn('[RedirectBreaker] Cross-origin navigation detected, resetting');
              iframe.src = originalUrl;
            }
          } catch {
            // Malformed URL — reset just in case
            iframe.src = originalUrl;
          }
        }
      } catch {
        // Cross-origin SecurityError — iframe navigated to a different domain
        console.warn('[RedirectBreaker] Cross-origin error, resetting iframe src');
        iframe.src = originalUrl;
      }
    }, CHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [enableRedirectBreaker]);

  return (
    <iframe
      ref={iframeRef}
      className="absolute inset-0 w-full h-full z-10"
      src={src}
      referrerPolicy="no-referrer"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      title="Video player"
      onLoad={handleLoad}
      /**
       * Browser-enforced security sandbox.
       * Restricts popups, navigation, and other capabilities at the
       * browser level — the hard barrier.
       *
       * - allow-scripts: required for provider JS to run
       * - allow-same-origin: required for DOM access
       * - allow-forms: some providers need form submission
       * - allow-popups: allowed but guarded by JS navBlockers below
       *
       * Notably absent: allow-top-navigation, allow-pointer-lock
       */
      sandbox={sandbox}
    />
  );
}
