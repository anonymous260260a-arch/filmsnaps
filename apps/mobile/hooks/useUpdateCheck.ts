import { useEffect, useCallback } from 'react';
import * as Updates from 'expo-updates';

/**
 * useUpdateCheck — call once at app root.
 *
 * Uses expo-updates to check for and apply JS bundle updates.
 * No APK downloads, no install permissions required.
 *
 * Flow:
 *   1. expo-updates checks for updates on app launch (automatic)
 *   2. If found, we auto-download silently
 *   3. When downloaded, show "Restart to update" prompt
 *   4. User taps "Restart Now" → app reloads with new code
 */
export function useUpdateCheck() {
  const {
    isUpdateAvailable,
    isUpdatePending,
    isChecking,
    isDownloading,
    downloadProgress,
    currentlyRunning,
    checkError,
    downloadError,
  } = Updates.useUpdates();

  // ── Auto-download when update becomes available ──

  useEffect(() => {
    if (isUpdateAvailable && !isUpdatePending && !isDownloading) {
      console.log('[UpdateCheck] Update available, starting download...');
      Updates.fetchUpdateAsync().catch((err) => {
        console.error('[UpdateCheck] Download failed:', err.message);
      });
    }
  }, [isUpdateAvailable, isUpdatePending, isDownloading]);

  // ── Apply update (restart app) ──

  const applyUpdate = useCallback(async () => {
    try {
      console.log('[UpdateCheck] Reloading to apply update...');
      await Updates.reloadAsync();
    } catch (err: any) {
      console.error('[UpdateCheck] Reload failed:', err.message);
    }
  }, []);

  // ── Manual check ──

  const checkNow = useCallback(async () => {
    try {
      console.log('[UpdateCheck] Manual check triggered...');
      await Updates.checkForUpdateAsync();
    } catch (err: any) {
      console.error('[UpdateCheck] Manual check failed:', err.message);
    }
  }, []);

  // ── Determine state for UI ──

  const phase = isDownloading
    ? ('downloading' as const)
    : isUpdatePending
      ? ('pending' as const)
      : isChecking
        ? ('checking' as const)
        : checkError || downloadError
          ? ('error' as const)
          : ('idle' as const);

  const errorMessage =
    checkError?.message ?? downloadError?.message ?? null;

  const progress = downloadProgress != null
    ? Math.round(downloadProgress * 100)
    : 0;

  return {
    /** Simple phase enum for UI to render */
    phase,
    /** Download progress 0–100 */
    progress,
    /** Whether we should show the "Restart to update" prompt */
    showRestartPrompt: isUpdatePending,
    /** Whether an update is actively being downloaded */
    isDownloading,
    /** Whether we're still checking for release info */
    isChecking,
    /** Latest error message, if any */
    errorMessage,
    /** Current version info */
    currentVersion: currentlyRunning?.updateId
      ? 'update'
      : 'embedded',
    /** Is this the embedded (original) bundle? */
    isOriginalBuild: currentlyRunning?.isEmbeddedLaunch ?? true,
    /** Trigger a restart to apply downloaded update */
    applyUpdate,
    /** Manually trigger an update check */
    checkNow,
  };
}
