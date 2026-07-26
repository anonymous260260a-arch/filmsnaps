/**
 * DownloadToast — Global toast overlay for download events.
 *
 * Uses a singleton event emitter so any module (manager, context, hooks)
 * can trigger a toast without being inside the React tree.
 *
 * Architecture:
 *   downloadToast.emit({ message, type })   ← from anywhere
 *          ↓
 *   DownloadToastView (mounted in _layout.tsx)  ← renders the UI
 *          ↓
 *   Animated slide-up from bottom edge (above tab bar), auto-dismiss after duration.
 *
 * Types:
 *   success   → green checkmark  (completed)
 *   error     → red alert        (failed, errors)
 *   info      → gold icon        (started, paused, resumed)
 *   warning   → amber warning    (storage, network warnings)
 *   persistent → gold download   (actively downloading — pinning variant)
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Animated,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

// ─── Types ───

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastEvent {
  message: string;
  type: ToastType;
  /** Auto-dismiss in ms. Default 4000 for transient, longer for errors. */
  duration?: number;
  /** Label for an action button (e.g. "Undo") */
  actionLabel?: string;
  /** Callback when the action button is tapped */
  onAction?: () => void;
}

type Listener = (event: ToastEvent) => void;

// ─── Singleton event emitter ───

class ToastEmitter {
  private listeners = new Set<Listener>();

  emit(event: ToastEvent) {
    this.listeners.forEach((cb) => {
      try {
        cb(event);
      } catch {}
    });
  }

  /** Subscribe to events. Returns unsubscribe function. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── Convenience shorthands ──
  success(message: string, duration?: number) {
    this.emit({ message, type: "success", duration });
  }
  error(message: string, duration?: number) {
    this.emit({ message, type: "error", duration });
  }
  info(message: string, duration?: number) {
    this.emit({ message, type: "info", duration });
  }
  warning(
    message: string,
    duration?: number,
    actionLabel?: string,
    onAction?: () => void,
  ) {
    this.emit({ message, type: "warning", duration, actionLabel, onAction });
  }
}

/** Singleton — import and use directly */
export const downloadToast = new ToastEmitter();

// ─── Player-aware toast queue ───

let _playerActive = false;
let _pendingToasts: ToastEvent[] = [];

/** Set to true when full-screen player is active — holds non-error toasts for later delivery */
export function setPlayerActive(active: boolean) {
  _playerActive = active;
  if (!active && _pendingToasts.length > 0) {
    // Flush queued toasts with a small stagger
    const queue = [..._pendingToasts];
    _pendingToasts = [];
    queue.forEach((e, i) => {
      setTimeout(() => downloadToast.emit(e), i * 500);
    });
  }
}

// Patch the emit method to respect player-active state
const _origEmit = downloadToast.emit.bind(downloadToast);
downloadToast.emit = (event: ToastEvent) => {
  if (_playerActive && event.type !== "error") {
    _pendingToasts.push(event);
    return;
  }
  _origEmit(event);
};

// ─── Icon + colour map ───

const TOAST_CONFIG: Record<
  ToastType,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  success: {
    icon: "checkmark-circle",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.12)",
  },
  error: {
    icon: "alert-circle",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.12)",
  },
  info: {
    icon: "information-circle",
    color: "#D4A237",
    bg: "rgba(212,162,55,0.12)",
  },
  warning: {
    icon: "warning",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
  },
};

// ─── React Component ───

export function DownloadToastView() {
  const [event, setEvent] = useState<ToastEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  // Bottom position: above tab bar (~72px) + bottom safe area + 8px gap
  const bottomOffset =
    Platform.OS === "ios"
      ? 72 + insets.bottom + 8
      : 72 + Math.max(insets.bottom, 8) + 4;

  // Subscribe to the emitter
  useEffect(() => {
    return downloadToast.subscribe((e) => {
      // Clear existing timer
      if (timerRef.current) clearTimeout(timerRef.current);

      // Set new event — triggers re-render
      setEvent(e);

      // Animate in from below
      translateY.setValue(100);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss
      const duration = e.duration ?? (e.type === "error" ? 5000 : 3500);
      timerRef.current = setTimeout(() => {
        dismissToast();
      }, duration);
    });
  }, []);

  const dismissToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setEvent(null);
    });
  }, []);

  const handlePress = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    dismissToast();
  }, [dismissToast]);

  const handleAction = useCallback(() => {
    if (event?.onAction) {
      event.onAction();
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    dismissToast();
  }, [dismissToast, event]);

  if (!event) return null;

  const cfg = TOAST_CONFIG[event.type];

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: bottomOffset,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.9}
        style={[
          styles.toast,
          { borderLeftColor: cfg.color, backgroundColor: cfg.bg },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: cfg.color + "1A" }]}>
          <Ionicons name={cfg.icon} size={18} color={cfg.color} />
        </View>
        <Text style={styles.message} numberOfLines={2}>
          {event.message}
        </Text>
        {event.actionLabel && event.onAction ? (
          <TouchableOpacity
            onPress={handleAction}
            style={[styles.actionBtn, { backgroundColor: cfg.color + "25" }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionLabel, { color: cfg.color }]}>
              {event.actionLabel}
            </Text>
          </TouchableOpacity>
        ) : (
          <Ionicons
            name="close"
            size={14}
            color="#52525b"
            style={{ marginLeft: 6 }}
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Styles ───

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
    maxWidth: "92%",
    // Subtle shadow for depth
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#F4F4F5",
    lineHeight: 18,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginLeft: 8,
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
