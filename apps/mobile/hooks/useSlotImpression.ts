/**
 * M1 — impression measurement for candidate ad slots (no ads in the app).
 *
 * Fires one ad_slot_view per screen focus: each time the screen carrying the
 * slot becomes focused, a single event lands ~300ms later (the delay lets
 * StrictMode double-runs and rapid tab flips collapse into one impression —
 * the cleanup cancels the pending timer on blur/unmount).
 *
 * Fidelity: view = "tierA" (rendered on visit). Above-fold slots are exact;
 * below-fold slots are visit-based upper bounds until tierB (viewport
 * visibility) lands.
 *
 * opts.key — extra useCallback/useFocusEffect dependency. Detail screens pass
 * the title id so navigating movie A → movie B while staying on the route
 * counts as two page impressions (an ad would render twice).
 */
import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  trackAdSlotView,
  type AdSlotName,
  type AdSlotScreen,
} from "../lib/telemetry";

export function useSlotImpression(
  slot: AdSlotName,
  screen: AdSlotScreen,
  opts?: { key?: string; enabled?: boolean },
): void {
  const enabled = opts?.enabled !== false;
  const depKey = opts?.key;
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const timer = setTimeout(() => {
        trackAdSlotView({ slot, screen, view: "tierA" });
      }, 300);
      return () => clearTimeout(timer);
      // depKey intentionally in deps: a changed key re-arms the impression
      // while the same screen stays focused (title A → title B).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slot, screen, enabled, depKey]),
  );
}
