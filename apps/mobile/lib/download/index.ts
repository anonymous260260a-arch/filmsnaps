/**
 * Download System — Public API
 *
 * Engine + Store + Hooks architecture for YouTube-like download management.
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
 *   // 3. For concurrency control
 *   useDownloadQueue({ maxConcurrent: 3 });
 */

// ── Infrastructure ──
export { DownloadInfraProvider, useDownloadInfra } from './context';
export { createDownloadEngine } from './engine';
export type { IDownloadEngine } from './engine';
export { createDownloadStore, createAsyncStorageAdapter, createMemoryAdapter } from './store';
export type { IDownloadStore } from './store';

// ── Hooks ──
export { useDownloadList, formatBytes, formatDate, serverLabel } from './useDownloadList';
export { useDownload } from './useDownload';
export type { UseDownloadReturn } from './useDownload';
export { useEpisodeDownloads } from './useEpisodeDownloads';
export type { UseEpisodeDownloadsReturn } from './useEpisodeDownloads';
export { useDownloadQueue } from './useDownloadQueue';

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
} from './types';
