/**
 * warmMpv — pre-warm the desktop mpv pipeline from the DETAIL page.
 *
 * The watch page already pre-warms on mount (DirectVideoPlayer effect 0),
 * but by then the chain prefetch has usually resolved metadata instantly —
 * making the 1-3s mpv spawn (process + video window + IPC handshake) the
 * long pole between "Watch Now" and first frame. Warming here — while the
 * user is still reading the description — moves that cost off the play path
 * entirely: mpv is already idle (`--idle=yes`) and IPC-connected when the
 * watch page mounts, so playback is just loadfile.
 *
 * No-ops everywhere except the Electron shell (electronAPI.mpv absent on
 * web/browser). Idempotent in main: MpvManager.start() returns early when
 * the process is already running/starting, and the video window is a
 * reused singleton behind the lifecycle queue.
 */
export function warmMpv(): void {
  if (typeof window === "undefined") return;
  const mpv = (window as any).electronAPI?.mpv;
  if (!mpv?.start) return;
  mpv.start().catch(() => {
    /* warming is best-effort — the watch page's own start retries */
  });
}
