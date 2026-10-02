/**
 * SourceContext — the direct player's stream/link list, published outward.
 *
 * Deliberately SEPARATE from PlayerProvider: probe statuses and the active
 * link index change while playback runs, and PlayerProvider's value feeds the
 * entire watch tree. Only the below-player hub (and the source picker) care
 * about sources, so this keeps the churn off every other consumer.
 *
 * The publisher is DirectVideoPlayer; the consumers are PlayerHub's Sources
 * tab. Both live inside PlayerProvider's subtree.
 */

"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { ProbeOutcome } from "@/lib/probeStream";
import type { StreamLink } from "./StreamPickerSheet";

export interface SourceState {
  /** Every stream the API returned, in selector order. */
  links: StreamLink[];
  /** Index of the source currently playing. */
  activeIndex: number;
  /** Index the smart selector would pick (the "Best for you" badge). */
  recommendedIndex?: number;
  /** Index of the source last used for this title, when remembered. */
  lastUsedIndex?: number | null;
  /** Probe verdict per index — playback failures always read as "dead". */
  statuses?: Map<number, ProbeOutcome>;
  /** Rank per link id from the smart selector — drives row order. */
  rankById?: Map<string, number>;
  /** Human-readable reason the auto-pick chose the current source. */
  selectionReason?: string;
  /** Switch playback to `index` (same flow as the in-player picker). */
  select: (index: number) => void;
  /** Clear probe results and re-probe every link. */
  retest?: () => void;
}

// Two contexts, not one: the value changes whenever a probe result or the
// active source lands, and DirectVideoPlayer (a very large component) only
// needs the stable `publish` function. Splitting keeps it off the value's
// subscriber list so publishing can't bounce the player itself.
const SourceStateContext = createContext<SourceState | null>(null);
const SourcePublishContext = createContext<
  ((next: SourceState | null) => void) | null
>(null);

export function SourceProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<SourceState | null>(null);
  const publish = useCallback(
    (next: SourceState | null) => setSource(next),
    [],
  );

  return (
    <SourcePublishContext.Provider value={publish}>
      <SourceStateContext.Provider value={source}>
        {children}
      </SourceStateContext.Provider>
    </SourcePublishContext.Provider>
  );
}

/**
 * Read the published source state. Returns null when no direct player is
 * mounted (embed provider, loading, or no playable links) — callers must
 * treat null as "no Sources tab".
 */
export function useSource(): SourceState | null {
  return useContext(SourceStateContext);
}

/** Publisher side. Only DirectVideoPlayer calls this. */
export function useSourcePublisher(): (next: SourceState | null) => void {
  const publish = useContext(SourcePublishContext);
  if (!publish) {
    throw new Error("useSourcePublisher must be used within a SourceProvider");
  }
  return publish;
}
