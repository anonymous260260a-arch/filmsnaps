/**
 * SecureIframe — secure iframe wrapper for provider embeds.
 *
 * Inlines navigation guard, popup guard, and CPU abuse watchdog.
 * Renders only the iframe layer — no controls or overlays.
 */

'use client';

import React, { useRef, useEffect } from 'react';
import { usePlayer } from './PlayerProvider';

interface SecureIframeProps {
  /** The embed URL to load */
  src: string;
  /** Whether to enable CPU abuse watchdog */
  enableCpuWatchdog?: boolean;
  /** Whether to enable navigation guard */
  enableNavGuard?: boolean;
  /** Whether to enable popup guard */
  enablePopupGuard?: boolean;
}

export function SecureIframe({
  src,
  enableCpuWatchdog = true,
  enableNavGuard = true,
  enablePopupGuard = true,
}: SecureIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { setCpuWarning, refreshIframe } = usePlayer();

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

  return (
    <iframe
      ref={iframeRef}
      className="absolute inset-0 w-full h-full z-10"
      src={src}
      referrerPolicy="no-referrer"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      title="Video player"
    />
  );
}
