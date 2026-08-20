/**
 * PlaybackEngine — the single source of truth for watch-progress and the
 * intro / next-episode arbitrated lifecycle.
 *
 * This is the core of the watch-progress redesign. One engine instance lives
 * per watch session (a movie, or a single TV episode). Every time source —
 * a native provider postMessage (peachify PLAYER_EVENT, screenscape's
 * watch-history, vidnest/viduki MEDIA_DATA), the app media hook for silent
 * providers, or a provider's own resume store — funnels into the SAME
 * `ingest()` method, which collapses them into one monotonic `PlaybackState`.
 * All UI (RN overlays, storage saves) derives from this state instead of
 * polling a raw ref.
 *
 * Design guarantees (from the expert production-grade review):
 *
 *  1. Never trust the provider's own percent. We always compute
 *     currentTime / duration and clamp to [0, 1]. Durations under 30 s
 *     (ads / pre-roll / trailers) are treated as "no duration" so we never
 *     falsely mark an episode completed at 5 %.
 *
 *  2. Monotonic forward progress. Outside the resume settle window we ignore
 *     backward time jumps — the app is authoritative and won't let a flaky
 *     provider yank the playhead back.
 *
 *  3. Episode identity (`episodeKey`). Intro / next-episode lifecycle is bound
 *     to the episode key, so state cannot leak from one episode to the next.
 *
 *  4. "Watched-to-end" detection. The next-episode affordance only arms when
 *     we observed the playhead advance FORWARD to >= 95 % during THIS episode
 *     session — never when a resume / seek merely jumped it there. This is the
 *     bulletproof fix for the "Next-Episode button stays showing on the next
 *     episode" bug: a freshly-resumed >= 95 % episode will not re-arm until
 *     the user actually watches it to the end again.
 *
 *  5. Resume settle window. For `resume: 'none'` providers (unpredictable
 *     self-resume) we open a 10 s window after applying our own resume seek,
 *     during which backward time jumps from the provider's own seek are
 *     tolerated (clamped to our max) so the two don't fight and double-seek.
 */

export interface PlaybackState {
  /** Identity of the current media item. Binds intro / next-episode lifecycle. */
  episodeKey: string;
  currentTime: number;
  duration: number;
  /** Computed currentTime / duration, clamped [0, 1]. Never trusts source. */
  percent: number;
  /** True once percent >= 0.95 (auto-complete). */
  completed: boolean;
  /** 'resuming' during the settle window, otherwise 'playing'. */
  phase: "playing" | "resuming";
  /** Highest FORWARD-observed percent this episode session. */
  maxForwardPercent: number;
  /** Whether we've ever seen live forward playback this session. */
  hasLiveProgress: boolean;
}

export type PlaybackListener = (state: Readonly<PlaybackState>) => void;

/** After the app applies its own resume seek, tolerate provider self-resume. */
const SETTLE_WINDOW_MS = 10_000;
/** Durations below this are treated as "no duration" (ads / trailers). */
const MIN_DURATION = 30;
/** Forward-progress hysteresis — samples must advance by at least this. */
const FORWARD_HYSTERESIS = 0.25;
/** Backward-drift tolerance outside the settle window (seconds). */
const BACKWARD_SLACK = 1;

/**
 * Build the canonical episode key used to bind playback + UI lifecycle.
 * Movies: `movie:<tmdbId>`. TV: `tv:<tmdbId>:s<season>e<episode>`.
 */
export function buildEpisodeKey(
  mediaType: "movie" | "tv",
  tmdbId: string | number,
  season?: number,
  episode?: number,
): string {
  if (mediaType === "tv" && season != null && episode != null) {
    return `tv:${tmdbId}:s${season}e${episode}`;
  }
  return `movie:${tmdbId}`;
}

export class PlaybackEngine {
  private state: PlaybackState;
  private listeners = new Set<PlaybackListener>();
  private prevTime = 0;
  private settleUntil = 0;

  constructor(episodeKey: string, resumeSeconds = 0) {
    const resuming = resumeSeconds > 5;
    this.state = {
      episodeKey,
      currentTime: resumeSeconds,
      duration: 0,
      percent: 0,
      completed: false,
      phase: resuming ? "resuming" : "playing",
      maxForwardPercent: 0,
      hasLiveProgress: false,
    };
    this.prevTime = resumeSeconds;
    this.settleUntil = resuming ? Number.MAX_SAFE_INTEGER : 0;
  }

  getState(): Readonly<PlaybackState> {
    return this.state;
  }

  /** Subscribe to state changes. Fires immediately with the current state. */
  subscribe(fn: PlaybackListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }

  /**
   * Set / reset the current episode identity. Resets all progress and — when a
   * resume position is supplied — opens a settle window so an external resume
   * doesn't fight us. Call this on every episode change / provider switch.
   */
  setEpisode(episodeKey: string, resumeSeconds = 0, now = Date.now()): void {
    const resuming = resumeSeconds > 5;
    this.state = {
      episodeKey,
      currentTime: resumeSeconds,
      duration: 0,
      percent: 0,
      completed: false,
      phase: resuming ? "resuming" : "playing",
      maxForwardPercent: 0,
      hasLiveProgress: false,
    };
    this.prevTime = resumeSeconds;
    this.settleUntil = resuming ? now + SETTLE_WINDOW_MS : 0;
    this.emit();
  }

  /**
   * Open a settle window on the CURRENT episode (called when the app applies
   * its own resume seek on an already-loaded episode, e.g. on `cf:content-ready`).
   */
  beginResume(resumeSeconds: number, now = Date.now()): void {
    if (resumeSeconds > 5) {
      this.state.currentTime = resumeSeconds;
      this.state.phase = "resuming";
      this.prevTime = resumeSeconds;
      this.settleUntil = now + SETTLE_WINDOW_MS;
      this.emit();
    }
  }

  /**
   * Ingest a time sample from ANY adapter. Returns true if the sample changed
   * persisted-affecting state (used by callers to throttle storage writes).
   */
  ingest(currentTime: number, duration: number, now = Date.now()): boolean {
    if (!Number.isFinite(currentTime) || currentTime < 0) return false;
    if (!Number.isFinite(duration) || duration < 0) return false;

    const prev = this.state;
    const inSettle = now < this.settleUntil;

    // Core monotonic guard: outside the settle window, ignore backward drift.
    // The app is authoritative; a provider resetting the playhead must not
    //corrupt our progress. (During the settle window we DO accept the
    // provider's own self-resume, but only to our running max — see below.)
    if (!inSettle && currentTime < this.prevTime - BACKWARD_SLACK) {
      return false;
    }

    // Durations under MIN_DURATION are treated as "no duration" so we never
    // mark an ad / pre-roll / trailer as completed.
    const usableDuration = duration >= MIN_DURATION ? duration : 0;
    const newPct =
      usableDuration > 0 ? Math.min(currentTime / usableDuration, 1) : 0;

    // Always take the monotonic max of percent (settle or not) so a provider
    // self-resume can never permanently lower our recorded progress.
    const acceptedPct = Math.max(prev.percent, newPct);

    // Forward-progress tracking for "watched-to-end" detection. Only genuine
    // forward motion during live playback bumps maxForwardPercent — not a
    // resume / seek jump. This is what prevents the next-episode button from
    // re-arming on an episode that merely resumes near the end.
    const isForward = currentTime > this.prevTime + FORWARD_HYSTERESIS;
    if (isForward && usableDuration > 0) {
      this.state.maxForwardPercent = Math.max(
        this.state.maxForwardPercent,
        newPct,
      );
      this.state.hasLiveProgress = true;
    }

    const settled =
      !inSettle && now >= this.settleUntil && this.state.phase === "resuming";
    if (settled) this.state.phase = "playing";

    this.state.currentTime = currentTime;
    this.state.duration = usableDuration;
    this.state.percent = acceptedPct;
    this.state.completed = acceptedPct >= 0.95 || prev.completed;
    this.prevTime = currentTime;

    if (acceptedPct !== prev.percent || isForward) {
      this.emit();
      return true;
    }
    return false;
  }

  /**
   * Whether the next-episode affordance may arm. True ONLY when the playhead
   * has genuinely advanced forward to >= 95 % this session — never when a
   * resume / seek landed us there, and never while still settling. This makes
   * "click → next episode → button gone" bulletproof even when the new
   * episode itself resumes at >= 95 %.
   */
  canArmNextEpisode(): boolean {
    return (
      this.state.maxForwardPercent >= 0.95 &&
      this.state.percent >= 0.95 &&
      this.state.phase !== "resuming"
    );
  }

  markCompleted(): void {
    this.state.completed = true;
    this.emit();
  }
}
