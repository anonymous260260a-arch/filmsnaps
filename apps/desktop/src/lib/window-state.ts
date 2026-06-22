/**
 * FilmSnaps Desktop — Window State Persistence
 *
 * Saves and restores window position, size, and maximized state
 * using a simple JSON file in the app's userData directory.
 * No external dependencies needed.
 */

import { app, BrowserWindow, Rectangle, screen } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

let savedBounds: Rectangle | null = null;

function getStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadState(): WindowState | null {
  try {
    const statePath = getStatePath();
    if (!existsSync(statePath)) return null;
    const raw = readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as WindowState;
  } catch {
    return null;
  }
}

function saveState(state: WindowState): void {
  try {
    const statePath = getStatePath();
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[WindowState] Failed to save:', err);
  }
}

function saveRestoreBounds(bounds: Rectangle): void {
  savedBounds = { ...bounds };
}

function restoreBounds(): Rectangle {
  return savedBounds || { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

/**
 * Save the current window position and size to disk.
 */
export function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? restoreBounds() : win.getBounds();

  saveState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  });

  if (!isMaximized) {
    saveRestoreBounds(bounds);
  }
}

/**
 * Load saved window state, with display bounds validation.
 * Returns a config object to pass to BrowserWindow.
 */
export function loadWindowState(): Partial<Electron.BrowserWindowConstructorOptions> {
  const saved = loadState();

  if (!saved) {
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      center: true,
    };
  }

  // Validate against current display
  const displayBounds = screen.getPrimaryDisplay().workArea;

  // Ensure the window is visible on the current display
  const x = saved.x !== undefined
    ? Math.max(displayBounds.x, Math.min(saved.x, displayBounds.x + displayBounds.width - 200))
    : undefined;
  const y = saved.y !== undefined
    ? Math.max(displayBounds.y, Math.min(saved.y, displayBounds.y + displayBounds.height - 200))
    : undefined;
  const width = Math.min(saved.width, displayBounds.width);
  const height = Math.min(saved.height, displayBounds.height);

  // Save these bounds for restore
  if (x !== undefined && y !== undefined) {
    saveRestoreBounds({ x, y, width, height });
  }

  return {
    x,
    y,
    width,
    height,
  };
}

/**
 * Check if the window should start maximized.
 */
export function shouldStartMaximized(): boolean {
  return loadState()?.isMaximized ?? false;
}
