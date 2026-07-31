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

  // ── Initialize webview on mount (ONLY ONCE) ──
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
      onError?.("webviewTag is not enabled in BrowserWindow config");
      return;
    }

    // Set initial src — subsequent src changes go through the dedicated effect below
    webview.src = src;
    prevSrcRef.current = src;
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

    // Apply extra attributes
    if (extraAttributes) {
      for (const [key, value] of Object.entries(extraAttributes)) {
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
      setIsLoading(true);
      onLoadStart?.();
    });

    webview.addEventListener("did-stop-loading", () => {
      setIsLoading(false);
    });

    webview.addEventListener("did-finish-load", () => {
      setIsLoading(false);
      setHasError(false);
      webviewReadyRef.current = true;

      // NOTE: protection script + cosmetic CSS are injected at document-start
      // from the MAIN process via CDP (did-attach-webview) — reload-immune,
      // no renderer race. Nothing to inject here anymore.

      onLoad?.();
    });

    webview.addEventListener("did-fail-load", (_e: any) => {
      const errMsg = _e.errorDescription || "Failed to load";
      if (_e.errorCode === -3) return; // cancelled
      setHasError(true);
      setErrorMessage(errMsg);
      onError?.(errMsg);
    });

    webview.addEventListener("crashed", () => {
      setHasError(true);
      setErrorMessage("Web process crashed");
      onError?.("Web process crashed");
    });

    webview.addEventListener("gpu-crashed", () => {
      setHasError(true);
      setErrorMessage("GPU process crashed");
      onError?.("GPU process crashed");
    });

    // ── Append to container ──
    container.appendChild(webview);
    webviewRef.current = webview;
  }, [partitionName, extraAttributes, onLoad, onLoadStart, onError]); // NOTE: `src` intentionally excluded — src updates go through the dedicated effect below

  // ── Mount effect: create the webview once ──
  useEffect(() => {
    initWebview();
    return () => {
      webviewReadyRef.current = false;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      webviewRef.current = null;
    };
    // Run only on mount — src changes handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Src update effect: update webview src WITHOUT remounting ──
  // This avoids expensive DOM teardown/recreation on every provider/episode switch.
  const srcRef = useRef(src);
  srcRef.current = src;

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !webviewReadyRef.current) {
      // Webview not ready yet — the init will set src via initWebview
      prevSrcRef.current = src;
      return;
    }

    if (prevSrcRef.current === src) return;
    prevSrcRef.current = src;

    // Show loading overlay, clear errors
    setIsLoading(true);
    setHasError(false);

    // Update src in-place — webview navigates preserving its process and session
    webview.src = src;
  }, [src]);

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
