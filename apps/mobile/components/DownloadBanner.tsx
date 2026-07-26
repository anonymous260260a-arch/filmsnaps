/**
 * DownloadBanner — A persistent animated pill that floats above the tab bar.
 *
 * State machine: ACTIVE | FLASH | COMPLETE | DEGRADED
 *
 * - ACTIVE: shows real-time download count and progress (current behavior)
 * - FLASH: single task just completed while others still running → morph briefly
 * - COMPLETE: all tasks finished → gold "✓ Download complete" then auto-dismiss
 * - DEGRADED: some tasks failed → amber "⚠ N needs attention"
 *
 * Subsumes DownloadBadge — badge is removed from tab layout.
 */

import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
} from "react-native";
import { ForwardIcon } from "../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDownloadList } from "../lib/download";

/** Format bytes into human-readable KiB/MiB */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB/s`;
  return `${Math.round(bytes / 1024)} KB/s`;
}

type BannerState =
  | { type: "ACTIVE"; count: number; progress: number; speed: number }
  | { type: "FLASH"; message: string; expiresAt: number }
  | { type: "COMPLETE" }
  | { type: "DEGRADED"; failedCount: number };

export default function DownloadBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { active, completed, failed } = useDownloadList();

  const [state, setState] = useState<BannerState | null>(null);
  const prevActiveCountRef = useRef(0);
  const prevCompletedCountRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const downloading = active.filter((t) => t.status === "downloading");
  const pending = active.filter((t) => t.status === "pending");

  // ── State machine transitions ──
  useEffect(() => {
    const newFailedCount = failed.length;
    const currentActive = active.length;
    const currentCompleted = completed.length;

    // DEGRADED takes priority if there are failures alongside active downloads
    if (newFailedCount > 0 && currentActive > 0) {
      setState({ type: "DEGRADED", failedCount: newFailedCount });
      return;
    }

    // FLASH: a single download just completed while others are still running
    if (
      prevActiveCountRef.current > 0 &&
      currentActive > 0 &&
      currentCompleted > prevCompletedCountRef.current
    ) {
      const lastCompleted = completed[completed.length - 1];
      const title =
        lastCompleted?.title || lastCompleted?.fileName || "Download";
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      setState({
        type: "FLASH",
        message: `✓ ${title} saved`,
        expiresAt: Date.now() + 2500,
      });
      flashTimerRef.current = setTimeout(() => {
        setState((prev) =>
          prev?.type === "FLASH"
            ? { type: "ACTIVE", count: currentActive, progress: 0, speed: 0 }
            : prev,
        );
      }, 2500);
      prevCompletedCountRef.current = currentCompleted;
      prevActiveCountRef.current = currentActive;
      return;
    }

    // COMPLETE: all downloads just finished (count dropped from >0 to 0)
    if (
      prevActiveCountRef.current > 0 &&
      currentActive === 0 &&
      currentCompleted > 0
    ) {
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
      setState({ type: "COMPLETE" });
      completeTimerRef.current = setTimeout(() => {
        setState(null);
      }, 4000);
      prevActiveCountRef.current = 0;
      prevCompletedCountRef.current = currentCompleted;
      return;
    }

    // ACTIVE: normal state
    if (currentActive > 0) {
      const total = active.reduce(
        (sum, t) => sum + (Number(t.totalBytes) || 0),
        0,
      );
      const received = active.reduce(
        (sum, t) => sum + (Number(t.receivedBytes) || 0),
        0,
      );
      const progress = total > 0 ? received / total : 0;
      setState({ type: "ACTIVE", count: currentActive, progress, speed: 0 });
    } else if (newFailedCount > 0) {
      // Failed with no active — show degraded
      setState({ type: "DEGRADED", failedCount: newFailedCount });
    } else if (state?.type !== "COMPLETE") {
      // No active, no failed — hidden
      setState(null);
    }

    prevActiveCountRef.current = currentActive;
    prevCompletedCountRef.current = currentCompleted;
  }, [active.length, completed.length, failed.length]);

  // ── Animate in/out based on state presence ──
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state) {
      translateY.setValue(30);
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
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();

      if (state.type === "ACTIVE") {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 0.6,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true,
            }),
          ]),
          { iterations: -1 },
        ).start();
      }
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 30,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
    return () => {
      pulseAnim.setValue(1);
    };
  }, [!!state, state?.type]);

  const handleTap = useCallback(() => {
    router.push("/downloads");
  }, [router]);

  if (!state) return null;

  // ── Render per state ──
  const bottomOffset =
    Platform.OS === "ios" ? 78 + insets.bottom : 76 + insets.bottom + 8;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { opacity, transform: [{ translateY }], bottom: bottomOffset },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        onPress={handleTap}
        activeOpacity={0.85}
        style={styles.banner}
      >
        {renderContent(state, pulseAnim)}
        {renderProgress(state)}
      </TouchableOpacity>
    </Animated.View>
  );
}

function renderContent(state: BannerState, pulseAnim: Animated.Value) {
  switch (state.type) {
    case "ACTIVE": {
      return (
        <View style={styles.content}>
          <View style={styles.leftSection}>
            <Animated.View style={[styles.iconBg, { opacity: pulseAnim }]}>
              <Ionicons name="download" size={14} color="#070708" />
            </Animated.View>
            <Text style={styles.count}>{state.count}</Text>
          </View>
          <Text style={styles.label} numberOfLines={1}>
            {state.count} downloading
          </Text>
          {state.speed > 0 && (
            <Text style={styles.speed}>{formatBytes(state.speed)}</Text>
          )}
          <ForwardIcon width={14} height={14} color="#D4A237" />
        </View>
      );
    }

    case "FLASH": {
      return (
        <View style={styles.content}>
          <View
            style={[styles.iconBg, { backgroundColor: "rgba(34,197,94,0.2)" }]}
          >
            <Ionicons name="checkmark" size={14} color="#22c55e" />
          </View>
          <Text
            style={[
              styles.label,
              { color: "#22c55e", fontFamily: "Inter_600SemiBold" },
            ]}
            numberOfLines={1}
          >
            {state.message}
          </Text>
          <ForwardIcon width={14} height={14} color="#D4A237" />
        </View>
      );
    }

    case "COMPLETE": {
      return (
        <View style={styles.content}>
          <View
            style={[styles.iconBg, { backgroundColor: "rgba(212,162,55,0.2)" }]}
          >
            <Ionicons name="checkmark-circle" size={16} color="#D4A237" />
          </View>
          <Text
            style={[
              styles.label,
              { color: "#D4A237", fontFamily: "Inter_600SemiBold" },
            ]}
            numberOfLines={1}
          >
            ✓ Download complete
          </Text>
          <ForwardIcon width={14} height={14} color="#D4A237" />
        </View>
      );
    }

    case "DEGRADED": {
      return (
        <View style={styles.content}>
          <View
            style={[styles.iconBg, { backgroundColor: "rgba(245,158,11,0.2)" }]}
          >
            <Ionicons name="warning" size={14} color="#f59e0b" />
          </View>
          <Text style={[styles.label, { color: "#f59e0b" }]} numberOfLines={1}>
            ⚠ {state.failedCount} download{state.failedCount > 1 ? "s" : ""}{" "}
            needs attention
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#f59e0b" />
        </View>
      );
    }
  }
}

function renderProgress(state: BannerState) {
  if (state.type !== "ACTIVE") return null;
  const barWidth = Math.min(
    Math.max(state.progress * 100, state.count > 0 ? 5 : 0),
    100,
  );
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${barWidth}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 100,
    alignItems: "center",
  },
  banner: {
    width: "100%",
    backgroundColor: "#16161A",
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: "#2a2a2e",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 10,
  },
  iconBg: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#D4A237",
    alignItems: "center",
    justifyContent: "center",
  },
  count: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#D4A237",
    marginLeft: 5,
    minWidth: 16,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#a1a1aa",
    marginRight: 6,
  },
  speed: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "#52525b",
    marginRight: 8,
  },
  progressTrack: {
    height: 2,
    backgroundColor: "#222226",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#D4A237",
    borderRadius: 1,
  },
});
