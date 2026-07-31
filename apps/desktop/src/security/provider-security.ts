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

const CDP_PROTOCOL = "1.3";
/** How long after a committed navigation to probe the frame tree. */
const VERIFY_DELAY_MS = 1200;

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

  const verifyProtection = async (): Promise<void> => {
    if (guest.isDestroyed() || !dbg.isAttached()) return;
    try {
      const { frameTree } = (await dbg.sendCommand("Page.getFrameTree")) as any;
      const probe = async (frame: any) => {
        try {
          const { result } = (await dbg.sendCommand("Runtime.evaluate", {
            expression: `(() => {
              const g = Symbol.for('__filmsnaps_preload_guard');
              return {
                guarded: !!globalThis[g],
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
      // Do NOT Page.addScriptToEvaluateOnNewDocument — the preload injects.
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
