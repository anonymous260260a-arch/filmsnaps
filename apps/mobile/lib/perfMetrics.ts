/**
 * perfMetrics — tap-to-first-frame instrumentation + session health.
 *
 * One play session = one PerfSession. Stages:
 *   tap       → session created (watch page / player init)
 *   links     → stream links available (fetch or prefetch consume)
 *   player    → native player constructed with the chosen source
 *   firstFrame→ first timeUpdate with time > 0 (frames actually decoded)
 *
 * After firstFrame the session stays open and accumulates health counters:
 *   rebufferStart/rebufferEnd → mid-play stall count + total stall time
 *   noteFallback              → automatic source swaps
 * `close()` (player closed/unmounted) logs the END summary line and archives
 * the session. This is the measuring stick for the native work in
 * docs/native-player-upgrades.md — every change there is judged by these lines.
 */

export interface PerfStage {
  label: "tap" | "links" | "player" | "firstFrame";
  /** ms from session start */
  atMs: number;
}

export interface PerfSession {
  key: string;
  startedAt: number;
  stages: PerfStage[];
  /** Mid-play stalls (buffering that started after first frames). */
  rebufferCount: number;
  /** Total time spent stalled, ms. */
  stallMs: number;
  /** Automatic source fallbacks this session. */
  fallbackCount: number;
}

const RECENT: PerfSession[] = [];
const MAX_SESSIONS = 12;

export class PerfSessionTracker {
  private session: PerfSession | null = null;
  private rebufferStartedAt: number | null = null;
  private firstFrameLogged = false;

  constructor(key: string) {
    this.session = {
      key,
      startedAt: Date.now(),
      stages: [],
      rebufferCount: 0,
      stallMs: 0,
      fallbackCount: 0,
    };
    this.mark("tap");
  }

  mark(label: PerfStage["label"]) {
    if (!this.session) return;
    if (this.session.stages.some((s) => s.label === label)) return;
    const atMs = Date.now() - this.session.startedAt;
    this.session.stages.push({ label, atMs });
    console.log(`[Perf] ${this.session.key} ${label} @ ${atMs}ms`);
    if (label === "firstFrame" && !this.firstFrameLogged) {
      this.firstFrameLogged = true;
      this.logTotal();
      // Session stays open — rebuffers and fallbacks happen after firstFrame.
    }
  }

  /** Mid-play stall began (buffering after first frames). */
  rebufferStart() {
    if (!this.session || this.rebufferStartedAt != null) return;
    this.rebufferStartedAt = Date.now();
    this.session.rebufferCount += 1;
  }

  /** Mid-play stall ended. */
  rebufferEnd() {
    if (!this.session || this.rebufferStartedAt == null) return;
    this.session.stallMs += Date.now() - this.rebufferStartedAt;
    this.rebufferStartedAt = null;
  }

  /** An automatic source fallback occurred. */
  noteFallback() {
    if (!this.session) return;
    this.session.fallbackCount += 1;
  }

  /** Session over (player closed) — flush stall timer, log, archive. */
  close() {
    const s = this.session;
    if (!s) return;
    if (this.rebufferStartedAt != null) {
      s.stallMs += Date.now() - this.rebufferStartedAt;
      this.rebufferStartedAt = null;
    }
    RECENT.push(s);
    if (RECENT.length > MAX_SESSIONS) RECENT.shift();
    const ff = s.stages.find((x) => x.label === "firstFrame")?.atMs;
    console.log(
      `[Perf] ${s.key} END firstFrame=${ff ?? "—"}ms` +
        ` rebuffers=${s.rebufferCount}` +
        ` stallMs=${s.stallMs}` +
        ` fallbacks=${s.fallbackCount}` +
        ` durMs=${Date.now() - s.startedAt}`,
    );
    this.session = null;
  }

  private logTotal() {
    const s = this.session;
    if (!s) return;
    const links = s.stages.find((x) => x.label === "links")?.atMs;
    const player = s.stages.find((x) => x.label === "player")?.atMs;
    const ff = s.stages.find((x) => x.label === "firstFrame")?.atMs;
    console.log(
      `[Perf] ${s.key} TOTAL firstFrame=${ff}ms` +
        (links != null ? ` (links=${links}ms` : " (links=—") +
        (player != null ? `, player=${player}ms` : ", player=—") +
        `, decode=${ff != null && player != null ? ff - player : "—"}ms)`,
    );
  }

  /** In-memory recent sessions (debug overlay / future reporting). */
  static recent(): readonly PerfSession[] {
    return RECENT;
  }
}
