/**
 * DirectVideoPlayer — format-agnostic direct-play video player.
 *
 * Unlike iframe-embed providers, this renders a real playback pipeline for
 * providers that serve direct video file URLs. The URL can point to any
 * format: MP4, HLS (.m3u8), DASH (.mpd), MKV (H.264 or HEVC), WebM, AV1,
 * VP8/9, with AAC, MP3, AC-3, E-AC-3, Opus, FLAC audio.
 *
 * Engine routing:
 *   - Desktop (Electron)   → mpv (native child window — every format)
 *   - Web (browser)        → movi-player (single engine for EVERY format:
 *                            FFmpeg WASM demux + WebCodecs decode for
 *                            MKV/HEVC/AV1, shaka/hls.js for manifests, with
 *                            internal escalation; reports standard media
 *                            events so the UI never branches on format)
 *
 * Both engines render through the same PlayerShell/ControlBar + StreamPickerSheet
 * UI, driven by an adapter — identical chrome on desktop app and website.
 *
 * Platform-aware sorting: the source LIST prefers x264 over HEVC on Windows
 * (cheaper decode); the engine no longer branches on it.
 */

"use client";

// Bundle marker — if this doesn't appear in renderer console, the running
// bundle is stale. Check: mainWindow.webContents.on('console-message', ...)
console.log("[Direct] bundle-marker/movi-web-engine-1");

import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  Clapperboard,
  RefreshCw,
  ArrowRightLeft,
  Server,
  CircleCheck,
  TriangleAlert,
} from "lucide-react";
import { PlayerShell } from "./PlayerShell";
import { MoviPlayerAdapter } from "./player-adapters";
import { MpvPlayerAdapter } from "./MpvPlayerAdapter";
import { useMpvDesktopShortcuts } from "./useMpvDesktopShortcuts";
import { StreamPickerSheet } from "./StreamPickerSheet";
import { SubtitleSearchSheet } from "./SubtitleSearchSheet";
import { humanizeError, type ProbeOutcome } from "@/lib/probeStream";
import {
  selectBestStream,
  rememberWorkingSource,
  getLastWorkingSource,
  forgetIfRemembered,
  isDownloadOnlyLink,
  type StreamEntry,
  type PreferredLanguage,
} from "@/lib/streamSelector";
import {
  detectFormat,
  selectDecoder,
  isWindowsPlatform,
  isHevcEncoding,
  type DetectedFormat,
  type DecoderType,
} from "@/lib/formatDetection";
import { apiUrl } from "@/lib/tmdb";
import {
  getPrefetchedDirectMedia,
  prefetchDirectMedia,
} from "@/lib/directPrefetch";
import { probeUrl, probeUrls, invalidateProbe } from "@/lib/probeCache";

// Bumped by every mount of the mpv lifecycle effect (effect 4b). The unmount
// cleanup defers its destroy briefly and skips it if a newer mount followed —
// that's how Fast Refresh / StrictMode re-runs are told apart from a real
// navigation (the old import.meta.hot sniffing never detected Turbopack).
let mpvLifecycleGeneration = 0;

// ── Types ─────────────────────────────────────────────────────────

interface DirectVideoEntry {
  quality: string;
  id: string;
  name: string;
  size?: string;
  url: string; // Direct video URL — could be .mp4, .m3u8, .mpd, .mkv, etc.
  type: string; // Container type: "mkv" | "mp4" | etc.
  _meta?: {
    codec: string;
    audio: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
  };
}

interface DirectApiData {
  tmdb_id: number;
  imdb_id?: string;
  media_type: string;
  // For TV — seasons with episodes, each containing direct links
  seasons?: Array<{
    season_number: number;
    episodes: Array<{
      episode_number: number;
      title: string;
      links: DirectVideoEntry[];
    }>;
  }>;
  // For movies — direct links
  links?: DirectVideoEntry[];
}

interface DirectVideoPlayerProps {
  /** TMDB content ID */
  tmdbId: string;
  /** Media type: movie or tv */
  mediaType: "movie" | "tv";
  /** Current season (TV only) */
  selectedSeason?: number;
  /** Current episode (TV only) */
  activeEpisode?: number;
  /** Called when video starts playing */
  onLoad?: () => void;
  /** Called on error (metadata failure / pre-playback failure / no links) —
   *  VideoZone uses this to auto-fall-back to an embed provider. */
  onError?: () => void;
  /** Called when every direct link has failed — VideoZone hands off to the
   *  next (embed) provider, once, instead of dead-ending. */
  onExhausted?: () => void;
  /** Language preference for auto-play */
  preferredLanguage?: PreferredLanguage;
}

/**
 * Match the user's preferred language against an audio track list from an
 * in-progress file (port of mobile's pickPreferredTrack). Returns the first
 * track whose label mentions the preferred language, or null.
 */
function pickPreferredAudioTrack(
  tracks: { id: string; label: string }[],
  pref: PreferredLanguage,
): { id: string; label: string } | null {
  if (pref === "auto") return null;
  const patterns: Record<Exclude<PreferredLanguage, "auto">, RegExp> = {
    multi: /multi|dual/i,
    hindi: /hindi|\bhin\b/i,
    english: /english|\beng\b/i,
  };
  const re = patterns[pref];
  return tracks.find((t) => re.test(t.label)) ?? null;
}

/**
 * PlayerToast — top-center confirmation over the video ("Now playing source 2
 * of 5 · 1080p") or a gentle hint (prolonged stall). Shared by the mpv and
 * movi branches so the web player reads exactly like the desktop one.
 */
function PlayerToast({
  toast,
}: {
  toast: { text: string; tone: "gold" | "warn" };
}) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div
        className={`flex items-center gap-2 rounded-full px-4 py-1.5 border shadow-lg animate-[fadeIn_0.15s_ease-out] ${
          toast.tone === "gold"
            ? "bg-black/75 border-[#D4A237]/40 text-[#D4A237]"
            : "bg-black/75 border-amber-400/40 text-amber-300"
        }`}
      >
        {toast.tone === "gold" ? (
          <CircleCheck size={13} className="shrink-0" />
        ) : (
          <TriangleAlert size={13} className="shrink-0" />
        )}
        <span className="text-xs font-semibold whitespace-nowrap">
          {toast.text}
        </span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────

export function DirectVideoPlayer({
  tmdbId,
  mediaType,
  selectedSeason = 1,
  activeEpisode = 1,
  onLoad,
  onError,
  onExhausted,
  preferredLanguage = "auto",
}: DirectVideoPlayerProps) {
  const loadingRef = useRef(false);

  // Adapter refs for ControlBar integration
  const mpvAdapterRef = useRef<MpvPlayerAdapter | null>(null);
  const mpvContainerRef = useRef<HTMLDivElement | null>(null);
  const [mpvAdapter, setMpvAdapter] = useState<MpvPlayerAdapter | null>(null);
  // In-page player UI state (control strip + settings panel + picker button)
  const [mpvSourceLabel, setMpvSourceLabel] = useState("");
  const [mpvTracks, setMpvTracks] = useState<{ audio: any[]; sub: any[] }>({
    audio: [],
    sub: [],
  });

  // ── movi-player (web engine — every format) ──
  const moviElRef = useRef<any>(null);
  const moviAdapterRef = useRef<MoviPlayerAdapter | null>(null);
  const [moviAdapter, setMoviAdapter] = useState<MoviPlayerAdapter | null>(
    null,
  );
  // The element module (movi-player/element/slim) is code-split — loaded and
  // registered the first time a web session actually needs it.
  const [moviElementReady, setMoviElementReady] = useState(false);
  // Audio/subtitle tracks from the element, mirrored for the ControlBar menus.
  const [moviTracks, setMoviTracks] = useState<{ audio: any[]; sub: any[] }>({
    audio: [],
    sub: [],
  });

  const [apiData, setApiData] = useState<DirectApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLinkIdx, setActiveLinkIdx] = useState(0);
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat | null>(
    null,
  );
  const [decoder, setDecoder] = useState<DecoderType | null>(null);

  // ── Source fallback chain ──
  const [failedLinks, setFailedLinks] = useState<Set<number>>(new Set());
  // Mirror of failedLinks for stable reads — fallbackToNextLink must NOT
  // depend on the failedLinks state object: a new Set per failure would give
  // it a new identity, re-running the decoder effects and replaying the same
  // dead URL in an infinite restart loop.
  const failedLinksRef = useRef<Set<number>>(new Set());
  const hasPlayedRef = useRef(false);
  // Guard so rememberWorkingSource fires once per mount, not per link switch
  const hasPlayedOnceRef = useRef(false);
  // Sources that reached real playback this session, in order (most recent
  // last). Once video has played the app NEVER breaks it, so these only
  // leave the "current" slot by user choice — they're demoted to the very
  // end of the fallback chain (the user's last working source is the final
  // attempt before embed), not retried mid-walk.
  const provenOrderRef = useRef<number[]>([]);
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Position-advance poll for the mpv stall watchdog — verifies playback by
  // watching currentTime advance instead of trusting mpv event delivery.
  const posPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Singleton mpv: generation counter for event subscription staleness.
  // Each render that re-subscribes bumps gen; stale callbacks see a mismatch
  // and bail, preventing fallbackToNextLink from firing after a manual switch.
  const eventGenRef = useRef(0);

  // ── Player toast (top-center of the video area) ──
  // Replaces error cards for source switching: failover is silent except a
  // "Now playing source N" confirmation when frames land.
  const [playerToast, setPlayerToast] = useState<{
    text: string;
    tone: "gold" | "warn";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback(
    (text: string, tone: "gold" | "warn" = "gold", ms = 2600) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setPlayerToast({ text, tone });
      toastTimerRef.current = setTimeout(() => setPlayerToast(null), ms);
    },
    [],
  );

  // ── Probing + switching indicator ──
  const mpvCleanupRef = useRef<(() => void) | null>(null);
  const [linkStatuses, setLinkStatuses] = useState<Map<number, ProbeOutcome>>(
    new Map(),
  );
  const [switchInfo, setSwitchInfo] = useState<{
    toIndex: number;
    auto: boolean;
  } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  /** Any HTML overlay open over the mpv surface (settings panel). The native
   *  video window must hide or it covers the overlay completely. */
  const [mpvOverlayOpen, setMpvOverlayOpen] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  // True when the shown error is a player-engine failure (mpv dead / IPC
  // never connected), not a bad source — Retry then keeps the current link
  // instead of resetting the whole chain back to link 0.
  const [errorIsInfra, setErrorIsInfra] = useState(false);
  // Nonces force effect re-runs that deps alone can't express: reload re-fetches
  // metadata (Retry), probe re-runs probing (Retest / re-check after exhaustion).
  const [reloadNonce, setReloadNonce] = useState(0);
  const [probeNonce, setProbeNonce] = useState(0);
  // Poster gating: show poster until mpv has video output
  const [mpvVideoActive, setMpvVideoActive] = useState(false);

  // Stabilize callbacks — prevent effect re-runs on parent re-render
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const onExhaustedRef = useRef(onExhausted);
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onExhaustedRef.current = onExhausted;
  }, [onExhausted]);

  // True once REAL frames rendered (mpv playback-restart / loadeddata) —
  // drives the stall watchdog and the source-memory loop. mpv.play() merely
  // means the command was accepted, so this is the honest "playing" signal.
  const [playbackStarted, setPlaybackStarted] = useState(false);
  // Subtitles: online-search sheet visibility
  const [showSubSearch, setShowSubSearch] = useState(false);
  // A manual audio-track choice disables auto-pick for the session
  const userAudioTouchedRef = useRef(false);
  // "No links → embed fallback" fires once per metadata load
  const noLinksReportedRef = useRef(false);

  // ── 0. mpv pre-warm (desktop) ──
  // Spawning mpv.exe + the IPC handshake takes 1-3s. Start it the moment the
  // watch page mounts — in parallel with the metadata fetch — so the process
  // is ready to loadfile the instant a URL resolves. Idempotent in main
  // (no-op if already running); idle mpv costs ~nothing.
  useEffect(() => {
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv?.start) return;
    console.log(
      "[Direct] mpv: pre-warming process (parallel with metadata fetch)",
    );
    mpv.start().catch(() => {});
  }, []);

  // ── 1. Fetch metadata from Direct API proxy ──
  useEffect(() => {
    let cancelled = false;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setExhausted(false);
    setActiveLinkIdx(0);
    setFailedLinks(new Set());
    failedLinksRef.current = new Set();
    hasPlayedRef.current = false;
    setPlaybackStarted(false);
    userAudioTouchedRef.current = false;
    if (switchTimeoutRef.current) {
      clearTimeout(switchTimeoutRef.current);
      switchTimeoutRef.current = null;
    }

    console.log(
      `[Direct] Fetching metadata for tmdbId=${tmdbId}, mediaType=${mediaType}, season=${selectedSeason}, episode=${activeEpisode}`,
    );

    const params = new URLSearchParams({ id: tmdbId });
    if (mediaType === "tv") {
      params.set("season", String(selectedSeason));
      params.set("episode", String(activeEpisode));
    }

    const fetchMeta = (): Promise<DirectApiData> =>
      fetch(apiUrl(`/api/player/direct?${params.toString()}`)).then((res) => {
        if (!res.ok) throw new Error(`Direct API returned ${res.status}`);
        return res.json() as Promise<DirectApiData>;
      });

    // Reuse a hover-prefetched request when one is fresh — the metadata fetch
    // is the first blocking step of startup, and on desktop it usually
    // resolved while the user was still hovering the title card.
    const prefetched = getPrefetchedDirectMedia(
      mediaType === "tv" ? "tv" : "movie",
      String(tmdbId),
      mediaType === "tv" ? selectedSeason : undefined,
      mediaType === "tv" ? activeEpisode : undefined,
    ) as Promise<DirectApiData> | undefined;

    (prefetched ?? fetchMeta())
      .then((data) => {
        if (cancelled) return;
        console.log(`[Direct] API data received`, {
          tmdb_id: data.tmdb_id,
          has_links: !!data.links,
          has_seasons: !!data.seasons,
        });
        setApiData(data);
        setLoading(false);
        loadingRef.current = false;
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error(`[Direct] API fetch failed —`, err.message);
        setError(err.message);
        setLoading(false);
        loadingRef.current = false;
        onErrorRef.current?.();
      });

    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType, selectedSeason, activeEpisode, reloadNonce]);

  // ── 2. Resolve video entries for current media/episode ──
  const videoEntries: DirectVideoEntry[] = useMemo(() => {
    if (!apiData) return [];

    let entries: DirectVideoEntry[];

    if (mediaType === "movie" || apiData.media_type === "movie") {
      entries = apiData.links || [];
    } else if (apiData.links) {
      // TV with server-side resolution — API already filters by season/episode
      entries = apiData.links;
    } else if (apiData.seasons) {
      const season = apiData.seasons.find(
        (s) => s.season_number === selectedSeason,
      );
      if (!season) return [];
      const episode = season.episodes.find(
        (e) => e.episode_number === activeEpisode,
      );
      entries = episode?.links || [];
    } else {
      return [];
    }

    // Drop sample/demo rips — 20-second promos the API labels with the full
    // movie's quality ("SAMPLE-The.Xxx…", 253 MB as "1080p"). They pollute
    // the source picker and waste an auto-failover hop. If EVERYTHING is a
    // sample, keep the originals rather than showing none.
    const nonSample = entries.filter((e) => !/\bsample\b/i.test(e.name));
    if (nonSample.length > 0) entries = nonSample;

    // Sort: H.264 (x264/AVC) before HEVC (x265/HEVC) for browser compatibility.
    const onWindows = isWindowsPlatform();

    return entries.sort((a, b) => {
      const aHevc = a._meta
        ? a._meta.codec === "hevc"
          ? 1
          : 0
        : isHevcEncoding(a.name)
          ? 1
          : 0;
      const bHevc = b._meta
        ? b._meta.codec === "hevc"
          ? 1
          : 0
        : isHevcEncoding(b.name)
          ? 1
          : 0;
      if (aHevc !== bHevc) {
        return onWindows ? aHevc - bHevc : bHevc - aHevc;
      }
      return 0;
    });
  }, [apiData, mediaType, selectedSeason, activeEpisode]);

  // ── Smart source selection ──
  const streamSelection = useMemo(() => {
    if (videoEntries.length === 0) return null;
    return selectBestStream(videoEntries, {
      preferredLanguage,
      runtimeMinutes: mediaType === "tv" ? 45 : 120,
    });
  }, [videoEntries, preferredLanguage, mediaType]);

  // Rank position per link id (from the selector) — drives failover order and
  // row ordering in the source picker.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    if (streamSelection) {
      streamSelection.sortedLinks.forEach((l, rank) => m.set(l.id, rank));
    }
    return m;
  }, [streamSelection]);

  // Set initial index from smart selection (once, on mount)
  const smartSelectionAppliedRef = useRef(false);
  useEffect(() => {
    if (smartSelectionAppliedRef.current) return;
    if (!streamSelection) return;
    if (videoEntries.length === 0) return;
    smartSelectionAppliedRef.current = true;

    // Download-only links can't stream — never let the opener be one.
    const playable = (i: number) =>
      i >= 0 && !isDownloadOnlyLink(videoEntries[i]);
    const firstPlayableByRank = (): number => {
      let best = -1;
      let bestRank = Number.MAX_SAFE_INTEGER;
      for (let i = 0; i < videoEntries.length; i++) {
        if (!playable(i)) continue;
        const r =
          rankById.get(videoEntries[i].id ?? "") ?? Number.MAX_SAFE_INTEGER - 1;
        if (r < bestRank) {
          bestRank = r;
          best = i;
        }
      }
      return best;
    };

    // Check for remembered source first
    const remembered = getLastWorkingSource(mediaType, tmdbId);
    if (remembered) {
      const idx = videoEntries.findIndex(
        (l) => l.url.split("?")[0] === remembered,
      );
      if (playable(idx)) {
        console.log(`[Direct] Using remembered source: index ${idx}`);
        setActiveLinkIdx(idx);
        return;
      }
    }

    // Use smart selection (skipping download-only links)
    const best = playable(streamSelection.bestIndex)
      ? streamSelection.bestIndex
      : firstPlayableByRank();
    console.log(
      `[Direct] Smart selection: index ${best} (${streamSelection.selectionReason})`,
    );
    setActiveLinkIdx(best >= 0 ? best : streamSelection.bestIndex);
  }, [streamSelection, videoEntries, mediaType, tmdbId, rankById]);

  // ── Priority numbering ("Now playing source N") ──
  // N is the link's position in the ranked order of STREAMABLE links —
  // download-only entries don't count, so the number matches the user's
  // mental model of "source 1 is the best, source 2 the next…".
  const priorityById = useMemo(() => {
    const m = new Map<string, number>();
    const ranked = [...videoEntries]
      .filter((e) => !isDownloadOnlyLink(e))
      .sort(
        (a, b) =>
          (rankById.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (rankById.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    ranked.forEach((l, i) => m.set(l.id, i + 1));
    return m;
  }, [videoEntries, rankById]);
  const playableTotal = priorityById.size;
  const priorityOfIndex = useCallback(
    (idx: number) => priorityById.get(videoEntries[idx]?.id ?? "") ?? null,
    [priorityById, videoEntries],
  );

  // The source the user last watched this title with ("Last used" badge)
  const lastUsedIndex = useMemo(() => {
    const remembered = getLastWorkingSource(mediaType, tmdbId);
    if (!remembered) return null;
    const idx = videoEntries.findIndex(
      (l) => l.url.split("?")[0] === remembered,
    );
    return idx >= 0 ? idx : null;
  }, [videoEntries, mediaType, tmdbId]);

  // Picker view of statuses: playback failures always read as dead (playback
  // is ground truth), even when a probe classified the link as alive.
  const pickerStatuses = useMemo(() => {
    const m = new Map(linkStatuses);
    failedLinks.forEach((i) => m.set(i, "dead"));
    return m;
  }, [linkStatuses, failedLinks]);

  // ── No links at all → hand off to the embed provider ──
  // An empty API response is not a dead-end: VideoZone's onError path switches
  // to the next (embed) provider automatically.
  useEffect(() => {
    if (loading || error || !apiData) return;
    if (videoEntries.length > 0) {
      noLinksReportedRef.current = false;
      return;
    }
    if (noLinksReportedRef.current) return;
    noLinksReportedRef.current = true;
    console.log(
      "[Direct] no playable links in API response — falling back to embed provider",
    );
    onErrorRef.current?.();
  }, [apiData, loading, error, videoEntries.length]);

  // Current entry (based on active link index, clamped to valid range)
  const currentEntry =
    videoEntries.length > 0
      ? videoEntries[Math.min(activeLinkIdx, videoEntries.length - 1)]
      : null;

  // Expose switching label for PlayerShell overlay — numbered by the link's
  // priority among streamable sources (matches the "Now playing source N" toast)
  const switchingLabel = switchInfo
    ? (() => {
        const entry = videoEntries[switchInfo.toIndex];
        const n = priorityOfIndex(switchInfo.toIndex);
        const label = [
          n != null ? `source ${n} of ${playableTotal}` : "next source",
          entry?.quality,
        ]
          .filter(Boolean)
          .join(" — ");
        return `Trying ${label}`;
      })()
    : undefined;

  // ── Probe active link FIRST, then rest in background ──
  // Verdicts come from the shared probeCache: a link probed while hovering a
  // card is already classified here — no second network round-trip. Desktop
  // probes through the main process (no CORS, inspects actual bytes); web
  // falls back to the renderer fetch probe.
  const probeRunRef = useRef(0);
  useEffect(() => {
    if (videoEntries.length === 0) return;
    const runId = ++probeRunRef.current;
    const urls = videoEntries.map((e) => e.url).filter(Boolean);
    if (urls.length === 0) return;

    console.log(
      `[Direct] Probing active link ${activeLinkIdx}/${urls.length} (shared verdict cache)...`,
    );
    probeUrl(urls[activeLinkIdx] ?? "", 6000).then((outcome) => {
      if (runId !== probeRunRef.current) return;
      console.log(`[Direct] Active link probe: ${outcome}`);
      // Playback is ground truth — never overwrite a valid verdict with a
      // stale probe once frames are actually rendering.
      setLinkStatuses((prev) => {
        if (hasPlayedRef.current && prev.get(activeLinkIdx) === "valid")
          return prev;
        return new Map(prev).set(activeLinkIdx, outcome);
      });

      // If active link is dead and nothing played yet, sweep the rest in the
      // background so the failover machine has verdicts to work with.
      if (outcome === "dead" && !hasPlayedRef.current) {
        probeUrls(urls, (index, o) => {
          if (runId !== probeRunRef.current) return;
          setLinkStatuses((prev) => new Map(prev).set(index, o));
        });
      }
    });

    return () => {
      probeRunRef.current++;
    };
  }, [videoEntries, probeNonce, activeLinkIdx]);

  // Probe the full list when the source picker opens (statuses for the list).
  // Cached verdicts resolve instantly, so re-opening is free.
  useEffect(() => {
    if (!showPicker || videoEntries.length <= 1) return;
    const runId = ++probeRunRef.current;
    const urls = videoEntries.map((e) => e.url).filter(Boolean);
    probeUrls(urls, (index, outcome) => {
      if (runId !== probeRunRef.current) return;
      setLinkStatuses((prev) => new Map(prev).set(index, outcome));
    });
    return () => {
      probeRunRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPicker]);

  // ── Source fallback ──
  // Mirror of linkStatuses for stable reads — keeps fallbackToNextLink's
  // identity stable so event subscriptions don't churn on probe updates.
  // Declared BEFORE the probe resolver below so the ref is already fresh
  // within the same commit the resolver decides to walk the chain.
  const linkStatusesRef = useRef(linkStatuses);
  useEffect(() => {
    linkStatusesRef.current = linkStatuses;
  }, [linkStatuses]);

  // Live probe resolver: while nothing has played yet, a probe-dead ACTIVE
  // source is a failure — walk the fallback chain immediately instead of
  // burning the 12s switch timeout on a link we already know is dead.
  // (Applies to user-picked sources too: a dead pick continues down the chain.)
  const probeResolvedRef = useRef(false);
  useEffect(() => {
    if (videoEntries.length <= 1) return;
    if (hasPlayedRef.current) return;
    if (probeResolvedRef.current) return;

    const activeOutcome = linkStatuses.get(activeLinkIdx);
    if (activeOutcome !== "dead") return;

    probeResolvedRef.current = true;
    console.log(
      `[Direct] probe says active source dead → walking fallback chain`,
    );
    fallbackRef.current(activeLinkIdx, "probe-dead");
  }, [linkStatuses, activeLinkIdx, videoEntries]);

  const fallbackToNextLink = useCallback(
    (failedIndex: number, reason: string, opts?: { infra?: boolean }) => {
      console.log(
        `[Direct] fallbackToNextLink: idx=${failedIndex} reason=${reason}`,
      );
      setLastError(reason);
      setErrorIsInfra(!!opts?.infra);
      setSwitchInfo(null);
      setPlaybackStarted(false);
      if (switchTimeoutRef.current) {
        clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }

      // Player-engine failure (mpv process died / IPC never connected / window
      // lost) — NOT a stream problem. Every other link would hit the same
      // broken engine, so marking this link dead and auto-hopping sources is
      // both wrong (it condemned perfectly good links) and useless. Show the
      // error card with Retry; the source keeps its probe verdict.
      if (opts?.infra) {
        console.log(
          "[Direct] infra failure — source is not at fault, showing error card",
        );
        setError(reason);
        return;
      }

      const nextFailed = new Set(failedLinksRef.current).add(failedIndex);
      failedLinksRef.current = nextFailed;
      setFailedLinks(nextFailed);

      // Playback failure overrides any probe verdict: mark this link dead for
      // the picker, and drop its cached "valid" so a retest re-probes it.
      const failedUrl = videoEntries[failedIndex]?.url;
      if (failedUrl) invalidateProbe(failedUrl);
      setLinkStatuses((prev) => new Map(prev).set(failedIndex, "dead"));

      // Forget remembered source if it failed
      if (failedUrl) {
        const remembered = getLastWorkingSource(mediaType, tmdbId);
        forgetIfRemembered(mediaType, tmdbId, failedUrl, remembered);
      }

      // ── Fallback chain (priority walk) ──
      // Every streamable link has a priority (selector rank). The next
      // candidate is the highest-priority link that is: not the failed one,
      // not already failed this session, not download-only, and — key rule —
      // NOT one the user already watched and deliberately abandoned. Proven
      // sources go to the BACK of the chain, most recent proven last: the
      // user's last working source is the final attempt before embed.
      const statuses = linkStatusesRef.current;
      const proven = provenOrderRef.current;
      const rankOf = (i: number) =>
        rankById.get(videoEntries[i]?.id ?? "") ?? Number.MAX_SAFE_INTEGER;
      const statusGroup = (i: number) =>
        i === failedIndex || statuses.get(i) === "dead"
          ? 2
          : statuses.get(i) === "valid"
            ? 0
            : 1;
      const byPriority = (a: number, b: number) =>
        statusGroup(a) - statusGroup(b) || rankOf(a) - rankOf(b);

      const head: number[] = [];
      const tail: number[] = [];
      for (let i = 0; i < videoEntries.length; i++) {
        if (i === failedIndex || nextFailed.has(i)) continue;
        if (isDownloadOnlyLink(videoEntries[i])) continue;
        (proven.includes(i) ? tail : head).push(i);
      }
      head.sort(byPriority);
      // Oldest proven first, the most recent working source dead last
      tail.sort((a, b) => proven.indexOf(a) - proven.indexOf(b));
      const ordered = [...head, ...tail];

      const nextIdx = ordered[0] ?? -1;
      if (nextIdx === -1) {
        // Chain exhausted — hand off to the embed provider and show our card
        // while the switch happens (NOT the parent's error overlay).
        console.log(
          "[Direct] fallback chain exhausted — handing off to embed provider",
        );
        setSwitchInfo(null);
        setExhausted(true);
        onExhaustedRef.current?.();
        return;
      }

      const nextPriority = priorityOfIndex(nextIdx);
      console.log(
        `[Direct] falling back → source ${nextPriority ?? "?"} of ${playableTotal}: ${videoEntries[nextIdx]?.name}`,
      );
      hasPlayedRef.current = false;
      probeResolvedRef.current = false;
      setSwitchInfo({ toIndex: nextIdx, auto: true });
      setDetectedFormat(null);
      setActiveLinkIdx(nextIdx);

      // Switch timeout — if nothing plays in 12s, mark as failed and try next.
      // Cleared by the playback-ground-truth effect on first frames.
      switchTimeoutRef.current = setTimeout(() => {
        if (hasPlayedRef.current) return; // playback confirmed — never break it
        console.log("[Direct] switch timeout — trying next");
        fallbackRef.current(nextIdx, "switch-timeout");
      }, 12000);
    },
    [videoEntries, mediaType, tmdbId, rankById, priorityOfIndex, playableTotal],
  );

  // Stable reference to fallbackToNextLink so event subscriptions and armed
  // timers don't re-run when the callback's identity changes.
  const fallbackRef = useRef(fallbackToNextLink);
  useEffect(() => {
    fallbackRef.current = fallbackToNextLink;
  }, [fallbackToNextLink]);

  // Manual source selection from the picker — same flow as automatic picks:
  // the choice must produce frames within 12s or the same priority walk
  // continues. No error card for a failed pick — the toast tells the user
  // where playback landed.
  const selectLinkManually = useCallback((idx: number) => {
    setLastError(null);
    hasPlayedRef.current = false;
    setPlaybackStarted(false);
    if (switchTimeoutRef.current) {
      clearTimeout(switchTimeoutRef.current);
      switchTimeoutRef.current = null;
    }
    probeResolvedRef.current = false;
    setSwitchInfo({ toIndex: idx, auto: false });
    setDetectedFormat(null);
    setActiveLinkIdx(idx);
    if (posPollRef.current) clearInterval(posPollRef.current);
    posPollRef.current = null;
    switchTimeoutRef.current = setTimeout(() => {
      if (hasPlayedRef.current) return; // playback confirmed — never break it
      console.log(
        "[Direct] picked source did not play in 12s — walking fallback chain",
      );
      fallbackRef.current(idx, "switch-timeout");
    }, 12000);
  }, []);

  // ── 4m. movi-player (web — one engine for every format) ──
  // The element module is code-split and registered on first use; the adapter
  // wraps the DOM element exactly like the old native adapter wrapped <video>.
  // Source switching is a `src` attribute change — the element reloads in
  // place and the adapter (and its subscriptions) survive.
  const attachMovi = useCallback((el: any) => {
    moviElRef.current = el;
    if (!el) return;
    if (moviAdapterRef.current?.element === el) return;
    moviAdapterRef.current?.destroy();
    const adapter = new MoviPlayerAdapter(el);
    moviAdapterRef.current = adapter;
    setMoviAdapter(adapter);
  }, []);

  useEffect(() => {
    if (decoder !== "movi" || moviElementReady) return;
    let cancelled = false;
    import("movi-player/element/slim")
      .then(() => {
        if (!cancelled) setMoviElementReady(true);
      })
      .catch((err: Error) => {
        console.error("[Direct] movi-player failed to load:", err);
        if (!cancelled) {
          // Engine itself unavailable (offline / chunk fetch failed) — every
          // source would hit the same wall, so this is infra, not a bad link.
          setErrorIsInfra(true);
          setError(
            "The web player failed to load — check your connection and retry.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [decoder, moviElementReady]);

  // ── 3. Format detection + decoder selection ──
  useEffect(() => {
    if (!currentEntry) {
      console.log(`[Direct] format-detect: no currentEntry`);
      return;
    }
    let cancelled = false;
    console.log(
      `[Direct] format-detect: entry="${currentEntry.name}" type="${currentEntry.type}" meta=${!!currentEntry._meta}`,
    );

    (async () => {
      let fmt: DetectedFormat;

      if (currentEntry._meta) {
        const type =
          currentEntry._meta?.codec === "hevc"
            ? "mkv"
            : (currentEntry.type as DetectedFormat["type"]);
        fmt = {
          type: type === "mkv" ? "mkv" : type === "mp4" ? "mp4" : "unknown",
          container:
            type === "mkv" ? "Matroska" : type === "mp4" ? "MP4" : "unknown",
          videoCodec: currentEntry._meta.codec === "hevc" ? "hevc" : "h264",
          audioCodec: undefined,
          confidence: "high",
        };
        console.log(
          `[Direct] format-detect: from meta → type=${fmt.type} codec=${fmt.videoCodec}`,
        );
      } else {
        try {
          fmt = await detectFormat(currentEntry.url);
          console.log(`[Direct] format-detect: from URL → type=${fmt.type}`);
        } catch (e) {
          console.warn("[Direct] Format detection failed:", e);
          fmt = { type: "unknown", container: "unknown", confidence: "low" };
        }
      }

      if (cancelled) return;
      setDetectedFormat(fmt);

      console.log(`[Direct] format-detect: calling selectDecoder...`);
      const dec = await selectDecoder(fmt, currentEntry.name);
      console.log(`[Direct] format-detect: decoder = ${dec}`);
      if (!cancelled) setDecoder(dec);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentEntry?.url, currentEntry?.name]);

  // ── 4b. mpv process lifecycle (mount / unmount only) ──
  // Singleton: the mpv process and adapter are created once, destroyed on
  // unmount. Link/source changes use `loadfile replace` — no restart.
  useEffect(() => {
    if (decoder !== "mpv") return;

    console.log("[Direct] mpv: process lifecycle — mount");
    const gen = ++mpvLifecycleGeneration;
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv) {
      console.error(
        "[Direct] mpv decoder selected but electronAPI.mpv not available",
      );
      return;
    }

    // Create adapter once
    if (!mpvAdapterRef.current) {
      const adapter = new MpvPlayerAdapter();
      mpvAdapterRef.current = adapter;
      setMpvAdapter(adapter);
    }

    // Start process (no-op if already running)
    mpv.start().catch((err: any) => {
      console.error("[Direct] mpv:start failed:", err);
    });

    return () => {
      // Fast Refresh re-runs this effect WITHOUT a navigation, and StrictMode
      // double-invokes it in dev — destroying mpv there killed playback and
      // the import.meta.hot check never detected Turbopack. Defer the destroy
      // a beat: if another mount of this effect follows, it's a hot reload —
      // keep the process (start() below is idempotent). A real unmount (SPA
      // navigation, provider switch) has no follow-up mount, so the destroy
      // fires and mpv stops playing over other pages.
      setTimeout(() => {
        if (mpvLifecycleGeneration !== gen) {
          console.log(
            "[Direct] mpv: effect re-ran after hot reload — preserving mpv process",
          );
          return;
        }
        console.log("[Direct] mpv: process lifecycle — unmount, destroying");
        mpvAdapterRef.current?.destroy();
        mpvAdapterRef.current = null;
        setMpvAdapter(null);
        // Adapter.destroy() only tears down renderer-side listeners. The mpv
        // process and its transparent video window live in the main process —
        // without this they keep playing over every page after navigation.
        mpv.destroy?.().catch(() => {});
      }, 150);
    };
  }, [decoder]);

  // ── 4c. mpv play URL (on URL or link change) ──
  // With the singleton process, switching source = one `loadfile replace` IPC
  // call. Fallback latency drops from ~1s (process restart) to ~200ms.
  // Does NOT call mpv:start — the process lifecycle effect handles that.
  // If play fails because IPC isn't connected yet, retries once after 500ms.
  useEffect(() => {
    if (decoder !== "mpv" || !currentEntry) return;
    if (error || exhausted) return;

    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function doPlay(retryCount = 0) {
      if (!currentEntry?.url) return;
      console.log(
        `[Direct] mpv: play()${retryCount > 0 ? ` (retry ${retryCount})` : ""} → ${currentEntry.url.slice(0, 80)}`,
      );
      mpv
        .play(currentEntry.url)
        .then((result: any) => {
          if (cancelled) return;
          // IPC handler returns { success: false } as a resolved promise
          // (not rejected) when mpv isn't started yet. Check explicitly.
          if (result && result.success === false) {
            handlePlayFailure(
              String(result.error || "mpv not started"),
              retryCount,
            );
            return;
          }
          console.log("[Direct] mpv: play() resolved");
          // Re-arm the switch timeout from this moment and VERIFY playback by
          // watching the position advance (a poll — mpv event delivery to the
          // renderer is unreliable for proxied streams; file-loaded /
          // playback-restart can be missed entirely). The timeout only fires
          // if the position NEVER moved in 12s.
          if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
          if (posPollRef.current) clearInterval(posPollRef.current);
          let lastPos = -1;
          posPollRef.current = setInterval(() => {
            if (hasPlayedRef.current) {
              // Playback confirmed — stop polling.
              if (posPollRef.current) clearInterval(posPollRef.current);
              posPollRef.current = null;
              return;
            }
            const pos = mpvAdapterRef.current?.getCurrentTime?.() ?? -1;
            if (pos > lastPos) {
              // Position advanced — real playback. Ground truth, no event needed.
              lastPos = pos;
              markPlaybackStartedRef.current();
            }
          }, 1500);
          switchTimeoutRef.current = setTimeout(() => {
            if (posPollRef.current) clearInterval(posPollRef.current);
            posPollRef.current = null;
            if (hasPlayedRef.current) return; // playback verified — never break it
            console.log("[Direct] switch timeout — trying next");
            fallbackRef.current(activeLinkIdx, "switch-timeout");
          }, 12000);
          // Consumer callbacks (perf logging, history writes, UI state) must
          // never be able to fail the play promise — a throw here would be
          // misread as a playback failure and churn the source-fallback chain.
          try {
            onLoadRef.current?.();
          } catch (cbErr) {
            console.error("[Direct] onLoad handler threw:", cbErr);
          }
        })
        .catch((err: any) => {
          if (cancelled) return;
          handlePlayFailure(String(err?.message || err || ""), retryCount);
        });
    }

    function handlePlayFailure(msg: string, retryCount: number) {
      // Startup transients — IPC still connecting, window not ready, clone
      // artifacts from torn-down duplicate mounts (HMR / StrictMode) — are
      // retried with backoff and must NEVER surface the error card: they are
      // not stream failures. Showing "stream failed" while mpv is still
      // booting was the main source of the app feeling unpredictable.
      const transient =
        !msg ||
        msg.includes("not connected") ||
        msg.includes("not started") ||
        msg.includes("not ready") ||
        msg.includes("could not be cloned") ||
        msg.includes("process exited") ||
        msg.includes("exited before") ||
        /DOMException/i.test(msg);
      if (transient && retryCount < 10) {
        const delay = Math.min(500 * retryCount + 500, 4000);
        console.log(
          `[Direct] mpv:play — ${msg || "transient"}, retrying in ${delay}ms`,
        );
        retryTimer = setTimeout(() => {
          if (!cancelled) doPlay(retryCount + 1);
        }, delay);
        return;
      }
      // Retry ladder exhausted — hand off to the link-fallback machine. With
      // multiple links it advances to the next source (and only shows the
      // error card when there is genuinely nothing left to try); with a
      // single link it shows the error card immediately. Transient messages
      // mean the ENGINE failed, not the stream — flagged infra so the link
      // isn't condemned and the fallback chain doesn't pointlessly hop
      // sources that would hit the same broken engine.
      console.error("[Direct] mpv:play failed:", msg || "mpv play failed");
      fallbackToNextLink(activeLinkIdx, msg || "mpv play failed", {
        infra: transient,
      });
    }

    doPlay();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (posPollRef.current) clearInterval(posPollRef.current);
      posPollRef.current = null;
    };
  }, [decoder, currentEntry?.url, activeLinkIdx, error, exhausted]);

  // ── 4f. mpv native window visibility ──
  // The OS-level video window always draws above app HTML. When an HTML
  // overlay is open (source picker, settings panel, quick audio/CC menus,
  // subtitle search, error/exhausted card), hide it so the overlay is visible
  // and interactive; restore when it closes. mpv keeps playing audio
  // underneath — same behavior as mobile's picker sheet.
  useEffect(() => {
    if (decoder !== "mpv") return;
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv?.hideVideo) return;
    if (showPicker || mpvOverlayOpen || error || exhausted || showSubSearch) {
      mpv.hideVideo();
    } else {
      mpv.showVideo();
    }
  }, [decoder, showPicker, mpvOverlayOpen, error, exhausted, showSubSearch]);

  // ── 4f-2. Source label (for the picker button in the control strip) ──
  useEffect(() => {
    if (decoder !== "mpv" || !currentEntry) return;
    setMpvSourceLabel(
      [
        currentEntry.quality,
        currentEntry._meta?.codec?.toUpperCase() || currentEntry.type,
        currentEntry._meta?.source || "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }, [decoder, currentEntry]);

  // ── 4f-3. mpv audio/subtitle tracks (for the settings panel) ──
  useEffect(() => {
    if (!mpvAdapter) return;
    const refresh = () =>
      setMpvTracks({
        audio: mpvAdapter.getAudioTracks(),
        sub: mpvAdapter.getSubtitleTracks(),
      });
    refresh();
    const off = mpvAdapter.onTracks(refresh);
    return () => {
      off();
    };
  }, [mpvAdapter]);

  // ── 4m-4. movi audio/subtitle tracks (for the ControlBar quick menus) ──
  useEffect(() => {
    if (decoder !== "movi" || !moviAdapter) return;
    const refresh = () =>
      setMoviTracks({
        audio: moviAdapter.getAudioTracks(),
        sub: moviAdapter.getSubtitleTracks(),
      });
    refresh();
    const off = moviAdapter.onTracks(refresh);
    return () => {
      off();
    };
  }, [decoder, moviAdapter]);

  // ── Playback ground truth (all decoders) ──
  // Marks the moment REAL frames render. Clears the switch timeout (a source
  // that renders has proven itself), remembers the source for next time,
  // adds it to the session's proven set (final fallback position), and fires
  // the "Now playing source N" toast.
  const markPlaybackStarted = useCallback(() => {
    if (hasPlayedRef.current) return;
    hasPlayedRef.current = true;
    setPlaybackStarted(true);
    // The source proved itself — this joins the proven set: if the user
    // abandons it later it sits at the very back of the fallback chain
    // (last working = last resort).
    provenOrderRef.current = [
      ...provenOrderRef.current.filter((i) => i !== activeLinkIdx),
      activeLinkIdx,
    ];
    if (switchTimeoutRef.current) {
      clearTimeout(switchTimeoutRef.current);
      switchTimeoutRef.current = null;
    }
    setSwitchInfo(null);
    const n = priorityOfIndex(activeLinkIdx);
    const quality = videoEntries[activeLinkIdx]?.quality;
    showToast(
      `Now playing source ${n ?? "?"} of ${playableTotal}${quality ? ` · ${quality}` : ""}`,
    );
    const url = videoEntries[activeLinkIdx]?.url;
    if (!hasPlayedOnceRef.current && url) {
      hasPlayedOnceRef.current = true;
      rememberWorkingSource(mediaType, tmdbId, url);
      console.log(
        `[Direct] source working — remembered index ${activeLinkIdx}`,
      );
    }
  }, [
    videoEntries,
    activeLinkIdx,
    mediaType,
    tmdbId,
    priorityOfIndex,
    playableTotal,
    showToast,
  ]);

  // Remember source on successful playback (state-driven trigger so effects
  // that only run on URL changes don't miss the flip)
  const markPlaybackStartedRef = useRef(markPlaybackStarted);
  useEffect(() => {
    markPlaybackStartedRef.current = markPlaybackStarted;
  }, [markPlaybackStarted]);

  // ── 4f-4. Playback ground truth for mpv (mobile parity) ──
  // mpv.play() resolving only means the command was ACCEPTED — real frames
  // arrive later. playback-restart = actual render; file-loaded = file parsed
  // and demuxer ready. Both clear the stall watchdog: if mpv loaded the file
  // the source is alive, even if playback-restart never fires (some proxied/
  // redirected streams skip it).
  useEffect(() => {
    if (decoder !== "mpv" || !mpvAdapter) return;
    const offPlaying = mpvAdapter.onPlaying(() => {
      markPlaybackStartedRef.current();
      setLinkStatuses((prev) => {
        if (prev.get(activeLinkIdx) === "valid") return prev;
        return new Map(prev).set(activeLinkIdx, "valid");
      });
    });
    const offFileLoaded = mpvAdapter.onFileLoaded(() => {
      markPlaybackStartedRef.current();
    });
    return () => {
      offPlaying();
      offFileLoaded();
    };
  }, [decoder, mpvAdapter, activeLinkIdx]);

  // ── 4m-2. Playback ground truth for movi (web) ──
  // Same contract as the mpv path: playing/canplay/loadeddata = real output.
  useEffect(() => {
    if (decoder !== "movi" || !moviAdapter) return;
    const off = moviAdapter.onPlaying(() => {
      markPlaybackStartedRef.current();
      onLoadRef.current?.();
      setLinkStatuses((prev) => {
        if (prev.get(activeLinkIdx) === "valid") return prev;
        return new Map(prev).set(activeLinkIdx, "valid");
      });
    });
    return () => {
      off();
    };
  }, [decoder, moviAdapter, activeLinkIdx]);

  // ── 4m-3. movi playback failure → ranked fallback chain ──
  // One engine for every format means an `error` event is the only failure
  // signal — and it always means THIS source failed, so walk the ranked chain
  // exactly like an mpv error.
  useEffect(() => {
    if (decoder !== "movi" || !moviAdapter) return;
    return moviAdapter.onError((msg) => {
      console.error("[Direct] movi error:", msg);
      fallbackRef.current(activeLinkIdx, msg || "playback error");
    });
  }, [decoder, moviAdapter, activeLinkIdx]);

  // ── 4f-5. Auto-pick the preferred audio track inside the file ──
  // Multi-audio MKVs default to their first track; once track metadata
  // arrives, switch to the user's preferred language (settings). A manual
  // choice in the player disables auto-pick for the session.
  const audioAutoPickedRef = useRef(false);
  useEffect(() => {
    audioAutoPickedRef.current = false;
  }, [currentEntry?.url]);
  useEffect(() => {
    if (decoder !== "mpv" || !mpvAdapter) return;
    if (preferredLanguage === "auto" || userAudioTouchedRef.current) return;
    if (mpvTracks.audio.length < 2 || audioAutoPickedRef.current) return;
    const pick = pickPreferredAudioTrack(mpvTracks.audio, preferredLanguage);
    if (pick) {
      audioAutoPickedRef.current = true;
      console.log(`[Direct] audio auto-pick: track ${pick.id} (${pick.label})`);
      mpvAdapter.setAudioTrack(pick.id);
    }
  }, [decoder, mpvAdapter, mpvTracks.audio, preferredLanguage]);

  // movi parity: pick the preferred audio track inside the file once tracks
  // arrive (multi-audio MKVs/MP4s default to their first track).
  useEffect(() => {
    if (decoder !== "movi" || !moviAdapter) return;
    if (preferredLanguage === "auto" || userAudioTouchedRef.current) return;
    if (moviTracks.audio.length < 2 || audioAutoPickedRef.current) return;
    const pick = pickPreferredAudioTrack(moviTracks.audio, preferredLanguage);
    if (pick) {
      audioAutoPickedRef.current = true;
      console.log(
        `[Direct] movi audio auto-pick: track ${pick.id} (${pick.label})`,
      );
      moviAdapter.setAudioTrack(pick.id);
    }
  }, [decoder, moviAdapter, moviTracks.audio, preferredLanguage]);

  // ── 4f-6. Next-episode prefetch (mobile parity) ──
  // Once playback is underway, warm the next episode's direct metadata so
  // "Next episode" starts with zero network time.
  const nextEpPrefetchedRef = useRef("");
  useEffect(() => {
    if (mediaType !== "tv" || !playbackStarted) return;
    const sig = `${tmdbId}:${selectedSeason}:${activeEpisode + 1}`;
    if (nextEpPrefetchedRef.current === sig) return;
    nextEpPrefetchedRef.current = sig;
    console.log(
      `[Direct] prefetching next episode metadata S${selectedSeason}E${activeEpisode + 1}`,
    );
    prefetchDirectMedia(
      "tv",
      String(tmdbId),
      selectedSeason,
      activeEpisode + 1,
    );
  }, [mediaType, playbackStarted, tmdbId, selectedSeason, activeEpisode]);

  // ── 4g. YouTube-style keyboard shortcuts (bound in the main window — the
  // overlay video window is non-focusable and can never receive keydown) ──
  useMpvDesktopShortcuts(
    decoder === "mpv" &&
      !!mpvAdapter &&
      !showPicker &&
      !mpvOverlayOpen &&
      !showSubSearch &&
      !error &&
      !exhausted,
  );

  // ── 4h. Poster gating: show poster until mpv has video output ──
  useEffect(() => {
    if (decoder !== "mpv") return;
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv?.onEvent) return;
    setMpvVideoActive(false);
    return mpv.onEvent((ev: any) => {
      const t = ev?.raw?.event ?? ev?.event;
      if (t === "file-loaded") setMpvVideoActive(true);
      if (t === "end-file") setMpvVideoActive(false);
    });
  }, [decoder]);

  // ── Rebuffer detection (never breaks playback) ──
  // THE RULE: once real frames have rendered, the app never switches sources
  // on its own — a stall is the network's problem to ride out (mpv holds up
  // to 200 MB of readahead). The old behavior force-switched after ~20s of
  // stalls and was the "app breaks the playing video" bug. Now we only
  // surface a one-time hint so a trapped user knows the Sources button exists.
  useEffect(() => {
    if (!playbackStarted) return;

    const adapter = mpvAdapter || moviAdapter;
    if (!adapter) return;

    let lastPosition = adapter.getCurrentTime();
    let stallChecks = 0;
    let hintShown = false;
    let checkInterval: ReturnType<typeof setInterval>;

    const unsubscribe =
      (adapter as any).onTime?.(() => {
        lastPosition = adapter.getCurrentTime();
      }) ?? (() => {});

    checkInterval = setInterval(() => {
      if (adapter.isPaused()) {
        stallChecks = 0;
        return;
      }
      if (adapter.getCurrentTime() === lastPosition && lastPosition > 0) {
        stallChecks++;
        // ~40s of no progress — hint once, never switch
        if (stallChecks >= 10 && !hintShown) {
          hintShown = true;
          console.log(
            "[Direct] prolonged stall — showing hint toast (never auto-switching)",
          );
          showToast(
            "Still buffering — try another source from Sources",
            "warn",
            4200,
          );
        }
      } else {
        stallChecks = Math.max(0, stallChecks - 1);
      }
    }, 4000);

    return () => {
      unsubscribe();
      clearInterval(checkInterval);
    };
  }, [decoder, playbackStarted, mpvAdapter, moviAdapter, showToast]);

  // ── 5. Render ──

  // mpv callback ref: fires exactly on mount, immune to dep-timing races.
  // MUST be before all early returns (React hooks rules — same order every render).
  // Expert: rAF sync loop — measures the video region directly (no subtraction).
  // Deduplicates via key so IPC only fires when bounds actually change.
  const attachMpvContainer = useCallback((el: HTMLDivElement | null) => {
    mpvContainerRef.current = el;

    // Cleanup: React 18 calls ref(null) on unmount, which is our teardown signal
    if (!el) {
      if (mpvCleanupRef.current) {
        mpvCleanupRef.current();
        mpvCleanupRef.current = null;
      }
      return;
    }

    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv) return;

    let destroyed = false;
    let lastKey = "";

    const measure = () => {
      if (destroyed) return;
      const r = el.getBoundingClientRect();
      // Guard against degenerate rects (detached element returns all zeros)
      if (r.width >= 2 && r.height >= 2) {
        const b = {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
        const key = `${b.x},${b.y},${b.width},${b.height}`;
        if (key !== lastKey) {
          lastKey = key;
          mpv.setVideoBounds(b);
        }
      }
    };

    // Event-driven bounds tracking. The old 60fps rAF poll forced a layout
    // read every frame for the entire playback session — continuous CPU and
    // compositor work for a rect that changes only on resize/layout changes.
    // ResizeObserver fires exactly when the video region actually changes
    // (window resize, sidebar drag, fullscreen, episode-panel toggle).
    // Parent-window MOVES need no re-measure: bounds are parent-relative.
    const ro = new ResizeObserver(() => {
      // rAF-debounce: coalesce burst notifications (e.g. drag-resize) into
      // one measurement per frame, and measure after layout settles.
      requestAnimationFrame(measure);
    });
    ro.observe(el);

    // Safety net for position-only shifts (element same size, moved by
    // layout changes elsewhere): scroll/resize fire the same measurement.
    let scrollPending = false;
    const onScrollOrResize = () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(() => {
        scrollPending = false;
        measure();
      });
    };
    window.addEventListener("scroll", onScrollOrResize, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onScrollOrResize);

    // Belt-and-braces: a low-frequency re-measure catches anything events
    // could theoretically miss (DPI change, observer quirks). 0.5Hz is
    // negligible versus the 60fps poll this replaced.
    const slowInterval = setInterval(measure, 2000);

    console.log("[Direct] mpv bounds tracking active (ResizeObserver)");
    measure();

    mpvCleanupRef.current = () => {
      destroyed = true;
      ro.disconnect();
      clearInterval(slowInterval);
      window.removeEventListener("scroll", onScrollOrResize, {
        capture: true,
      } as any);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
          <div
            className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
            style={{ animationDuration: "1.2s" }}
          />
          <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
          <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
        </div>
        <p
          className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Scanning Projection Room
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <>
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708]/90 backdrop-blur-sm z-40 gap-4 px-6">
          <div className="bg-[#16161A] rounded-2xl p-6 max-w-sm w-full flex flex-col items-center gap-3 border border-red-500/20">
            <Clapperboard
              className="text-red-400"
              size={32}
              strokeWidth={1.5}
            />
            <p className="text-base font-bold text-white text-center">
              Projection Reel Snapped
            </p>
            <p className="text-xs text-white/50 text-center leading-relaxed">
              {humanizeError(error)}
            </p>
            <button
              onClick={() => {
                if (errorIsInfra) {
                  // Engine hiccup, stream never blamed — just re-arm play on
                  // the SAME link (mpv.start is idempotent; the play effect
                  // re-runs because its deps include `error`).
                  console.log(
                    "[Direct] retry after infra failure — re-playing current link",
                  );
                  setError(null);
                  setLastError(null);
                  return;
                }
                loadingRef.current = true;
                setLoading(true);
                setError(null);
                setExhausted(false);
                setActiveLinkIdx(0);
                setFailedLinks(new Set());
                failedLinksRef.current = new Set();
                hasPlayedRef.current = false;
                setPlaybackStarted(false);
                if (switchTimeoutRef.current) {
                  clearTimeout(switchTimeoutRef.current);
                  switchTimeoutRef.current = null;
                }
                setReloadNonce((n) => n + 1);
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D4A237] text-[#070708] text-sm font-bold hover:bg-[#B88B2A] transition-colors active:scale-95"
            >
              <RefreshCw size={14} />
              Retry
            </button>
            {videoEntries.length > 1 && (
              <button
                onClick={() => setShowPicker(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/[0.05] transition-colors"
              >
                <Server size={14} />
                Choose source
              </button>
            )}
          </div>
        </div>
        <StreamPickerSheet
          open={showPicker}
          links={videoEntries}
          activeIndex={activeLinkIdx}
          linkStatuses={pickerStatuses}
          recommendedIndex={streamSelection?.bestIndex ?? 0}
          rankById={rankById}
          lastUsedIndex={lastUsedIndex ?? undefined}
          selectionReason={streamSelection?.selectionReason}
          onRetest={() => {
            setLinkStatuses(new Map());
            probeResolvedRef.current = false;
            setProbeNonce((n) => n + 1);
          }}
          onSelect={(idx) => {
            selectLinkManually(idx);
          }}
          onClose={() => setShowPicker(false)}
        />
      </>
    );
  }

  if (!currentEntry) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0E0E11] z-30 gap-3">
        <p className="text-sm text-faint">
          No direct sources for this selection — switching player…
        </p>
      </div>
    );
  }

  // Exhausted — all links failed (state set by fallbackToNextLink when no
  // candidate remains, including the mid-playback size-heuristic skip path)
  if (exhausted) {
    return (
      <>
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708]/90 backdrop-blur-sm z-40 gap-4 px-6">
          <div className="bg-[#16161A] rounded-2xl p-6 max-w-sm w-full flex flex-col items-center gap-3 border border-red-500/20">
            <Clapperboard
              className="text-red-400"
              size={32}
              strokeWidth={1.5}
            />
            <p className="text-base font-bold text-white text-center">
              All {videoEntries.length} source
              {videoEntries.length !== 1 ? "s" : ""} failed
            </p>
            <p className="text-xs text-white/50 text-center leading-relaxed">
              None of the available streams responded. The links may have
              expired — re-checking often finds fresh ones.
            </p>
            <div className="flex flex-col items-center gap-2 w-full mt-1">
              <button
                onClick={() => {
                  setExhausted(false);
                  setFailedLinks(new Set());
                  failedLinksRef.current = new Set();
                  hasPlayedRef.current = false;
                  setPlaybackStarted(false);
                  setLinkStatuses(new Map());
                  probeResolvedRef.current = false;
                  setDecoder(null);
                  setDetectedFormat(null);
                  setActiveLinkIdx(0);
                  if (switchTimeoutRef.current) {
                    clearTimeout(switchTimeoutRef.current);
                    switchTimeoutRef.current = null;
                  }
                  setReloadNonce((n) => n + 1);
                  setProbeNonce((n) => n + 1);
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D4A237] text-[#070708] text-sm font-bold hover:bg-[#B88B2A] transition-colors active:scale-95 w-full justify-center"
              >
                <RefreshCw size={14} />
                Re-check all sources
              </button>
              <button
                onClick={() => setShowPicker(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/[0.05] transition-colors w-full justify-center"
              >
                <Server size={14} />
                Choose manually
              </button>
              {onExhausted && (
                <button
                  onClick={() => onExhaustedRef.current?.()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/[0.05] transition-colors w-full justify-center"
                >
                  <ArrowRightLeft size={14} />
                  Try another server
                </button>
              )}
            </div>
          </div>
        </div>
        <StreamPickerSheet
          open={showPicker}
          links={videoEntries}
          activeIndex={activeLinkIdx}
          linkStatuses={pickerStatuses}
          recommendedIndex={streamSelection?.bestIndex ?? 0}
          rankById={rankById}
          lastUsedIndex={lastUsedIndex ?? undefined}
          selectionReason={streamSelection?.selectionReason}
          onRetest={() => {
            setLinkStatuses(new Map());
            probeResolvedRef.current = false;
            setProbeNonce((n) => n + 1);
          }}
          onSelect={(idx) => {
            setExhausted(false);
            setFailedLinks(new Set());
            failedLinksRef.current = new Set();
            selectLinkManually(idx);
          }}
          onClose={() => setShowPicker(false)}
        />
      </>
    );
  }

  // While format is being detected, show a brief sub-loading state
  if (!detectedFormat || decoder === null) {
    return (
      <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
          <div
            className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
            style={{ animationDuration: "1.2s" }}
          />
          <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
          <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
        </div>
        <p
          className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Scanning Projection Room
        </p>
      </div>
    );
  }

  // ── Decoder routing ──

  // ── mpv engine (desktop — every format) ──
  // PlayerShell renders IN THE MAIN WINDOW, strip mode: the video region (top)
  // is the rect the native video window tracks, and the control bar (bottom)
  // is regular page DOM below it — the exact slot the embed webview occupied.
  // The video window itself is a pure output surface (setIgnoreMouseEvents),
  // so every interaction — controls, gestures on the video, source picker —
  // happens in this page. Nothing floats, nothing steals input.
  if (decoder === "mpv" && mpvAdapter) {
    return (
      <div className="h-full w-full" data-mpv-player>
        <PlayerShell
          layout="strip"
          alwaysShowControls
          player={mpvAdapter}
          // useMpvDesktopShortcuts owns K/J/L/arrows/M/F for mpv — ControlBar's
          // useKeyboardShortcuts must stay off or one press fires twice.
          keyboardEnabled={false}
          // Space tap/hold + long-press boost only while no overlay is open.
          speedBoostEnabled={!showPicker && !mpvOverlayOpen && !showSubSearch}
          sourceLabel={mpvSourceLabel || undefined}
          onSourcePicker={() => setShowPicker(true)}
          audioTracks={mpvTracks.audio}
          subtitleTracks={mpvTracks.sub}
          currentAudioTrackId={mpvAdapter.getCurrentAudioTrackId() ?? undefined}
          currentSubtitleTrackId={
            mpvAdapter.getCurrentSubtitleTrackId() ?? undefined
          }
          onAudioTrackChange={(id) => {
            userAudioTouchedRef.current = true;
            mpvAdapter.setAudioTrack(id);
          }}
          onSubtitleChange={(id) => {
            userAudioTouchedRef.current = true;
            mpvAdapter.setSubtitleTrack(id);
          }}
          onSubtitlesSearch={() => setShowSubSearch(true)}
          onOverlayChange={(open) => setMpvOverlayOpen(open)}
          className="h-full"
        >
          {/* mpv output region — the native video window tracks this rect */}
          <div
            ref={attachMpvContainer}
            className="relative h-full w-full bg-black"
          />
          {/* Player toast (top-center): source confirmations and gentle hints.
             Never blocks interaction — failover happens without error cards. */}
          {playerToast && <PlayerToast toast={playerToast} />}
        </PlayerShell>
        <StreamPickerSheet
          open={showPicker}
          links={videoEntries}
          activeIndex={activeLinkIdx}
          linkStatuses={pickerStatuses}
          recommendedIndex={streamSelection?.bestIndex ?? 0}
          rankById={rankById}
          lastUsedIndex={lastUsedIndex ?? undefined}
          selectionReason={streamSelection?.selectionReason}
          onRetest={() => {
            setLinkStatuses(new Map());
            probeResolvedRef.current = false;
            setProbeNonce((n) => n + 1);
          }}
          onSelect={(idx) => {
            setFailedLinks(new Set());
            failedLinksRef.current = new Set();
            selectLinkManually(idx);
          }}
          onClose={() => setShowPicker(false)}
        />
        <SubtitleSearchSheet
          open={showSubSearch}
          tmdbId={tmdbId}
          mediaType={mediaType}
          season={mediaType === "tv" ? selectedSeason : undefined}
          episode={mediaType === "tv" ? activeEpisode : undefined}
          onClose={() => setShowSubSearch(false)}
          onPick={async (url, title) => {
            const res = await mpvAdapter.subAdd(url, title);
            if (!res || res.success === false) {
              console.error("[Direct] sub-add failed:", res?.error);
              return false;
            }
            console.log(`[Direct] external subtitle loaded: ${title || url}`);
            return true;
          }}
        />
      </div>
    );
  }

  // ── Web engine: movi-player — one path for every format ──
  // Same chrome as the desktop mpv branch: PlayerShell + ControlBar with
  // audio/CC quick menus, the source picker, the switching indicator and the
  // "Now playing source N" toast. The element module is registered lazily
  // (4m) and the element reloads in place on src changes; the adapter and
  // its subscriptions survive switches.
  if (decoder === "movi") {
    if (!moviElementReady) {
      return (
        <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
            <div
              className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
              style={{ animationDuration: "1.2s" }}
            />
            <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
            <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
          </div>
          <p
            className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Loading Player Engine
          </p>
        </div>
      );
    }

    return (
      <PlayerShell
        player={moviAdapter}
        sourceLabel={
          [
            currentEntry.quality,
            currentEntry._meta?.codec?.toUpperCase() || currentEntry.type,
            currentEntry._meta?.source || "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        switchingLabel={switchingLabel}
        onSourcePicker={() => setShowPicker(true)}
        audioTracks={moviTracks.audio}
        subtitleTracks={moviTracks.sub}
        currentAudioTrackId={moviAdapter?.getCurrentAudioTrackId() ?? undefined}
        currentSubtitleTrackId={
          moviAdapter?.getCurrentSubtitleTrackId() ?? undefined
        }
        onAudioTrackChange={(id) => {
          userAudioTouchedRef.current = true;
          moviAdapter?.setAudioTrack(id);
        }}
        onSubtitleChange={(id) => moviAdapter?.setSubtitleTrack(id ?? null)}
      >
        {/* No built-in controls (everything is driven through the adapter) and
            movi's own hotkeys are off — our shortcuts own the keyboard. The
            wasmurl asset is copied into /public by scripts/copy-movi-wasm.mjs. */}
        <movi-player
          ref={attachMovi}
          src={currentEntry.url}
          wasmurl="/movi.wasm"
          autoplay
          playsinline
          preload="auto"
          objectfit="contain"
          nohotkeys
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {/* Player toast (top-center): source confirmations and gentle hints.
            Never blocks interaction — failover happens without error cards. */}
        {playerToast && <PlayerToast toast={playerToast} />}
        <StreamPickerSheet
          open={showPicker}
          links={videoEntries}
          activeIndex={activeLinkIdx}
          linkStatuses={pickerStatuses}
          recommendedIndex={streamSelection?.bestIndex ?? 0}
          rankById={rankById}
          lastUsedIndex={lastUsedIndex ?? undefined}
          selectionReason={streamSelection?.selectionReason}
          onRetest={() => {
            setLinkStatuses(new Map());
            probeResolvedRef.current = false;
            setProbeNonce((n) => n + 1);
          }}
          onSelect={(idx) => {
            selectLinkManually(idx);
          }}
          onClose={() => setShowPicker(false)}
        />
      </PlayerShell>
    );
  }

  // Unreachable with the current selector (mpv | movi) — kept so any future
  // decoder value degrades to a loading state, never to a blank box.
  return (
    <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
        <div
          className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
          style={{ animationDuration: "1.2s" }}
        />
        <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
        <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
      </div>
      <p
        className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Scanning Projection Room
      </p>
    </div>
  );
}
