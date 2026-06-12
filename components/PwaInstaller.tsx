'use client';

import { useEffect, useState } from 'react';
import { Download, X, Share2 } from 'lucide-react';

/**
 * PWA Setup — registers service worker and shows install prompts.
 */
export function PwaInstaller() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    // ── Register service worker ──
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => console.log('[PWA] SW registered'))
        .catch((err) => console.warn('[PWA] SW registration failed:', err));
    }

    // ── iOS Safari — show manual install instructions ──
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as any).MSStream;
    const isStandalone = window.matchMedia(
      '(display-mode: standalone)',
    ).matches;
    if (isIOS && !isStandalone && !localStorage.getItem('pwa-ios-dismissed')) {
      setShowIOS(true);
    }

    // ── Capture install prompt (Chrome/Edge/Android) ──
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () =>
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  // ── Chrome/Edge install banner ──
  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  const hideBanner = () => {
    setInstallPrompt(null);
    sessionStorage.setItem('pwa-install-dismissed', 'true');
  };

  const isDismissed =
    typeof window !== 'undefined' &&
    sessionStorage.getItem('pwa-install-dismissed') === 'true';

  const hideIOS = () => {
    setShowIOS(false);
    try {
      localStorage.setItem('pwa-ios-dismissed', 'true');
    } catch {}
  };

  const isStandalone =
    typeof window !== 'undefined' &&
    window.matchMedia('(display-mode: standalone)').matches;

  return (
    <>
      {/* Chrome/Edge/Android install prompt */}
      {installPrompt && !isDismissed && !isStandalone && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-3 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Download size={18} className="text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Install FilmSnaps</p>
              <p className="text-xs text-zinc-400 truncate">
                Get the app for a better experience
              </p>
            </div>
            <button
              onClick={handleInstall}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors active:scale-95"
            >
              Install
            </button>
            <button
              onClick={hideBanner}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* iOS Safari install instructions */}
      {showIOS && !isStandalone && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-start gap-3 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Share2 size={18} className="text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white mb-1">Install FilmSnaps</p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Tap{' '}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  <Share2 size={11} />
                  Share
                </span>{' '}
                then <strong className="text-zinc-300">Add to Home Screen</strong>
              </p>
            </div>
            <button
              onClick={hideIOS}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
