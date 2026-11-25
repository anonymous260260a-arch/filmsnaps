/**
 * diag — performance marks from the page into the shell's log file.
 *
 * The desktop build writes `filmsnaps.log` next to its per-user logs; the page
 * cannot see that file, so it reports what only it can measure: document boot,
 * hydration, paint, layout stability, long tasks, resource weight and heap.
 * Every mark carries a boot id, which makes a webview reload (new id, new line)
 * distinguishable from a React remount (same id).
 *
 * Only active when the shell exposes `diag` (a `--features perf` build). In a
 * shipping build the bridge has no handle and every function here returns
 * before installing an observer.
 */

const BOOT_ID = Math.random().toString(36).slice(2, 8);
const HEAP_INTERVAL_MS = 30_000;
/** Below this a long task is not worth a line. */
const LONG_TASK_MS = 100;

/** The subset of `PerformanceLongAnimationFrameTiming` this reports. */
interface LoafEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: Array<{
    invoker: string;
    sourceURL?: string;
    sourceFunctionName?: string;
    duration: number;
    forcedStyleAndLayoutDuration?: number;
  }>;
}

export function diag(event: string, data?: Record<string, unknown>): void {
  try {
    window.electronAPI?.diag?.(event, { boot: BOOT_ID, ...data });
  } catch {
    /* a diagnostic must never break the page */
  }
}

function enabled(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.electronAPI?.diag === "function"
  );
}

/** Milliseconds since navigation start. */
export function since(): number {
  return Math.round(performance.now());
}

/** Reports `label` with how long it took since `startedAt` (a `since()` value). */
export function reportTiming(
  label: string,
  startedAt: number,
  data?: Record<string, unknown>,
): void {
  diag(label, { ms: since() - startedAt, ...data });
}

function observe(
  type: string,
  handle: (entries: PerformanceEntry[]) => void,
): void {
  try {
    const observer = new PerformanceObserver((list) =>
      handle(list.getEntries()),
    );
    observer.observe({ type, buffered: true } as PerformanceObserverInit);
  } catch {
    /* the entry type is unsupported in this webview */
  }
}

export function reportBoot(): void {
  if (!enabled()) return;

  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;

  diag("boot", {
    now: since(),
    redirect: nav ? Math.round(nav.redirectEnd) : undefined,
    request: nav ? Math.round(nav.requestStart) : undefined,
    ttfb: nav ? Math.round(nav.responseStart) : undefined,
    response: nav ? Math.round(nav.responseEnd) : undefined,
    dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined,
    load: nav ? Math.round(nav.loadEventEnd) : undefined,
    transfer: nav?.transferSize,
    decoded: nav?.decodedBodySize,
  });

  const paints = new Set<string>();
  observe("paint", (entries) => {
    for (const entry of entries) {
      if (paints.has(entry.name)) continue;
      paints.add(entry.name);
      diag("paint", { name: entry.name, at: Math.round(entry.startTime) });
    }
  });

  observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1] as
      | (PerformanceEntry & { size?: number; element?: Element })
      | undefined;
    if (!last) return;
    diag("lcp", {
      at: Math.round(last.startTime),
      ms: Math.round(last.startTime),
      size: last.size,
      element: last.element?.tagName,
    });
  });

  // Cumulative layout shift is only meaningful as a total, so it is reported
  // once when the page goes away.
  let shift = 0;
  observe("layout-shift", (entries) => {
    for (const entry of entries as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
    })[]) {
      if (!entry.hadRecentInput) shift += entry.value;
    }
  });

  observe("longtask", (entries) => {
    for (const entry of entries) {
      if (entry.duration < LONG_TASK_MS) continue;
      diag("longtask", {
        at: Math.round(entry.startTime),
        ms: Math.round(entry.duration),
      });
    }
  });

  // A bare long task says the frame stalled but not why. Long animation frames
  // name the scripts that ran in it, including the ones that forced layout.
  observe("long-animation-frame", (entries) => {
    for (const entry of entries as LoafEntry[]) {
      if (entry.duration < LONG_TASK_MS) continue;
      diag("loaf", {
        at: Math.round(entry.startTime),
        ms: Math.round(entry.duration),
        block: Math.round(entry.blockingDuration ?? 0),
        scripts: (entry.scripts ?? []).slice(0, 3).map((script) => ({
          invoker: script.invoker,
          fn: script.sourceFunctionName || script.sourceURL?.split("/").pop(),
          ms: Math.round(script.duration),
          forced: Math.round(script.forcedStyleAndLayoutDuration ?? 0),
        })),
      });
    }
  });

  const summarizeResources = () => {
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    let bytes = 0;
    for (const entry of entries) bytes += entry.transferSize || 0;
    const slowest = entries
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 6)
      .map((entry) => ({
        name: entry.name.split("/").pop()?.split("?")[0],
        ms: Math.round(entry.duration),
        kb: Math.round((entry.transferSize || 0) / 1024),
      }));
    diag("resources", {
      count: entries.length,
      kb: Math.round(bytes / 1024),
      slowest,
    });
  };
  if (document.readyState === "complete") {
    setTimeout(summarizeResources, 0);
  } else {
    window.addEventListener("load", () => setTimeout(summarizeResources, 0), {
      once: true,
    });
  }

  const reportHeap = () => {
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;
    if (!memory) return;
    diag("heap", {
      usedMb: Math.round(memory.usedJSHeapSize / 1048576),
      limitMb: Math.round(memory.jsHeapSizeLimit / 1048576),
    });
  };
  reportHeap();
  setInterval(reportHeap, HEAP_INTERVAL_MS);

  window.addEventListener("pagehide", () => {
    diag("cls", { value: Math.round(shift * 1000) / 1000 });
  });
}
