/**
 * DesktopSecureWebview — Electron WebContentsView wrapper for inline provider
 * playback (Phase 3 hybrid migration).
 *
 * The provider embed no longer renders inside a DOM `<webview>` tag. Instead
 * main process owns a single native `WebContentsView` (created lazily on the
 * first `player:open`, reused for the app lifetime). This component:
 *
 *   1. Reserves a black rect (the native view sits above it).
 *   2. Measures the rect (ResizeObserver) and syncs bounds to main via IPC
 *      `player:set-bounds`, so the native view always overlays the rect.
 *   3. Drives the view lifecycle via IPC: `player:open` (src), `player:reload`,
 *      `player:set-visible` (hide while a React overlay must render above it),
 *      `player:close` on teardown.
 *   4. Subscribes to `player:state` for load/error/audit and forwards the
 *      existing `onLoad`/`onLoadStart`/`onError` callbacks unchanged.
 *
 * All loading/error chrome stays in React (WatchClient/VideoZone already have
 * isPending/iframeLoadError/cpuWarning/playerReady). Security layers are
 * identical: R0-R8 session filters, nav guard, CDP-Fetch L8, session preload —
 * they attach to `view.webContents`, not to a webview element.
 *
 * @module DesktopSecureWebview
 */

"use client";

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { usePlayer } from "@/components/player/PlayerProvider";

export interface DesktopSecureWebviewHandle {
  reload: () => void;
  getWebContentsId: () => number | null | Promise<number | null>;
}

interface DesktopSecureWebviewProps {
  /** Provider embed URL to load */
  src: string;
  /** Called when the page finishes loading (includes error pages) */
  onLoad?: () => void;
  /** Called when navigation starts */
  onLoadStart?: () => void;
  /** Called when the page fails to load */
  onError?: (error: string) => void;
  /** Additional attributes are a no-op for the native view (kept for interface parity). */
  extraAttributes?: Record<string, string>;
}

/**
 * DesktopSecureWebview — reserves a rect for the native WebContentsView and
 * drives it via IPC. Same external interface as the old <webview> wrapper so
 * mount sites (VideoZone/WatchClient) are unchanged.
 */
export const DesktopSecureWebview = forwardRef<
  DesktopSecureWebviewHandle,
  DesktopSecureWebviewProps
>(function DesktopSecureWebview(
  { src, onLoad, onLoadStart, onError }: DesktopSecureWebviewProps,
  ref,
) {
  const rectRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  /** Window fullscreen from main (player:state) — fullscreen hides native chrome. */
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Any React overlay (server dropdown, CPU warning, error state, loading) that must sit above the native view. */
  const { overlayActive, setOverlayActive } = usePlayer();

  // Latest props via refs so the one-shot mount effect can read fresh values
  // without re-running (and without re-driving IPC).
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const onLoadStartRef = useRef(onLoadStart);
  onLoadStartRef.current = onLoadStart;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const openedRef = useRef<string | null>(null);
  // Track if we're mounted to drive proper cleanup
  const mountedRef = useRef(true);

  // ── Expose imperative methods via ref ──
  useImperativeHandle(ref, () => ({
    reload: () => {
      window.electronAPI?.player.reload();
    },
    getWebContentsId: async () => {
      try {
        return (await window.electronAPI?.player.getWebContentsId()) ?? null;
      } catch {
        return null;
      }
    },
  }));

  // ── Sync bounds: measure the rect and push to main so the native view
  // overlays exactly. Re-measure on resize / layout shifts.
  // In FULLSCREEN main owns the bounds (providerViewFitToContent fills the
  // whole window on enter/leave-full-screen); pushing the player-rect here
  // would shrink the view back to the letterboxed box, so we skip it. On
  // leaving fullscreen the effect below re-runs and resumes rect-following.
  const syncBounds = useCallback(() => {
    const el = rectRef.current;
    if (!el) return;
    if (isFullscreen) return;
    const r = el.getBoundingClientRect();
    window.electronAPI?.player.setBounds({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });
  }, [isFullscreen]);

  useEffect(() => {
    const el = rectRef.current;
    if (!el) return;
    let rafId: number = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        syncBounds();
      });
    });
    ro.observe(el);
    syncBounds();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [syncBounds]);

  // ── On leaving fullscreen, re-sync bounds to the (now letterboxed) rect —
  // main's providerViewFitToContent only re-applies on enter/leave events; the
  // rect measured here must drive the normal (non-fullscreen) state. ──
  useEffect(() => {
    if (isFullscreen) return;
    syncBounds();
  }, [isFullscreen, syncBounds]);

  // ── src → player:open. Navigates the SAME native view in place (preserves
  // its WebContents + session + preload), exactly like the old in-place
  // webview.src update. No remount on provider/episode/season/refresh change. ──
  useEffect(() => {
    if (openedRef.current === src) return;
    openedRef.current = src;
    setIsLoading(true);
    setHasError(false);
    window.electronAPI?.player.open(src);
  }, [src]);

  // ── player:state subscription: load/error/audit/fullscreen → callbacks ──
  useEffect(() => {
    const unsubscribe = window.electronAPI?.player.onState((state) => {
      if (typeof (state as any).isFullscreen === "boolean") {
        setIsFullscreen((state as any).isFullscreen);
      }
      if (state.loading) {
        setIsLoading(true);
        onLoadStartRef.current?.();
      }
      if (state.loaded) {
        setIsLoading(false);
        setHasError(false);
        onLoadRef.current?.();
      }
      if (state.error) {
        setIsLoading(false);
        setHasError(true);
        setErrorMessage(state.error);
        onErrorRef.current?.(state.error);
      }
      if (state.provisionalError) {
        // A provisional failure (e.g. ERR_FAILED on the initial server hop)
        // is often transient — the embed may redirect to the real player host.
        // Surface it only if no load completes shortly after.
        const handle = window.setTimeout(() => {
          if (!openedRef.current) return;
          setHasError(true);
          setErrorMessage(state.provisionalError ?? "Failed to load");
          onErrorRef.current?.(state.provisionalError ?? "Failed to load");
        }, 8000);
        window.setTimeout(() => window.clearTimeout(handle), 9000);
      }
      if (state.audit) {
        console.log(`[DesktopSecureWebview] ${state.audit}`);
      }
    });
    return () => unsubscribe?.();
  }, []);

  // ── Visibility reconciliation. The native view draws over ALL DOM, so it
  // must be shown only when NO React overlay needs to win the z-order over the
  // rect: loading, error, CPU warning, server dropdown, or any other overlay.
  // Fullscreen does NOT hide the view — main handles fullscreen bounds on the
  // window. Mirrors overlay state into main so the view never covers React,
  // and keeps the view mounted + hidden (player:set-visible detaches it
  // from the contentView) rather than unmounting the singleton.
  useEffect(() => {
    window.electronAPI?.player.setVisible(
      !isLoading && !hasError && !overlayActive,
    );
  }, [overlayActive, isLoading, hasError]);

  // ── Unmount cleanup: close the native view so it doesn't persist when
  // navigating away (e.g., back to home page).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.electronAPI?.player.close();
    };
  }, []);

  // ── Render ──
  return (
    <div className="relative w-full h-full min-h-[400px] bg-black overflow-hidden">
      {/* Loading indicator */}
      {isLoading && !hasError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-[#D4A237]/10 border border-[#D4A237]/20 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-[#D4A237]/80"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                  />
                </svg>
              </div>
              <div
                className="absolute -inset-2 rounded-2xl border-2 border-transparent border-t-[#D4A237]/30 animate-spin"
                style={{ animationDuration: "2s" }}
              />
            </div>
            <p className="text-white/70 text-sm font-semibold tracking-wide">
              Connecting to provider...
            </p>
            <p className="text-faint text-xs">
              Secure tunnel active — All filtering layers engaged
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#070708] gap-4 px-6">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-[#E05252]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <p
            className="text-xl text-foreground font-bold text-center"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Stream Connection Lost
          </p>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            {errorMessage ||
              "The provider could not be reached. Try switching servers."}
          </p>
        </div>
      )}

      {/* Black rect the native view overlays. Must always be present + sized so
          getBoundingClientRect() reflects the real player area. */}
      <div
        ref={rectRef}
        className="absolute inset-0 z-10"
        style={{ minHeight: "400px" }}
      />
    </div>
  );
});
