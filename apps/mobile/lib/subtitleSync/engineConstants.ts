/**
 * Signal-engine constants — the single JS source of truth.
 *
 * F6 mark-threshold hysteresis lives in native SignalCollector as defaults;
 * these values are the ones JS sends on every scanAsync / activateWatchSync
 * call and the ones that form the cache-key engine token. Change a value here
 * and BOTH the native default and the cache token stay in sync (the token is
 * derived, so a bump is automatic).
 *
 * Rule: any change to the signal engine (VAD, scorer, mark thresholds) must
 * bump ENGINE_TOKEN — cached evidence from a different engine is stale.
 */

/** Silero mark-ON threshold (rising edge of the hysteresis). */
export const MARK_ON = 0.35;
/** Silero mark-OFF threshold (falling edge — stays on until prob < this). */
export const MARK_OFF = 0.25;
/**
 * F6 escalation (NOT active): onset-of-speech binning. Flip to true only if
 * F6 undercorrects Lioness/Spider on device.
 */
export const ONSET_BINNING = false;

/**
 * Engine identity token embedded in BOTH cache keys (window + full-result).
 * Derived from the mark thresholds so a threshold change automatically orphans
 * old entries (no second place to remember to bump). Format: m<on*100>-<off*100>.
 * W1-d: a non-default ONSET_BINNING joins the token (escalation flag).
 */
export const ENGINE_TOKEN = `m${Math.round(MARK_ON * 100)}-${Math.round(MARK_OFF * 100)}${
  ONSET_BINNING ? "-ob" : ""
}`;
