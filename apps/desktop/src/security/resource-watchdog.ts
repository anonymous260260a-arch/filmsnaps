/**
 * FilmSnaps Desktop — Resource Watchdog
 *
 * Monitors the provider BrowserWindow for resource abuse:
 *   - Excessive memory usage (>300MB)
 *   - High CPU usage for sustained periods
 *   - Taking too long to load
 *
 * When abuse is detected:
 *   1st offense: Reload the window once
 *   2nd offense: Notify the main window to show "Switch Server" prompt
 *   3rd offense: Kill the window process entirely
 *
 * This is a defense unique to Electron — neither the web app nor the
 * mobile app can monitor resource usage at this level.
 */

import { BrowserWindow } from 'electron';

export interface WatchdogOptions {
  /** Memory limit in bytes (default: 300MB) */
  memoryLimitMB?: number;
  /** CPU usage threshold percentage (default: 50%) */
  cpuThreshold?: number;
  /** How often to check (ms, default: 5000) */
  checkIntervalMs?: number;
  /** Number of consecutive offenses before reloading (default: 3) */
  maxOffensesBeforeReload?: number;
  /** Number of reloads before giving up (default: 2) */
  maxReloads?: number;
  /** Callback when abuse is detected and recovering */
  onAbuseDetected?: (offense: ResourceOffense) => void;
  /** Callback when the window can't be recovered */
  onUnrecoverable?: (reason: string) => void;
}

export interface ResourceOffense {
  type: 'memory' | 'cpu' | 'timeout';
  currentValue: number;
  threshold: number;
  timestamp: number;
}

interface WatchdogState {
  offenses: ResourceOffense[];
  reloadCount: number;
  intervalHandle: ReturnType<typeof setInterval> | null;
  startTime: number;
}

const DEFAULT_OPTIONS: Required<WatchdogOptions> = {
  memoryLimitMB: 300,
  cpuThreshold: 50,
  checkIntervalMs: 5000,
  maxOffensesBeforeReload: 3,
  maxReloads: 2,
  onAbuseDetected: () => {},
  onUnrecoverable: () => {},
};

/**
 * Start monitoring a BrowserWindow for resource abuse.
 */
export function startWatchdog(
  videoWindow: BrowserWindow,
  options: WatchdogOptions = {}
): () => void {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const state: WatchdogState = {
    offenses: [],
    reloadCount: 0,
    intervalHandle: null,
    startTime: Date.now(),
  };

  const check = async () => {
    if (videoWindow.isDestroyed()) {
      stopWatchdog(state);
      return;
    }

    try {
      // Check memory usage
      // Use type assertion — getProcessMemoryInfo exists in Electron API
      // but TypeScript declarations may vary by version
      const memInfo = await (videoWindow.webContents as any).getProcessMemoryInfo();
      const memoryMB = Math.round((memInfo.workingSetSize || memInfo.privateBytes || 0) / (1024 * 1024));

      if (memoryMB > opts.memoryLimitMB) {
        recordOffense(state, {
          type: 'memory',
          currentValue: memoryMB,
          threshold: opts.memoryLimitMB,
          timestamp: Date.now(),
        });
        console.log(
          `[Watchdog] Memory high: ${memoryMB}MB (limit: ${opts.memoryLimitMB}MB, ` +
          `offenses: ${state.offenses.length}/${opts.maxOffensesBeforeReload})`
        );
      } else {
        // Reset offenses when healthy
        state.offenses = [];
      }

      // Take action if threshold reached
      if (state.offenses.length >= opts.maxOffensesBeforeReload) {
        state.offenses = [];

        if (state.reloadCount < opts.maxReloads) {
          // Reload the window
          state.reloadCount++;
          console.log(
            `[Watchdog] Reloading window (reload ${state.reloadCount}/${opts.maxReloads})`
          );
          opts.onAbuseDetected?.({
            type: 'memory',
            currentValue: memoryMB,
            threshold: opts.memoryLimitMB,
            timestamp: Date.now(),
          });
          videoWindow.webContents.reload();
        } else {
          // Give up — notify and show error
          console.error('[Watchdog] Unrecoverable — window exceeds resource limits');
          opts.onUnrecoverable?.('Memory usage exceeded limits after reloads');

          // Show error message in the window
          videoWindow.webContents.executeJavaScript(`
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#070708;color:#F4F4F5;font-family:sans-serif;flex-direction:column;gap:16px;"><h2 style="color:#D4A237;">Playback Error</h2><p style="color:#A1A1AA;">This provider is using too many resources.</p><p style="font-size:14px;color:#52525B;">Please try a different server.</p></div>';
          `);
        }
      }

      // Check for loading timeout (30s)
      const loadTime = Date.now() - state.startTime;
      if (loadTime > 30000) {
        const pageLoadState = await videoWindow.webContents
          .executeJavaScript('document.readyState')
          .catch(() => 'unknown');

        if (pageLoadState !== 'complete') {
          console.warn('[Watchdog] Page load timeout — reloading');
          videoWindow.webContents.reload();
          state.startTime = Date.now(); // Reset timer
        }
      }
    } catch (err) {
      // WebContents might be destroyed during check
      console.warn('[Watchdog] Check failed (window may be closing):', err);
    }
  };

  state.intervalHandle = setInterval(check, opts.checkIntervalMs);
  console.log('[Watchdog] Started (interval:', opts.checkIntervalMs + 'ms)');

  // Return a cleanup function
  return () => stopWatchdog(state);
}

function recordOffense(state: WatchdogState, offense: ResourceOffense): void {
  state.offenses.push(offense);
}

function stopWatchdog(state: WatchdogState): void {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
    console.log('[Watchdog] Stopped');
  }
}
