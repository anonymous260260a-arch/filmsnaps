/**
 * DownloadToast — Modern luxury floating toast notification.
 *
 * Architecture:
 *   downloadToast.emit({ message, type })   ← from anywhere in the app
 *          ↓
 *   DownloadToastView (mounted in _layout.tsx)
 *          ↓
 *   Smooth spring slide-down floating glass capsule from top of screen,
 *   crisp typography, vibrant icon accents, and auto-dismiss.
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
import { colors } from "../theme/colors";
import * as Haptics from "expo-haptics";

// ─── Types ───

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastEvent {
  message: string;
  type: ToastType;
  /** Auto-dismiss in ms. Default 3000ms. */
  duration?: number;
  /** Optional action button label */
  actionLabel?: string;
  /** Optional action button callback */
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

/** Singleton — import and use directly anywhere */
export const downloadToast = new ToastEmitter();

// ─── Player-aware toast queue ───

let _playerActive = false;
let _pendingToasts: ToastEvent[] = [];

export function setPlayerActive(active: boolean) {
  _playerActive = active;
  if (!active && _pendingToasts.length > 0) {
    const queue = [..._pendingToasts];
    _pendingToasts = [];
    queue.forEach((e, i) => {
      setTimeout(() => downloadToast.emit(e), i * 400);
    });
  }
}

const _origEmit = downloadToast.emit.bind(downloadToast);
downloadToast.emit = (event: ToastEvent) => {
  if (_playerActive && event.type !== "error") {
    _pendingToasts.push(event);
    return;
  }
  _origEmit(event);
};

// ─── Icon + Color Config ───

const TOAST_CONFIG: Record<
  ToastType,
  { icon: keyof typeof Ionicons.glyphMap; color: string; badgeBg: string }
> = {
  success: {
    icon: "checkmark-circle",
    color: "#22C55E",
    badgeBg: "rgba(34, 197, 94, 0.18)",
  },
  error: {
    icon: "alert-circle",
    color: "#EF4444",
    badgeBg: "rgba(239, 68, 68, 0.18)",
  },
  info: {
    icon: "sparkles",
    color: colors.gold,
    badgeBg: "rgba(212, 162, 55, 0.2)",
  },
  warning: {
    icon: "warning",
    color: "#F59E0B",
    badgeBg: "rgba(245, 158, 11, 0.18)",
  },
};

// ─── React Component ───

export function DownloadToastView() {
  const [event, setEvent] = useState<ToastEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const insets = useSafeAreaInsets();

  const topOffset = insets.top + (Platform.OS === "ios" ? 8 : 12);

  useEffect(() => {
    return downloadToast.subscribe((e) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      setEvent(e);

      // Light haptic on appearance
      if (e.type === "error") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      // Smooth slide-down spring from top
      translateY.setValue(-80);
      opacity.setValue(0);
      scale.setValue(0.92);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 18,
          stiffness: 220,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          damping: 18,
          stiffness: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();

      const duration = e.duration ?? (e.type === "error" ? 4500 : 2800);
      timerRef.current = setTimeout(() => {
        dismissToast();
      }, duration);
    });
  }, []);

  const dismissToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -60,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.92,
        duration: 180,
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
  }, [opacity, scale, translateY]);

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

  const cfg = TOAST_CONFIG[event.type] || TOAST_CONFIG.info;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: topOffset,
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.88}
        style={styles.toastCapsule}
      >
        {/* Glowing Icon Badge */}
        <View style={[styles.iconWrap, { backgroundColor: cfg.badgeBg }]}>
          <Ionicons name={cfg.icon} size={16} color={cfg.color} />
        </View>

        {/* Message */}
        <Text style={styles.message} numberOfLines={2}>
          {event.message}
        </Text>

        {/* Action button or subtle close */}
        {event.actionLabel && event.onAction ? (
          <TouchableOpacity
            onPress={handleAction}
            style={[styles.actionBtn, { backgroundColor: cfg.color }]}
            activeOpacity={0.75}
          >
            <Text style={styles.actionLabel}>{event.actionLabel}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.closeWrap}>
            <Ionicons name="close" size={14} color={colors.textTertiary} />
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Luxury Pill Capsule Styles ───

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 99999,
    alignItems: "center",
  },
  toastCapsule: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 9999,
    backgroundColor: "rgba(18, 18, 22, 0.94)",
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.15)",
    maxWidth: "96%",
    // Ambient shadow
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.6,
        shadowRadius: 18,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  message: {
    flexShrink: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: colors.textPrimary,
    lineHeight: 18,
    marginRight: 6,
  },
  closeWrap: {
    marginLeft: 4,
    opacity: 0.7,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    marginLeft: 8,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: colors.bg,
  },
});
