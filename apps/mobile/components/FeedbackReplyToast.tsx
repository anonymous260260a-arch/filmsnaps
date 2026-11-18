/**
 * FeedbackReplyToast — tells the user the team answered their feedback.
 *
 * Same slot and shape as the download banner: a pill floating above the tab
 * bar on the tab screens (so it never covers the player). Unlike that banner
 * it never auto-hides — it stays until the user taps it or closes it. The
 * newest acknowledged reply timestamp is kept on the device, so one reply is
 * announced once.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { useDownloadList } from "../lib/download";
import { colors } from "../theme/colors";
import {
  fetchMyFeedback,
  getSeenRepliesTs,
  markRepliesSeen,
} from "../lib/feedback";

export function FeedbackReplyToast() {
  const insets = useSafeAreaInsets();
  const nav = useSafeNavigation();
  const { active } = useDownloadList();

  const [count, setCount] = useState(0);
  // Newest reply already surfaced in this session (dismissed or opened).
  const ackedTs = useRef(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  const check = useCallback(async () => {
    const [rows, seen] = await Promise.all([
      fetchMyFeedback(),
      getSeenRepliesTs(),
    ]);
    const floor = Math.max(seen, ackedTs.current);
    const fresh = rows.filter(
      (r) => r.repliedTs != null && r.repliedTs > floor,
    );
    if (fresh.length === 0) return;

    ackedTs.current = fresh.reduce(
      (max, r) => Math.max(max, r.repliedTs ?? 0),
      0,
    );
    setCount(fresh.length);

    translateY.setValue(24);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        friction: 9,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => sub.remove();
  }, [check]);

  const close = useCallback(
    (openFeedback: boolean) => {
      void markRepliesSeen(ackedTs.current);
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        setCount(0);
        if (openFeedback) nav.push("/feedback");
      });
    },
    [nav, opacity],
  );

  if (count === 0) return null;

  // Identical slot to DownloadBanner, lifted when a download is running so the
  // two pills never stack on top of each other.
  const baseOffset =
    Platform.OS === "ios" ? 78 + insets.bottom : 76 + insets.bottom + 8;
  const bottomOffset = baseOffset + (active.length > 0 ? 56 : 0);

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { opacity, transform: [{ translateY }], bottom: bottomOffset },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        <TouchableOpacity
          onPress={() => close(true)}
          activeOpacity={0.85}
          style={styles.main}
          accessibilityRole="button"
          accessibilityLabel="The team replied to your feedback. Open feedback."
        >
          <View style={styles.iconBadge}>
            <Ionicons name="chatbubble-ellipses" size={14} color={colors.bg} />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.title} numberOfLines={1}>
              The team replied to your feedback
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {count > 1 ? `${count} new replies` : "Tap to read"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={colors.gold} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => close(false)}
          style={styles.close}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 101,
    alignItems: "center",
  },
  pill: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.bgTop,
    shadowColor: colors.voidBlack,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
  },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  title: {
    fontSize: 12.5,
    fontFamily: "Inter_600SemiBold",
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: colors.textTertiary,
    marginTop: 1,
  },
  close: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
