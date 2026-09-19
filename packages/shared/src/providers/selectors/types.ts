/**
 * Per-direct-provider stream selection.
 *
 * Every direct provider resolves its upstream sources into one link pool via
 * resolveStreams(). How that pool is ORDERED into the playback chain (which
 * link plays first, what the fallback chain looks like) is provider-specific:
 *
 *   - "default"  — the generic quality/size/language ranker (streamSelector)
 *   - "spacedom" — server-priority order: heron's original file first, then
 *                  the 720p HLS mirrors, then the rest
 *
 * The registry entry picks one via `selection` (data-only string); the
 * selector implementations live here, keyed like the source adapters.
 */
import type { StreamLink } from "../sources/types";
import type { SelectOptions, StreamSelection } from "../streamSelector";

export interface DirectStreamSelector {
  /** Selector id — matches ProviderDefinition.selection */
  id: string;
  /**
   * Order the resolved pool into the playback chain. The returned
   * sortedLinks[0] is the champion (what plays first).
   */
  select(links: StreamLink[], options: SelectOptions): Promise<StreamSelection>;
}
