/**
 * Download System — Public API
 *
 * Architecture: UI → Hooks → Store (synchronous for React)
 *                               → Manager → Adapter → Native Engine
 *
 * The DownloadManager is the sole orchestrator — it handles queue management,
 * retry with exponential backoff, network awareness, storage management,
 * and Android download notifications via the native OS download manager.
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
 *   const { episodes, progress, startAll, pauseAll } = useEpisodeDownloads(tmdbId, seasonNumber);
 *
 *   // 3. Direct manager usage (for advanced cases)
 *   const { manager } = useDownloadInfra();
 *   await manager.retry(taskId);
 *   await manager.clearCompleted();
 *   const info = await manager.getStorageInfo();
 */

// ─── Infrastructure (context + manager + store) ───
export { DownloadInfraProvider, useDownloadInfra } from "./context";
export { DownloadManager } from "./manager";
export { NativeDownloaderAdapter } from "./nativeAdapter";
export { NetworkAwarePolicy } from "./networkPolicy";
export { StorageManager } from "./storageManager";
export { DownloadDatabase } from "./database";
export { DownloadNotifications } from "./notifications";
export { createDownloadStore, type DownloadStore } from "./store";

// ─── Types ───
export type {
  DownloadTask,
  DownloadMeta,
  DownloadStatus,
  DownloadServer,
  MediaType,
  DownloadProgress,
  StatusChange,
  AggregateProgress,
  DownloadGrouped,
  ControlAction,
  ControlTarget,
  NetworkPolicy,
  DownloadConfig,
  DownloadQuality,
  MediaDownloadState,
  MediaDownloadSummary,
  SeasonDownloadSummary,
  QualityOption,
  SmartDownloadConfig,
} from "./types";
export {
  DEFAULT_CONFIG,
  QUALITY_OPTIONS,
  QUALITY_TO_SERVER,
  SERVER_TO_QUALITY,
  DEFAULT_SMART_CONFIG,
} from "./types";

// ─── Hooks ───
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
export {
  useMediaDownloadState,
  useSmartDownload,
  useEpisodeDownloadStatus,
} from "./context";

// ─── Adapter Interface ───
export type {
  IDownloaderAdapter,
  DownloadOptions,
  DownloadInstance,
} from "./adapter";

// ─── Toast system — trigger download toasts from anywhere ───
export { downloadToast } from "../../components/DownloadToast";
export type { ToastType, ToastEvent } from "../../components/DownloadToast";

// ─── DEPRECATED: Remove after one release cycle ───
/** @deprecated Use DownloadManager via useDownloadInfra() */
export function createDownloadEngine(): never {
  throw new Error(
    "[Filmsnaps] createDownloadEngine() has been removed. " +
      "Use DownloadManager via useDownloadInfra() instead.",
  );
}
