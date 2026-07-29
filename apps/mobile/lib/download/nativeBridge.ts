import { NativeModules, NativeEventEmitter } from "react-native";

const { FilmsnapsDownloader } = NativeModules;
if (!FilmsnapsDownloader) {
  throw new Error("[FilmsnapsDownloader] Native module not found.");
}

const emitter = new NativeEventEmitter(FilmsnapsDownloader);

/**
 * NOTE: as of the ForegroundService rewrite, every byte value coming from native is
 * ABSOLUTE (i.e. already includes any resume offset). Do not add offsets to these
 * values on the JS side — that arithmetic used to live in two places at once
 * (Kotlin cursor + nativeAdapter.ts) and disagreeing about it is what caused the
 * corrupted-offset and stuck-at-0-bytes bugs. There is exactly one source of truth
 * now: bytes actually written to disk, computed once, in the service.
 */
export interface ProgressEvent {
  taskId: string;
  bytesDownloaded: number; // absolute
  bytesTotal: number; // absolute, or -1 if unknown
}

export interface CompleteEvent {
  taskId: string;
  filePath: string;
  bytesTotal: number; // absolute
}

export interface ErrorEvent {
  taskId: string;
  error: string;
  errorCode?: number;
}

export interface PausedEvent {
  taskId: string;
  bytesDownloaded: number; // absolute — this is the offset to resume from, verbatim
  bytesTotal: number;
}

export const NativeDownloadBridge = {
  start(
    taskId: string,
    url: string,
    fileName: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    return FilmsnapsDownloader.startDownload(
      taskId,
      url,
      fileName,
      headers ?? {},
    );
  },
  pause(taskId: string): Promise<void> {
    return FilmsnapsDownloader.pauseDownload(taskId);
  },
  resume(
    taskId: string,
    url: string,
    fileName: string,
    offsetBytes: number,
    headers?: Record<string, string>,
  ): Promise<string> {
    return FilmsnapsDownloader.resumeDownload(
      taskId,
      url,
      fileName,
      offsetBytes,
      headers ?? {},
    );
  },
  cancel(taskId: string): Promise<void> {
    return FilmsnapsDownloader.cancelDownload(taskId);
  },
  getAvailableStorage(): Promise<number> {
    return FilmsnapsDownloader.getAvailableStorage();
  },
  /** Task IDs the native service currently considers active. Used on cold start to
   *  reconcile the store without requiring an app restart (fixes "downloads don't
   *  appear until restart"). */
  getActiveTaskIds(): Promise<string[]> {
    return FilmsnapsDownloader.getActiveTaskIds();
  },
  onProgress(callback: (e: ProgressEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadProgress", callback);
    return () => sub.remove();
  },
  onComplete(callback: (e: CompleteEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadComplete", callback);
    return () => sub.remove();
  },
  onError(callback: (e: ErrorEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadError", callback);
    return () => sub.remove();
  },
  onPaused(callback: (e: PausedEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadPaused", callback);
    return () => sub.remove();
  },
  removeAllListeners(): void {
    emitter.removeAllListeners("onDownloadProgress");
    emitter.removeAllListeners("onDownloadComplete");
    emitter.removeAllListeners("onDownloadError");
    emitter.removeAllListeners("onDownloadPaused");
  },
};
