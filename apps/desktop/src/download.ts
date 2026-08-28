/**
 * FilmSnaps Desktop — Media Download Manager (Phase 2)
 *
 * Owns offline media downloads initiated from the desktop app. Any download
 * that fires inside the provider session partition (`persist:filmsnaps-provider`)
 * is intercepted via `session.on('will-download')` and routed into this manager
 * instead of Electron's default save dialog.
 *
 * Responsibilities:
 *   - Track each download's progress / speed / state in real time
 *   - Pause / resume / cancel via the live DownloadItem handle
 *   - Persist a manifest (userData/downloads.json) so the list survives restart
 *   - Throttle active downloads to a speed-limit tier (Full / Balanced / Slower)
 *   - Broadcast the full task list to the renderer over `download:progress`
 *   - Open a downloaded file's location / delete it
 *
 * NOTE on scope: this captures downloads that the app explicitly starts (via
 * `download:start`) or that the provider embed triggers. Provider video usually
 * streams as HLS/adaptive inside the player WebContentsView; a single-file
 * offline capture of those streams would require stream-URL extraction + HLS
 * demuxing, which is intentionally out of scope here. The manager is fully
 * functional for any direct media/file URL it is given.
 */

import {
  app,
  session,
  ipcMain,
  shell,
  type BrowserWindow,
  type DownloadItem,
} from "electron";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { randomUUID } from "crypto";

export type DownloadStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface DownloadMeta {
  url: string;
  tmdbId?: string;
  title?: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
}

export interface DownloadTask {
  id: string;
  url: string;
  tmdbId?: string;
  title: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
  fileName: string;
  filePath: string;
  totalBytes: number;
  receivedBytes: number;
  speedBytesPerSec: number;
  state: DownloadStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Throttle tiers → fraction of measured link speed (null = unlimited). */
const SPEED_LIMIT_FRACTION: Record<string, number> = {
  full: 0,
  balanced: 0.64,
  slower: 0.32,
};

/** Pacemaker tick (ms). Budget = linkRate * fraction * TICK/1000. */
const PACE_TICK_MS = 500;

const SESSION_PARTITION = "persist:filmsnaps-provider";
/**
 * Dedicated session for EXPLICIT downloads (nxsha/falix pages, add-by-URL).
 * Deliberately separate from the provider session so the R0–R8 filter stack
 * never gates known-good direct file URLs (media hosts aren't in the provider
 * trust lists by design). Shared with the nxsha scraper window
 * (media-sources.ts) so any cookies the page sets ride along.
 */
const MEDIA_DL_PARTITION = "persist:filmsnaps-dl";

type WindowGetter = () => BrowserWindow | null;

class DownloadManager {
  private tasks = new Map<string, DownloadTask>();
  private items = new Map<string, DownloadItem>();
  /** FIFO of metadata for downloads started via download:start (redirect-safe). */
  private pendingMeta: DownloadMeta[] = [];
  private speedLimitFraction = 0;
  /** Duty-cycle pacemaker (real throttle — Electron 42 has no bandwidth API). */
  private pacemaker: NodeJS.Timeout | null = null;
  private pacePhase = 0;
  private lastPaceOn = false;
  /** Download ids the user explicitly paused — never auto-resumed by pacemaker. */
  private userPaused = new Set<string>();
  private saveDir = "";
  private manifestPath = "";
  private getWindow: WindowGetter;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(getWindow: WindowGetter) {
    this.getWindow = getWindow;
    // Honour a user-configured download folder (Settings → Downloads Storage).
    // Falls back to ~/Downloads/FilmSnaps when unset.
    const configured = (globalThis as any).__filmsnapsDownloadDir as
      | string
      | undefined;
    this.saveDir =
      configured && configured.trim()
        ? configured
        : join(app.getPath("downloads"), "FilmSnaps");
    this.manifestPath = join(app.getPath("userData"), "downloads.json");
    try {
      mkdirSync(this.saveDir, { recursive: true });
    } catch {
      /* best-effort */
    }
    this.loadManifest();
  }

  /** Attach the session download hook + IPC handlers. Call once after appReady. */
  init(): void {
    // Provider-embed downloads AND explicit media-page downloads both land in
    // onWillDownload; pendingMeta FIFO stays ordered (single-threaded main).
    const sess = session.fromPartition(SESSION_PARTITION);
    sess.on("will-download", (_event, item) => this.onWillDownload(item));
    session
      .fromPartition(MEDIA_DL_PARTITION)
      .on("will-download", (_event, item) => this.onWillDownload(item));
    this.registerIpc();
  }

  // ── Persistence ────────────────────────────────────────────────

  private loadManifest(): void {
    try {
      if (existsSync(this.manifestPath)) {
        const arr = JSON.parse(
          readFileSync(this.manifestPath, "utf8"),
        ) as DownloadTask[];
        for (const t of arr) {
          // A live DownloadItem handle cannot survive a restart, so any
          // in-flight task is demoted to "canceled" on reload.
          if (t.state === "active" || t.state === "paused") {
            t.state = "canceled";
          }
          this.tasks.set(t.id, t);
        }
      }
    } catch {
      /* corrupt manifest — start fresh */
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        writeFileSync(
          this.manifestPath,
          JSON.stringify(this.allTasks(), null, 2),
        );
      } catch {
        /* best-effort */
      }
    }, 500);
  }

  private allTasks(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  /** Push the current task list to the renderer + persist (debounced). */
  private broadcast(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("download:progress", this.allTasks());
    }
    this.schedulePersist();
  }

  // ── Download lifecycle ─────────────────────────────────────────

  private onWillDownload(item: DownloadItem): void {
    const id = randomUUID();
    const meta = this.pendingMeta.shift();
    const rawName = meta?.title || item.getFilename() || `filmsnaps-${id}`;
    const fileName = sanitizeFileName(rawName);
    const filePath = join(this.saveDir, fileName);

    // Take over the save path so no native dialog appears.
    item.setSavePath(filePath);
    this.registerPacemaker(id, item);

    const task: DownloadTask = {
      id,
      url: item.getURL(),
      tmdbId: meta?.tmdbId,
      title: rawName,
      mediaType: meta?.mediaType,
      season: meta?.season,
      episode: meta?.episode,
      fileName,
      filePath,
      totalBytes: 0,
      receivedBytes: 0,
      speedBytesPerSec: 0,
      state: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(id, task);
    this.items.set(id, item);

    // Manual speed tracking (some Electron type defs omit getBytesPerSecond).
    let lastBytes = 0;
    let lastTime = Date.now();

    item.on("updated", (_e, state) => {
      const now = Date.now();
      const received = item.getReceivedBytes();
      if (state === "interrupted") {
        task.state = "failed";
        task.error = "Interrupted";
      } else if (state === "progressing") {
        const dt = (now - lastTime) / 1000;
        if (dt > 0.2) {
          task.speedBytesPerSec = Math.max(
            0,
            Math.round((received - lastBytes) / dt),
          );
          lastBytes = received;
          lastTime = now;
        }
        task.receivedBytes = received;
        task.totalBytes = item.getTotalBytes();
        task.state = item.isPaused() ? "paused" : "active";
      }
      task.updatedAt = now;
      this.broadcast();
    });

    item.on("done", (_e, state) => {
      if (state === "completed") {
        task.state = "completed";
        task.receivedBytes = item.getReceivedBytes();
        task.totalBytes = item.getTotalBytes();
      } else {
        task.state = "failed";
        task.error = state;
      }
      task.updatedAt = Date.now();
      this.items.delete(id);
      this.broadcast();
    });

    this.broadcast();
  }

  /**
   * Start a download from a direct URL. Explicit starts (media pages,
   * add-by-URL) run through the clean MEDIA_DL partition; only embed-triggered
   * downloads flow through the provider-filtered session.
   */
  startDownload(meta: DownloadMeta): { success: boolean } {
    const sess = session.fromPartition(MEDIA_DL_PARTITION);
    this.pendingMeta.push(meta);
    sess.downloadURL(meta.url);
    return { success: true };
  }

  pause(id: string): void {
    this.userPaused.add(id);
    this.items.get(id)?.pause();
  }

  resume(id: string): void {
    this.userPaused.delete(id);
    this.items.get(id)?.resume();
  }

  cancel(id: string): void {
    this.userPaused.delete(id);
    this.items.get(id)?.cancel();
    // 'done' with state !== 'completed' will fire and demote to failed; the
    // renderer can instead clear it. Force-clear here for a clean UX.
    this.items.delete(id);
    const t = this.tasks.get(id);
    if (t) {
      t.state = "canceled";
      t.updatedAt = Date.now();
      this.broadcast();
    }
  }

  open(id: string): void {
    const t = this.tasks.get(id);
    if (t?.filePath) shell.showItemInFolder(t.filePath);
  }

  clear(id: string, deleteFile = false): void {
    const t = this.tasks.get(id);
    if (deleteFile && t?.filePath) {
      try {
        if (existsSync(t.filePath)) unlinkSync(t.filePath);
      } catch {
        /* best-effort */
      }
    }
    this.tasks.delete(id);
    this.items.delete(id);
    this.broadcast();
  }

  setSpeedLimit(level: keyof typeof SPEED_LIMIT_FRACTION): void {
    this.speedLimitFraction = SPEED_LIMIT_FRACTION[level] ?? 0;
    if (this.speedLimitFraction === 0) {
      // Full speed — stop the pacemaker and let everything run unthrottled.
      if (this.pacemaker) {
        clearInterval(this.pacemaker);
        this.pacemaker = null;
      }
      this.pacePhase = 0;
      this.lastPaceOn = false;
      for (const item of this.items.values()) {
        if (item.getState() === "progressing" && item.isPaused()) item.resume();
      }
    } else {
      this.ensurePacemaker();
    }
  }

  /**
   * Real throttle. Electron 42 has no bandwidth-limiting API on DownloadItem
   * (no setThrottle), so we duty-cycle pause/resume: each download runs free
   * for `fraction` of a fixed cycle and is paused for the remainder. Average
   * throughput ≈ fraction × link rate. Only toggles on cycle-boundary crossings
   * to minimise pause/resume churn. User-paused items are never touched.
   */
  private ensurePacemaker(): void {
    if (this.pacemaker) return;
    const CYCLE_MS = 3000;
    this.pacemaker = setInterval(() => {
      const fraction = this.speedLimitFraction;
      if (fraction <= 0) return;
      this.pacePhase = (this.pacePhase + PACE_TICK_MS) % CYCLE_MS;
      const onMs = Math.round(CYCLE_MS * fraction);
      const on = this.pacePhase < onMs;
      if (on === this.lastPaceOn) return; // no boundary crossing — skip
      this.lastPaceOn = on;
      for (const id of this.items.keys()) {
        if (this.userPaused.has(id)) continue;
        const item = this.items.get(id)!;
        if (item.getState() !== "progressing") continue;
        if (on && item.isPaused()) item.resume();
        else if (!on && !item.isPaused()) item.pause();
      }
    }, PACE_TICK_MS);
  }

  /** Capture each live DownloadItem so the pacemaker can throttle it. */
  private registerPacemaker(id: string, item: DownloadItem): void {
    if (this.speedLimitFraction > 0) this.ensurePacemaker();
  }

  /** Point new downloads at a user-chosen folder (Settings → Downloads Storage).
   *  Applies immediately; in-flight downloads keep their already-committed path. */
  setSaveDir(dir: string): void {
    const trimmed = dir?.trim();
    if (!trimmed) return;
    this.saveDir = trimmed;
    try {
      mkdirSync(this.saveDir, { recursive: true });
    } catch {
      /* best-effort */
    }
  }

  // ── IPC ────────────────────────────────────────────────────────

  private registerIpc(): void {
    ipcMain.handle("download:start", (_e, meta: DownloadMeta) =>
      this.startDownload(meta),
    );
    ipcMain.handle("download:pause", (_e, id: string) => {
      this.pause(id);
    });
    ipcMain.handle("download:resume", (_e, id: string) => {
      this.resume(id);
    });
    ipcMain.handle("download:cancel", (_e, id: string) => {
      this.cancel(id);
    });
    ipcMain.handle("download:get-all", () => this.allTasks());
    ipcMain.handle("download:open", (_e, id: string) => {
      this.open(id);
    });
    ipcMain.handle("download:clear", (_e, id: string, deleteFile: boolean) => {
      this.clear(id, deleteFile);
    });
    ipcMain.handle(
      "download:set-speed-limit",
      (_e, level: keyof typeof SPEED_LIMIT_FRACTION) =>
        this.setSpeedLimit(level),
    );
    ipcMain.handle("download:set-save-dir", (_e, dir: string) => {
      this.setSaveDir(dir);
    });
  }
}

/**
 * Replace filesystem-unsafe characters; keep a sensible extension.
 * (Real bandwidth throttling is done via the duty-cycle pacemaker in
 * DownloadManager.setSpeedLimit — Electron exposes no per-download rate API.)
 */
function sanitizeFileName(name: string): string {
  const trimmed = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : "download";
}

let manager: DownloadManager | null = null;

/**
 * Create + initialize the singleton DownloadManager. Safe to call once after
 * the app is ready (uses app.getPath). `getWindow` lazily resolves the main
 * window so we never capture a stale reference.
 */
export function initDownloadManager(getWindow: WindowGetter): void {
  if (manager) return;
  manager = new DownloadManager(getWindow);
  manager.init();
  console.log("[Main] DownloadManager initialized");
}
