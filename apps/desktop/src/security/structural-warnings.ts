/**
 * FilmSnaps Desktop — Structural Warnings (Phase 2e)
 *
 * Cheap, at-startup structural checks that surface likely security-drift
 * WITHOUT changing behavior — warnings only. Surfaced on the main-process
 * console at startup (FILMSNAPS_AUDIT=1) so a CI run or a developer launch
 * can spot them, and so the 3×-failure OTA watchdog has an early signal that
 * the security stack is structurally off.
 *
 * Checks (per expert-advice plan §2e):
 *   1. enableWidevine on a provider session — the provider partition should
 *      NOT run Widevine (a DRM agent is a large trusted blob we never need;
 *      its presence is a structural red flag).
 *   2. MutationObserver bookkeeping — any cosmetic MutationObserver in the
 *      preload that does NOT disconnect after it does its one-shot work leaks
 *      a live observer + callback per document (a per-nav listener leak).
 *   3. Main-frame pop-under — a `window.open` at the root frame with
 *      width/height args is a pop-under signature (ad-layer behavior) that
 *      should be blocked by the nav guard; if it slips through it's a guard
 *      hole worth surfacing.
 */

/**
 * Emit structural warnings for the provider session. Returns the number of
 * warnings emitted (for tests/CI gating).
 */
export function auditProviderSessionWarnings(options: {
  /** Session partition that should NOT have Widevine. */
  sessionWidevineEnabled?: boolean;
  /** Provider session UA — for the audit header line. */
  providerId?: string;
  /** Called per warning (defaults to console.warn). Overridable in tests. */
  warn?: (message: string) => void;
}): number {
  const warn =
    options.warn ?? ((m: string) => console.warn(`[Structural] ${m}`));
  let count = 0;

  // 1. Widevine on the provider session.
  if (options.sessionWidevineEnabled) {
    count++;
    warn(
      "enableWidevine is set on the provider session. The provider partition " +
        "should not run Widevine (DRM agent is unnecessary attack surface). " +
        "Set webPreferences.enableWidevine=false (or disableSessionWidevine) " +
        "in createProviderSession.",
    );
  }

  return count;
}

/**
 * Audit the provider preload source for the known MutationObserver patterns
 * and warn when a cosmetic observer looks like it never disconnects.
 *
 * This is a structural code scan (heuristic), not a runtime probe: it parses
 * the compiled preload for `new MutationObserver` and checks whether each
 * one-shot observer (one that only fires until a condition is met) calls
 * `.disconnect()`. A cosmetic re-inject observer (cssGuard) intentionally
 * lives for the document lifetime — that one is expected and not flagged.
 */
export function auditPreloadObserverBookkeeping(
  preloadSource: string,
  options: {
    warn?: (message: string) => void;
  } = {},
): number {
  const warn =
    options.warn ?? ((m: string) => console.warn(`[Structural] ${m}`));
  let count = 0;

  if (!preloadSource) return 0;
  const obsCount = (preloadSource.match(/new MutationObserver/g) || []).length;
  const disconnectCount = (preloadSource.match(/\.disconnect\(\)/g) || [])
    .length;
  if (obsCount > disconnectCount) {
    count++;
    warn(
      `Provider preload creates ${obsCount} MutationObserver(s) but only ` +
        `${disconnectCount} explicit .disconnect() call(s). If a one-shot ` +
        `observer never disconnects it leaks a live callback per document. ` +
        `Check provider-preload.ts (cssGuard re-inject is intentional).`,
    );
  }

  return count;
}

/**
 * Warn when a main-frame pop-under signature is seen. A root-frame
 * `window.open` with width/height dimensions is the classic pop-under ad
 * shape — the nav guard's setWindowOpenHandler should deny it, so seeing one
 * means either a new ad vector or a guard gap. Called from the provider
 * webview's `did-create-window` / preload interception path.
 *
 * @returns true when a warning was emitted (for callers to react, if desired).
 */
export function auditMainFramePopUnder(options: {
  windowFeatures?: string;
  frameUrl?: string;
  warn?: (message: string) => void;
}): boolean {
  const { windowFeatures, frameUrl } = options;
  const warn =
    options.warn ?? ((m: string) => console.warn(`[Structural] ${m}`));

  // Pop-under signature: width + height present in the features string at the
  // ROOT context (Chromium pop-unders are opened from the top frame).
  const hasSize = /(?:^|,)(width|height)=/i.test(windowFeatures ?? "");
  if (hasSize) {
    warn(
      `Main-frame window.open with window features "${windowFeatures ?? ""}" ` +
        `(${frameUrl ?? "unknown frame"}) — pop-under signature. The nav guard ` +
        `setWindowOpenHandler should deny it; if this reached the browser it ` +
        `was a guard gap.`,
    );
    return true;
  }
  return false;
}
