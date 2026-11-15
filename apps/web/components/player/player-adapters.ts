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
 * SRT → WebVTT. `<track>` (the MSE engines' only external-subtitle channel)
 * refuses to parse anything else, and the providers' files are SRT by
 * default. Sequence numbers and arrow lines pass through; only the
 * `HH:MM:SS,mmm` comma timestamps become VTT dots. Content already in VTT
 * (providers occasionally label .vtt as srt) passes through untouched — a
 * second WEBVTT header would make the whole file unparseable.
 */
function srtToVtt(srt: string): string {
  const trimmed = srt.replace(/^\uFEFF/, "").trim();
  if (/^WEBVTT/i.test(trimmed)) return trimmed;
  const body = trimmed
    .split(/\r?\n/)
    .map((line) =>
      line.includes("-->")
        ? line.replace(/(\d{1,2}:\d{2}:\d{2})[,.](\d{3})/g, "$1.$2")
        : line,
    )
    .join("\n");
  return `WEBVTT\n\n${body}\n`;
}

interface ParsedCue {
  startTime: number;
  endTime: number;
  text: string;
}

/**
 * Minimal WebVTT → {start, end, text} cues for the stream engines'
 * `pendingCues` injection (their paint loop only reads those three fields —
 * `getCueAsHTML` misses fall back to a plain text node).
 */
function parseVttCues(vtt: string): ParsedCue[] {
  const toSeconds = (raw: string): number | null => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(raw);
    if (!m) return null;
    const ms = Number.parseFloat(String(m[4]).padEnd(3, "0")) / 1000;
    return (
      Number.parseInt(m[1] ?? "0", 10) * 3600 +
      Number.parseInt(m[2], 10) * 60 +
      Number.parseInt(m[3], 10) +
      ms
    );
  };
  const cues: ParsedCue[] = [];
  const lines = vtt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("-->")) continue;
    const [from, to] = lines[i].split("-->");
    const start = toSeconds(from);
    const end = toSeconds(to);
    const textLines: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ""; j++) {
      textLines.push(lines[j]);
    }
    if (start !== null && end !== null && textLines.length > 0) {
      cues.push({ startTime: start, endTime: end, text: textLines.join("\n") });
    }
    i += textLines.length;
  }
  return cues;
}

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
  /** Online-loaded external subs: movi key → display meta. */
  private externalSubs = new Map<
    string,
    { label: string; language?: string }
  >();
  /** MSE-surface path only: the <track> elements we attached per lang key. */
  private extTrackEls = new Map<string, HTMLTrackElement>();
  /** Stream-engine path: parsed cues per lang key, painted by our own loop. */
  private injectedCues = new Map<string, ParsedCue[]>();
  private activeInjectedLang: string | null = null;
  private extPaintTimer: number | null = null;
  private lastPaintSig = "";
  /** blob: URLs handed to the player — revoked when the adapter dies. */
  private extBlobUrls: string[] = [];
  private destroyed = false;

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
    const result: SubtitleTrack[] = [];
    if (list && typeof list.length === "number") {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        result.push({
          id: String(i),
          label: t.label || t.language || `Subtitle ${i + 1}`,
          language: t.language || undefined,
          active: t.mode === "showing",
        });
      }
    }
    // Online-loaded tracks (loadExternalSubtitle) live outside textTracks —
    // merged here so the app's menus show them with a correct tick. movi keys
    // them by our unique lang code ("en", "en-2"…), so two English tracks
    // never tick together. Where the active state lives depends on the engine
    // that won: players with their own external-lang list (native wrapper,
    // wasm core) report via getSubtitleLangs(); for the stream engines and
    // the MSE fallback our registry is the only truth.
    const el = this.element as unknown as {
      player?: {
        getSubtitleLangs?: () => {
          lang: string;
          label: string;
          active: boolean;
        }[];
      } | null;
    };
    const player = el.player;
    // The stream engines never consume external-lang lists (the core returns
    // before reading config.subtitleTracks), so on that path the registry is
    // the only source of truth — the player-reported list must NOT prune it.
    const langs =
      this.injectedCues.size > 0 ? null : player?.getSubtitleLangs?.();
    const reported = Array.isArray(langs)
      ? new Map(langs.map((e) => [e.lang, e]))
      : null;
    for (const [lang, meta] of Array.from(this.externalSubs.entries())) {
      const entry = reported?.get(lang);
      if (reported && !entry) {
        // The player rebuilt (source switch) and dropped this track.
        this.externalSubs.delete(lang);
        continue;
      }
      const trackEl = this.extTrackEls.get(lang);
      result.push({
        id: `ext:${lang}`,
        label: entry?.label || meta.label,
        language: meta.language,
        active: entry
          ? !!entry.active
          : trackEl
            ? trackEl.track.mode === "showing"
            : this.activeInjectedLang === lang,
      });
    }
    return result;
  }
  setSubtitleTrack(trackId: string | null) {
    // External tracks are picked by language. Picking one turns the embedded
    // ones off; "Off"/null turns both kinds off.
    const lang = trackId?.startsWith("ext:") ? trackId.slice(4) : null;
    if (lang !== null || trackId === null) {
      const el = this.element as unknown as {
        player?: {
          selectSubtitleLang?: (lang: string | null) => Promise<boolean>;
        } | null;
        selectSubtitleLang?: (lang: string | null) => Promise<boolean>;
      };
      const player = el.player;
      if (this.injectedCues.size > 0) {
        // Stream engines: our own paint loop owns the overlay — switching is
        // just pointing it at another cue set.
        this.activeInjectedLang = lang;
        this.lastPaintSig = "";
        if (lang === null) this.stopExternalPaint();
        else this.startExternalPaint();
      } else if (typeof player?.selectSubtitleLang === "function") {
        el.selectSubtitleLang?.(lang);
      } else {
        for (const [key, trackEl] of Array.from(this.extTrackEls)) {
          trackEl.track.mode = key === lang ? "showing" : "disabled";
        }
      }
    }
    const list = this.element.textTracks;
    if (!list || typeof list.length !== "number") return;
    for (let i = 0; i < list.length; i++) {
      list[i].mode =
        trackId !== null && !trackId.startsWith("ext:") && String(i) === trackId
          ? "showing"
          : "disabled";
    }
  }

  /**
   * Stream engines: paint our cues ourselves. The wrapper's own paint chain
   * (textContainer + pendingCues off its videoElement's timeupdate) no-oped
   * at runtime even with 900+ cues injected, and the core renderer's clock is
   * frozen on this path — so drive the loop from the wrapper's media clock
   * straight into the element's subtitle overlay, which movi styles for us.
   */
  private startExternalPaint(): void {
    if (this.extPaintTimer !== null) return;
    this.extPaintTimer = window.setInterval(() => {
      this.paintExternalCues();
    }, 150);
    this.paintExternalCues();
  }

  private stopExternalPaint(): void {
    if (this.extPaintTimer !== null) {
      window.clearInterval(this.extPaintTimer);
      this.extPaintTimer = null;
    }
    this.lastPaintSig = "";
    try {
      const overlay = (
        this.element as unknown as { subtitleOverlay?: HTMLElement | null }
      ).subtitleOverlay;
      if (overlay) {
        overlay.replaceChildren();
        overlay.style.display = "none";
      }
    } catch {}
  }

  private paintExternalCues(): void {
    const el = this.element as unknown as {
      subtitleOverlay?: HTMLElement | null;
      player?: {
        streamWrapper?: { videoElement?: HTMLVideoElement | null } | null;
        video?: HTMLVideoElement | null;
      } | null;
    };
    const clockEl = el.player?.streamWrapper?.videoElement ?? el.player?.video;
    const t = clockEl?.currentTime;
    if (typeof t !== "number" || !Number.isFinite(t)) return;
    const lang = this.activeInjectedLang;
    const cues = lang !== null ? (this.injectedCues.get(lang) ?? []) : [];
    const active = cues.filter((c) => c.startTime <= t && t < c.endTime);
    const sig = active.map((c) => c.text).join("\n");
    if (sig === this.lastPaintSig) return;
    this.lastPaintSig = sig;
    const overlay = el.subtitleOverlay;
    if (!overlay) return;
    overlay.replaceChildren();
    if (active.length === 0) {
      overlay.style.display = "none";
      return;
    }
    // The same markup the native wrapper paints, so movi's --movi-sub-*
    // styling (size/colour/background/edge) applies unchanged.
    overlay.classList.add("movi-subtitle-format-vtt");
    overlay.style.display = "block";
    const anchor = document.createElement("div");
    anchor.className = "movi-subtitle-anchor";
    anchor.style.textAlign = "center";
    const block = document.createElement("div");
    block.className = "movi-subtitle-block";
    for (const cue of active) {
      const row = document.createElement("div");
      row.className = "movi-subtitle-line";
      row.textContent = cue.text;
      block.appendChild(row);
    }
    anchor.appendChild(block);
    overlay.appendChild(anchor);
  }
  getCurrentSubtitleTrackId(): string | null {
    const active = this.getSubtitleTracks().find((t) => t.active);
    return active ? active.id : null;
  }

  /**
   * Load an online-searched subtitle into the running player.
   *
   * Receives the decoded FILE TEXT (the caller fetched it through
   * /api/subtitles/download — the provider hosts send no CORS headers) plus
   * its format, and hands the player a blob: URL so its own fetch sees
   * same-origin bytes. SRT is converted to WebVTT up front: the `<track>`
   * channels refuse anything else, and one format keeps every branch simple.
   *
   * `langKey` must be unique per loaded track — external subs are keyed by
   * language, so two tracks sharing "en" would both show as active.
   *
   * Engine dispatch (the element's `player` is whichever engine won):
   *   1. NativeVideoWrapper (browser-native MP4/WebM): `subs` list, the
   *      wrapper loads and paints cues itself into movi's overlay.
   *   2. MoviPlayer core WITH a canvas renderer (wasm decode — MKV/HEVC/AV1):
   *      `_subtitleTracks`, cues painted by its videoRenderer loop.
   *   3. Stream engines inside the core (hls.js/dash.js/shaka — the picture
   *      is drawn to canvas and the wrapper paints its own textContainer
   *      from `pendingCues` on every timeupdate; the core's own paint loop
   *      early-returns forever because videoRenderer is null): parse the VTT
   *      here and inject the cues into that loop.
   *   4. Last resort — a real `<track mode="showing">` on the media element.
   */
  async loadExternalSubtitle(
    text: string,
    format: string,
    langKey: string,
    label: string,
    language?: string,
  ): Promise<boolean> {
    if (this.destroyed) return false;
    const el = this.element as unknown as {
      isConnected: boolean;
      player?: {
        subs?: { url: string; lang: string; label: string; format: string }[];
        _subtitleTracks?: {
          url: string;
          lang: string;
          label: string;
          format: string;
        }[];
        videoRenderer?: unknown | null;
        streamWrapper?: { videoElement?: HTMLVideoElement } | null;
        selectSubtitleLang?: (lang: string | null) => Promise<boolean>;
      } | null;
      selectSubtitleLang: (lang: string | null) => Promise<boolean>;
      updateSubtitleTrackMenu?: () => void;
      video?: HTMLVideoElement | null;
    };
    const player = el.player;
    if (!player || !el.isConnected) return false;

    const body = format === "vtt" ? text : srtToVtt(text);
    const blobUrl = URL.createObjectURL(new Blob([body], { type: "text/vtt" }));
    this.extBlobUrls.push(blobUrl);

    // 1. NativeVideoWrapper — its `subs` is the list its own methods read.
    if (Array.isArray(player.subs)) {
      player.subs.push({ url: blobUrl, lang: langKey, label, format: "vtt" });
      try {
        const ok = await el.selectSubtitleLang(langKey);
        if (!ok) {
          player.subs = player.subs.filter((t) => t.lang !== langKey);
          console.error("[Direct] [subs] native wrapper rejected the track");
          return false;
        }
        this.externalSubs.set(langKey, { label, language });
        el.updateSubtitleTrackMenu?.();
        return true;
      } catch (err) {
        player.subs = player.subs.filter((t) => t.lang !== langKey);
        console.error("[Direct] [subs] native load failed:", err);
        return false;
      }
    }

    // 2. Core with its own canvas renderer — selectSubtitleLang paints.
    //    Stream-driven playback (hls.js/dash.js/shaka inside the core) ALSO
    //    has a videoRenderer, but its time provider is frozen — the wrapper
    //    drives the clock — so its cue matching never fires. Those engines
    //    must fall through to the pendingCues injection below.
    if (
      player.videoRenderer &&
      !player.streamWrapper &&
      typeof player.selectSubtitleLang === "function"
    ) {
      const tracks = (player._subtitleTracks ??= []);
      tracks.push({ url: blobUrl, lang: langKey, label, format: "vtt" });
      try {
        const ok = await el.selectSubtitleLang(langKey);
        if (!ok) {
          const at = tracks.findIndex((t) => t.lang === langKey);
          if (at >= 0) tracks.splice(at, 1);
          console.error("[Direct] [subs] core rejected the track");
          return false;
        }
        this.externalSubs.set(langKey, { label, language });
        el.updateSubtitleTrackMenu?.();
        return true;
      } catch {
        const at = tracks.findIndex((t) => t.lang === langKey);
        if (at >= 0) tracks.splice(at, 1);
        return false;
      }
    }

    // 3. Stream engines (hls.js/dash.js/shaka inside the core). The wrapper's
    //    own paint chain (textContainer/pendingCues) no-ops at runtime and the
    //    core renderer's clock is frozen on this path — so parse the cues here
    //    and paint them ourselves from the wrapper's media clock into the
    //    element's subtitle overlay (startExternalPaint below).
    const clockEl = (
      player.streamWrapper as
        | { videoElement?: HTMLVideoElement }
        | null
        | undefined
    )?.videoElement;
    if (clockEl) {
      const cues = parseVttCues(body);
      if (cues.length === 0) {
        console.error(
          "[Direct] [subs] VTT parse produced 0 cues — file may be malformed",
        );
        return false;
      }
      this.stopExternalPaint();
      this.injectedCues.set(langKey, cues);
      this.activeInjectedLang = langKey;
      this.externalSubs.set(langKey, { label, language });
      this.startExternalPaint();
      return true;
    }

    // 4. Last resort — browser-native track on the media element.
    const video = el.video;
    if (!video) {
      console.error("[Direct] [subs] no engine path available");
      return false;
    }
    const trackEl = document.createElement("track");
    trackEl.kind = "subtitles";
    trackEl.label = label;
    trackEl.srclang = langKey;
    trackEl.src = blobUrl;
    const loaded = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      trackEl.addEventListener("load", () => done(true), {
        once: true,
      });
      trackEl.addEventListener("error", () => done(false), {
        once: true,
      });
      // Some engines swap the media element's children on init — if no event
      // arrives, assume the track attached rather than blocking the sheet.
      window.setTimeout(() => done(true), 3000);
      video.appendChild(trackEl);
      if (trackEl.track) trackEl.track.mode = "showing";
    });
    if (!loaded) return false;
    for (const [key, other] of Array.from(this.extTrackEls)) {
      if (key !== langKey) other.track.mode = "disabled";
    }
    this.extTrackEls.set(langKey, trackEl);
    this.externalSubs.set(langKey, { label, language });
    return true;
  }

  /**
   * Drop every online-loaded subtitle — called on source switches, where the
   * player (and with it core/native track lists) is rebuilt anyway; the MSE
   * <track> elements live on the persistent media element and must go
   * explicitly.
   */
  clearExternalSubtitles(): void {
    for (const trackEl of Array.from(this.extTrackEls.values())) {
      try {
        trackEl.remove();
      } catch {}
    }
    this.extTrackEls.clear();
    this.injectedCues.clear();
    this.activeInjectedLang = null;
    this.stopExternalPaint();
    this.externalSubs.clear();
    for (const url of this.extBlobUrls.splice(0)) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
  }

  /**
   * Listeners live on the element itself, so they die with it — destroy only
   * drops our handle (called by the player when the element is replaced) and
   * revokes the subtitle blobs we minted.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearExternalSubtitles();
  }
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
