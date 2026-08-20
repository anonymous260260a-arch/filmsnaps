/**
 * Downloader Adapter — Interface for pluggable download engines.
 *
 * Abstracts the native download implementation so it can be replaced
 * in the future without changing the manager or hooks.
 */

export interface DownloadOptions {
  url: string;
  filePath: string;
  headers?: Record<string, string>;
  /** Speed limit in bytes per second (0 = unlimited) */
  speedLimit?: number;
  /** Optional external ID — used to align adapter instance ID with Manager task ID */
  externalId?: string;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onDone?: (filePath: string) => void;
  onError?: (error: Error) => void;
}

export interface DownloadInstance {
  id: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
}

export interface IDownloaderAdapter {
  /**
   * Start a new download
   */
  download(options: DownloadOptions): Promise<DownloadInstance>;

  /**
   * Resume an existing download via the native module.
   * Uses stored resume data (iOS URLSession) or Range header (Android DownloadManager).
   */
  resumeDownload(
    taskId: string,
    url: string,
    fileName: string,
    offsetBytes: number,
    options: Pick<DownloadOptions, "onProgress" | "onDone" | "onError">,
  ): Promise<DownloadInstance>;

  /**
   * Check if a task is currently tracked by this adapter (active and not settled).
   */
  hasActiveTask(taskId: string): boolean;

  /**
   * Get the file path where a completed download will be stored.
   */
  getDestinationPath(fileName: string): string;

  /**
   * Check if the adapter supports background downloads
   */
  supportsBackground(): boolean;

  /**
   * Get available storage space in bytes.
   * Returns both `free` (available/usable) and `total` (device capacity).
   */
  getAvailableStorage(): Promise<{ free: number; total: number }>;

  /**
   * Clean up resources
   */
  destroy(): Promise<void>;
}
