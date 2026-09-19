/**
 * Stream source adapter registry.
 *
 * Maps source IDs to their adapter implementations.
 * New upstream APIs: add an adapter here and register it.
 */
import { hdhubAdapter } from "./hdhub";
import { falixAdapter } from "./falix";
import { spacedomAdapter } from "./spacedom";
import { way2moviesAdapter } from "./way2movies";
import type { StreamSourceAdapter } from "./types";

const adapters = new Map<string, StreamSourceAdapter>();

// Register built-in adapters
adapters.set("hdhub", hdhubAdapter);
adapters.set("falix", falixAdapter);
adapters.set("spacedom", spacedomAdapter);
adapters.set("way2movies", way2moviesAdapter);

/**
 * Get a stream source adapter by its id.
 * @throws if no adapter is registered for the given id
 */
export function getStreamSourceAdapter(id: string): StreamSourceAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`No stream source adapter registered for: ${id}`);
  }
  return adapter;
}

/**
 * Register a custom stream source adapter.
 * Useful for testing or runtime-registered adapters.
 */
export function registerStreamSourceAdapter(
  adapter: StreamSourceAdapter,
): void {
  adapters.set(adapter.id, adapter);
}

/**
 * Check if an adapter is registered for a given source id.
 */
export function hasStreamSourceAdapter(id: string): boolean {
  return adapters.has(id);
}

export { hdhubAdapter, falixAdapter, spacedomAdapter, way2moviesAdapter };
