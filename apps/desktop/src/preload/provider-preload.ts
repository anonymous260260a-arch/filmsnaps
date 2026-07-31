/// <reference lib="dom" />

/**
 * FilmSnaps Desktop — Provider Webview Preload (Session-Level)
 *
 * This is the PRIMARY in-page security layer for the provider <webview>.
 * It is loaded by Electron's renderer client into EVERY renderer process that
 * is spawned for a WebContents using the `persist:filmsnaps-provider` session,
 * via `session.registerPreloadScript({ type: 'frame' })`. It runs at
 * document-start in the main frame AND every child frame (OOPIF), because
 * `nodeIntegrationInSubFrames: true` makes the renderer client load it into
 * every RenderFrame.
 *
 * It survives every reload, same-site and CROSS-SITE navigation (which swaps
 * the renderer process — the preload is loaded into each new process), and
 * cannot be removed by page JS (IIFE, non-configurable prototype overrides,
 * no leaked globals).
 *
 * Runs under `sandbox: true` — so it has NO access to Node APIs beyond
 * `require('electron')`, and no `process`/`Buffer`. It is fully self-contained.
 *
 * @module provider-preload
 */

// Self-executing, no globals leak, page cannot reach in.
(function () {
  "use strict";

  // ── Double-execution guard (belt-and-suspenders) ──
  const GUARD = Symbol.for("__filmsnaps_preload_guard");
  if ((globalThis as any)[GUARD]) return;
  try {
    Object.defineProperty(globalThis, GUARD, {
      value: true,
      configurable: false,
    });
  } catch {
    // If we can't set the guard, still proceed — worst case the IIFE runs
    // more than once, which the configurable:false overrides make idempotent.
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. PROTOTYPE OVERRIDES — run synchronously at document-start,
  //    before any page script. No DOM needed. Unremovable via
  //    configurable:false + writable:false.
  // ═══════════════════════════════════════════════════════════════

  // ── Canvas fingerprint noise ──
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    function addNoise(ctx: CanvasRenderingContext2D, w: number, h: number) {
      try {
        const imageData = origGetImageData.call(ctx, 0, 0, w, h);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] ^= 1; // R LSB
          d[i + 1] ^= 1; // G LSB
        }
        ctx.putImageData(imageData, 0, 0);
      } catch {
        /* cross-origin canvas — leave alone */
      }
    }

    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      value: function (this: HTMLCanvasElement, ...args: unknown[]) {
        const ctx = this.getContext("2d");
        if (ctx) addNoise(ctx, this.width, this.height);
        return (origToDataURL as any).apply(this, args);
      },
      configurable: false,
      writable: false,
    });

    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      value: function (this: HTMLCanvasElement, ...args: unknown[]) {
        const ctx = this.getContext("2d");
        if (ctx) addNoise(ctx, this.width, this.height);
        return (origToBlob as any).apply(this, args);
      },
      configurable: false,
      writable: false,
    });
  } catch {
    /* prototype spoofing is best-effort */
  }

  // ── WebGL renderer/vendor spoofing ──
  try {
    const spoofWebGL = (proto: any) => {
      const origGetParameter = proto.getParameter;
      Object.defineProperty(proto, "getParameter", {
        value: function (this: any, param: number) {
          if (param === 0x1f01)
            return "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630)"; // RENDERER
          if (param === 0x1f00) return "Google Inc. (Intel)"; // VENDOR
          return origGetParameter.call(this, param);
        },
        configurable: false,
        writable: false,
      });
    };
    spoofWebGL(WebGLRenderingContext.prototype);
    if (typeof (WebGL2RenderingContext as any) !== "undefined") {
      spoofWebGL((WebGL2RenderingContext as any).prototype);
    }
  } catch {
    /* webgl spoofing best-effort */
  }

  // ── Crypto-miner WASM heuristic throttle ──
  try {
    const origInstantiate = WebAssembly.instantiate;
    Object.defineProperty(WebAssembly, "instantiate", {
      value: function (source: any, ...args: any[]) {
        if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
          const bytes =
            source instanceof ArrayBuffer ? new Uint8Array(source) : source;
          const size = bytes.byteLength;
          // Miner modules are typically 100–400KB and import crypto/hash fns.
          if (size > 100_000 && size < 500_000) {
            try {
              const text = new TextDecoder().decode(bytes.slice(0, 2000));
              if (/cryptonight|coinhive|stratum|minerd|hashrate/i.test(text)) {
                return Promise.reject(new Error("WASM module blocked"));
              }
            } catch {
              /* decode best-effort */
            }
          }
        }
        return origInstantiate.call(WebAssembly, source, ...args);
      },
      configurable: false,
      writable: false,
    });
  } catch {
    /* wasm throttle best-effort */
  }

  // ── Miner worker blocking ──
  try {
    const OrigWorker = Worker;
    Object.defineProperty(globalThis, "Worker", {
      value: function (this: Worker, url: string | URL, ...args: any[]) {
        const href = String(url);
        if (/miner|coinhive|cryptonight|wasm-?worker/i.test(href)) {
          return new EventTarget() as any;
        }
        return new OrigWorker(href, ...args);
      } as any,
      configurable: false,
      writable: false,
    });
  } catch {
    /* worker blocking best-effort */
  }

  // ── sendBeacon: allow same-origin only ──
  try {
    const origBeacon = Navigator.prototype.sendBeacon;
    Object.defineProperty(Navigator.prototype, "sendBeacon", {
      value: function (this: Navigator, url: string | URL, ...args: any[]) {
        const href = String(url);
        try {
          const beaconOrigin = new URL(href, location.href).origin;
          if (beaconOrigin !== location.origin) {
            return true; // pretend it succeeded
          }
        } catch {
          return true; // malformed URL — block
        }
        return origBeacon.call(this, url, ...args);
      },
      configurable: false,
      writable: false,
    });
  } catch {
    /* sendBeacon best-effort */
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. COSMETIC CSS — injected as soon as <head>/<html> exists, via
  //    MutationObserver. Re-injects if the page removes our <style>.
  //    CSS is statically embedded (sandboxed preload has no fs access).
  // ═══════════════════════════════════════════════════════════════

  const COSMETIC_CSS: string = /* __FS_COSMETIC_CSS__ */ "";

  function injectCSS() {
    if (!COSMETIC_CSS) return;
    try {
      if (document.getElementById("__fs_cosmetic")) return;
      const style = document.createElement("style");
      style.id = "__fs_cosmetic";
      style.textContent = COSMETIC_CSS;
      (document.head || document.documentElement).appendChild(style);
    } catch {
      /* best-effort */
    }
  }

  function bootstrapCosmetic() {
    try {
      if (document.documentElement) {
        injectCSS();
        // Watch for removal by the page — re-inject.
        const cssGuard = new MutationObserver(() => {
          if (
            document.documentElement &&
            !document.getElementById("__fs_cosmetic")
          ) {
            injectCSS();
          }
        });
        cssGuard.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      } else {
        // Document not ready yet (document-start) — wait for <html>.
        const obs = new MutationObserver(() => {
          if (document.documentElement) {
            injectCSS();
            obs.disconnect();
          }
        });
        obs.observe(document, { childList: true });
      }
    } catch {
      /* best-effort */
    }
  }

  if (typeof document !== "undefined") {
    bootstrapCosmetic();
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. STORAGE KEY INTERCEPTION — block tracking persistence.
  //    (Session teardown wipes storage anyway; this prevents
  //    intra-session tracking across provider navigations.)
  // ═══════════════════════════════════════════════════════════════
  try {
    const origSetItem = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", {
      value: function (this: Storage, key: string, value: string) {
        if (/^(ga_|_ga|_fbp|_fbc|_gid|amplitude|mixpanel|segment)/i.test(key)) {
          return; // silently drop
        }
        return origSetItem.call(this, key, value);
      },
      configurable: false,
      writable: false,
    });
  } catch {
    /* storage interception best-effort */
  }
})();
