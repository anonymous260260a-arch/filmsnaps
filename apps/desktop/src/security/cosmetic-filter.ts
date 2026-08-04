/**
 * FilmSnaps Desktop — Engine-Derived Cosmetic Filter IPC (Pillar B)
 *
 * The provider preload (sandboxed, no access to the filter engine) collects
 * class/id/href tokens from the LIVE document and posts them here over IPC.
 * This handler asks the @cliqz/adblocker engine for the cosmetic rules that
 * apply to those tokens (element-hiding CSS + scriptlets) and returns them for
 * the preload to inject.
 *
 * This is the @ghostery/adblocker-electron DOMMonitor flow, but called
 * directly against the engine — NOT via `enableBlockingInSession`, which would
 * replace the existing onBeforeRequest R0-R8 network handler.
 *
 * Fail-open: engine not loaded / any error → empty payload. Cosmetic filtering
 * must never break playback.
 */

import { ipcMain } from "electron";
import { getCosmeticFilterPayload, initFilterEngine } from "./filter-engine";

export interface CosmeticProbePayload {
  classes?: string[];
  ids?: string[];
  hrefs?: string[];
}

export interface CosmeticProbeResult {
  styles: string;
  scripts: string[];
}

/**
 * Register the `cosmetic:probe` IPC handler on the main process.
 * Safe to call once at startup (ipcMain.handle for a channel that's already
 * registered would throw, so we guard with a module-level flag).
 */
let _registered = false;
export function registerCosmeticFilterIPC(): void {
  if (_registered) return;
  _registered = true;

  ipcMain.handle(
    "cosmetic:probe",
    async (
      _event,
      payload?: CosmeticProbePayload,
    ): Promise<CosmeticProbeResult> => {
      try {
        // Ensure the engine is loaded before matching — resolves immediately
        // once initFilterEngine() completes (app startup). If the engine can't
        // load, getCosmeticFilterPayload returns an empty payload (fail-open).
        await initFilterEngine();

        const senderUrl = (() => {
          try {
            const frame = _event.senderFrame;
            return frame?.url ?? "";
          } catch {
            return "";
          }
        })();
        // If the sending frame's URL is unavailable, fall back to a safe
        // default so the engine still gets a hostname to match against.
        const pageUrl = senderUrl || "https://unknown.invalid/";
        const classes = Array.isArray(payload?.classes) ? payload.classes : [];
        const ids = Array.isArray(payload?.ids) ? payload.ids : [];
        const hrefs = Array.isArray(payload?.hrefs) ? payload.hrefs : [];
        const result = getCosmeticFilterPayload(pageUrl, classes, ids, hrefs);

        // Positive log (V4 step 5 / V5 Gap A diagnostic) — proves the IPC path
        // is actually generating + returning cosmetic rules, and on which host.
        let hostname = "";
        try {
          hostname = new URL(pageUrl).hostname;
        } catch {}
        console.log(
          `[cosmetic] ${hostname}: ${result.styles?.length ?? 0} chars CSS, ${result.scripts?.length ?? 0} scriptlets (probe)`,
        );

        // Per-frame injection (V4 step 6 / V5 §3.2): inject the returned styles
        // + scriptlets into the EXACT frame that sent the probe via
        // event.senderFrame.executeJavaScript — not via the preload's own
        // DOM-append (which races document.head and is a second, redundant
        // delivery). This lands cosmetic CSS in the correct subframe.
        try {
          const frame = _event.senderFrame;
          if (
            frame &&
            !frame.isDestroyed() &&
            (result.styles || result.scripts.length)
          ) {
            const js = `(() => {
              const FRAG = () => {
                try {
                  const css = ${JSON.stringify(result.styles)};
                  if (css) {
                    let s = document.getElementById('__fs_cosmetic_engine');
                    if (!s) { s = document.createElement('style'); s.id = '__fs_cosmetic_engine'; }
                    s.textContent = css;
                    (document.head || document.documentElement).appendChild(s);
                  }
                } catch (e) {}
              };
              FRAG();
              const SCRIPTS = ${JSON.stringify(result.scripts)};
              for (const sc of SCRIPTS) { try { new Function(sc)(); } catch (e) {} }
            })()`;
            await frame.executeJavaScript(js);
          }
        } catch {
          /* frame mid-navigation — best-effort */
        }

        return result;
      } catch {
        return { styles: "", scripts: [] };
      }
    },
  );
}
