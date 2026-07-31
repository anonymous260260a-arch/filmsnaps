/**
 * FilmSnaps Desktop — Auto-Updater
 *
 * Uses electron-updater to check for and download updates from GitHub Releases.
 * The update lifecycle:
 *   1. App starts → check for updates silently
 *   2. If update found → download in background
 *   3. On download complete → prompt user to restart
 *   4. User accepts → app restarts and installs
 *
 * All status changes are sent to the renderer via IPC so the UI
 * can show download progress, "restart to update" prompts, etc.
 */

import { BrowserWindow } from "electron";

// Lazy-loaded — electron-updater crashes outside production builds
// because it reads app.getVersion() at module init time
let _autoUpdater: any = null;

function getAutoUpdater(): any {
  if (!_autoUpdater) {
    const mod = require("electron-updater");
    _autoUpdater = mod.autoUpdater;
    _autoUpdater.logger = console;
    _autoUpdater.autoDownload = false;
    _autoUpdater.autoInstallOnAppQuit = true;
  }
  return _autoUpdater;
}

// ── IPC Channels ──

const CHANNELS = {
  STATUS: "update:status",
  PROGRESS: "update:progress",
  AVAILABLE: "update:available",
  NOT_AVAILABLE: "update:not-available",
  ERROR: "update:error",
} as const;

type UpdateStatus =
  | { type: "checking" }
  | { type: "available"; version: string; releaseNotes?: string }
  | {
      type: "downloading";
      percent: number;
      bytesPerSecond: number;
      total: number;
      transferred: number;
    }
  | { type: "downloaded"; version: string }
  | { type: "not-available" }
  | { type: "error"; message: string };

// ── Status dispatcher ──

function sendStatus(status: UpdateStatus): void {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  for (const win of windows) {
    win.webContents.send(CHANNELS.STATUS, status);
  }
}

// ── Event Handlers (lazy — only attached when initUpdater is called) ──

let _handlersAttached = false;

function attachHandlers(): void {
  if (_handlersAttached) return;
  _handlersAttached = true;

  const a = getAutoUpdater();

  a.on("checking-for-update", () => {
    console.log("[Updater] Checking for updates...");
    sendStatus({ type: "checking" });
  });

  a.on("update-available", (info: any) => {
    console.log(`[Updater] Update available: v${info.version}`);
    sendStatus({
      type: "available",
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
    // Auto-start download
    a.downloadUpdate().catch((err: any) => {
      console.error("[Updater] Download failed:", err);
      sendStatus({ type: "error", message: err.message });
    });
  });

  a.on("update-not-available", () => {
    console.log("[Updater] No updates available");
    sendStatus({ type: "not-available" });
  });

  a.on("download-progress", (progress: any) => {
    sendStatus({
      type: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    });
  });

  a.on("update-downloaded", (info: any) => {
    console.log(`[Updater] Update downloaded: v${info.version}`);
    sendStatus({ type: "downloaded", version: info.version });
  });

  a.on("error", (err: Error) => {
    console.error("[Updater] Error:", err.message);
    sendStatus({ type: "error", message: err.message });
  });
}

// ── Public API ──

/**
 * Initialize the auto-updater.
 * Should be called once when the app starts.
 */
export function initUpdater(): void {
  // In dev, don't actually check — only in production builds
  if (process.argv.includes("--dev")) {
    console.log("[Updater] Skipping update check in dev mode");
    return;
  }

  attachHandlers();

  // Give the app a moment to fully boot, then check
  setTimeout(() => {
    console.log("[Updater] Starting update check...");
    getAutoUpdater()
      .checkForUpdates()
      .catch((err: any) => {
        console.error("[Updater] Check failed:", err.message);
      });
  }, 5000);
}

/**
 * Install the downloaded update and restart the app.
 */
export function quitAndInstall(): void {
  getAutoUpdater().quitAndInstall(true, true);
}

/**
 * Check for updates again (manual trigger).
 */
export function checkForUpdates(): void {
  getAutoUpdater()
    .checkForUpdates()
    .catch((err: any) => {
      console.error("[Updater] Manual check failed:", err.message);
    });
}

export { CHANNELS };
