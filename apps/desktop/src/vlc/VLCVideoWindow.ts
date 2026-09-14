/**
 * VLCVideoWindow — Child window for mpv video output.
 *
 * Creates a frameless child BrowserWindow parented to the main app window.
 * mpv renders video into this window via --wid={hwnd}.
 *
 * The window carries NO web contents: any successfully-composited web frame
 * (even a fully transparent page) layers ABOVE mpv's child HWND and hides
 * the video entirely — proven empirically: video was visible while the
 * overlay URL failed to load, and vanished the moment a page loaded
 * successfully. We therefore swap the content view for an empty View right
 * after creation, leaving the window a pure native surface for mpv's child.
 *
 * thickFrame: false removes invisible resize borders (WS_THICKFRAME).
 */

import { BrowserWindow, View, type Rectangle } from "electron";
import { media as logVlc } from "../lib/log";
import { makeChildWindowsClickThrough } from "../lib/win32-clickthrough";

export class VLCVideoWindow {
  private window: BrowserWindow | null = null;
  private parentWindow: BrowserWindow;
  private lastLocal: Rectangle | null = null;
  private hasBeenShown = false;
  private isHidden = false;

  constructor(parentWindow: BrowserWindow) {
    this.parentWindow = parentWindow;
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
      // Transparent so parts of the window mpv hasn't painted (letterbox
      // bars during aspect negotiation, the pre-load moment) don't occlude
      // the app beneath. The web contents never submits frames here (empty
      // content view), so the transparency costs nothing.
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
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // CRITICAL: evict the window's web contents. A composited web frame —
    // even a 100% transparent page — renders above mpv's child HWND and
    // blanked the video (this exact regression shipped when the overlay URL
    // first loaded successfully). An empty View submits no frames, so the
    // window stays a pure native surface for mpv.
    this.window.contentView = new View();

    // Pure output surface: this window exists ONLY to host mpv's child HWND.
    // All player UI (controls, gestures, picker) lives in the MAIN window's
    // page — clicks and moves pass through this window to the main window
    // beneath, so the video behaves like an element of the app, not a
    // separate window. forward:true keeps hover/move events flowing to the
    // main window so its UI stays interactive.
    this.window.setIgnoreMouseEvents(true, { forward: true });

    this.window.webContents.on("render-process-gone", (_e, details) => {
      logVlc.error(`[videoWindow] renderer gone: ${details.reason}`);
    });

    logVlc.log(
      `[videoWindow] created at (${x},${y}) ${w}x${h} (no web contents)`,
    );
    return this.window;
  }

  /** Called on file-loaded / playback-restart. Makes mpv's child HWND
   *  click-through so mouse input reaches the main window beneath. */
  applyChildClickThrough(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const n = makeChildWindowsClickThrough(this.window.getNativeWindowHandle());
    logVlc.log(`[videoWindow] click-through applied to ${n} child window(s)`);
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
      logVlc.log(
        `[videoWindow] show() — visible=${this.window.isVisible()} bounds=${JSON.stringify(this.window.getBounds())}`,
      );
    }
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}
