/**
 * Blob Downloader — react-native-blob-util based download engine.
 *
 * Implements IDownloaderAdapter using RNFB. Supports:
 * - Full-speed and speed-limited (chunked) downloads
 * - True pause/resume via Range requests
 * - Cancel with file cleanup
 * - Progress tracking
 * - Background download support
 *
 * Speed limiter: when speedLimit > 0, downloads are split into sequential
 * chunks (each via a separate Range request). After each chunk, the elapsed
 * download time is compared to the target time at the speed limit. If the
 * chunk finished faster, an artificial delay is inserted. This ensures the
 * average throughput stays at or below the configured limit.
 *
 * NOTE: react-native-blob-util import is wrapped in try-catch so the app
 * doesn't crash if the native module fails to load.
 */

// @ts-ignore — react-native-blob-util types may not be available
let RNFBlobUtil: any = null;
try {
  RNFBlobUtil = require("react-native-blob-util").default;
} catch (e) {
  console.warn("[BlobDownloader] react-native-blob-util not available:", e);
}

import type {
  IDownloaderAdapter,
  DownloadOptions,
  DownloadInstance,
} from "./adapter";

// ── Constants ──

function adjustChunkSize(speedLimit: number): number {
  if (speedLimit <= 1024 * 1024) return 512 * 1024;
  if (speedLimit <= 5 * 1024 * 1024) return 1024 * 1024;
  return 2 * 1024 * 1024;
}

const MIN_VALID_FILE_SIZE = 10_240;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const CHUNK_TIMEOUT_MS = 10 * 60 * 1000;

// ── Active Downloads Tracking ──

interface ActiveDownload {
  cancelled: boolean;
  paused: boolean;
  receivedBytes: number;
  totalBytes: number;
  options: DownloadOptions;
  fetchTask: any;
  chunkPaths: string[];
  filePath: string;
  currentOffset: number;
  chunkedMode: boolean;
}

const activeDownloads = new Map<string, ActiveDownload>();

// ── MIME Types ──

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  ts: "video/mp2t",
  m3u8: "application/x-mpegURL",
};

function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "mp4";
  return MIME_TYPES[ext] || "video/mp4";
}

// ── Helper: Ensure parent directory exists ──

async function ensureParentDir(filePath: string): Promise<void> {
  if (!RNFBlobUtil) return;
  const normalized = filePath.replace(/\\/g, "/");
  const lastSep = normalized.lastIndexOf("/");
  if (lastSep <= 0) return;
  const dir = normalized.substring(0, lastSep);
  try {
    const exists = await RNFBlobUtil.fs.exists(dir);
    if (!exists) await RNFBlobUtil.fs.mkdir(dir);
  } catch (e) {
    console.warn("[BlobDownloader] Failed to create directory:", dir, e);
  }
}

// ── Helper: Cancel a RNFB fetch task ──

function cancelFetch(fetchTask: any): Promise<void> {
  if (!fetchTask) return Promise.resolve();
  if (typeof fetchTask.cancel === "function") return fetchTask.cancel();
  if (fetchTask.task && typeof fetchTask.task.cancel === "function")
    return fetchTask.task.cancel();
  return Promise.resolve();
}

/**
 * CRITICAL FIX: Coerce a value from RNFB's native bridge to a safe number.
 * RNFB on Android passes progress values as STRINGS through the bridge.
 * Without this, string comparison (<) and string concatenation (+) corrupt all math.
 */
function toSafeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

// ── Adapter Implementation ──

export class BlobDownloaderAdapter implements IDownloaderAdapter {
  private guard(): void {
    if (!RNFBlobUtil) {
      throw new Error(
        "react-native-blob-util is not available. Ensure it is installed and " +
          "you are running a development build (not Expo Go).",
      );
    }
  }

  // ── Main Entry Point ──

  async download(options: DownloadOptions): Promise<DownloadInstance> {
    this.guard();
    if (!options.url || typeof options.url !== "string")
      throw new Error("Invalid download URL");
    await ensureParentDir(options.filePath);
    const speedLimit = options.speedLimit ?? 0;
    console.log(
      `[BlobDownloader] download: speedLimit=${speedLimit} → ${speedLimit > 0 ? "CHUNKED" : "full-speed"}`,
    );
    // Use externalId if provided (aligns with Manager's task ID)
    const downloadId =
      options.externalId ||
      `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (speedLimit > 0)
      return this.downloadChunked(downloadId, options, speedLimit);
    return this.downloadFullSpeed(downloadId, options);
  }

  // ── Full-Speed Download (single fetch, no chunking) ──

  private async downloadFullSpeed(
    downloadId: string,
    options: DownloadOptions,
  ): Promise<DownloadInstance> {
    const config = { path: options.filePath, fileCache: false };
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ...(options.headers || {}),
    };

    const isRangeRequest = !!headers["Range"];

    // NOTE: Do NOT delete existing files here.
    // RNFB's fetch with config({ path }) will overwrite the file at path.
    // For .resume files, this is correct — we always want a fresh .resume
    // (the old one was merged into original by startDownload before calling us).

    console.log(
      `[BlobDownloader] Full-speed download: ${options.url.slice(0, 200)}, Range: ${headers["Range"] || "none"}`,
    );
    const fetchTask = RNFBlobUtil.config(config).fetch(
      "GET",
      options.url,
      headers,
    );

    const state: ActiveDownload = {
      cancelled: false,
      paused: false,
      receivedBytes: 0,
      totalBytes: 0,
      options,
      fetchTask,
      chunkPaths: [],
      filePath: options.filePath,
      currentOffset: 0,
      chunkedMode: false,
    };
    activeDownloads.set(downloadId, state);

    let lastProgressLog = Date.now();
    const PROGRESS_LOG_INTERVAL = 10000;

    fetchTask.progress((rawReceived: unknown, rawTotal: unknown) => {
      try {
        if (state.cancelled || state.paused) return;

        // ═══════════════════════════════════════════════════════════════
        // CRITICAL FIX: Coerce RNFB bridge values to numbers IMMEDIATELY.
        // RNFB on Android sends these as strings. Without coercion:
        //   - "<" does lexicographic comparison ("10MB" < "9MB" → true)
        //   - "+" does string concatenation (9802174 + "9885446" → "98021749885446")
        // ═══════════════════════════════════════════════════════════════
        const received = toSafeNumber(rawReceived, 0);
        const total = toSafeNumber(rawTotal, 0);

        state.receivedBytes = received;
        state.totalBytes = total;

        // LOG: Log raw chunk progress after resume for clarity
        if (isRangeRequest && total > 0) {
          const chunkPct = ((received / total) * 100).toFixed(1);
          console.log(
            `[BlobDownloader] Chunk: ${(received / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB (${chunkPct}%) — Range bytes only`,
          );
        }

        options.onProgress?.(received, total);

        const now = Date.now();
        if (now - lastProgressLog > PROGRESS_LOG_INTERVAL) {
          lastProgressLog = now;
          const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : "?";
          const receivedMB = (received / 1024 / 1024).toFixed(1);
          const pct = total > 0 ? ((received / total) * 100).toFixed(1) : "?";
          console.log(
            `[BlobDownloader] Progress: ${receivedMB}MB / ${totalMB}MB (${pct}%)`,
          );
        }
      } catch (e) {
        console.warn("[BlobDownloader] Progress handler error:", e);
      }
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      if (!state.cancelled && !state.paused) {
        timedOut = true;
        try {
          cancelFetch(fetchTask);
        } catch {}
        console.log(
          `[BlobDownloader] Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`,
        );
      }
    }, DOWNLOAD_TIMEOUT_MS);

    fetchTask
      .then(async (res: any) => {
        clearTimeout(timeoutId);
        activeDownloads.delete(downloadId);
        if (state.cancelled || state.paused) return;

        const status = toSafeNumber(res?.respInfo?.status, 0);
        const totalBytes = state.totalBytes;
        const receivedBytes = state.receivedBytes;

        console.log(
          `[BlobDownloader] Fetch completed: id=${downloadId}, status=${status}, receivedBytes=${receivedBytes}, totalBytes=${totalBytes}, timedOut=${timedOut}`,
        );

        if (status >= 400) {
          console.error(`[BlobDownloader] Server returned HTTP ${status}`);
          options.onError?.(new Error(`Server returned HTTP ${status}`));
          return;
        }

        // Detect server ignoring Range request (responds 200 instead of 206)
        if (isRangeRequest && status === 200) {
          console.warn(
            `[BlobDownloader] Server ignored Range header (got 200 instead of 206). Full file downloaded.`,
          );
        }

        if (totalBytes > 0 && receivedBytes < totalBytes && status !== 200) {
          console.warn(
            `[BlobDownloader] PREMATURE COMPLETION: ${receivedBytes}/${totalBytes} bytes`,
          );
        }

        const actualPath = res.path();
        let finalPath = options.filePath;
        if (actualPath && actualPath !== options.filePath) {
          console.log(
            `[BlobDownloader] Path mismatch: res.path()=${actualPath} !== expected=${options.filePath}. Copying...`,
          );
          try {
            await RNFBlobUtil.fs.cp(actualPath, options.filePath);
            try {
              await RNFBlobUtil.fs.unlink(actualPath);
            } catch {}
          } catch (copyErr: any) {
            console.error(`[BlobDownloader] Failed to copy:`, copyErr);
            options.onError?.(
              new Error(`Failed to move downloaded file: ${copyErr.message}`),
            );
            return;
          }
        }
        options.onDone?.(options.filePath);
      })
      .catch((err: any) => {
        clearTimeout(timeoutId);
        activeDownloads.delete(downloadId);
        if (state.cancelled) {
          console.log(`[BlobDownloader] Download cancelled: ${downloadId}`);
        } else if (state.paused) {
          console.log(
            `[BlobDownloader] Download paused: ${downloadId}, received=${state.receivedBytes}/${state.totalBytes}`,
          );
        } else if (timedOut) {
          console.log(`[BlobDownloader] Download timed out: ${downloadId}`);
          options.onError?.(new Error("Download timed out"));
        } else {
          const errMsg = err?.message || String(err || "unknown");
          console.error(
            `[BlobDownloader] Download FAILED: ${downloadId}, error=${errMsg}`,
          );
          options.onError?.(new Error(errMsg));
        }
      });

    console.log(
      `[BlobDownloader] Created download: ${downloadId}, speedLimit: ${options.speedLimit ?? 0}`,
    );
    return this.createInstance(downloadId, state, options);
  }

  // ── Speed-Limited Download (chunked via sequential Range requests) ──

  private async downloadChunked(
    downloadId: string,
    options: DownloadOptions,
    speedLimit: number,
  ): Promise<DownloadInstance> {
    const filePath = options.filePath;

    let totalSize = 0;
    let rangeSupported = false;

    try {
      const probeHeaders: Record<string, string> = {
        Range: "bytes=0-0",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(options.headers || {}),
      };
      const probeResult = await RNFBlobUtil.config({ fileCache: false }).fetch(
        "GET",
        options.url,
        probeHeaders,
      );
      const status = toSafeNumber(probeResult.respInfo?.status, 0);
      const contentRange =
        probeResult.respInfo?.headers?.["Content-Range"] ||
        probeResult.respInfo?.headers?.["content-range"] ||
        "";

      if (status === 206 && contentRange) {
        rangeSupported = true;
        const parts = contentRange.split("/");
        if (parts.length === 2) totalSize = parseInt(parts[1], 10) || 0;
      }
    } catch {}

    if (!rangeSupported || totalSize <= 0) {
      console.log(
        `[BlobDownloader] Range not supported or size unknown, falling back to full speed`,
      );
      return this.downloadFullSpeed(downloadId, options);
    }

    let resumeOffset = 0;
    const rangeHeader = options.headers?.["Range"] || "";
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-/);
      if (match) resumeOffset = parseInt(match[1], 10) || 0;
    }

    const state: ActiveDownload = {
      cancelled: false,
      paused: false,
      receivedBytes: resumeOffset,
      totalBytes: totalSize,
      options,
      fetchTask: null,
      chunkPaths: [],
      filePath,
      currentOffset: resumeOffset,
      chunkedMode: true,
    };
    activeDownloads.set(downloadId, state);

    this.runChunkedLoop(
      downloadId,
      state,
      totalSize,
      resumeOffset,
      speedLimit,
      options,
    )
      .then(() => {})
      .catch((err) => {
        activeDownloads.delete(downloadId);
        if (!state.cancelled && !state.paused) options.onError?.(err);
      });

    return this.createInstance(downloadId, state, options);
  }

  private async runChunkedLoop(
    downloadId: string,
    state: ActiveDownload,
    totalSize: number,
    startOffset: number,
    speedLimit: number,
    options: DownloadOptions,
  ): Promise<void> {
    let offset = startOffset;
    let chunkIndex = 0;
    const chunkSize = adjustChunkSize(speedLimit);

    while (offset < totalSize) {
      if (state.cancelled) {
        await this.cleanupChunks(state.chunkPaths);
        return;
      }
      if (state.paused) return;

      const endByte = Math.min(offset + chunkSize - 1, totalSize - 1);
      const chunkFilePath = `${state.filePath}.chunk_${chunkIndex}`;
      state.chunkPaths.push(chunkFilePath);

      const chunkHeaders: Record<string, string> = {
        Range: `bytes=${offset}-${endByte}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(options.headers || {}),
      };
      await ensureParentDir(chunkFilePath);
      const chunkStartTime = Date.now();

      const chunkFetchTask = RNFBlobUtil.config({
        path: chunkFilePath,
        fileCache: false,
      }).fetch("GET", options.url, chunkHeaders);
      state.fetchTask = chunkFetchTask;

      const chunkTimeoutId = setTimeout(() => {
        if (!state.cancelled && !state.paused) {
          try {
            cancelFetch(chunkFetchTask);
          } catch {}
        }
      }, CHUNK_TIMEOUT_MS);

      let chunkActualSize: number;
      try {
        await chunkFetchTask;
        clearTimeout(chunkTimeoutId);
        if (state.cancelled) {
          await this.cleanupChunks(state.chunkPaths);
          return;
        }
        if (state.paused) return;

        try {
          const stat = await RNFBlobUtil.fs.stat(chunkFilePath);
          chunkActualSize = toSafeNumber(stat.size, endByte - offset + 1);
        } catch {
          chunkActualSize = endByte - offset + 1;
        }
      } catch (err: any) {
        clearTimeout(chunkTimeoutId);
        if (state.cancelled) {
          await this.cleanupChunks(state.chunkPaths);
          return;
        }
        if (state.paused) return;
        await this.cleanupChunks(state.chunkPaths);
        activeDownloads.delete(downloadId);
        options.onError?.(
          new Error(`Chunk ${chunkIndex} failed: ${err.message}`),
        );
        return;
      }

      offset += chunkActualSize;
      state.currentOffset = offset;
      state.receivedBytes = offset;
      chunkIndex++;
      try {
        options.onProgress?.(state.receivedBytes, totalSize);
      } catch {}
      state.fetchTask = null;

      const elapsedMs = Date.now() - chunkStartTime;
      const targetMs = (chunkActualSize / speedLimit) * 1000;
      const waitMs = Math.round(targetMs - elapsedMs);
      if (waitMs > 0) await this.delay(waitMs);
    }

    try {
      await this.concatenateChunks(state.chunkPaths, state.filePath);
      await this.cleanupChunks(state.chunkPaths);
      const stat = await RNFBlobUtil.fs.stat(state.filePath);
      const fileSize = toSafeNumber(stat.size, 0);
      if (fileSize < MIN_VALID_FILE_SIZE) {
        try {
          await RNFBlobUtil.fs.unlink(state.filePath);
        } catch {}
        activeDownloads.delete(downloadId);
        options.onError?.(
          new Error("Server returned invalid response (file too small)"),
        );
        return;
      }
      state.receivedBytes = fileSize;
      try {
        options.onProgress?.(fileSize, fileSize);
      } catch {}
      activeDownloads.delete(downloadId);
      options.onDone?.(state.filePath);
    } catch (err: any) {
      await this.cleanupChunks(state.chunkPaths);
      activeDownloads.delete(downloadId);
      options.onError?.(new Error(`Concatenation failed: ${err.message}`));
    }
  }

  // ── Chunk File Management ──

  private async concatenateChunks(
    chunkPaths: string[],
    targetPath: string,
  ): Promise<void> {
    if (chunkPaths.length === 0 || !RNFBlobUtil) return;
    if (chunkPaths.length === 1) {
      try {
        await RNFBlobUtil.fs.mv(chunkPaths[0], targetPath);
      } catch {
        await this.appendFileStream(chunkPaths[0], targetPath);
        try {
          await RNFBlobUtil.fs.unlink(chunkPaths[0]);
        } catch {}
      }
      return;
    }
    try {
      await RNFBlobUtil.fs.mv(chunkPaths[0], targetPath);
    } catch {
      await this.appendFileStream(chunkPaths[0], targetPath);
      try {
        await RNFBlobUtil.fs.unlink(chunkPaths[0]);
      } catch {}
    }
    for (let i = 1; i < chunkPaths.length; i++) {
      await this.appendFileStream(chunkPaths[i], targetPath);
      try {
        await RNFBlobUtil.fs.unlink(chunkPaths[i]);
      } catch {}
    }
  }

  private async cleanupChunks(chunkPaths: string[]): Promise<void> {
    if (!RNFBlobUtil) return;
    for (const p of chunkPaths) {
      try {
        if (await RNFBlobUtil.fs.exists(p)) await RNFBlobUtil.fs.unlink(p);
      } catch {}
    }
  }

  private async appendFileStream(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    const readStream = await RNFBlobUtil.fs.readStream(
      sourcePath,
      "base64",
      256 * 1024,
    );
    const writeStream = await RNFBlobUtil.fs.writeStream(
      targetPath,
      "base64",
      true,
    );
    return new Promise<void>((resolve, reject) => {
      let writeError: Error | null = null;
      let done = false;
      readStream.onData((chunk: string | number[]) => {
        if (done) return;
        try {
          if (typeof chunk === "string") writeStream.write(chunk);
          else writeStream.write(String.fromCharCode(...chunk));
        } catch (err: any) {
          writeError = err;
          done = true;
        }
      });
      readStream.onEnd(() => {
        done = true;
        writeStream
          .close()
          .catch(() => {})
          .then(resolve)
          .catch(resolve);
      });
      readStream.onError((err: any) => {
        done = true;
        writeError = writeError || err;
        writeStream
          .close()
          .catch(() => {})
          .then(() => reject(writeError))
          .catch(() => reject(writeError));
      });
      readStream.open();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Create DownloadInstance ──

  private createInstance(
    downloadId: string,
    state: ActiveDownload,
    options: DownloadOptions,
  ): DownloadInstance {
    return {
      id: downloadId,
      pause: async () => {
        state.paused = true;
        if (state.fetchTask) {
          try {
            await cancelFetch(state.fetchTask);
          } catch {}
          state.fetchTask = null;
        }
      },
      resume: async () => {
        state.paused = false;
        state.cancelled = false;
      },
      cancel: async () => {
        state.cancelled = true;
        if (state.fetchTask) {
          try {
            await cancelFetch(state.fetchTask);
          } catch {}
          state.fetchTask = null;
        }
        await this.cleanupChunks(state.chunkPaths);
        try {
          if (await RNFBlobUtil.fs.exists(state.filePath)) {
            await RNFBlobUtil.fs.unlink(state.filePath);
          }
        } catch {}
        for (const p of state.chunkPaths) {
          try {
            if (await RNFBlobUtil.fs.exists(p)) await RNFBlobUtil.fs.unlink(p);
          } catch {}
        }
        activeDownloads.delete(downloadId);
      },
    };
  }

  // ── IDownloaderAdapter interface methods ──

  supportsBackground(): boolean {
    return true;
  }

  async getAvailableStorage(): Promise<number> {
    try {
      const info = await RNFBlobUtil.fs.df();
      return toSafeNumber(info.free, 0);
    } catch {
      return 0;
    }
  }

  async destroy(): Promise<void> {
    for (const [id, state] of activeDownloads) {
      state.cancelled = true;
      if (state.fetchTask) {
        try {
          await cancelFetch(state.fetchTask);
        } catch {}
      }
      await this.cleanupChunks(state.chunkPaths);
    }
    activeDownloads.clear();
  }
}
