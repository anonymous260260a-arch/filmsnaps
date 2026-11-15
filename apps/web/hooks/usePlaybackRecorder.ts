/**
 * usePlaybackRecorder — persists watch progress from any playback surface.
 *
 * Two feeds write into the same throttled store:
 *
 * 1. Desktop embed relay — the session preload (provider-preload.ts §0.6)
 *    samples the embed's <video>/<audio> elements at ~1Hz and reports over
 *    IPC (provider:playback → main → player:progress). This hook subscribes.
 *
 * 2. In-page direct players — movi (browser) / mpv + Falix video.js (desktop)
 *    report through the `pushSample` handle (wired via DirectVideoPlayer /
 *    FalixPlayer's onProgress prop). Without this feed the desktop mpv path —
 *    the ONLY direct decoder there — and all of browser web recorded nothing.
 *
 * Cadence mirrors mobile's VideoWebView: save every 10s while meaningful
 * (>5s), plus a final save on unmount / page hide so closing the tab
 * mid-scene keeps the resume point.
 *
 * saveProgress itself dedups (never overwrites with lower percent) and
 * auto-marks completed at >= 95%, so this hook only decides WHEN to save.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createLocalStorageAdapter, useWatchHistory } from "@filmsnaps/shared";

const SAVE_INTERVAL_MS = 10_000;
/** Minimum watch position worth persisting (seconds) — mirrors mobile. */
const MIN_SAVE_SECONDS = 5;
/** Sample-to-sample jump beyond continuous playback cadence = a manual seek. */
const SEEK_JUMP_SECONDS = 2;
/** How long after a manual seek the backward-jump guard stays unlocked. */
const SEEK_GRACE_MS = 15_000;

/** One in-page playback time report (direct player path). */
export interface PlaybackTimeSample {
  currentTime: number;
  duration: number;
  paused?: boolean;
}

export interface PlaybackRecorderHandle {
  /** Feed an in-page playback sample (direct player: movi / mpv / video.js). */
  pushSample(sample: PlaybackTimeSample): void;
}

interface PlaybackSample {
  currentTime: number;
  duration: number;
  paused: boolean;
  /** Whether the sample's media host is trusted content (desktop only). */
  qualified?: boolean;
  /** Whether the user recently performed a manual seek (escape hatch). */
  recentUserSeek?: boolean;
}

export interface PlaybackRecorderOptions {
  tmdbId: string;
  mediaType: "movie" | "tv";
  /** TV-only — current season */
  season?: number;
  /** TV-only — current episode */
  episode?: number;
  /** Which provider is playing (recorded for diagnostics) */
  providerId?: string;
  /** Whether this title is an anime session (Hard Mode Split history scoping) */
  isAnime?: boolean;
  /**
   * Resume position in seconds (from ?t=). Once the first playback sample
   * proves the embed's video exists, a one-shot seek is sent to the view.
   * Desktop-only — web can't reach into cross-origin embeds.
   */
  resumeAt?: number;
}

export function usePlaybackRecorder({
  tmdbId,
  mediaType,
  season,
  episode,
  providerId,
  isAnime,
  resumeAt,
}: PlaybackRecorderOptions): PlaybackRecorderHandle {
  // Module-level adapter (same pattern as ContinueWatchingWrapper) — the
  // adapter is stateless; creating it once per module load avoids churn.
  const storage = useMemo(() => createLocalStorageAdapter(), []);
  const { saveProgress } = useWatchHistory(storage);

  // Latest sample + a stable snapshot of identity fields for the timers.
  const sampleRef = useRef<PlaybackSample | null>(null);
  const identityRef = useRef({
    tmdbId,
    mediaType,
    season,
    episode,
    providerId,
    isAnime,
  });
  identityRef.current = {
    tmdbId,
    mediaType,
    season,
    episode,
    providerId,
    isAnime,
  };

  const persist = useRef((sample: PlaybackSample) => {
    const id = identityRef.current;
    const duration = sample.duration > 0 ? sample.duration : 0;
    // Backward-jump guard (verdict Q11): an ad loop / provider reset can snap
    // currentTime backwards by minutes. Reject the save unless the user
    // explicitly sought (recentUserSeek) — a legitimate manual rewind must not
    // freeze progress. Only fires once we have a previous baseline.
    if (
      lastPersistedT.current > 0 &&
      sample.currentTime < lastPersistedT.current - 60 &&
      !sample.recentUserSeek
    ) {
      return;
    }
    lastPersistedT.current = sample.currentTime;
    void saveProgress({
      tmdbId: id.tmdbId,
      mediaType: id.mediaType,
      providerId: id.providerId,
      currentTime: sample.currentTime,
      duration,
      percent: duration > 0 ? Math.min(sample.currentTime / duration, 1) : 0,
      season: id.mediaType === "tv" ? id.season : undefined,
      episode: id.mediaType === "tv" ? id.episode : undefined,
      isAnime: id.isAnime,
      updatedAt: Date.now(),
      completed: false, // saveProgress upgrades to completed at >= 95%
    });
  });
  /** Last persisted position for the current identity — drives the guard. */
  const lastPersistedT = useRef(0);
  // Last in-page sample time + the wall clock of the latest detected manual
  // seek — pushSample turns a too-large sample delta into a temporary unlock
  // of the backward-jump guard (the in-page equivalent of the embed preload's
  // recentUserSeek flag).
  const lastSampleT = useRef(0);
  const lastUserSeekAt = useRef(0);

  // ── Feed 2: in-page direct-player samples ──
  const pushSample = useCallback((sample: PlaybackTimeSample) => {
    if (
      !sample ||
      !Number.isFinite(sample.currentTime) ||
      !Number.isFinite(sample.duration) ||
      sample.duration <= 0
    ) {
      return;
    }
    const delta =
      lastSampleT.current > 0
        ? Math.abs(sample.currentTime - lastSampleT.current)
        : 0;
    if (delta > SEEK_JUMP_SECONDS) lastUserSeekAt.current = Date.now();
    lastSampleT.current = sample.currentTime;
    sampleRef.current = {
      currentTime: sample.currentTime,
      duration: sample.duration,
      paused: !!sample.paused,
      // In-page time comes from our own player — trusted by construction.
      qualified: true,
      recentUserSeek: Date.now() - lastUserSeekAt.current < SEEK_GRACE_MS,
    };
  }, []);

  // ── Identity switch: drop stale samples so an episode/provider change
  // never persists the previous episode's position against the new one ──
  useEffect(() => {
    sampleRef.current = null;
    lastSampleT.current = 0;
    lastPersistedT.current = 0; // new title — reset backward-jump baseline
  }, [tmdbId, mediaType, season, episode]);

  // ── Server switch (same content): the replacement embed starts at 0:00 and
  // the one-shot resume was already consumed by the old embed — re-arm it
  // from the last position the previous server reported (falling back to the
  // original ?t=) so switching servers doesn't restart the movie. ──
  useEffect(() => {
    const last = sampleRef.current;
    const target =
      last && last.currentTime > MIN_SAVE_SECONDS
        ? Math.floor(last.currentTime)
        : resumeAt;
    resumePendingRef.current = target != null && target > 5 ? target : null;
    sampleRef.current = null;
    lastSampleT.current = 0;
    lastPersistedT.current = 0; // re-arm guard for the new server
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  // ── Feed 1: desktop IPC samples from the provider embed ──
  const resumePendingRef = useRef(
    resumeAt != null && resumeAt > 5 ? resumeAt : null,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const unsubscribe = window.electronAPI?.onPlayerProgress?.((sample) => {
      if (
        sample &&
        typeof sample.currentTime === "number" &&
        typeof sample.duration === "number" &&
        sample.duration > 0 &&
        // Only trust *qualified* content samples (trusted host / confident
        // MSE). Ad pre-roll in a sibling frame is unqualified and must never
        // drive a save or a resume seek (verdict Q3).
        sample.qualified
      ) {
        sampleRef.current = sample;
        // One-shot resume: the first *qualified, playing* sample proves the
        // content video exists — seek it to the saved position (skip if we're
        // already within ~10s of it, e.g. the provider honored a ?startAt=).
        const pending = resumePendingRef.current;
        if (
          pending != null &&
          !sample.paused &&
          typeof window.electronAPI?.player?.seek === "function"
        ) {
          resumePendingRef.current = null;
          if (Math.abs(sample.currentTime - pending) > 10) {
            void window.electronAPI.player.seek(pending);
          }
        }
      }
    });
    return () => unsubscribe?.();
  }, []);

  // ── Periodic save (every 10s of wall clock, mirroring mobile) ──
  useEffect(() => {
    const interval = setInterval(() => {
      const sample = sampleRef.current;
      if (sample && sample.currentTime > MIN_SAVE_SECONDS) {
        persist.current(sample);
      }
    }, SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // ── Final save on unmount / tab close / navigate-away ──
  useEffect(() => {
    const saveNow = () => {
      const sample = sampleRef.current;
      if (sample && sample.currentTime > MIN_SAVE_SECONDS) {
        persist.current(sample);
      }
    };
    const onPageHide = () => saveNow();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      saveNow(); // unmount = user left the watch page (or switched episode)
    };
  }, []);

  return { pushSample };
}
