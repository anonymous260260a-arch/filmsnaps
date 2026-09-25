/**
 * perfMetrics — intent→first-frame instrumentation + session health.
 *
 * One watch INTENT = one PerfSession (route entry), not one player source.
 * Source switches (dead head → candidate #1) keep the same session — only
 * player unmount/back closes it. Marks (ms from session start):
 *   intentTap          → Watch/CW/entry press (opens the session)
 *   watchEntry         → watch route mounted
 *   providerSyncResolve→ first sync provider resolve (+ tier)
 *   providerAsyncFlip  → async lastProvider re-resolve changed provider
 *   handoff            → details streamUrl/snapshot handoff used?
 *   pipelineFeed       → pipeline that feeds the player (hit|join|start, ageMs)
 *   tap / hevcMounted  → HevcPlayer first render (tap kept for older lines)
 *   links              → links present at mount (legacy)
 *   linksSet           → links landed in player/pipeline state
 *   player             → native player constructed
 *   sourceSet          → URL applied to the video player instance
 *   playerReady        → expo-video statusChange → readyToPlay
 *   firstFrame         → FIRST timeUpdate with time > 0 on ANY source
 *
 * Per-source open timings live in sourceSegments (src0/src1/…); fallbacks
 * counts auto source switches. close() prints one [watchperf] summary with
 * segment deltas + fallbacks + per-source line + real intent→firstFrame
 * TOTAL, then the existing [Perf] END line. Console-only — no UI changes.
 * Phase 4 T2: close() also emits watch_end (gated telemetry).
 */

import { resolveCapBucket, trackPlayerStart, trackWatchEnd } from "./telemetry";
import { bucketQuality } from "./telemetry/types";

/** Parse "movie:123" / "tv:456:s1e2" session keys for watch_end dims. */
function parseSessionKey(
  key: string,
): { mediaType: "movie" | "tv"; tmdbId: number } | null {
  const m = /^(movie|tv):(\d+)/.exec(key);
  if (!m) return null;
  return { mediaType: m[1] as "movie" | "tv", tmdbId: Number(m[2]) };
}

export type PerfStageLabel =
  | "intentTap"
  | "detailsTap"
  | "watchEntry"
  | "providerSyncResolve"
  | "providerAsyncFlip"
  | "handoff"
  | "pipelineFeed"
  | "tap"
  | "hevcMounted"
  | "links"
  | "linksSet"
  | "player"
  | "sourceSet"
  | "playerReady"
  | "firstFrame";

/** How a per-source segment ended (open = still playing / last source). */
export type SourceOutcome =
  | "open"
  | "dead"
  | "timeout"
  | "error"
  | "user"
  | "switch"
  | "ended"
  | "closed";

/** One applied source within the watch intent (E1 — survives switches). */
export interface SourceSegment {
  /** Link index when this source was opened. */
  linkIndex: number;
  /** ms from session start when this source was applied. */
  openAtMs: number;
  /** ms from session start when this source ended (unset = still open). */
  closeAtMs?: number;
  outcome?: SourceOutcome;
  /** First frame landed while THIS source was active. */
  framed?: boolean;
  quality?: string;
}

export interface PerfStage {
  label: PerfStageLabel;
  /** ms from session start */
  atMs: number;
  /** Optional structured payload (provider, tier, mode, …). */
  data?: Record<string, string | number | boolean | null | undefined>;
}

export interface PerfSession {
  key: string;
  startedAt: number;
  stages: PerfStage[];
  /** Mid-play stalls (buffering that started after first frames). */
  rebufferCount: number;
  /** Total time spent stalled, ms. */
  stallMs: number;
  /** Automatic source fallbacks this session (switch count). */
  fallbackCount: number;
  /** Per-source open/close timings — one entry per applied source (E1). */
  sourceSegments: SourceSegment[];
  /** Absolute epoch when watchEntry landed (pipelineFeed ageMs). */
  watchEntryAt?: number;
  /** Summary context (FIX 1/5) — filled as marks land. */
  handoff?: "used" | "none";
  provider?: string;
  codec?: string;
  container?: string;
  /** E2 eager handoff verdict for watch_end telemetry. */
  bestValidated?: boolean;
}

const RECENT: PerfSession[] = [];
const MAX_SESSIONS = 12;

/** Session started on details/CW Watch press, adopted by the player on mount. */
let pendingSession: PerfSessionTracker | null = null;
/** Session currently owned by a mounted player (set on adopt/create). */
let activeSession: PerfSessionTracker | null = null;

/** HevcPlayer registers its tracker here so non-component marks can reach it. */
export function setActivePerfSession(t: PerfSessionTracker | null): void {
  activeSession = t;
}

/** Mark on the active player session and/or the still-pending entry session. */
export function markPerfStage(
  label: PerfStageLabel,
  data?: PerfStage["data"],
): void {
  activeSession?.mark(label, data);
  if (pendingSession !== activeSession) pendingSession?.mark(label, data);
}

/** Context for the active (or pending) session summary — FIX 1/5. */
export function setPerfContext(
  partial: Pick<
    PerfSession,
    "handoff" | "provider" | "codec" | "container" | "bestValidated"
  >,
): void {
  activeSession?.setContext(partial);
  pendingSession?.setContext(partial);
}

/** E1: open a per-source segment on the active session (source applied). */
export function noteSourceSegmentOpen(
  linkIndex: number,
  quality?: string,
): void {
  activeSession?.noteSourceSegmentOpen(linkIndex, quality);
}

/** E1: close the open per-source segment with an outcome (switch/dead/…). */
export function noteSourceSegmentEnd(outcome: SourceOutcome): void {
  activeSession?.noteSourceSegmentEnd(outcome);
}

/**
 * Intent mark for EVERY entry path (details Watch, CW card, direct entry).
 * Opens the session before the player tree mounts. First mark = intentTap
 * (legacy label detailsTap is still accepted if already stamped).
 */
export function beginIntentTap(key: string): void {
  pendingSession?.close();
  pendingSession = new PerfSessionTracker(key, "intentTap");
}

/** @deprecated use beginIntentTap — kept so existing call sites stay valid. */
export function beginDetailsTap(key: string): void {
  beginIntentTap(key);
}

/** Watch route entered — stamp watchEntry on the pending (or no-op) session. */
export function markWatchEntry(): void {
  pendingSession?.mark("watchEntry");
}

/** Stamp a stage on the still-pending session (watch route, pre-mount). */
export function markPendingStage(
  label: PerfStageLabel,
  data?: PerfStage["data"],
): void {
  pendingSession?.mark(label, data);
}

/**
 * Player mount: adopt the details-started session when the key matches,
 * otherwise null (caller constructs a fresh tracker).
 */
export function adoptPendingSession(key: string): PerfSessionTracker | null {
  if (pendingSession && pendingSession.key === key) {
    const s = pendingSession;
    pendingSession = null;
    return s;
  }
  return null;
}

export class PerfSessionTracker {
  private session: PerfSession | null = null;
  private rebufferStartedAt: number | null = null;
  private firstFrameLogged = false;
  /** Outcome to stamp on the open segment when the next source opens. */
  private pendingSegmentOutcome: SourceOutcome | null = null;
  /**
   * P1 — true when the session ended without ever reaching a first frame
   * because the chain exhausted (all sources dead/errored). Drives the
   * player_start outcome in close().
   */
  private erroredOut = false;

  readonly key: string;

  constructor(key: string, firstMark: PerfStageLabel = "tap") {
    this.key = key;
    this.session = {
      key,
      startedAt: Date.now(),
      stages: [],
      rebufferCount: 0,
      stallMs: 0,
      fallbackCount: 0,
      sourceSegments: [],
    };
    this.mark(firstMark);
  }

  mark(label: PerfStageLabel, data?: PerfStage["data"]) {
    if (!this.session) return;
    // Source-independent marks fire once per intent. sourceSet/playerReady/
    // firstFrame are also once-per-intent (first source wins for firstFrame);
    // per-source open timings live in sourceSegments instead.
    if (this.session.stages.some((s) => s.label === label)) return;
    const atMs = Date.now() - this.session.startedAt;
    const enriched: PerfStage["data"] = { ...data };
    if (label === "watchEntry") this.session.watchEntryAt = Date.now();
    if (label === "pipelineFeed" && typeof data?.startedAt === "number") {
      // ageMs = how long before watchEntry the pipeline began (+ = prefetch lead).
      const entryAt = this.session.watchEntryAt;
      if (entryAt != null) {
        enriched.ageMs = entryAt - data.startedAt;
      } else {
        enriched.ageMs = this.session.startedAt - data.startedAt;
      }
    }
    this.session.stages.push({ label, atMs, data: enriched });
    console.log(`[Perf] ${this.session.key} ${label} @ ${atMs}ms`, enriched);
    this.absorbContext(label, enriched);
    if (label === "firstFrame" && !this.firstFrameLogged) {
      this.firstFrameLogged = true;
      // Attribute the frame to whichever source segment is still open.
      const open = this.openSegment();
      if (open) open.framed = true;
      this.logTotal();
      // Session stays open — rebuffers and fallbacks happen after firstFrame.
    }
  }

  /**
   * E1: a new source URL was applied. Closes any still-open prior segment
   * (with the pending outcome, e.g. dead/timeout) and opens a fresh one.
   */
  noteSourceSegmentOpen(linkIndex: number, quality?: string): void {
    const s = this.session;
    if (!s) return;
    const prev = this.openSegment();
    if (prev) {
      prev.closeAtMs = Date.now() - s.startedAt;
      prev.outcome = this.pendingSegmentOutcome ?? "switch";
      this.pendingSegmentOutcome = null;
    }
    s.sourceSegments.push({
      linkIndex,
      openAtMs: Date.now() - s.startedAt,
      outcome: "open",
      quality,
    });
    console.log(
      `[Perf] ${s.key} src${s.sourceSegments.length - 1} open @ ${
        s.sourceSegments[s.sourceSegments.length - 1].openAtMs
      }ms link#${linkIndex}${quality ? ` ${quality}` : ""}`,
    );
  }

  /**
   * E1: why the current source is about to go away. Stamped on the open
   * segment when the next source opens (or at close() if none follows).
   */
  noteSourceSegmentEnd(outcome: SourceOutcome): void {
    this.pendingSegmentOutcome = outcome;
    // If no further source opens (player closing), flush immediately.
    if (outcome === "ended") this.flushOpenSegment("ended");
  }

  /** An automatic source fallback occurred (E1: switch count). */
  noteFallback() {
    if (!this.session) return;
    this.session.fallbackCount += 1;
  }

  private openSegment(): SourceSegment | undefined {
    const segs = this.session?.sourceSegments;
    if (!segs || segs.length === 0) return undefined;
    const last = segs[segs.length - 1];
    return last.closeAtMs == null ? last : undefined;
  }

  private flushOpenSegment(fallback: SourceOutcome): void {
    const s = this.session;
    const open = this.openSegment();
    if (!s || !open) return;
    open.closeAtMs = Date.now() - s.startedAt;
    open.outcome = this.pendingSegmentOutcome ?? fallback;
    this.pendingSegmentOutcome = null;
  }

  /** Handoff/provider/codec context for the close() summary (no stage). */
  setContext(
    partial: Pick<
      PerfSession,
      "handoff" | "provider" | "codec" | "container" | "bestValidated"
    >,
  ) {
    if (!this.session) return;
    if (partial.handoff !== undefined) this.session.handoff = partial.handoff;
    if (partial.provider !== undefined) this.session.provider = partial.provider;
    if (partial.codec !== undefined) this.session.codec = partial.codec;
    if (partial.container !== undefined) this.session.container = partial.container;
    if (partial.bestValidated !== undefined)
      this.session.bestValidated = partial.bestValidated;
  }

  private absorbContext(label: PerfStageLabel, data?: PerfStage["data"]) {
    if (!this.session || !data) return;
    if (label === "handoff" && typeof data.used === "boolean") {
      this.session.handoff = data.used ? "used" : "none";
    }
    if (label === "providerSyncResolve" && typeof data.providerId === "string") {
      this.session.provider = data.providerId;
    }
    if (label === "providerAsyncFlip" && typeof data.to === "string") {
      this.session.provider = data.to;
    }
    if (typeof data.provider === "string") this.session.provider = data.provider;
    if (typeof data.codec === "string") this.session.codec = data.codec;
    if (typeof data.container === "string") this.session.container = data.container;
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

  /**
   * P1 — record that this attempt ended in exhaustion (no first frame) so
   * close() can emit the player_start outcome correctly.
   */
  noteFailed() {
    if (this.session?.stages.some((s) => s.label === "firstFrame")) return;
    this.erroredOut = true;
  }

  /**
   * Session over (player closed / back) — flush stall + open source segment,
   * print [watchperf] + END, archive. NEVER called on a source switch.
   */
  close() {
    const s = this.session;
    if (!s) return;
    if (this.rebufferStartedAt != null) {
      s.stallMs += Date.now() - this.rebufferStartedAt;
      this.rebufferStartedAt = null;
    }
    this.flushOpenSegment("closed");
    this.logWatchPerf(s);
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
    this.emitWatchEnd(s, ff);
    this.emitPlayerStart(s, ff);
    this.session = null;
  }

  /** Phase 4 T2 + E1 — watch_end at session close (whitelisted dims only). */
  private emitWatchEnd(s: PerfSession, firstFrameMs: number | undefined): void {
    const parsed = parseSessionKey(s.key);
    if (!parsed) return;
    const eager: "verified" | "unverified" | "none" =
      s.bestValidated === true
        ? "verified"
        : s.bestValidated === false
          ? "unverified"
          : "none";

    // E1 — the segment that actually framed (if any) sets the qualityBucket;
    // otherwise fall back to the last attempted source's tier.
    const framed = s.sourceSegments.find((seg) => seg.framed);
    const quality = framed?.quality ?? s.sourceSegments[s.sourceSegments.length - 1]?.quality;

    const base = {
      providerId: s.provider ?? "unknown",
      mediaType: parsed.mediaType,
      tmdbId: parsed.tmdbId,
      durationMs: Date.now() - s.startedAt,
      fallbacks: s.fallbackCount,
      switchedProvider: s.fallbackCount > 0,
      intentToFirstFrameMs: firstFrameMs ?? Date.now() - s.startedAt,
      handoff: s.handoff ?? "none",
      eager,
      stallMs: s.stallMs,
      rebufferCount: s.rebufferCount,
      reachedFirstFrame: firstFrameMs != null,
      gaveUp: firstFrameMs == null && !this.erroredOut,
      qualityBucket: bucketQuality(quality),
    } as const;

    // E3 — resolve the connection cap the same way the selector does.
    void resolveCapBucket().then((capBucket) => {
      trackWatchEnd({ ...base, capBucket });
    }).catch(() => {
      trackWatchEnd(base);
    });
  }

  /** P1 — player_start (whether the watch intent produced a frame). */
  private emitPlayerStart(s: PerfSession, firstFrameMs: number | undefined): void {
    const parsed = parseSessionKey(s.key);
    if (!parsed) return;
    const outcome = firstFrameMs != null
      ? "first_frame"
      : this.erroredOut
        ? "error"
        : "gave_up";
    trackPlayerStart({
      outcome,
      intentToFirstFrameMs: firstFrameMs ?? Date.now() - s.startedAt,
      providerId: s.provider ?? "unknown",
      mediaType: parsed.mediaType,
    });
  }

  private at(s: PerfSession, label: PerfStageLabel): number | undefined {
    return s.stages.find((x) => x.label === label)?.atMs;
  }

  private delta(from: number | undefined, to: number | undefined): string {
    if (from == null || to == null) return "—";
    return String(to - from);
  }

  /**
   * FIX 1 summary — one line with segment deltas + FIX 5 codec/container.
   * Stage → segment mapping (missing stages print —):
   *   intent→entry  intentTap → watchEntry
   *   entry→feed    watchEntry → pipelineFeed
   *   feed→ready    pipelineFeed → linksSet (links landed)
   *   ready→mount   linksSet → hevcMounted (or legacy tap)
   *   mount→src     hevcMounted → sourceSet
   *   src→vready    sourceSet → playerReady
   *   vready→frame  playerReady → firstFrame
   * E1 also appends fallbacks=N + per-source segments (src0=… src1=…) and
   * the real intent→firstFrame TOTAL spanning every source switch.
   */
  private logWatchPerf(s: PerfSession) {
    const intent =
      this.at(s, "intentTap") ?? this.at(s, "detailsTap") ?? this.at(s, "watchEntry");
    const entry = this.at(s, "watchEntry");
    const feed = this.at(s, "pipelineFeed");
    const ready = this.at(s, "linksSet") ?? this.at(s, "links");
    const mount = this.at(s, "hevcMounted") ?? this.at(s, "tap");
    const src = this.at(s, "sourceSet");
    const vready = this.at(s, "playerReady") ?? this.at(s, "player");
    const frame = this.at(s, "firstFrame");
    const total = frame ?? Date.now() - s.startedAt;
    const srcLine = s.sourceSegments
      .map((seg, i) => {
        const status = seg.closeAtMs != null ? (seg.outcome ?? "closed") : "open";
        const t = seg.closeAtMs ?? seg.openAtMs;
        return `src${i}=${status}@${t}ms`;
      })
      .join(" ");
    // frame=+Xms — firstFrame relative to the segment that delivered it.
    const framedSeg = s.sourceSegments.find((g) => g.framed);
    const frameRel =
      frame != null && framedSeg != null
        ? ` frame=+${Math.max(0, frame - framedSeg.openAtMs)}ms`
        : "";
    console.log(
      `[watchperf] ${s.key}` +
        ` intent→entry=${this.delta(intent, entry)}` +
        ` entry→feed=${this.delta(entry, feed)}` +
        ` feed→ready=${this.delta(feed, ready)}` +
        ` ready→mount=${this.delta(ready, mount)}` +
        ` mount→src=${this.delta(mount, src)}` +
        ` src→vready=${this.delta(src, vready)}` +
        ` vready→frame=${this.delta(vready, frame)}` +
        ` TOTAL=${total}` +
        ` fallbacks=${s.fallbackCount}` +
        (srcLine ? ` ${srcLine}` : "") +
        frameRel +
        ` handoff=${s.handoff ?? "none"}` +
        ` provider=${s.provider ?? "—"}` +
        ` codec=${s.codec ?? "—"}` +
        ` container=${s.container ?? "—"}`,
    );
  }

  private logTotal() {
    const s = this.session;
    if (!s) return;
    const links = s.stages.find((x) => x.label === "links")?.atMs
      ?? s.stages.find((x) => x.label === "linksSet")?.atMs;
    const player = s.stages.find((x) => x.label === "player")?.atMs;
    const ff = s.stages.find((x) => x.label === "firstFrame")?.atMs;
    // E1: after a source switch the session is the SAME — links/player/firstFrame
    // all stay populated; fallbacks + open segment give the switch context.
    const openSeg = s.sourceSegments.find((g) => g.closeAtMs == null)
      ?? s.sourceSegments[s.sourceSegments.length - 1];
    const segNote = openSeg
      ? ` src${s.sourceSegments.indexOf(openSeg)}@${openSeg.openAtMs}ms`
      : "";
    console.log(
      `[Perf] ${s.key} TOTAL firstFrame=${ff ?? "—"}ms` +
        (links != null ? ` (links=${links}ms` : " (links=—") +
        (player != null ? `, player=${player}ms` : ", player=—") +
        `, decode=${ff != null && player != null ? ff - player : "—"}ms` +
        ` fallbacks=${s.fallbackCount}${segNote})`,
    );
  }

  /** In-memory recent sessions (debug overlay / future reporting). */
  static recent(): readonly PerfSession[] {
    return RECENT;
  }
}
