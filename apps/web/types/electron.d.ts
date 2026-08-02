/**
 * Type declarations for FilmSnaps Desktop's Electron API.
 * These are available only when running inside the Electron wrapper.
 */

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

interface ElectronAPI {
  isDesktop: true;
  platform: string;
  appVersion: string;
  /**
   * Initialize a provider session with R0-R8 network-level filtering.
   * The session partition is created once per provider and applies
   * to the <webview> element's partition attribute.
   */
  initProviderSession: (params: {
    providerId: string;
    embedUrl: string;
  }) => Promise<{ success: boolean }>;
  /** Clear the provider session (cookies, cache, trust manager) */
  clearProviderSession: () => Promise<void>;
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
  /** Subscribe to maximize/unmaximize changes; returns unsubscribe fn */
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  /** Navigation controls */
  reload: () => Promise<void>;
  devtools: () => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  /** Whether a back / forward step is possible in the current history */
  canGoBack: () => Promise<boolean>;
  canGoForward: () => Promise<boolean>;
  /** Subscribe to navigation-state changes; returns unsubscribe fn */
  onNavigationStateChange: (
    callback: (state: { canGoBack: boolean; canGoForward: boolean }) => void,
  ) => () => void;
  /** Subscribe to loading start/stop transitions; returns unsubscribe fn */
  onLoadingChange: (callback: (isLoading: boolean) => void) => () => void;
  /** Whether the user has accepted the Legal & DMCA terms (persisted in the main process) */
  getLegalAccepted: () => Promise<boolean>;
  /** Mark the Legal & DMCA terms as accepted (persisted in the main process) */
  setLegalAccepted: () => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
