"use client";

import { isTrackTitleJunk } from "@/lib/subtitleName";

/**
 * MpvPlayerAdapter — Event-driven mpv adapter for the overlay page.
 *
 * The property-change stream is the single source of truth.
 * No syncState, no getState round-trip — property-change events update
 * cached state directly. The overlay page (video window) uses this adapter
 * to drive PlayerShell/ControlBar.
 */

// mpv reports ISO 639 codes (2- or 3-letter) from container metadata — show
// full language names in the audio/subtitle menus instead of "hi"/"eng".
const TRACK_LANG_NAMES: Record<string, string> = {
  hi: "Hindi",
  hin: "Hindi",
  en: "English",
  eng: "English",
  ta: "Tamil",
  tam: "Tamil",
  te: "Telugu",
  tel: "Telugu",
  ml: "Malayalam",
  mal: "Malayalam",
  kn: "Kannada",
  kan: "Kannada",
  mr: "Marathi",
  mar: "Marathi",
  bn: "Bengali",
  ben: "Bengali",
  pa: "Punjabi",
  pan: "Punjabi",
  gu: "Gujarati",
  guj: "Gujarati",
  ja: "Japanese",
  jpn: "Japanese",
  ko: "Korean",
  kor: "Korean",
  zh: "Chinese",
  zho: "Chinese",
  es: "Spanish",
  spa: "Spanish",
  fr: "French",
  fra: "French",
  fre: "French",
  de: "German",
  ger: "German",
  deu: "German",
  it: "Italian",
  ita: "Italian",
  pt: "Portuguese",
  por: "Portuguese",
  ru: "Russian",
  rus: "Russian",
  ar: "Arabic",
  ara: "Arabic",
  th: "Thai",
  tha: "Thai",
  multi: "Multi",
  mul: "Multi",
};

/**
 * Human label for an mpv track. Release-name titles scraped from the
 * container ("The.Odyssey.2026…HDHub4u.Ms.mkv") are noise in a menu — only
 * short human titles ("Commentary", "Forced") survive; language codes expand
 * to full names; bare tracks fall back to "Audio 1".
 */
function prettyTrackLabel(t: any): string {
  const lang = t?.lang ? String(t.lang).toLowerCase() : null;
  const langName = lang ? (TRACK_LANG_NAMES[lang] ?? null) : null;

  let title = t?.title ? String(t.title).trim() : "";
  if (
    title &&
    (/\.(mkv|mp4|avi|webm|m4v|ts)$/i.test(title) ||
      title.split(/[.\-_]/).length > 3)
  ) {
    title = "";
  }

  // Release-group / scraper titles ("HDHub4u.Ms", "FSLv2") are menu noise —
  // the same vocabulary the online-release prettifier drops.
  if (title && isTrackTitleJunk(title)) title = "";

  // Language FIRST (mobile SubtitleSheet parity — the language is what the
  // user scans for; a meaningful source title rides as the secondary part).
  const parts: string[] = [];
  if (langName) parts.push(langName);
  if (title) parts.push(title);
  return (
    parts.join(" · ") ||
    (t?.type === "sub" ? `Subtitle ${t?.id ?? ""}` : `Audio ${t?.id ?? ""}`)
  );
}

export class MpvPlayerAdapter {
  private tag = Math.random().toString(36).slice(2, 6);
  private destroyed = false;

  private _position = 0;
  private _duration = 0;
  private _paused = true;
  private _volume = 1;
  private _muted = false;
  private _speed = 1;
  private _buffering = false;

  private audioTracks: { id: string; label: string; language?: string }[] = [];
  private subtitleTracks: { id: string; label: string; language?: string }[] =
    [];
  private _currentAudio: string | null = null;
  private _currentSub: string | null = null;

  private playPauseListeners = new Set<() => void>();
  private timeListeners = new Set<() => void>();
  private waitingListeners = new Set<() => void>();
  private playingListeners = new Set<() => void>();
  private fileLoadedListeners = new Set<() => void>();
  private frameListeners = new Set<() => void>();
  private trackListeners = new Set<() => void>();
  private unsubEvent: (() => void) | null = null;
  private frameRaf = 0;

  constructor() {
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv?.onEvent) {
      console.error(
        `[MpvAdapter ${this.tag}] bridge missing onEvent — UI will be dead`,
      );
      return;
    }
    this.unsubEvent = mpv.onEvent((ev: any) => this.handleEvent(ev));
    // The event stream starts at subscription time; a pre-warm start may have
    // already emitted its initial pause/position changes. Seed from the
    // player's cached snapshot so the UI doesn't stay stuck on "paused".
    mpv
      .getState?.()
      .then((s: any) => {
        if (!s || this.destroyed) return;
        if (typeof s.paused === "boolean") this._paused = s.paused;
        if (typeof s.position === "number") this._position = s.position;
        if (typeof s.duration === "number") this._duration = s.duration;
        if (typeof s.volume === "number")
          this._volume = Math.min(1, Math.max(0, s.volume / 100));
        if (typeof s.muted === "boolean") this._muted = s.muted;
        if (typeof s.speed === "number") this._speed = s.speed;
        this.playPauseListeners.forEach((cb) => cb());
        this.timeListeners.forEach((cb) => cb());
      })
      .catch(() => {});
    this.frameRaf = requestAnimationFrame(this.frameTick);
  }

  // ── state ──
  isPaused() {
    return this._paused;
  }
  getCurrentTime() {
    return this._position;
  }
  getDuration() {
    return this._duration;
  }
  getVolume() {
    return this._volume;
  }
  isMuted() {
    return this._muted;
  }
  getPlaybackRate() {
    return this._speed;
  }
  isBuffering() {
    return this._buffering;
  }
  getAudioTracks() {
    return this.audioTracks;
  }
  getSubtitleTracks() {
    return this.subtitleTracks;
  }
  getCurrentAudioTrackId() {
    return this._currentAudio;
  }
  getCurrentSubtitleTrackId() {
    return this._currentSub;
  }

  // ── commands ──
  play() {
    (window as any).electronAPI?.mpv?.resume?.();
  }
  pause() {
    (window as any).electronAPI?.mpv?.pause?.();
  }
  seek(t: number) {
    // Never forward NaN/Infinity — JSON.stringify turns them into null and
    // mpv rejects the seek with "argument target has incompatible type".
    if (!Number.isFinite(t)) return;
    this._position = Math.max(0, t);
    this.timeListeners.forEach((cb) => cb());
    (window as any).electronAPI?.mpv?.seek?.(this._position);
  }
  setVolume(v: number) {
    this._volume = Math.min(1, Math.max(0, v));
    (window as any).electronAPI?.mpv?.setVolume?.(
      Math.round(this._volume * 100),
    );
  }
  setMuted(b: boolean) {
    this._muted = b;
    this.setProperty("mute", b);
  }
  setPlaybackRate(r: number) {
    this._speed = r;
    this.setProperty("speed", r);
  }
  setAudioTrack(id: string) {
    this._currentAudio = id;
    this.setProperty("aid", Number(id) || id);
  }
  setSubtitleTrack(id: string | null) {
    this._currentSub = id;
    this.setProperty("sid", id === null ? "no" : Number(id) || id);
  }
  /** Load an external subtitle file (online search result). The main process
   *  downloads it and feeds mpv via memory:// — no CORS, no temp files. */
  subAdd(
    url: string,
    title?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv?.subAdd)
      return Promise.resolve({ success: false, error: "not supported" });
    return mpv.subAdd(url, title);
  }
  requestFullscreen() {
    (window as any).electronAPI?.mpv?.toggleFullscreen?.();
  }
  getBuffered() {
    return [];
  }
  private setProperty(name: string, value: unknown) {
    (window as any).electronAPI?.mpv?.setProperty?.(name, value);
  }

  // ── subscriptions ──
  onPlayPause(cb: () => void) {
    this.playPauseListeners.add(cb);
    return () => this.playPauseListeners.delete(cb);
  }
  onTime(cb: () => void) {
    this.timeListeners.add(cb);
    return () => this.timeListeners.delete(cb);
  }
  onWaiting(cb: () => void) {
    this.waitingListeners.add(cb);
    return () => this.waitingListeners.delete(cb);
  }
  onPlaying(cb: () => void) {
    this.playingListeners.add(cb);
    return () => this.playingListeners.delete(cb);
  }
  onFileLoaded(cb: () => void) {
    this.fileLoadedListeners.add(cb);
    return () => this.fileLoadedListeners.delete(cb);
  }
  onTracks(cb: () => void) {
    this.trackListeners.add(cb);
    return () => this.trackListeners.delete(cb);
  }
  onFrame(cb: () => void) {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frameRaf);
    this.unsubEvent?.();
    this.playPauseListeners.clear();
    this.timeListeners.clear();
    this.waitingListeners.clear();
    this.playingListeners.clear();
    this.fileLoadedListeners.clear();
    this.frameListeners.clear();
    this.trackListeners.clear();
  }

  // ── internals ──
  private frameTick = () => {
    if (this.destroyed) return;
    if (!this._paused) this.frameListeners.forEach((cb) => cb());
    this.frameRaf = requestAnimationFrame(this.frameTick);
  };

  private handleEvent(ev: any) {
    if (this.destroyed) return;
    const raw = ev?.raw ?? ev;
    const type = raw?.event ?? ev?.event;
    if (type === "property-change") {
      this.updateProperty(
        raw?.name ?? raw?.data?.name,
        raw?.data ?? raw?.data?.data,
      );
    } else if (type === "playback-restart") {
      this._buffering = false;
      this.playingListeners.forEach((cb) => cb());
    } else if (type === "file-loaded") {
      this._buffering = true;
      this.waitingListeners.forEach((cb) => cb());
      this.fileLoadedListeners.forEach((cb) => cb());
    }
  }

  private updateProperty(name: string | undefined, value: any) {
    if (!name) return;
    switch (name) {
      case "time-pos":
        if (value != null) this._position = value;
        this.timeListeners.forEach((cb) => cb());
        break;
      case "duration":
        if (value != null) this._duration = value;
        this.timeListeners.forEach((cb) => cb());
        break;
      case "pause":
        this._paused = !!value;
        this.playPauseListeners.forEach((cb) => cb());
        break;
      case "volume":
        this._volume = Math.min(1, Math.max(0, (value ?? 100) / 100));
        break;
      case "mute":
        this._muted = !!value;
        break;
      case "speed":
        if (value != null) this._speed = value;
        break;
      case "paused-for-cache":
        this._buffering = !!value;
        (value ? this.waitingListeners : this.playingListeners).forEach((cb) =>
          cb(),
        );
        break;
      case "track-list":
        this.parseTracks(value);
        this.trackListeners.forEach((cb) => cb());
        break;
      case "aid":
        this._currentAudio =
          value == null || value === "no" ? null : String(value);
        break;
      case "sid":
        this._currentSub =
          value == null || value === "no" ? null : String(value);
        break;
    }
  }

  private parseTracks(list: any) {
    const audio: { id: string; label: string; language?: string }[] = [];
    const subs: { id: string; label: string; language?: string }[] = [];
    if (Array.isArray(list)) {
      for (const t of list) {
        const label = prettyTrackLabel(t);
        // Raw language (code or full name) — the menus use it for the
        // language-code heading and English-first sorting.
        const langName = t?.lang
          ? (TRACK_LANG_NAMES[String(t.lang).toLowerCase()] ?? String(t.lang))
          : undefined;
        if (t.type === "audio")
          audio.push({ id: String(t.id), label, language: langName });
        if (t.type === "sub")
          subs.push({ id: String(t.id), label, language: langName });
      }
    }
    this.audioTracks = audio;
    this.subtitleTracks = subs;
  }
}
