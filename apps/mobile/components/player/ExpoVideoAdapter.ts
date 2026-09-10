/**
 * ExpoVideoAdapter — wraps expo-video VideoPlayer into PlayerAdapter interface.
 *
 * Distinguishes user pause intent from transient seek/buffering states,
 * guarantees automatic playback resumption after seeks, and provides
 * robust multi-format duration reporting.
 */

import type { VideoPlayer } from "expo-video";
import { requireNativeModule } from "expo-modules-core";
import { getPlayerTuning } from "../../lib/playerConfig";
import type { PlayerAdapter, AudioTrackInfo, SubtitleTrackInfo } from "./types";

/** Native expo-video module — hosts probeStream + setSubtitleOffset (patch). */
const ExpoVideoNativeModule = requireNativeModule("ExpoVideo") as {
  setSubtitleOffset?: (ms: number) => void;
  probeStream?: (
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ) => Promise<Record<string, any>>;
};
// Sidecar-subtitle functions live on the player SharedObject (patch adds them
// inside Class("VideoPlayer")), so they're called on the player instance.
const playerWithSidecarApi = (player: VideoPlayer) =>
  player as VideoPlayer & {
    addSidecarSubtitle?: (
      uri: string,
      mimeType: string,
      language: string | null,
      label: string | null,
    ) => Promise<string | null>;
    clearSidecarSubtitles?: () => void;
  };

export class ExpoVideoAdapter implements PlayerAdapter {
  private _userPaused = false;
  private _isMuted = false;
  private _volume = 1;
  private _rate = 1;
  private _isSeeking = false;
  private _targetSeekTime = 0;
  private _seekGeneration = 0;
  private _seekSafetyTimer: ReturnType<typeof setTimeout> | null = null;

  private timeListeners: ((time: number, duration: number) => void)[] = [];
  private playPauseListeners: ((isPaused: boolean) => void)[] = [];
  private bufferingListeners: ((isBuffering: boolean) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  /** Timestamp of the last non-"off" subtitle selection — used to attribute errors. */
  private subtitleEnabledAt = 0;
  private endedListeners: (() => void)[] = [];
  /** True once the natural end of media was reported for the current source. */
  private endedEmitted = false;
  private currentError: string | null = null;
  private subs: { remove(): void }[] = [];
  private errorCheckTimer: ReturnType<typeof setInterval> | null = null;
  private metadataLoaded = false;
  private lastProgressTime = Date.now();
  /** Timestamp of when the player first looked stuck (0 = not stuck). */
  private stuckSince = 0;
  private isProbeValidated = false;
  private estimatedSizeBytes: number | undefined = undefined;
  private destroyed = false;
  /** Set while the app is backgrounded — playback must stay stopped (see setAppBackgrounded). */
  private _appBackgrounded = false;
  /**
   * Helper to determine if a reported currentTime represents a true seek landing
   * vs transient pre-seek residue (e.g. 0s, 0.14s, 0.17s while buffering).
   */
  private isSeekResolved(time: number): boolean {
    if (!this._isSeeking) return true;
    const target = this._targetSeekTime;
    if (target <= 10) {
      return time >= 0 && time <= 20;
    }
    // When seeking forward/deep (target > 10):
    // Reject transient pre-seek timestamps near 0 (e.g. 0.14s, 0.17s)
    const diff = Math.abs(time - target);
    return time > 2.0 && (diff <= 60 || time >= target - 30);
  }

  constructor(private player: VideoPlayer) {
    // Initial user intent is to play
    this._userPaused = !player.playing;

    // 1. Time updates
    this.subs.push(
      player.addListener("timeUpdate", (update) => {
        if (this.destroyed) return;
        // No frames exist before the source is actually open — suppress
        // pre-ready positions (e.g. the preset resume point while still
        // loading) so a dead source can never look like one that plays.
        if (this.player.status !== "readyToPlay") return;
        const time = Number.isFinite(update.currentTime)
          ? Math.max(0, update.currentTime)
          : 0;
        const dur = this.getDuration();

        if (this._isSeeking) {
          // A real timeUpdate arriving while playing (readyToPlay + playing)
          // means the seek has resolved only if it satisfies isSeekResolved(time).
          // Suppresses transient 0s, 0.14s, 0.17s pre-seek residue while buffering.
          if (
            this.player.status === "readyToPlay" &&
            this.player.playing &&
            this.isSeekResolved(time)
          ) {
            this._isSeeking = false;
          } else {
            return; // still resolving — suppress transient/stale values
          }
        }

        if (this.maybeEmitEnded()) return;
        this.timeListeners.forEach((l) => l(time, dur));
      }),
    );

    // 2. Native playing state changes
    this.subs.push(
      player.addListener("playingChange", (update) => {
        if (this.destroyed) return;
        console.log(
          `[FS-BG] playingChange isPlaying=${update.isPlaying} userPaused=${this._userPaused} status=${this.player.status}`,
        );
        // While backgrounded, native playing transitions are leftovers from
        // play() calls issued before the background pause took effect — squash
        // them. Without this, the isPlaying=true branch below clears
        // _userPaused and the stall-retry resurrects playback while the user
        // is away (JS event callbacks keep running in the background; JS
        // timers do not).
        if (this._appBackgrounded) {
          if (update.isPlaying) {
            this.pause();
          }
          return;
        }
        if (update.isPlaying) {
          this.bufferingListeners.forEach((l) => l(false));
          this._userPaused = false;
          this.playPauseListeners.forEach((l) => l(false));
        } else {
          if (this._userPaused) {
            this.playPauseListeners.forEach((l) => l(true));
          } else if (this.maybeEmitEnded()) {
            // Natural end — do NOT flag buffering and do NOT retry play().
          } else {
            this.bufferingListeners.forEach((l) => l(true));
            this.resumePlay("playingChange-stall-retry");
          }
        }
      }),
    );

    // 3. Status changes (loading, readyToPlay, erroring, etc.)
    this.subs.push(
      player.addListener("statusChange", (status) => {
        if (this.destroyed) return;

        const isBuffering = status.status === "loading";
        this.bufferingListeners.forEach((l) => l(isBuffering));

        // Re-announce position/duration once the source is actually open
        // (e.g. ready again after a rebuffer). Never while loading — there
        // currentTime is just the pending resume point, which used to make
        // dead sources look like they were playing (false "worked" marks,
        // healed probe verdicts, hidden spinner).
        if (
          status.status === "readyToPlay" &&
          !this._isSeeking &&
          Number.isFinite(this.player.currentTime) &&
          this.player.currentTime > 0
        ) {
          const time = this.player.currentTime;
          const dur = this.getDuration();
          this.timeListeners.forEach((l) => l(time, dur));
        }

        console.log(`[ExpoVideoAdapter] statusChange: ${status.status}`);

        // Track if metadata is available (duration > 0 means metadata parsed)
        if (Number.isFinite(this.player.duration) && this.player.duration > 0) {
          this.metadataLoaded = true;
        }

        // Track progress (currentTime > 0 means frames are decoding)
        if (
          Number.isFinite(this.player.currentTime) &&
          this.player.currentTime > 0
        ) {
          this.lastProgressTime = Date.now();
        }

        // Emit time/duration when stream is ready
        if (status.status === "readyToPlay") {
          this.metadataLoaded = true;
          this.stuckSince = 0;
          this.currentError = null;
          this.lastProgressTime = Date.now();

          const dur = this.getDuration();
          const time = Number.isFinite(this.player.currentTime)
            ? Math.max(0, this.player.currentTime)
            : 0;

          if (dur > 0) {
            console.log(
              `[ExpoVideoAdapter] readyToPlay: time=${time}s dur=${dur}s (seeking=${this._isSeeking})`,
            );
            if (this._isSeeking) {
              if (this.isSeekResolved(time)) {
                this._isSeeking = false;
                this.timeListeners.forEach((l) => l(time, dur));
              }
            } else if (time > 0) {
              this.timeListeners.forEach((l) => l(time, dur));
            }
          } else {
            // HEVC/MKV: duration not yet parsed — poll for it with exponential backoff
            console.log(
              `[ExpoVideoAdapter] readyToPlay: time=${time}s dur=0, polling for metadata...`,
            );
            this.pollForMetadata(this.estimatedSizeBytes);
          }

          if (!this._userPaused) {
            this.resumePlay("readyToPlay");
          }
        }

        // expo-video emits "error" status with an error field
        if (status.status === "error" || (status as any).error) {
          const rawErr = (status as any).error ?? "Playback error";
          const err =
            typeof rawErr === "string"
              ? rawErr
              : (rawErr?.message ?? "Playback error");
          const errorType = this.classifyError(err);
          console.log(
            `[ExpoVideoAdapter] Error via statusChange: "${err}" (${errorType})`,
          );
          this.currentError = this.errorMessageForType(errorType, err);
          const currentErr = this.currentError;
          this.errorListeners.forEach((l) => l(currentErr));
        }
      }),
    );

    // 4. Source changes
    this.subs.push(
      player.addListener("sourceChange", () => {
        if (this.destroyed) return;
        this.currentError = null;
        this.stuckSince = 0;
        this.metadataLoaded = false;
        this.endedEmitted = false;
        this.lastProgressTime = Date.now();
        if (!this._userPaused) {
          this.resumePlay("sourceChange");
        }
      }),
    );

    // 5. Stuck detection with progressive timeout & poll-driven time updates
    this.startStuckDetection();
  }

  /**
   * Set estimated file size in bytes for dynamic metadata parsing timeout.
   */
  setEstimatedSizeBytes(bytes?: number) {
    this.estimatedSizeBytes = bytes;
  }

  /**
   * Set whether this URL was validated by the GET Range probe.
   */
  setProbeValidated(validated: boolean) {
    this.isProbeValidated = validated;
  }

  /**
   * Reset stuck detection state — called when retrying the same URL.
   */
  resetStuckDetection() {
    this.metadataLoaded = false;
    this.lastProgressTime = Date.now();
    this.stuckSince = 0;
    this.stopStuckDetection();
    this.startStuckDetection();
  }

  private startStuckDetection() {
    this.errorCheckTimer = setInterval(() => {
      if (this.destroyed) return;

      const dur = this.getDuration();
      const time = Number.isFinite(this.player.currentTime)
        ? Math.max(0, this.player.currentTime)
        : 0;

      // Sync duration & progress if player is now populated
      if (dur > 0) {
        this.metadataLoaded = true;
      }
      if (time > 0) {
        this.lastProgressTime = Date.now();
        this.stuckSince = 0;
      }

      // Poll-driven time update: fires regardless of whether timeUpdate
      // events are reliable for this container/codec combination.
      if (!this._isSeeking && time > 0 && dur > 0) {
        if (this.maybeEmitEnded()) return;
        this.timeListeners.forEach((l) => l(time, dur));
      }

      // Check for native player errors
      const err = (this.player as any).error;
      if (err && err !== this.currentError) {
        const errMsg =
          typeof err === "string" ? err : (err?.message ?? "Playback error");
        const errorType = this.classifyError(errMsg);
        console.log(
          `[ExpoVideoAdapter] Error detected via poll: "${err}" (${errorType})`,
        );
        this.currentError = this.errorMessageForType(errorType, errMsg);
        const currentErr = this.currentError;
        this.errorListeners.forEach((l) => l(currentErr));
      }

      const status = this.player.status;

      // Watchdog timeout for dead or stalling connections (hung sockets / throttled mirrors)
      // 1. If probe-validated, allow 10s for heavy container headers before fallback.
      // 2. If unvalidated, allow 8.5s before falling back to a pre-validated link.
      const noMetadataTimeout = this.isProbeValidated ? 10000 : 8500;

      if (status === "loading") {
        if (
          !this.metadataLoaded &&
          (!Number.isFinite(this.player.duration) || this.player.duration <= 0)
        ) {
          if (this.stuckSince === 0) {
            this.stuckSince = Date.now();
          } else if (Date.now() - this.stuckSince > noMetadataTimeout) {
            console.log(
              `[ExpoVideoAdapter] No metadata after ${noMetadataTimeout}ms, triggering fallback`,
            );
            console.log(
              `[ExpoVideoAdapter] currentTime=${time}, duration=${this.player.duration}, status=${status}`,
            );
            this.currentError =
              "Stream connection stalled — switching to backup source";
            const currentErr = this.currentError;
            this.errorListeners.forEach((l) => l(currentErr));
            this.stopStuckDetection();
            return;
          }
        }
      } else {
        // Not loading — reset stuck timer
        this.stuckSince = 0;
      }
    }, 500);
  }

  /**
   * Poll for non-zero duration after readyToPlay fires with dur=0.
   * Uses exponential backoff and scales timeout ceiling by file size.
   */
  private pollForMetadata(estimatedSizeBytes?: number) {
    let attempts = 0;
    const sizeBytes = estimatedSizeBytes ?? this.estimatedSizeBytes ?? 0;
    const sizeGB = sizeBytes / 1024 ** 3;
    // Scale ceiling: ~5s baseline, +1s per GB beyond 2GB, capped at 15s.
    const maxWaitMs = Math.min(15000, 5000 + Math.max(0, sizeGB - 2) * 1000);
    const startedAt = Date.now();

    const poll = () => {
      if (this.destroyed) return;
      const dur = this.getDuration();
      if (dur > 0) {
        this.metadataLoaded = true;
        const time = Number.isFinite(this.player.currentTime)
          ? Math.max(0, this.player.currentTime)
          : 0;
        console.log(
          `[ExpoVideoAdapter] Metadata found: time=${time}s dur=${dur}s`,
        );
        this.timeListeners.forEach((l) => l(time, dur));
        return;
      }

      if (Date.now() - startedAt >= maxWaitMs) {
        console.warn(
          `[ExpoVideoAdapter] Metadata polling timed out (${maxWaitMs}ms)`,
        );
        // Surface a soft error so HevcPlayer's fallback logic can act
        this.errorListeners.forEach((l) => l("Metadata parsing timed out"));
        return;
      }

      attempts++;
      // Backoff: 100ms -> 150ms -> 225ms -> ... capped at 500ms
      const delay = Math.min(
        500,
        Math.round(100 * Math.pow(1.5, Math.min(attempts, 6))),
      );
      setTimeout(poll, delay);
    };

    poll();
  }

  private stopStuckDetection() {
    if (this.errorCheckTimer) {
      clearInterval(this.errorCheckTimer);
      this.errorCheckTimer = null;
    }
  }

  /**
   * Classify error type for differentiated handling.
   * - extractor: format not recognized by any ExoPlayer extractor
   * - network: 403/404/timeout (may be temporary)
   * - unknown: other errors
   */
  private classifyError(message: string): "extractor" | "network" | "unknown" {
    const lower = message.toLowerCase();

    // ExoPlayer extractor error
    if (
      lower.includes("extractor") ||
      lower.includes("could not read the stream")
    ) {
      return "extractor";
    }

    // Network/HTTP errors
    if (
      /\b\d{3}\b/.test(message) ||
      lower.includes("timeout") ||
      lower.includes("network")
    ) {
      return "network";
    }

    // DRM errors
    if (lower.includes("drm") || lower.includes("widevine")) {
      return "network";
    }

    return "unknown";
  }

  /**
   * Map classified error type to user-facing message.
   */
  private errorMessageForType(
    type: "extractor" | "network" | "unknown",
    original: string,
  ): string {
    if (type === "extractor") {
      return "Stream format not supported by player (extractor error)";
    }
    if (type === "network") {
      return (
        "Network error — server returned " +
        (/\b\d{3}\b/.exec(original)?.[0] ?? "an error status")
      );
    }
    return original;
  }

  /**
   * Report the natural end of media exactly once per source. A user pause
   * near the end is NOT an end — they may still seek back.
   */
  private maybeEmitEnded(): boolean {
    if (this.endedEmitted || this.destroyed || this._userPaused) return false;
    const dur = this.getDuration();
    const time = Number.isFinite(this.player.currentTime)
      ? this.player.currentTime
      : 0;
    if (dur > 0 && time >= dur - 1) {
      this.endedEmitted = true;
      console.log(`[ExpoVideoAdapter] Media ended (time=${time}, dur=${dur})`);
      this.endedListeners.forEach((l) => l());
      return true;
    }
    return false;
  }

  hasError(): boolean {
    return this.currentError !== null;
  }

  clearError(): void {
    this.currentError = null;
  }

  onError(cb: (error: string) => void): () => void {
    this.errorListeners.push(cb);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== cb);
    };
  }

  onEnded(cb: () => void): () => void {
    this.endedListeners.push(cb);
    return () => {
      this.endedListeners = this.endedListeners.filter((l) => l !== cb);
    };
  }

  /** Internal auto-resume — logs a reason so a background-resume bug can be
   *  traced to its exact call site ([FS-BG] diagnosis). */
  private resumePlay(reason: string) {
    console.log(
      `[FS-BG] player.play() via ${reason} (userPaused=${this._userPaused}, status=${this.player.status}, playing=${this.player.playing})`,
    );
    this.player.play();
  }

  setAppBackgrounded(backgrounded: boolean) {
    console.log(
      `[FS-BG] adapter.setAppBackgrounded(${backgrounded}) (playing=${this.player.playing})`,
    );
    this._appBackgrounded = backgrounded;
    // Entering background while the player is still playing — the AppState
    // pause raced ahead of the native transition. Stop it here.
    if (backgrounded && this.player.playing) {
      this.pause();
    }
  }

  play() {
    console.log(
      `[FS-BG] adapter.play() called (was userPaused=${this._userPaused}, status=${this.player.status}, playing=${this.player.playing})`,
    );
    this._userPaused = false;
    this.player.play();
    this.playPauseListeners.forEach((l) => l(false));
    this.bufferingListeners.forEach((l) => l(false));
  }

  pause() {
    console.log(
      `[FS-BG] adapter.pause() called (was userPaused=${this._userPaused}, playing=${this.player.playing}, status=${this.player.status})`,
    );
    this._userPaused = true;
    this.player.pause();
    this.playPauseListeners.forEach((l) => l(true));
    // A paused player is not buffering. Without this, a pause landing while a
    // stall's buffering(true) is pending (e.g. the background pause squashing
    // the transitions that would normally clear it) leaves the overlay's
    // play button stuck on the loading spinner.
    this.bufferingListeners.forEach((l) => l(false));
  }

  /** True while a seek is in flight (target requested but not yet resolved). */
  isSeeking(): boolean {
    return this._isSeeking;
  }

  seek(time: number) {
    if (!Number.isFinite(time) || time < 0) return;
    const dur = this.getDuration();
    const clamped =
      dur > 0 ? Math.max(0, Math.min(dur, time)) : Math.max(0, time);

    const myGeneration = ++this._seekGeneration;
    this._isSeeking = true;
    this._targetSeekTime = clamped;
    this.bufferingListeners.forEach((l) => l(true));

    // Optimistically reflect the target position immediately so the UI
    // doesn't visually snap back while the real seek resolves.
    this.timeListeners.forEach((l) => l(clamped, dur));

    console.log(
      `[ExpoVideoAdapter] seek to ${clamped}s (dur=${dur}s, gen=${myGeneration})`,
    );
    try {
      this.player.currentTime = clamped;
    } catch (e) {
      console.warn("[ExpoVideoAdapter] seek error:", e);
    }

    if (!this._userPaused) {
      this.resumePlay("seek");
    }

    // Secondary seek reinforcement at 400ms in case ExoPlayer's OkHttp connection
    // needed a re-trigger on initial Range setup
    setTimeout(() => {
      if (
        this._seekGeneration === myGeneration &&
        this._isSeeking &&
        !this.destroyed
      ) {
        if (
          this.player.status === "readyToPlay" &&
          Math.abs(this.player.currentTime - clamped) > 15
        ) {
          try {
            this.player.currentTime = clamped;
            if (!this._userPaused) this.resumePlay("seek-reinforce");
          } catch (_) {}
        }
      }
    }, 400);

    if (this._seekSafetyTimer) clearTimeout(this._seekSafetyTimer);
    this._seekSafetyTimer = setTimeout(() => {
      // Only clear if a newer seek hasn't superseded this one
      if (this._seekGeneration !== myGeneration) return;
      this._isSeeking = false;
      const actualTime = Number.isFinite(this.player.currentTime)
        ? this.player.currentTime
        : clamped;
      const resolvedTime = this.isSeekResolved(actualTime)
        ? actualTime
        : clamped;
      this.timeListeners.forEach((l) => l(resolvedTime, this.getDuration()));

      // If the player failed to seek (stuck near 0 while target was >10s),
      // signal error to trigger fallback to a seekable backup stream
      if (clamped > 10 && actualTime <= 2.0) {
        console.warn(
          `[ExpoVideoAdapter] Seek to ${clamped}s failed on unseekable stream (remained at ${actualTime}s)`,
        );
        this.errorListeners.forEach((l) =>
          l("Stream does not support seeking — switching to backup source"),
        );
      }

      if (!this._userPaused && !this.player.playing) {
        this.resumePlay("seek-safety");
      }
    }, 5000);
  }

  setVolume(volume: number) {
    this._volume = Math.max(0, Math.min(1, volume));
    this.player.volume = this._volume;
  }

  setMuted(muted: boolean) {
    this._isMuted = muted;
    this.player.muted = muted;
  }

  setPlaybackRate(rate: number) {
    this._rate = rate;
    this.player.playbackRate = rate;
  }

  getCurrentTime(): number {
    if (this._isSeeking && this._targetSeekTime > 0) {
      return this._targetSeekTime;
    }
    return Number.isFinite(this.player.currentTime)
      ? this.player.currentTime
      : 0;
  }

  getDuration(): number {
    return Number.isFinite(this.player.duration) && this.player.duration > 0
      ? this.player.duration
      : 0;
  }

  isPaused(): boolean {
    return this._userPaused;
  }

  isMuted(): boolean {
    return this._isMuted;
  }

  getVolume(): number {
    return this._volume;
  }

  getPlaybackRate(): number {
    return this._rate;
  }

  getAudioTracks(): AudioTrackInfo[] {
    const tracks = this.player.availableAudioTracks;
    return tracks.map((t) => ({
      id: t.id ?? t.language ?? "unknown",
      label: t.label || t.language || "Audio Track",
      language: t.language || undefined,
    }));
  }

  setAudioTrack(trackId: string) {
    const tracks = this.player.availableAudioTracks;
    const match = tracks.find((t) => (t.id ?? t.language) === trackId);
    if (match) {
      this.player.audioTrack = match;
    }
  }

  getSelectedAudioTrackId(): string | null {
    const t = this.player.audioTrack;
    return t ? (t.id ?? t.language ?? null) : null;
  }

  getSubtitleTracks(): SubtitleTrackInfo[] {
    // [SubPerf] This read synchronizes with the (busy) main thread — if it's
    // slow it will show up here on render paths.
    const t0 = Date.now();
    const tracks = this.player.availableSubtitleTracks;
    const dt = Date.now() - t0;
    if (dt > 30) {
      console.log(
        `[SubPerf] availableSubtitleTracks read took ${dt}ms (${tracks.length} tracks)`,
      );
    }
    return tracks.map((t) => {
      const id = t.id ?? t.language ?? "off";
      // Sidecar tracks merged via MergingMediaSource report ids like
      // "1:sidecar_1" (child-index prefix + our stable native id).
      const isExternal = id.includes("sidecar_");
      return {
        id,
        // External: prefer our human label ("Online · <release name>") which
        // expo-video exposes as `name`; embedded: the display language label.
        label: isExternal
          ? t.name || t.label || t.language || "Subtitle Track"
          : t.label || t.language || "Subtitle Track",
        language: t.language || undefined,
        isExternal,
      };
    });
  }

  setSubtitleTrack(trackId: string) {
    if (trackId === "off") {
      this.subtitleEnabledAt = 0;
      this.player.subtitleTrack = null;
      return;
    }
    const tracks = this.player.availableSubtitleTracks;
    const match = tracks.find((t) => (t.id ?? t.language) === trackId);
    this.subtitleEnabledAt = match ? Date.now() : 0;
    this.player.subtitleTrack = match ?? null;
  }

  getSelectedSubtitleTrackId(): string | null {
    // [SubPerf] Same main-thread synchronization risk as getSubtitleTracks.
    const t0 = Date.now();
    const current = this.player.subtitleTrack;
    const dt = Date.now() - t0;
    if (dt > 30) {
      console.log(`[SubPerf] player.subtitleTrack read took ${dt}ms`);
    }
    if (!current) return null;
    return current.id ?? current.language ?? null;
  }

  subtitleJustEnabled(): boolean {
    return (
      this.subtitleEnabledAt > 0 &&
      Date.now() - this.subtitleEnabledAt <
        getPlayerTuning().subtitleErrorWindowMs
    );
  }

  /**
   * Adds an external subtitle file (downloaded srt/ass/vtt) as a sidecar
   * MergingMediaSource. Re-prepares natively at the current position, then
   * polls for the new track (matched by the stable "sidecar_N" id the native
   * call returns) and selects it. Resolves with the selected track id, or
   * null if the track didn't appear in time (playback continues).
   */
  async addExternalSubtitle(
    uri: string,
    mimeType: string,
    language?: string,
    label?: string,
  ): Promise<string | null> {
    const api = playerWithSidecarApi(this.player);
    if (typeof api.addSidecarSubtitle !== "function") {
      throw new Error(
        "Sidecar subtitles unsupported (expo-video patch missing)",
      );
    }
    console.log(
      `[SidecarSubs] JS: calling native addSidecarSubtitle uri=…${uri.slice(-48)} mime=${mimeType} lang=${language} label=${label}`,
    );
    const trackId = await api.addSidecarSubtitle(
      uri,
      mimeType,
      language ?? null,
      label ?? null,
    );
    console.log(`[SidecarSubs] JS: native returned trackId=${trackId}`);
    if (!trackId) return null;

    // After the re-prepare the track list refreshes asynchronously — poll briefly.
    const started = Date.now();
    while (Date.now() - started < 5000) {
      await new Promise((r) => setTimeout(r, 250));
      const tracks = this.getSubtitleTracks();
      // MergingMediaSource prefixes child-source format ids with the child
      // index — our "sidecar_1" reports as "1:sidecar_1". Match both forms.
      const match = tracks.find(
        (t) => t.id === trackId || t.id.endsWith(`:${trackId}`),
      );
      if (match) {
        console.log(
          `[SidecarSubs] JS: track ${match.id} appeared after ${Date.now() - started}ms — selecting`,
        );
        this.setSubtitleTrack(match.id);
        this.subtitleEnabledAt = Date.now();
        return match.id;
      }
    }
    const finalTracks = this.getSubtitleTracks();
    console.log(
      `[SidecarSubs] JS: timed out waiting for ${trackId}. Available tracks: ` +
        (finalTracks.map((t) => `${t.id}|${t.label}`).join(", ") || "none"),
    );
    return null;
  }

  /** Drops all sidecar subtitles (takes effect at the next source prepare). */
  clearExternalSubtitles(): void {
    playerWithSidecarApi(this.player).clearSidecarSubtitles?.();
  }

  onTimeUpdate(cb: (time: number, duration: number) => void): () => void {
    this.timeListeners.push(cb);
    return () => {
      this.timeListeners = this.timeListeners.filter((l) => l !== cb);
    };
  }

  onPlayPause(cb: (isPaused: boolean) => void): () => void {
    this.playPauseListeners.push(cb);
    return () => {
      this.playPauseListeners = this.playPauseListeners.filter((l) => l !== cb);
    };
  }

  onBuffering(cb: (isBuffering: boolean) => void): () => void {
    this.bufferingListeners.push(cb);
    return () => {
      this.bufferingListeners = this.bufferingListeners.filter((l) => l !== cb);
    };
  }

  /**
   * Shift embedded-subtitle timestamps. Applied natively in the vendored
   * extractor (text-track block timecodes) — static, so it survives extractor
   * recreation on source switches and covers every subsequent play.
   */
  setSubtitleOffset(ms: number): void {
    try {
      ExpoVideoNativeModule.setSubtitleOffset?.(ms);
    } catch (e) {
      console.warn("[ExpoVideoAdapter] setSubtitleOffset unavailable:", e);
    }
  }

  destroy() {
    if (this.destroyed) return; // Prevent double-destroy

    this.destroyed = true;

    // Clear all timers
    if (this._seekSafetyTimer) clearTimeout(this._seekSafetyTimer);
    if (this.errorCheckTimer) clearInterval(this.errorCheckTimer);

    // Remove all subscriptions
    this.subs.forEach((s) => s.remove());
    this.subs = [];

    // Clear all listeners
    this.timeListeners = [];
    this.playPauseListeners = [];
    this.bufferingListeners = [];
    this.errorListeners = [];
    this.endedListeners = [];

    // Reset state
    this.metadataLoaded = false;
    this.stuckSince = 0;
    this.lastProgressTime = Date.now();
    this.currentError = null;

    // Clear player reference
    this.player = null as any;
  }
}
