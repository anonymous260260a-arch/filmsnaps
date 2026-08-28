/**
 * FilmSnaps Desktop — Main Process
 *
 * Entry point for the Electron application.
 * Creates the main BrowserWindow (Next.js web app UI) and manages
 * the application lifecycle.
 *
 * Key responsibilities:
 *   - Create and manage the main app window
 *   - Register IPC handlers (provider:init/clear, window controls)
 *   - Set up native app menu
 *   - Manage app lifecycle (macOS dock behavior, quit, etc.)
 *   - Spawn Next.js server in production mode
 *   - Persist window state
 */

import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  session,
  shell,
  WebContentsView,
  webContents,
  screen,
} from "electron";
import { join } from "path";
import { ChildProcess, spawn } from "child_process";
import { createServer, type AddressInfo } from "net";
import {
  loadWindowState,
  shouldStartMaximized,
  saveWindowState,
} from "./lib/window-state";
import { getLegalAccepted, setLegalAccepted } from "./lib/legal-accept";
import { initUpdater, quitAndInstall, checkForUpdates } from "./updater";
import {
  createProviderSession,
  clearProviderSession,
  preSeedProviderAllowlists,
  resetSessionHandlers,
  setBlockingProviderId,
  getCurrentBlockingProviderId,
  getTrustManager,
} from "./security/request-filter";
import { applyNavigationGuard } from "./security/navigation-guard";
import {
  attachProviderSecurity,
  computeProviderAllowedDomains,
  verifyPreloadInFrames,
} from "./security/provider-security";
import { registerCosmeticFilterIPC } from "./security/cosmetic-filter";
import {
  startOtaConfigLoop,
  stopOtaConfigLoop,
  recordProviderFailure,
  recordProviderSuccess,
} from "./security/ota-config";
import { initDownloadManager } from "./download";
import { initMediaSources } from "./media-sources";
import {
  auditProviderSessionWarnings,
  auditPreloadObserverBookkeeping,
} from "./security/structural-warnings";

// ── Constants ──

const IS_DEV = process.argv.includes("--dev");
const WEB_APP_DIR = IS_DEV
  ? join(__dirname, "../../apps/web")
  : join(process.resourcesPath, "web", "apps", "web");
const DEV_SERVER_URL = "http://localhost:3000";

/** Resolve path to an app resource (works in both dev and production) */
function resourcePath(...segments: string[]): string {
  if (IS_DEV) {
    return join(__dirname, "..", ...segments);
  }
  return join(process.resourcesPath, ...segments);
}

let mainWindow: BrowserWindow | null = null;
let nextServerProcess: ChildProcess | null = null;
/** The localhost port the Next.js server is actually running on (prod only). */
let nextServerPort = 3000;

// ── Provider session state (for inline webview) ──
let currentProviderSession: ReturnType<typeof createProviderSession> | null =
  null;
let currentProviderId: string | null = null;
/**
 * The last frame that reported a *qualified* (trusted-content) playback
 * sample. Resume seeks are targeted here via `webContents.sendToFrame` so an
 * ad pre-roll in another frame never gets seeked (expert verdict Q3/Q4).
 * Reset on every navigation/provider switch — frames change across loads.
 */
let lastContentFrame: { processId: number; frameId: number } | null = null;

// ── Fullscreen debug tracing (set FILMSNAPS_FS_DEBUG=1 to enable) ──
// Lets us OBSERVE (not guess) how the provider triggers fullscreen and how main
// reacts. Logs every fullscreen-state change and every renderer bounds push so we
// can see the race (a small bounds push arriving after the expand).
const FS_DEBUG = process.env.FILMSNAPS_FS_DEBUG === "1";
const fsLog = (...args: unknown[]): void => {
  if (FS_DEBUG) console.log("[FS-DEBUG]", ...args);
};

// ── Provider WebContentsView (Phase 3 hybrid migration) ─────────────
// A single native WebContentsView owns the provider embed. Created lazily on
// the first player:open, reused for the app lifetime (mirrors the old
// singleton <webview> invariant — no React key, no remount race). The security
// stack (nav guard L4, CDP-Fetch L8, session preload L5/L6, verifyPreloadInFrames)
// attaches to view.webContents — the WebContents API is view-agnostic, so no
// security module changes. The React renderer reserves a black rect and drives
// bounds/visibility/fullscreen/load via the player:* IPC bridge (preload.ts).
let providerView: WebContentsView | null = null;
let providerViewAttached = false;
/** The URL the view is currently showing (for reload). */
let providerViewUrl = "";
/** Guard state for the persistent view — re-pointed per provider switch. */
let providerViewGuard: {
  updateConfig: (next: Parameters<typeof applyNavigationGuard>[1]) => void;
} | null = null;
/** True once the view's webContents had its one-time security attach. */
let providerViewSecurityAttached = false;
/** Whether the renderer currently wants the view visible (overlay state). */
let providerViewVisible = true;
/** The last bounds main applied (used to re-apply on fullscreen/resize). */
let providerViewBounds: Electron.Rectangle = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};
/** Fullscreen state owned by the PROVIDER's own button (preload bridge). When
 *  true, main owns the view bounds and renderer bounds pushes are ignored. */
let isProviderFullscreen = false;
/** Last bounds the renderer pushed — restored when leaving provider fullscreen. */
let lastKnownRendererBounds: Electron.Rectangle = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};
/**
 * Authoritative window-fullscreen flag. Windows fullscreen is ASYNC: inside the
 * enter-/leave-full-screen handlers win.isFullScreen() reports the PREVIOUS
 * state (false on enter, true on leave). Reading it there desyncs the renderer
 * (Bug B). We track the intended state explicitly and use it for every signal
 * we send to the renderer.
 */
let winFullscreenState = false;

// Pre-seed CDN domain set from blocklist.json, built at startup.
// Used to pre-fill session trust so CDNs are R0-allowed from first request.
const preSeededCdnDomains: Set<string> =
  preSeedTrustForProviderSessions().cdnDomains;

// ── Main Window ──

function createMainWindow(): void {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    ...windowState,
    minWidth: 960,
    minHeight: 600,
    title: "FilmSnaps",
    frame: false,
    backgroundColor: "#0a0a0f",
    show: false,
    icon: resourcePath("resources", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // The main app needs Node.js for IPC; provider content uses sandbox
      webSecurity: true,
      // webviewTag intentionally NOT set — the provider embed now renders in a
      // native WebContentsView (Phase 3 hybrid), not a <webview> tag.
    },
  });

  // Restore maximized state
  if (shouldStartMaximized()) {
    mainWindow.maximize();
  }

  // Show window smoothly
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Set up IPC handlers for window controls
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:maximize", () => {
    const win = mainWindow;
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    // Push the resulting state so the renderer can swap the
    // maximize/restore icon without a round-trip query.
    win.webContents.send("window:maximized-changed", win.isMaximized());
  });
  ipcMain.handle("window:isMaximized", () => {
    return mainWindow?.isMaximized() ?? false;
  });
  ipcMain.handle("window:close", () => {
    mainWindow?.close();
  });
  ipcMain.handle("window:reload", () => {
    mainWindow?.webContents.reload();
  });
  ipcMain.handle("window:devtools", () => {
    if (mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });
  ipcMain.handle("window:back", () => {
    mainWindow?.webContents.goBack();
  });
  ipcMain.handle("window:forward", () => {
    mainWindow?.webContents.goForward();
  });
  // Navigation telemetry — the custom title bar's back/forward buttons
  // need to know whether a step is even possible, and whether a load is
  // in flight (for the indeterminate progress bar).
  ipcMain.handle("window:canGoBack", () => {
    return mainWindow?.webContents.navigationHistory.canGoBack() ?? false;
  });
  ipcMain.handle("window:canGoForward", () => {
    return mainWindow?.webContents.navigationHistory.canGoForward() ?? false;
  });

  // ── Pre-create the provider session so R0-R8 filters are installed ──
  // BEFORE the first webview navigates. The webview is created during
  // React's mount phase, which fires when Next.js hydrates the watch page.
  // We call createProviderSession here synchronously so the session
  // partition with webRequest filters already exists when the webview
  // resolves its `partition` attribute.
  //
  // createProviderSession is now idempotent — the webRequest handler is
  // installed only once. Subsequent provider:init IPC calls will reuse
  // this session and its accumulated trust.
  createProviderSession();
  console.log("[Main] Provider session pre-created with R0-R8 filters");

  // Structural warnings (Phase 2e) — surface likely security-drift without
  // changing behavior. Gated to FILMSNAPS_AUDIT=1 so production stays quiet
  // (the console.warn inside is only emitted when auditing).
  if (process.env.FILMSNAPS_AUDIT === "1") {
    // Widevine is NOT enabled on the provider session by design (the
    // will-attach-webview lockdown sets no enableWidevine, and the partition
    // is cache:false). Electron's Session has no readable widevineVersion
    // flag, so this is audited as "disabled" today; if a future change enables
    // Widevine in createProviderSession/webPreferences, add an explicit
    // source-of-truth boolean there and thread it through this call.
    auditProviderSessionWarnings({
      sessionWidevineEnabled: false,
      providerId: getCurrentBlockingProviderId() ?? undefined,
    });
    try {
      const { readFileSync } = require("fs");
      const { join } = require("path");
      const preloadPath = join(
        __dirname,
        "..",
        "preload",
        "provider-preload.js",
      );
      auditPreloadObserverBookkeeping(readFileSync(preloadPath, "utf8"));
    } catch (e) {
      console.warn(
        "[Structural] Could not read preload for observer audit:",
        e,
      );
    }
  }

  // OTA config loop — verify + apply the signed v5 config on launch and
  // every 2h, with ring-buffer rollback + 3×-failure watchdog auto-heal.
  startOtaConfigLoop();
  app.on("before-quit", () => stopOtaConfigLoop());

  // Register provider session IPC handlers (inline webview)
  registerProviderSessionIPC();

  // Register the player:* IPC handlers (WebContentsView hybrid — Phase 3)
  registerPlayerViewIPC();

  // Register the engine-derived cosmetic filter IPC (Pillar B) — the preload's
  // DOM sweeper posts class/id/href tokens here and gets the engine's cosmetic
  // CSS + scriptlets back to apply to the live page.
  registerCosmeticFilterIPC();

  // Register updater IPC handlers
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.handle("update:install", () => quitAndInstall());

  // Register legal-acceptance IPC handlers (first-run gate)
  ipcMain.handle("legal:status", () => getLegalAccepted());
  ipcMain.handle("legal:accept", () => {
    setLegalAccepted(true);
  });

  // ── App-level maintenance IPC (Phase 4 Settings) ──

  // Clear the provider session cache (cookies, HTTP cache, localStorage) and
  // the app-wide session cache. The provider view is not destroyed — it just
  // reloads with a clean slate.
  ipcMain.handle("app:clear-cache", async () => {
    const clear = async (sess: Electron.Session) => {
      await sess.clearCache();
      try {
        await sess.cookies.flushStore();
      } catch {
        /* cookies may be empty / unsupported in some partitions */
      }
      await sess.clearStorageData();
    };
    try {
      await clear(session.defaultSession);
      // Provider session cache lives on its own partition.
      await clear(session.fromPartition("persist:filmsnaps-provider"));
    } catch (e) {
      console.error("[Main] clear-cache error:", e);
    }
    return { success: true };
  });

  // Open a directory-selection dialog and resolve with the chosen path.
  // Returns null if the user cancels.
  ipcMain.handle("app:pick-download-folder", async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Select download folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  // Resolve the current configured download folder so Settings can display it.
  ipcMain.handle("app:get-download-folder", () => {
    if (!app.isReady()) return app.getPath("downloads");
    return (
      (globalThis as any).__filmsnapsDownloadDir ||
      join(app.getPath("downloads"), "FilmSnaps")
    );
  });

  // Persist a new download folder (used by the DownloadManager on next start;
  // the running manager keeps its existing dir until relaunch).
  ipcMain.handle("app:set-download-folder", (_e, dir: string) => {
    try {
      (globalThis as any).__filmsnapsDownloadDir = dir;
    } catch {
      /* best-effort */
    }
    return { success: true };
  });

  // Save window state on changes + push maximize state to the renderer
  // so the custom title bar can swap its maximize/restore icon live.
  mainWindow.on("resize", () => {
    saveWindowState(mainWindow!);
    // DO NOT call providerViewFitToContent() here — it would fill the view to
    // the whole window content bounds, overwriting the renderer-driven rect
    // bounds and covering the server pill/dropdown. Renderer owns bounds
    // outside fullscreen via player:set-bounds (ResizeObserver).
  });
  mainWindow.on("move", () => saveWindowState(mainWindow!));
  mainWindow.on("enter-full-screen", () => {
    // Main now owns the view bounds; the renderer's ResizeObserver must not
    // shrink it back. Set the guards FIRST so a resize tick can't race.
    fsLog("win enter-full-screen fired");
    isProviderFullscreen = true;
    winFullscreenState = true;
    // Fill authoritatively. Windows isFullScreen() is STILL false at this
    // instant inside the handler (async), so providerViewFitToContent's
    // `if (!win.isFullScreen()) return;` would early-exit and leave the video
    // small (Bug A). fillProviderView has no such guard — it fills to the
    // content rect directly from getContentBounds().
    fillProviderView();
    sendPlayerFullscreenState();
  });
  mainWindow.on("leave-full-screen", () => {
    // Hand bounds back to the renderer and clear the guard so its pushes resume.
    fsLog("win leave-full-screen fired");
    isProviderFullscreen = false;
    winFullscreenState = false;
    restoreProviderView();
    sendPlayerFullscreenState();
  });
  mainWindow.on("maximize", () => {
    saveWindowState(mainWindow!);
    mainWindow?.webContents.send("window:maximized-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    saveWindowState(mainWindow!);
    mainWindow?.webContents.send("window:maximized-changed", false);
  });

  // Push navigation-state changes to the title bar (back/forward disabled
  // states) and loading transitions (indeterminate progress bar).
  const sendNavState = () => {
    const wc = mainWindow?.webContents;
    if (!wc) return;
    wc.send("window:navigation-state", {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
  };
  mainWindow.webContents.on("did-navigate", sendNavState);
  mainWindow.webContents.on("did-navigate-in-page", sendNavState);
  mainWindow.webContents.on("did-start-loading", () => {
    mainWindow?.webContents.send("window:loading", true);
  });
  mainWindow.webContents.on("did-stop-loading", () => {
    mainWindow?.webContents.send("window:loading", false);
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Handle external navigation
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // Allow same-origin navigation only
    try {
      const parsedUrl = new URL(url);
      if (
        parsedUrl.hostname !== "localhost" &&
        parsedUrl.hostname !== "127.0.0.1"
      ) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  // ── Provider embed: WebContentsView (Phase 3 hybrid) ──────────────────────
  // The provider embed no longer renders in a <webview> tag (webviewTag is not
  // set on this window). Instead a single native WebContentsView is created
  // lazily by ensureProviderView() on the first player:open IPC and reused for
  // the app lifetime. All of the security layers that used to attach in the
  // old will-attach-webview / did-attach-webview handlers now attach directly
  // to view.webContents in ensureProviderView():
  //   - L4 nav guard (applyNavigationGuard) — re-pointed per provider switch
  //   - L7 CDP verification + L8 CDP-Fetch injection (attachProviderSecurity)
  //   - L7b fail-closed per-frame sweep (verifyPreloadInFrames)
  //   - OTA watchdog (did-fail-load → recordProviderFailure) + recordProviderSuccess
  //   - console-message AUDIT forwarding (Electron 42 Event form, not positional)
  // The session-level preload (L5/L6) + R0-R8 webRequest filters (L2) + CSP (L3)
  // are partition-keyed and apply automatically because the view uses the same
  // 'persist:filmsnaps-provider' partition as createProviderSession().
  // NOTE: no 50ms debounce needed — the view's WebContents exists synchronously
  // at construction, so there is no React hydration double-mount race.

  // Remove native menu bar — app uses its own header navigation
  Menu.setApplicationMenu(null);

  // Load the Next.js app
  if (IS_DEV) {
    // In dev mode, connect to the already-running Next.js dev server
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // In production, spawn the Next.js server
    startNextServer();
  }

  mainWindow.on("closed", () => {
    // Release the provider view (and its webContents) with the window.
    if (providerView && !providerView.webContents.isDestroyed()) {
      try {
        providerView.webContents.close();
      } catch {
        /* already gone */
      }
    }
    providerView = null;
    providerViewAttached = false;
    providerViewGuard = null;
    providerViewSecurityAttached = false;
    mainWindow = null;
  });
}

// ── Provider WebContentsView (Phase 3 hybrid) ───────────────────────

/**
 * Forward a provider-view state update to the renderer (player:state).
 * The renderer's DesktopSecureWebview maps these to its loading/error UI.
 */
function sendPlayerState(partial: Partial<PlayerViewStateMain>): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state: PlayerViewStateMain = {
    loading: _playerState.loading,
    loaded: _playerState.loaded,
    error: _playerState.error,
    provisionalError: _playerState.provisionalError,
    ...partial,
  };
  Object.assign(_playerState, partial);
  mainWindow.webContents.send("player:state", state);
}

/** Main-process mirror of the renderer's PlayerViewState (preload.ts). */
interface PlayerViewStateMain {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  provisionalError: string | null;
  /** Window fullscreen state (hybrid fullscreen is window-level). */
  isFullscreen?: boolean;
  audit?: string;
}

const _playerState: PlayerViewStateMain = {
  loading: false,
  loaded: false,
  error: null,
  provisionalError: null,
  isFullscreen: false,
};

// ── MegaPlay "Error Code: 410" detection (anime fallback chain) ─────
//
// MegaPlay renders a plain-text "Error Code: 410" when it has no source for
// the requested MAL/AniList id + episode (consultation §3.2). Desktop can see
// cross-origin DOM (web cannot) — after the guest settles, scan for it and
// tell the renderer to advance the chain (MAL → AniList → exhausted).
// Verdict §9 Q5: this is the ONLY auto-advance signal; soft signals (no
// progress within N s) stay manual everywhere.
const ANIME_410_SCAN_DELAY_MS = 2500;
let anime410Timer: ReturnType<typeof setTimeout> | null = null;

function scheduleAnime410Scan(wc: Electron.WebContents): void {
  if (anime410Timer) clearTimeout(anime410Timer);
  anime410Timer = setTimeout(() => {
    anime410Timer = null;
    if (wc.isDestroyed()) return;
    // Only meaningful while the megaplay session is the active provider —
    // a switch inside the settle window must not fire a stale advance.
    if (getCurrentBlockingProviderId() !== "megaplay") return;
    // Scoped to player-ish containers, NEVER document.body, so subtitle or
    // comment text containing "Error Code: 410" cannot false-positive
    // (verdict §9 action item 5).
    const js =
      "(function(){try{var scopes=document.querySelectorAll('main,[class*=\"player\"],[class*=\"container\"],#__next');for(var i=0;i<scopes.length;i++){if(/Error Code:\\s*410/.test(scopes[i].textContent||''))return '410';}return '';}catch(e){return '';}})();";
    void wc
      .executeJavaScript(js, true)
      .then((res) => {
        if (
          res === "410" &&
          !wc.isDestroyed() &&
          mainWindow &&
          !mainWindow.isDestroyed()
        ) {
          console.log(
            "[Main] MegaPlay reported Error Code: 410 — advancing anime chain",
          );
          mainWindow.webContents.send("player:source-missing", { code: 410 });
        }
      })
      .catch(() => {
        /* guest navigated away mid-scan — benign */
      });
  }, ANIME_410_SCAN_DELAY_MS);
}

/** Reset the renderer-facing player state (on close / new provider). */
function resetPlayerState(): void {
  _playerState.loading = false;
  _playerState.loaded = false;
  _playerState.error = null;
  _playerState.provisionalError = null;
}

/** Push the window's current fullscreen state to the renderer. */
function sendPlayerFullscreenState(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  // Use the authoritative flag, NOT win.isFullScreen(): inside the
  // enter-/leave-full-screen handlers the native getter returns the PREVIOUS
  // state (false on enter, true on leave), which desyncs the renderer's chrome
  // (top bar wouldn't hide on enter, wouldn't return on leave — Bug B).
  fsLog("sendPlayerFullscreenState ->", winFullscreenState);
  sendPlayerState({ isFullscreen: winFullscreenState });
}

/**
 * Ensure the provider view exists (created lazily on the first player:open).
 * Mirrors the old singleton <webview> invariant — ONE WebContents owned by
 * main, reused for the app lifetime. The security stack attaches ONCE here:
 * nav guard (L4), CDP verification + L8 Fetch injection + fail-closed sweep
 * (attachProviderSecurity + verifyPreloadInFrames) — all on view.webContents.
 */
function ensureProviderView(): WebContentsView | null {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return null;

  // Reuse existing view if it exists (even if detached) — avoids re-attach
  // cost and leaked WebContents on hide/show cycles.
  if (providerView && !providerView.webContents.isDestroyed()) {
    if (!providerViewAttached) {
      win.contentView.addChildView(providerView);
      providerView.setBounds(providerViewBounds);
      providerView.setVisible(providerViewVisible);
      providerViewAttached = true;
    }
    return providerView;
  }

  if (providerView && providerViewAttached) return providerView;

  // Lazy-create on first use. webPreferences:
  //   - partition: the SAME persistent provider partition the session filters
  //     + registered frame preload live on (request-filter.ts createProviderSession).
  //   - NO preload here — the session registerPreloadScript(type:'frame') covers
  //     it; setting one would double-execute (see the will-attach-webview note).
  //   - contextIsolation:false + nodeIntegrationInSubFrames:true REQUIRED for
  //     the session preload to run in the main world of every frame (same
  //     reasoning as the old webview lockdown). sandbox:true strips Node.
  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:filmsnaps-provider",
      sandbox: true,
      contextIsolation: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      webSecurity: true,
    },
  });

  providerView = view;
  win.contentView.addChildView(view);
  view.setVisible(providerViewVisible);
  view.setBounds(providerViewBounds);
  providerViewAttached = true;

  const wc = view.webContents;
  const providerId = getCurrentBlockingProviderId();

  // ── Forward the provider page's console to the terminal (FS_DEBUG only) ──
  // The session preload logs here when it sees a fullscreen call, so we can watch
  // EXACTLY what the provider does (real Fullscreen API vs CSS fake-fullscreen)
  // without opening DevTools. Gated on FILMSNAPS_FS_DEBUG=1.
  if (FS_DEBUG) {
    wc.on(
      "console-message",
      (_e, level: number, message: string, _line: number, sourceId: string) => {
        const tag = level >= 2 ? "ERR" : level === 1 ? "WARN" : "LOG";
        console.log(`[FS-PROVIDER][${tag}][${sourceId}] ${message}`);
      },
    );
  }

  // ── Forward load/error/audit state to the renderer (player:state) ──
  wc.on("did-start-loading", () => {
    // Frames change across navigations/provider switches — drop the stale
    // content-frame so the next seek re-qualifies against fresh samples.
    lastContentFrame = null;
    // Cancel any pending 410 scan from the previous page.
    if (anime410Timer) {
      clearTimeout(anime410Timer);
      anime410Timer = null;
    }
    sendPlayerState({ loading: true });
  });
  wc.on("did-stop-loading", () => {
    sendPlayerState({ loading: false });
  });
  wc.on("did-finish-load", () => {
    sendPlayerState({ loaded: true, loading: false, error: null });
    if (providerId) recordProviderSuccess(providerId);
    // Anime chain: scan for MegaPlay's "Error Code: 410" after settle.
    scheduleAnime410Scan(wc);
  });
  wc.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return;
    // ERR_ABORTED (-3) = superseded navigation / stop() — not a real failure.
    if (code === -3) return;
    if (desc && recordProviderFailure(providerId ?? "", desc)) {
      // OTA watchdog reverted config — reload so the healed config applies.
      console.warn(
        `[Main] OTA watchdog reverted config after ${desc} — reloading embed`,
      );
      void wc.loadURL(providerViewUrl);
      return;
    }
    sendPlayerState({ error: desc || "Failed to load" });
  });
  wc.on("did-fail-provisional-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return; // superseded — transient
    // A provisional failure on the initial server hop (redirect-mesh) is often
    // transient — the embed may redirect to the real player host. The renderer
    // shows an error only if no load completes shortly after.
    console.warn(
      `[Main] Provider provisional load failed ${code} ${desc} ${url.slice(0, 100)}`,
    );
    sendPlayerState({ provisionalError: desc || "Failed to load" });
  });
  wc.on("console-message", (event) => {
    // Electron 42: the new Event form carries message/level (string).
    const { message, level } = event;
    if (
      message.includes("[PROTECTION]") ||
      message.includes("[STREAM-AUDIT]")
    ) {
      console.log(`[ProviderView console][${level}] ${message}`);
      sendPlayerState({ audit: message });
    }
  });

  // ── L4 nav guard — installed ONCE, re-pointed per provider switch ──
  const {
    getProviderBlockHomePaths,
    getUniversalBlockPaths,
    getAllowServerRedirects,
  } = require("./security/provider-config");
  const allowed = computeProviderAllowedDomains(providerId, providerViewUrl);
  const guard = applyNavigationGuard(wc, {
    providerUrl: providerViewUrl,
    requestedEmbedUrl: providerViewUrl,
    blockHomePaths: getProviderBlockHomePaths(providerId ?? ""),
    universalBlockPaths: getUniversalBlockPaths(),
    allowServerRedirects: getAllowServerRedirects(providerId ?? ""),
    additionalAllowedHosts: Array.from(allowed),
    onBlocked: (type, url) =>
      console.warn(`[NavGuard] Blocked ${type}: ${url.slice(0, 120)}`),
    onEscaped: (count, url) => {
      if (mainWindow?.isDestroyed()) return;
      mainWindow?.webContents.send("provider:escape-blocked", { url, count });
    },
  });
  providerViewGuard = { updateConfig: guard.updateConfig };

  // ── CDP verification + L8 Fetch injection + fail-closed frame sweep ──
  attachProviderSecurity(wc, { providerId, embedUrl: providerViewUrl });
  verifyPreloadInFrames(wc, {
    onFailClosed: (frameUrl) => {
      if (wc.isDestroyed()) return;
      console.warn(
        `[Main] FAIL-CLOSED: protection absent in ${frameUrl.slice(0, 120)} — frame stopped`,
      );
    },
  });

  // ── Provider's own fullscreen button → window fullscreen + fill ──
  // The provider embed renders in this NATIVE WebContentsView, so when its own
  // player calls <video>.requestFullscreen() inside the view, Electron fires
  // enter-html-full-screen on THIS webContents (not the main window's). Nothing
  // listens for it by default, so the view never expands — only the OS fullscreen
  // toggle (mainWindow 'enter-full-screen') would have, leaving the video small
  // inside an app-level fullscreen. Bridge it: mirror the renderer-driven
  // fullscreen path (window-level fullscreen → providerViewFitToContent fills
  // the whole content area → both the app chrome and the video go fullscreen),
  // and keep player:state in sync so the renderer hides its native chrome.
  wc.on("enter-html-full-screen", () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    fsLog("wc enter-html-full-screen fired");
    handleProviderFullscreen(true);
  });
  wc.on("leave-html-full-screen", () => {
    const win = mainWindow;
    fsLog("wc leave-html-full-screen fired");
    if (!win || win.isDestroyed()) return;
    handleProviderFullscreen(false);
  });

  wc.once("destroyed", () => {
    providerViewAttached = false;
    providerViewGuard = null;
    providerViewSecurityAttached = false;
  });

  providerViewSecurityAttached = true;
  console.log(
    `[Main] Provider WebContentsView created (wc ${wc.id}), security attached`,
  );
  return view;
}

/** Load a provider embed URL into the persistent view (lazy-creates it). */
function openProviderView(embedUrl: string): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  // Clear session storage between provider switches to prevent residual state
  // (cookies, auth tokens, ad-tracking state) from the previous provider from
  // persisting into the new provider's session. This prevents: auth failures,
  // cross-provider tracking, and memory leaks from accumulated DOM tokens.
  void clearProviderStorage();

  // Set the URL FIRST so ensureProviderView() (which reads providerViewUrl for
  // the initial nav-guard config) sees the real embed URL even on first create.
  providerViewUrl = embedUrl;

  const view = ensureProviderView();
  if (!view) return;

  // Re-point the nav guard for this provider (URL/hosts/redirect policy).
  const providerId = getCurrentBlockingProviderId();
  const {
    getProviderBlockHomePaths,
    getUniversalBlockPaths,
    getAllowServerRedirects,
  } = require("./security/provider-config");
  const allowed = computeProviderAllowedDomains(providerId, embedUrl);
  providerViewGuard?.updateConfig({
    providerUrl: embedUrl,
    requestedEmbedUrl: embedUrl,
    blockHomePaths: getProviderBlockHomePaths(providerId ?? ""),
    universalBlockPaths: getUniversalBlockPaths(),
    allowServerRedirects: getAllowServerRedirects(providerId ?? ""),
    additionalAllowedHosts: Array.from(allowed),
    onBlocked: (type, url) =>
      console.warn(`[NavGuard] Blocked ${type}: ${url.slice(0, 120)}`),
    onEscaped: (count, url) => {
      if (mainWindow?.isDestroyed()) return;
      mainWindow?.webContents.send("provider:escape-blocked", { url, count });
    },
  });

  resetPlayerState();
  sendPlayerState({ loading: true });
  // Do NOT force the view visible here — the renderer drives visibility via
  // player:set-visible (overlay-aware). The native view draws over ALL DOM, so
  // force-showing it would cover a React overlay (loading/error/CPU warning/
  // server dropdown) that must win. The view keeps its current visibility;
  // DesktopSecureWebview shows it when no overlay is active.
  view.webContents.loadURL(embedUrl).catch((err) => {
    console.warn(`[Main] player:open loadURL failed:`, err);
    sendPlayerState({ error: String(err?.message ?? err) });
  });
}

/** Hide + detach the view (reusable; webContents survives for reuse). */
function closeProviderView(): void {
  if (!providerView || !mainWindow) return;
  // Exit fullscreen if active — a hidden view has no business keeping the
  // window in fullscreen mode (e.g., user hits Escape to close overlay).
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  try {
    if (providerViewAttached)
      mainWindow.contentView.removeChildView(providerView);
  } catch {
    /* view not attached */
  }
  providerViewAttached = false;
  providerViewVisible = false;
  resetPlayerState();
}

/**
 * Position the view over the renderer's black rect (integers required).
 * Skips while the window is fullscreen — during fullscreen main owns the bounds
 * (providerViewFitToContent fills the whole content area), so a stray renderer
 * push would shrink the view back to the letterboxed rect. Use
 * setProviderViewBounds to force-apply during fullscreen.
 */
function setProviderBounds(rect: Electron.Rectangle): void {
  const win = mainWindow;
  fsLog(
    "setProviderBounds",
    JSON.stringify(rect),
    "IGNORED=" + !!(isProviderFullscreen || (win && win.isFullScreen())),
  );
  // Ignore renderer bounds pushes while fullscreen — during fullscreen MAIN owns
  // the view bounds (it fills the content area), so a stray renderer push (its
  // ResizeObserver still fires on window resize, but its isFullscreen flag lags
  // the state push by a tick) would shrink the view back to the letterboxed rect
  // ~16ms after we expand it. This is the race the provider-fullscreen bridge
  // exists to prevent. See handleProviderFullscreen().
  if (isProviderFullscreen || (win && win.isFullScreen())) return;
  lastKnownRendererBounds = rect;
  setProviderViewBounds(rect);
}

/** Raw bounds writer — no fullscreen guard. Used by the fullscreen fill path. */
function setProviderViewBounds(rect: Electron.Rectangle): void {
  providerViewBounds = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  providerView?.setBounds(providerViewBounds);
}

/** Clear session storage (cookies, localStorage, IndexedDB, cache) between provider switches.
 *  This prevents residual state from the previous provider (cookies, auth tokens,
 *  residual ad-tracking state) from persisting into the new provider's session,
 *  which can cause: auth failures, cross-provider tracking, and memory leaks from
 *  accumulated DOM tokens. Called at the start of openProviderView() before the
 *  new URL loads. */
async function clearProviderStorage(): Promise<void> {
  if (!providerView || !providerView.webContents) return;
  try {
    await providerView.webContents.session.clearStorageData();
    await providerView.webContents.session.clearCache();
    console.log(
      "[Main] Session storage cleared between provider switches (provider: " +
        getCurrentBlockingProviderId() +
        ")",
    );
  } catch (err) {
    // Best-effort — if the view isn't attached yet, skip.
    console.warn("[Main] Failed to clear session storage:", err);
  }
}

/**
 * Show/hide the view. The renderer hides it whenever a React overlay (loading,
 * error, CPU warning, server dropdown) must render above the rect — the native
 * view draws over the entire DOM, so hiding is the only way an overlay wins the
 * z-order. When fully hidden we also removeChildView so it never captures input.
 */
function setProviderVisible(visible: boolean): void {
  providerViewVisible = visible;
  if (!providerView || !mainWindow) return;
  if (visible) {
    if (!providerViewAttached) {
      mainWindow.contentView.addChildView(providerView);
      providerViewAttached = true;
      // Re-apply the last-known bounds: setBounds on a DETACHED view is a no-op
      // (the renderer keeps calling player:set-bounds while hidden via the
      // ResizeObserver), so the bounds must be re-applied once the view is back
      // in the contentView or it would appear at stale/zero size.
      providerView.setBounds(providerViewBounds);
    }
    providerView.setVisible(true);
  } else {
    providerView.setVisible(false);
    if (providerViewAttached) {
      try {
        mainWindow.contentView.removeChildView(providerView);
      } catch {
        /* view not attached */
      }
      providerViewAttached = false;
    }
  }
}

/**
 * Fullscreen the whole window (the view fills the content area). Electron has
 * no view-only fullscreen; we fullscreen the frameless window and re-apply
 * bounds on enter/leave-full-screen (see registerProviderViewWindowHandlers).
 */
function setProviderFullscreen(fullscreen: boolean): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() !== fullscreen) {
    win.setFullScreen(fullscreen);
    // enter-full-screen / leave-full-screen events push the state to the
    // renderer (they also re-apply the view bounds). macOS fullscreen is
    // async — the event is the authoritative signal.
  } else {
    sendPlayerFullscreenState();
  }
}

/**
 * Authoritative fullscreen trigger for the PROVIDER's own in-page player button.
 * The provider embed lives in a native WebContentsView; its own player calls
 * <video>.requestFullscreen() (or a CSS "fake fullscreen" that ends up calling
 * it). Our session preload overrides Element.prototype.requestFullscreen and
 * sends `provider:requestFullscreen` (true/false) here instead of calling the
 * native API — so we own the transition. Main fullscreens the frameless window
 * and fills the view; the renderer (which sizes its black rect to the view) then
 * shows its own chrome via player:state. Crucially, we set isProviderFullscreen
 * BEFORE expanding, so the renderer's ResizeObserver (which still fires on the
 * window resize but whose isFullscreen flag lags a tick) cannot shrink the view
 * back to its small rect. This is the race the bridge exists to prevent.
 */
function handleProviderFullscreen(fullscreen: boolean): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  fsLog(
    "handleProviderFullscreen",
    fullscreen,
    "winIsFull=" + win.isFullScreen(),
  );
  isProviderFullscreen = fullscreen;
  winFullscreenState = fullscreen;
  if (win.isFullScreen() !== fullscreen) {
    // Native state disagrees with target — let setFullScreen drive the
    // enter-/leave-full-screen events, which fill/restore the view + push state.
    win.setFullScreen(fullscreen);
  } else if (fullscreen) {
    // Already fullscreen (e.g. re-trigger) — fill immediately.
    fillProviderView();
    sendPlayerFullscreenState();
  } else {
    restoreProviderView();
    sendPlayerFullscreenState();
  }
}

/** Fill the view to the whole content area (content-relative bounds). */
function fillProviderView(): void {
  const win = mainWindow;
  if (!providerView || !win || win.isDestroyed()) return;
  // In fullscreen the window covers the ENTIRE display (including the region
  // the Windows taskbar normally occupies). Fill to the full display SIZE, NOT
  // workAreaSize — workAreaSize permanently excludes the taskbar (≈5% gap at
  // the bottom), and does not grow when a window fullscreens.
  const disp = screen.getDisplayMatching(win.getBounds());
  const { width, height } = disp.size;
  setProviderViewBounds({ x: 0, y: 0, width, height });
}

/** Restore the last renderer-driven rect after leaving fullscreen. */
function restoreProviderView(): void {
  if (providerView && providerViewAttached) {
    providerView.setBounds(lastKnownRendererBounds);
  }
}

/**
 * Fill the view to the whole window — used ONLY on fullscreen transitions. In
 * normal (windowed) mode the RENDERER owns the bounds: it measures its player
 * rect via ResizeObserver and pushes player:set-bounds continuously, including
 * on window resize. Filling the content bounds here outside fullscreen would
 * overwrite the rect bounds and expand the native view over the entire page
 * (covering the server pill/dropdown and every other control) — the bug that
 * hid the server selector beneath the webview.
 *
 * A WebContentsView lives inside contentView, so its bounds are RELATIVE TO THE
 * CONTENT ORIGIN (0,0 = top-left of the window's content area), NOT screen
 * coordinates. Passing getContentBounds() (screen coords) would fling the view
 * off-screen. We therefore fill {0,0,width,height} of the content area. This is
 * the ONLY writer that must bypass setProviderBounds' fullscreen early-return —
 * that guard exists so renderer pushes during fullscreen don't shrink the view
 * back to the letterboxed rect; here we are the fullscreen owner and must expand
 * it. Use setProviderViewBounds directly.
 */
function providerViewFitToContent(): void {
  const win = mainWindow;
  if (!providerView || !win || win.isDestroyed()) return;
  if (!win.isFullScreen()) return; // renderer owns bounds outside fullscreen
  const cb = win.getContentBounds();
  setProviderViewBounds({
    x: 0,
    y: 0,
    width: cb.width,
    height: cb.height,
  });
}

/** Register the player:* IPC handlers (WebContentsView hybrid). */
function registerPlayerViewIPC(): void {
  ipcMain.handle("player:open", (_e, embedUrl: string) => {
    openProviderView(String(embedUrl ?? ""));
    return { success: true };
  });
  ipcMain.handle("player:close", () => {
    closeProviderView();
    return { success: true };
  });
  let boundsDebounceTimeout: NodeJS.Timeout | null = null;

  ipcMain.handle("player:set-bounds", (_e, rect: Electron.Rectangle) => {
    fsLog("player:set-bounds IPC received", JSON.stringify(rect));
    if (boundsDebounceTimeout) clearTimeout(boundsDebounceTimeout);
    boundsDebounceTimeout = setTimeout(() => {
      setProviderBounds(rect ?? { x: 0, y: 0, width: 0, height: 0 });
      boundsDebounceTimeout = null;
    }, 16); // ~60fps throttling — prevents IPC thrash on window drag/resize
    return { success: true };
  });
  ipcMain.handle("player:set-visible", (_e, visible: boolean) => {
    setProviderVisible(!!visible);
    return { success: true };
  });
  ipcMain.handle("player:fullscreen", (_e, fullscreen: boolean) => {
    setProviderFullscreen(!!fullscreen);
    return { success: true };
  });
  // ── Provider's OWN fullscreen button bridge ──
  // The session preload overrides Element.prototype.requestFullscreen in the
  // provider page and sends these instead of calling the native API. This is the
  // AUTHORITATIVE trigger (works for both real Fullscreen API and "fake
  // fullscreen" players that never fire enter-html-full-screen). The renderer
  // has NO window.electronAPI in the provider page, so the preload uses raw
  // ipcRenderer.send — these must be ipcMain.on (fire-and-forget), not handle.
  ipcMain.on("provider:requestFullscreen", () => {
    handleProviderFullscreen(true);
  });
  ipcMain.on("provider:exitFullscreen", () => {
    handleProviderFullscreen(false);
  });
  ipcMain.handle("player:reload", () => {
    if (providerView && !providerView.webContents.isDestroyed()) {
      providerView.webContents.reload();
    }
    return { success: true };
  });
  ipcMain.handle("player:get-webcontents-id", () => {
    return providerView?.webContents.id ?? -1;
  });
  ipcMain.handle("player:seek", (_e, seconds: number) => {
    const t = Number(seconds);
    if (
      Number.isFinite(t) &&
      t >= 0 &&
      providerView &&
      !providerView.webContents.isDestroyed()
    ) {
      // Targeted seek: route to the content frame only (recorded from the
      // last qualified sample) so an ad pre-roll in another frame is never
      // seeked. Fall back to a broadcast if no frame has been qualified yet
      // (e.g. very first seek before any sample) — normally the invariant
      // holds because the recorder only requests a seek after qualifying.
      const wc = providerView.webContents;
      if (lastContentFrame) {
        try {
          wc.sendToFrame(
            [lastContentFrame.processId, lastContentFrame.frameId],
            "provider:seek",
            t,
          );
          return { success: true };
        } catch {
          // frame gone (navigated) — fall through to broadcast
        }
      }
      wc.send("provider:seek", t);
    }
    return { success: true };
  });

  // ── Playback progress relay (watch-history writes) ──
  // The session preload (provider-preload.ts §0.6) samples <video>/<audio>
  // elements in every provider frame at ~1Hz and reports here. Forward the
  // latest sample to the app renderer, where WatchClient's recorder persists
  // watch progress. Payload is validated/coerced — it originates from a
  // sandboxed preload, but only well-formed, in-bounds samples are worth
  // relaying. We also *qualify* each sample: a sample only counts as
  // authoritative content (and only then records the content frame for
  // targeted seeks) if its media host is a trusted video CDN or a confident
  // MSE blob, so ads in sibling frames are never seeked (expert verdict Q3).
  ipcMain.on(
    "provider:playback",
    (
      event,
      sample: {
        currentTime?: unknown;
        duration?: unknown;
        paused?: unknown;
        readyState?: unknown;
        srcHost?: unknown;
        recentUserSeek?: unknown;
      },
    ) => {
      const currentTime = Number(sample?.currentTime);
      const duration = Number(sample?.duration);
      if (!Number.isFinite(currentTime) || !Number.isFinite(duration)) return;
      // Sanity bounds (verdict Q11): reject garbage / tampered samples.
      if (!(duration > 0 && duration < 86400)) return;
      if (!(currentTime >= 0 && currentTime <= duration + 5)) return;

      const paused = !!sample?.paused;
      const readyState = Number(sample?.readyState);
      const srcHost = typeof sample?.srcHost === "string" ? sample.srcHost : "";
      const recentUserSeek = !!sample?.recentUserSeek;

      // Qualify the source host against R0 MIME-trust. Trusted = exact or
      // suffix match on a host the session saw serve video. Fallback-confidence
      // for MSE blob players that expose no resolvable host.
      let qualified = false;
      const trustMgr = currentProviderSession
        ? getTrustManager(currentProviderSession)
        : undefined;
      const trusted = trustMgr?.getTrustedHosts().map((e) => e.hostname);
      if (trusted && trusted.length > 0) {
        qualified = trusted.some(
          (h) => srcHost === h || srcHost.endsWith("." + h),
        );
      }
      if (!qualified && srcHost === "blob" && !paused && duration >= 240) {
        qualified = true; // MSE player: no host, but long-form & playing
      }

      // Record the authoritative content frame for targeted resume seeks.
      if (
        qualified &&
        typeof event.processId === "number" &&
        typeof event.frameId === "number"
      ) {
        lastContentFrame = {
          processId: event.processId,
          frameId: event.frameId,
        };
      }

      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("player:progress", {
        currentTime,
        duration,
        paused,
        readyState,
        srcHost,
        recentUserSeek,
        qualified,
      });
    },
  );
}

// ── Provider Session IPC (inline webview) ──────────────────────────

/**
 * Register IPC handlers for managing provider sessions used by
 * inline <webview> elements in the main window.
 *
 * Replaces the old separate video window approach — now the provider
 * embed loads directly in a webview inside the watch page. The session
 * has full R0-R8 network filtering, session trust, and security headers.
 */
function registerProviderSessionIPC(): void {
  // Initialize a provider session with R0-R8 filtering
  ipcMain.handle(
    "provider:init",
    (_event, params: { providerId: string; embedUrl: string }) => {
      const { providerId, embedUrl } = params;

      console.log(`[Main] Initializing provider session: ${providerId}`);

      // CRITICAL: Do NOT clear the session on every provider switch.
      // createProviderSession is now idempotent — it reuses the existing
      // session and trust manager. Clearing the session would wipe
      // accumulated session trust, causing CDN hosts to be re-filtered
      // and potentially blocked until video content is served again.

      // Update the mutable provider ID so the onBeforeRequest handler
      // (which was installed at startup with a closure referencing the
      // module-level _currentBlockingProviderId) applies per-provider rules.
      //
      // L3 security headers (CSP) are already installed at app startup inside
      // createProviderSession() — the webview may attach and navigate before
      // this async IPC resolves, so we cannot rely on this handler for that.
      const session = createProviderSession(providerId);
      setBlockingProviderId(providerId);

      currentProviderSession = session;
      currentProviderId = providerId;

      // Feed the embed URL host into the provider's R1/R3 allowlist (NOT R0
      // trust) in case it wasn't in blocklist.json. R0 stays reserved for hosts
      // that have actually served verified video this session (V4 step 2).
      try {
        const embedHost = new URL(embedUrl).hostname;
        const {
          addProviderAllowlistDomains,
        } = require("./security/provider-config");
        addProviderAllowlistDomains(providerId, [embedHost]);
        console.log(`[Main] Allowlisted embed host (R1/R3): ${embedHost}`);
      } catch {}

      // Pre-seed the startup-built domain set into the R1/R2 allowlists
      // (NOT R0 trust — R0 starts empty, earned only by serving video).
      if (preSeededCdnDomains.size > 0) {
        try {
          preSeedProviderAllowlists(preSeededCdnDomains);
        } catch {}
      }

      return { success: true };
    },
  );

  // Clear the provider session
  ipcMain.handle("provider:clear", async () => {
    if (currentProviderSession) {
      await clearProviderSession(currentProviderSession);
      currentProviderSession = null;
      currentProviderId = null;
    }
    return { success: true };
  });

  // Get the main window's webContentsId so the renderer can use it
  ipcMain.handle("provider:getMainWebContentsId", () => {
    return mainWindow?.webContents.id ?? -1;
  });
}

/**
 * Collect all known provider CDN/embed domains from blocklist.json for the
 * R1/R2 allowlists. These are NOT R0 trust — the session trust manager (R0)
 * starts EMPTY and is populated only by runtime video detection
 * (checkResponseForTrust). Feeding R1/R2 means these domains still fall through
 * to R4/R5, so always-block domains in R5 are still blocked (V4 step 2 / V5).
 *
 * Called once at app startup and also when a provider session is initialized.
 */
function preSeedTrustForProviderSessions(): { cdnDomains: Set<string> } {
  try {
    const { loadBlocklistConfig } = require("./security/provider-config");
    const config = loadBlocklistConfig();
    if (!config?.providers) return { cdnDomains: new Set<string>() };

    // Collect all CDN domains across all providers
    const allCdnDomains = new Set<string>();
    for (const provider of config.providers) {
      if (provider.enabled !== false) {
        if (provider.embedDomains) {
          provider.embedDomains.forEach((d: string) =>
            allCdnDomains.add(d.toLowerCase()),
          );
        }
        if (provider.cdnDomains) {
          provider.cdnDomains.forEach((d: string) =>
            allCdnDomains.add(d.toLowerCase()),
          );
        }
      }
    }

    // Also add global CDN allowlist
    if (config.allowedCdnHosts) {
      config.allowedCdnHosts.forEach((d: string) =>
        allCdnDomains.add(d.toLowerCase()),
      );
    }

    console.log(
      `[Main] Collected ${allCdnDomains.size} CDN/embed domains for R1/R2 allowlists:`,
      Array.from(allCdnDomains).slice(0, 5).join(", ") +
        (allCdnDomains.size > 5 ? ", ..." : ""),
    );

    return { cdnDomains: allCdnDomains };
  } catch (err) {
    console.error("[Main] Failed to collect allowlist domains:", err);
    return { cdnDomains: new Set<string>() };
  }
}

// ── Next.js Server (Production) ──

/**
 * Find a free localhost port for the Next.js server.
 *
 * Binds a temporary server to port 0 (OS assigns any free port), reads the
 * actual port, then closes it. The tiny race window (another process grabbing
 * the port between close and spawn) is handled because the Next.js server
 * fails loudly on EADDRINUSE — never hang, and the app's webRequest has no
 * dependency on this port.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start the Next.js standalone server on a FREE localhost port and load the
 * app. Picking a free port avoids clashing with whatever else the user runs
 * on 3000 (another dev server, Docker, etc.) — a hardcoded port would fail
 * with EADDRINUSE and leave the window blank.
 */
async function startNextServer(): Promise<void> {
  console.log("[Main] Starting Next.js production server...");

  // The standalone output bundles the server at `server.js` inside WEB_APP_DIR.
  // We run it directly with Node, passing the port via env.
  const serverScript = join(WEB_APP_DIR, "server.js");
  let port = 3000;

  try {
    port = await findFreePort();
  } catch (err) {
    // Fall back to 3000 — spawn will fail loudly if it's taken; the error
    // handler below surfaces it instead of silently blanking.
    console.warn("[Main] Free-port probe failed, using 3000:", err);
  }
  nextServerPort = port;

  console.log(`[Main] Spawning Next.js server on localhost:${port}`);

  nextServerProcess = spawn("node", [serverScript], {
    cwd: WEB_APP_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  nextServerProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString();
    console.log(`[NextServer] ${msg}`);
    // Next.js prints "Local: http://127.0.0.1:<port>" / "Ready" once the
    // standalone server is listening. Match both the localhost and 127.0.0.1
    // forms (the server binds 127.0.0.1 via HOSTNAME) plus the legacy
    // "started" string. Without the 127.0.0.1 match, readiness is never
    // detected and the window stays on the background color forever.
    if (
      msg.includes("started") ||
      msg.includes("localhost:") ||
      msg.includes("127.0.0.1:")
    ) {
      // Server is ready — load the app on the ACTUAL bound address/port.
      // Use 127.0.0.1 to exactly match what the server binds to.
      mainWindow?.loadURL(`http://127.0.0.1:${nextServerPort}`);
    }
  });

  nextServerProcess.stderr?.on("data", (data: Buffer) => {
    console.error(`[NextServer Error] ${data.toString()}`);
  });

  nextServerProcess.on("error", (err) => {
    console.error("[Main] Failed to start Next.js server:", err);
  });

  nextServerProcess.on("exit", (code) => {
    console.log(`[NextServer] Exited with code ${code}`);
    nextServerProcess = null;
  });
}

// ── App Lifecycle ──

app.whenReady().then(() => {
  // ── Pre-warm @ghostery/adblocker (adblock-rs WASM) ──────────────────────
  // The compiled-engine.bin (~7MB) deserializes asynchronously. Doing this
  // during appReady (instead of on first provider click) means the engine is
  // warm in memory before the user can trigger a provider load, eliminating
  // the ~50-200ms cold-start freeze that would otherwise block UI responsiveness.
  // The engine singleton is stored globally so all R4 handlers share one warm
  // instance instead of deserializing separately.
  try {
    const { deserialize } = require("@ghostery/adblocker");
    const { readFileSync } = require("fs");
    const { join } = require("path");
    const enginePath = join(__dirname, "..", "build", "compiled-engine.bin");
    const engineBuffer = readFileSync(enginePath);
    (async () => {
      const engine = await deserialize(engineBuffer);
      // Store on globalThis so the renderer and main R4 handlers share it.
      // The engine is idempotent — deserialize is safe to call once.
      (globalThis as Record<string, unknown>)["filmsnapsFiltersEngine"] =
        engine;
      console.log(
        "[Main] @ghostery/adblocker WASM engine pre-warmed (deserialized, " +
          (engine ? "ready" : "null") +
          ")",
      );
    })();
  } catch (err) {
    console.warn(
      "[Main] @ghostery/adblocker pre-warm failed (continuing without it):",
      err,
    );
  }

  // Kick off the filter-engine load BEFORE creating the main window so the
  // 7MB engine deserializes in parallel with window setup instead of blocking
  // the event loop for ~50-200ms. R4's onBeforeRequest awaits this same
  // promise, so no provider request can bypass the engine even if it resolves
  // after the first webview navigates.
  const { initFilterEngine } = require("./security/filter-engine");
  initFilterEngine().then((engine: any) => {
    if (engine) {
      console.log("[Main] Filter engine loaded (async) — R4 ready");
    } else {
      console.warn("[Main] Filter engine not available — R4 fallback disabled");
    }
  });

  createMainWindow();
  // Phase 2 — Media Download Manager: intercept provider-session downloads
  // (will-download) and expose pause/resume/cancel + progress to the renderer.
  initDownloadManager(() => mainWindow);
  // Download sources — hidden nxsha scraper + falix detail proxy
  // (nxsha/falix media pages in the web app drive these over IPC).
  initMediaSources(() => mainWindow);
  initUpdater();

  // macOS: re-create window when dock icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Clean up on quit
app.on("before-quit", () => {
  // Kill the Next.js server if running
  if (nextServerProcess) {
    nextServerProcess.kill();
    nextServerProcess = null;
  }
});
