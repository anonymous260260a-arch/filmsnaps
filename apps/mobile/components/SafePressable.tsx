/**
 * SafePressable — Click-once guarantee with async-aware loading state.
 *
 * Key design:
 * - Ref-based synchronous interlock (NOT React state). When the JS thread
 *   is saturated and 5 touch handlers queue up in the same microtask batch,
 *   a ref mutation is visible to all of them immediately. A setState-based
 *   lock would see `isLoading === false` in all 5 handlers.
 * - Async-aware: if `onPress` returns a Promise, shows a spinner overlay
 *   and disables the button until the promise settles.
 * - Resets lock state on screen focus via `useFocusEffect` to prevent stale
 *   locks from a previous screen.
 * - Supports functional children pattern for custom pressed/loading visuals.
 *
 * Usage:
 *   // Navigation (fast, no spinner)
 *   <SafePressable onPress={() => nav.push(`/movie/${id}`)} showLoading={false}>
 *     <Text>Watch Now</Text>
 *   </SafePressable>
 *
 *   // Async action (shows spinner during API call)
 *   <SafePressable onPress={() => api.download(id)}>
 *     {({ loading }) => <Text>{loading ? 'Downloading…' : 'Download'}</Text>}
 *   </SafePressable>
 */

import React, { useCallback, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ActivityIndicator,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type AccessibilityState,
} from "react-native";
import { useFocusEffect } from "expo-router";

// ─── Types ─────────────────────────────────────────────────────────

export interface SafePressableProps extends Omit<
  PressableProps,
  "onPress" | "disabled" | "children" | "style"
> {
  /**
   * The press handler. Can be sync or async.
   * If async, the button shows a spinner and disables itself
   * until the promise resolves/rejects.
   */
  onPress?: () => void | Promise<void>;

  /**
   * External disabled flag (e.g., form validation).
   * Combined with internal loading/lock state.
   */
  disabled?: boolean;

  /**
   * Minimum ms between presses. Default: 400.
   * This is a SYNCHRONOUS ref-based check — it works even if
   * 5 touch events are queued during JS thread starvation and
   * all fire in the same microtask batch.
   */
  pressCooldownMs?: number;

  /**
   * Show a spinner overlay while an async onPress is in-flight.
   * Default: true.
   */
  showLoading?: boolean;

  /**
   * Custom loading indicator. Defaults to <ActivityIndicator />.
   */
  loadingIndicator?: ReactNode;

  /**
   * Opacity when disabled. Default: 0.4.
   * Respects `accessibilityState.disabled` for reduced-transparency.
   */
  disabledOpacity?: number;

  /**
   * Called when a press is suppressed by the interlock.
   * Useful for analytics ("user tried to double-tap").
   */
  onPressSuppressed?: () => void;

  children:
    | ReactNode
    | ((state: { pressed: boolean; loading: boolean }) => ReactNode);

  style?:
    | StyleProp<ViewStyle>
    | ((state: { pressed: boolean; loading: boolean }) => StyleProp<ViewStyle>);
}

// ─── Component ─────────────────────────────────────────────────────

export function SafePressable({
  onPress,
  disabled = false,
  pressCooldownMs = 400,
  showLoading = true,
  loadingIndicator,
  disabledOpacity = 0.4,
  onPressSuppressed,
  children,
  style,
  accessibilityRole = "button",
  ...rest
}: SafePressableProps) {
  // ── Refs for synchronous checks (NOT state) ──
  // These are the critical defense against queued touch events.
  // A ref mutation is visible immediately to all code in the same
  // JS microtask, unlike setState which is batched.
  const lastPressRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

  // ── State for visual feedback only ──
  const [isLoading, setIsLoading] = useState(false);

  // Reset lock state when the screen regains focus.
  // Prevents a stale in-flight lock from a previous screen.
  useFocusEffect(
    useCallback(() => {
      inFlightRef.current = false;
      lastPressRef.current = 0;
      setIsLoading(false);
    }, []),
  );

  const isEffectivelyDisabled = disabled || isLoading;

  const handlePress = useCallback(async () => {
    const now = Date.now();

    // ── Synchronous interlock (survives JS thread starvation) ──
    if (inFlightRef.current) {
      onPressSuppressed?.();
      return;
    }
    if (now - lastPressRef.current < pressCooldownMs) {
      onPressSuppressed?.();
      return;
    }

    // Acquire lock IMMEDIATELY (synchronous)
    lastPressRef.current = now;
    inFlightRef.current = true;

    if (!onPress) {
      inFlightRef.current = false;
      return;
    }

    try {
      const result = onPress();

      // If onPress returns a promise, track it visually
      if (result && typeof result.then === "function") {
        setIsLoading(true);
        await result;
      }
    } catch (error) {
      if (__DEV__) console.warn("[SafePressable] onPress error:", error);
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, [onPress, pressCooldownMs, onPressSuppressed]);

  const accessibilityState: AccessibilityState = {
    disabled: isEffectivelyDisabled,
    busy: isLoading,
  };

  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      disabled={isEffectivelyDisabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      style={(state) => {
        const baseStyle =
          typeof style === "function"
            ? style({ pressed: state.pressed, loading: isLoading })
            : style;

        return [
          baseStyle,
          isEffectivelyDisabled && { opacity: disabledOpacity },
        ].filter(Boolean);
      }}
    >
      {(state) => (
        <View>
          {typeof children === "function"
            ? children({ pressed: state.pressed, loading: isLoading })
            : children}

          {/* Loading overlay */}
          {showLoading && isLoading && (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={styles.loadingOverlay}>
                {loadingIndicator ?? (
                  <ActivityIndicator size="small" color="#fff" />
                )}
              </View>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.15)",
    borderRadius: 8,
  },
});
