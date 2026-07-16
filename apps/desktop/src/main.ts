/**
 * FilmSnaps Desktop — Main Process
 *
 * Entry point for the Electron application.
 * Creates the main BrowserWindow (Next.js web app UI) and manages
 * the application lifecycle.
 *
 * Key responsibilities:
 *   - Create and manage the main app window
 *   - Register IPC handlers (video:open/close, window controls)
 *   - Set up native app menu
 *   - Manage app lifecycle (macOS dock behavior, quit, etc.)
 *   - Spawn Next.js server in production mode
 *   - Persist window state
 */

import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import { join } from 'path';
import { ChildProcess, spawn } from 'child_process';
import { registerVideoWindowIPC } from './video/video-window';
import { loadWindowState, shouldStartMaximized, saveWindowState } from './lib/window-state';
import { initUpdater, quitAndInstall, checkForUpdates } from './updater';

// ── Constants ──

const IS_DEV = process.argv.includes('--dev');
const WEB_APP_DIR = IS_DEV
  ? join(__dirname, '../../apps/web')
  : join(process.resourcesPath, 'web', 'apps', 'web');
const DEV_SERVER_URL = 'http://localhost:3000';

/** Resolve path to an app resource (works in both dev and production) */
function resourcePath(...segments: string[]): string {
  if (IS_DEV) {
    return join(__dirname, '..', ...segments);
  }
  return join(process.resourcesPath, ...segments);
}

let mainWindow: BrowserWindow | null = null;
let nextServerProcess: ChildProcess | null = null;

// ── Main Window ──

function createMainWindow(): void {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    ...windowState,
    minWidth: 960,
    minHeight: 600,
    title: 'FilmSnaps',
    backgroundColor: '#070708',
    show: false,
    icon: resourcePath('resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // The main app needs Node.js for IPC; provider content uses sandbox
      webSecurity: true,
    },
  });

  // Restore maximized state
  if (shouldStartMaximized()) {
    mainWindow.maximize();
  }

  // Show window smoothly
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Set up IPC handlers for window controls
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  // Register video window IPC handlers
  registerVideoWindowIPC();

  // Register updater IPC handlers
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => quitAndInstall());

  // Save window state on changes
  mainWindow.on('resize', () => saveWindowState(mainWindow!));
  mainWindow.on('move', () => saveWindowState(mainWindow!));
  mainWindow.on('maximize', () => saveWindowState(mainWindow!));
  mainWindow.on('unmaximize', () => saveWindowState(mainWindow!));

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Handle external navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow same-origin navigation only
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  // Remove native menu bar — app uses its own header navigation
  Menu.setApplicationMenu(null);

  // Load the Next.js app
  if (IS_DEV) {
    // In dev mode, connect to the already-running Next.js dev server
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, spawn the Next.js server
    startNextServer();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Next.js Server (Production) ──

function startNextServer(): void {
  console.log('[Main] Starting Next.js production server...');

  // The standalone output bundles the server at `server.js` inside WEB_APP_DIR.
  // We run it directly with Node, passing the port via env.
  const serverScript = join(WEB_APP_DIR, 'server.js');

  nextServerProcess = spawn('node', [serverScript], {
    cwd: WEB_APP_DIR,
    env: {
      ...process.env,
      PORT: '3000',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  nextServerProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString();
    console.log(`[NextServer] ${msg}`);
    if (msg.includes('started') || msg.includes('localhost:')) {
      // Server is ready — load the app
      mainWindow?.loadURL(DEV_SERVER_URL);
    }
  });

  nextServerProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[NextServer Error] ${data.toString()}`);
  });

  nextServerProcess.on('error', (err) => {
    console.error('[Main] Failed to start Next.js server:', err);
  });

  nextServerProcess.on('exit', (code) => {
    console.log(`[NextServer] Exited with code ${code}`);
    nextServerProcess = null;
  });
}

// ── App Lifecycle ──

app.whenReady().then(() => {
  createMainWindow();
  initUpdater();

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on quit
app.on('before-quit', () => {
  // Kill the Next.js server if running
  if (nextServerProcess) {
    nextServerProcess.kill();
    nextServerProcess = null;
  }
});
