/**
 * useDirectStreamPipeline — the mobile watch page's direct-provider state.
 *
 * Owns the "fetch ranked streams for this title" lifecycle: joins the
 * prefetch pipeline the details page / CW home may have already started
 * (or starts it here), promotes the remembered last-working source to the
 * chain head (respecting the connection cap), and exposes loading / error /
 * retry state for the player.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getProvider, isDirectProvider } from "@filmsnaps/shared";
import type { ValidationResult } from "../lib/streamValidator";
import {
  forgetWorkingSource,
  getLastWorkingSource,
} from "../lib/lastWorkingSource";
import { prefetchStreams } from "../lib/streamPrefetch";
import type { StreamLink } from "../components/player/streamTypes";

interface UseDirectStreamPipelineParams {
  /** TMDB id (string from route segments). */
  id: string | undefined;
  type: "movie" | "tv";
  /** True when a direct provider is actually in play. */
  isDirectPlayback: boolean;
  /**
   * The active direct-provider id (e.g. "direct", "spacedom"). Any registry
   * provider with `type: "direct"` fetches through the pipeline; embed
   * providers never do. Changing it re-fetches (the prefetch cache is
   * keyed per provider).
   */
  provider: string | undefined;
  /** First-run gate: nothing is ranked until the language prompt is answered. */
  languageAnswered: boolean;
  /** Initial season/episode from the route segments. */
  initialSeason?: number;
  initialEpisode?: number;
  settingsRef: React.MutableRefObject<any>;
}

export interface DirectStreamPipelineState {
  links: StreamLink[];
  bestIndex: number;
  prevalidated: Map<string, ValidationResult> | null;
  selectionReason: string;
  lastWorkingIndex: number | undefined;
  loading: boolean;
  error: string | null;
  /** Re-run the fetch pipeline (Retry / first selection on the picker). */
  refetch: () => void;
  /** Season/episode the current fetch is keyed by (EpisodeRail updates). */
  season: number | undefined;
  episode: number | undefined;
  setSeason: (s: number | undefined) => void;
  setEpisode: (e: number | undefined) => void;
}

export function useDirectStreamPipeline({
  id,
  type,
  isDirectPlayback,
  provider,
  languageAnswered,
  initialSeason,
  initialEpisode,
  settingsRef,
}: UseDirectStreamPipelineParams): DirectStreamPipelineState {
  const [links, setLinks] = useState<StreamLink[]>([]);
  const [bestIndex, setBestIndex] = useState(0);
  const [prevalidated, setPrevalidated] = useState<Map<
    string,
    ValidationResult
  > | null>(null);
  const [selectionReason, setSelectionReason] = useState<string>("");
  const [lastWorkingIndex, setLastWorkingIndex] = useState<number | undefined>(
    undefined,
  );
  // Loading starts TRUE for direct sessions: the pipeline hasn't answered
  // yet, and "loading=false with 0 links" on the very first render is
  // indistinguishable from "finished, nothing found" — it once made the
  // player's auto-fallback fire before the pipeline even started.
  const [loading, setLoading] = useState(isDirectPlayback);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Retry to re-run the fetch. */
  const [fetchToken, setFetchToken] = useState(0);
  /** Active season/episode for direct links (EpisodeRail updates these). */
  const [directSeason, setDirectSeason] = useState<number | undefined>(
    initialSeason,
  );
  const [directEpisode, setDirectEpisode] = useState<number | undefined>(
    initialEpisode,
  );

  const loadStreams = useCallback(() => {
    if (!id) return;
    // Only load when a registry direct provider is actually in play —
    // embed-only sessions never touch the direct APIs.
    const providerDef = provider ? getProvider(provider) : undefined;
    if (!providerDef || !isDirectProvider(providerDef)) return;
    // First-run: don't rank anything until the language prompt is answered —
    // the very first selection should already match the user's taste.
    if (!languageAnswered) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Single source of truth: join the pipeline the details page / CW home
    // already started (or start it here). The snapshot's links are frozen and
    // its head is probe-resolved (dead candidates struck, badge advanced) —
    // the player mounts straight on the head with no re-ranking.
    (async () => {
      try {
        const snap = await prefetchStreams(
          parseInt(id, 10),
          type,
          directSeason,
          directEpisode,
          {
            // The active direct provider — the cache key AND the fetch path
            // are provider-scoped (spacedom resolves its own upstreams;
            // "direct" runs the legacy hdhub+falix pipeline).
            providerId: provider,
            cellularMaxMB: settingsRef.current.cellularMaxMB ?? 3000,
            maxQuality: settingsRef.current.maxQuality ?? null,
            preferredAudioLanguage:
              settingsRef.current.preferredAudioLanguage ?? "auto",
            trigger: "watch",
          },
        );
        if (cancelled) return;
        if (!snap || snap.links.length === 0) {
          setError(
            "No streams available for this title right now. Try again later.",
          );
          return;
        }
        console.log(
          `[Flow] watch: pipeline ready — head #${snap.bestIndex} verified=${snap.bestValidated} allDead=${snap.allDead}`,
        );

        // Promote the source that worked last time (stable URL identity) by
        // REORDERING the chain: the head (index 0) is always what plays
        // first, so promotion moves the remembered source to the front and
        // keeps the rest in priority order. A remembered URL the probes
        // condemned is poisoned — forgotten, never promoted.
        let nextLinks = snap.links;
        let nextBestIndex = snap.bestIndex;
        let lastUsed: number | undefined;
        try {
          const lastKey = await getLastWorkingSource(type, id);
          if (!cancelled && lastKey) {
            const found = nextLinks.findIndex(
              (l) => l.url.split("?")[0] === lastKey,
            );
            if (found >= 0) {
              const outcome = snap.validationResults.get(
                nextLinks[found].url,
              )?.outcome;
              if (outcome === "dead") {
                console.log(
                  "[Flow] watch: remembered source is probe-dead — forgetting it",
                );
                forgetWorkingSource(type, id).catch(() => {});
              } else {
                // Promotion must respect the same cap the chain was ranked
                // with: a remembered file that is known-oversize for the
                // current connection auto-buffered last time — it plays only
                // if the user picks it manually.
                const sizeBytes = nextLinks[found]._meta?.sizeBytes ?? 0;
                if (
                  sizeBytes > 0 &&
                  snap.capBytes > 0 &&
                  sizeBytes > snap.capBytes
                ) {
                  console.log(
                    `[Flow] watch: remembered source is ${(sizeBytes / 1e9).toFixed(1)}GB — over the ${Math.round(snap.capBytes / 1e6)}MB cap, not promoting`,
                  );
                } else {
                  console.log(
                    `[Flow] watch: promoting last-working source to chain head (was #${found})`,
                  );
                  nextLinks = [
                    nextLinks[found],
                    ...nextLinks.slice(0, found),
                    ...nextLinks.slice(found + 1),
                  ];
                  nextBestIndex = 0;
                  lastUsed = 0;
                }
              }
            }
          }
        } catch {}

        if (cancelled) return;
        setLinks(nextLinks);
        setPrevalidated(snap.validationResults);
        setSelectionReason(snap.selectionReason);
        setBestIndex(nextBestIndex);
        setLastWorkingIndex(lastUsed);
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.message === "undefined"
              ? "Couldn't reach the stream provider."
              : `Couldn't load streams. ${err?.message ?? ""}`.trim(),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    provider,
    id,
    type,
    directSeason,
    directEpisode,
    fetchToken,
    languageAnswered,
  ]);

  useEffect(() => {
    const cleanup = loadStreams();
    return cleanup;
  }, [loadStreams, fetchToken]);

  const refetch = useCallback(() => {
    setFetchToken((t) => t + 1);
  }, []);

  return {
    links,
    bestIndex,
    prevalidated,
    selectionReason,
    lastWorkingIndex,
    loading,
    error,
    refetch,
    season: directSeason,
    episode: directEpisode,
    setSeason: setDirectSeason,
    setEpisode: setDirectEpisode,
  };
}
