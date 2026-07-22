/**
 * Download System — Shared Types
 *
 * Core types for the Engine + Store + Hooks download architecture.
 * No runtime code — pure type definitions.
 */

export type DownloadStatus =
  | 'pending'       // Created, waiting for a queue slot
  | 'downloading'   // Actively downloading bytes
  | 'paused'        // Paused with resumeData saved for true resume
  | 'completed'     // Finished successfully
  | 'failed'        // Finished with error
  | 'cancelled';    // User-cancelled, partial file cleaned

export type DownloadServer = 'falix' | 'nxsha' | 'alt-dl';
export type MediaType = 'movie' | 'tv';

/** What callers provide when enqueuing a download */
export interface DownloadMeta {
  url: string;
  fileName: string;
  server: DownloadServer;
  mediaType?: MediaType;
  tmdbId?: string;
  quality?: string;
  title?: string;
  posterPath?: string;
  season?: number;
  episode?: number;
  extension?: string;
}

/** Full task record — persisted and observable */
export interface DownloadTask extends DownloadMeta {
  id: string;
  fileUri: string | null;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  error?: string;
  /** Opaque token from expo-file-system for true byte-level resume */
  resumeData?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Control action for batch operations */
export type ControlAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove';

/** Target for batch control — single ID, array, or status filter */
export type ControlTarget =
  | string
  | string[]
  | { status?: DownloadStatus | DownloadStatus[] };

/** Progress event payload */
export interface DownloadProgress {
  taskId: string;
  receivedBytes: number;
  totalBytes: number;
}

/** Status change event payload */
export interface StatusChange {
  taskId: string;
  status: DownloadStatus;
  error?: string;
}

/** Aggregate progress for batch operations (e.g. all episodes of a season) */
export interface AggregateProgress {
  totalBytes: number;
  receivedBytes: number;
  fraction: number;        // 0-1
  activeCount: number;
  totalCount: number;
  completedCount: number;
}

/** Grouped download state for the list hook */
export interface DownloadGrouped {
  all: DownloadTask[];
  active: DownloadTask[];
  paused: DownloadTask[];
  completed: DownloadTask[];
  failed: DownloadTask[];
  cancelled: DownloadTask[];
}

/** Unsubscribe function returned by event subscriptions */
export type Unsubscribe = () => void;

/** Swappable storage adapter for persistence */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
