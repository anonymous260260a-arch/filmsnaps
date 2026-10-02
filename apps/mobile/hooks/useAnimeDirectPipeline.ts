/**
 * useAnimeDirectPipeline — watch-page state for the JustAnime direct surface.
 *
 * The movie/TV equivalent (useDirectStreamPipeline) does handoff seeding,
 * last-working promotion, watch-perf tracing and chain stage copy — none of
 * which apply to anime's tiny 3-server pool.
 *
 * Anime adds two rules the movie pipeline doesn't have:
 *
 *  1. The sub/dub toggle on the watch page selects the AUDIO — the player's
 *     source list shows only the chosen language's links (ranked separately
 *     per audio). The cache still holds the merged sub+dub pool.
 *
 *  2. Progressive arrival — the three upstream servers resolve independently
 *     and nothing blocks on the slowest. The FIRST caption-carrying response
 *     seeds playback (ranked, head = index 0); every later response APPENDS
 *     its links to the source list so the user can switch servers mid-episode.
 *
 * State shape stays compatible with the parts of DirectStreamState
 * (VideoWebView) the player area consumes. `prevalidated` stays null — anime
 * skips URL probing by design.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { StreamLink } from "../components/player/streamTypes";
import type { ValidationResult } from "../lib/streamValidator";
import {
  animeCacheKey,
  peekAnimeStreams,
  storeAnimeCache,
} from "../lib/animeStreamPrefetch";
import {
  ANIME_PROVIDER_ID,
  fetchAnimeSourceStreams,
  getAnimeSourceIds,
} from "../lib/anime/streams";
import {
  filterByAudio,
  rankAnimeLinks,
  type AnimeAudio,
} from "../lib/anime/rank";

export interface AnimeDirectPipelineState {
  links: StreamLink[];
  bestIndex: number;
  prevalidated: Map<string, ValidationResult> | null;
  selectionReason: string;
  lastWorkingIndex: number | undefined;
  loading: boolean;
  /** True once a fetch attempt for this session has STARTED (and not been
   *  invalidated by disable/key change). The watch route treats the
   *  not-yet-attempted window as loading — the megaplay embed must only fire
   *  after a real attempt came up empty. */
  attempted: boolean;
  error: string | null;
  /** True when the empty settlement was caused by source-level ERRORS
   *  (network / HTTP), not by servers genuinely reporting no streams. The
   *  watch route must NOT auto-fallback to the megaplay embed in this case —
   *  show the error card + Retry instead. This is the fix for the reported
   *  "first launch silently falls back to megaplay without a reason" bug:
   *  cold-start requests (cold DNS/TLS, captive portal) all failed at once
   *  and were misread as an empty upstream. */
  fetchFailed: boolean;
  stageMessage: string | null;
  /** Re-run the fetch pipeline (Retry). */
  refetch: () => void;
}

interface UseAnimeDirectPipelineParams {
  /** Gate — only fetch when a JustAnime anime session is actually in play. */
  enabled: boolean;
  malId: number | undefined;
  episode: number | undefined;
  audio: AnimeAudio;
  providerId?: string;
}

interface Progress {
  /** Episode this accumulation belongs to (animeCacheKey string). */
  key: string;
  /** Raw sub+dub pool received so far, in arrival order. */
  fullPool: StreamLink[];
  /** streamSource ids that already answered (success or not). */
  receivedSourceIds: Set<string>;
  /** Last settlement for this key ended with errors and zero links. */
  lastSettleFailed: boolean;
}

/** Caption-carrying check — the rule that decides when playback may seed. */
function withCaptions(links: StreamLink[]): boolean {
  return links.some((l) => (l._meta?.subtitles?.length ?? 0) > 0);
}

export function useAnimeDirectPipeline({
  enabled,
  malId,
  episode,
  audio,
  providerId = ANIME_PROVIDER_ID,
}: UseAnimeDirectPipelineParams): AnimeDirectPipelineState {
  const [links, setLinks] = useState<StreamLink[]>([]);
  const [bestIndex, setBestIndex] = useState(0);
  const [prevalidated] = useState<Map<string, ValidationResult> | null>(null);
  const [selectionReason, setSelectionReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Retry to re-run the fetch pipeline. */
  const [fetchToken, setFetchToken] = useState(0);
  /** Stale runs (audio toggle, episode change) are retired by id. */
  const runIdRef = useRef(0);
  /** In-session accumulated raw pool, kept across audio toggles per episode. */
  const progRef = useRef<Progress>({
    key: "",
    fullPool: [],
    receivedSourceIds: new Set(),
    lastSettleFailed: false,
  });
  /** Last settlement ended with source errors and no links (no auto-embed). */
  const [fetchFailed, setFetchFailed] = useState(false);

  const loadStreams = useCallback(() => {
    if (!enabled || malId == null || episode == null) {
      if (enabled && (malId == null || episode == null)) {
        console.log(
          `[Anime][hook] enabled but malId/episode missing (malId=${malId}, ep=${episode}) — nothing to fetch`,
        );
      }
      runIdRef.current += 1;
      setLinks([]);
      setAttempted(false);
      setLoading(false);
      return;
    }
    const key = animeCacheKey(malId, episode, providerId);
    const runId = ++runIdRef.current;
    console.log(
      `[Anime][hook] load ${key} audio=${audio} provider=${providerId} run#${runId}`,
    );
    setAttempted(true);
    let cancelled = false;
    const isCurrent = () => !cancelled && runId === runIdRef.current;

    const prog = progRef.current;
    if (prog.key !== key) {
      // New episode — drop any leftover accumulation.
      prog.key = key;
      prog.fullPool = [];
      prog.receivedSourceIds = new Set();
      prog.lastSettleFailed = false;
      setLinks([]);
    }
    const fullPool = prog.fullPool;

    // Publish a ranked, audio-filtered snapshot. Used to resume from an
    // accumulated pool instantly (audio toggle) and to seed on first response.
    const publish = (pool: StreamLink[], note: string): boolean => {
      if (!isCurrent()) return false;
      let rawSub = 0;
      let rawDub = 0;
      for (const l of pool) {
        if (l._meta?.audio === "sub") rawSub++;
        else if (l._meta?.audio === "dub") rawDub++;
      }
      const audioPool = filterByAudio(pool, audio);
      console.log(
        `[Anime][hook] publish ${audio}: raw pool ${pool.length} (sub=${rawSub} dub=${rawDub}) → publishing ${audioPool.length} ${audio} links`,
      );
      if (audioPool.length === 0) return false;
      const rank = rankAnimeLinks(audioPool, audio);
      const hasCaptions = withCaptions(audioPool);
      console.log(
        `[Anime][hook] ▶ playing ${rank.sortedLinks.length} ${audio} links (${note})${hasCaptions ? " (+captions)" : ""} — head #0 ${rank.sortedLinks[0]?.name ?? "?"}`,
      );
      setLinks(rank.sortedLinks);
      setBestIndex(rank.bestIndex);
      setSelectionReason(rank.selectionReason);
      setLoading(false);
      setError(null);
      setFetchFailed(false);
      prog.lastSettleFailed = false;
      return true;
    };

    setError(null);

    // ── 1. Warm snapshot — instant when details/CW already fetched this ep ──
    const peek = peekAnimeStreams(malId, episode, audio, providerId);
    if (peek && peek.links.length > 0) {
      console.log(
        `[Anime] watch: cache hit — head #${peek.bestIndex} ${peek.links[0]?.quality ?? "?"} (${peek.selectionReason})`,
      );
      setLinks(peek.links);
      setBestIndex(peek.bestIndex);
      setSelectionReason(peek.selectionReason);
      setLoading(false);
      setError(null);
      setFetchFailed(false);
      return;
    }

    // ── 2. Resume from whatever already accumulated this episode ──
    // Covers a sub↔dub toggle (no re-fetch — just re-rank the raw pool) and a
    // Retry that landed on a partial pool. If the current audio has nothing
    // yet, keep the spinner and let the arrivals below seed us.
    let published = false;
    if (fullPool.length > 0) {
      published = publish(
        fullPool,
        `accumulated ${fullPool.length} links [${[...prog.receivedSourceIds].join(", ") || "?"}]`,
      );
      // Still fetch the sources that never answered so the picker fills up.
    }
    if (!published) setLoading(true);

    const sourceIds = getAnimeSourceIds(providerId);
    const missing = sourceIds.filter((id) => !prog.receivedSourceIds.has(id));
    console.log(
      `[Anime][hook] fetch ${key}: ${missing.length}/${sourceIds.length} sources remain [${missing.join(", ") || "none"}] — pool ${fullPool.length} links${published ? " (resumed)" : ""}`,
    );

    if (missing.length === 0) {
      if (!published) {
        if (prog.lastSettleFailed) {
          // Previous run errored out — do not settle as "empty"; surface the
          // error card so the user can Retry (no silent megaplay embed).
          console.log(
            `[Anime][hook] EMPTY: ${key} — previous run errored (not a genuine empty)`,
          );
          setError(
            "Couldn't reach the JustAnime servers. Check your connection and retry.",
          );
          setFetchFailed(true);
          setLoading(false);
        } else if (fullPool.length === 0) {
          console.log(
            `[Anime][hook] EMPTY: ${key} — all sources already answered empty — embed fallback`,
          );
          setError(
            "No streams available for this title right now. Try again later.",
          );
          setLoading(false);
        } else {
          console.log(
            `[Anime][hook] EMPTY: ${key} — no ${audio} links in the pooled sources — embed fallback`,
          );
          setError(
            `No ${audio} streams available. Try the other audio track or another server.`,
          );
          setLoading(false);
        }
      }
      return;
    }

    // ── 3. Progressive — fire the missing sources in parallel. The first
    //    caption-carrying response seeds playback; the rest append to the
    //    source list (HevcPlayer migrates and keeps the current URL playing).
    const unseededAudio: StreamLink[] = [];
    let lastErr: string | null = null;

    (async () => {
      await Promise.all(
        missing.map(async (sourceId) => {
          let res;
          try {
            res = await fetchAnimeSourceStreams({
              malId,
              episode,
              providerId,
              sourceId,
            });
          } catch (e) {
            res = {
              sourceId,
              links: [],
              error: e instanceof Error ? e.message : String(e),
            };
          }
          if (!isCurrent()) return;
          prog.receivedSourceIds.add(sourceId);
          if (res.links.length === 0) {
            lastErr = res.error ?? "no streams for this episode";
            console.log(`[Anime][hook] −${sourceId}: ${lastErr}`);
            return;
          }
          prog.fullPool.push(...res.links);
          const audioLinks = filterByAudio(res.links, audio);
          console.log(
            `[Anime][hook] +${sourceId}: ${res.links.length} links (${audioLinks.length} ${audio}) — pool ${prog.fullPool.length}`,
          );
          if (audioLinks.length === 0) return;

          if (published) {
            // Player is already up (resumed pool or a caption-carrying seed) —
            // grow AND re-rank the source list so the champion is deterministic
            // (megaplay first, HLS before the slow mp4s), not arrival-order.
            setLinks((prev) => {
              const rank = rankAnimeLinks([...prev, ...audioLinks], audio);
              console.log(
                `[Anime][hook] ↳ re-ranked ${rank.sortedLinks.length} ${audio} sources — head #0 ${rank.sortedLinks[0]?.quality ?? "?"} (${rank.sortedLinks[0]?._meta?.source ?? "?"})`,
              );
              return rank.sortedLinks;
            });
            return;
          }

          // Not playing yet — first caption-carrying source seeds playback.
          unseededAudio.push(...audioLinks);
          if (withCaptions(audioLinks)) {
            const rank = rankAnimeLinks(unseededAudio, audio);
            console.log(
              `[Anime][hook] ▶ playing ${rank.sortedLinks.length} ${audio} links (${sourceId} first with captions) — head #0 ${rank.sortedLinks[0]?.name ?? "?"}`,
            );
            setLinks(rank.sortedLinks);
            setBestIndex(rank.bestIndex);
            setSelectionReason(rank.selectionReason);
            setLoading(false);
            setError(null);
            published = true;
          } else {
            console.log(
              `[Anime][hook] ⏳ ${sourceId} has no captions — holding for the picker, awaiting a caption-carrying source`,
            );
          }
        }),
      );
      if (!isCurrent()) return;

      // ── All missing sources settled ──
      prog.receivedSourceIds = new Set(sourceIds);
      if (prog.fullPool.length > 0) {
        storeAnimeCache(malId, episode, prog.fullPool, providerId);
      } else {
        storeAnimeCache(malId, episode, [], providerId);
      }

      if (published) return;
      if (prog.fullPool.length === 0) {
        if (lastErr != null) {
          // Every source ERRORED (network/HTTP) — this is NOT a genuine
          // "upstream has no streams". Cold-app-start requests failing all
          // at once used to settle as empty and silently drop the user to
          // the megaplay embed (the reported first-launch bug). Settle as a
          // fetch failure instead: error card + Retry, never auto-embed.
          console.log(
            `[Anime][hook] EMPTY: ${key} — all sources ERRORED (${lastErr}) — no embed fallback, surfacing retry`,
          );
          setError(
            "Couldn't reach the JustAnime servers. Check your connection and retry.",
          );
          setFetchFailed(true);
          prog.lastSettleFailed = true;
          setLoading(false);
          return;
        }
        console.log(
          `[Anime][hook] EMPTY: ${key} — no links from any source (genuine empty) — embed fallback`,
        );
        setError(
          "No streams available for this title right now. Try again later.",
        );
        setLoading(false);
        return;
      }
      // Never seeded — either nothing had captions, or this audio was absent.
      const audioPool = filterByAudio(prog.fullPool, audio);
      if (audioPool.length === 0) {
        console.log(
          `[Anime][hook] EMPTY: ${key} — no ${audio} links in pooled sources — embed fallback`,
        );
        setError(
          `No ${audio} streams available. Try the other audio track or another server.`,
        );
        setLoading(false);
        return;
      }
      const rank = rankAnimeLinks(audioPool, audio);
      console.log(
        `[Anime][hook] ▶ playing ${rank.sortedLinks.length} ${audio} links fallback (no caption-carrying source) — head #0 ${rank.sortedLinks[0]?.name ?? "?"}`,
      );
      setLinks(rank.sortedLinks);
      setBestIndex(rank.bestIndex);
      setSelectionReason(rank.selectionReason);
      setLoading(false);
      setError(null);
      setFetchFailed(false);
      prog.lastSettleFailed = false;
    })();
  }, [enabled, malId, episode, audio, providerId, fetchToken]);

  // useLayoutEffect: when the provider sync flips animeActive mid-frame, the
  // loading state must be committed BEFORE paint — otherwise the watch route
  // sees one settledEmpty window (links 0 + loading false) and flashes the
  // megaplay embed before the fetch even starts.
  useLayoutEffect(() => {
    return loadStreams();
  }, [loadStreams, fetchToken]);

  const refetch = useCallback(() => {
    // Full re-run — drop the accumulated pool so every source refetches
    // (Retry means "hit the network again", not "resume a partial pool").
    const prog = progRef.current;
    prog.fullPool = [];
    prog.receivedSourceIds = new Set();
    setFetchToken((t) => t + 1);
  }, []);

  return {
    links,
    bestIndex,
    prevalidated,
    selectionReason,
    lastWorkingIndex: undefined,
    loading,
    attempted,
    error,
    fetchFailed,
    stageMessage: loading ? "Contacting JustAnime…" : null,
    refetch,
  };
}
