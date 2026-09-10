/**
 * HevcPlayer — Generic native video player using expo-video.
 *
 * Plays direct video URLs (MKV/MP4/WebM) with hardware-accelerated decoding.
 * Accepts either a single videoUrl or an array of StreamLinks (direct provider).
 *
 * UX stage machine (what the user sees):
 *   connecting → playing
 *        └→ switching ("Trying source X of Y …") → playing | error
 *   error   → card with human reason + Retry / Choose source / Go back
 *   exhausted → card with Re-check all / Choose manually / Go back
 *
 * The probe machinery now classifies links as valid / dead / unknown:
 * timeouts never blacklist a link (it may stream fine), only authoritative
 * rejections (401/403/404/410/5xx, error pages) do — and even those can be
 * retried from the error card.
 */

import React, {
  useMemo,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";
import {
  View,
  StyleSheet,
  StatusBar,
  Text,
  TouchableOpacity,
  AppState,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import * as ScreenOrientation from "expo-screen-orientation";
import * as KeepAwake from "expo-keep-awake";
import { colors } from "../theme/colors";
import { ExpoVideoAdapter } from "./player/ExpoVideoAdapter";
import { PlayerOverlay } from "./player/PlayerOverlay";
import { StreamPickerSheet } from "./player/StreamPickerSheet";
import { saveProgress } from "../lib/watchHistory";
import {
  rememberWorkingSource,
  getLastWorkingSource,
  forgetWorkingSource,
  urlKeyOf,
} from "../lib/lastWorkingSource";
import { toPlayableUri } from "../lib/download/offlineUri";
import { File } from "expo-file-system";
import { getSubtitleChoice } from "../lib/subtitleCache";
import type { PlayerAdapter, AudioTrackInfo } from "./player/types";
import type { StreamLink } from "./player/streamTypes";
import {
  validateStreamUrl,
  invalidateValidation,
  clearValidationCache,
  type ProbeOutcome,
  type ValidationResult,
} from "../lib/streamValidator";
import { getPlayerTuning, headersForUrl } from "../lib/playerConfig";
import { clearPrefetchCache } from "../lib/streamPrefetch";
import {
  getActiveSkipSegment,
  isSegmentUsable,
  type IntroDbResponse,
} from "../lib/introDetect";
import { PerfSessionTracker } from "../lib/perfMetrics";
import {
  getSubtitleOffset,
  setSubtitleOffset as persistSubtitleOffset,
} from "../lib/subtitlePrefs";
import {
  detectContainer,
  detectCodec,
  getBufferProfile,
} from "../lib/bufferProfiles";
import {
  parseLinkLanguages,
  linkContainerLabel,
  selectBestStream,
  type PreferredLanguage,
} from "../lib/streamSelector";

interface HevcPlayerProps {
  /** Direct video URL — used when playing a single source (Falix, local files). */
  videoUrl?: string;
  /** Multiple stream links from /api/player/direct (already ranked best-first). */
  links?: StreamLink[];
  /** Which link to auto-play (index into links array). Default: 0 */
  defaultIndex?: number;
  /** Probe outcomes from the stream cache — skips re-probing known URLs. */
  prevalidatedResults?: Map<string, ValidationResult> | null;
  tmdbId?: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
  startAt?: number;
  title?: string;
  backdropUrl?: string;
  /** Human-readable reason the default source was picked (shown in the picker). */
  selectionReason?: string;
  /** Index of the source that worked last time for this title (picker badge). */
  lastWorkingIndex?: number;
  /** User's preferred audio language — re-runs selection when changed mid-flow. */
  preferredLanguage?: PreferredLanguage;
  /** Embedded mode: report fullscreen transitions so the host container can
   *  expand to true fullscreen. When provided, the host mirrors our state. */
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /** Host-driven fullscreen (watch page overlay button) — mirrors it internally. */
  externalFullscreen?: boolean;
  onClose: () => void;
  /** Called when all direct links are exhausted. Host switches to next provider. */
  onExhausted?: () => void;
  /** Called when user taps "Try Another Server" in the error/exhausted card. */
  onTryProvider?: () => void;
  /** Intro/outro/recap segments for TV (host fetches via introdb) — enables
   *  the Skip Intro/Recap button and the outro-window next-episode trigger. */
  introSegments?: IntroDbResponse | null;
  /** Next episode for TV — enables the Next-Episode card + auto-advance. */
  nextEpisode?: { season: number; episode: number } | null;
  /** Fired on next-episode tap / countdown end. Host refetches per-episode links. */
  onNextEpisode?: (season: number, episode: number) => void;
}

interface SwitchInfo {
  toIndex: number;
  auto: boolean;
}

interface StreamErrorInfo {
  title: string;
  detail: string;
}

// Switch/rebuffer limits live in lib/playerConfig (remote-tunable).
/** Auto-advance countdown once the next-episode card arms at the end. */
const NEXT_EPISODE_COUNTDOWN_S = 10;

/**
 * Pick the in-file audio track matching the language preference. Multi-audio
 * MKVs default to their first track, which usually ignores the preference
 * that picked the link — this closes that loop.
 */
function pickPreferredTrack(
  tracks: AudioTrackInfo[],
  pref: PreferredLanguage,
): AudioTrackInfo | null {
  const langOf = (t: AudioTrackInfo) =>
    `${t.language ?? ""} ${t.label ?? ""}`.toLowerCase();
  const has = (t: AudioTrackInfo, ...keys: string[]) =>
    keys.some((k) => langOf(t).includes(k));
  if (pref === "hindi") {
    return tracks.find((t) => has(t, "hindi", "hin")) ?? null;
  }
  if (pref === "english") {
    return tracks.find((t) => has(t, "english", "eng")) ?? null;
  }
  if (pref === "multi") {
    // A multi-audio file satisfies "multi" regardless of which track leads.
    return null;
  }
  // auto — mirror the link selector's taste: Hindi preferred inside the file.
  return tracks.find((t) => has(t, "hindi", "hin")) ?? null;
}

/** Map raw adapter/probe errors to human language. */
function humanizeError(raw: string): StreamErrorInfo {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("403")) {
    return {
      title: "This source is refusing connections",
      detail:
        "The server returned 403 — the link is probably dead, expired, or region-locked. Try another source.",
    };
  }
  if (msg.includes("404")) {
    return {
      title: "This file is gone",
      detail:
        "The server returned 404 — the file was removed from this host. Try another source.",
    };
  }
  if (msg.includes("410") || msg.includes("410 gone")) {
    return {
      title: "This source expired",
      detail: "The server says the file is gone (410). Try another source.",
    };
  }
  if (msg.includes("does not support seeking")) {
    return {
      title: "This stream can't be seeked",
      detail:
        "Playback works, but seeking is broken on this server. Switching to a different source usually fixes it.",
    };
  }
  if (
    msg.includes("stalled") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  ) {
    return {
      title: "This source is too slow",
      detail:
        "The server stopped responding while loading. Try another source or retry.",
    };
  }
  if (msg.includes("extractor") || msg.includes("not supported")) {
    return {
      title: "This format isn't supported",
      detail:
        "The video codec in this file can't be decoded on this device. Try another source.",
    };
  }
  if (msg.includes("network") || msg.includes("failed to connect")) {
    return {
      title: "Connection failed",
      detail:
        "Couldn't reach this server. Check your connection or try another source.",
    };
  }
  return {
    title: "Stream failed to load",
    detail: raw || "An unknown error occurred.",
  };
}

export function HevcPlayer({
  videoUrl,
  links,
  defaultIndex = 0,
  prevalidatedResults,
  tmdbId,
  mediaType = "movie",
  season,
  episode,
  startAt = 0,
  title = "",
  backdropUrl,
  selectionReason,
  lastWorkingIndex,
  preferredLanguage = "auto",
  onFullscreenChange,
  externalFullscreen,
  onClose,
  onExhausted,
  onTryProvider,
  introSegments,
  nextEpisode,
  onNextEpisode,
}: HevcPlayerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeLinkIndex, setActiveLinkIndex] = useState(defaultIndex);
  const [showStreamPicker, setShowStreamPicker] = useState(false);
  /** Non-null while a source switch is in flight (auto-fallback or user pick). */
  const [switchInfo, setSwitchInfo] = useState<SwitchInfo | null>(null);
  const [streamError, setStreamError] = useState<StreamErrorInfo | null>(null);
  const [exhausted, setExhausted] = useState(false);
  /** Probe outcome per link index, for the picker UI and fallback ranking. */
  const [linkStatuses, setLinkStatuses] = useState<
    Record<number, ProbeOutcome>
  >({});
  /** True once the current source delivered actual frames — gates the
   *  overlay's center controls so loading states are never covered. */
  const [hasStarted, setHasStarted] = useState(false);
  /** Position of the last periodic progress save (seconds). */
  const lastSavedPositionRef = useRef(0);
  /** startAt value the resume correction has been checked for. */
  const resumeAppliedRef = useRef(-1);

  const adapterRef = useRef<PlayerAdapter | null>(null);
  const failedLinksRef = useRef<Set<number>>(new Set());
  const playbackFailedRef = useRef<Set<number>>(new Set());
  const linkStatusesRef = useRef<Record<number, ProbeOutcome>>({});
  const prevalidatedResultsRef = useRef<Map<string, ValidationResult> | null>(
    null,
  );
  prevalidatedResultsRef.current = prevalidatedResults ?? null;
  /** True while the current stream was explicitly chosen from the picker. */
  const isManualSelectionRef = useRef(false);
  /** Mirrors activeLinkIndex for use inside async callbacks. */
  const activeIndexRef = useRef(activeLinkIndex);
  activeIndexRef.current = activeLinkIndex;
  /** Mirrors switchInfo for use inside async probe callbacks. */
  const switchInfoRef = useRef<SwitchInfo | null>(null);
  switchInfoRef.current = switchInfo;
  /** True once the current source actually delivered playback — language
   *  changes must never interrupt a healthy stream. */
  const hasPlayedRef = useRef(false);
  /** Selector recommendation (may be updated live when language pref changes). */
  const [selection, setSelection] = useState<{ index: number; reason: string }>(
    {
      index: defaultIndex,
      reason: selectionReason ?? "",
    },
  );
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckTokenRef = useRef(0);
  /** True while the app is backgrounded — freezes playback + auto-switching. */
  const backgroundedRef = useRef(false);
  /** When the app last returned to foreground — background-frozen timers
   *  fire right after resume and must not condemn a source it never had
   *  foreground time to load. */
  const lastActiveAtRef = useRef(0);

  // ── Auto audio-track selection ──
  /** Set when the user picks a track manually — auto-select never overrides. */
  const userAudioTouchedRef = useRef(false);
  /** Link index the auto-select last applied for (once per source). */
  const audioAutoAppliedRef = useRef(-1);

  // ── Switch/aspect transparency toasts ──
  const [autoToast, setAutoToast] = useState<string | null>(null);
  const autoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set by an auto switch; consumed on first frames to show "Now playing…". */
  const pendingAutoToastRef = useRef(false);

  // ── Skip Intro / Next-Episode state ──
  const [skipSegment, setSkipSegment] = useState<{
    endSec: number;
    label: string;
  } | null>(null);
  const skipSegmentLabelRef = useRef<string | null>(null);
  const [nextUp, setNextUp] = useState(false);
  const nextUpRef = useRef(false);
  /** True once the countdown is ticking (starts at natural end of media). */
  const [countdownActive, setCountdownActive] = useState(false);
  const countdownActiveRef = useRef(false);
  const [nextCountdown, setNextCountdown] = useState(NEXT_EPISODE_COUNTDOWN_S);
  const nextCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const autoNextCancelledRef = useRef(false);
  /** Organic (non-seek) watch seconds this session — gates pre-end arming. */
  const organicWatchedRef = useRef(0);
  const lastOrganicTimeRef = useRef(0);
  /** Set once playback reached the natural end — gates all fallback paths. */
  const endedRef = useRef(false);
  /** Timestamps of recent mid-play stalls — sliding window for the watchdog. */
  const rebufferTimesRef = useRef<number[]>([]);
  /** Latest fallbackToNextLink, callable from long-lived subscriptions. */
  const fallbackNowRef = useRef<(idx: number, reason: string) => void>(
    () => {},
  );
  /** Stable key of the remembered "last working source" for this title. */
  const rememberedSourceKeyRef = useRef<string | null>(null);

  // ── Tap→first-frame instrumentation ──
  const perfRef = useRef<PerfSessionTracker | null>(null);
  if (!perfRef.current) {
    const key = `${mediaType}:${tmdbId ?? "?"}${
      season != null ? `:s${season}e${episode ?? ""}` : ""
    }`;
    perfRef.current = new PerfSessionTracker(key);
  }
  /** Episode identity — a change here drops carried-over playback position. */
  const lastEpKeyRef = useRef(`${season ?? ""}:${episode ?? ""}`);

  /** Subtitle sync offsets persist per series (not per episode). */
  const subtitleKey = tmdbId ? `${mediaType}:${tmdbId}` : null;

  /** Online-subtitle search context (Subdl, by TMDB id). */
  const subtitleOnlineSearch = React.useMemo(
    () =>
      tmdbId
        ? {
            tmdbId: Number(tmdbId),
            mediaType,
            season: mediaType === "tv" ? season : undefined,
            episode: mediaType === "tv" ? episode : undefined,
          }
        : undefined,
    [tmdbId, mediaType, season, episode],
  );

  // Sidecar subtitles belong to one episode — drop them when the media changes.
  // Source fallbacks within the same episode keep them (they re-merge per prepare).
  useEffect(() => {
    adapterRef.current?.clearExternalSubtitles?.();
  }, [mediaType, tmdbId, season, episode]);

  // Auto-attach a cached online subtitle once playback starts (per episode).
  // addExternalSubtitle re-prepares at the current position and selects the
  // track when it appears — so a remembered choice just plays.
  const cachedSubtitleKeyRef = useRef("");
  useEffect(() => {
    if (!hasStarted || !subtitleOnlineSearch) return;
    const key = `${subtitleOnlineSearch.mediaType}:${subtitleOnlineSearch.tmdbId}:${subtitleOnlineSearch.season ?? ""}:${subtitleOnlineSearch.episode ?? ""}`;
    if (cachedSubtitleKeyRef.current === key) return;
    cachedSubtitleKeyRef.current = key;
    (async () => {
      try {
        const choice = await getSubtitleChoice(subtitleOnlineSearch);
        if (!choice) return;
        const file = new File(choice.uri);
        if (!file.exists) {
          console.log(
            `[SidecarSubs] JS: cached subtitle no longer on disk — skipping (${choice.label})`,
          );
          return;
        }
        console.log(
          `[SidecarSubs] JS: auto-loading cached subtitle for ${key}`,
        );
        await adapterRef.current?.addExternalSubtitle?.(
          choice.uri,
          choice.mimeType,
          choice.language,
          choice.label,
        );
      } catch (e) {
        console.log(
          `[SidecarSubs] JS: cached subtitle auto-load failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
  }, [hasStarted, subtitleOnlineSearch]);

  const isMultiLink = !!links && links.length > 1;

  // Resolve the current video URL from either links array or single URL
  const activeUrl =
    links && links.length > 0
      ? (links[activeLinkIndex]?.url ?? links[0].url)
      : (videoUrl ?? "");

  const currentLink =
    links && links.length > 0 ? links[activeLinkIndex] : undefined;

  // Reset all tracking when media / links change
  useEffect(() => {
    isManualSelectionRef.current = false;
    failedLinksRef.current.clear();
    playbackFailedRef.current.clear();
    linkStatusesRef.current = {};
    hasPlayedRef.current = false;
    rebufferTimesRef.current = [];
    setHasStarted(false);
    setLinkStatuses({});
    setExhausted(false);
    setStreamError(null);
    setSelection({ index: defaultIndex, reason: selectionReason ?? "" });
    setActiveLinkIndex(defaultIndex);
    // Episode identity change (not a mere source switch) — drop the carried-
    // over position so the new episode doesn't open at the old one's timestamp.
    const epKey = `${season ?? ""}:${episode ?? ""}`;
    if (lastEpKeyRef.current !== epKey) {
      lastEpKeyRef.current = epKey;
      lastPlaybackTimeRef.current = 0;
      resumeAppliedRef.current = -1;
    }
    // Reset per-episode/per-source UI state
    autoNextCancelledRef.current = false;
    nextUpRef.current = false;
    organicWatchedRef.current = 0;
    lastOrganicTimeRef.current = 0;
    endedRef.current = false;
    countdownActiveRef.current = false;
    setNextUp(false);
    setCountdownActive(false);
    audioAutoAppliedRef.current = -1;
    skipSegmentLabelRef.current = null;
    setSkipSegment(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, defaultIndex]);

  const setLinkOutcome = useCallback((idx: number, outcome: ProbeOutcome) => {
    linkStatusesRef.current = { ...linkStatusesRef.current, [idx]: outcome };
    setLinkStatuses(linkStatusesRef.current);
    if (outcome === "dead") {
      failedLinksRef.current.add(idx);
    } else if (outcome === "valid") {
      failedLinksRef.current.delete(idx);
      playbackFailedRef.current.delete(idx);
    }
  }, []);

  /**
   * Pick the next fallback candidate. Two passes over the (already
   * recommendation-ranked) links array: first probe-verified links, then
   * anything not marked dead. Returns null when everything is exhausted.
   */
  const pickFallbackCandidate = useCallback(
    (failedIndex: number): number | null => {
      if (!links) return null;
      const n = links.length;
      const isUsable = (i: number) =>
        i !== failedIndex &&
        !failedLinksRef.current.has(i) &&
        !playbackFailedRef.current.has(i);

      // After content has been playing, only fall back to a lighter-or-equal
      // stream — never upgrade to a bigger file mid-playback.
      const currentSize = hasPlayedRef.current
        ? ((links[activeIndexRef.current]?._meta?.sizeBytes as
            | number
            | undefined) ?? 0)
        : 0;
      const withinSizeCap = (i: number) =>
        !hasPlayedRef.current ||
        currentSize === 0 || // unknown current size — allow anything
        ((links[i]?._meta?.sizeBytes as number | undefined) ?? 0) <=
          currentSize;

      for (let i = 0; i < n; i++) {
        if (
          isUsable(i) &&
          withinSizeCap(i) &&
          linkStatusesRef.current[i] === "valid"
        )
          return i;
      }
      for (let i = 0; i < n; i++) {
        if (isUsable(i) && withinSizeCap(i)) return i;
      }
      return null;
    },
    [links],
  );

  /**
   * A remembered "last working source" that fails again is a poisoned entry
   * (e.g. a dead link once falsely marked as playing) — forget it so the next
   * watch doesn't auto-promote it. Declared before beginSwitch/fallback since
   * both failure paths call it.
   */
  const forgetIfRemembered = useCallback(
    (url?: string) => {
      if (!url || !tmdbId || !rememberedSourceKeyRef.current) return;
      if (urlKeyOf(url) === rememberedSourceKeyRef.current) {
        rememberedSourceKeyRef.current = null;
        forgetWorkingSource(mediaType, tmdbId).catch(() => {});
        console.log(
          "[HevcPlayer] Remembered source failed again — forgetting it",
        );
      }
    },
    [mediaType, tmdbId],
  );

  const beginSwitch = useCallback(
    (toIndex: number, auto: boolean) => {
      setActiveLinkIndex(toIndex);
      setSwitchInfo({ toIndex, auto });
      if (auto) {
        pendingAutoToastRef.current = true;
        perfRef.current?.noteFallback();
      }
      // Fresh stall window for the incoming source.
      rebufferTimesRef.current = [];
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
      // Safety net: if nothing plays after the switch timeout, surface the error
      // instead of spinning forever on a source that will never open.
      switchTimeoutRef.current = setTimeout(function switchTimeout() {
        // Playback is frozen while backgrounded — a source must not be
        // condemned (or swapped, which would play() the new one) while the
        // user is away. Background-frozen timers fire right after resume
        // (after "active" already cleared the flag), so also defer briefly
        // on a fresh return.
        if (
          backgroundedRef.current ||
          Date.now() - lastActiveAtRef.current < 1500
        ) {
          console.log(
            "[FS-BG] switch timeout deferred — backgrounded or just returned",
          );
          switchTimeoutRef.current = setTimeout(switchTimeout, 2000);
          return;
        }
        const idx = activeIndexRef.current;
        failedLinksRef.current.add(idx);
        playbackFailedRef.current.add(idx);
        forgetIfRemembered(links?.[idx]?.url);
        if (isManualSelectionRef.current && !auto) {
          setSwitchInfo(null);
          setStreamError({
            title: "This source isn't responding",
            detail:
              "The server accepted the request but never sent any video data. Retry, or pick another source.",
          });
          return;
        }
        const next = pickFallbackCandidate(idx);
        if (next === null) {
          setSwitchInfo(null);
          setExhausted(true);
          onExhausted?.();
        } else {
          beginSwitch(next, true);
        }
      }, getPlayerTuning().switchTimeoutMs);
    },
    [pickFallbackCandidate, forgetIfRemembered, links],
  );

  function fallbackToNextLink(failedIndex: number, reason: string) {
    failedLinksRef.current.add(failedIndex);
    playbackFailedRef.current.add(failedIndex);

    const numLinks = links?.length ?? 0;
    if (numLinks <= 1) {
      setSwitchInfo(null);
      setExhausted(true);
      onExhausted?.();
      return;
    }

    // If the user explicitly picked this link, don't silently take them
    // elsewhere — show the error card with Retry instead.
    if (isManualSelectionRef.current) {
      console.log(
        `[HevcPlayer] Manual selection active — keeping stream ${failedIndex} despite ${reason} failure`,
      );
      setSwitchInfo(null);
      return;
    }

    const next = pickFallbackCandidate(failedIndex);
    if (next === null) {
      console.log(
        `[HevcPlayer] All ${numLinks} links exhausted after ${reason} failure`,
      );
      setSwitchInfo(null);
      setExhausted(true);
      onExhausted?.();
      return;
    }

    console.log(`[HevcPlayer] FALLBACK (${reason}): ${failedIndex} → ${next}`);
    // A repeatedly-stalling source still plays — only hard failures (error,
    // switch timeout, probe-dead) should un-remember it.
    if (reason !== "repeated-stalls") {
      forgetIfRemembered(links?.[failedIndex]?.url);
    }
    beginSwitch(next, true);
  }
  fallbackNowRef.current = fallbackToNextLink;

  // Load the remembered source key for this title (for forget-on-failure).
  useEffect(() => {
    if (!tmdbId) return;
    let cancelled = false;
    getLastWorkingSource(mediaType, tmdbId)
      .then((key) => {
        if (!cancelled) rememberedSourceKeyRef.current = key;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId]);

  // ── Probe all links in parallel; outcomes feed fallback + the picker ──
  const [recheckToken, setRecheckToken] = useState(0);
  useEffect(() => {
    if (!links || links.length <= 1) return;
    let cancelled = false;
    let pending = links.length;

    // Once every probe has settled: if the active link is confirmed dead and
    // nothing is playing, jump ONCE to the best remaining candidate — or admit
    // exhaustion. A single clean switch instead of hopping through dead links.
    const resolveAfterProbes = () => {
      if (cancelled || pending > 0) return;
      const activeIdx = activeIndexRef.current;
      if (hasPlayedRef.current) return;
      if (linkStatusesRef.current[activeIdx] !== "dead") return;
      if (isManualSelectionRef.current) return; // error card already shown
      const next = pickFallbackCandidate(activeIdx);
      if (next === null) {
        console.log(`[HevcPlayer] All ${links.length} probes dead — exhausted`);
        setSwitchInfo(null);
        setExhausted(true);
        onExhausted?.();
      } else {
        console.log(
          `[HevcPlayer] Active link ${activeIdx} dead — jumping to candidate ${next}`,
        );
        beginSwitch(next, true);
      }
    };

    const applyOutcome = (idx: number, result: ValidationResult) => {
      if (cancelled) return;
      setLinkOutcome(idx, result.outcome);

      // A remembered source the probes condemn — and that isn't actually
      // playing — is a poisoned entry; forget it.
      if (
        result.outcome === "dead" &&
        (!hasPlayedRef.current || idx !== activeIndexRef.current)
      ) {
        forgetIfRemembered(links?.[idx]?.url);
      }

      if (idx === activeIndexRef.current && result.outcome === "dead") {
        console.log(
          `[HevcPlayer] Active link ${idx} is dead (${result.statusCode || result.error})`,
        );
        if (hasPlayedRef.current) {
          // The link is actually delivering frames — the probe verdict is
          // wrong (edge rules, hotlink quirks). Playback is ground truth:
          // heal the status and keep watching.
          console.log(
            `[HevcPlayer] Link ${idx} is playing — probe verdict wrong, healing`,
          );
          failedLinksRef.current.delete(idx);
          linkStatusesRef.current = {
            ...linkStatusesRef.current,
            [idx]: "valid",
          };
          setLinkStatuses(linkStatusesRef.current);
        } else if (isManualSelectionRef.current) {
          setSwitchInfo(null);
          setStreamError(
            humanizeError(`HTTP ${result.statusCode ?? result.error ?? ""}`),
          );
        }
        // Otherwise hold position — resolveAfterProbes will switch straight
        // to a verified candidate once the batch settles.
        return;
      }

      // Promote a verified link over a dead/unknown active link. Deliberately
      // NOT over a merely-untested active link — the old behavior stole
      // playback from links that were loading perfectly fine.
      // Also never promote while content is actually playing — playback is
      // ground truth over probe verdicts (CDN hiccups mislead probes).
      if (
        result.outcome === "valid" &&
        idx !== activeIndexRef.current &&
        !isManualSelectionRef.current &&
        switchInfoRef.current === null &&
        !hasPlayedRef.current
      ) {
        const activeOutcome = linkStatusesRef.current[activeIndexRef.current];
        if (
          activeOutcome === "dead" ||
          (playbackFailedRef.current.has(activeIndexRef.current) &&
            activeOutcome !== "valid")
        ) {
          console.log(
            `[HevcPlayer] Promoting verified link ${idx} over failed link ${activeIndexRef.current}`,
          );
          beginSwitch(idx, true);
        }
      }
    };

    links.forEach((link, idx) => {
      const cached = prevalidatedResultsRef.current?.get(link.url);
      if (cached) {
        pending--;
        applyOutcome(idx, cached);
        resolveAfterProbes();
        return;
      }
      validateStreamUrl(link.url)
        .then((result) => {
          pending--;
          applyOutcome(idx, result);
          resolveAfterProbes();
        })
        .catch(() => {
          // transient probe error — outcome stays unrecorded
          pending--;
          resolveAfterProbes();
        });
    });

    return () => {
      cancelled = true;
    };
    // switchInfo intentionally excluded — applyOutcome reads latest via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, recheckToken, setLinkOutcome, beginSwitch, forgetIfRemembered]);

  // Construct VideoSource with per-host headers (lib/playerConfig) so file
  // hosts don't throttle ExoPlayer or drop Range requests
  const videoSource = useMemo(
    () => ({
      uri: toPlayableUri(activeUrl),
      headers: headersForUrl(activeUrl),
    }),
    [activeUrl],
  );

  // Detect container & codec from current link for buffer tuning + badges
  const container = detectContainer(currentLink?.name ?? "", activeUrl);
  const codec = detectCodec(
    currentLink?.name ?? "",
    activeUrl,
    currentLink?._meta,
  );
  const bufferProfile = getBufferProfile(container, codec);

  // Track continuous playback position across source switches and seeking
  const lastPlaybackTimeRef = useRef(startAt);

  // Create video player — immediate (no gating)
  const player = useVideoPlayer(videoSource, (playerInstance) => {
    console.log(
      `[HevcPlayer] useVideoPlayer creating for URL: ${activeUrl.slice(0, 80)} (container=${container}, codec=${codec})`,
    );
    playerInstance.loop = false;
    playerInstance.timeUpdateEventInterval = 0.25;
    // Native default is FALSE (despite docs saying true) — without this,
    // 2x speed pitches the audio up (chipmunk effect) on Android.
    playerInstance.preservesPitch = true;
    playerInstance.seekTolerance = { toleranceBefore: 5, toleranceAfter: 5 };
    playerInstance.scrubbingModeOptions = {
      increaseCodecOperatingRate: true,
      enableDynamicScheduling: true,
      useDecodeOnlyFlag: true,
      allowSkippingMediaCodecFlush: true,
    };
    playerInstance.bufferOptions = bufferProfile;
    const initialTime =
      lastPlaybackTimeRef.current > 0 ? lastPlaybackTimeRef.current : startAt;
    if (initialTime > 0) {
      playerInstance.currentTime = initialTime;
    }
    console.log("[FS-BG] source (re)created → initial play()");
    playerInstance.play();
  });

  // Wrap in adapter (stable — only recreated if player changes)
  const adapter = useMemo(() => new ExpoVideoAdapter(player), [player]);
  adapterRef.current = adapter;

  // Pause when the app is backgrounded — video and audio must stop. JS event
  // callbacks keep firing while backgrounded but JS timers do NOT (RN freezes
  // the Timing module), so the adapter itself squashes native playing
  // transitions during background (setAppBackgrounded) — a delayed re-pause
  // timer can't run there. Playback stays paused when the user returns.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        console.log(
          `[FS-BG] app → ${state}: pausing (playing=${player.playing}, status=${player.status})`,
        );
        backgroundedRef.current = true;
        adapterRef.current?.setAppBackgrounded?.(true);
        adapterRef.current?.pause();
      } else if (state === "active") {
        console.log(
          `[FS-BG] app → active (playing=${player.playing}, status=${player.status})`,
        );
        backgroundedRef.current = false;
        lastActiveAtRef.current = Date.now();
        adapterRef.current?.setAppBackgrounded?.(false);
      }
    });
    return () => sub.remove();
  }, []);

  // Inform adapter whether current link was probe-validated and provide size hint for metadata timeout
  useEffect(() => {
    adapter.setProbeValidated(
      linkStatusesRef.current[activeLinkIndex] === "valid",
    );
    const sizeBytes =
      currentLink?._meta?.sizeBytes ?? (currentLink as any)?.sizeBytes;
    adapter.setEstimatedSizeBytes(
      typeof sizeBytes === "number" ? sizeBytes : undefined,
    );

    // Recompute and re-apply bufferOptions dynamically on every source switch
    const currentContainer = detectContainer(
      currentLink?.name ?? "",
      activeUrl,
    );
    const currentCodec = detectCodec(
      currentLink?.name ?? "",
      activeUrl,
      currentLink?._meta,
    );
    player.bufferOptions = getBufferProfile(currentContainer, currentCodec);
  }, [adapter, activeLinkIndex, activeUrl, currentLink, player]);

  // ── Rebuffer watchdog ──
  // A source that keeps stalling AFTER starting is as dead as one that never
  // starts — the 12s switch timeout only catches the latter, and a lowered
  // start threshold (bufferProfiles) converts slow hosts into exactly this
  // failure mode. 3 stalls inside a 20s window ⇒ swap source; each source
  // gets a fresh window (beginSwitch resets it).
  useEffect(() => {
    let stallStartedAt: number | null = null;
    const unsub = adapter.onBuffering((isBuffering) => {
      // Background stalls (network throttled while away) are not the source's
      // fault and must not accumulate into a background source swap.
      if (backgroundedRef.current) {
        stallStartedAt = null;
        return;
      }
      if (endedRef.current) return;
      if (isBuffering) {
        // Seek-induced loading is expected, not a stall — the user asked for a
        // new position and playback must restart there. Without this, rapid
        // seeking reads as "3 rebuffers" and swaps away a healthy source.
        if (adapter.isSeeking?.()) return;
        // Pre-start buffering is the switch timeout's job; only stalls after
        // this source actually delivered frames count.
        if (hasPlayedRef.current) {
          stallStartedAt = Date.now();
          perfRef.current?.rebufferStart();
        }
        return;
      }
      if (stallStartedAt == null) return;
      stallStartedAt = null;
      perfRef.current?.rebufferEnd();
      // A seek interrupting an in-flight stall is user action — keep it in
      // telemetry but don't count it against the source.
      if (adapter.isSeeking?.()) return;
      const now = Date.now();
      const times = rebufferTimesRef.current;
      const { rebufferLimit, rebufferWindowMs } = getPlayerTuning();
      times.push(now);
      while (times.length > 0 && now - times[0] > rebufferWindowMs)
        times.shift();
      if (times.length >= rebufferLimit) {
        times.length = 0;
        const idx = activeIndexRef.current;
        console.log(
          `[HevcPlayer] ${rebufferLimit} rebuffers in ${rebufferWindowMs / 1000}s — leaving source ${idx}`,
        );
        fallbackNowRef.current(idx, "repeated-stalls");
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  // ── Restore this series' subtitle sync offset (persisted per series) ──
  useEffect(() => {
    if (!subtitleKey) return;
    let cancelled = false;
    getSubtitleOffset(subtitleKey)
      .then((seconds) => {
        if (!cancelled && seconds !== 0) {
          adapter.setSubtitleOffset(seconds * 1000);
          console.log(
            `[HevcPlayer] Restored subtitle offset ${seconds}s for ${subtitleKey}`,
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [adapter, subtitleKey]);

  // ── Perf instrumentation stage marks ──
  useEffect(() => {
    if (links && links.length > 0) perfRef.current?.mark("links");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    perfRef.current?.mark("player");
  }, [player]);

  // ── Transient toast (auto-switch confirmation, aspect toggle) ──
  const showToast = useCallback((text: string) => {
    setAutoToast(text);
    if (autoToastTimerRef.current) clearTimeout(autoToastTimerRef.current);
    autoToastTimerRef.current = setTimeout(() => setAutoToast(null), 2500);
  }, []);

  // ── Auto-select the audio track matching the preferred language ──
  // Track lists populate asynchronously after readyToPlay with no change
  // event, so poll briefly until they appear (or give up quietly).
  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryApply = () => {
      if (userAudioTouchedRef.current) return;
      if (audioAutoAppliedRef.current === activeLinkIndex) return;
      const a = adapterRef.current;
      if (!a) return;
      const tracks = a.getAudioTracks();
      if (tracks.length <= 1) {
        // Single track (or metadata not parsed yet) — keep polling briefly.
        if (++attempts < 10) timer = setTimeout(tryApply, 600);
        return;
      }
      const pick = pickPreferredTrack(tracks, preferredLanguage);
      if (pick) {
        a.setAudioTrack(pick.id);
        audioAutoAppliedRef.current = activeLinkIndex;
        console.log(
          `[HevcPlayer] Auto-selected audio track "${pick.label}" (preference=${preferredLanguage})`,
        );
      }
      // No matching track — keep the file's default and stop polling.
    };
    timer = setTimeout(tryApply, 1200);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeLinkIndex, preferredLanguage, hasStarted]);

  // Successful playback clears switching/error state and heals the link's status
  useEffect(() => {
    const unsub = adapter.onTimeUpdate((time, dur) => {
      if (time > 0) {
        const firstFrames = !hasPlayedRef.current;
        hasPlayedRef.current = true;
        setHasStarted(true);
        lastPlaybackTimeRef.current = time;
        if (firstFrames) perfRef.current?.mark("firstFrame");

        // Auto-switch transparency: confirm what the app decided, once.
        if (firstFrames && pendingAutoToastRef.current) {
          pendingAutoToastRef.current = false;
          const link = links?.[activeLinkIndex];
          showToast(
            `Now playing source ${activeLinkIndex + 1}${
              link?.quality ? ` · ${link.quality}` : ""
            }`,
          );
        }

        // Skip Intro/Recap window — segments come from the host (introdb).
        if (introSegments) {
          const active = getActiveSkipSegment(introSegments, time);
          const label = active?.label ?? null;
          if (label !== skipSegmentLabelRef.current) {
            skipSegmentLabelRef.current = label;
            setSkipSegment(
              active
                ? { endSec: active.segment.end_sec, label: active.label }
                : null,
            );
          }
        } else if (skipSegmentLabelRef.current !== null) {
          skipSegmentLabelRef.current = null;
          setSkipSegment(null);
        }

        // Next-episode CARD arming (button only, no countdown yet): outro
        // window (introdb) or 95% played — but only when the playhead
        // genuinely got there (organic watch time this session ≥ half the
        // episode), so a seek-to-end can't arm it early.
        if (
          mediaType === "tv" &&
          nextEpisode &&
          onNextEpisode &&
          dur > 0 &&
          !autoNextCancelledRef.current &&
          !nextUpRef.current
        ) {
          const delta = time - lastOrganicTimeRef.current;
          if (delta > 0 && delta <= 3) organicWatchedRef.current += delta;
          lastOrganicTimeRef.current = time;
          const outro = introSegments?.outro;
          const nearEnd =
            time / dur >= 0.95 ||
            (isSegmentUsable(outro) && time >= outro.start_sec);
          if (nearEnd && organicWatchedRef.current >= dur * 0.5) {
            nextUpRef.current = true;
            setNextUp(true);
            console.log("[HevcPlayer] Next-episode card armed (near end)");
          }
        }

        // One-shot resume correction: the currentTime assignment in the
        // player's setup callback can be silently dropped while a remote
        // source is still preparing — re-apply it once frames report ~0.
        if (startAt > 0 && resumeAppliedRef.current !== startAt) {
          resumeAppliedRef.current = startAt;
          if (time < Math.min(5, startAt * 0.5)) {
            adapter.seek(startAt);
          }
        }

        // Remember the source that actually works so the next watch of this
        // title can start from it directly (identity without expiring tokens)
        if (firstFrames && tmdbId) {
          const url = links?.[activeLinkIndex]?.url;
          if (url)
            rememberWorkingSource(mediaType, tmdbId, url).catch(() => {});
        }

        failedLinksRef.current.delete(activeLinkIndex);
        playbackFailedRef.current.delete(activeLinkIndex);
        if (linkStatusesRef.current[activeLinkIndex] !== "valid") {
          linkStatusesRef.current = {
            ...linkStatusesRef.current,
            [activeLinkIndex]: "valid",
          };
          setLinkStatuses(linkStatusesRef.current);
        }
        if (switchTimeoutRef.current) {
          clearTimeout(switchTimeoutRef.current);
          switchTimeoutRef.current = null;
        }
        setSwitchInfo(null);
        setStreamError(null);
        setExhausted(false);

        // Periodic progress save — closing the app mid-watch keeps ~15s of
        // position instead of losing everything. percent is a 0–1 fraction.
        if (dur > 0 && tmdbId && time - lastSavedPositionRef.current >= 15) {
          lastSavedPositionRef.current = time;
          saveProgress({
            tmdbId,
            mediaType,
            season,
            episode,
            currentTime: time,
            duration: dur,
            percent: time / dur,
            updatedAt: Date.now(),
            completed: false,
          }).catch(() => {});
        }
      }
    });
    return unsub;
  }, [
    adapter,
    activeLinkIndex,
    links,
    tmdbId,
    mediaType,
    season,
    episode,
    startAt,
    introSegments,
    nextEpisode,
    onNextEpisode,
    showToast,
  ]);

  // Log source changes for diagnostics — every switch reloads from scratch,
  // so the overlay's loading state comes back until frames arrive again.
  useEffect(() => {
    console.log(
      `[HevcPlayer] activeLinkIndex changed to ${activeLinkIndex}, URL=${currentLink?.url?.slice(0, 80)}`,
    );
    setHasStarted(false);
    hasPlayedRef.current = false;
    lastSavedPositionRef.current = 0;
  }, [activeLinkIndex, currentLink]);

  // ── Next episode (TV): card near the end + countdown auto-advance ──
  const goNextEpisode = useCallback(() => {
    if (!nextEpisode || !onNextEpisode) return;
    nextUpRef.current = false;
    countdownActiveRef.current = false;
    setNextUp(false);
    setCountdownActive(false);
    if (nextCountdownTimerRef.current) {
      clearInterval(nextCountdownTimerRef.current);
      nextCountdownTimerRef.current = null;
    }
    onNextEpisode(nextEpisode.season, nextEpisode.episode);
  }, [nextEpisode, onNextEpisode]);

  const cancelAutoNext = useCallback(() => {
    autoNextCancelledRef.current = true;
    nextUpRef.current = false;
    countdownActiveRef.current = false;
    setNextUp(false);
    setCountdownActive(false);
  }, []);

  useEffect(() => {
    if (!countdownActive) return;
    setNextCountdown(NEXT_EPISODE_COUNTDOWN_S);
    const deadline = Date.now() + NEXT_EPISODE_COUNTDOWN_S * 1000;
    nextCountdownTimerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setNextCountdown(left);
      if (left <= 0) {
        if (nextCountdownTimerRef.current) {
          clearInterval(nextCountdownTimerRef.current);
          nextCountdownTimerRef.current = null;
        }
        goNextEpisode();
      }
    }, 250);
    return () => {
      if (nextCountdownTimerRef.current) {
        clearInterval(nextCountdownTimerRef.current);
        nextCountdownTimerRef.current = null;
      }
    };
  }, [countdownActive, goNextEpisode]);

  // ── Natural end of media ──
  // TV with a next episode: start the auto-advance countdown. Movies (or the
  // final episode): stop quietly — NEVER fall back to another source here,
  // the stream was fine, the file is simply over.
  useEffect(() => {
    if (!adapter.onEnded) return;
    const unsub = adapter.onEnded(() => {
      if (endedRef.current) return;
      endedRef.current = true;
      console.log("[HevcPlayer] Playback reached natural end");
      if (switchTimeoutRef.current) {
        clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }
      setSwitchInfo(null);
      setStreamError(null);
      pendingAutoToastRef.current = false;
      // Stop expo-video's end-of-stream play() retry loop + buffering spinner.
      adapter.pause();

      if (
        mediaType === "tv" &&
        nextEpisode &&
        onNextEpisode &&
        !autoNextCancelledRef.current
      ) {
        nextUpRef.current = true;
        setNextUp(true);
        if (!countdownActiveRef.current) {
          countdownActiveRef.current = true;
          setCountdownActive(true);
        }
      }
      // else: ended — stay stopped.
    });
    return unsub;
  }, [adapter, mediaType, nextEpisode, onNextEpisode]);

  // Error-based fallback (safety net for playback failures the probe didn't catch)
  useEffect(() => {
    if (!adapter.onError) return;

    const unsubscribe = adapter.onError((error) => {
      // Natural end can look like a stall/error to the watchdog — it isn't.
      if (endedRef.current) return;
      const errMsg = error || "Playback error";
      console.log(
        `[HevcPlayer] Playback error: "${errMsg}" at index ${activeLinkIndex}`,
      );

      // An error seconds after enabling a subtitle track is the track failing
      // to decode (e.g. an unsupported text codec in this MKV), not the source
      // dying. Turn subtitles off and keep playing — switching sources here
      // discards a perfectly healthy stream.
      if (adapter.subtitleJustEnabled?.()) {
        console.log(
          `[HevcPlayer] Error right after subtitle selection — disabling subtitles, keeping source`,
        );
        adapter.setSubtitleTrack("off");
        // A failed text renderer can leave ExoPlayer idle; a seek to the
        // current position re-prepares the pipeline without losing the source.
        const t = adapter.getCurrentTime();
        if (t > 1) adapter.seek(t);
        showToast("Subtitle track failed — subtitles turned off");
        return;
      }

      // The probe said this link was fine but playback disagrees — forget the
      // cached verdict so a retry re-checks it.
      const failedUrl = links?.[activeLinkIndex]?.url;
      if (failedUrl) invalidateValidation(failedUrl);

      if (isManualSelectionRef.current) {
        setSwitchInfo(null);
        setStreamError(humanizeError(errMsg));
        return;
      }
      setStreamError(humanizeError(errMsg));
      fallbackToNextLink(activeLinkIndex, "error");
    });

    return unsubscribe;
  }, [adapter, isMultiLink, links, activeLinkIndex]);

  // ── User actions ──

  const retryCurrentLink = useCallback(() => {
    const idx = activeLinkIndex;
    const url = links?.[idx]?.url ?? activeUrl;
    if (url) invalidateValidation(url);

    failedLinksRef.current.delete(idx);
    playbackFailedRef.current.delete(idx);
    linkStatusesRef.current = { ...linkStatusesRef.current };
    delete linkStatusesRef.current[idx];
    setLinkStatuses(linkStatusesRef.current);

    // One manual retry is enough — after it, let auto-fallback act again.
    isManualSelectionRef.current = false;
    setStreamError(null);
    setExhausted(false);
    setSwitchInfo({ toIndex: idx, auto: false });
    // Force a fresh open of the same URL (cached responses, stale sockets)
    player.replaceAsync(videoSource).catch((e) => {
      console.log(`[HevcPlayer] replaceAsync on retry failed: ${e}`);
    });
  }, [activeLinkIndex, links, activeUrl, player, videoSource]);

  const recheckAllSources = useCallback(() => {
    clearValidationCache();
    clearPrefetchCache();
    failedLinksRef.current.clear();
    playbackFailedRef.current.clear();
    linkStatusesRef.current = {};
    setLinkStatuses({});
    isManualSelectionRef.current = false;
    setStreamError(null);
    setExhausted(false);
    setActiveLinkIndex(defaultIndex);
    recheckTokenRef.current += 1;
    setRecheckToken(recheckTokenRef.current);
    setSwitchInfo({ toIndex: defaultIndex, auto: false });
    player.replaceAsync(videoSource).catch((e) => {
      console.log(`[HevcPlayer] replaceAsync on recheck failed: ${e}`);
    });
  }, [defaultIndex, player, videoSource]);

  const handleSelectSource = useCallback(
    (idx: number) => {
      if (idx === activeLinkIndex) return;
      isManualSelectionRef.current = true;
      setStreamError(null);
      setExhausted(false);
      setSwitchInfo({ toIndex: idx, auto: false });
      setActiveLinkIndex(idx);
    },
    [activeLinkIndex],
  );

  // ── Live language re-selection ──
  // When the user CHANGES their preferred audio language: before anything has
  // played, re-rank and switch immediately. Once playback is healthy, never
  // interrupt it — only update the recommendation shown in the picker.
  // On mount (language unchanged) this only refreshes the recommendation —
  // the host page already picked the initial stream with the same settings,
  // and re-switching here just burns a player recreation (observed churn:
  // create #2 → create #0 → probe-dead → create #1 → create #2 again).
  const lastLangRef = useRef(preferredLanguage);
  useEffect(() => {
    if (!links || links.length <= 1) return;
    let cancelled = false;
    const langChanged = lastLangRef.current !== preferredLanguage;
    lastLangRef.current = preferredLanguage;
    selectBestStream(links, {
      preferredLanguage,
      runtimeMinutes: mediaType === "tv" ? 45 : 120,
    }).then((sel) => {
      if (cancelled) return;
      setSelection({ index: sel.bestIndex, reason: sel.selectionReason });
      if (!langChanged) return;
      const startedPlaying =
        hasPlayedRef.current ||
        linkStatusesRef.current[activeIndexRef.current] === "valid";
      if (
        !startedPlaying &&
        sel.bestIndex !== activeIndexRef.current &&
        !isManualSelectionRef.current
      ) {
        beginSwitch(sel.bestIndex, true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredLanguage, links]);

  // ── Fullscreen toggle ──
  const toggleFullscreen = useCallback(async () => {
    const next = !isFullscreen;
    if (next) {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE,
      );
    } else {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT,
      );
    }
    setIsFullscreen(next);
    onFullscreenChange?.(next);
  }, [isFullscreen, onFullscreenChange]);

  // Host-driven fullscreen (the watch-page overlay's expand button) — apply the
  // same orientation lock and mirror the state. Skips when it matches, so the
  // internal toggle → onFullscreenChange → host → back here loop is a no-op.
  useEffect(() => {
    if (externalFullscreen === undefined) return;
    setIsFullscreen((prev) => {
      if (prev === externalFullscreen) return prev;
      ScreenOrientation.lockAsync(
        externalFullscreen
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT,
      ).catch(() => {});
      return externalFullscreen;
    });
  }, [externalFullscreen]);

  // ── Close handler — save progress, restore orientation ──
  const handleClose = useCallback(async () => {
    const current = adapterRef.current;
    if (current) {
      const time = current.getCurrentTime();
      const dur = current.getDuration();
      if (tmdbId && time > 0 && dur > 0) {
        // percent is a 0–1 FRACTION in the store (was wrongly 0–100 here,
        // which marked every video ≥1% watched as completed)
        await saveProgress({
          tmdbId,
          mediaType,
          season,
          episode,
          currentTime: time,
          duration: dur,
          percent: time / dur,
          updatedAt: Date.now(),
          completed: false,
        });
      }
    }

    if (isFullscreen) {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT,
      );
    }

    if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
    if (nextCountdownTimerRef.current) {
      clearInterval(nextCountdownTimerRef.current);
      nextCountdownTimerRef.current = null;
    }
    if (autoToastTimerRef.current) clearTimeout(autoToastTimerRef.current);
    perfRef.current?.close();
    perfRef.current = null;
    adapter.destroy();
    onClose();
  }, [tmdbId, mediaType, season, episode, isFullscreen, onClose, adapter]);

  // ── Keep screen awake ──
  useEffect(() => {
    const unsubs = [
      adapter.onPlayPause((paused) => {
        if (!paused) KeepAwake.activateKeepAwakeAsync();
        else KeepAwake.deactivateKeepAwake();
      }),
    ];
    return () => {
      unsubs.forEach((u) => u());
      KeepAwake.deactivateKeepAwake();
    };
  }, [adapter]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
      if (nextCountdownTimerRef.current)
        clearInterval(nextCountdownTimerRef.current);
      if (autoToastTimerRef.current) clearTimeout(autoToastTimerRef.current);
      perfRef.current?.close();
      perfRef.current = null;
      adapter.destroy();
    };
  }, [adapter]);

  // ── Derived display data ──
  const containerLabel =
    container === "unknown"
      ? (currentLink?.type || "VIDEO").toUpperCase()
      : container.toUpperCase();

  const activeLanguages = currentLink
    ? parseLinkLanguages(currentLink.name)
    : [];
  const sourceSummary = [
    currentLink?.quality,
    containerLabel,
    activeLanguages.length > 0 ? activeLanguages[0].toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // What the loading spinner says — makes "what is it doing" visible.
  const loadingDetail = (() => {
    if (hasStarted || streamError || exhausted) return "";
    const total = links?.length ?? 0;
    const valid = Object.values(linkStatuses).filter(
      (s) => s === "valid",
    ).length;
    const src = `Source ${activeLinkIndex + 1}${total > 1 ? ` of ${total}` : ""}`;
    const verified =
      valid > 0 ? `${valid} source${valid === 1 ? "" : "s"} verified` : "";
    return [src, currentLink?.quality ?? "", verified]
      .filter(Boolean)
      .join(" · ");
  })();

  // What the switching pill says — never show a bare "Switching…"
  const switchingLabel = (() => {
    if (!switchInfo) return "";
    const n = switchInfo.toIndex + 1;
    const link = links?.[switchInfo.toIndex];
    const detail = link ? `${link.quality} · ${linkContainerLabel(link)}` : "";
    return `Trying source ${n} of ${links?.length ?? 0}${detail ? ` — ${detail}` : ""}`;
  })();

  return (
    <View style={styles.container}>
      <StatusBar hidden={isFullscreen} />

      {/* Video surface — loader only here, doesn't block overlay/back button */}
      <View
        style={[styles.videoContainer, isFullscreen && styles.videoFullscreen]}
      >
        <VideoView
          style={styles.video}
          player={player}
          nativeControls={false}
          allowsPictureInPicture={false}
          fullscreenOptions={{ enable: false }}
        />
      </View>

      {/* Controls overlay (also carries the switching pill + buffering spinner) */}
      <PlayerOverlay
        player={adapter}
        title={title}
        backdropUrl={backdropUrl}
        isFullscreen={isFullscreen}
        sourceLabel={sourceSummary || currentLink?.quality}
        isStreamLoading={!hasStarted}
        switchingLabel={switchInfo ? switchingLabel : null}
        overlaySuppressed={!!streamError || exhausted}
        loadingDetail={loadingDetail}
        skipLabel={skipSegment?.label}
        onSkipSegment={
          skipSegment
            ? () => adapterRef.current?.seek(skipSegment.endSec)
            : undefined
        }
        onAudioTrackSelected={() => {
          userAudioTouchedRef.current = true;
        }}
        subtitleKey={subtitleKey ?? undefined}
        subtitleOnlineSearch={subtitleOnlineSearch}
        onSourcePicker={
          isMultiLink ? () => setShowStreamPicker(true) : undefined
        }
        onToggleFullscreen={toggleFullscreen}
        onClose={handleClose}
        hideBack={!!onFullscreenChange}
      />

      {/* Auto-switch / aspect toast — never intercepts touches */}
      {autoToast && (
        <View style={styles.autoToast} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={14} color={colors.gold} />
          <Text style={styles.autoToastText}>{autoToast}</Text>
        </View>
      )}

      {/* Next-episode card — button near the end, countdown at natural end */}
      {nextUp && nextEpisode && onNextEpisode && !exhausted && !streamError && (
        <View style={styles.nextUpWrap} pointerEvents="box-none">
          <View style={styles.nextUpCard}>
            <TouchableOpacity
              style={styles.nextUpMain}
              onPress={goNextEpisode}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={
                countdownActive
                  ? `Next episode in ${nextCountdown} seconds`
                  : "Play next episode"
              }
            >
              <Ionicons
                name="play-skip-forward-outline"
                size={15}
                color={colors.gold}
              />
              <Text style={styles.nextUpText}>
                {countdownActive
                  ? `Next Episode in ${nextCountdown}s`
                  : "Next Episode"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.nextUpCancel}
              onPress={cancelAutoNext}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Cancel auto-advance"
            >
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Error cards — rendered above the controls overlay; the overlay is
          suppressed while a card is up so nothing covers them */}
      {streamError && !exhausted && (
        <ErrorCard
          icon="alert-circle-outline"
          title={streamError.title}
          detail={streamError.detail}
          primaryLabel="Retry"
          primaryIcon="refresh-outline"
          onPrimary={retryCurrentLink}
          secondaryLabel={isMultiLink ? "Choose source" : undefined}
          secondaryIcon="server-outline"
          onSecondary={
            isMultiLink ? () => setShowStreamPicker(true) : undefined
          }
          tertiaryLabel={onTryProvider ? "Try Another Server" : undefined}
          tertiaryIcon="swap-horizontal-outline"
          onTertiary={onTryProvider}
        />
      )}

      {/* All sources exhausted — offer re-check instead of a dead end */}
      {exhausted && (
        <ErrorCard
          icon="cloud-offline-outline"
          title={`All ${links?.length ?? 0} sources failed`}
          detail="None of the available streams responded. The links may have expired — re-checking often finds fresh ones."
          primaryLabel="Re-check all sources"
          primaryIcon="refresh-outline"
          onPrimary={recheckAllSources}
          secondaryLabel="Choose manually"
          secondaryIcon="list-outline"
          onSecondary={
            isMultiLink ? () => setShowStreamPicker(true) : undefined
          }
          tertiaryLabel={onTryProvider ? "Try Another Server" : undefined}
          tertiaryIcon="swap-horizontal-outline"
          onTertiary={onTryProvider}
        />
      )}

      {/* Stream picker (only when multiple links) */}
      {isMultiLink && (
        <StreamPickerSheet
          visible={showStreamPicker}
          links={links}
          activeIndex={activeLinkIndex}
          linkStatuses={linkStatuses}
          recommendedIndex={selection.index}
          lastUsedIndex={lastWorkingIndex}
          preferredLanguage={preferredLanguage}
          onRetest={recheckAllSources}
          onSelect={handleSelectSource}
          onClose={() => setShowStreamPicker(false)}
        />
      )}
    </View>
  );
}

/** Shared error/exhausted card — icon, human title/detail, recovery buttons. */
function ErrorCard({
  icon,
  title,
  detail,
  primaryLabel,
  primaryIcon,
  onPrimary,
  secondaryLabel,
  secondaryIcon,
  onSecondary,
  tertiaryLabel,
  tertiaryIcon,
  onTertiary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  primaryLabel: string;
  primaryIcon: keyof typeof Ionicons.glyphMap;
  onPrimary: () => void;
  secondaryLabel?: string;
  secondaryIcon?: keyof typeof Ionicons.glyphMap;
  onSecondary?: () => void;
  tertiaryLabel?: string;
  tertiaryIcon?: keyof typeof Ionicons.glyphMap;
  onTertiary?: () => void;
}) {
  return (
    <View style={styles.errorOverlay} pointerEvents="box-none">
      <View
        style={styles.errorCard}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Ionicons name={icon} size={32} color="#f87171" />
        <Text style={styles.errorTitle}>{title}</Text>
        <Text style={styles.errorSubtitle}>{detail}</Text>
        <TouchableOpacity
          style={styles.errorButton}
          onPress={onPrimary}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
        >
          <Ionicons name={primaryIcon} size={16} color={colors.playerBg} />
          <Text style={styles.errorButtonText}>{primaryLabel}</Text>
        </TouchableOpacity>
        {secondaryLabel && onSecondary && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onSecondary}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
          >
            <Ionicons
              name={secondaryIcon ?? "server-outline"}
              size={16}
              color={colors.textPrimary}
            />
            <Text style={styles.secondaryButtonText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        )}
        {tertiaryLabel && onTertiary && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onTertiary}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={tertiaryLabel}
          >
            <Ionicons
              name={tertiaryIcon ?? "swap-horizontal-outline"}
              size={16}
              color={colors.textPrimary}
            />
            <Text style={styles.secondaryButtonText}>{tertiaryLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.playerBg,
  },
  videoContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  video: {
    width: "100%",
    height: "100%",
  },
  videoFullscreen: {
    width: "100%",
    height: "100%",
    transform: [],
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 10,
  },
  errorCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    maxWidth: 360,
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    gap: 12,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  errorSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  errorButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 6,
    minHeight: 44,
    justifyContent: "center",
  },
  errorButtonText: {
    color: colors.playerBg,
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "transparent",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  autoToast: {
    position: "absolute",
    alignSelf: "center",
    top: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(14, 14, 17, 0.92)",
    borderColor: "rgba(212, 162, 55, 0.4)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    zIndex: 50,
    elevation: 8,
  },
  autoToastText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  nextUpWrap: {
    position: "absolute",
    right: 16,
    bottom: 96,
    zIndex: 40,
    elevation: 8,
  },
  nextUpCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(14, 14, 17, 0.92)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(212, 162, 55, 0.4)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  nextUpMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  nextUpText: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  nextUpCancel: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
});
