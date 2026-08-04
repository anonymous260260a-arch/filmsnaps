/**
 * DesktopSecureWebview — Electron <webview> wrapper for inline provider playback.
 *
 * Security layers (defense in depth):
 *   A. Network: R0-R8 cascade via session.webRequest (main process, can't be bypassed)
 *   B. Navigation: will-navigate interception restricts webview to allowlisted domains
 *   C. In-page: Protection script injected via executeJavaScript() covers:
 *      1. Canvas/WebGL/Audio fingerprinting spoofing
 *      2. Crypto miner detection (WASM compilation throttle)
 *      3. Tracking pixel removal
 *      4. Storage tracking (localStorage/IndexedDB key interception)
 *      5. Click-stream listener blocking
 *      6. Worker blocking for unknown origins
 *      7. Autofill phishing form detection
 *      8. sendBeacon blocking
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

// ── Webview event types (Electron-specific) ──

interface WebviewElement extends HTMLElement {
  src: string;
  partition: string;
  webpreferences: string;
  style: CSSStyleDeclaration;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  stop: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  isLoading: () => boolean;
  addEventListener: (event: string, listener: (e: any) => void) => void;
  removeEventListener: (event: string, listener: (e: any) => void) => void;
  getWebContentsId: () => number;
  setAttribute: (name: string, value: string) => void;
  executeJavaScript: (code: string) => Promise<unknown>;
}

export interface DesktopSecureWebviewHandle {
  reload: () => void;
  getWebContentsId: () => number | null;
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
  /** Additional attributes to set on the webview element */
  extraAttributes?: Record<string, string>;
}

/**
 * DesktopSecureWebview — wraps Electron's <webview> tag with
 * loading states, error handling, lifecycle management, and
 * comprehensive security protections.
 */
export const DesktopSecureWebview = forwardRef<
  DesktopSecureWebviewHandle,
  DesktopSecureWebviewProps
>(function DesktopSecureWebview(
  {
    src,
    onLoad,
    onLoadStart,
    onError,
    extraAttributes,
  }: DesktopSecureWebviewProps,
  ref,
) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const webviewReadyRef = useRef(false);

  const prevSrcRef = useRef<string>(src);

  // Latest props via refs so the one-shot mount effect can read fresh values
  // without re-running (and without tearing the singleton webview down).
  const srcRef = useRef(src);
  srcRef.current = src;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const onLoadStartRef = useRef(onLoadStart);
  onLoadStartRef.current = onLoadStart;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const extraAttrsRef = useRef(extraAttributes);
  extraAttrsRef.current = extraAttributes;

  // ── Expose imperative methods via ref ──
  useImperativeHandle(ref, () => ({
    reload: () => {
      if (webviewRef.current && webviewReadyRef.current) {
        webviewRef.current.reload();
      }
    },
    getWebContentsId: () => {
      try {
        return webviewRef.current?.getWebContentsId() ?? null;
      } catch {
        return null;
      }
    },
  }));

  // ── Partition name: scoped to provider so switching resets session ──
  const partitionName = "persist:filmsnaps-provider";

  // Track the src the webview is CURRENTLY (or just was) navigating toward, and
  // whether a load is in progress, so did-fail-load can tell a REAL navigation
  // failure from a teardown race (provider switch destroys the old guest
  // mid-navigation → ERR_FAILED -2). A -2 whose src is stale (we already asked
  // to go somewhere else) is teardown noise and must NOT surface as an error.
  const pendingNavRef = useRef<string | null>(null);

  const handleDidFailLoad = useCallback((_e: any) => {
    const errMsg = _e.errorDescription || "Failed to load";
    const code: number = _e.errorCode;
    const failedUrl: string = _e.validatedURL || "";

    // ERR_ABORTED (-3): navigation cancelled by a newer navigation or stop().
    if (code === -3) return;

    if (code === -2) {
      // ERR_FAILED — almost always the webview TEARDOWN race: switching
      // providers destroys the old guest while its in-flight navigation is
      // still pending, and the destroyed WebContents reports ERR_FAILED for
      // the aborted load. The singleton webview's src already points at the
      // NEW provider's URL by the time this fires, so a stale failedUrl means
      // this is teardown noise, not a real failure of the current destination.
      if (
        pendingNavRef.current &&
        failedUrl &&
        pendingNavRef.current !== failedUrl
      ) {
        // The navigation that failed is NOT the one we're currently after —
        // a superseding src change caused it. Ignore.
        return;
      }
      // Fallthrough: a -2 for the CURRENT src with no superseding navigation
      // is still most likely transient teardown — let the next src update or
      // retry clear it rather than showing a hard error overlay.
      console.warn(
        `[DesktopSecureWebview] Transient ERR_FAILED (-2): ${failedUrl}`,
      );
      return;
    }

    // All other error codes are genuine navigation failures.
    setHasError(true);
    setErrorMessage(errMsg);
    onErrorRef.current?.(errMsg);
  }, []);

  const handleDidStopLoading = useCallback(() => {
    setIsLoading(false);
    pendingNavRef.current = null;
  }, []);

  const handleDidStartLoading = useCallback(() => {
    setIsLoading(true);
    onLoadStartRef.current?.();
  }, []);

  // ── Singleton webview ──
  // The webview element is created EXACTLY ONCE per mount of this component and
  // is NEVER destroyed by src/attribute changes. Provider/season/episode/retry
  // updates navigate the SAME element in place (webview.src = ...), preserving
  // its WebContents and session — so the session preload (L5/L6), R0-R8 filter
  // (L2) and CSP (L3), all session-scoped, stay active across every switch.
  //
  // CRITICAL: React must never remount this component on key changes (see
  // WatchClient/VideoZone) — a remount tears down the element and its
  // WebContents, opening the remount race that lets a fresh guest navigate
  // before main-process attach (L4/L7) re-arms.
  const initWebview = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear any previous webview
    container.innerHTML = "";

    // Create the webview element
    const webview = document.createElement("webview") as WebviewElement;

    // Detect if <webview> tag is actually supported
    if (
      webview.tagName !== "WEBVIEW" &&
      (webview as any).tagName !== "WEBVIEW"
    ) {
      console.warn(
        "[DesktopSecureWebview] <webview> tag not supported — webviewTag may be disabled",
      );
      setHasError(true);
      setErrorMessage("Electron webview tag is not enabled. Restart the app.");
      onErrorRef.current?.("webviewTag is not enabled in BrowserWindow config");
      return;
    }

    // Set initial src — subsequent src changes go through the dedicated effect below
    webview.src = srcRef.current;
    prevSrcRef.current = srcRef.current;
    pendingNavRef.current = srcRef.current;
    webview.partition = partitionName;
    // NOTE: Do NOT set allowpopups — in Electron, the mere presence of the
    // allowpopups attribute (even "false") enables popup windows.
    //
    // Security settings (contextIsolation, sandbox, nodeIntegrationInSubFrames,
    // allowPopups, preload, etc.) are enforced MAIN-PROCESS-SIDE in the
    // will-attach-webview handler. Do NOT set them here — a webpreferences
    // string can conflict with the main-process override, and the session
    // preload (set via session.setPreloads) is what actually loads. Keeping
    // the element free of webpreferences lets the main process be the single
    // source of truth for the provider webview's security configuration.
    webview.webpreferences = "javascript=yes";

    // Apply extra attributes (latest via ref)
    if (extraAttrsRef.current) {
      for (const [key, value] of Object.entries(extraAttrsRef.current)) {
        webview.setAttribute(key, value);
      }
    }

    // ── Style the webview ──
    webview.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border: none;
        outline: none;
      `;

    // ═══════════════════════════════════════════════════════════════
    // C: NEW-WINDOW BLOCKING
    // (Belt-and-suspenders — the main-process navigation guard on the guest
    // webContents already denies window.open.)
    // ═══════════════════════════════════════════════════════════════
    webview.addEventListener("new-window", (e: any) => {
      e.preventDefault();
    });

    // ── Loading events ──
    webview.addEventListener("did-start-loading", () => {
      handleDidStartLoading();
    });

    webview.addEventListener("did-stop-loading", () => {
      handleDidStopLoading();
    });

    webview.addEventListener("did-finish-load", () => {
      setIsLoading(false);
      setHasError(false);
      pendingNavRef.current = null;
      webviewReadyRef.current = true;

      // NOTE: protection script + cosmetic CSS are injected at document-start
      // from the MAIN process via CDP (did-attach-webview) — reload-immune,
      // no renderer race. Nothing to inject here anymore.

      onLoadRef.current?.();
    });

    webview.addEventListener("did-fail-load", (_e: any) => {
      handleDidFailLoad(_e);
    });

    webview.addEventListener("crashed", () => {
      setHasError(true);
      setErrorMessage("Web process crashed");
      onErrorRef.current?.("Web process crashed");
    });

    webview.addEventListener("gpu-crashed", () => {
      setHasError(true);
      setErrorMessage("GPU process crashed");
      onErrorRef.current?.("GPU process crashed");
    });

    // ── Append to container ──
    container.appendChild(webview);
    webviewRef.current = webview;
    webviewReadyRef.current = true;
  }, [partitionName]);

  // ── Singleton mount effect: create the webview EXACTLY ONCE ──
  // Never depends on props (src, onLoad, etc.) so a prop change cannot tear the
  // element down. src updates navigate the same element in place below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    initWebview();
    return () => {
      webviewReadyRef.current = false;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      webviewRef.current = null;
    };
  }, []);

  // ── Src update effect: update webview src WITHOUT remounting ──
  // A provider/episode/refresh change navigates the SAME element in place,
  // preserving its WebContents, process and session — so the session preload
  // (L5/L6), R0-R8 filter (L2) and CSP (L3) stay active across every switch.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    if (prevSrcRef.current === src) return;
    prevSrcRef.current = src;

    // Show loading overlay, clear errors
    setIsLoading(true);
    setHasError(false);

    // Mark the destination we're navigating toward so did-fail-load can tell
    // a real failure from a teardown race on a superseded URL.
    pendingNavRef.current = src;

    // Update src in-place — the webview navigates preserving its session
    webview.src = src;
  }, [src]);

  // ── Extra attributes effect: update attributes in place (no remount) ──
  const prevAttrsRef = useRef<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const prev = prevAttrsRef.current;
    if (prev) {
      for (const key of Object.keys(prev)) {
        webview.removeAttribute(key);
      }
    }
    for (const [key, value] of Object.entries(extraAttributes ?? {})) {
      webview.setAttribute(key, value);
    }
    prevAttrsRef.current = extraAttributes;
  }, [extraAttributes]);

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
            <p className="text-[#52525B] text-xs">
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
            className="text-xl text-[#F4F4F5] font-bold text-center"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Stream Connection Lost
          </p>
          <p className="text-sm text-[#A1A1AA] text-center max-w-xs">
            {errorMessage ||
              "The provider could not be reached. Try switching servers."}
          </p>
        </div>
      )}

      {/* Webview container */}
      <div
        ref={containerRef}
        className="absolute inset-0 z-10"
        style={{ minHeight: "400px" }}
      />
    </div>
  );
});
