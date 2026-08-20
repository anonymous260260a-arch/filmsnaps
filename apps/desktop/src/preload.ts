/**
 * FilmSnaps Desktop — Preload Script
 *
 * Exposes a secure IPC bridge to the renderer (Next.js web app).
 * Uses contextBridge to ensure the renderer cannot access Node.js APIs
 * directly — all communication goes through typed IPC channels.
 */

import { contextBridge, ipcRenderer } from "electron";

// ── Update status types (mirrored in updater.ts) ──

export type UpdateStatus =
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

// The shape of the API exposed to the renderer
export interface ElectronAPI {
  /** True when running inside Electron (vs web browser) */
  isDesktop: true;
  /** Platform: 'darwin' | 'win32' | 'linux' */
  platform: string;
  /** Current app version */
  appVersion: string;
  /**
   * Initialize a provider session with R0-R8 network-level filtering.
   * The session partition is created once per provider and applies
   * to the <webview> element's partition attribute.
   *
   * @param providerId - Provider ID for per-provider blocking rules
   * @param embedUrl - The provider embed URL (host is seeded into session trust)
   */
  initProviderSession: (params: {
    providerId: string;
    embedUrl: string;
  }) => Promise<{ success: boolean }>;
  /** Clear the provider session (cookies, cache, trust manager) */
  clearProviderSession: () => Promise<void>;
  /** Notify main process the provider changed (resets session) */
  onProviderChange: (providerId: string) => Promise<void>;
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
  /** Query whether the window is currently maximized */
  isMaximized: () => Promise<boolean>;
  /**
   * Subscribe to maximize/unmaximize changes.
   * Returns an unsubscribe function.
   */
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  /** Navigation controls */
  reload: () => Promise<void>;
  devtools: () => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  /** Whether a back / forward step is possible in the current history */
  canGoBack: () => Promise<boolean>;
  canGoForward: () => Promise<boolean>;
  /**
   * Subscribe to navigation-state changes (canGoBack / canGoForward).
   * Fires on every page navigation. Returns an unsubscribe function.
   */
  onNavigationStateChange: (
    callback: (state: { canGoBack: boolean; canGoForward: boolean }) => void,
  ) => () => void;
  /** Subscribe to loading start/stop transitions. Returns an unsubscribe fn. */
  onLoadingChange: (callback: (isLoading: boolean) => void) => () => void;
  /** Whether the user has accepted the Legal & DMCA terms (persisted in main process) */
  getLegalAccepted: () => Promise<boolean>;
  /** Mark the Legal & DMCA terms as accepted */
  setLegalAccepted: () => Promise<void>;
  /**
   * Subscribe to provider home-page escape escalations (the embed tried to
   * navigate to a provider home/list path after already auto-reloading once —
   * e.g. a "Go Home" button on a provider error UI). Returns an unsubscribe fn.
   */
  onEscapeBlocked: (
    callback: (event: { url: string; count: number }) => void,
  ) => () => void;

  /**
   * Player namespace (WebContentsView hybrid). The provider embed renders in a
   * native WebContentsView owned by main; these bridge methods let the React
   * renderer drive it (open/close/bounds/visibility/fullscreen/reload/state).
   */
  player: {
    open: (embedUrl: string) => Promise<void>;
    close: () => Promise<void>;
    setBounds: (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => Promise<void>;
    setVisible: (visible: boolean) => Promise<void>;
    setFullscreen: (fullscreen: boolean) => Promise<void>;
    reload: () => Promise<void>;
    getWebContentsId: () => Promise<number>;
    onState: (callback: (state: PlayerViewState) => void) => () => void;
  };
}

/**
 * Provider native-view state pushed to the renderer (main → player:state).
 * Mirrors the type in apps/web/types/electron.d.ts — keep in sync.
 */
interface PlayerViewState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  provisionalError: string | null;
  /** Window fullscreen state (hybrid fullscreen is window-level). */
  isFullscreen?: boolean;
  audit?: string;
}

// Read version from package.json at build time
const APP_VERSION = process.env.npm_package_version || "1.0.0";

contextBridge.exposeInMainWorld("electronAPI", {
  isDesktop: true,
  platform: process.platform,
  appVersion: APP_VERSION,

  initProviderSession: (params: { providerId: string; embedUrl: string }) =>
    ipcRenderer.invoke("provider:init", params),
  clearProviderSession: () => ipcRenderer.invoke("provider:clear"),
  onProviderChange: (providerId: string) =>
    ipcRenderer.invoke("provider:init", { providerId, embedUrl: "" }),

  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    ipcRenderer.on("update:status", (_event, status: UpdateStatus) =>
      callback(status),
    );
  },
  removeUpdateStatusListener: () => {
    ipcRenderer.removeAllListeners("update:status");
  },
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  quitAndInstall: () => ipcRenderer.invoke("update:install"),

  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: unknown, isMaximized: boolean) =>
      callback(isMaximized);
    ipcRenderer.on("window:maximized-changed", listener);
    return () => {
      ipcRenderer.removeListener("window:maximized-changed", listener);
    };
  },
  reload: () => ipcRenderer.invoke("window:reload"),
  devtools: () => ipcRenderer.invoke("window:devtools"),
  goBack: () => ipcRenderer.invoke("window:back"),
  goForward: () => ipcRenderer.invoke("window:forward"),
  canGoBack: () => ipcRenderer.invoke("window:canGoBack"),
  canGoForward: () => ipcRenderer.invoke("window:canGoForward"),
  onNavigationStateChange: (
    callback: (state: { canGoBack: boolean; canGoForward: boolean }) => void,
  ) => {
    const listener = (
      _event: unknown,
      state: { canGoBack: boolean; canGoForward: boolean },
    ) => callback(state);
    ipcRenderer.on("window:navigation-state", listener);
    return () => {
      ipcRenderer.removeListener("window:navigation-state", listener);
    };
  },
  onLoadingChange: (callback: (isLoading: boolean) => void) => {
    const listener = (_event: unknown, isLoading: boolean) =>
      callback(isLoading);
    ipcRenderer.on("window:loading", listener);
    return () => {
      ipcRenderer.removeListener("window:loading", listener);
    };
  },
  getLegalAccepted: () => ipcRenderer.invoke("legal:status"),
  setLegalAccepted: () => ipcRenderer.invoke("legal:accept"),
  onEscapeBlocked: (
    callback: (event: { url: string; count: number }) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: { url: string; count: number },
    ) => callback(payload);
    ipcRenderer.on("provider:escape-blocked", listener);
    return () => {
      ipcRenderer.removeListener("provider:escape-blocked", listener);
    };
  },

  player: {
    open: (embedUrl: string) => ipcRenderer.invoke("player:open", embedUrl),
    close: () => ipcRenderer.invoke("player:close"),
    setBounds: (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => ipcRenderer.invoke("player:set-bounds", rect),
    setVisible: (visible: boolean) =>
      ipcRenderer.invoke("player:set-visible", visible),
    setFullscreen: (fullscreen: boolean) =>
      ipcRenderer.invoke("player:fullscreen", fullscreen),
    reload: () => ipcRenderer.invoke("player:reload"),
    getWebContentsId: () => ipcRenderer.invoke("player:get-webcontents-id"),
    onState: (callback: (state: PlayerViewState) => void) => {
      const listener = (_event: unknown, state: PlayerViewState) =>
        callback(state);
      ipcRenderer.on("player:state", listener);
      return () => {
        ipcRenderer.removeListener("player:state", listener);
      };
    },
  },
});
