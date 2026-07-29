import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { colors } from "../theme/colors";
import { useUpdateCheck } from "../hooks/useUpdateCheck";

/**
 * In-app update overlay.
 *
 * Works with expo-updates — no APK downloads, no permissions.
 * When a new JS bundle is available, it auto-downloads silently.
 * When ready, shows "Restart to update" prompt.
 */
export function UpdateOverlay() {
  const {
    phase,
    progress,
    showRestartPrompt,
    isDownloading,
    errorMessage,
    applyUpdate,
  } = useUpdateCheck();

  return (
    <>
      {/* ── Downloading indicator ── */}
      {isDownloading && (
        <View style={styles.bar}>
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.secondary} />
            <Text style={styles.barText}>Downloading update...</Text>
          </View>
          {progress > 0 && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
          )}
        </View>
      )}

      {/* ── Error indicator ── */}
      {phase === "error" && errorMessage && (
        <View style={[styles.bar, styles.errorBar]}>
          <Text style={styles.errorText} numberOfLines={1}>
            Update error: {errorMessage}
          </Text>
        </View>
      )}

      {/* ── "Restart to update" modal ── */}
      <Modal
        visible={showRestartPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text style={styles.emoji}>✨</Text>
            <Text style={styles.title}>Update Ready</Text>
            <Text style={styles.body}>
              A new version has been downloaded. Restart the app to apply it
              instantly.
            </Text>
            <Text style={styles.hint}>
              No APK download needed — this is a seamless JS update.
            </Text>
            <TouchableOpacity style={styles.restartBtn} onPress={applyUpdate}>
              <Text style={styles.restartBtnText}>Restart Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.black75,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialog: {
    backgroundColor: colors.zincBgFull,
    borderRadius: 20,
    padding: 28,
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.zinc800,
    alignItems: "center",
  },
  emoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  body: {
    color: colors.zinc300,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  hint: {
    color: colors.zinc500,
    fontSize: 12,
    textAlign: "center",
    marginBottom: 24,
  },
  restartBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.secondary,
    alignItems: "center",
  },
  restartBtnText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
    padding: 12,
    paddingBottom: 28,
    zIndex: 1000,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  barText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.zinc800,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.secondary,
    borderRadius: 2,
  },
  errorBar: {
    borderTopColor: colors.red900,
  },
  errorText: {
    color: colors.red400,
    fontSize: 13,
  },
});
