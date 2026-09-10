/**
 * MpvPlayerAdapter — Implements PlayerAdapter for mpv engine.
 *
 * Event-driven: subscribes to real-time mpv events via onEvent() instead of
 * polling. State is cached locally for synchronous RAF reads (60x/sec by
 * ProgressBar), updated from events as they arrive.
 *
 * getAudioTracks() is synchronous per PlayerAdapter interface — tracks are
 * fetched once on construction and cached.
 */

import type { PlayerAdapter, TimeRange, AudioTrack } from "./player-adapters";

export class MpvPlayerAdapter implements PlayerAdapter {
  // Cached state (updated from real-time mpv events)
  private _position = 0;
  private _duration = 0;
  private _paused = true;
  private _volume = 1;
  private _muted = false;
  private _rate = 1;
  private _audioTracks: AudioTrack[] = [];

  // Event listeners
  private timeListeners: (() => void)[] = [];
  private playPauseListeners: (() => void)[] = [];

  // Unsubscribe from main process event stream
  private unsubEvent: (() => void) | null = null;

  constructor() {
    console.log("[MpvAdapter] Constructing...");
    const mpv = window.electronAPI?.mpv;
    if (!mpv) {
      console.error("[MpvAdapter] window.electronAPI.mpv not available");
      return;
    }
    console.log(
      "[MpvAdapter] window.electronAPI.mpv found, subscribing to events",
    );

    // Subscribe to real-time mpv events from main process
    this.unsubEvent = mpv.onEvent((event) => {
      switch (event.type) {
        case "time-pos":
          this._position =
            typeof event.value === "number" ? event.value : this._position;
          this.timeListeners.forEach((cb) => cb());
          break;
        case "duration":
          this._duration =
            typeof event.value === "number" ? event.value : this._duration;
          this.timeListeners.forEach((cb) => cb());
          break;
        case "pause":
          this._paused = true;
          this.playPauseListeners.forEach((cb) => cb());
          break;
        case "unpause":
          this._paused = false;
          this.playPauseListeners.forEach((cb) => cb());
          break;
        case "seek":
          this.timeListeners.forEach((cb) => cb());
          break;
        case "playback-restart":
          this.syncState();
          break;
        case "end-file":
          console.log("[MpvAdapter] end-file event received");
          break;
        default:
          console.log(`[MpvAdapter] event: ${event.type}`, event);
          break;
      }
    });
    console.log("[MpvAdapter] Event subscription active");

    // Fetch audio tracks once on construction
    this.refreshAudioTracks();
    // Initial state sync
    this.syncState();
  }

  private async syncState(): Promise<void> {
    const mpv = window.electronAPI?.mpv;
    if (!mpv) return;
    try {
      const state = await mpv.getState();
      if (!state) {
        console.log("[MpvAdapter] syncState: state is null");
        return;
      }
      this._position = state.position ?? 0;
      this._duration = state.duration ?? 0;
      this._paused = state.paused ?? true;
      this._volume = (state.volume ?? 100) / 100;
      this._muted = state.muted ?? false;
      this._rate = state.speed ?? 1;
      console.log(
        `[MpvAdapter] syncState: pos=${this._position.toFixed(1)} dur=${this._duration.toFixed(1)} paused=${this._paused} vol=${this._volume}`,
      );
      this.timeListeners.forEach((cb) => cb());
      this.playPauseListeners.forEach((cb) => cb());
    } catch (err) {
      console.warn("[MpvAdapter] syncState failed:", err);
    }
  }

  private async refreshAudioTracks(): Promise<void> {
    const mpv = window.electronAPI?.mpv;
    if (!mpv) return;
    try {
      const tracks = await mpv.getAudioTracks();
      this._audioTracks = tracks.map((t) => ({
        id: String(t.id),
        label: t.title || t.lang || `Track ${t.id}`,
        language: t.lang,
        codec: t.codec,
      }));
      console.log(
        `[MpvAdapter] refreshAudioTracks: ${this._audioTracks.length} tracks`,
      );
    } catch (err) {
      console.warn("[MpvAdapter] refreshAudioTracks failed:", err);
    }
  }

  // ── Playback Control ──────────────────────────────────────────────

  play(): void {
    window.electronAPI?.mpv?.resume();
  }

  pause(): void {
    window.electronAPI?.mpv?.pause();
  }

  seek(time: number): void {
    window.electronAPI?.mpv?.seek(time);
    // Optimistically update position for smooth scrubbing
    this._position = time;
    this.timeListeners.forEach((cb) => cb());
  }

  setVolume(volume: number): void {
    this._volume = volume;
    window.electronAPI?.mpv?.setVolume(volume);
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    window.electronAPI?.mpv?.setMuted(muted);
  }

  setPlaybackRate(rate: number): void {
    this._rate = rate;
    window.electronAPI?.mpv?.setSpeed(rate);
  }

  requestFullscreen(): void {
    const playerEl = document.querySelector("[data-mpv-player]");
    if (playerEl) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        playerEl.requestFullscreen();
      }
    }
  }

  // ── State Queries (synchronous — called 60x/sec by ProgressBar) ──

  getCurrentTime(): number {
    return this._position;
  }

  getDuration(): number {
    return this._duration;
  }

  getBuffered(): TimeRange[] {
    return [];
  }

  isPaused(): boolean {
    return this._paused;
  }

  isMuted(): boolean {
    return this._muted;
  }

  getVolume(): number {
    return this._volume;
  }

  getPlaybackRate(): number {
    return this._rate;
  }

  // ── Event Subscriptions ───────────────────────────────────────────

  onTimeUpdate(cb: () => void): () => void {
    this.timeListeners.push(cb);
    return () => {
      this.timeListeners = this.timeListeners.filter((l) => l !== cb);
    };
  }

  onPlayPause(cb: () => void): () => void {
    this.playPauseListeners.push(cb);
    return () => {
      this.playPauseListeners = this.playPauseListeners.filter((l) => l !== cb);
    };
  }

  onWaiting(cb: () => void): () => void {
    return () => {};
  }

  onPlaying(cb: () => void): () => void {
    return () => {};
  }

  // ── Track Selection (synchronous — cached from async fetch) ───────

  getAudioTracks(): AudioTrack[] {
    return this._audioTracks;
  }

  setAudioTrack(trackId: string): void {
    window.electronAPI?.mpv?.setAudioTrack(parseInt(trackId, 10));
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  destroy(): void {
    console.log("[MpvAdapter] destroy() called");
    this.unsubEvent?.();
    this.unsubEvent = null;
    this.timeListeners = [];
    this.playPauseListeners = [];
    // Fully destroy mpv process + video window (not just stop playback)
    // This prevents the lingering black box when navigating away
    window.electronAPI?.mpv?.destroy();
  }
}
