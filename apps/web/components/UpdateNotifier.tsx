'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, RefreshCw, AlertCircle, CheckCircle, X } from 'lucide-react';

type UpdateStatus =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes?: string }
  | { type: 'downloading'; percent: number; bytesPerSecond: number; total: number; transferred: number }
  | { type: 'downloaded'; version: string }
  | { type: 'not-available' }
  | { type: 'error'; message: string };

/**
 * Desktop update notifier — listens for auto-update events from Electron
 * and shows a banner when an update is available, downloading, or ready.
 */
export function UpdateNotifier() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onUpdateStatus) return;

    const listener = (s: UpdateStatus) => {
      setStatus(s);
      if (s.type === 'not-available') {
        // Auto-dismiss after 3s
        setTimeout(() => setDismissed(true), 3000);
      }
    };

    window.electronAPI?.onUpdateStatus(listener);
    return () => window.electronAPI?.removeUpdateStatusListener?.();
  }, []);

  const handleInstall = useCallback(() => {
    window.electronAPI?.quitAndInstall();
  }, []);

  const handleCheck = useCallback(() => {
    window.electronAPI?.checkForUpdates();
    setDismissed(false);
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (dismissed || !status) return null;

  // ── Checking ──
  if (status.type === 'checking') {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 max-w-sm animate-in slide-in-from-bottom-2">
        <RefreshCw className="w-4 h-4 text-zinc-400 animate-spin" />
        <span className="text-zinc-300 text-sm">Checking for updates...</span>
      </div>
    );
  }

  // ── Downloading with progress ──
  if (status.type === 'downloading') {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-xl px-4 py-3 shadow-2xl max-w-sm">
        <div className="flex items-center gap-3 mb-2">
          <Download className="w-4 h-4 text-amber-400" />
          <span className="text-zinc-200 text-sm font-semibold">
            Downloading update...
          </span>
          <span className="text-amber-400 text-xs font-bold ml-auto">
            {status.percent}%
          </span>
        </div>
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-300"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      </div>
    );
  }

  // ── Downloaded — ready to install ──
  if (status.type === 'downloaded') {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-zinc-900/95 backdrop-blur-xl border border-emerald-800/50 rounded-xl p-4 shadow-2xl max-w-sm animate-in slide-in-from-bottom-2">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-zinc-100 text-sm font-semibold mb-1">
              Update v{status.version} ready
            </p>
            <p className="text-zinc-500 text-xs mb-3">
              Restart to install the latest update
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleInstall}
                className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold px-4 py-1.5 rounded-lg transition-all active:scale-95"
              >
                Restart & Update
              </button>
              <button
                onClick={handleDismiss}
                className="text-zinc-500 hover:text-zinc-300 text-xs px-3 py-1.5 rounded-lg transition-all"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (status.type === 'error') {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-zinc-900/95 backdrop-blur-xl border border-red-900/50 rounded-xl p-4 shadow-2xl max-w-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-zinc-100 text-sm font-semibold mb-1">
              Update failed
            </p>
            <p className="text-zinc-500 text-xs mb-3">
              {status.message || 'Could not check for updates'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCheck}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold px-4 py-1.5 rounded-lg transition-all active:scale-95"
              >
                Try Again
              </button>
              <button
                onClick={handleDismiss}
                className="text-zinc-500 hover:text-zinc-300 text-xs px-3 py-1.5 rounded-lg transition-all"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
