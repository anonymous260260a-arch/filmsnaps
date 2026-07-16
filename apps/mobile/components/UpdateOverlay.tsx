import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useUpdateCheck } from '../hooks/useUpdateCheck';

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
            <ActivityIndicator size="small" color="#a78bfa" />
            <Text style={styles.barText}>Downloading update...</Text>
          </View>
          {progress > 0 && (
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progress}%` }]}
              />
            </View>
          )}
        </View>
      )}

      {/* ── Error indicator ── */}
      {phase === 'error' && errorMessage && (
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
              A new version has been downloaded. Restart the app to
              apply it instantly.
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
  },
  emoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    color: '#d4d4d8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  hint: {
    color: '#71717a',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
  },
  restartBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
  },
  restartBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  bar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#070708',
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    padding: 12,
    paddingBottom: 28,
    zIndex: 1000,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  barText: {
    color: '#a1a1aa',
    fontSize: 13,
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#27272a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
    borderRadius: 2,
  },
  errorBar: {
    borderTopColor: '#7f1d1d',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
});
