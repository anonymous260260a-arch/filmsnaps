/**
 * probeCache — module-level stream-verdict cache shared by the player and the
 * prefetch pipeline.
 *
 * Design (mirrors mobile's streamValidator cache):
 * - One verdict per URL, so a link probed while hovering a card is already
 *   green/red when the watch page opens — no second network round-trip.
 * - TTLs: valid 90s, dead 60s. "unknown" is NEVER cached — it means timeout,
 *   rate limit or a network flake, and must be retried fresh.
 * - In-flight dedup: N callers asking about the same URL share one request.
 * - Desktop probes through the main process (mpv IPC, no CORS, inspects the
 *   actual bytes); web falls back to the renderer fetch probe.
 */

import type { ProbeOutcome } from "./probeStream";

const VALID_TTL_MS = 90 * 1000;
const DEAD_TTL_MS = 60 * 1000;

interface CacheEntry {
  outcome: ProbeOutcome;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ProbeOutcome>>();

function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as any).electronAPI?.isDesktop === true
  );
}

async function probeViaDesktop(
  url: string,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const mpv = (window as any).electronAPI?.mpv;
  if (!mpv?.probe) return "unknown";
  try {
    const result = await mpv.probe(url, timeoutMs);
    // "alive" is the legacy main-process verdict — map it defensively.
    if (result === "valid" || result === "alive") return "valid";
    if (result === "dead") return "dead";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function probeViaRenderer(
  url: string,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const m = await import("@/lib/probeStream");
  return m.probeStream(url, timeoutMs);
}

function fresh(entry: CacheEntry | undefined): ProbeOutcome | undefined {
  if (!entry) return undefined;
  const ttl = entry.outcome === "valid" ? VALID_TTL_MS : DEAD_TTL_MS;
  if (Date.now() - entry.at > ttl) {
    return undefined; // expired — caller treats as absent
  }
  return entry.outcome;
}

/**
 * Probe a URL (cached, deduped). Unknown outcomes are not cached.
 */
export function probeUrl(url: string, timeoutMs = 6000): Promise<ProbeOutcome> {
  if (!url) return Promise.resolve("unknown");

  const cached = fresh(cache.get(url));
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(url);
  if (existing) return existing;

  const p = (
    isDesktop()
      ? probeViaDesktop(url, timeoutMs)
      : probeViaRenderer(url, timeoutMs)
  )
    .then((outcome) => {
      if (outcome !== "unknown") {
        cache.set(url, { outcome, at: Date.now() });
      } else {
        cache.delete(url); // expired entry from an earlier round — drop it
      }
      return outcome;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, p);
  return p;
}

/** Synchronous cache read — for rendering statuses without probing. */
export function getCachedProbe(url: string): ProbeOutcome | undefined {
  return fresh(cache.get(url));
}

/** Drop the verdict for a URL — playback just proved it wrong. */
export function invalidateProbe(url: string): void {
  if (url) cache.delete(url);
}

/**
 * Probe a list of URLs with bounded concurrency, reporting each verdict by
 * index as it lands. Used for the source-picker sweep and prefetch warm-up.
 */
export async function probeUrls(
  urls: string[],
  onProgress: (index: number, outcome: ProbeOutcome) => void,
  concurrency = 5,
): Promise<void> {
  const queue = urls.map((url, index) => ({ url, index }));
  const workers: Promise<void>[] = [];

  async function runWorker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const outcome = await probeUrl(item.url);
      onProgress(item.index, outcome);
    }
  }

  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(runWorker());
  }
  await Promise.allSettled(workers);
}
