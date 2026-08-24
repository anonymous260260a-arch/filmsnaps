/**
 * FilmSnaps Desktop — Preload Script
 *
 * Exposes a secure IPC bridge to the renderer (Next.js web app).
 * Uses contextBridge to ensure the renderer cannot access Node.js APIs
 * directly — all communication goes through typed IPC channels.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { DownloadTask, DownloadMeta, DownloadStatus } from "./download";

// ── Nxsha scraper state (mirrored in apps/web/types/electron.d.ts) ──

export interface NxshaScrapeParams {
  type: "movie" | "tv";
  id: string;
  season?: number;
  episode?: number;
}

export interface NxshaScrapeLink {
  url: string;
  label: string;
  /** Original (unwrapped) URL — often the real direct file (API path). */
  orgUri?: string;
  provider?: string;
}

export type NxshaScrapeState =
  | { phase: "loading"; status?: string }
  | { phase: "solving" }
  | {
      phase: "links";
      servers: Array<{ name: string; links: NxshaScrapeLink[] }>;
    }
  | { phase: "no-links"; error?: string }
  | { phase: "failed"; error?: string };

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
    /** Seek the embed's active <video> to the given second (watch resume). */
    seek: (seconds: number) => Promise<void>;
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
    onProgress: (callback: (tasks: DownloadTask[]) => void) => () => void;
  };

  /**
   * Nxsha download-source namespace. Main process fetches download sources
   * from nxsha's encrypted private API directly (API-first; the hidden-window
   * CAPTCHA scrape remains as automatic fallback). States stream back over
   * nxsha:state.
   */
  nxsha: {
    scrape: (params: NxshaScrapeParams) => Promise<{ success: boolean }>;
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
  onPlayerSourceMissing: (callback: (event: { code: number }) => void) => {
    const listener = (_event: unknown, payload: { code: number }) =>
      callback(payload);
    ipcRenderer.on("player:source-missing", listener);
    return () => {
      ipcRenderer.removeListener("player:source-missing", listener);
    };
  },
  onPlayerProgress: (
    callback: (sample: {
      currentTime: number;
      duration: number;
      paused: boolean;
      qualified: boolean;
      readyState: number;
      srcHost: string;
      recentUserSeek: boolean;
    }) => void,
  ) => {
    const listener = (
      _event: unknown,
      sample: {
        currentTime: number;
        duration: number;
        paused: boolean;
        qualified: boolean;
        readyState: number;
        srcHost: string;
        recentUserSeek: boolean;
      },
    ) => callback(sample);
    ipcRenderer.on("player:progress", listener);
    return () => {
      ipcRenderer.removeListener("player:progress", listener);
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
    seek: (seconds: number) =>
      ipcRenderer.invoke("player:seek", Number(seconds)),
    onState: (callback: (state: PlayerViewState) => void) => {
      const listener = (_event: unknown, state: PlayerViewState) =>
        callback(state);
      ipcRenderer.on("player:state", listener);
      return () => {
        ipcRenderer.removeListener("player:state", listener);
      };
    },
  },

  download: {
    start: (meta: DownloadMeta) => ipcRenderer.invoke("download:start", meta),
    pause: (id: string) => ipcRenderer.invoke("download:pause", id),
    resume: (id: string) => ipcRenderer.invoke("download:resume", id),
    cancel: (id: string) => ipcRenderer.invoke("download:cancel", id),
    getAll: () => ipcRenderer.invoke("download:get-all"),
    open: (id: string) => ipcRenderer.invoke("download:open", id),
    clear: (id: string, deleteFile?: boolean) =>
      ipcRenderer.invoke("download:clear", id, deleteFile),
    setSpeedLimit: (level: "full" | "balanced" | "slower") =>
      ipcRenderer.invoke("download:set-speed-limit", level),
    onProgress: (callback: (tasks: DownloadTask[]) => void) => {
      const listener = (_event: unknown, tasks: DownloadTask[]) =>
        callback(tasks);
      ipcRenderer.on("download:progress", listener);
      return () => {
        ipcRenderer.removeListener("download:progress", listener);
      };
    },
  },

  /** App-level maintenance (Settings page). Desktop-only. */
  app: {
    clearCache: () => ipcRenderer.invoke("app:clear-cache"),
    pickDownloadFolder: () => ipcRenderer.invoke("app:pick-download-folder"),
    getDownloadFolder: () => ipcRenderer.invoke("app:get-download-folder"),
    setDownloadFolder: (dir: string) =>
      ipcRenderer.invoke("app:set-download-folder", dir),
    /** Open an http(s) URL in the user's default browser. */
    openExternal: (url: string) =>
      ipcRenderer.invoke("media-sources:open-external", url),
  },

  nxsha: {
    scrape: (params: NxshaScrapeParams) =>
      ipcRenderer.invoke("nxsha:scrape", params),
    cancel: () => ipcRenderer.invoke("nxsha:cancel"),
    onState: (
      callback: (state: NxshaScrapeState & { seq: number }) => void,
    ) => {
      const listener = (
        _event: unknown,
        state: NxshaScrapeState & { seq: number },
      ) => callback(state);
      ipcRenderer.on("nxsha:state", listener);
      return () => {
        ipcRenderer.removeListener("nxsha:state", listener);
      };
    },
  },

  falix: {
    getDetail: <T = unknown>(tmdbId: string) =>
      ipcRenderer.invoke("falix:detail", tmdbId) as Promise<T>,
  },
});
