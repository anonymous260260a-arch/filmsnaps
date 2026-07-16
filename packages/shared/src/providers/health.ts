/**
 * Provider health checks.
 *
 * Measures provider availability and latency so the player can
 * automatically select the best working server.
 */

import type { ProviderDefinition } from '../types/provider';

export interface HealthResult {
  /** Whether the provider responded successfully */
  alive: boolean;
  /** Round-trip latency in milliseconds (0 if unreachable) */
  latencyMs: number;
}

export type HealthCache = Map<string, HealthResult>;

// ── Check a single provider ───────────────────────────────────────

const DEFAULT_TIMEOUT = 8_000; // 8 seconds

/**
 * Check whether a provider is reachable by issuing a HEAD request
 * to its base URL.
 *
 * Uses a timeout via AbortController. Returns `{ alive: false, latencyMs: 0 }`
 * if the request fails or times out.
 */
export async function checkProviderHealth(
  provider: ProviderDefinition,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<HealthResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Combine the external signal with our timeout
    const signal = options?.signal;
    const combinedSignal = signal
      ? combineSignals(signal, controller.signal)
      : controller.signal;

    const res = await fetch(provider.baseUrl, {
      method: 'HEAD',
      signal: combinedSignal,
      mode: 'no-cors', // HEAD may be blocked by CORS on some providers
    });

    clearTimeout(timeoutId);

    const latencyMs = Math.round(performance.now() - start);

    return {
      alive: true,
      latencyMs,
    };
  } catch {
    // Timeout, network error, or abort
    return { alive: false, latencyMs: 0 };
  }
}

// ── Rank providers by health ──────────────────────────────────────

/**
 * Rank providers by health status and latency.
 *
 * Healthy providers are sorted by latency (fastest first).
 * Unhealthy providers come last.
 *
 * @param providers - The list of providers to rank
 * @param healthCache - A map of provider id → HealthResult (pre-checked)
 * @returns Providers sorted: healthy first (by latency), then unhealthy
 */
export function rankProviders(
  providers: ProviderDefinition[],
  healthCache: HealthCache,
): ProviderDefinition[] {
  return [...providers].sort((a, b) => {
    const ha = healthCache.get(a.id);
    const hb = healthCache.get(b.id);

    const aAlive = ha?.alive ?? false;
    const bAlive = hb?.alive ?? false;

    // Healthy before unhealthy
    if (aAlive !== bAlive) return aAlive ? -1 : 1;

    // Both healthy: sort by latency
    if (aAlive && bAlive) {
      return (ha?.latencyMs ?? Infinity) - (hb?.latencyMs ?? Infinity);
    }

    // Both unhealthy: preserve original order
    return 0;
  });
}

// ── Batch health check ────────────────────────────────────────────

/**
 * Check health for multiple providers in parallel.
 *
 * @returns A map of provider id → HealthResult
 */
export async function checkAllProviders(
  providers: ProviderDefinition[],
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<HealthCache> {
  const results = await Promise.allSettled(
    providers.map((p) => checkProviderHealth(p, options)),
  );

  const cache: HealthCache = new Map();
  providers.forEach((p, i) => {
    const r = results[i];
    cache.set(p.id, r.status === 'fulfilled' ? r.value : { alive: false, latencyMs: 0 });
  });

  return cache;
}

// ── Utility: combine two AbortSignals ─────────────────────────────

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    });
  }

  return controller.signal;
}
