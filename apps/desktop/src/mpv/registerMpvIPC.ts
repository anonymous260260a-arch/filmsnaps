/**
 * registerMpvIPC — Registers IPC handlers for the mpv engine.
 *
 * Architecture:
 * - Main window: React app (video region, poster, picker sheet, keyboard)
 * - Video window: transparent BrowserWindow with overlay page (controls, UI)
 * - mpv renders into the video window via --wid={hwnd}
 * - mpv's child HWND has WS_EX_TRANSPARENT → overlay page receives all input
 * - Events are fanned out to BOTH windows
 */

import { ipcMain, net as electronNet, type BrowserWindow } from "electron";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { MpvManager } from "./MpvManager";
import { VLCVideoWindow } from "../vlc/VLCVideoWindow";
import { media as logMpv } from "../lib/log";

// Overlay page URL — must be resolved LAZILY (not at module load): in dev the
// main window loads the Next.js dev server, and only packaged builds serve the
// static export on app://. Module-level resolution used to run before main.ts
// could set ELECTRON_DEV_URL, so dev silently pointed at the unserved app://
// scheme and the controls overlay never loaded.
function resolveOverlayUrl(): string {
  if (process.env.ELECTRON_DEV_URL) {
    return `${process.env.ELECTRON_DEV_URL}/mpv-overlay`;
  }
  if (process.argv.includes("--dev")) {
    return "http://localhost:3000/mpv-overlay";
  }
  return "app:///mpv-overlay";
}

let mpvManager: MpvManager | null = null;
let videoWindow: VLCVideoWindow | null = null;
let mainWin: BrowserWindow | null = null;
let lastRendererBounds: {
  x: number;
  y: number;
  width: number;
  height: number;
} | null = null;

/** Query mpv's video/audio output state and log it — answers definitively
 *  whether the VO initialized and what it attached to. */
async function logOutputState(tag: string): Promise<void> {
  if (!mpvManager) return;
  const props = [
    "current-vo",
    "vo-configured",
    "current-ao",
    "video-format",
    "video-params/w",
    "video-params/h",
    "container-fps",
    "video-bitrate",
    "audio-bitrate",
  ] as const;
  const results: Record<string, unknown> = {};
  await Promise.all(
    props.map(async (p) => {
      try {
        results[p] = await mpvManager!.getProperty(p);
      } catch {
        results[p] = "<unavailable>";
      }
    }),
  );
  logMpv.log(`[mpv-output:${tag}] ${JSON.stringify(results)}`);
}

/** Grep mpv's own debug log for vo/gpu/ao/error lines and log a summary. */
function logMpvLogSummary(tag: string): void {
  try {
    const candidates = [
      join(__dirname, "..", "..", "vendor", "mpv", "mpv-debug.log"),
      process.resourcesPath
        ? join(process.resourcesPath, "mpv", "mpv-debug.log")
        : "",
    ].filter(Boolean);
    const logPath = candidates.find((p) => existsSync(p));
    if (!logPath) {
      logMpv.warn(`[mpv-log:${tag}] mpv-debug.log not found`);
      return;
    }
    const size = statSync(logPath).size;
    const tailLen = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(tailLen);
    const fd = openSync(logPath, "r");
    readSync(fd, buf, 0, tailLen, size - tailLen);
    closeSync(fd);
    const text = buf.toString("utf8");
    const interesting = text
      .split("\n")
      .filter((l) =>
        /\[(vo|gpu|ao|d3d11|opengl|vd|ad)\]|error|fail|swapchain|device/i.test(
          l,
        ),
      )
      .slice(-40);
    logMpv.log(
      `[mpv-log:${tag}] ${logPath} — ${interesting.length} relevant lines (last 40):`,
    );
    for (const l of interesting) logMpv.log(`  ${l.trim().slice(0, 200)}`);
  } catch (err: any) {
    logMpv.warn(`[mpv-log:${tag}] failed to read mpv log: ${err.message}`);
  }
}

/** Forward mpv events to both windows and apply click-through. */
function fwd(ev: any): void {
  const raw = ev?.raw ?? ev;
  const type = raw?.event ?? ev?.event;

  // Apply WS_EX_TRANSPARENT on file-loaded / playback-restart (idempotent)
  if (type === "file-loaded" || type === "playback-restart") {
    videoWindow?.applyChildClickThrough();
  }

  // VO/AO diagnostics — once per file load and once 5s into playback
  if (type === "file-loaded") {
    logOutputState("file-loaded").catch(() => {});
    logMpvLogSummary("file-loaded");
  } else if (type === "playback-restart") {
    setTimeout(() => logOutputState("playback+5s").catch(() => {}), 5000);
  }

  // Fan out to BOTH windows
  videoWindow?.sendEvent(ev);
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send("mpv:event", ev);
  }
}

export function registerMpvIPC(mainWindow: BrowserWindow): void {
  mainWin = mainWindow;

  // Renderer console → main process log
  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      const prefix = "[renderer]";
      // Errors carry the source file + line — essential for diagnosing
      // SyntaxError/load failures that otherwise log with no location.
      const loc =
        level >= 2 && sourceId
          ? ` (${sourceId.split("/").slice(-2).join("/")}:${line})`
          : "";
      if (level >= 2) logMpv.error(`${prefix} ${message}${loc}`);
      else logMpv.log(`${prefix} ${message}`);
    },
  );

  // Keep video window aligned with parent window movement/resizing
  const syncWindowPosition = () => {
    if (
      lastRendererBounds &&
      !mainWindow.isDestroyed() &&
      !mainWindow.isMinimized()
    ) {
      videoWindow?.updateBounds(lastRendererBounds);
    }
  };
  mainWindow.on("move", syncWindowPosition);
  mainWindow.on("resize", syncWindowPosition);
  mainWindow.on("restore", syncWindowPosition);

  // Relay main-window fullscreen state to both windows so the overlay's
  // fullscreen button icon stays in sync (the overlay can't use
  // document.fullscreenElement — it's the main window that goes fullscreen).
  const fwdFullscreen = (value: boolean) => {
    const ev = { type: "host-fullscreen", value };
    videoWindow?.sendEvent(ev);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mpv:event", ev);
    }
  };
  mainWindow.on("enter-full-screen", () => fwdFullscreen(true));
  mainWindow.on("leave-full-screen", () => fwdFullscreen(false));

  // ── Lifecycle serialization ──
  // mpv:start and mpv:destroy must never interleave: destroy nulls the video
  // window while start is still awaiting "ready-to-show", and start then
  // crashed with "Cannot read properties of null (reading 'getNativeHandle')".
  // The queue runs each lifecycle step to completion before the next begins.
  let lifecycleChain: Promise<unknown> = Promise.resolve();
  const enqueueLifecycle = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lifecycleChain.then(fn, fn);
    lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  // ── Start mpv + create video window ──
  ipcMain.handle("mpv:start", () =>
    enqueueLifecycle(async () => {
      logMpv.log("[mpv:start] Handler invoked");
      try {
        if (!videoWindow) {
          // Same compiled preload as the main window (dist/preload.js) — it
          // exposes window.electronAPI which the overlay page's adapter needs.
          // (dist/preload/index.js does not exist.)
          const preloadPath = join(__dirname, "../preload.js");
          const overlayUrl = resolveOverlayUrl();
          logMpv.log(`[mpv:start] Overlay URL: ${overlayUrl}`);
          videoWindow = new VLCVideoWindow(mainWindow, {
            preload: preloadPath,
            overlayUrl,
          });
          logMpv.log("[mpv:start] Created VLCVideoWindow with overlay");
        }
        const childWin = videoWindow.create();

        // Replay last renderer bounds if they arrived before the window existed
        if (lastRendererBounds) {
          videoWindow.updateBounds(lastRendererBounds);
          logMpv.log("[mpv:start] Replayed lastRendererBounds");
        }

        await new Promise<void>((resolve) => {
          if (childWin.isVisible()) resolve();
          else {
            childWin.once("ready-to-show", () => resolve());
            setTimeout(resolve, 500);
          }
        });

        const hwnd = videoWindow.getNativeHandle();
        logMpv.log(
          `[mpv:start] Video window ready, HWND buffer size=${hwnd.length}`,
        );

        if (!mpvManager) {
          mpvManager = new MpvManager();
          // Subscribe to MpvManager events and fan out to both windows
          mpvManager.on("event", (event) => fwd(event));
          mpvManager.on("exit", (code) => fwd({ type: "exit", code }));
          mpvManager.on("error", (msg) => fwd({ type: "error", message: msg }));
          logMpv.log("[mpv:start] MpvManager created, events forwarded");
        }
        await mpvManager.start(hwnd);
        logMpv.log("[mpv:start] mpv process started successfully");

        // Dev test hook: play a local file immediately (bypasses the network
        // proxy entirely) to isolate window embedding from stream issues.
        //   FILMSNAPS_MPV_TEST_FILE=C:\path\to\sample.mp4 pnpm exec electron . --dev
        const testFile = process.env.FILMSNAPS_MPV_TEST_FILE;
        if (testFile) {
          logMpv.log(`[mpv:start] TEST FILE MODE: loadfile ${testFile}`);
          await mpvManager.sendCommand(["loadfile", testFile, "replace"]);
        }

        return { ready: true };
      } catch (err: any) {
        logMpv.error(`[mpv:start] Failed: ${err.message}`);
        return { ready: false, error: err.message };
      }
    }),
  );

  // ── Destroy mpv process ──
  ipcMain.handle("mpv:destroy", () =>
    enqueueLifecycle(async () => {
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
    }),
  );

  // ── Playback ──
  ipcMain.handle("mpv:play", async (_e, url: string) => {
    logMpv.log(`[mpv:play] URL: ${String(url ?? "").slice(0, 120)}`);
    if (!mpvManager) {
      return { success: false, error: "mpv not started" };
    }
    try {
      await mpvManager.play(url);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Fire-and-forget command wrapper — MUST catch, or every mpv-side failure
  // becomes an UnhandledPromiseRejectionWarning with no clue which call failed.
  // NOTE: uses set_property, NOT set — this mpv build's `set` command only
  // accepts string values (booleans/numbers → "invalid parameter"), while
  // set_property accepts native JSON types (verified against mpv v0.41).
  const cmd = (channel: string, args: unknown[]) => {
    mpvManager
      ?.sendCommand(args)
      .catch((err: Error) =>
        logMpv.warn(`[mpv:${channel}] command failed: ${err.message}`),
      );
  };

  ipcMain.handle("mpv:pause", () => {
    cmd("pause", ["set_property", "pause", true]);
    return { success: true };
  });

  ipcMain.handle("mpv:resume", () => {
    cmd("resume", ["set_property", "pause", false]);
    return { success: true };
  });

  ipcMain.handle("mpv:seek", (_e, t: number) => {
    if (typeof t !== "number" || !Number.isFinite(t)) {
      // NaN/undefined serialize to null over IPC; mpv would reject the seek
      // with "argument target has incompatible type" — reject here loudly.
      logMpv.warn(
        `[mpv:seek] rejected non-finite target: ${String(t)} (typeof ${typeof t})`,
      );
      return { success: false, error: "invalid seek target" };
    }
    cmd("seek", ["seek", t, "absolute"]);
    return { success: true };
  });

  ipcMain.handle("mpv:setVolume", (_e, v: number) => {
    cmd("setVolume", [
      "set_property",
      "volume",
      Math.max(0, Math.min(100, Math.round(v))),
    ]);
    return { success: true };
  });

  ipcMain.handle("mpv:setMuted", (_e, muted: boolean) => {
    cmd("setMuted", ["set_property", "mute", !!muted]);
    return { success: true };
  });

  ipcMain.handle("mpv:setSpeed", (_e, rate: number) => {
    cmd("setSpeed", ["set_property", "speed", Number(rate)]);
    return { success: true };
  });

  ipcMain.handle("mpv:setProperty", (_e, name: string, value: unknown) => {
    cmd(`setProperty(${name})`, ["set_property", name, value]);
    return { success: true };
  });

  ipcMain.handle("mpv:toggleFullscreen", () => {
    if (!mainWin || mainWin.isDestroyed()) return { success: false };
    mainWin.setFullScreen(!mainWin.isFullScreen());
    return { success: true };
  });

  // ── State ──
  ipcMain.handle("mpv:getState", () => {
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
    (_e, bounds: { x: number; y: number; width: number; height: number }) => {
      if (mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
      logMpv.log(`[setVideoBounds] ${JSON.stringify(bounds)}`);
      lastRendererBounds = bounds;
      videoWindow?.updateBounds(bounds);
    },
  );

  // ── Window visibility ──
  ipcMain.handle("mpv:hideVideo", () => {
    logMpv.log("[mpv:hideVideo] called — hiding video window");
    videoWindow?.hide();
    return { success: true };
  });

  ipcMain.handle("mpv:showVideo", () => {
    if (!videoWindow) return { success: true };
    logMpv.log("[mpv:showVideo] called — showing video window");
    // show() clears isHidden first so updateBounds below isn't skipped
    videoWindow.show();
    if (lastRendererBounds) videoWindow.updateBounds(lastRendererBounds);
    return { success: true };
  });

  // ── Stream probe (main process, no CORS) ──
  // Classifies a URL as valid/dead/unknown by GETting the first KB and
  // inspecting the BYTES. Status codes alone lie: CDNs happily answer 200
  // with an HTML error page / Cloudflare interstitial, which used to read as
  // "verified" (green) in the source picker and then fail to play in mpv.
  function classifyProbeBody(bytes: Uint8Array): "media" | "error" | "opaque" {
    if (bytes.length === 0) return "opaque";
    const head = Buffer.from(bytes.slice(0, 512))
      .toString("latin1")
      .toLowerCase();
    if (
      head.includes("<!doctype") ||
      head.includes("<html") ||
      head.includes("<title") ||
      head.includes('{"error"') ||
      head.includes('{"message"') ||
      head.includes("access denied") ||
      head.includes("just a moment") ||
      head.includes("cloudflare")
    ) {
      return "error";
    }
    // Known container signatures
    if (
      bytes.length >= 12 &&
      Buffer.from(bytes.subarray(4, 8)).toString("latin1") === "ftyp"
    )
      return "media"; // MP4/M4V
    if (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    )
      return "media"; // EBML (MKV/WebM)
    if (bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47))
      return "media"; // MPEG-TS
    if (head.startsWith("riff")) return "media"; // AVI/WAV
    if (
      head.startsWith("flac") ||
      head.startsWith("id3") ||
      head.startsWith("ogg")
    )
      return "media";
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01)
      return "media"; // MPEG start codes
    return "opaque"; // binary but unrecognized — trust the 2xx status
  }

  // Read at most ~4 KB of the body. A Range GET usually caps it, but servers
  // that ignore Range would otherwise buffer the entire video into memory.
  // (Typed loosely — the main process has no DOM lib for Response.)
  async function readProbeBytes(res: { body: any }): Promise<Uint8Array> {
    const reader = res?.body?.getReader?.();
    if (!reader) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < 4096) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
      }
    } catch {
      /* partial body is still classifiable */
    }
    reader.cancel().catch(() => {});
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  ipcMain.handle(
    "mpv:probe",
    async (_e, url: string, timeoutMs = 6000): Promise<string> => {
      // Probe through the SAME proxy path playback uses. A verdict from a
      // different network path (direct fetch) is a verdict about a different
      // pipeline — that mismatch was the "green but doesn't play" bug: the
      // probe validated the URL while the proxy path (the one mpv actually
      // streams through) failed.
      const proxiedUrl = mpvManager?.getPlaybackProxyUrl(url) ?? null;
      const target = proxiedUrl ?? url;

      const attempt = async (minimalHeaders: boolean): Promise<string> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await electronNet.fetch(target, {
            method: "GET",
            headers: minimalHeaders
              ? { Range: "bytes=0-2047" }
              : {
                  Range: "bytes=0-2047",
                  Accept: "*/*",
                  "Accept-Encoding": "identity",
                },
            redirect: "follow",
            signal: controller.signal,
          });
          if (res.status === 429) return "unknown"; // rate limit — never dead
          if (res.status === 403 || res.status === 404 || res.status === 410)
            return "dead";
          if (res.status === 200 || res.status === 206) {
            const bytes = await readProbeBytes(res);
            return classifyProbeBody(bytes) === "error" ? "dead" : "valid";
          }
          return "unknown";
        } catch {
          return "unknown";
        } finally {
          clearTimeout(timer);
        }
      };

      let verdict = await attempt(false);
      // Some CDNs 403 the first request of a connection (token warm-up /
      // fingerprint race) while the player's plain follow-up plays fine —
      // never condemn a link on a single 403 (mobile's two-agreeing-failures).
      if (verdict === "dead") {
        await new Promise((r) => setTimeout(r, 1200));
        verdict = await attempt(true);
      }
      logMpv.log(
        `[mpv:probe] ${verdict} via ${proxiedUrl ? "playback-proxy" : "direct"} — ${url.slice(0, 100)}`,
      );
      return verdict;
    },
  );

  // ── External subtitle loading (online search) ──
  // The renderer cannot fetch most subtitle CDNs (CORS), so the main process
  // downloads the file and hands it to mpv via memory:// — no temp files, no
  // renderer network access needed.
  ipcMain.handle("mpv:subAdd", async (_e, url: string, title?: string) => {
    if (!mpvManager) return { success: false, error: "mpv not started" };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await electronNet.fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      clearTimeout(timer);
      if (!res.ok)
        return {
          success: false,
          error: `subtitle download failed (${res.status})`,
        };
      const text = await res.text();
      if (!text || text.length < 16)
        return { success: false, error: "subtitle file is empty" };
      await mpvManager.sendCommand([
        "sub-add",
        `memory://${text}`,
        "select",
        title || "Online subtitle",
      ]);
      return { success: true };
    } catch (err: any) {
      // Fallback: let mpv fetch the URL itself (works for plain http(s) CDNs)
      try {
        await mpvManager.sendCommand([
          "sub-add",
          url,
          "select",
          title || "Online subtitle",
        ]);
        return { success: true };
      } catch (err2: any) {
        return { success: false, error: err2.message || err.message };
      }
    }
  });

  // ── Cleanup on window close ──
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
