/**
 * VLCVideoWindow — Transparent child window for mpv video output.
 *
 * Creates a frameless, transparent BrowserWindow parented to the main app window.
 * mpv renders video into this window via --wid={hwnd}.
 *
 * The transparent page composes above mpv's child HWND (D3D11 surface),
 * allowing HTML controls to overlay the video. Input reaches the overlay
 * page because mpv's child HWND has WS_EX_TRANSPARENT (win32-clickthrough.ts).
 *
 * thickFrame: false removes invisible resize borders (WS_THICKFRAME).
 */

import { BrowserWindow, type Rectangle } from "electron";
import { media as logVlc } from "../lib/log";
import { makeChildWindowsClickThrough } from "../lib/win32-clickthrough";

export interface VideoWindowOptions {
  preload: string;
  overlayUrl: string;
}

export class VLCVideoWindow {
  private window: BrowserWindow | null = null;
  private parentWindow: BrowserWindow;
  private lastLocal: Rectangle | null = null;
  private hasBeenShown = false;
  private isHidden = false;
  private readonly opts: VideoWindowOptions;

  constructor(parentWindow: BrowserWindow, opts: VideoWindowOptions) {
    this.parentWindow = parentWindow;
    this.opts = opts;
  }

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    this.hasBeenShown = false;
    let x = 0,
      y = 0,
      w = 1280,
      h = 720;
    if (this.lastLocal) {
      const pc = this.parentWindow.getContentBounds();
      x = Math.round(pc.x + this.lastLocal.x);
      y = Math.round(pc.y + this.lastLocal.y);
      w = Math.max(1, Math.round(this.lastLocal.width));
      h = Math.max(1, Math.round(this.lastLocal.height));
    }

    this.window = new BrowserWindow({
      parent: this.parentWindow,
      frame: false,
      // Keep TRANSPARENT: setIgnoreMouseEvents (below) marks the window
      // WS_EX_LAYERED, and an opaque window never gets its layer attributes
      // configured — DWM then refuses to composite it entirely (audio plays,
      // no video). Transparent windows are the supported path for
      // click-through surfaces; the page behind mpv is empty anyway.
      transparent: true,
      thickFrame: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      // This window is a surface inside the app, not a standalone window —
      // it must never be user-resizable/maximized/fullscreened independently
      // of the main window (its bounds are driven by setVideoBounds IPC).
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      x,
      y,
      width: w,
      height: h,
      webPreferences: {
        preload: this.opts.preload,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.loadURL(this.opts.overlayUrl);

    // Pure output surface: this window exists ONLY to host mpv's child HWND.
    // All player UI (controls, gestures, picker) lives in the MAIN window's
    // page — clicks and moves pass through this window to the main window
    // beneath, so the video behaves like an element of the app, not a
    // separate window. forward:true keeps hover/move events flowing to the
    // main window so its UI stays interactive.
    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.webContents.on("did-fail-load", (_e, code, desc, url) => {
      logVlc.error(
        `[videoWindow] overlay failed to load (${code} ${desc}) url=${url}`,
      );
    });
    this.window.webContents.on("did-finish-load", () => {
      logVlc.log("[videoWindow] overlay page loaded");
    });
    // Overlay console messages were invisible in the main-process log, which
    // made renderer-side failures (dead bridge, adapter errors) undebuggable.
    this.window.webContents.on("console-message", (_e, level, message) => {
      const prefix = "[overlay]";
      if (level >= 2) logVlc.error(`${prefix} ${message}`);
      else logVlc.log(`${prefix} ${message}`);
    });
    this.window.webContents.on("render-process-gone", (_e, details) => {
      logVlc.error(`[videoWindow] overlay renderer gone: ${details.reason}`);
    });
    this.window.once("ready-to-show", () => {
      if (this.window && !this.window.isDestroyed() && this.lastLocal) {
        this.window.show();
        this.hasBeenShown = true;
        this.hasBeenShown = true;
      }
    });

    logVlc.log(`[videoWindow] created at (${x},${y}) ${w}x${h}`);
    return this.window;
  }

  /** Called on file-loaded / playback-restart. Makes mpv's child HWND
   *  click-through so the overlay page receives mouse input. */
  applyChildClickThrough(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const n = makeChildWindowsClickThrough(this.window.getNativeWindowHandle());
    logVlc.log(`[videoWindow] click-through applied to ${n} child window(s)`);
  }

  /** Forward mpv events to the overlay page. */
  sendEvent(payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("mpv:event", payload);
    }
  }

  getNativeHandle(): Buffer {
    if (!this.window || this.window.isDestroyed()) {
      throw new Error("Video window not created");
    }
    return this.window.getNativeWindowHandle();
  }

  updateBounds(local: Rectangle): void {
    this.lastLocal = local;
    if (
      !this.window ||
      this.window.isDestroyed() ||
      this.parentWindow.isDestroyed()
    )
      return;
    if (this.parentWindow.isMinimized()) return;
    // setBounds() on Windows implicitly un-minimizes — skip when hidden
    // so the renderer's hideVideo() isn't immediately undone.
    if (this.isHidden) return;

    const pc = this.parentWindow.getContentBounds();
    const screenBounds: Rectangle = {
      x: Math.round(pc.x + local.x),
      y: Math.round(pc.y + local.y),
      width: Math.max(1, Math.round(local.width)),
      height: Math.max(1, Math.round(local.height)),
    };

    this.window.setBounds(screenBounds);
    // Visibility is renderer-owned (mpv:hideVideo / mpv:showVideo). The
    // bounds observer fires continuously (window move/resize, layout
    // shifts, overlay sheets) — re-showing here would yank the native
    // video back above an open HTML overlay right after the renderer
    // hid it for that overlay. setBounds() on Windows implicitly
    // un-minimizes, so skip entirely when the renderer has hidden us.
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.isHidden = true;
      // Plain hide() — hides the window AND its children (the mpv HWND
      // is a child of this window, so the video surface goes away too).
      // Works now that updateBounds() no longer auto-shows: previously
      // every ResizeObserver setBounds() call re-showed the window right
      // after hideVideo(), which made hide() look broken.
      this.window.hide();
    }
  }

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.isHidden = false;
      this.window.show();
      // Re-apply bounds — show() may restore stale geometry.
      if (this.lastLocal) {
        const pc = this.parentWindow.getContentBounds();
        this.window.setBounds({
          x: Math.round(pc.x + this.lastLocal.x),
          y: Math.round(pc.y + this.lastLocal.y),
          width: Math.max(1, Math.round(this.lastLocal.width)),
          height: Math.max(1, Math.round(this.lastLocal.height)),
        });
      }
    }
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}
