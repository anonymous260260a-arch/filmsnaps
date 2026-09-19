"use client";

/**
 * MegaPlay identity resolution + fallback chain (anime sessions).
 *
 * Resolves once per (title, season, episode); cached for revisits within
 * the session. Map result WINS over URL ids (map math is more correct);
 * URL mid/aid are the explicit-human-choice fallback when the mapper misses.
 *
 * Chain: MAL first, AniList second. Web advances manually; desktop
 * additionally auto-advances on the deterministic "Error Code: 410" IPC.
 * No soft-signal auto-advance anywhere (verdict §9 Q5).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAnimeMovie, resolveAnimeShow } from "@/lib/anime/client";

export interface MegaPlayChainParams {
  isAnimeSession: boolean;
  contentid: string;
  plat: "movie" | "tv";
  selectedSeason: number;
  activeEpisode: number;
  /** Anime identity from the URL (?mid=&aid=). */
  initialMalId?: number;
  initialAnilistId?: number;
  /** Reset player state when the chain advances (new source to load). */
  onAdvanceReset: () => void;
}

export interface MegaPlayChain {
  malId: number | null;
  aniId: number | null;
  episode: number;
}

export function useMegaPlayChain({
  isAnimeSession,
  contentid,
  plat,
  selectedSeason,
  activeEpisode,
  initialMalId,
  initialAnilistId,
  onAdvanceReset,
}: MegaPlayChainParams) {
  const [megaCtx, setMegaCtx] = useState<MegaPlayChain | null>(null);
  /** Mapper miss reason — set only when NO identity could be produced. */
  const [megaMissReason, setMegaMissReason] = useState<string | null>(null);
  /** Fallback-chain position inside MegaPlay: MAL first, AniList second. */
  const [chainSpace, setChainSpace] = useState<"mal" | "ani">("mal");
  /** Terminal state: every ID space tried and failed (verdict Q10). */
  const [chainExhausted, setChainExhausted] = useState(false);
  /** Bumped by retryChain to re-run resolution for the same key. */
  const [retryToken, setRetryToken] = useState(0);
  const megaCacheRef = useRef<Map<string, MegaPlayChain | { miss: string }>>(
    new Map(),
  );

  useEffect(() => {
    if (!isAnimeSession) {
      setMegaCtx(null);
      setMegaMissReason(null);
      return;
    }
    let cancelled = false;
    const key = `${contentid}|${plat}|${selectedSeason}|${activeEpisode}`;

    const apply = (r: MegaPlayChain | { miss: string }) => {
      if (cancelled) return;
      setChainSpace("mal");
      setChainExhausted(false);
      if ("miss" in r) {
        setMegaCtx(null);
        setMegaMissReason(r.miss);
      } else {
        setMegaCtx(r);
        setMegaMissReason(null);
      }
    };

    const cached = megaCacheRef.current.get(key);
    if (cached) {
      apply(cached);
      return;
    }

    // Explicit human choice beats refusing: when the user arrived from anime
    // search with ?mid=, respect their picked entry even if the season mapper
    // can't align this TMDB season (episode passes through raw).
    const urlFallback = (): MegaPlayChain | { miss: string } =>
      initialMalId != null || initialAnilistId != null
        ? {
            malId: initialMalId ?? null,
            aniId: initialAnilistId ?? null,
            episode: activeEpisode,
          }
        : { miss: "no-candidates" };

    (async () => {
      try {
        let result: MegaPlayChain | { miss: string };
        if (plat === "movie") {
          const r = await resolveAnimeMovie(contentid);
          result = r.ok
            ? {
                malId: r.malId,
                aniId: r.anilistId ?? initialAnilistId ?? null,
                episode: 1,
              }
            : urlFallback();
        } else {
          const r = await resolveAnimeShow(
            contentid,
            selectedSeason,
            activeEpisode,
          );
          result = r.ok
            ? {
                malId: r.malId,
                aniId: r.anilistId ?? initialAnilistId ?? null,
                episode: r.episode,
              }
            : urlFallback();
        }
        megaCacheRef.current.set(key, result);
        apply(result);
      } catch {
        apply(urlFallback());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isAnimeSession,
    contentid,
    plat,
    selectedSeason,
    activeEpisode,
    initialMalId,
    initialAnilistId,
    retryToken,
  ]);

  /**
   * Retry from the exhausted-anime overlay: restart the chain at MAL and
   * re-resolve the identity for the current key (cache entry dropped so a
   * previously cached miss is actually re-attempted).
   */
  const retryChain = useCallback(() => {
    onAdvanceReset();
    megaCacheRef.current.delete(
      `${contentid}|${plat}|${selectedSeason}|${activeEpisode}`,
    );
    setChainSpace("mal");
    setChainExhausted(false);
    setRetryToken((t) => t + 1);
  }, [onAdvanceReset, contentid, plat, selectedSeason, activeEpisode]);

  /** The identity the embed builder should use at the current chain step. */
  const megaBuild = useMemo<{
    idSpace: "mal" | "ani";
    id: number;
    episode: number;
  } | null>(() => {
    if (!megaCtx) return null;
    const useAni = chainSpace === "ani";
    const id = useAni ? megaCtx.aniId : megaCtx.malId;
    if (id == null) return null;
    return { idSpace: useAni ? "ani" : "mal", id, episode: megaCtx.episode };
  }, [megaCtx, chainSpace]);

  /**
   * Advance the fallback chain one step (verdict §9 Q5).
   */
  const advanceSource = useCallback(() => {
    if (chainSpace === "mal" && megaCtx?.aniId != null) {
      onAdvanceReset();
      setChainSpace("ani");
    } else {
      setChainExhausted(true);
    }
  }, [chainSpace, megaCtx, onAdvanceReset]);

  /** Debug line for the exhausted overlay (Q10 telemetry). */
  const animeTriedList = useMemo(() => {
    const out: string[] = [];
    if (megaCtx?.malId != null) out.push(`MAL #${megaCtx.malId}`);
    else if (initialMalId != null) out.push(`MAL #${initialMalId}`);
    if (megaCtx?.aniId != null) out.push(`AniList #${megaCtx.aniId}`);
    else if (initialAnilistId != null) out.push(`AniList #${initialAnilistId}`);
    return out;
  }, [megaCtx, initialMalId, initialAnilistId]);

  const showAnimeExhausted =
    chainExhausted || (!megaBuild && megaMissReason != null);

  return {
    megaCtx,
    megaMissReason,
    megaBuild,
    chainSpace,
    advanceSource,
    retryChain,
    animeTriedList,
    showAnimeExhausted,
  };
}
