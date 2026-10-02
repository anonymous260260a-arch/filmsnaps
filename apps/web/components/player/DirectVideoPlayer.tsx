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
 * The two engines deliberately do NOT share chrome:
 *   - Desktop (mpv)   → PlayerShell/ControlBar + StreamPickerSheet, driven by
 *                       an adapter (mpv is a black box — nothing renders for us).
 *   - Web   (movi)    → movi-player's OWN control bar (`controls`): seek bar,
 *                       audio/CC menus, settings, context menu, hotkeys, PiP.
 *                       The app only injects what movi cannot know about — a
 *                       quality chip (addControl, label = current quality)
 *                       opening the direct-link picker — plus the toasts,
 *                       keyboard shortcuts (Space/K, ←/→ ±5s), and takes over
 *                       fullscreen so those React overlays stay visible.
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
import { useSourcePublisher } from "./SourceContext";
import { MobilePlayerOverlay } from "./MobilePlayerOverlay";
import { useIsMobilePlayer } from "./useIsMobilePlayer";
import { enableMoviLogs, isQoeEnabled, startMoviQoeProbe } from "@/lib/moviLog";
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
  isBrowserNativeCodec,
  linkNeedsSoftwareDecode,
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
  /**
   * Registry direct-provider id this player instance serves ("direct" =
   * the legacy HDHub+Falix pipeline; e.g. "spacedom" for tiered providers).
   * Forwarded to /api/player/direct as the `provider` param.
   */
  providerId?: string;
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
 * of 5 · 1080p") or a gentle hint (prolonged stall). `className` nudges it out
 * of the way of chrome that already owns the top band (movi's title bar).
 */
function PlayerToast({
  toast,
  className = "top-4",
}: {
  toast: { text: string; tone: "gold" | "warn" };
  className?: string;
}) {
  return (
    <div
      className={`absolute ${className} left-1/2 -translate-x-1/2 z-30 pointer-events-none`}
    >
      <div
        className={`flex items-center gap-2 rounded-full px-4 py-1.5 border shadow-lg backdrop-blur-md animate-[fadeIn_0.15s_ease-out] ${
          toast.tone === "gold"
            ? "bg-black/70 border-[#D4A237]/45 text-[#E8C46A]"
            : "bg-black/70 border-amber-400/45 text-amber-300"
        }`}
      >
        {toast.tone === "gold" ? (
          <CircleCheck size={13} className="shrink-0" />
        ) : (
          <TriangleAlert size={13} className="shrink-0" />
        )}
        <span className="text-xs font-semibold whitespace-nowrap tracking-[0.02em]">
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
  providerId,
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
  // True only while <movi-player> is actually in the DOM. The built-in-chrome
  // wiring (Sources control + fullscreen handoff) keys off this, because an
  // error card unmounts the element and a retry mounts it again with no other
  // dep change to re-trigger an effect.
  const [moviElAttached, setMoviElAttached] = useState(false);
  // The same element as state — the mobile overlay listens to its `statechange`
  // event and writes `objectFit` (screen fit), so it needs the node itself and
  // must re-run if an error card tears the element down and a retry rebuilds it.
  const [moviEl, setMoviEl] = useState<HTMLElement | null>(null);
  // Touch / small-screen chrome. Above 768px with a real pointer nothing here
  // changes: movi keeps its own control bar and the overlay never renders.
  const isMobileUi = useIsMobilePlayer();
  // The element's parent in the web branch — the fullscreen target. Fullscreen
  // goes here rather than on <movi-player> so the source picker and toasts
  // (siblings of the element) stay inside the fullscreen subtree.
  const moviHostRef = useRef<HTMLDivElement>(null);
  // Audio/subtitle tracks mirrored off the element — drives the preferred-
  // language auto-pick below (movi's own bar owns the track menus).
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
    if (providerId && providerId !== "direct") {
      params.set("provider", providerId);
    }
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
    // Hover-prefetch results are keyed without the provider — only reuse
    // them for the legacy "direct" pipeline.
    const prefetched =
      providerId && providerId !== "direct"
        ? undefined
        : (getPrefetchedDirectMedia(
            mediaType === "tv" ? "tv" : "movie",
            String(tmdbId),
            mediaType === "tv" ? selectedSeason : undefined,
            mediaType === "tv" ? activeEpisode : undefined,
          ) as Promise<DirectApiData> | undefined);

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
  }, [
    tmdbId,
    mediaType,
    providerId,
    selectedSeason,
    activeEpisode,
    reloadNonce,
  ]);

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
  // Software-decode links (HEVC/AV1/AVI — FFmpeg-WASM decode, stutter-prone on
  // most web setups) are stably demoted behind every hardware link while their
  // relative order inside each group is preserved. Every consumer of this map
  // (initial pick, fallback walk, "source N" numbering, picker rows) then
  // agrees hardware sources lead. Web-only: this component never ships mobile.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    if (streamSelection) {
      const links = streamSelection.sortedLinks;
      const hardware = links.filter((l) => !linkNeedsSoftwareDecode(l));
      const software = links.filter((l) => linkNeedsSoftwareDecode(l));
      [...hardware, ...software].forEach((l, rank) => m.set(l.id, rank));
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

    // Use smart selection (skipping download-only links) — unless the
    // selector's champion needs software decode AND a hardware-decodable
    // link exists; the demoted rank order then hands back the best hardware
    // candidate instead (purely a decode-capability swap, same ranks).
    const selectorPick = streamSelection.bestIndex;
    const hardwareExists = videoEntries.some(
      (e, i) => playable(i) && !linkNeedsSoftwareDecode(e),
    );
    const selectorPickUsable =
      playable(selectorPick) &&
      !(
        hardwareExists &&
        videoEntries[selectorPick] &&
        linkNeedsSoftwareDecode(videoEntries[selectorPick])
      );
    const best = selectorPickUsable ? selectorPick : firstPlayableByRank();
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

  // [debug] full URL of whatever the player is about to load — fires on every
  // source switch/failover (movi-player src + mpv path both flow through here).
  useEffect(() => {
    if (!currentEntry?.url) return;
    console.log(
      `[Direct] playing → ${currentEntry.url} (idx=${activeLinkIdx}, q=${currentEntry.quality ?? "?"})`,
    );
  }, [currentEntry?.url, activeLinkIdx, currentEntry?.quality]);

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

  // ── Publish the source list to SourceContext ──
  // PlayerHub's Sources tab (below the player, <1280px) reads this instead of
  // reaching into private player state. `null` while an embed provider is
  // selected or the API hasn't returned anything playable — the tab hides.
  const retestSources = useCallback(() => {
    setLinkStatuses(new Map());
    probeResolvedRef.current = false;
    setProbeNonce((n) => n + 1);
  }, []);

  const sourceState = useMemo(
    () => ({
      links: videoEntries,
      activeIndex: activeLinkIdx,
      recommendedIndex: streamSelection?.bestIndex,
      lastUsedIndex,
      statuses: pickerStatuses,
      rankById,
      selectionReason: streamSelection?.selectionReason,
      select: selectLinkManually,
      retest: retestSources,
    }),
    [
      videoEntries,
      activeLinkIdx,
      streamSelection?.bestIndex,
      streamSelection?.selectionReason,
      lastUsedIndex,
      pickerStatuses,
      rankById,
      selectLinkManually,
      retestSources,
    ],
  );

  const publishSource = useSourcePublisher();

  useEffect(() => {
    publishSource(videoEntries.length > 0 ? sourceState : null);
  }, [publishSource, sourceState, videoEntries.length]);

  // Unmount (provider switch away from a direct source) must retract the
  // list, otherwise a stale pane survives the swap to an embed player.
  useEffect(() => () => publishSource(null), [publishSource]);

  // ── 4m. movi-player (web — one engine for every format) ──
  // The element module is code-split and registered on first use; the adapter
  // wraps the DOM element exactly like the old native adapter wrapped <video>.
  // Source switching is a `src` attribute change — the element reloads in
  // place and the adapter (and its subscriptions) survive.
  const attachMovi = useCallback((el: any) => {
    moviElRef.current = el;
    setMoviElAttached(!!el);
    setMoviEl((el ?? null) as HTMLElement | null);
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
    // The bundled entry points log through `globalThis.__movilog`, which
    // nothing in the package assigns — the sink has to be installed before
    // the chunk evaluates, or every `Configured: … hwAccel=…` line is lost.
    enableMoviLogs();
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

  // ── 4m-5. Built-in chrome wiring (web): the quality chip + fullscreen ──
  // movi's own control bar owns every playback affordance now. Two things it
  // cannot know about are hooked in here: our direct-link list, and a
  // fullscreen that keeps our React overlays (picker, toasts) reachable.
  useEffect(() => {
    if (decoder !== "movi" || !moviElementReady || !moviElAttached) return;
    const el = moviElRef.current as any;
    const host = moviHostRef.current;
    if (!el?.isConnected || !host) return;

    // The player's keys (F / M / ← / → / ?) and the page's must never both
    // run on one press — same contract as __fsMpvKeysActive on desktop.
    (window as any).__fsMoviKeysActive = true;

    // Quality chip in the bar's right-hand capsule (before quality/settings).
    // No `group` — grouping it with settings buried it; no `icon` either, so
    // the label renders as visible TEXT like mobile's pill: the CURRENT
    // quality ("720p"), never the word "Sources".
    const initialLabel =
      currentEntry?.quality || currentEntry?.type?.toUpperCase() || "Quality";
    try {
      el.addControl?.({
        id: "direct-sources",
        label: initialLabel,
        title: "Choose a different source",
        side: "right",
        before: ["quality", "settings"],
        onSelect: () => setShowPicker(true),
      });
    } catch (err) {
      console.warn("[Direct] could not add the source control:", err);
    }

    // Shadow-DOM styling pass. Two fixes, both scoped to OUR elements:
    // 1. The quality chip: movi sizes every .movi-btn as a fixed SQUARE icon
    //    box (--movi-btn-size) with 2px text padding — "720p" crammed into it
    //    reads as an afterthought. Re-shape just our control into an
    //    auto-width pill: gold-tinted, outlined, matched to the capsule.
    // 2. The unmute pill: mobile web blocks autoplay-with-sound, so movi
    //    auto-mutes and shows its dark unmute pill top-left (z-index 8) —
    //    but MobilePlayerOverlay's gesture surface (z-10, a SIBLING above
    //    the host) swallows every tap on it, so it never dismissed. Raise it
    //    above our chrome; our bars live top-right/center, the corner is clear.
    // Removed with the control in cleanup.
    try {
      const root = el.shadowRoot as ShadowRoot | null;
      if (root && !root.querySelector("style[data-fs-quality-chip]")) {
        const chipStyle = document.createElement("style");
        chipStyle.setAttribute("data-fs-quality-chip", "");
        chipStyle.textContent = `
          .movi-controls-right .movi-custom-btn[data-custom-control="direct-sources"] {
            width: auto;
            min-width: var(--movi-btn-size);
            height: var(--movi-btn-size);
            box-sizing: border-box;
            padding: 0 12px;
            border-radius: 999px;
            background: rgba(212, 162, 55, 0.12);
            border: 1px solid rgba(212, 162, 55, 0.40);
            color: #E8B861;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.02em;
            justify-content: center;
          }
          .movi-controls-right .movi-custom-btn[data-custom-control="direct-sources"]:hover,
          .movi-controls-right .movi-custom-btn[data-custom-control="direct-sources"]:focus,
          .movi-controls-right .movi-custom-btn[data-custom-control="direct-sources"]:active {
            background: rgba(212, 162, 55, 0.20);
          }
          .movi-controls-right .movi-custom-btn[data-custom-control="direct-sources"] .movi-custom-btn-text {
            padding: 0;
            font-size: 12px;
            font-weight: 700;
          }
          /* Scoped to the controls-less mobile host — on desktop the pill
             must keep sitting under movi's own title bar. */
          :host(.movi-no-controls) .movi-unmute-overlay {
            z-index: 40 !important;
          }
        `;
        root.appendChild(chipStyle);
      }
    } catch (err) {
      console.warn("[Direct] could not style the source chip:", err);
    }

    // Fullscreen the WRAPPER, not the element. The picker and toasts are
    // siblings of <movi-player>, so element-fullscreen would strand them
    // outside the fullscreen subtree; setHostFullscreen() is the element's
    // documented hook for exactly this, and keeps its bar acting fullscreen.
    const onFullscreenRequest = (evt: Event) => {
      // `active` is the CURRENT state: false = asking to enter, true = exit.
      const leaving = !!(evt as CustomEvent<{ active?: boolean }>).detail
        ?.active;
      // No usable Fullscreen API (iOS Safari only fullscreens <video>) — let
      // the element keep its own pseudo-fullscreen fallback instead of
      // swallowing the request and leaving the button dead.
      if (
        typeof host.requestFullscreen !== "function" ||
        !document.fullscreenEnabled
      )
        return;
      evt.preventDefault();
      if (leaving) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        el.setHostFullscreen?.(false);
      } else if (document.fullscreenElement !== host) {
        host
          .requestFullscreen()
          .then(() => el.setHostFullscreen?.(true))
          .catch(() => {});
      }
    };
    // Escape or the browser's own exit leaves the wrapper — mirror it back so
    // the element's fullscreen icon and context menu don't lie about state.
    const onFullscreenChange = () => {
      el.setHostFullscreen?.(document.fullscreenElement === host);
    };

    el.addEventListener("movi-fullscreen-request", onFullscreenRequest);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      el.removeEventListener("movi-fullscreen-request", onFullscreenRequest);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      try {
        el.removeControl?.("direct-sources");
      } catch {}
      try {
        el.shadowRoot?.querySelector("style[data-fs-quality-chip]")?.remove();
      } catch {}
      (window as any).__fsMoviKeysActive = false;
    };
  }, [decoder, moviElementReady, moviElAttached]);

  // The chip's label tracks the PLAYING source — addControl only runs on
  // decoder/attach changes, so a source switch patches the label in place
  // (updateControl tears the button down and re-renders it with the text).
  const sourcesBtnLabel =
    currentEntry?.quality || currentEntry?.type?.toUpperCase() || "Quality";
  useEffect(() => {
    if (decoder !== "movi" || !moviElAttached) return;
    const el = moviElRef.current as any;
    if (!el?.isConnected) return;
    try {
      el.updateControl?.("direct-sources", { label: sourcesBtnLabel });
    } catch {}
  }, [decoder, moviElAttached, sourcesBtnLabel]);

  // ── 4m-5b. Keyboard shortcuts (web/movi): Space/K play-pause, ←/→ ±5s ──
  // movi's own hotkeys only fire while the element holds focus (click the
  // player once and they work) — and its arrow seek is ±10s. The element is
  // mounted with fastseek="buttons" on desktop, which switches movi's ARROW
  // handling off (its keydown case early-breaks WITHOUT preventDefault), so
  // these window-level bindings are the single owner of arrow seeks at ±5s
  // whether or not the player is focused. Space/K: movi handles them while
  // focused (preventDefault → defaultPrevented → we skip); this handler
  // covers the unfocused case. Page-level shortcuts already defer arrows via
  // __fsMoviKeysActive (set in 4m-5 above).
  useEffect(() => {
    if (
      decoder !== "movi" ||
      isMobileUi ||
      error ||
      exhausted ||
      showPicker ||
      showSubSearch
    )
      return;
    const SEEK_STEP = 5;
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented) return; // movi (or a dialog) already acted
      const real = e.composedPath()[0];
      if (
        real instanceof HTMLElement &&
        (real.tagName === "INPUT" ||
          real.tagName === "TEXTAREA" ||
          real.isContentEditable)
      )
        return;
      const adapter = moviAdapterRef.current;
      if (!adapter) return;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          if (e.repeat) return;
          e.preventDefault();
          if (adapter.isPaused()) adapter.play();
          else adapter.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          adapter.seek(Math.max(0, adapter.getCurrentTime() - SEEK_STEP));
          break;
        case "ArrowRight": {
          e.preventDefault();
          const dur = adapter.getDuration();
          const next = adapter.getCurrentTime() + SEEK_STEP;
          adapter.seek(dur > 0 ? Math.min(dur, next) : next);
          break;
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [decoder, isMobileUi, error, exhausted, showPicker, showSubSearch]);

  // ── 4m-6. QoE probe: is playback choppy because the decoder can't keep up,
  // or because the main thread is busy? Samples once a second while frames are
  // actually flowing and prints one `[QoE]` line (see lib/moviLog.ts for how to
  // read it). Dev-only unless `?movilog` is set — no cost in production.
  useEffect(() => {
    if (!isQoeEnabled()) return;
    if (decoder !== "movi" || !playbackStarted || !moviEl) return;
    console.info(
      "[QoE] probe armed",
      decoder,
      `attached=${moviEl.isConnected}`,
      `hasPlayer=${!!(moviEl as any).player}`,
    );
    return startMoviQoeProbe(moviEl);
  }, [decoder, playbackStarted, moviEl]);

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
        // `_meta` links carry their container in `type` ("hls", "mp4", "mkv",
        // …) or as a MIME string ("application/x-mpegurl"). Pass known
        // containers through instead of collapsing everything except mkv/mp4
        // to "unknown" — "hls" must stay "hls" or the hlsjs (hardware MSE)
        // engine branch never fires for adapters that attach _meta (bing,
        // spacedom, way2movies…), and those links fell back to wasm-first.
        const codecIsHevc = currentEntry._meta.codec === "hevc";
        const raw = (currentEntry.type ?? "").toLowerCase();
        const MIME_TYPES: Record<string, DetectedFormat["type"]> = {
          "application/x-mpegurl": "hls",
          "application/dash+xml": "dash",
          "video/mp4": "mp4",
          "video/quicktime": "mp4",
          "video/webm": "webm",
          "video/x-matroska": "mkv",
          "video/x-msvideo": "avi",
        };
        const KNOWN: DetectedFormat["type"][] = [
          "mkv",
          "mp4",
          "webm",
          "hls",
          "dash",
          "avi",
          "mpegts",
        ];
        const type: DetectedFormat["type"] = codecIsHevc
          ? "mkv"
          : (MIME_TYPES[raw] ??
            (KNOWN.includes(raw as DetectedFormat["type"])
              ? (raw as DetectedFormat["type"])
              : "unknown"));
        const CONTAINERS: Record<string, string> = {
          mkv: "Matroska",
          mp4: "MP4",
          webm: "WebM",
          hls: "HLS",
          dash: "DASH",
          avi: "AVI",
          mpegts: "MPEG-TS",
        };
        fmt = {
          type,
          container: CONTAINERS[type] ?? "unknown",
          videoCodec: codecIsHevc ? "hevc" : "h264",
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

  // ── 4m-4. movi audio/subtitle tracks (preferred-language auto-pick) ──
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
    const entry = videoEntries[activeLinkIdx];
    const quality = entry?.quality;
    // Non-blocking software-decode prompt: the ranker already demoted this
    // source to the back, but a deliberate pick (or a chain with no hardware
    // links left) can still land on it — say so instead of stuttering silently.
    const swDecode = entry ? linkNeedsSoftwareDecode(entry) : false;
    showToast(
      `Now playing source ${n ?? "?"} of ${playableTotal}${quality ? ` · ${quality}` : ""}` +
        (swDecode ? " — software decode, may stutter" : ""),
      swDecode ? "warn" : "gold",
      swDecode ? 6000 : undefined,
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
  // surface a one-time hint so a trapped user knows another source exists.
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
          showToast("Still buffering — try a different source", "warn", 4200);
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
            {videoEntries.length > 0 && (
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
  // On pointer/desktop sizes the element renders its OWN control bar
  // (`controls`): seek/scrub, volume, speed, audio + subtitle menus, settings,
  // context menu, hotkeys, PiP, fullscreen. We add only what it cannot know —
  // the direct-link "Sources" button (4m-5) — and keep the toasts and the
  // picker sheet as siblings so they ride along with the host fullscreen.
  //
  // On touch/small screens (isMobileUi) that bar is switched OFF and
  // MobilePlayerOverlay takes over every affordance, mirroring the mobile
  // app's HEVC chrome. Turning `controls` off also flips the host into
  // `movi-no-controls`, which hides movi's own loading spinner and kills its
  // pointer events — so the overlay supplies both.
  //
  // The element module is registered lazily (4m) and reloads in place on src
  // changes; the adapter and its subscriptions survive switches.
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

    const sourceLabel =
      [
        currentEntry.quality,
        currentEntry._meta?.codec?.toUpperCase() || currentEntry.type,
        currentEntry._meta?.source || "",
      ]
        .filter(Boolean)
        .join(" · ") || undefined;
    // One toast slot: a live "Trying source N" pill while a switch is in
    // flight, replaced by the "Now playing source N" confirmation once frames
    // land (which also clears switchInfo).
    const toast =
      playerToast ??
      (switchingLabel ? { text: switchingLabel, tone: "warn" as const } : null);

    // Engine order per source (see the <movi-player> comment block below):
    // browser-native codecs play through movi's wrapped <video>, adaptive
    // manifests (HLS/DASH) lead with their dedicated hls.js / dash.js engine
    // (transmux → MSE → hardware decode), everything else leads with the
    // WASM/WebCodecs engine. Confidence "low" means detection fell back to
    // sniffing/extension guesswork — leave movi's own escalation alone rather
    // than pinning an engine on a guess.
    const adaptiveEngine: "hlsjs" | "dashjs" | null =
      detectedFormat != null && detectedFormat.confidence !== "low"
        ? detectedFormat.type === "hls"
          ? "hlsjs"
          : detectedFormat.type === "dash"
            ? "dashjs"
            : null
        : null;
    const nativeEngineFirst =
      adaptiveEngine == null &&
      detectedFormat != null &&
      isBrowserNativeCodec(detectedFormat) &&
      detectedFormat.confidence !== "low";
    const nativeEngineLast =
      adaptiveEngine == null &&
      !nativeEngineFirst &&
      detectedFormat != null &&
      detectedFormat.confidence !== "low";

    return (
      <div ref={moviHostRef} className="absolute inset-0 select-none bg-black">
        {/* Built-in UI on desktop. On touch/small screens `controls` is false,
            so the bar never mounts and the host drops into `movi-no-controls`;
            MobilePlayerOverlay below is the chrome instead. The wasmurl asset
            is copied into /public by scripts/copy-movi-wasm.mjs; themecolor
            carries the app gold into movi's own accent.

            Perf wiring:
            • engine — browser-native codecs (plain H.264 MP4 / WebM) lead with
              the wrapped native <video> so decode+present run in the browser's
              media stack with zero WASM/JS frame pumping. HLS (.m3u8) leads
              with hls.js and DASH (.mpd) with dash.js: they transmux into MSE
              and the browser's hardware decoder handles H.264/AAC — wasm-first
              software-decoded every HLS source and lagged at 720p. `native`
              covers Safari's built-in HLS; `wasm` stays the last resort (e.g.
              HEVC-in-HLS if hls.js can't handle it, via movi's engine
              escalation). Unknown formats (byte-sniff failed) keep the engine
              list unset so movi's own escalation is untouched.
            • bindav="false" — on a slow/dead link movi's default pauses the
              clock with the audio and freezes the PICTURE for up to the full
              rebuffer (~15s of stillness on the longest stalls). Unbound, the
              picture keeps playing into the buffer and audio suspends for the
              gap only — playback feels continuous instead of hard-stalling.
            • buffersize="200" — 200MB prefetch window (the element default is
              100MB) rides out long CDN throughput dips without rebuffering.
            • --movi-* vars — theme the shadow-DOM control bar from outside:
              gold replaces the stock cyan accent everywhere, the bar/scrim
              gradients match the app's #070708 black, and the bar tightens
              from 72px to 64px (buttons 44→40) so it reads as our chrome,
              not stock movi. themecolor still carries the primary (progress
              fill, active states); accent/secondary colours had no host
              wiring before this (accent stayed default cyan).
          */}
        <movi-player
          ref={attachMovi}
          src={currentEntry.url}
          wasmurl="/movi.wasm"
          {...(adaptiveEngine
            ? { engine: `${adaptiveEngine} native wasm` }
            : nativeEngineFirst
              ? { engine: "native wasm" }
              : nativeEngineLast
                ? { engine: "wasm native" }
                : null)}
          bindav="false"
          buffersize="200"
          // Desktop: keep movi's on-bar seek buttons but switch its ARROW
          // hotkeys off (default is all-on with ±10s seeks) — the window-level
          // handler in 4m-5b owns ← / → at ±5s so the step never depends on
          // whether the player has focus. Omitted on mobile-UI (default keeps
          // touch double-tap seeking; nohotkeys already blocks its keys).
          {...(!isMobileUi ? { fastseek: "buttons" } : null)}
          controls={!isMobileUi}
          autoplay
          playsinline
          preload="auto"
          objectfit="contain"
          theme="dark"
          themecolor="#D4A237"
          showtitle={!isMobileUi}
          title={sourceLabel}
          nohotkeys={isMobileUi}
          style={
            {
              width: "100%",
              height: "100%",
              display: "block",
              // Brand theming — inherits into the open shadow root.
              "--movi-accent": "#E8B861",
              "--movi-accent-light": "#F2CE86",
              "--movi-bar-bg":
                "linear-gradient(to top, rgba(7,7,8,0.94) 0%, rgba(7,7,8,0.55) 45%, transparent 100%)",
              "--movi-overlay-bg":
                "linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 14%)",
              "--movi-chrome-bg": "rgba(7,7,8,0.92)",
              "--movi-glass-bg": "rgba(14,14,16,0.96)",
              "--movi-controls-group-bg": "rgba(255,255,255,0.07)",
              "--movi-controls-height": "64px",
              "--movi-btn-size": "40px",
              "--movi-progress-height-hover": "7px",
              "--movi-shadow-glow": "0 0 14px rgba(212,162,55,0.45)",
              "--movi-radius-surface": "12px",
              "--movi-radius-panel": "12px",
            } as React.CSSProperties
          }
        />
        {/* Mobile chrome — a sibling AFTER the element so it paints above.
            Gated on the element actually being attached: an error card tears
            the whole subtree down, and remounting must not resurrect a stale
            overlay. */}
        {isMobileUi && moviAdapter && moviElAttached && (
          <MobilePlayerOverlay
            player={moviAdapter}
            element={moviEl}
            hostRef={moviHostRef}
            sourceLabel={sourceLabel}
            audioTracks={moviTracks.audio}
            subtitleTracks={moviTracks.sub}
            currentAudioTrackId={
              moviTracks.audio.find((t: { active?: boolean }) => t.active)
                ?.id ?? null
            }
            currentSubtitleTrackId={
              moviTracks.sub.find((t: { active?: boolean }) => t.active)?.id ??
              null
            }
            onAudioTrackChange={(id) => moviAdapter.setAudioTrack(id)}
            onSubtitleChange={(id) => moviAdapter.setSubtitleTrack(id)}
            onSourcePicker={() => setShowPicker(true)}
            switchingLabel={switchingLabel}
            isStreamLoading={!playbackStarted}
          />
        )}
        {/* Player toast (top-center): source confirmations, switching and
            gentle hints. Never blocks interaction — failover happens without
            error cards. `top-16` clears movi's title bar (desktop); on mobile
            `top-20` clears the overlay's top bar and its safe-area inset. */}
        {toast && (
          <PlayerToast
            toast={toast}
            className={isMobileUi ? "top-20" : "top-16"}
          />
        )}
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
      </div>
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
