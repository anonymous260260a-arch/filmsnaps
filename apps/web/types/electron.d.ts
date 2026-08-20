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
  /** Subscribe to provider home-page escape escalations; returns an unsubscribe fn */
  onEscapeBlocked: (
    callback: (event: { url: string; count: number }) => void,
  ) => () => void;

  /**
   * Player namespace (WebContentsView hybrid). The provider embed renders in a
   * native WebContentsView owned by main; these bridge methods let the React
   * renderer drive it. See apps/desktop/src/main.ts openProviderView().
   */
  player: {
    /** Load a provider embed URL into the native view (lazy-creates it). */
    open: (embedUrl: string) => Promise<void>;
    /** Hide the view without destroying it (for reuse). */
    close: () => Promise<void>;
    /** Position/size the native view over the renderer's black rect. */
    setBounds: (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => Promise<void>;
    /** Show/hide the native view (hidden while a React overlay covers it). */
    setVisible: (visible: boolean) => Promise<void>;
    /** Enter/leave fullscreen for the whole window (the view fills content). */
    setFullscreen: (fullscreen: boolean) => Promise<void>;
    /** Reload the current provider page. */
    reload: () => Promise<void>;
    /** Get the provider WebContents id (for verification / devtools). */
    getWebContentsId: () => Promise<number>;
    /** Subscribe to provider view state changes; returns an unsubscribe fn. */
    onState: (callback: (state: PlayerViewState) => void) => () => void;
  };
}

/** Provider native-view state pushed to the renderer (player:state). */
interface PlayerViewState {
  /** did-start-loading fired. */
  loading: boolean;
  /** did-finish-load fired (page rendered — hide loading overlay). */
  loaded: boolean;
  /** A real load failure (did-fail-load with a non-transient code). */
  error: string | null;
  /** did-fail-provisional-load (e.g. ERR_FAILED on the initial hop). */
  provisionalError: string | null;
  /** Window fullscreen state (hybrid fullscreen is window-level). */
  isFullscreen?: boolean;
  /** Renderer console lines tagged [PROTECTION]/[STREAM-AUDIT]. */
  audit?: string;
}

interface Window {
  electronAPI?: ElectronAPI;
}
