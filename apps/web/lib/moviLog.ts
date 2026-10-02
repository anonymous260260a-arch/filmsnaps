/**
 * moviLog — diagnostics for the movi-player web engine.
 *
 * Two things are off by default and both were needed to answer "why is
 * playback choppy?":
 *
 * 1. The bundled entry points route every log line through
 *    `globalThis.__movilog?.(…)`, which the package itself never assigns
 *    (node_modules/movi-player/dist/element.slim.js:6-12). Setting the sink
 *    is enough — the element constructor already forces LogLevel.DEBUG. Without
 *    it, `Configured: … hwAccel=…`, `Hardware decode unavailable for …`,
 *    `Stall detected`, `Backpressure during sync` and `Frame queue overflow,
 *    dropping frame` are all silently dropped.
 *
 * 2. Nothing measured whether frames were actually being PRESENTED, and once
 *    it did, every movi counter read 0: `getFrameStats()` is stuck at
 *    `{presented:0, dropped:0}`, `lastPresentedPts` never leaves -1 and
 *    `onFramePresented` never fires. Two code paths explain it —
 *    `CanvasRenderer.render()` (CanvasRenderer.js:2093) draws without touching
 *    any of those counters, and `startPresentationLoop()` bails when
 *    `isVideoConfigured` is false (CanvasRenderer.js:2139).
 *
 *    So the probe reports the things that cannot lie, once a second:
 *
 *      dec    frames the decoder produced
 *      q      frame-queue depth now / max this second (sampled every rAF)
 *      ct     renderer.currentTime — how far presentation itself has advanced
 *      loop   presentation loop's rAF handle is live and isPlaying
 *      cfg    renderer.isVideoConfigured
 *      mov    did the canvas's pixels change since the previous second
 *      hold   consecutive seconds the canvas did not change
 *      raf    main-thread pacing, and the worst single frame time
 *
 *    loop=1 with mov=0/hold≥2 → loop runs but presents nothing
 *    loop=0 while playing     → nothing is presenting at all
 *    mov=1 every second with ct frozen → something else is drawing the canvas
 *
 * Dev-only by default; `?movilog` in the URL (persisted to localStorage) turns
 * it on for a production build too, so a phone can be profiled over the LAN.
 */

"use client";

const SINK_KEY = "fsMovilog";

function wantsLogs(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).has("movilog")) {
      window.localStorage.setItem(SINK_KEY, "1");
      return true;
    }
    return window.localStorage.getItem(SINK_KEY) === "1";
  } catch {
    return false;
  }
}

/** Idempotent. Safe to call before movi is imported. */
export function enableMoviLogs(): void {
  if (typeof globalThis === "undefined") return;
  if (!wantsLogs()) return;
  if (!(globalThis as Record<string, unknown>).__movilog) {
    (globalThis as Record<string, unknown>).__movilog = console;
  }
}

export function isQoeEnabled(): boolean {
  return wantsLogs();
}

interface QoeSample {
  prevAt: number;
  prevRaf: number;
  rafFrames: number;
  rafMissed: number;
  rafMaxDt: number;
  prevDecoded: number | null;
  dumped: boolean;
}

/**
 * Start sampling an attached <movi-player>. Returns a stop function.
 *
 * The interesting question turned out to be not "how fast is the decoder"
 * (steady, ~source rate) but "is the presentation loop running at all".
 * `getFrameStats()` stays at `{presented:0, dropped:0}`, `lastPresentedPts`
 * stays at -1 and `onFramePresented` never fires — so the counters that every
 * other diagnostic reads are all inert here. This probe therefore samples the
 * things that cannot lie: the renderer's queue depth and `currentTime` read
 * every rAF, and the canvas pixels themselves.
 *
 * Deliberately defensive: a diagnostics hook must never be the thing that
 * breaks playback.
 */
export function startMoviQoeProbe(element: HTMLElement | null): () => void {
  if (!element || !wantsLogs()) return () => {};

  const el = element as any;
  const player = el.player;
  if (!player) return () => {};

  const s: QoeSample = {
    prevAt: performance.now(),
    prevRaf: performance.now(),
    rafFrames: 0,
    rafMissed: 0,
    rafMaxDt: 0,
    prevDecoded: null,
    dumped: false,
  };

  let stopped = false;
  let qNow = 0;
  let qMax = 0;
  let presentedMediaTime = 0;

  // Ground truth independent of every movi counter: is the canvas actually
  // changing? Sampled from inside rAF so the WebGL drawing buffer has been
  // drawn this frame but not yet composited away — reading it from a plain
  // interval usually returns a cleared (all-black) buffer.
  let sigCanvas: HTMLCanvasElement | null = null;
  let sigCtx: CanvasRenderingContext2D | null = null;
  let prevSig: string | null = null;
  let lastCanvasAt = 0;
  let holdRun = 0;
  let lastMov = -1;

  const findCanvas = (): HTMLCanvasElement | null => {
    if (sigCanvas && sigCanvas.isConnected) return sigCanvas;
    sigCanvas =
      el.shadowRoot?.querySelector("canvas") ?? el.querySelector("canvas");
    return sigCanvas;
  };

  const checkCanvas = (now: number) => {
    if (now - lastCanvasAt < 1000) return;
    lastCanvasAt = now;
    const src = findCanvas();
    if (!src || !src.width || !src.height) {
      lastMov = -1;
      return;
    }
    if (!sigCtx) {
      const off = document.createElement("canvas");
      off.width = 16;
      off.height = 16;
      sigCtx = off.getContext("2d", { willReadFrequently: true });
    }
    if (!sigCtx) return;
    try {
      sigCtx.drawImage(src, 0, 0, 16, 16);
      const d = sigCtx.getImageData(0, 0, 16, 16).data;
      let sig = 0;
      for (let i = 0; i < d.length; i += 4) {
        sig = (sig * 31 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) | 0;
      }
      const next = String(sig);
      if (prevSig === null) {
        prevSig = next;
        lastMov = -1;
      } else if (next === prevSig) {
        holdRun++;
        lastMov = 0;
      } else {
        holdRun = 0;
        lastMov = 1;
        prevSig = next;
      }
    } catch {
      lastMov = -1;
    }
  };

  // rAF pacing: says whether the main thread keeps up with the compositor,
  // independent of what the decoder and renderer are doing.
  const raf = () => {
    if (stopped) return;
    const now = performance.now();
    checkCanvas(now);
    const rend = el.player?.videoRenderer;
    if (rend) {
      qNow = rend.frameQueue?.length ?? 0;
      if (qNow > qMax) qMax = qNow;
      if (typeof rend.currentTime === "number") {
        presentedMediaTime = rend.currentTime;
      }
    }
    const dt = now - s.prevRaf;
    s.prevRaf = now;
    // Ignore the first frame: it measures time since start, not pacing.
    if (dt > 0 && dt < 1000) {
      s.rafFrames++;
      if (dt > s.rafMaxDt) s.rafMaxDt = dt;
      // 60Hz budget is 16.67ms; two frames' worth is a missed vsync.
      if (dt > 33.4) s.rafMissed++;
    }
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  const sample = () => {
    if (stopped) return;
    try {
      const p = el.player;
      if (!p) return;
      const now = performance.now();
      const wallSec = (now - s.prevAt) / 1000;
      s.prevAt = now;

      let stats: any = {};
      try {
        stats = p.getStats?.() ?? {};
      } catch {
        /* older builds don't expose it */
      }

      const rend: any = p.videoRenderer;
      const decoded = toNum(stats["Frames Decoded"]);
      const decFps = fpsDelta(decoded, s.prevDecoded, wallSec);
      s.prevDecoded = decoded;

      const rafFps = wallSec > 0 ? s.rafFrames / wallSec : 0;
      const rafMax = s.rafMaxDt;
      const rafMissPct =
        s.rafFrames > 0 ? (s.rafMissed / s.rafFrames) * 100 : 0;
      s.rafFrames = 0;
      s.rafMissed = 0;
      s.rafMaxDt = 0;

      const state = p.getState?.() ?? "?";
      // Presentation loop alive? `rafId` is a live rAF handle while running
      // and null once stopPresentationLoop() has run (CanvasRenderer.js:2181).
      const loopOn = rend
        ? rend.rafId !== null && rend.isPlaying === true
        : false;
      const configured = rend ? rend.isVideoConfigured === true : false;

      // `info`, not `debug`: DevTools hides Verbose by default, and a
      // diagnostic nobody can see is a diagnostic that doesn't exist.
      console.info(
        `[QoE] dec=${decFps.toFixed(1)}` +
          ` q=${qNow}/${qMax}` +
          ` ct=${presentedMediaTime.toFixed(2)}` +
          ` loop=${loopOn ? 1 : 0}` +
          ` cfg=${configured ? 1 : 0}` +
          ` mov=${lastMov}` +
          ` hold=${holdRun}` +
          ` raf=${rafFps.toFixed(1)}` +
          ` max=${rafMax.toFixed(1)}` +
          ` miss=${rafMissPct.toFixed(0)}%` +
          ` ${state}`,
      );
      qMax = 0;

      if (!s.dumped) {
        s.dumped = true;
        const found = findCanvas();
        console.info(
          "[QoE] api",
          JSON.stringify({
            player: p.constructor?.name ?? null,
            renderer: rend?.constructor?.name ?? stats["Renderer"] ?? null,
            hw: stats["Video Decoder"] ?? null,
            res: stats["Resolution"] ?? null,
            frameStats: safeRead(() => rend?.getFrameStats?.()),
            lastPts: safeRead(() => rend?.lastPresentedPts ?? null),
            canvasIsRenderers: !!found && found === rend?.canvas,
            canvasSize: found ? `${found.width}x${found.height}` : null,
            canvasWhere: found
              ? `${found.parentElement?.className || "no-parent"}/${found.className || "no-class"}`
              : null,
            statsKeys: Object.keys(stats),
          }),
        );
      }
    } catch (err) {
      console.warn("[QoE] sample failed:", err);
    }
  };

  const timer = window.setInterval(sample, 1000);
  sample();

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

function safeRead<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Frames/second between two cumulative counters; 0 when either is unknown. */
function fpsDelta(
  cur: number | null,
  prev: number | null,
  wallSec: number,
): number {
  if (cur === null || prev === null || wallSec <= 0) return 0;
  const d = cur - prev;
  // Negative means the counter reset (seek/reload) — report nothing rather
  // than a nonsense spike.
  return d >= 0 ? d / wallSec : 0;
}
