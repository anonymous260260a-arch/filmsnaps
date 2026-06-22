/**
 * Type declarations for FilmSnaps Desktop's Electron API.
 * These are available only when running inside the Electron wrapper.
 */

type UpdateStatus =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes?: string }
  | { type: 'downloading'; percent: number; bytesPerSecond: number; total: number; transferred: number }
  | { type: 'downloaded'; version: string }
  | { type: 'not-available' }
  | { type: 'error'; message: string };

interface ElectronAPI {
  isDesktop: true;
  platform: string;
  appVersion: string;
  openVideo: (params: {
    type: 'movie' | 'tv';
    id: string;
    season?: number;
    episode?: number;
    provider: string;
    embedUrl: string;
  }) => Promise<{ success: boolean; error?: string }>;
  closeVideo: () => Promise<void>;
  onVideoClosed: (callback: () => void) => void;
  removeVideoClosedListener: () => void;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => void;
  removeUpdateStatusListener: () => void;
  checkForUpdates: () => void;
  quitAndInstall: () => void;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
