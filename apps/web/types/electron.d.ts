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
   * Subscribe to deterministic anime source-missing detection (main scanned
   * the settled MegaPlay guest for "Error Code: 410" — verdict §9 Q5).
   * Watch page advances the fallback chain (MAL → AniList) on this.
   */
  onPlayerSourceMissing: (
    callback: (event: { code: number }) => void,
  ) => () => void;
  /**
   * Subscribe to playback progress samples relayed from the provider embed
   * (the session preload samples <video>/<audio> at ~1Hz). Used by the watch
   * page's recorder to persist watch history. Returns an unsubscribe fn.
   */
  onPlayerProgress: (
    callback: (sample: {
      currentTime: number;
      duration: number;
      paused: boolean;
      /** Sample's media host is trusted content (false for ad pre-roll). */
      qualified: boolean;
      /** Last media readyState (0–4) at sample time. */
      readyState: number;
      /** Host of the media source ("blob" for MSE, "" unknown). */
      srcHost: string;
      /** User performed a manual seek recently (backward-jump escape hatch). */
      recentUserSeek: boolean;
    }) => void,
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
    /**
     * Seek the embed's active <video> element to the given second (watch
     * resume). Applied by the session preload as soon as a media element
     * exists; no-op if playback never starts.
     */
    seek: (seconds: number) => Promise<void>;
    /** Subscribe to provider view state changes; returns an unsubscribe fn. */
    onState: (callback: (state: PlayerViewState) => void) => () => void;
  };

  /**
   * Download Manager namespace (Phase 2). Manages offline media downloads
   * intercepted from the provider session. Desktop-only.
   */
  download: {
    start: (meta: DownloadMeta) => Promise<{ success: boolean }>;
    pause: (id: string) => Promise<void>;
    resume: (id: string) => Promise<void>;
    cancel: (id: string) => Promise<void>;
    getAll: () => Promise<DownloadTask[]>;
    open: (id: string) => Promise<void>;
    clear: (id: string, deleteFile?: boolean) => Promise<void>;
    setSpeedLimit: (level: "full" | "balanced" | "slower") => Promise<void>;
    setSaveDir: (dir: string) => Promise<void>;
    onProgress: (callback: (tasks: DownloadTask[]) => void) => () => void;
  };

  /**
   * Nxsha download-source namespace. Main process fetches download sources
   * from nxsha's encrypted private API directly (API-first; the hidden-window
   * CAPTCHA scrape remains as automatic fallback). States stream back over
   * nxsha:state.
   */
  nxsha: {
    scrape: (params: {
      type: "movie" | "tv";
      id: string;
      season?: number;
      episode?: number;
    }) => Promise<{ success: boolean }>;
    cancel: () => Promise<void>;
    onState: (
      callback: (state: NxshaScrapeState & { seq: number }) => void,
    ) => () => void;
  };

  /** Falix download-source namespace (REST proxy — bypasses CORS). */
  falix: {
    /**
     * Fetch title detail from the falix API by numeric id (TMDB id, or an
     * IMDB number when the renderer falls back after a TMDB 404).
     */
    getDetail: <T = unknown>(tmdbId: string) => Promise<T>;
  };

  /** App-level maintenance (Settings page). Desktop-only. */
  app: {
    /** Clear session cache + cookies + storageData (provider + default). */
    clearCache: () => Promise<void>;
    /** Open a directory picker; resolves with the path or null on cancel. */
    pickDownloadFolder: () => Promise<string | null>;
    /** Get the currently configured download folder path. */
    getDownloadFolder: () => Promise<string>;
    /** Persist a new download folder (applied on next app start). */
    setDownloadFolder: (dir: string) => Promise<{ success: boolean }>;
    /** Open an http(s) URL in the user's default browser. */
    openExternal: (url: string) => Promise<void>;
  };
}

/** Nxsha scrape state pushed over nxsha:state (mirrors preload.ts). */
interface NxshaScrapeState {
  phase: "loading" | "solving" | "links" | "no-links" | "failed";
  /** Optional progress text while loading (API path). */
  status?: string;
  servers?: Array<{
    name: string;
    links: Array<{
      url: string;
      label: string;
      /** Original (unwrapped) URL — often the real direct file (API path). */
      orgUri?: string;
      provider?: string;
    }>;
  }>;
  error?: string;
}

/** Status of a managed download (mirrors apps/desktop/src/download.ts). */
type DownloadStatus = "active" | "paused" | "completed" | "failed" | "canceled";

/** Metadata supplied when starting a download. */
interface DownloadMeta {
  url: string;
  tmdbId?: string;
  title?: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
}

/** A managed download task (mirrors apps/desktop/src/download.ts). */
interface DownloadTask {
  id: string;
  url: string;
  tmdbId?: string;
  title: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
  fileName: string;
  filePath: string;
  totalBytes: number;
  receivedBytes: number;
  speedBytesPerSec: number;
  state: DownloadStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
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
