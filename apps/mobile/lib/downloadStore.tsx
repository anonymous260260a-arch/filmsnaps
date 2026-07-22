/**
 * DownloadStore — Global download manager with AsyncStorage persistence.
 *
 * Provides React Context for tracking all download tasks across the app.
 * Handles start, cancel, retry, and cleanup of native file downloads
 * via expo-file-system (legacy).
 *
 * Usage:
 *   const { startDownload, downloads } = useDownloadContext()
 *   startDownload({ url, fileName, server: 'falix', quality: '1080p', ... })
 *   cancelDownload(task.id)
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  documentDirectory,
  createDownloadResumable,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  DownloadResumable,
} from 'expo-file-system/legacy';

// ── Constants ──

const STORAGE_KEY = '@filmsnaps/downloads/v1';
const DOWNLOAD_DIR = (documentDirectory ?? '') + 'downloads/';

// ── Types ──

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
export type DownloadServer = 'falix' | 'nxsha' | 'alt-dl';

export interface DownloadTask {
  id: string;
  /** Display filename (may differ from saved file) */
  fileName: string;
  /** Full URI where the file is saved on device */
  fileUri: string | null;
  /** Source URL being downloaded from */
  url: string;
  /** Expected total bytes (0 if unknown) */
  totalBytes: number;
  /** Bytes received so far */
  receivedBytes: number;
  /** Current status */
  status: DownloadStatus;
  /** Error message if failed */
  error?: string;
  /** Timestamp when the task was created */
  createdAt: number;
  /** Which server/backend the download comes from */
  server: DownloadServer;
  /** Media type */
  mediaType?: 'movie' | 'tv';
  /** TMDB ID for linking back */
  tmdbId?: string;
  /** Quality label e.g. "1080p" */
  quality?: string;
  /** Poster or thumbnail URL */
  posterPath?: string;
  /** Display title */
  title?: string;
  /** Season number (for TV) */
  season?: number;
  /** Episode number (for TV) */
  episode?: number;
  /** File extension */
  extension?: string;
}

interface DownloadState {
  tasks: DownloadTask[];
  loaded: boolean;
}

type DownloadAction =
  | { type: 'RESTORE'; tasks: DownloadTask[] }
  | { type: 'ADD_TASK'; task: DownloadTask }
  | { type: 'UPDATE_PROGRESS'; id: string; receivedBytes: number; totalBytes: number }
  | { type: 'COMPLETE'; id: string; fileUri: string }
  | { type: 'FAIL'; id: string; error: string }
  | { type: 'CANCEL'; id: string }
  | { type: 'RETRY'; id: string }
  | { type: 'REMOVE'; id: string }
  | { type: 'CLEAR_COMPLETED' };

interface DownloadContextValue {
  downloads: DownloadTask[];
  activeDownloads: DownloadTask[];
  loaded: boolean;
  startDownload: (params: StartDownloadParams) => string;
  cancelDownload: (id: string) => Promise<void>;
  retryDownload: (id: string) => Promise<void>;
  removeDownload: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
}

export interface StartDownloadParams {
  url: string;
  fileName: string;
  server: DownloadServer;
  mediaType?: 'movie' | 'tv';
  tmdbId?: string;
  quality?: string;
  posterPath?: string;
  title?: string;
  season?: number;
  episode?: number;
  extension?: string;
}

// ── Helpers ──

function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/** Ensure the downloads directory exists */
async function ensureDownloadDir(): Promise<void> {
  try {
    const info = await getInfoAsync(DOWNLOAD_DIR);
    if (!info.exists) {
      await makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
    }
  } catch {}
}

// ── Reducer ──

function downloadReducer(state: DownloadState, action: DownloadAction): DownloadState {
  switch (action.type) {
    case 'RESTORE':
      return { ...state, tasks: action.tasks, loaded: true };

    case 'ADD_TASK':
      return { ...state, tasks: [action.task, ...state.tasks] };

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, receivedBytes: action.receivedBytes, totalBytes: action.totalBytes, status: 'downloading' as DownloadStatus }
            : t,
        ),
      };

    case 'COMPLETE':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, status: 'completed' as DownloadStatus, fileUri: action.fileUri }
            : t,
        ),
      };

    case 'FAIL':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, status: 'failed' as DownloadStatus, error: action.error }
            : t,
        ),
      };

    case 'CANCEL':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, status: 'cancelled' as DownloadStatus }
            : t,
        ),
      };

    case 'RETRY':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, status: 'pending' as DownloadStatus, receivedBytes: 0, totalBytes: 0, error: undefined, fileUri: null }
            : t,
        ),
      };

    case 'REMOVE':
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.id !== action.id),
      };

    case 'CLEAR_COMPLETED':
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled'),
      };

    default:
      return state;
  }
}

// ── Context ──

const DownloadContext = createContext<DownloadContextValue | null>(null);

// ── Provider ──

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(downloadReducer, { tasks: [], loaded: false });
  const resumablesRef = useRef<Map<string, DownloadResumable>>(new Map());
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Persist to AsyncStorage ──
  const persist = useCallback(async (tasks: DownloadTask[]) => {
    // Debounce writes
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(async () => {
      try {
        const persistable = tasks.map((t) => ({ ...t }));
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
      } catch {}
    }, 500);
  }, []);

  // Auto-persist on state change
  useEffect(() => {
    if (state.loaded) {
      persist(state.tasks);
    }
  }, [state.tasks, state.loaded, persist]);

  // ── Restore on mount ──
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored: DownloadTask[] = JSON.parse(raw);
          // Reset active downloads to 'failed' since URLs may be stale
          const restored = stored.map((t) =>
            t.status === 'downloading' || t.status === 'pending'
              ? { ...t, status: 'failed' as DownloadStatus, error: 'App was closed during download. Tap retry.' }
              : t,
          );
          dispatch({ type: 'RESTORE', tasks: restored });
        } else {
          dispatch({ type: 'RESTORE', tasks: [] });
        }
      } catch {
        dispatch({ type: 'RESTORE', tasks: [] });
      }
    })();
  }, []);

  // Cleanup resumables on unmount
  useEffect(() => {
    return () => {
      resumablesRef.current.forEach((r) => {
        try { r.pauseAsync(); } catch {}
      });
    };
  }, []);

  // ── Start a new download ──
  const startDownload = useCallback((params: StartDownloadParams): string => {
    const id = generateId();
    const ext = params.extension || params.fileName.split('.').pop() || 'mp4';
    const safeFileName = params.fileName.replace(/[<>:"/\\|?*]/g, '_');
    const fileUri = DOWNLOAD_DIR + safeFileName;

    const task: DownloadTask = {
      id,
      fileName: params.fileName,
      fileUri: null,
      url: params.url,
      totalBytes: 0,
      receivedBytes: 0,
      status: 'pending',
      createdAt: Date.now(),
      server: params.server,
      mediaType: params.mediaType,
      tmdbId: params.tmdbId,
      quality: params.quality,
      posterPath: params.posterPath,
      title: params.title,
      season: params.season,
      episode: params.episode,
      extension: ext,
    };

    dispatch({ type: 'ADD_TASK', task });

    // Start the actual download
    ensureDownloadDir().then(async () => {
      console.log(`[Store DL] ensureDownloadDir OK for ${id}, url:`, params.url, `fileUri:`, fileUri);

      // Check if URL is reachable first (HEAD request)
      try {
        const probe = await fetch(params.url, { method: 'HEAD' });
        console.log(`[Store DL] HEAD ${params.url} -> status: ${probe.status}, contentType: ${probe.headers.get('content-type')}, contentLength: ${probe.headers.get('content-length')}`);
      } catch (probeErr: any) {
        console.warn(`[Store DL] HEAD probe failed for ${params.url}:`, probeErr?.message);
      }

      const download = createDownloadResumable(
        params.url,
        fileUri,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          md5: false,
        },
        (progress) => {
          const total = progress.totalBytesExpectedToWrite;
          const received = progress.totalBytesWritten;
          console.log(`[Store DL] progress ${id}: ${received}/${total} bytes (${total > 0 ? Math.round(received/total*100) : '?'}%)`);
          dispatch({ type: 'UPDATE_PROGRESS', id, receivedBytes: received, totalBytes: total });

          // Auto-complete when done
          if (total > 0 && received >= total) {
            dispatch({ type: 'COMPLETE', id, fileUri });
            try { (download as any).emitter?.removeAllListeners?.('Exponent.downloadProgress'); } catch {}
          }
        },
      );

      resumablesRef.current.set(id, download);

      console.log(`[Store DL] calling downloadAsync for ${id}...`);
      download.downloadAsync().then((result) => {
        console.log(`[Store DL] downloadAsync completed for ${id}:`, JSON.stringify({ uri: result?.uri, headersReceived: !!result }));
        if (result) {
          dispatch({ type: 'COMPLETE', id, fileUri: result.uri });
        }
      }).catch((err: any) => {
        // Check if it was intentional (cancelled)
        const taskState = state.tasks.find((t) => t.id === id);
        if (taskState?.status === 'cancelled') return;
        console.error(`[Store DL] downloadAsync FAILED for ${id}:`, err?.message, err?.stack);
        dispatch({ type: 'FAIL', id, error: err?.message || 'Download failed' });
      }).finally(() => {
        console.log(`[Store DL] cleanup for ${id}`);
        resumablesRef.current.delete(id);
      });
    }).catch((err) => {
      console.error(`[Store DL] ensureDownloadDir FAILED for ${id}:`, err.message);
      dispatch({ type: 'FAIL', id, error: `Cannot create directory: ${err.message}` });
    });

    return id;
  }, [state.tasks]);

  // ── Cancel ──
  const cancelDownload = useCallback(async (id: string) => {
    const resumable = resumablesRef.current.get(id);
    if (resumable) {
      try {
        await resumable.pauseAsync();
      } catch {}
      resumablesRef.current.delete(id);
    }

    // Delete partial file
    const task = state.tasks.find((t) => t.id === id);
    if (task?.fileUri) {
      try { await deleteAsync(task.fileUri, { idempotent: true }); } catch {}
    } else {
      const ext = task?.extension || 'mp4';
      const fileName = task?.fileName?.replace(/[<>:"/\\|?*]/g, '_') || `download_${id}`;
      try { await deleteAsync(DOWNLOAD_DIR + fileName, { idempotent: true }); } catch {}
    }

    dispatch({ type: 'CANCEL', id });
  }, [state.tasks]);

  // ── Retry ──
  const retryDownload = useCallback(async (id: string) => {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    // Delete old partial file
    if (task.fileUri) {
      try { await deleteAsync(task.fileUri, { idempotent: true }); } catch {}
    }

    dispatch({ type: 'RETRY', id });

    // Re-start with same URL
    const ext = task.extension || task.fileName.split('.').pop() || 'mp4';
    const safeFileName = task.fileName.replace(/[<>:"/\\|?*]/g, '_');
    const fileUri = DOWNLOAD_DIR + safeFileName;

    console.log(`[Store DL] retryDownload ${id}, url:`, task.url);
    ensureDownloadDir().then(() => {
      const download = createDownloadResumable(
        task.url,
        fileUri,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          md5: false,
        },
        (progress) => {
          const total = progress.totalBytesExpectedToWrite;
          const received = progress.totalBytesWritten;
          console.log(`[Store DL] retry progress ${id}: ${received}/${total}`);
          dispatch({ type: 'UPDATE_PROGRESS', id, receivedBytes: received, totalBytes: total });
          if (total > 0 && received >= total) {
            dispatch({ type: 'COMPLETE', id, fileUri });
          }
        },
      );

      resumablesRef.current.set(id, download);

      download.downloadAsync().then((result) => {
        console.log(`[Store DL] retry completed ${id}:`, result?.uri);
        if (result) {
          dispatch({ type: 'COMPLETE', id, fileUri: result.uri });
        }
      }).catch((err: any) => {
        const taskState = state.tasks.find((t) => t.id === id);
        if (taskState?.status === 'cancelled') return;
        console.error(`[Store DL] retry FAILED ${id}:`, err?.message);
        dispatch({ type: 'FAIL', id, error: err?.message || 'Download failed' });
      }).finally(() => {
        resumablesRef.current.delete(id);
      });
    }).catch((err) => {
      dispatch({ type: 'FAIL', id, error: `Cannot create directory: ${err.message}` });
    });
  }, [state.tasks]);

  // ── Remove ──
  const removeDownload = useCallback(async (id: string) => {
    const task = state.tasks.find((t) => t.id === id);
    if (task?.fileUri) {
      try { await deleteAsync(task.fileUri, { idempotent: true }); } catch {}
    }

    const resumable = resumablesRef.current.get(id);
    if (resumable) {
      try { await resumable.pauseAsync(); } catch {}
      resumablesRef.current.delete(id);
    }

    dispatch({ type: 'REMOVE', id });
  }, [state.tasks]);

  // ── Clear completed ──
  const clearCompleted = useCallback(async () => {
    const completed = state.tasks.filter((t) => t.status === 'completed');
    for (const task of completed) {
      if (task.fileUri) {
        try { await deleteAsync(task.fileUri, { idempotent: true }); } catch {}
      }
    }
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, [state.tasks]);

  const activeDownloads = state.tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'pending',
  );

  return (
    <DownloadContext.Provider
      value={{
        downloads: state.tasks,
        activeDownloads,
        loaded: state.loaded,
        startDownload,
        cancelDownload,
        retryDownload,
        removeDownload,
        clearCompleted,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}

// ── Hook ──

export function useDownloadContext(): DownloadContextValue {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownloadContext must be used within a DownloadProvider');
  }
  return context;
}
