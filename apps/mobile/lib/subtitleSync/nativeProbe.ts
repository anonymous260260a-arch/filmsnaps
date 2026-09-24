import { probeAsync } from "expo-subtitle-sync";

/**
 * Thin internal bridge to the native playlist probe.
 *
 * source.ts loads this with a lazy `require()` (never a top-level import) so
 * the pure-ts engine stays unit-testable without the native module. Vitest
 * intercepts requires of internal modules (but NOT of external packages), so
 * tests mock this file instead of "expo-subtitle-sync" directly.
 */
export function probe(uri: string, headers: Record<string, string>) {
  return probeAsync(uri, { headers });
}
