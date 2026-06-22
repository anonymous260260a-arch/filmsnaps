/**
 * FilmSnaps Desktop — Secure Video Window Manager
 *
 * Manages the lifecycle of the provider content BrowserWindow, applying
 * all 6 security layers:
 *
 *   Layer 1: Isolated session partition (separate cookies, cache, storage)
 *   Layer 2: Network-level request filtering (session.webRequest)
 *   Layer 3: Response header injection (CSP, security headers)
 *   Layer 4: Native navigation/popup/redirect blocking
 *   Layer 5: JS injection (the 15-layer protection script)
 *   Layer 6: Resource watchdog (memory/CPU monitoring)
 *
 * The video window is a SEPARATE BrowserWindow — complete process and
 * session isolation from the main browsing UI.
 */

import { BrowserWindow, ipcMain, IpcMainInvokeEvent, screen } from 'electron';
import { join } from 'path';
import {
  createProviderSession,
  clearProviderSession,
  setupSecurityHeaders,
} from '../security/request-filter';
import { applyNavigationGuard } from '../security/navigation-guard';
import { PROTECTION_SCRIPT } from '../security/protection-script';
import { startWatchdog } from '../security/resource-watchdog';
import { saveWindowState } from '../lib/window-state';

export interface VideoOpenParams {
  type: 'movie' | 'tv';
  id: string;
  season?: number;
  episode?: number;
  provider: string;
  embedUrl: string;
}

interface VideoWindowState {
  window: BrowserWindow | null;
  session: ReturnType<typeof createProviderSession> | null;
  stopWatchdog: (() => void) | null;
}

let state: VideoWindowState = {
  window: null,
  session: null,
  stopWatchdog: null,
};

/**
 * Register IPC handlers for video window management.
 * Called from main.ts during app initialization.
 */
export function registerVideoWindowIPC(): void {
  ipcMain.handle('video:open', async (_event: IpcMainInvokeEvent, params: VideoOpenParams) => {
    return openVideoWindow(params);
  });

  ipcMain.handle('video:close', async () => {
    return closeVideoWindow();
  });
}

/**
 * Open a secure video player window for a given provider URL.
 * Applies all 6 security layers.
 */
async function openVideoWindow(params: VideoOpenParams): Promise<{ success: boolean; error?: string }> {
  // Close any existing video window first
  closeVideoWindow();

  const { embedUrl, provider } = params;

  if (!embedUrl) {
    console.error('[VideoWindow] No embed URL provided');
    return { success: false, error: 'No embed URL provided' };
  }

  try {
    // ── Layer 1: Create isolated session ──
    const videoSession = createProviderSession();
    state.session = videoSession;

    // ── Layer 3: Set up security headers for the session ──
    setupSecurityHeaders(videoSession);

    // ── Get the primary display work area for window sizing ──
    const displayBounds = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1000, displayBounds.width);
    const height = Math.min(700, displayBounds.height);
    const x = Math.round((displayBounds.width - width) / 2);
    const y = Math.round((displayBounds.height - height) / 2);

    // ── Create the video BrowserWindow ──
    const videoWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: 640,
      minHeight: 400,
      title: `FilmSnaps — ${provider}`,
      icon: join(__dirname, '../../resources/icon.png'),
      backgroundColor: '#0f0f16',
      show: false, // Show after ready to avoid white flash
      autoHideMenuBar: true,
      webPreferences: {
        // Use the isolated session
        session: videoSession,
        // Security: no Node.js in renderer
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // No file access
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    state.window = videoWindow;

    // ── Layer 4: Apply native navigation/popup/redirect blocking ──
    const { bootstrapWhitelist } = applyNavigationGuard(videoWindow.webContents, {
      providerUrl: embedUrl,
      onBlocked: (type, url) => {
        console.log(`[VideoWindow] Blocked ${type}: ${url.substring(0, 100)}`);
        // Could emit to main window here for UI feedback
      },
      onBootstrapComplete: (hosts) => {
        console.log(`[VideoWindow] Bootstrap complete. ${hosts.length} hosts whitelisted`);
      },
    });

    // ── Layer 5: Inject protection script after page loads ──
    videoWindow.webContents.on('did-finish-load', () => {
      videoWindow.webContents
        .executeJavaScript(PROTECTION_SCRIPT)
        .then(() => console.log('[VideoWindow] Protection script injected'))
        .catch((err: Error) =>
          console.warn('[VideoWindow] Failed to inject protection script:', err.message)
        );
    });

    // ── Layer 6: Start resource watchdog ──
    const stopWatchdog = startWatchdog(videoWindow, {
      onAbuseDetected: (offense) => {
        console.log(`[VideoWindow] Abuse detected: ${offense.type} at ${offense.currentValue}`);
      },
      onUnrecoverable: (reason) => {
        console.error(`[VideoWindow] Unrecoverable: ${reason}`);
      },
    });
    state.stopWatchdog = stopWatchdog;

    // ── Window lifecycle events ──

    // Show window smoothly when ready
    videoWindow.once('ready-to-show', () => {
      videoWindow.show();
    });

    // Save position on move/resize
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    videoWindow.on('resize', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveWindowState(videoWindow), 500);
    });
    videoWindow.on('move', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveWindowState(videoWindow), 500);
    });

    // Clean up on close
    videoWindow.on('closed', () => {
      cleanupVideoWindow();
    });

    // ── Load the provider URL ──
    console.log(`[VideoWindow] Loading provider: ${embedUrl.substring(0, 100)}`);
    videoWindow.loadURL(embedUrl, {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[VideoWindow] Failed to open:', message);
    return { success: false, error: message };
  }
}

/**
 * Close the video window and clean up all resources.
 */
export function closeVideoWindow(): void {
  if (state.window && !state.window.isDestroyed()) {
    state.window.close();
  }
  cleanupVideoWindow();
}

/**
 * Clean up video window resources.
 */
async function cleanupVideoWindow(): Promise<void> {
  // Stop watchdog
  if (state.stopWatchdog) {
    state.stopWatchdog();
    state.stopWatchdog = null;
  }

  // Clear the provider session (cookies, cache, storage, service workers)
  if (state.session) {
    try {
      await clearProviderSession(state.session);
    } catch (err) {
      console.warn('[VideoWindow] Failed to clear session:', err);
    }
    state.session = null;
  }

  state.window = null;

  // Notify the main window that video was closed
  const mainWindow = BrowserWindow.getAllWindows().find(
    (w) => !w.isDestroyed() && w !== state.window
  );
  if (mainWindow) {
    mainWindow.webContents.send('video:closed');
  }

  console.log('[VideoWindow] Cleaned up');
}

/**
 * Check if a video window is currently open.
 */
export function isVideoWindowOpen(): boolean {
  return state.window !== null && !state.window.isDestroyed();
}

/**
 * Get the current video window instance.
 */
export function getVideoWindow(): BrowserWindow | null {
  return state.window && !state.window.isDestroyed() ? state.window : null;
}
