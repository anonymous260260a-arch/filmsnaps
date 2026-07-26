/**
 * Download System — Public API
 *
 * Architecture: UI → Hooks → Store (synchronous for React)
 *                               → Manager → Adapter → Native Engine
 *
 * The DownloadManager is the sole orchestrator — it handles queue management,
 * retry with exponential backoff, speed limiting, SQLite persistence, and
 * Android download notifications.
 *
 * Usage:
 *   // 1. Wrap app with provider (in _layout.tsx)
 *   <DownloadInfraProvider>
 *     <App />
 *   </DownloadInfraProvider>
 *
 *   // 2. Use hooks in components
 *   const { active, completed, paused } = useDownloadList();
 *   const { task, progress, pause, resume } = useDownload(taskId);
 *   const { aggregate, startAll, pauseAll } = useEpisodeDownloads(tmdbId, seasonNumber);
 *
 *   // 3. Direct manager usage (for advanced cases)
 *   const { manager } = useDownloadInfra();
 *   await manager.retry(taskId);
 *   await manager.clearCompleted();
 *   const info = await manager.getStorageInfo();
 */

// ── Infrastructure (context + manager + store) ──
export { DownloadInfraProvider, useDownloadInfra } from "./context";
export { DownloadManager } from "./manager";
export type {
  DownloadManagerConfig,
  DownloadErrorCode,
  DownloadError,
} from "./manager";
export {
  createDownloadStore,
  createAsyncStorageAdapter,
  createMemoryAdapter,
} from "./store";
export type { IDownloadStore } from "./store";

// ── New Architecture (lazy-loaded — requires native modules) ──

/**
 * Lazy getter for DownloadDatabase (expo-sqlite).
 * Use instead of a static import to avoid native module crash at bundle time.
 */
export function getDownloadDatabase(): typeof import("./database").DownloadDatabase {
  return require("./database").DownloadDatabase;
}

/**
 * Lazy getter for DownloadManager (uses adapter + database).
 * Use instead of a static import to avoid native module crash at bundle time.
 */
export function getDownloadManager(): typeof import("./manager").DownloadManager {
  return require("./manager").DownloadManager;
}

/**
 * Lazy getter for BlobDownloaderAdapter (react-native-blob-util).
 * Use instead of a static import to avoid native module crash at bundle time.
 */
export function getBlobDownloaderAdapter(): typeof import("./blobDownloader").BlobDownloaderAdapter {
  return require("./blobDownloader").BlobDownloaderAdapter;
}

/**
 * Lazy getter for DownloadNotifications (expo-notifications).
 * Use instead of a static import to avoid native module crash at bundle time.
 */
export function getDownloadNotifications(): typeof import("./notifications").DownloadNotifications {
  return require("./notifications").DownloadNotifications;
}

// ── New Architecture Types (no runtime effect — safe to export) ──
export type {
  IDownloaderAdapter,
  DownloadInstance,
  DownloadOptions,
} from "./adapter";

/**
 * Create a fully wired DownloadManager instance using BlobDownloaderAdapter + SQLite.
 *
 * Call lazily (try-catch) since this depends on native modules.
 *
 * This is the recommended way to create a standalone manager outside of
 * the React component tree (e.g., in background tasks or services).
 */
export function createDownloadManager(config?: {
  maxConcurrent?: number;
  maxRetries?: number;
  enableNotifications?: boolean;
}): import("./manager").DownloadManager {
  const { DownloadManager } = require("./manager");
  const { BlobDownloaderAdapter } = require("./blobDownloader");
  const adapter = new BlobDownloaderAdapter();
  return new DownloadManager(adapter, config);
}

// ── Hooks — all use the manager under the hood ──
export {
  useDownloadList,
  formatBytes,
  formatDate,
  serverLabel,
} from "./useDownloadList";
export { useDownload } from "./useDownload";
export type { UseDownloadReturn } from "./useDownload";
export { useEpisodeDownloads } from "./useEpisodeDownloads";
export type { UseEpisodeDownloadsReturn } from "./useEpisodeDownloads";
export { useDownloadQueue } from "./useDownloadQueue";
export type { QueueConfig, QueueState } from "./useDownloadQueue";

// ── Toast system — trigger download toasts from anywhere ──
export { downloadToast } from "../../components/DownloadToast";
export type { ToastType, ToastEvent } from "../../components/DownloadToast";

// ── Engine (legacy — kept for backward compatibility only) ──
// The engine.ts module is no longer used by the download system.
// All downloads now go through the DownloadManager → BlobDownloaderAdapter pipeline.
// Import directly from './engine' if you need the old API for custom use cases.
export { createDownloadEngine } from "./engine";
export type { IDownloadEngine } from "./engine";

// ── Types ──
export type {
  DownloadTask,
  DownloadStatus,
  DownloadServer,
  MediaType,
  DownloadMeta,
  DownloadProgress,
  StatusChange,
  DownloadGrouped,
  AggregateProgress,
  ControlAction,
  ControlTarget,
  Unsubscribe,
  StorageAdapter,
} from "./types";
