/**
 * Player Adapter — unified interface for native <video>, video.js, and WebCodecs players.
 *
 * Enables the ControlBar component to drive any player type with consistent APIs.
 */

"use client";

import type { RefObject } from "react";
import type { WebCodecsPlayerHandle } from "./WebCodecsPlayer";
type VideoJSPlayer = any;

export interface PlayerAdapter {
  play(): void;
  pause(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setPlaybackRate(rate: number): void;
  requestFullscreen(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getBuffered(): TimeRange[];
  isPaused(): boolean;
  isMuted(): boolean;
  getVolume(): number;
  getPlaybackRate(): number;
  onTimeUpdate?: (cb: () => void) => () => void;
  onPlayPause?: (cb: () => void) => () => void;
  onWaiting?: (cb: () => void) => () => void;
  onPlaying?: (cb: () => void) => () => void;
  /** Audio track switching — optional, only meaningful for MKV/multi-track sources. */
  getAudioTracks?: () => AudioTrack[];
  setAudioTrack?: (trackId: string) => void;
}

export interface QualityOption {
  quality: string;
  id: string;
  name: string;
  url: string;
  type: string;
  _meta?: {
    codec: string;
    audio: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
  };
}

export interface AudioTrack {
  id: string;
  label: string;
  language?: string;
  codec?: string;
  active?: boolean;
}

export interface SubtitleTrack {
  id: string;
  label: string;
  language?: string;
  active?: boolean;
  url?: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

// ─── Native <video> adapter ───────────────────────────────────────────

export class NativePlayerAdapter implements PlayerAdapter {
  constructor(private video: HTMLVideoElement) {}

  play() {
    this.video.play().catch(() => {});
  }
  pause() {
    this.video.pause();
  }
  seek(time: number) {
    this.video.currentTime = time;
  }
  setVolume(volume: number) {
    this.video.volume = volume;
  }
  setMuted(muted: boolean) {
    this.video.muted = muted;
  }
  setPlaybackRate(rate: number) {
    this.video.playbackRate = rate;
  }
  requestFullscreen() {
    this.video.requestFullscreen().catch(() => {});
  }
  getCurrentTime() {
    return this.video.currentTime;
  }
  getDuration() {
    return this.video.duration || 0;
  }
  getBuffered() {
    const ranges: TimeRange[] = [];
    for (let i = 0; i < this.video.buffered.length; i++) {
      ranges.push({
        start: this.video.buffered.start(i),
        end: this.video.buffered.end(i),
      });
    }
    return ranges;
  }
  isPaused() {
    return this.video.paused;
  }
  isMuted() {
    return this.video.muted;
  }
  getVolume() {
    return this.video.volume;
  }
  getPlaybackRate() {
    return this.video.playbackRate;
  }

  onTimeUpdate(cb: () => void) {
    this.video.addEventListener("timeupdate", cb);
    return () => this.video.removeEventListener("timeupdate", cb);
  }
  onPlayPause(cb: () => void) {
    this.video.addEventListener("play", cb);
    this.video.addEventListener("pause", cb);
    return () => {
      this.video.removeEventListener("play", cb);
      this.video.removeEventListener("pause", cb);
    };
  }
  onWaiting(cb: () => void) {
    this.video.addEventListener("waiting", cb);
    return () => this.video.removeEventListener("waiting", cb);
  }
  onPlaying(cb: () => void) {
    this.video.addEventListener("playing", cb);
    this.video.addEventListener("canplay", cb);
    return () => {
      this.video.removeEventListener("playing", cb);
      this.video.removeEventListener("canplay", cb);
    };
  }

  /**
   * Native <video> exposes multi-audio-track selection via the experimental
   * `audioTracks` property (Chromium/Safari). Not all browsers support it.
   */
  getAudioTracks(): AudioTrack[] {
    const tracks = (this.video as any).audioTracks;
    if (!tracks || typeof tracks.length !== "number") return [];
    const result: AudioTrack[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      result.push({
        id: t.id ?? String(i),
        label: t.label || t.language || `Track ${i + 1}`,
        language: t.language || undefined,
        active: !!t.enabled,
      });
    }
    return result;
  }
  setAudioTrack(trackId: string) {
    const tracks = (this.video as any).audioTracks;
    if (!tracks || typeof tracks.length !== "number") return;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = tracks[i].id === trackId || String(i) === trackId;
    }
  }
}

// ─── video.js adapter ─────────────────────────────────────────────────

export class VideoJSPlayerAdapter implements PlayerAdapter {
  constructor(private player: VideoJSPlayer) {}

  play() {
    const p = this.player.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
  pause() {
    this.player.pause();
  }
  seek(time: number) {
    this.player.currentTime(time);
  }
  setVolume(volume: number) {
    this.player.volume(volume);
  }
  setMuted(muted: boolean) {
    this.player.muted(muted);
  }
  setPlaybackRate(rate: number) {
    this.player.playbackRate(rate);
  }
  requestFullscreen() {
    this.player.requestFullscreen?.().catch(() => {});
  }
  getCurrentTime() {
    return this.player.currentTime();
  }
  getDuration() {
    return this.player.duration();
  }
  getBuffered() {
    return this.player.buffered() as unknown as TimeRange[];
  }
  isPaused() {
    return this.player.paused();
  }
  isMuted() {
    return this.player.muted();
  }
  getVolume() {
    return this.player.volume();
  }
  getPlaybackRate() {
    return this.player.playbackRate();
  }

  onTimeUpdate(cb: () => void) {
    this.player.on("timeupdate", cb);
    return () => this.player.off("timeupdate", cb);
  }
  onPlayPause(cb: () => void) {
    this.player.on("play", cb);
    this.player.on("pause", cb);
    return () => {
      this.player.off("play", cb);
      this.player.off("pause", cb);
    };
  }
  onWaiting(cb: () => void) {
    this.player.on("waiting", cb);
    return () => this.player.off("waiting", cb);
  }
  onPlaying(cb: () => void) {
    this.player.on("playing", cb);
    this.player.on("canplay", cb);
    return () => {
      this.player.off("playing", cb);
      this.player.off("canplay", cb);
    };
  }

  getAudioTracks(): AudioTrack[] {
    const tracks = this.player.audioTracks?.();
    if (!tracks || typeof tracks.length !== "number") return [];
    const result: AudioTrack[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      result.push({
        id: t.id ?? String(i),
        label: t.label || t.language || `Track ${i + 1}`,
        language: t.language || undefined,
        active: !!t.enabled,
      });
    }
    return result;
  }
  setAudioTrack(trackId: string) {
    const tracks = this.player.audioTracks?.();
    if (!tracks || typeof tracks.length !== "number") return;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = tracks[i].id === trackId || String(i) === trackId;
    }
  }
}

// ─── movi-player adapter ─────────────────────────────────────────────

/**
 * Structural shape of the <movi-player> element we rely on. The element
 * (movi-player/element/slim) mirrors the HTMLMediaElement API — play/pause,
 * currentTime, buffered, volume, playbackRate — plus its own audioTracks /
 * textTracks lists and fullscreen implementation, so this adapter drives it
 * exactly like NativePlayerAdapter drives <video>.
 */
export interface MoviElementLike extends HTMLElement {
  src: string | null;
  play(): Promise<void>;
  pause(): void;
  autoplay: boolean;
  preload: "none" | "metadata" | "auto";
  muted: boolean;
  volume: number;
  playbackRate: number;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly buffered: TimeRanges;
  readonly error: { code: number; message: string } | null;
  requestFullscreen(options?: FullscreenOptions): Promise<void>;
  /** AudioTrackList-shaped list; writing `enabled` switches the track. */
  readonly audioTracks: Array<{
    id: string;
    label: string;
    language: string;
    enabled: boolean;
  }>;
  /** Real TextTrackList — `mode` writes route into the player's selection. */
  readonly textTracks: TextTrackList;
}

export class MoviPlayerAdapter implements PlayerAdapter {
  constructor(public readonly element: MoviElementLike) {}

  private listen(types: string[], cb: () => void): () => void {
    for (const t of types) this.element.addEventListener(t, cb);
    return () => {
      for (const t of types) this.element.removeEventListener(t, cb);
    };
  }

  play() {
    const p = this.element.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
  pause() {
    this.element.pause();
  }
  seek(time: number) {
    // Never forward NaN/Infinity — setting currentTime to a non-finite value
    // throws on the native path and desyncs the canvas pipeline here.
    if (!Number.isFinite(time)) return;
    this.element.currentTime = Math.max(0, time);
  }
  setVolume(volume: number) {
    this.element.volume = Math.min(1, Math.max(0, volume));
  }
  setMuted(muted: boolean) {
    this.element.muted = muted;
  }
  setPlaybackRate(rate: number) {
    this.element.playbackRate = rate;
  }
  requestFullscreen() {
    // Movi's own fullscreen — canvas-aware, fires fullscreenchange, which the
    // page-level listeners (PlayerProvider, ControlBar) already track.
    const p = this.element.requestFullscreen?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
  getCurrentTime() {
    return this.element.currentTime || 0;
  }
  getDuration() {
    return this.element.duration || 0;
  }
  getBuffered() {
    const ranges: TimeRange[] = [];
    const b = this.element.buffered;
    for (let i = 0; i < b.length; i++) {
      ranges.push({ start: b.start(i), end: b.end(i) });
    }
    return ranges;
  }
  isPaused() {
    return this.element.paused;
  }
  isMuted() {
    return this.element.muted;
  }
  getVolume() {
    return this.element.volume;
  }
  getPlaybackRate() {
    return this.element.playbackRate;
  }

  onTimeUpdate(cb: () => void) {
    return this.listen(["timeupdate"], cb);
  }
  onPlayPause(cb: () => void) {
    return this.listen(["play", "pause"], cb);
  }
  onWaiting(cb: () => void) {
    return this.listen(["waiting"], cb);
  }
  onPlaying(cb: () => void) {
    return this.listen(["playing", "canplay", "loadeddata"], cb);
  }
  /** Playback failure — the element's `error` event with its mediaError. */
  onError(cb: (msg: string) => void) {
    return this.listen(["error"], () =>
      cb(this.element.error?.message || "playback error"),
    );
  }
  /** Track list changed (container tracks enumerated / selection moved). */
  onTracks(cb: () => void) {
    return this.listen(
      ["audiotrackchange", "subtitletrackchange", "trackschange", "addtrack"],
      cb,
    );
  }

  getAudioTracks(): AudioTrack[] {
    const list = this.element.audioTracks;
    if (!list || typeof list.length !== "number") return [];
    const result: AudioTrack[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      result.push({
        id: String(t.id ?? i),
        label: t.label || t.language || `Audio ${i + 1}`,
        language: t.language || undefined,
        active: !!t.enabled,
      });
    }
    return result;
  }
  setAudioTrack(trackId: string) {
    const list = this.element.audioTracks;
    if (!list || typeof list.length !== "number") return;
    for (let i = 0; i < list.length; i++) {
      list[i].enabled = String(list[i].id ?? i) === trackId;
    }
  }
  getCurrentAudioTrackId(): string | null {
    const active = this.getAudioTracks().find((t) => t.active);
    return active ? active.id : null;
  }

  getSubtitleTracks(): SubtitleTrack[] {
    const list = this.element.textTracks;
    if (!list || typeof list.length !== "number") return [];
    const result: SubtitleTrack[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      result.push({
        id: String(i),
        label: t.label || t.language || `Subtitle ${i + 1}`,
        language: t.language || undefined,
        active: t.mode === "showing",
      });
    }
    return result;
  }
  setSubtitleTrack(trackId: string | null) {
    const list = this.element.textTracks;
    if (!list || typeof list.length !== "number") return;
    for (let i = 0; i < list.length; i++) {
      list[i].mode =
        trackId !== null && String(i) === trackId ? "showing" : "disabled";
    }
  }
  getCurrentSubtitleTrackId(): string | null {
    const active = this.getSubtitleTracks().find((t) => t.active);
    return active ? active.id : null;
  }

  /**
   * Listeners live on the element itself, so they die with it — destroy only
   * drops our handle (called by the player when the element is replaced).
   */
  destroy() {}
}

// ─── WebCodecs adapter ────────────────────────────────────────────────

export class WebCodecsPlayerAdapter implements PlayerAdapter {
  private _currentTime = 0;
  private _duration = 0;
  private _paused = true;
  private _volume = 1;
  private _muted = false;
  private _rate = 1;
  private timeListeners: (() => void)[] = [];
  private playPauseListeners: (() => void)[] = [];
  private waitingListeners: (() => void)[] = [];
  private playingListeners: (() => void)[] = [];

  constructor(private handle: RefObject<WebCodecsPlayerHandle>) {}

  play() {
    if (!this.handle.current) return;
    this._paused = false;
    this.handle.current.play();
    this.playPauseListeners.forEach((l) => l());
  }
  pause() {
    if (!this.handle.current) return;
    this._paused = true;
    this.handle.current.pause();
    this.playPauseListeners.forEach((l) => l());
  }
  seek(time: number) {
    if (!this.handle.current) return;
    this._currentTime = time;
    this.handle.current.seek(time);
  }
  setVolume(volume: number) {
    if (!this.handle.current) return;
    this._volume = volume;
    this.handle.current.setVolume(volume);
  }
  setMuted(muted: boolean) {
    if (!this.handle.current) return;
    this._muted = muted;
    this.handle.current.setMuted(muted);
  }
  setPlaybackRate(rate: number) {
    this._rate = rate;
    this.handle.current?.setPlaybackRate?.(rate);
  }
  requestFullscreen() {
    const p = this.handle.current?.requestFullscreen?.() as unknown as
      | Promise<void>
      | undefined;
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
  getCurrentTime() {
    return this._currentTime;
  }
  getDuration() {
    return this._duration;
  }
  getBuffered() {
    return [];
  }
  isPaused() {
    return this._paused;
  }
  isMuted() {
    return this._muted;
  }
  getVolume() {
    return this._volume;
  }
  getPlaybackRate() {
    return this._rate;
  }

  getAudioTracks(): AudioTrack[] {
    return this.handle.current?.getAudioTracks?.() ?? [];
  }
  setAudioTrack(trackId: string) {
    this.handle.current?.setAudioTrack?.(trackId);
  }

  onTimeUpdate(cb: () => void) {
    const handler = () => {
      if (this.handle.current) {
        this._currentTime = this.handle.current.getCurrentTime();
        this._duration = this.handle.current.getDuration();
      }
      cb();
    };
    this.timeListeners.push(handler);
    return () => {
      this.timeListeners = this.timeListeners.filter((l) => l !== handler);
    };
  }
  onPlayPause(cb: () => void) {
    const handler = () => {
      if (this.handle.current) {
        this._paused = this.handle.current.isPaused();
      }
      cb();
    };
    this.playPauseListeners.push(handler);
    return () => {
      this.playPauseListeners = this.playPauseListeners.filter(
        (l) => l !== handler,
      );
    };
  }
  onWaiting(cb: () => void) {
    this.waitingListeners.push(cb);
    return () => {
      this.waitingListeners = this.waitingListeners.filter((l) => l !== cb);
    };
  }
  onPlaying(cb: () => void) {
    this.playingListeners.push(cb);
    return () => {
      this.playingListeners = this.playingListeners.filter((l) => l !== cb);
    };
  }

  /** Called by WebCodecsPlayer internals to notify buffering state changes. */
  notifyWaiting() {
    this.waitingListeners.forEach((l) => l());
  }
  notifyPlaying() {
    this.playingListeners.forEach((l) => l());
  }
}
