/**
 * VLCVideoWindow — Opaque child window for mpv video output.
 *
 * Creates a borderless, opaque black BrowserWindow parented to the main app
 * window. mpv renders video into this window via --wid={hwnd}.
 * The renderer tracks the video zone position via ResizeObserver and pushes
 * bounds updates.
 *
 * IMPORTANT: Window must be shown and reasonably sized BEFORE passing its
 * HWND to mpv, otherwise GPU context initialization fails and mpv crashes.
 */

import { BrowserWindow, type Rectangle } from "electron";

export class VLCVideoWindow {
  private window: BrowserWindow | null = null;
  private parentWindow: BrowserWindow;

  constructor(parentWindow: BrowserWindow) {
    this.parentWindow = parentWindow;
  }

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    this.window = new BrowserWindow({
      parent: this.parentWindow,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
      width: 1280,
      height: 720,
      x: 0,
      y: 0,
    });

    this.window.loadURL(
      "data:text/html,<style>html,body{background:transparent;margin:0;padding:0;overflow:hidden;}</style>",
    );

    // Allow mouse events so mpv native OSC controls receive hover, click, and seek gestures
    this.window.once("ready-to-show", () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.setIgnoreMouseEvents(false);
        this.window.show();
      }
    });

    return this.window;
  }

  getNativeHandle(): Buffer {
    if (!this.window || this.window.isDestroyed()) {
      throw new Error("Video window not created");
    }
    return this.window.getNativeWindowHandle();
  }

  /**
   * Update video window bounds. Converts viewport-relative bounds (from renderer)
   * to absolute screen coordinates by adding parentWindow's content bounds.
   */
  updateBounds(bounds: Rectangle): void {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      this.parentWindow.isDestroyed()
    )
      return;
    if (this.parentWindow.isMinimized()) return;

    const parentContent = this.parentWindow.getContentBounds();
    if (parentContent.x < -10000 || parentContent.y < -10000) return;

    const screenX = Math.round(parentContent.x + bounds.x);
    const screenY = Math.round(parentContent.y + bounds.y);
    if (screenX < -1000 || screenY < -1000) return;

    const screenBounds: Rectangle = {
      x: screenX,
      y: screenY,
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };

    this.window.setBounds(screenBounds);
    if (!this.window.isVisible()) {
      this.window.show();
    }
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
  }
}
