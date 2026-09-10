/**
 * Player types — mobile equivalent of desktop PlayerAdapter.
 *
 * Platform-agnostic interface so PlayerOverlay can drive any player engine.
 */

export interface PlayerAdapter {
  play(): void;
  pause(): void;
  seek(time: number): void;
  /** True while a seek is in flight (target requested but not resolved). Seek-induced buffering is not a stall. */
  isSeeking?(): boolean;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  isMuted(): boolean;
  getVolume(): number;
  getPlaybackRate(): number;
  /**
   * Tells the adapter the app is backgrounded. While set, the adapter must
   * keep playback stopped: squash native playing transitions (a play() issued
   * right before the background pause can land after it) and never auto-resume.
   */
  setAppBackgrounded?(backgrounded: boolean): void;
  getAudioTracks(): AudioTrackInfo[];
  setAudioTrack(trackId: string): void;
  /** Currently selected audio track id, if the adapter can tell. */
  getSelectedAudioTrackId?(): string | null;
  getSubtitleTracks(): SubtitleTrackInfo[];
  setSubtitleTrack(trackId: string): void;
  /** Currently selected subtitle track id, if the adapter can tell (null = off). */
  getSelectedSubtitleTrackId?(): string | null;
  /**
   * True for a short window after a (non-"off") subtitle track was selected.
   * Errors landing in this window are subtitle-induced, not source failures.
   */
  subtitleJustEnabled?(): boolean;
  /**
   * Adds an external subtitle file (srt/ass/vtt) as a sidecar source and
   * selects it once merged. Resolves with the track id (null if it never
   * appeared). Unsupported adapters reject.
   */
  addExternalSubtitle?(
    uri: string,
    mimeType: string,
    language?: string,
    label?: string,
  ): Promise<string | null>;
  /** Drops all sidecar subtitles (applies at the next source prepare). */
  clearExternalSubtitles?(): void;
  /** Shift embedded-subtitle timestamps (ms, negative = earlier). No-op when unsupported. */
  setSubtitleOffset?(ms: number): void;
  /** Subscribe to time updates. Returns unsubscribe function. */
  onTimeUpdate(cb: (time: number, duration: number) => void): () => void;
  /** Subscribe to play/pause changes. Returns unsubscribe function. */
  onPlayPause(cb: (isPaused: boolean) => void): () => void;
  /** Subscribe to buffering state. Returns unsubscribe function. */
  onBuffering(cb: (isBuffering: boolean) => void): () => void;
  /** Subscribe to playback errors (for auto-fallback). Returns unsubscribe. */
  onError?(cb: (error: string) => void): () => void;
  /** Subscribe to natural end of media (fires once per source). Returns unsubscribe. */
  onEnded?(cb: () => void): () => void;
  /** Check if player currently has an error. */
  hasError?(): boolean;
  /** Clear current error state. */
  clearError?(): void;
  destroy(): void;
}

export interface AudioTrackInfo {
  id: string;
  label: string;
  language?: string;
}

export interface SubtitleTrackInfo {
  id: string;
  label: string;
  language?: string;
  /** True for sidecar tracks loaded from external files (native id contains "sidecar_"). */
  isExternal?: boolean;
}
