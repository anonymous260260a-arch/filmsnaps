/**
 * FilmSnaps Desktop — Provider Webview CDP VERIFICATION Layer
 *
 * NOTE: This is NOT the primary injection mechanism anymore. The PRIMARY in-page
 * protection is the SESSION-LEVEL PRELOAD (session.setPreloads + the compiled
 * dist/preload/provider-preload.js), which runs at document-start in the main
 * frame AND every child frame of every renderer process — surviving cross-site
 * navigations that swap renderer processes (which CDP cannot).
 *
 * CDP here is a STETHOSCOPE, not a shield (per expert consultation 2026-08-01):
 * it attaches a debugger to the guest webContents purely to VERIFY the preload
 * is actually present and active in every live frame, and to log failures
 * loudly in development. It does not inject the protection script.
 *
 * Because webContents.debugger is attached to the renderer PROCESS, it detaches
 * on cross-site navigation ('target closed'); we re-attach on 'did-navigate'
 * (the deterministic signal that the new renderer has committed) — but the
 * preload has already done its work by then, so there is no unprotected window.
 */

import { WebContents } from "electron";
import {
  getAllowedDomainsForProvider,
  getGlobalCdnAllowlist,
  getProviderRootHosts,
} from "./provider-config";
import { getCurrentBlockingProviderId } from "./request-filter";
import { getCosmeticFilterPayload } from "./filter-engine";

const CDP_PROTOCOL = "1.3";
/** How long after a committed navigation to probe the frame tree. */
const VERIFY_DELAY_MS = 1200;
/**
 * Periodic re-injection sweep interval — the desktop equivalent of mobile's
 * in-page DOM sweeper (3s). Catches frames created AFTER load that the
 * navigation-triggered sweeps never see.
 */
const SWEEP_INTERVAL_MS = 3000;

/**
 * Union of every domain the provider page may legitimately load — used by the
 * navigation guard's allowlist. Computed entirely in the main process from
 * blocklist.json + the embed URL.
 */
export function computeProviderAllowedDomains(
  providerId: string | undefined,
  embedUrl?: string,
): Set<string> {
  const domains = new Set<string>();
  if (providerId) {
    for (const d of getAllowedDomainsForProvider(providerId))
      domains.add(d.toLowerCase());
  }
  for (const d of getGlobalCdnAllowlist()) domains.add(d.toLowerCase());
  for (const d of getProviderRootHosts()) domains.add(d.toLowerCase());
  if (embedUrl) {
    try {
      domains.add(new URL(embedUrl).hostname.toLowerCase());
    } catch {}
  }
  return domains;
}

/** Per-WebContents guard against double-attach. */
const watched = new WeakSet<WebContents>();

export interface AttachOptions {
  providerId?: string;
  embedUrl?: string;
}

/**
 * Attach CDP to a provider webview's guest webContents for VERIFICATION ONLY.
 * Re-attaches on 'did-navigate' (cross-site navigation drops the renderer-
 * scoped debugger; the preload has already run in the new process). Does NOT
 * inject the protection script.
 */
export function attachProviderSecurity(
  guest: WebContents,
  options: AttachOptions = {},
): void {
  if (watched.has(guest) || guest.isDestroyed()) return;
  watched.add(guest);

  const dbg = guest.debugger;
  const providerId = options.providerId ?? getCurrentBlockingProviderId();
  let attaching = false;
  let verifyTimer: NodeJS.Timeout | null = null;

  const AUDIT_NET = process.env.FILMSNAPS_AUDITNET === "1";
  // Sample the wire headers the player actually sent, so a 401/403 on the
  // provider's own /api/ or on a CDN manifest reveals the real Referer/Cookie/
  // Authorization (renderer JS cannot see these). 5 runs cap listener churn.
  let auditNetRuns = 0;
  const IS_AUTH_REQ =
    /\/api\/|token|ipify|\.m3u8|\.mpd|\.mp4|\.ts$|\.m4s|manifest/;
  const isTokenEndpoint = (u: string): boolean =>
    /\/api\/(dG9rZW4|token)/i.test(u);
  /** Dump EVERY request header for the token/bootstrap POST — the exact bytes
   *  the server sees (UA, Client-Hints, Cookie, x-screenscape-*, Sec-*). */
  const fmtAllHeaders = (h: any): string => {
    try {
      const out: string[] = [];
      for (const k of Object.keys(h || {})) {
        let v = String(h[k]);
        if (k.toLowerCase() === "cookie" && v.length > 120)
          v = v.slice(0, 120) + "…(" + v.length + ")";
        out.push(`${k}=${v}`);
      }
      return out.join("\n    ");
    } catch {
      return "(unreadable)";
    }
  };
  const auditNetOnReq = AUDIT_NET
    ? async (params: any): Promise<void> => {
        if (auditNetRuns >= 5 || guest.isDestroyed() || !dbg.isAttached())
          return;
        const u = String(params?.request?.url || "");
        try {
          const h = params?.request?.headers || {};
          const keys = Object.keys(h);
          const line = [
            "Method=" + (params?.request?.method || ""),
            "URL=" + u.slice(0, 160),
            "Referer=" + (h["Referer"] === undefined ? "" : h["Referer"]),
            "Origin=" + (h["Origin"] === undefined ? "" : h["Origin"]),
            "Cookie=" +
              (h["Cookie"] === undefined
                ? ""
                : String(h["Cookie"]).slice(0, 80)),
            "Auth/ApiKey=" + (h["Authorization"] ?? h["x-api-key"] ?? ""),
          ];
          console.log(`[NET]>> ${line.join(" | ")}`);
          // Token/bootstrap POST → FULL header dump (definitive; may be large).
          if (isTokenEndpoint(u) && params?.request?.method === "POST") {
            console.log(
              `[NET]>> FULL HEADERS for token POST ${u.slice(0, 120)}:\n    ${fmtAllHeaders(h)}`,
            );
          }
        } catch {}
        if (IS_AUTH_REQ.test(u)) auditNetRuns++;
      }
    : undefined;
  // Data that actually came back — status + response headers (may nominate
  // the auth the client must use, or expose the token-set cookie).
  const auditNetOnResp = AUDIT_NET
    ? async (params: any): Promise<void> => {
        if (!dbg.isAttached()) return;
        try {
          const u = String(params?.response?.url || "");
          if (!IS_AUTH_REQ.test(u)) return;
          const r = params?.response || {};
          const rh = r?.headers || {};
          console.log(
            `[NET]<< status=${r?.status} for ${u.slice(0, 120)} |` +
              (auditNetRuns < 5
                ? ` Cookie=${rh["set-cookie"] ? String(rh["set-cookie"]).slice(0, 100) : ""} Allow=${rh["www-authenticate"] || ""} CType=${rh["content-type"] || ""}`
                : ``),
          );
          // Token endpoint → dump ALL response headers (set-cookie = cf_clearance?).
          if (isTokenEndpoint(u)) {
            console.log(
              `[NET]<< FULL RESP HEADERS for token POST ${u.slice(0, 120)}:\n    ${fmtAllHeaders(rh)}`,
            );
          }
        } catch {}
      }
    : undefined;

  const verifyProtection = async (): Promise<void> => {
    if (guest.isDestroyed() || !dbg.isAttached()) return;
    try {
      const { frameTree } = (await dbg.sendCommand("Page.getFrameTree")) as any;
      const probe = async (frame: any) => {
        try {
          const { result } = (await dbg.sendCommand("Runtime.evaluate", {
            expression: `(() => {
              const g = Symbol.for('__filmsnaps_preload_guard');
              const m = globalThis[g];
              return {
                guarded: !!(m && Array.isArray(m.hooks) && m.hooks.length > 0),
                hookCount: (m && Array.isArray(m.hooks)) ? m.hooks.length : 0,
                hooks: (m && Array.isArray(m.hooks)) ? m.hooks.slice(0, 12) : [],
                cssInjected: !!(document && document.getElementById('__fs_cosmetic')),
                canvasSpoofed: !!(HTMLCanvasElement.prototype.toDataURL &&
                  !HTMLCanvasElement.prototype.toDataURL.toString().includes('[native code]')),
                url: location.href,
              };
            })()`,
            returnByValue: true,
          })) as any;
          const v = result?.value;
          if (!v?.guarded) {
            // A frame with no committed URL is a placeholder/not-yet-navigated
            // OOPIF (its URL is '' until it commits) — skip it instead of
            // raising a false alarm. Only a REAL committed frame should warn.
            if (!frame.frame?.url) return;
            console.warn(
              `[ProviderSecurity] ⚠ Preload NOT active in frame ${frame.frame?.url} — ADS NOT BLOCKED`,
            );
          }
        } catch {
          // Frame may be mid-navigation — skip.
        }
        for (const child of frame.childFrames || []) await probe(child);
      };
      await probe(frameTree);
    } catch {
      // Probe is best-effort; never throw.
    }
  };

  // ── Attach (initial or re-attach after process swap) ──
  const attach = async (): Promise<void> => {
    if (guest.isDestroyed() || attaching) return;
    attaching = true;
    try {
      if (dbg.isAttached()) {
        try {
          dbg.detach();
        } catch {}
      }
      try {
        dbg.attach(CDP_PROTOCOL);
      } catch {
        // New renderer not ready — wait for did-navigate (handled below).
        attaching = false;
        return;
      }
      await dbg.sendCommand("Debugger.setSkipAllPauses", { skip: true });

      // ── L8: Page.addScriptToEvaluateOnNewDocument (replaces Fetch domain) ──
      // CRITICAL: Do NOT use Fetch.enable with urlPattern: '*'. That pauses
      // EVERY network request including HLS .ts/DASH .m4s segments, causing
      // 5–20ms IPC round-trips per segment → playback stutter, buffer underrun,
      // and CPU spikes on low-end devices. Instead, use Page.addScriptToEvaluateOnNewDocument
      // which runs the guard IIBE at document-start BEFORE any page JS executes,
      // with ZERO network overhead or IPC latency.
      //
      // This runs in the SAME debugger session as verification + audit — only
      // one attach per webContents, so no "another debugger already attached" error.
      //
      // Defense in depth (idempotent via the GUARD sentinel):
      //   - Preload (L5/L6) runs at document-start in frames the mechanism covers.
      //   - This layer guarantees coverage in EVERY html Document by construction —
      //     reloads, cross-site navigations, process swaps, all.
      //   - The protection's own GUARD (Symbol.for('__filmsnaps_preload_guard'))
      //     makes the two idempotent: whichever runs first wins, the other no-ops.

      // ── Primary: Page.addScriptToEvaluateOnNewDocument ──────────────────────
      const protectionSource = getProtectionSource();
      if (protectionSource) {
        try {
          await dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
            source: `(() => { try { ${protectionSource} } catch (e) { console.error('[ProviderSecurity] doc-start inject failed', e); } })();`,
          });
          console.log(
            `[ProviderSecurity] L8 addScriptToEvaluateOnNewDocument armed on guest ${guest.id} (${protectionSource.length} chars)`,
          );
        } catch (err) {
          console.error(
            "[ProviderSecurity] Failed to arm Page.addScriptToEvaluateOnNewDocument:",
            err,
          );
        }
      }

      // The old Fetch domain arming is intentionally omitted. If HTML body
      // rewriting is ever strictly needed (beyond what the preload + CSS injection
      // already cover), re-add Fetch.enable with a restrictive urlPattern
      // (e.g. only main-frame Documents), not '*'.

      // ── Supplementary: document_start injection via addScript (Phase 2e) ────
      // Already covered by the primary call above — keeping this block for
      // parity with the existing code structure and future extensibility.
      // const supplementarySource = getProtectionSource();
      // if (supplementarySource) {
      //   try {
      //     await dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
      //       source: `(() => { try { ${supplementarySource} } catch (e) { console.error('[ProviderSecurity] doc-start inject failed', e); } })();`,
      //     });
      //   } catch (err) {
      //     console.error(
      //       "[ProviderSecurity] Failed to arm supplementary Page.addScriptToEvaluateOnNewDocument:",
      //       err,
      //     );
      //   }
      // }

      // AUDIT net: sample the wire headers/status of auth-relevant requests.
      // Only when FILMSNAPS_AUDITNET=1 — otherwise zero request impact.
      if (AUDIT_NET) {
        try {
          await dbg.sendCommand("Network.enable");
        } catch (err) {
          console.error(
            "[ProviderSecurity] Failed to enable Network audit:",
            err,
          );
        }
      }

      console.log(
        `[ProviderSecurity] CDP verification attached to guest ${guest.id}`,
      );
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => void verifyProtection(), VERIFY_DELAY_MS);
    } catch (err) {
      console.error(
        `[ProviderSecurity] CDP verify attach failed on guest ${guest.id}:`,
        err,
      );
      if (dbg.isAttached()) {
        try {
          dbg.detach();
        } catch {}
      }
    } finally {
      attaching = false;
    }
  };

  // ── Re-attach on cross-process navigation (debugger dies with old renderer) ──
  dbg.on("detach", (_e, reason) => {
    console.log(
      `[ProviderSecurity] Debugger detached from guest ${guest.id}: ${reason}`,
    );
    if (guest.isDestroyed()) return;
    // did-navigate fires once the new renderer has committed — the deterministic
    // signal that re-attach will succeed. No arbitrary timeout loop needed.
    guest.once("did-navigate", () => void attach());
  });

  guest.once("destroyed", () => {
    if (verifyTimer) clearTimeout(verifyTimer);
    if (dbg.isAttached()) {
      try {
        dbg.detach();
      } catch {}
    }
  });

  void attach();
}

// ── Fail-closed per-frame verification + hole injection (L7b) ──────────────

/**
 * The compiled provider preload's source. Loaded lazily (and cached) so the
 * sweep can inject the SAME full protection bundle (mobile bundle + desktop
 * overrides + cosmetic CSS) into about:blank/srcdoc frames that the session
 * preload (L5) and the network HTML injection (L8) both miss.
 */
let _protectionSource: string = "";
function getProtectionSource(): string {
  if (_protectionSource) return _protectionSource;
  try {
    // This module compiles to dist/security/provider-security.js, so __dirname
    // is dist/security — the preload lives one level up at dist/preload/.
    // Reading the COMPILED file gives the exact bytes the preload mechanism
    // also runs, including the mobile bundle + CSS baked in at build time.
    const { readFileSync } = require("fs");
    const { join } = require("path");
    const preloadPath = join(__dirname, "..", "preload", "provider-preload.js");
    _protectionSource = readFileSync(preloadPath, "utf8");
  } catch (err) {
    console.error(
      "[ProviderSecurity] Failed to read protection source for frame injection:",
      err,
    );
    _protectionSource = "";
  }
  return _protectionSource;
}

/** Schemes the session preload and network HTML injection both miss. */
const HOLE_SCHEMES = /^(about:|srcdoc:|blob:|data:)/i;

/**
 * Lightweight, production-safe protection verification that does NOT use CDP.
 *
 * On every frame navigation we:
 *   1. INJECT the full protection bundle into any about:/srcdoc:/blob:/data:
 *      frame — the coverage holes the session preload (L5) and the network
 *      HTML injection (L8) both miss (they see no http(s) response to rewrite
 *      and no renderer process to attach a preload to).
 *   2. SWEEP `guest.mainFrame.framesInSubtree` probing for the preload guard
 *      sentinel. If any committed frame lacks it, fail CLOSED for THAT FRAME
 *      ONLY via `frame.executeJavaScript('window.stop()')` — never the whole
 *      webContents (a whole-webContents stop previously broke initial load).
 *
 * The preload sets `globalThis[Symbol.for('__filmsnaps_preload_guard')]` at
 * document-start (provider-preload.ts:31). The injected bundle is the same
 * GUARD-gated IIFE, so it is idempotent with the preload and L8.
 *
 * Frames with an empty (not-yet-committed) URL are skipped — they are
 * placeholder OOPIFs, not real documents.
 */
export function verifyPreloadInFrames(
  guest: WebContents,
  options: {
    onFailClosed?: (frameUrl: string) => void;
    /** Injection source override (used by tests). */
    source?: string;
  } = {},
): void {
  if (guest.isDestroyed()) return;

  const source = options.source ?? getProtectionSource();

  /**
   * Cosmetic CSS for a frame — resolve the hostname from the frame's own URL
   * when it's http(s), else from the PARENT/top frame's URL (hole-scheme
   * frames like about:blank/srcdoc have no useful hostname of their own).
   * Mirrors mobile's child-frame bridge, which uses the parent host for
   * cosmetic matching (V5 §1.4).
   */
  const injectCosmeticsIntoFrame = async (
    frame: import("electron").WebFrameMain,
  ): Promise<void> => {
    try {
      const refUrl = frame.url.startsWith("http")
        ? frame.url
        : (frame.parent?.url ?? frame.top?.url ?? "");
      if (!refUrl || !refUrl.startsWith("http")) return;
      const cosmetic = getCosmeticFilterPayload(refUrl);
      if (
        !cosmetic.styles &&
        (!cosmetic.scripts || cosmetic.scripts.length === 0)
      ) {
        return;
      }
      const js = `(() => {
        const css = ${JSON.stringify(cosmetic.styles)};
        if (css) {
          try {
            let s = document.getElementById('__fs_cosmetic_engine');
            if (!s) { s = document.createElement('style'); s.id = '__fs_cosmetic_engine'; }
            s.textContent = css;
            s.setAttribute('data-filmsnaps-cosmetic', 'true');
            (document.head || document.documentElement).appendChild(s);
          } catch (e) {}
        }
        const SCRIPTS = ${JSON.stringify(cosmetic.scripts)};
        for (const sc of SCRIPTS) { try { new Function(sc)(); } catch (e) {} }
      })()`;
      await frame.executeJavaScript(js);
      console.log(
        `[FrameSweep] Cosmetic injected into frame (ref ${refUrl.slice(0, 80)})`,
      );
    } catch {
      // Frame mid-navigation — best-effort.
    }
  };

  /** Inject the protection bundle into a hole-scheme frame (best-effort). */
  const injectIntoHoleFrame = async (
    frame: import("electron").WebFrameMain,
  ) => {
    if (!source) return;
    try {
      // Escape the bundle for embedding in an executeJavaScript string literal.
      const js = `(function(){${JSON.stringify(source)};})();`;
      await frame.executeJavaScript(js);
      // Cosmetic CSS uses the parent/top hostname (hole frames have no host).
      await injectCosmeticsIntoFrame(frame);
      console.log(
        `[ProviderSecurity] Injected protection into hole-scheme frame ${frame.url.slice(0, 80)}`,
      );
    } catch {
      // Frame mid-navigation — it will be re-visited on the next sweep.
    }
  };

  /**
   * Probe-and-inject ONE frame: if it lacks the preload guard, inject the
   * bundle + cosmetic CSS (not fail-closed — this is the re-injection sweep,
   * the fail-closed stop is `probe` below). Returns true if injected.
   */
  const ensureFrameProtected = async (
    frame: import("electron").WebFrameMain,
  ): Promise<boolean> => {
    try {
      const hasGuard = await frame.executeJavaScript(
        `(() => { const m = globalThis[Symbol.for('__filmsnaps_preload_guard')]; return !!(m && Array.isArray(m.hooks) && m.hooks.length > 0); })()`,
      );
      if (hasGuard) return false;
      if (!source) return false;
      await frame.executeJavaScript(
        `(function(){${JSON.stringify(source)};})();`,
      );
      await injectCosmeticsIntoFrame(frame);
      return true;
    } catch {
      // Frame mid-navigation / destroyed — skip.
      return false;
    }
  };

  const probe = async (): Promise<void> => {
    if (guest.isDestroyed()) return;
    try {
      // Every frame (main + OOPIFs) in this WebContents, flat list.
      const frames = guest.mainFrame.framesInSubtree;
      for (const frame of frames) {
        if (guest.isDestroyed()) return;
        const frameUrl = frame.url || "";
        // 1. Coverage-hole injection (about:/srcdoc:/blob:/data:).
        if (HOLE_SCHEMES.test(frameUrl)) {
          await injectIntoHoleFrame(frame);
          continue; // injected — no guard probe needed for this frame
        }
        // 2. Probe committed frames for the preload guard.
        if (!frameUrl) continue; // placeholder/not-yet-committed frame
        try {
          const hasGuard = await frame.executeJavaScript(
            `(() => { const m = globalThis[Symbol.for('__filmsnaps_preload_guard')]; return !!(m && Array.isArray(m.hooks) && m.hooks.length > 0); })()`,
          );
          if (!hasGuard) {
            console.warn(
              `[ProviderSecurity] ⚠ PROTECTION NOT ACTIVE in frame ${frameUrl} — FAILING CLOSED (frame only)`,
            );
            options.onFailClosed?.(frameUrl);
            // Per-frame fail-closed: stop THIS frame, never the whole webview.
            try {
              await frame.executeJavaScript("window.stop();");
            } catch {
              /* frame already gone */
            }
            return;
          }
        } catch {
          // Frame mid-navigation — skip (its guard state is indeterminate).
        }
      }
    } catch {
      // Probe is best-effort; never throw.
    }
  };

  /**
   * Re-injection sweep — the desktop equivalent of mobile's
   * `dispatchPageFinished` → `evaluateJavascript` on every page finish
   * (V5 Gap B). Unlike `probe` (which FAILS CLOSED on an unprotected frame),
   * this one INJECTS the bundle + cosmetics into any frame lacking the guard,
   * so a frame created after load is protected rather than stopped.
   */
  const reinjectSweep = async (): Promise<void> => {
    if (guest.isDestroyed()) return;
    try {
      const frames = guest.mainFrame.framesInSubtree;
      let injected = 0;
      for (const frame of frames) {
        if (guest.isDestroyed()) return;
        const frameUrl = frame.url || "";
        if (HOLE_SCHEMES.test(frameUrl)) {
          // Hole frames get bundle + cosmetics unconditionally (idempotent).
          await injectIntoHoleFrame(frame);
          injected++;
          continue;
        }
        if (!frameUrl) continue;
        if (await ensureFrameProtected(frame)) injected++;
      }
      if (injected > 0) {
        console.log(
          `[FrameSweep] Re-injected protection into ${injected} frame(s)`,
        );
      }
    } catch {
      // Sweep is best-effort; never throw.
    }
  };

  // ── Timer bookkeeping — ONE 'destroyed' handler clears every timer ──
  // (V4 Lead B listener-leak fix: previously each did-frame-navigate
  // registered its own once('destroyed') listener, hitting Node's
  // maxListeners warning after ~11 subframe navigations.)
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const sweepIntervals = new Set<ReturnType<typeof setInterval>>();
  const scheduleTimer = (fn: () => void, ms: number): void => {
    const t = setTimeout(() => {
      pendingTimers.delete(t);
      fn();
    }, ms);
    pendingTimers.add(t);
  };
  guest.once("destroyed", () => {
    for (const t of pendingTimers) clearTimeout(t);
    pendingTimers.clear();
    for (const i of sweepIntervals) clearInterval(i);
    sweepIntervals.clear();
  });

  // Probe after the document settles (mirrors the CDP VERIFY_DELAY_MS).
  scheduleTimer(() => void probe(), VERIFY_DELAY_MS);

  // ── Re-injection sweep on EVERY main-frame load completion ──
  // (V5 Gap B — mobile's onPageFinished equivalent.) Covers frames the
  // navigation-triggered sweep may have missed and re-protects anything the
  // page tore down. 100ms lets synchronous frame creation settle.
  guest.on("did-finish-load", () => {
    if (guest.isDestroyed()) return;
    scheduleTimer(() => void reinjectSweep(), 100);
  });

  // ── Periodic re-injection sweep — catches frames created AFTER load ──
  // (V5 §2.3 — mobile's 3s DOM sweeper equivalent.)
  const periodic = setInterval(() => void reinjectSweep(), SWEEP_INTERVAL_MS);
  sweepIntervals.add(periodic);

  // Re-probe on every frame navigation (new OOPIFs, about:blank creations,
  // srcdoc writes) so holes are injected and gaps are caught as they appear.
  guest.on(
    "did-frame-navigate",
    (_e, _url, _httpCode, _status, isMainFrame) => {
      if (guest.isDestroyed()) return;
      if (isMainFrame) return; // main-frame nav is covered by the delay probe
      scheduleTimer(() => void probe(), 150);
    },
  );
}
