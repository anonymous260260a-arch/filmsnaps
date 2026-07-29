/**
 * DeferredContent — Renders a fallback (skeleton) immediately and defers
 * the real content until the JS thread is idle or a timeout elapses.
 *
 * This is the RN 0.83+ replacement for the deprecated
 * `InteractionManager.runAfterInteractions()`. It uses `requestIdleCallback`
 * (stable in RN 0.83 Hermes) to schedule heavy content after navigation
 * animations and user interactions complete.
 *
 * Usage:
 *   // Heavy carousel deferred until interactions settle
 *   <DeferredContent fallback={<CarouselSkeleton />}>
 *     <HeavyCarousel data={data} />
 *   </DeferredContent>
 *
 *   // Staggered loading with delays
 *   <DeferredContent fallback={<Skeleton />} delayMs={200}>
 *     <SecondCarousel />
 *   </DeferredContent>
 */

import React, { useEffect, useState, type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

interface DeferredContentProps {
  /** Rendered immediately (skeleton, placeholder) */
  fallback: ReactNode;
  /** Rendered after JS thread is idle */
  children: ReactNode;
  /**
   * Additional delay in ms before rendering children.
   * Use this to stagger multiple DeferredContent instances:
   * 0ms (default), 200ms, 400ms, 600ms, etc.
   */
  delayMs?: number;
  /**
   * Minimum time in ms to show the fallback before switching to children.
   * Prevents flashing when the idle callback fires immediately.
   * Default: 100ms
   */
  minFallbackMs?: number;
  /** Optional style for the wrapper view */
  style?: ViewStyle;
}

export function DeferredContent({
  fallback,
  children,
  delayMs = 0,
  minFallbackMs = 100,
  style,
}: DeferredContentProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let minTimer: ReturnType<typeof setTimeout> | undefined;

    const showContent = () => {
      if (cancelled) return;
      // Ensure minimum fallback display time to avoid flash
      minTimer = setTimeout(() => {
        if (!cancelled) setReady(true);
      }, minFallbackMs);
    };

    // requestIdleCallback is the RN 0.83+ replacement for
    // InteractionManager.runAfterInteractions()
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(
        () => {
          if (delayMs > 0) {
            idleTimer = setTimeout(showContent, delayMs);
          } else {
            showContent();
          }
        },
        { timeout: 3000 }, // max wait 3s before forcing render
      );
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
        if (idleTimer) clearTimeout(idleTimer);
        if (minTimer) clearTimeout(minTimer);
      };
    }

    // Fallback for environments without requestIdleCallback
    idleTimer = setTimeout(showContent, Math.max(delayMs, 100));
    return () => {
      cancelled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (minTimer) clearTimeout(minTimer);
    };
  }, [delayMs, minFallbackMs]);

  // Once ready, render children; otherwise render fallback
  if (ready) return <>{children}</>;

  return <View style={style}>{fallback}</View>;
}
