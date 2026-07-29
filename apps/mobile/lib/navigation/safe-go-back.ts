/**
 * Safe Back Navigation — handles empty back stacks and deep-link edge cases.
 *
 * `router.back()` throws `The action 'GO_BACK' was not handled by any
 * navigator` when called on a screen with no back stack (deep link, cold
 * start, single-screen modal). This utility wraps the call with guards
 * and a fallback route.
 */

import { router } from "expo-router";
import type { Href } from "expo-router";

export interface SafeGoBackOptions {
  /**
   * Fallback route when canGoBack() is false (deep link, cold start).
   * Defaults to '/(tabs)' (the home tab).
   */
  fallback?: Href;
  /**
   * If true, uses router.dismissAll() before falling back.
   * Useful when you're inside a modal stack that was deep-linked.
   */
  dismissModalsFirst?: boolean;
}

/**
 * Safe replacement for `router.back()`.
 *
 * Handles:
 *  - Empty back stack (deep link / cold start) → falls back to `fallback`
 *  - Modal stacks → optionally dismisses all modals first
 *  - The `canGoBack()` edge case (can return true when back() still throws)
 *    by adding a try/catch around the actual back()
 *
 * Returns true if a back navigation occurred, false if fallback was used.
 */
export function safeGoBack(options: SafeGoBackOptions = {}): boolean {
  const { fallback = "/(tabs)", dismissModalsFirst = false } = options;

  // First attempt: standard back navigation
  try {
    if (router.canGoBack()) {
      router.back();
      return true;
    }
  } catch {
    // canGoBack() itself can throw in edge cases with nested navigators
  }

  // No back stack — we're at the root or deep-linked in
  if (dismissModalsFirst) {
    try {
      router.dismissAll();
    } catch {
      // dismissAll may throw if there are no modals
    }
  }

  // Navigate to fallback
  try {
    router.replace(fallback);
  } catch (error) {
    if (__DEV__)
      console.warn("[safeGoBack] fallback navigation failed:", error);
  }

  return false;
}
