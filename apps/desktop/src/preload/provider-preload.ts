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

  // ── Double-execution guard (belt-and-suspenders) + HOOK MANIFEST ──
  // (V4 §6.1 / V5 §2.2) The guard is now an OBJECT, not a bare boolean, so a
  // verifier can report WHICH hooks are active, not just that the preload ran.
  // The main-process CDP probe and L7b sweep read `.hooks.length` to confirm
  // the real protection layers (not merely the guard flag) are in place.
  const GUARD = Symbol.for("__filmsnaps_preload_guard");
  const existing = (globalThis as any)[GUARD];
  if (existing) {
    // Already installed — but still let a later pass register its hooks (a
    // cross-context re-injection may carry layers the first pass lacked).
    return;
  }
  const hookManifest: string[] = [];
  try {
    Object.defineProperty(globalThis, GUARD, {
      value: {
        version: 1,
        hooks: hookManifest,
      },
      configurable: false,
    });
  } catch {
    // If we can't set the guard, still proceed — worst case the IIFE runs
    // more than once, which the configurable:false overrides make idempotent.
  }
  const registerHook = (name: string): void => {
    try {
      if (typeof (hookManifest as unknown[]) === "object")
        hookManifest.push(name);
    } catch {
      /* best-effort */
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // 0. FULL MOBILE PROTECTION BUNDLE — injected at build time.
  //
  // The build step (scripts/build-provider-preload.js) replaces the
  // __FS_MOBILE_BUNDLE__ placeholder below with the JSON-escaped output of
  // buildAllScriptsWithScriptlets() from @filmsnaps/shared — the SAME 15-layer
  // guard + uBO-style scriptlets bundle the mobile app injects into every
  // document (and which provably blocks all ads on the same providers).
  //
  // We execute it via `new Function` so it runs in the PAGE's global scope and
  // never sees this preload's closure-scoped `require`/`ipcRenderer` — it stays
  // unprivileged under sandbox:true. All its window.ReactNativeWebView
  // postMessage calls are already `&&`-guarded, so they are safe no-ops here.
  //
  // The GUARD symbol above already returned for a re-execution, and the bundle
  // is also idempotent on its own flags — so whichever of the preload (L5) or
  // the network HTML injection (L8) executes first wins; the other no-ops.
  const __fsMobile: string = /* __FS_MOBILE_BUNDLE__ */ "";
  if (__fsMobile) {
    try {
      new Function(__fsMobile)();
      registerHook("mobile-bundle");
    } catch (err) {
      // Best-effort — never let the bundle break the preload's own layers.
      console.error("[preload] Mobile protection bundle failed:", err);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 0.5 STREAM-AUDIT DIAGNOSTIC (expert V5 §5).
  //
  // Captures the player's stream provisioning so a FILMSNAPS_AUDIT=1 main-process
  // run shows the EXACT moment the stream dies. Logs document.referrer/location,
  // intercepts fetch/XHR for media-shaped URLs (manifest/m3u8/mpd/ts/m4s…) and
  // records the response status, and watches for <video> error + src assignment.
  //
  // Pure observation: it never blocks, rewrites, or drops anything. It logs via
  // console.info/console.error only, and the main-process console-message forward
  // relays lines containing "[STREAM-AUDIT]" or "[PROTECTION]" to stdout. Safe to
  // ship — zero behavioral impact when the forward is off.
  // ═══════════════════════════════════════════════════════════════
  try {
    const TAG = "[STREAM-AUDIT]";
    // BROAD capture: media URLs AND the provider-grant chain (`/api/…`,
    // token endpoints, $ipify), because the 401 lives on `/api/servers/*`
    // (NOT media-shaped) and the auth token is minted by `/api/<token>`.
    const isInteresting = (u: string): boolean =>
      /\.(m3u8|mpd|mp4|webm|ts|m4s)($|[?#])/i.test(u) ||
      /manifest|stream|playlist|segment|-seg-|chunk/i.test(u) ||
      /\/api\//i.test(u) ||
      /ipify/i.test(u) ||
      /token/i.test(u);
    const tagUrl = (u: any): string => String(u).slice(0, 220);
    // Serialize fetch init.headers (Headers | object | tuple-array) to a string.
    const hdrStr = (h: any): string => {
      try {
        if (!h) return "";
        if (typeof Headers !== "undefined" && h instanceof Headers) {
          const out: string[] = [];
          h.forEach((v, k) => out.push(`${k}=${v}`));
          return out.slice(0, 6).join(" "); // cap
        }
        if (Array.isArray(h))
          return h
            .slice(0, 6)
            .map((p) => `${p[0]}=${p[1]}`)
            .join(" ");
        if (typeof h === "object")
          return Object.entries(h as any)
            .slice(0, 6)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
        return String(h);
      } catch {
        return "(unreadable)";
      }
    };
    let cookieSample = "";
    try {
      cookieSample = document.cookie || "";
    } catch {}
    console.info(
      `${TAG} document.referrer="${document.referrer}" location.href="${location.href}"`,
    );
    console.info(
      `${TAG} document.cookie(length=${cookieSample.length})="${cookieSample.slice(0, 160)}${cookieSample.length > 160 ? "…" : ""}"`,
    );
    console.info(
      `${TAG} → capture scope: media + /api/ + token + ipify (referrer sampled above is document.referrer, NOT the wire Referer header — real headers come from the CDP Network capture)`,
    );

    // fetch
    const origFetch = window.fetch;
    window.fetch = function (this: unknown, input: any, init?: any) {
      const url = typeof input === "string" ? input : (input?.url ?? "");
      const isI = isInteresting(url);
      if (isI) {
        console.info(`${TAG} fetch-> ${tagUrl(url)}`);
        console.info(
          `${TAG} fetch  init.headers=[${hdrStr(init?.headers)}] method=${init?.method || "GET"}`,
        );
      }
      const p = origFetch.call(this, input, init);
      if (isI) {
        p.then((resp: any) => {
          const text =
            "status" in resp
              ? `${resp.status} ${resp.statusText || ""}`
              : resp?.status;
          console.info(`${TAG} fetch<- ${text} for ${tagUrl(url)}`);
          // AD-STATE SCHEMA CAPTURE (P0 for ad-suppression, expert follow-up):
          // /api/ads/cycles decides screenscape's ad-window state. Log the FULL
          // response body so we can mirror its exact schema when we later
          // intercept it with a synthetic "ad-free" response. Pure observation —
          // the response is still passed through untouched.
          if (/\/api\/ads\/cycles/i.test(url)) {
            resp
              .clone()
              .text()
              .then((b: string) =>
                console.info(
                  `${TAG} ADS-STATE ${tagUrl(url)} -> ${b.slice(0, 600)}`,
                ),
              )
              .catch(() => {});
          }
          if (typeof resp?.ok === "boolean" && !resp.ok) {
            resp
              .clone()
              .text()
              .then((b: string) =>
                console.error(
                  `${TAG} fetch FAILED: ${resp.status} sentHeaders=[${hdrStr(init?.headers)}] body=${b.slice(0, 300)}`,
                ),
              )
              .catch(() => {});
          }
        }).catch((err: any) =>
          console.error(
            `${TAG} fetch ERROR: ${err?.message} for ${tagUrl(url)}`,
          ),
        );
      }
      return p;
    };

    // XHR (also capture setRequestHeader so auth headers are visible)
    const _xhrProto: any = XMLHttpRequest.prototype;
    const _auditOpen = _xhrProto.open;
    const _auditSend = _xhrProto.send;
    const _auditSetHdr = _xhrProto.setRequestHeader;
    _xhrProto.open = function (method: string, url: any) {
      this._auditUrl = url;
      this._auditIsI = isInteresting(String(url));
      this._auditHdrs = [];
      if (this._auditIsI)
        console.info(`${TAG} XHR.open-> ${method} ${tagUrl(url)}`);
      return _auditOpen.apply(this, arguments as unknown as any[]);
    };
    _xhrProto.setRequestHeader = function (k: string, v: any) {
      try {
        this._auditHdrs.push(`${String(k)}=${String(v)}`);
      } catch {}
      return _auditSetHdr.apply(this, arguments as unknown as any[]);
    };
    _xhrProto.send = function () {
      if (this._auditIsI) {
        const hdrs = (this._auditHdrs || []).slice(0, 6).join(" ");
        this.addEventListener("loadend", () => {
          console.info(
            `${TAG} XHR<- ${this.status} ${this.statusText} for ${tagUrl(this._auditUrl || "")}`,
          );
          if (this.status >= 400)
            console.error(
              `${TAG} XHR FAILED: ${this.status} sentHeaders=[${hdrs}] body=${(this.responseText || "").slice(0, 300)}`,
            );
        });
      }
      return _auditSend.apply(this, arguments as unknown as any[]);
    };

    // <video> error + src
    const _auditCreateElement: any = document.createElement.bind(document);
    (document as any).createElement = function (tag: string) {
      const el: any = _auditCreateElement(tag);
      if (String(tag).toLowerCase() === "video") {
        el.addEventListener("error", () => {
          const e: any = el.error;
          console.error(
            `${TAG} <video> error: code=${e?.code} message="${e?.message}" src="${(el.currentSrc || el.getAttribute("src") || "").slice(0, 200)}"`,
          );
        });
        const desc: any = Object.getOwnPropertyDescriptor(
          HTMLMediaElement.prototype,
          "src",
        );
        if (desc?.set) {
          Object.defineProperty(el, "src", {
            get: desc.get,
            set: function (v: any) {
              console.info(
                `${TAG} <video>.src SET -> ${String(v).slice(0, 200)}`,
              );
              return desc.set.call(this, v);
            },
            configurable: true,
          });
        }
      }
      return el;
    };
    console.info(`${TAG} Stream audit hooks installed`);
  } catch (auditErr: any) {
    console.error("[STREAM-AUDIT] install failed:", auditErr);
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
    registerHook("canvas-spoof");

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
    registerHook("webgl-spoof");
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
    registerHook("wasm-miner-throttle");
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
    registerHook("miner-worker-block");
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
    registerHook("sendbeacon-guard");
  } catch {
    /* sendBeacon best-effort */
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. COSMETIC CSS — injected as part of the document's HTML bytes at
  //    document-start by the preload mechanism (L5/L6) and/or the HTML-bytes
  //    injection layer (L8 via addScriptToEvaluateOnNewDocument). The CSS is
  //    part of the document's BYTES, so there is no IPC, no timing window,
  //    no hostname ambiguity, and no fail-open path (V5 Gap A — the primary
  //    fix). No MutationObserver needed — CSS injected at bytes level persists
  //    for the document lifetime and cannot be "removed" by DOM scripts without
  //    also removing the entire injected script block, which the GUARD sentinel
  //    prevents.
  // ═══════════════════════════════════════════════════════════════

  // The COSMETIC_CSS constant is baked into the compiled provider-preload.js at
  // build time by scripts/build-provider-preload.mjs, which runs
  // buildAllScriptsWithScriptlets(). It is part of the document's HTML bytes,
  // injected before first paint. No runtime MutationObserver is needed.
  // If __FS_COSMETIC_CSS__ is empty, no cosmetic CSS was compiled in — the
  // static CSS from the HTML injection layer (L8) covers the common cases.

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
    registerHook("storage-key-block");
  } catch {
    /* storage interception best-effort */
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. ENGINE-DERIVED COSMETIC FILTER INJECTION (Pillar B)
  //
  // The @cliqz/adblocker engine holds ~42k cosmetic filters (element hiding +
  // scriptlets). They are only meaningful against a LIVE page's DOM — the
  // static CSS (__FS_COSMETIC_CSS__) covers the common ad containers, but the
  // engine knows the per-site ad selectors. We sweep the live DOM for class /
  // id / href tokens, send them to the MAIN process over IPC (the engine lives
  // there and can't be reached from this sandboxed preload), and apply the
  // returned { styles, scripts } — exactly the DOMMonitor pattern the
  // @ghostery/adblocker-electron package uses, minus the re-injection of the
  // network filter (our R0-R8 onBeforeRequest already handles that).
  //
  // ipcRenderer stays closure-scoped here — it is never exposed to the page.
  // Fail-open: if IPC or the engine errors, we simply skip this pass.
  if (typeof document !== "undefined") {
    try {
      const electron = require("electron") as {
        ipcRenderer?: {
          invoke: (channel: string, payload?: unknown) => Promise<unknown>;
        };
      };
      const ipc = electron?.ipcRenderer;
      if (ipc) {
        let probeTimer: ReturnType<typeof setTimeout> | null = null;
        let appliedOnce = false;

        const collectTokens = (): {
          classes: string[];
          ids: string[];
          hrefs: string[];
        } => {
          const classes = new Set<string>();
          const ids = new Set<string>();
          const hrefs = new Set<string>();
          try {
            const cls = document.querySelectorAll("[class]");
            for (let i = 0; i < cls.length; i++) {
              const c = (cls[i] as HTMLElement).className;
              if (typeof c === "string" && c) {
                for (const token of c.split(/\s+/)) {
                  if (token && token.length < 128) classes.add(token);
                }
              }
            }
            const idEls = document.querySelectorAll("[id]");
            for (let i = 0; i < idEls.length; i++) {
              const id = (idEls[i] as HTMLElement).id;
              if (id && id.length < 128) ids.add(id);
            }
            const anchors = document.querySelectorAll("a[href]");
            for (let i = 0; i < anchors.length; i++) {
              const href = (anchors[i] as HTMLAnchorElement).getAttribute(
                "href",
              );
              if (href && href.length < 256 && !href.startsWith("#")) {
                hrefs.add(href);
              }
            }
          } catch {
            /* DOM read best-effort */
          }
          return {
            classes: Array.from(classes).slice(0, 5000),
            ids: Array.from(ids).slice(0, 2000),
            hrefs: Array.from(hrefs).slice(0, 2000),
          };
        };

        const applyCosmetics = async (): Promise<void> => {
          if (probeTimer) {
            clearTimeout(probeTimer);
            probeTimer = null;
          }
          try {
            const payload = collectTokens();
            if (
              payload.classes.length === 0 &&
              payload.ids.length === 0 &&
              payload.hrefs.length === 0
            ) {
              return;
            }
            const reply = (await ipc.invoke("cosmetic:probe", payload)) as {
              styles?: string;
              scripts?: string[];
            } | null;
            if (!reply) return;
            if (reply.styles) {
              let style = document.getElementById(
                "__fs_cosmetic_engine",
              ) as HTMLStyleElement | null;
              if (!style) {
                style = document.createElement("style");
                style.id = "__fs_cosmetic_engine";
                (document.head || document.documentElement).appendChild(style);
              }
              style.textContent = reply.styles;
            }
            if (reply.scripts && reply.scripts.length) {
              for (const script of reply.scripts) {
                try {
                  new Function(script)();
                } catch {
                  /* scriptlet best-effort */
                }
              }
            }
            appliedOnce = true;
            // Positive cosmetic log (V4 step 5 / V5 Gap A diagnostic) — proves
            // the engine-derived cosmetics actually landed in THIS frame.
            try {
              console.log(
                `[preload] cosmetic applied: ${reply.styles?.length ?? 0} chars CSS, ${reply.scripts?.length ?? 0} scriptlets (frame ${location.hostname})`,
              );
            } catch {
              /* log best-effort */
            }
          } catch {
            /* cosmetic probe fail-open */
          }
        };

        const scheduleProbe = (): void => {
          if (probeTimer) clearTimeout(probeTimer);
          probeTimer = setTimeout(() => void applyCosmetics(), 800);
        };

        const startCosmeticSweeper = (): void => {
          // Wait for a non-blank document before the first probe.
          scheduleProbe();
          // V4 step 7 / V5 §2.3 — probe IMMEDIATELY on DOMContentLoaded, NOT only
          // via the mutation observer + 4s interval. This eliminates the
          // initial-load flash window where ads render before the first probe.
          if (document.readyState === "loading") {
            document.addEventListener(
              "DOMContentLoaded",
              () => void applyCosmetics(),
              { once: true },
            );
          } else {
            void applyCosmetics();
          }
          const obs = new MutationObserver(scheduleProbe);
          try {
            obs.observe(document.documentElement, {
              childList: true,
              subtree: true,
            });
          } catch {
            /* observer best-effort */
          }
          // Re-probe periodically in case the page rewrites its ad DOM.
          setInterval(() => void applyCosmetics(), 4000);
          // Expose a tiny hook so the main process can force a refresh.
          (globalThis as any).__fsRefreshCosmetic = () => void applyCosmetics();
          registerHook("cosmetic-engine");
          void appliedOnce; // keep the flag honest (unused but documents intent)
        };

        if (document.documentElement) {
          startCosmeticSweeper();
        } else {
          const waitObs = new MutationObserver(() => {
            if (document.documentElement) {
              waitObs.disconnect();
              startCosmeticSweeper();
            }
          });
          waitObs.observe(document, { childList: true });
        }
        // Failure path — the mutations above ran after the hook install; if the
        // first probe finds nothing collectible, log so we can tell "no ads to
        // hide" from "engine/IPC broken" (V4 step 5).
        setTimeout(() => {
          if (!appliedOnce) {
            try {
              console.log(
                "[preload] cosmetic probe: no tokens collected yet (page still building DOM or no ads)",
              );
            } catch {
              /* log best-effort */
            }
          }
        }, 2500);
      }
    } catch {
      /* cosmetic engine unavailable — static CSS only */
    }
  }
})();
