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
  ipcMain,
  shell,
  webContents,
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
} from "./security/request-filter";
import { applyNavigationGuard } from "./security/navigation-guard";
import {
  attachProviderSecurity,
  computeProviderAllowedDomains,
  verifyPreloadInFrames,
} from "./security/provider-security";
import { registerCosmeticFilterIPC } from "./security/cosmetic-filter";

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
      webviewTag: true, // Enable <webview> tag for inline provider playback
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

  // Register provider session IPC handlers (inline webview)
  registerProviderSessionIPC();

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

  // Save window state on changes + push maximize state to the renderer
  // so the custom title bar can swap its maximize/restore icon live.
  mainWindow.on("resize", () => saveWindowState(mainWindow!));
  mainWindow.on("move", () => saveWindowState(mainWindow!));
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

  // ── Webview security: partition lockdown + nav guard + CDP VERIFICATION ──
  // The provider <webview> is the only guest this app mounts. We validate its
  // partition, harden its webPreferences, and attach the main-process navigation
  // guard (L4). The PRIMARY in-page protection (L5/L6 — protection script +
  // cosmetic CSS at document-start in every frame) is delivered by the SESSION-
  // LEVEL PRELOAD (session.setPreloads in request-filter.ts), which survives
  // cross-site navigations that CDP cannot. CDP here is verification-only.
  // NOTE: single live webview assumption — a pending-embed slot is sufficient today.
  let pendingEmbedUrl: string | null = null;

  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      // 1. Partition validation — ONLY the provider partition is allowed.
      if ((params.partition ?? "") !== "persist:filmsnaps-provider") {
        console.warn(
          `[Main] Rejected webview with non-provider partition: ${params.partition}`,
        );
        event.preventDefault();
        return;
      }

      // 2. Lockdown webPreferences (main-process enforced, cannot be overridden
      //    by renderer-provided webpreferences).
      //
      // contextIsolation:false + nodeIntegrationInSubFrames:true are REQUIRED for
      // the session-level provider preload (set via session.setPreloads) to run in
      // the page's MAIN WORLD at document-start in EVERY frame (main + OOPIF), so
      // its prototype overrides (canvas/WebGL spoofing, worker/sendBeacon blocking)
      // take effect. This is safe because sandbox:true strips Node APIs from the
      // preload scope — the page never gains require/process access.
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = false; // preload must share the main world
      webPreferences.sandbox = true; // Node APIs still stripped
      webPreferences.webSecurity = true;
      webPreferences.nodeIntegrationInSubFrames = true; // preload in every OOPIF
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      // NOTE: no webPreferences.allowPopups — popups are denied by the nav guard's
      // setWindowOpenHandler (L4) + the renderer's new-window preventDefault. The
      // webview element must NOT carry the allowpopups attribute (its mere presence
      // enables popups even when false).
      // Do NOT set webPreferences.preload here — the session-level preload
      // already covers it; setting both can cause double-execution.
      delete (webPreferences as any).preload;
      delete (webPreferences as any).additionalArguments;

      // 3. Capture the embed URL for did-attach-webview (guest webContents is
      //    not available until attach completes).
      pendingEmbedUrl = params.src ?? null;
    },
  );

  // 50ms debounce: React's hydration double-mount briefly creates two webview
  // elements (one is destroyed) — wait for the dust to settle so L4/L7 attach to
  // the surviving guest instead of one that dies 50ms later. Harmless delay: the
  // session preload (L5/L6) runs at document-start regardless.
  let attachTimer: NodeJS.Timeout | null = null;
  mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
    if (attachTimer) clearTimeout(attachTimer);
    attachTimer = setTimeout(() => {
      if (guest.isDestroyed()) return;
      const providerId = getCurrentBlockingProviderId();
      const embedUrl = pendingEmbedUrl || guest.getURL();
      const allowed = computeProviderAllowedDomains(providerId, embedUrl);

      // AUDIT — surface renderer-side logs to main-process stdout so a
      // FILMSNAPS_AUDIT=1 run reveals what the protection bundle intercepted
      // and, critically (expert V5), when/how a stream dies BEFORE it reaches
      // onBeforeRequest / the ReqLog. The webview guest's console-message fires
      // here in main with the page's console lines.
      if (process.env.FILMSNAPS_AUDIT === "1") {
        // `guest` here IS the guest WebContents (Electron's did-attach-webview
        // hands us the guest's webContents directly).
        // Electron 42: pass the console-message args via the Event object
        // (the positional-args form is deprecated).
        guest.on(
          "console-message",
          (_e: unknown, level: number, message: string) => {
            if (
              message.includes("[PROTECTION]") ||
              message.includes("[STREAM-AUDIT]")
            ) {
              console.log(`[Webview console][lvl${level}] ${message}`);
            }
          },
        );
      }

      // L4 — main-process navigation/popup/redirect guard. Includes the
      // path-level home-page escape guard (provider error-UI "Go Home" →
      // provider.com/, which host-level checks can't catch). Config comes from
      // blocklist.json (navigationGuard.universalBlockPaths + providers[].blockHomePaths).
      const {
        getProviderBlockHomePaths,
        getUniversalBlockPaths,
      } = require("./security/provider-config");
      const blockHomePaths = getProviderBlockHomePaths(providerId);
      const universalBlockPaths = getUniversalBlockPaths();
      applyNavigationGuard(guest, {
        providerUrl: embedUrl || "",
        requestedEmbedUrl: embedUrl || "",
        blockHomePaths,
        universalBlockPaths,
        additionalAllowedHosts: Array.from(allowed),
        onBlocked: (type, url) =>
          console.warn(`[NavGuard] Blocked ${type}: ${url.slice(0, 120)}`),
        // Escalate after the single auto-reload: tell the renderer to show the
        // source-unavailable / error UI (never the provider's home page).
        onEscaped: (count, url) => {
          if (mainWindow?.isDestroyed()) return;
          mainWindow?.webContents.send("provider:escape-blocked", {
            url,
            count,
          });
        },
      });

      // L7 — CDP verification layer: probes each live frame to confirm the
      // session preload (L5/L6) is active. Does NOT inject — the preload does.
      attachProviderSecurity(guest, { providerId, embedUrl });

      // L7b — FAIL-CLOSED per-frame protection verification (no CDP):
      // sweeps every committed frame for the preload guard sentinel, injects
      // the protection bundle into about:blank/srcdoc/blob/data frames (the
      // coverage holes both the session preload and L8 miss), and — if a
      // committed frame is unprotected — stops THAT frame only (never the
      // whole webview, which previously broke initial load). The user's
      // contract is "security must apply every time, no matter what" — a
      // brief error is preferable to a silent security failure.
      verifyPreloadInFrames(guest, {
        onFailClosed: (frameUrl) => {
          if (guest.isDestroyed()) return;
          console.warn(
            `[Main] FAIL-CLOSED: protection absent in ${frameUrl.slice(0, 120)} — frame stopped`,
          );
        },
      });
    }, 50);
  });

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
    mainWindow = null;
  });
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
