/**
 * Download System — Shared Types
 *
 * Core types for the Engine + Store + Hooks download architecture.
 * No runtime code — pure type definitions.
 */

export type DownloadStatus =
  | "pending" // Created, waiting for a queue slot
  | "downloading" // Actively downloading bytes
  | "paused" // Paused with resumeData saved for true resume
  | "completed" // Finished successfully
  | "failed" // Finished with error
  | "cancelled" // User-cancelled, partial file cleaned
  | "retrying"; // In retry backoff — will auto-resume

export type DownloadServer = "falix" | "nxsha" | "alt-dl";
export type MediaType = "movie" | "tv";

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
  /** Speed limit in bytes per second (0 = unlimited) */
  speedLimit?: number;
}

/** Full task record — persisted and observable */
export interface DownloadTask extends DownloadMeta {
  id: string;
  fileUri: string | null;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  error?: string;
  /** Opaque token for true byte-level resume */
  resumeData?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Priority: 0=high, 1=medium, 2=low */
  priority?: number;
  /** Current retry count */
  retryCount?: number;
  /** Maximum retries allowed */
  maxRetries?: number;

  // ─── NEW FIELDS ───
  /** Native download task ID from the OS download manager */
  nativeTaskId?: string | null;
  /** SHA-256 hash for integrity verification (if server provides) */
  expectedHash?: string | null;
  /** Whether download was started on WiFi (for network policy) */
  startedOnWifi?: boolean;
  /** Speed in bytes/sec (calculated, not stored — for UI only) */
  speed?: number;
  /** ETA in seconds (calculated, not stored — for UI only) */
  eta?: number;
}

/** Control action for batch operations */
export type ControlAction = "pause" | "resume" | "cancel" | "retry" | "remove";

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
  speed?: number;
  eta?: number;
}

/** Status change event payload */
export interface StatusChange {
  taskId: string;
  status: DownloadStatus;
  error?: string;
  fileUri?: string | null;
  /** Live byte counts at the time of status change — prevents stale store overwrites */
  receivedBytes?: number;
  totalBytes?: number;
  /** Authoritative real file extension (from the HTTP response) once known */
  extension?: string;
  /** When true, task was permanently removed — caller should delete from store, not upsert */
  removed?: boolean;
}

/** Aggregate progress for batch operations (e.g. all episodes of a season) */
export interface AggregateProgress {
  totalBytes: number;
  receivedBytes: number;
  fraction: number; // 0-1
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
  retrying: DownloadTask[];
}

/** Unsubscribe function returned by event subscriptions */
export type Unsubscribe = () => void;

/** Swappable storage adapter for persistence */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// ─── NEW: Network policy types ───
export type NetworkPolicy = "wifi-only" | "any" | "ask";

export interface DownloadConfig {
  maxConcurrent: number;
  networkPolicy: NetworkPolicy;
  autoRetry: boolean;
  maxRetries: number;
  showNativeNotification: boolean;
}

export const DEFAULT_CONFIG: DownloadConfig = {
  maxConcurrent: 3,
  networkPolicy: "any",
  autoRetry: true,
  maxRetries: 3,
  showNativeNotification: true,
};

// ─── NEW: User-facing quality abstraction ───

export type DownloadQuality = "hd" | "standard" | "small";

export const QUALITY_TO_SERVER: Record<DownloadQuality, DownloadServer> = {
  hd: "nxsha",
  standard: "alt-dl",
  small: "falix",
};

export const SERVER_TO_QUALITY: Record<DownloadServer, DownloadQuality> = {
  nxsha: "hd",
  "alt-dl": "standard",
  falix: "small",
};

export interface QualityOption {
  id: DownloadQuality;
  label: string;
  subtitle: string;
  icon: string;
  recommended?: boolean;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  {
    id: "hd",
    label: "HD Quality",
    subtitle: "1080p · Best experience",
    icon: "sparkles-outline",
    recommended: true,
  },
  {
    id: "standard",
    label: "Standard",
    subtitle: "720p · Balanced size",
    icon: "film-outline",
  },
  {
    id: "small",
    label: "Small File",
    subtitle: "~50% smaller · Great for storage",
    icon: "phone-portrait-outline",
  },
];

// ─── NEW: Grouped download state for detail pages ───

export type MediaDownloadState =
  | "none"
  | "downloading"
  | "partial"
  | "completed"
  | "failed";

export interface SeasonDownloadSummary {
  seasonNumber: number;
  totalEpisodes: number;
  downloadedEpisodes: number;
  downloadingEpisodes: number;
  failedEpisodes: number;
}

export interface MediaDownloadSummary {
  state: MediaDownloadState;
  totalTasks: number;
  completedTasks: number;
  activeTasks: number;
  failedTasks: number;
  totalBytes: number;
  receivedBytes: number;
  seasons?: SeasonDownloadSummary[];
}

export interface SmartDownloadConfig {
  preferredQuality: DownloadQuality;
  autoQualityOnCellular: boolean;
  wifiOnly: boolean;
}

export const DEFAULT_SMART_CONFIG: SmartDownloadConfig = {
  preferredQuality: "hd",
  autoQualityOnCellular: true,
  wifiOnly: false,
};
