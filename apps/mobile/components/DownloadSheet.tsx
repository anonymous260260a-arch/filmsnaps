/**
 * DownloadSheet — Server list bottom sheet.
 *
 * Shows available download servers. Tapping a server immediately navigates
 * to the download page — no extra confirm button.
 *
 * Internal server names (nxsha/falix) are shown with friendly labels.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  SafeAreaView,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors } from "../theme/colors";

interface ServerOption {
  key: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const SERVERS: ServerOption[] = [
  {
    key: "falix",
    label: "Falix",
    subtitle: "Direct HEVC files · bulk seasons",
    icon: "phone-portrait-outline",
    badge: "Primary",
    badgeColor: colors.gold,
  },
  {
    key: "nxsha",
    label: "Nxsha",
    subtitle: "Multi-server direct links",
    icon: "cloud-download-outline",
    badge: "Secondary",
    badgeColor: colors.textTertiary,
  },
];

interface ServerOption {
  key: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string;
  badgeColor?: string;
}

interface DownloadSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
  /** Called when user taps a server — should navigate to the download page */
  onSelectServer: (server: string) => void;
}

export function DownloadSheet({
  visible,
  onClose,
  title,
  tmdbId,
  mediaType,
  season,
  episode,
  onSelectServer,
}: DownloadSheetProps) {
  const handleSelect = (server: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    onSelectServer(server);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <SafeAreaView>
            {/* Drag handle */}
            <View style={styles.dragHandle} />

            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.headerTitle}>Download</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {title}
                  {season != null && episode != null
                    ? ` · S${season}E${episode}`
                    : ""}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                accessibilityLabel="Close"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Server list */}
            <View style={styles.list}>
              {SERVERS.map((server) => (
                <TouchableOpacity
                  key={server.key}
                  onPress={() => handleSelect(server.key)}
                  activeOpacity={0.7}
                  style={styles.serverRow}
                >
                  <View style={styles.serverIcon}>
                    <Ionicons
                      name={server.icon}
                      size={22}
                      color={colors.gold}
                    />
                  </View>
                  <View style={styles.serverInfo}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Text style={styles.serverLabel}>{server.label}</Text>
                      {server.badge && (
                        <View
                          style={{
                            borderRadius: 10,
                            paddingHorizontal: 6,
                            paddingVertical: 1,
                            backgroundColor: `${server.badgeColor}22`,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 9,
                              fontWeight: "800",
                              letterSpacing: 0.5,
                              color: server.badgeColor,
                              textTransform: "uppercase",
                            }}
                          >
                            {server.badge}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.serverSubtitle}>{server.subtitle}</Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.zinc900,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 60,
    maxHeight: "70%",
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.progressTrack,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
    maxWidth: 260,
  },
  closeBtn: {
    padding: 4,
  },
  list: {
    gap: 10,
    marginBottom: 8,
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.zinc800,
    gap: 14,
  },
  serverIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.goldBadge,
    alignItems: "center",
    justifyContent: "center",
  },
  serverInfo: {
    flex: 1,
  },
  serverLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  serverSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
