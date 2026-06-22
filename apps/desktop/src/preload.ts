/**
 * FilmSnaps Desktop — Preload Script
 *
 * Exposes a secure IPC bridge to the renderer (Next.js web app).
 * Uses contextBridge to ensure the renderer cannot access Node.js APIs
 * directly — all communication goes through typed IPC channels.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Update status types (mirrored in updater.ts) ──

export type UpdateStatus =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes?: string }
  | { type: 'downloading'; percent: number; bytesPerSecond: number; total: number; transferred: number }
  | { type: 'downloaded'; version: string }
  | { type: 'not-available' }
  | { type: 'error'; message: string };

// The shape of the API exposed to the renderer
export interface ElectronAPI {
  /** True when running inside Electron (vs web browser) */
  isDesktop: true;
  /** Platform: 'darwin' | 'win32' | 'linux' */
  platform: string;
  /** Current app version */
  appVersion: string;
  /** Open the secure video player window */
  openVideo: (params: {
    type: 'movie' | 'tv';
    id: string;
    season?: number;
    episode?: number;
    provider: string;
    embedUrl: string;
  }) => Promise<{ success: boolean; error?: string }>;
  /** Close the video player window */
  closeVideo: () => Promise<void>;
  /** Callback when video window is closed by user */
  onVideoClosed: (callback: () => void) => void;
  /** Remove the video closed listener */
  removeVideoClosedListener: () => void;
  /** Listen for update status changes */
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => void;
  /** Remove update status listener */
  removeUpdateStatusListener: () => void;
  /** Manually check for updates */
  checkForUpdates: () => void;
  /** Install downloaded update and restart */
  quitAndInstall: () => void;
  /** Window controls */
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
}

// Read version from package.json at build time
const APP_VERSION = process.env.npm_package_version || '1.0.0';

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  platform: process.platform,
  appVersion: APP_VERSION,

  openVideo: (params: { type: string; id: string; season?: number; episode?: number; provider: string; embedUrl: string }) =>
    ipcRenderer.invoke('video:open', params),
  closeVideo: () => ipcRenderer.invoke('video:close'),

  onVideoClosed: (callback: () => void) => {
    ipcRenderer.on('video:closed', callback);
  },
  removeVideoClosedListener: () => {
    ipcRenderer.removeAllListeners('video:closed');
  },

  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    ipcRenderer.on('update:status', (_event, status: UpdateStatus) => callback(status));
  },
  removeUpdateStatusListener: () => {
    ipcRenderer.removeAllListeners('update:status');
  },
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  quitAndInstall: () => ipcRenderer.invoke('update:install'),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
});
