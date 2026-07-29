/**
 * Navigation Service — Module-level singleton with synchronous ref-based interlock.
 *
 * The interlock uses plain JS object refs (NOT React state) because ref
 * mutations are visible immediately to all queued microtasks. When the JS
 * thread is saturated and 5 touch handlers queue up and fire in the same
 * batch, a `useState`-based lock would see `isLoading === false` in all 5
 * handlers (state is async-batched). A ref-based lock is synchronous and
 * the second handler sees `navigating === true` instantly.
 *
 * Usage:
 *   import { safePush, safeReplace } from '@/lib/navigation';
 *   safePush(`/movie/${id}`);
 */

import { router } from "expo-router";
import type { Href } from "expo-router";

// ─── Interlock State ───────────────────────────────────────────────

const interlock = {
  /** true while a navigation action is in-flight */
  navigating: false,
  /** timestamp (ms) of the last completed navigation */
  lastNavigationAt: 0,
  /** the route we last navigated to (for duplicate detection) */
  lastRoute: "" as string,
};

/**
 * Minimum ms between two navigations to the SAME route.
 * Prevents double-tap → double-push of `/movie/42`.
 */
const SAME_ROUTE_COOLDOWN_MS = 600;

/**
 * Minimum ms between ANY two navigations.
 * Prevents rapid-fire navigation to different routes.
 */
const GLOBAL_COOLDOWN_MS = 350;

/**
 * Delay in ms before releasing the interlock lock after a navigation.
 * Must be long enough for `react-native-screens` to begin the native
 * transition (~16ms in SDK 55 with sync layout updates).
 */
const LOCK_RELEASE_DELAY_MS = 50;

// ─── Public API ────────────────────────────────────────────────────

/**
 * Guarded `router.push()`.
 *
 * - Rejects if a navigation is already in-flight (synchronous ref check).
 * - Rejects if the same route was pushed < SAME_ROUTE_COOLDOWN_MS ago.
 * - Rejects if ANY navigation happened < GLOBAL_COOLDOWN_MS ago.
 * - Sets `navigating = true` before calling router, clears it after.
 *
 * Returns `true` if the navigation was dispatched, `false` if suppressed.
 */
export function safePush(href: Href, options?: { replace?: boolean }): boolean {
  const now = Date.now();
  const route = typeof href === "string" ? href : JSON.stringify(href);

  // ── Synchronous guard (this is the critical part) ──
  if (interlock.navigating) return false;
  if (now - interlock.lastNavigationAt < GLOBAL_COOLDOWN_MS) return false;
  if (
    route === interlock.lastRoute &&
    now - interlock.lastNavigationAt < SAME_ROUTE_COOLDOWN_MS
  ) {
    return false;
  }

  // ── Acquire lock ──
  interlock.navigating = true;
  interlock.lastRoute = route;
  interlock.lastNavigationAt = now;

  try {
    if (options?.replace) {
      router.replace(href);
    } else {
      router.push(href);
    }
    return true;
  } catch (error) {
    if (__DEV__) console.warn("[NavigationService] push failed:", error);
    return false;
  } finally {
    // Release lock on next microtask so the navigation transition
    // has time to start. 50ms is enough for react-native-screens
    // to begin the native transition (SDK 55 enables synchronous
    // layout updates by default).
    setTimeout(() => {
      interlock.navigating = false;
    }, LOCK_RELEASE_DELAY_MS);
  }
}

/**
 * Guarded `router.replace()`.
 */
export function safeReplace(href: Href): boolean {
  return safePush(href, { replace: true });
}

/**
 * Reset the interlock. Call this on navigation focus events
 * or when you need to force-clear a stuck lock (e.g., after
 * an error boundary catches a navigation crash).
 */
export function resetNavigationInterlock(): void {
  interlock.navigating = false;
  interlock.lastNavigationAt = 0;
  interlock.lastRoute = "";
}

/** Expose for debugging in __DEV__ only */
export function __getInterlockState() {
  if (!__DEV__) throw new Error("Debug only");
  return { ...interlock };
}
