/**
 * registerMpvIPC — Registers IPC handlers for the mpv engine.
 *
 * Replaces registerVLCIPC. Same pattern (Electron IPC ↔ main process)
 * but uses MpvManager (JSON IPC over named pipe) instead of VLCManager (HTTP).
 * Renderer receives real-time mpv events via `mpv:event` channel — no 1Hz polling.
 *
 * Reuses VLCVideoWindow (mpv-agnostic transparent child window).
 */

import { ipcMain, type BrowserWindow } from "electron";
import { MpvManager } from "./MpvManager";
import { VLCVideoWindow } from "../vlc/VLCVideoWindow";
import { media as logMpv } from "../lib/log";

let mpvManager: MpvManager | null = null;
let videoWindow: VLCVideoWindow | null = null;
let lastRendererBounds: {
  x: number;
  y: number;
  width: number;
  height: number;
} | null = null;

/** Forward mpv events to the renderer in real-time. */
function forwardMpvEvents(win: BrowserWindow): void {
  if (!mpvManager) return;

  mpvManager.on("event", (event: { type: string; value?: any; raw?: any }) => {
    if (!win.isDestroyed()) {
      win.webContents.send("mpv:event", event);
    }
  });

  mpvManager.on("exit", (code: number | null) => {
    if (!win.isDestroyed()) {
      win.webContents.send("mpv:event", { type: "exit", code });
    }
  });

  mpvManager.on("error", (msg: string) => {
    if (!win.isDestroyed()) {
      win.webContents.send("mpv:event", { type: "error", message: msg });
    }
  });
}

export function registerMpvIPC(mainWindow: BrowserWindow): void {
  // Keep video window aligned with parent window movement/resizing
  const syncWindowPosition = () => {
    if (lastRendererBounds && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) return;
      const parentContent = mainWindow.getContentBounds();
      if (parentContent.x < -10000 || parentContent.y < -10000) return;
      const screenX = parentContent.x + lastRendererBounds.x;
      const screenY = parentContent.y + lastRendererBounds.y;
      if (screenX < -1000 || screenY < -1000) return;

      videoWindow?.updateBounds(lastRendererBounds);
      mpvManager?.setGeometry(
        lastRendererBounds.width,
        lastRendererBounds.height,
        screenX,
        screenY,
      );
    }
  };

  mainWindow.on("move", syncWindowPosition);
  mainWindow.on("resize", syncWindowPosition);

  // ── Start mpv + create video window ──
  ipcMain.handle("mpv:start", async () => {
    logMpv.log("[mpv:start] Handler invoked");
    try {
      // Create/reuse video overlay window
      if (!videoWindow) {
        videoWindow = new VLCVideoWindow(mainWindow);
        logMpv.log("[mpv:start] Created VLCVideoWindow");
      }
      const childWin = videoWindow.create();

      // Wait for window to be visible (GPU context needs a valid DC)
      await new Promise<void>((resolve) => {
        if (childWin.isVisible()) {
          resolve();
        } else {
          childWin.once("ready-to-show", () => resolve());
          // Fallback timeout — show() may have already fired
          setTimeout(resolve, 500);
        }
      });

      const hwnd = videoWindow.getNativeHandle();
      logMpv.log(
        `[mpv:start] Video window ready, HWND buffer size=${hwnd.length}`,
      );

      // Start mpv process
      if (!mpvManager) {
        mpvManager = new MpvManager();
        forwardMpvEvents(mainWindow);
        logMpv.log("[mpv:start] MpvManager created, events forwarded");
      }
      await mpvManager.start(hwnd);
      logMpv.log("[mpv:start] mpv process started successfully");

      return { ready: true };
    } catch (err: any) {
      logMpv.error(`[mpv:start] Failed: ${err.message}`);
      return { ready: false, error: err.message };
    }
  });

  // ── Destroy mpv process ──
  ipcMain.handle("mpv:destroy", async () => {
    logMpv.log("[mpv:destroy] Destroying mpv process");
    lastRendererBounds = null;
    if (mpvManager) {
      await mpvManager.destroy();
      mpvManager = null;
    }
    if (videoWindow) {
      videoWindow.destroy();
      videoWindow = null;
    }
    return { success: true };
  });

  // ── Playback ──
  ipcMain.handle("mpv:play", async (_e, url: string) => {
    logMpv.log(`[mpv:play] URL: ${String(url ?? "").slice(0, 120)}`);
    if (!mpvManager) {
      logMpv.error("[mpv:play] mpv not started — call mpv:start first");
      return { success: false, error: "mpv not started" };
    }
    try {
      await mpvManager.play(url);
      logMpv.log("[mpv:play] Playback started");
      return { success: true };
    } catch (err: any) {
      logMpv.error(`[mpv:play] Failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("mpv:pause", async () => {
    try {
      await mpvManager?.pause();
    } catch {}
  });

  ipcMain.handle("mpv:resume", async () => {
    try {
      await mpvManager?.resume();
    } catch {}
  });

  ipcMain.handle("mpv:stop", async () => {
    try {
      await mpvManager?.stop();
    } catch {}
  });

  ipcMain.handle("mpv:seek", async (_e, seconds: number) => {
    try {
      await mpvManager?.seek(Number(seconds));
    } catch {}
  });

  ipcMain.handle("mpv:setVolume", async (_e, volume: number) => {
    try {
      await mpvManager?.setVolume(Number(volume));
    } catch {}
  });

  ipcMain.handle("mpv:setMuted", async (_e, muted: boolean) => {
    try {
      await mpvManager?.setMuted(!!muted);
    } catch {}
  });

  ipcMain.handle("mpv:setSpeed", async (_e, rate: number) => {
    try {
      await mpvManager?.setSpeed(Number(rate));
    } catch {}
  });

  // ── Fullscreen (window-level) ──
  ipcMain.handle("mpv:setFullscreen", async (_e, fullscreen: boolean) => {
    if (fullscreen) {
      mainWindow.setFullScreen(true);
    } else {
      mainWindow.setFullScreen(false);
    }
  });

  // ── State (async — for initial load only) ──
  ipcMain.handle("mpv:getState", async () => {
    if (!mpvManager) return null;
    return mpvManager.state;
  });

  // ── Track Selection ──
  ipcMain.handle("mpv:getAudioTracks", async () => {
    if (!mpvManager) return [];
    try {
      return await mpvManager.getAudioTracks();
    } catch {
      return [];
    }
  });

  ipcMain.handle("mpv:setAudioTrack", async (_e, trackId: number) => {
    try {
      await mpvManager?.setAudioTrack(Number(trackId));
    } catch {}
  });

  ipcMain.handle("mpv:getSubtitleTracks", async () => {
    if (!mpvManager) return [];
    try {
      return await mpvManager.getSubtitleTracks();
    } catch {
      return [];
    }
  });

  ipcMain.handle("mpv:setSubtitleTrack", async (_e, trackId: number) => {
    try {
      await mpvManager?.setSubtitleTrack(Number(trackId));
    } catch {}
  });

  // ── Video Window Bounds ──
  ipcMain.handle(
    "mpv:setVideoBounds",
    async (
      _e,
      bounds: { x: number; y: number; width: number; height: number },
    ) => {
      if (!mainWindow.isDestroyed() && mainWindow.isMinimized()) return;
      lastRendererBounds = bounds;
      if (videoWindow && !mainWindow.isDestroyed()) {
        const parentContent = mainWindow.getContentBounds();
        if (parentContent.x < -10000 || parentContent.y < -10000) return;
        const screenX = parentContent.x + bounds.x;
        const screenY = parentContent.y + bounds.y;
        if (screenX < -1000 || screenY < -1000) return;

        videoWindow.updateBounds(bounds);
        await mpvManager?.setGeometry(
          bounds.width,
          bounds.height,
          screenX,
          screenY,
        );
      }
    },
  );

  ipcMain.handle("mpv:hideVideo", async () => {
    videoWindow?.hide();
    await mpvManager?.hideWindow();
  });

  ipcMain.handle("mpv:showVideo", async () => {
    if (lastRendererBounds && videoWindow) {
      videoWindow.updateBounds(lastRendererBounds);
    }
    await mpvManager?.showWindow();
  });

  // Cleanup on window close
  mainWindow.on("closed", async () => {
    lastRendererBounds = null;
    if (mpvManager) {
      await mpvManager.destroy();
      mpvManager = null;
    }
    if (videoWindow) {
      videoWindow.destroy();
      videoWindow = null;
    }
  });
}
