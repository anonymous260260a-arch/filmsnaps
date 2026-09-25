/**
 * detailMetrics — movie/TV detail open timing (launchMetrics pattern).
 *
 * One summary line per detail open:
 *   [detail] type=movie firstFrame=Xms content=Yms source=home
 *   [detail] payload bytes=N
 *
 * Times are ms from beginDetail() (called when the screen mounts).
 *
 * FIX 6: globalThis payload bridge is registered at MODULE SCOPE so any
 * fetch (including tap-time prefetch) can log before the detail screen mounts.
 */

export type DetailType = "movie" | "tv";
export type DetailSource =
  | "home"
  | "cw"
  | "search"
  | "similar"
  | "history"
  | "list"
  | "saved"
  | "person"
  | "library"
  | "unknown";

interface DetailSession {
  type: DetailType;
  id: string;
  source: DetailSource;
  t0: number;
  firstFrameMs?: number;
  contentMs?: number;
  payloadBytes?: number;
  loggedFrame?: boolean;
  loggedContent?: boolean;
  loggedPayload?: boolean;
}

let pendingSource: DetailSource = "unknown";
let session: DetailSession | null = null;

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Call at the navigation site, immediately before nav.push to detail. */
export function markDetailNav(source: DetailSource): void {
  pendingSource = source;
}

function takeSource(): DetailSource {
  const s = pendingSource;
  pendingSource = "unknown";
  return s;
}

/** Call once when the detail screen mounts (before/with first render). */
export function beginDetail(type: DetailType, id: string): void {
  session = {
    type,
    id,
    source: takeSource(),
    t0: now(),
  };
  console.log(
    `[detail] open type=${type} id=${id} source=${session.source} t0=${Math.round(session.t0)}`,
  );
}

/** Call from screen root onLayout (first frame of real content, not skeleton). */
export function markDetailFirstFrame(): void {
  if (!session || session.firstFrameMs !== undefined) return;
  session.firstFrameMs = Math.round(now() - session.t0);
  console.log(`[detail] firstFrame=${session.firstFrameMs}ms type=${session.type}`);
  maybeLogSummary(session);
}

/** Call when the primary details query settles (data present or error). */
export function markDetailContentReady(): void {
  if (!session || session.contentMs !== undefined) return;
  session.contentMs = Math.round(now() - session.t0);
  console.log(`[detail] contentReady=${session.contentMs}ms type=${session.type}`);
  maybeLogSummary(session);
}

/** Raw response size for the details call (from fetchJson). */
export function markDetailPayloadBytes(bytes: number): void {
  // Always log — prefetch often finishes before the detail screen mounts.
  console.log(`[detail] payload bytes=${bytes}`);
  if (!session || session.loggedPayload) return;
  session.payloadBytes = bytes;
  session.loggedPayload = true;
}

function maybeLogSummary(s: DetailSession): void {
  if (s.loggedFrame && s.loggedContent) return;
  if (s.firstFrameMs === undefined || s.contentMs === undefined) return;
  s.loggedFrame = true;
  s.loggedContent = true;
  console.log(
    `[detail] type=${s.type} firstFrame=${s.firstFrameMs}ms content=${s.contentMs}ms source=${s.source}`,
  );
}

/** Test/dev helper. */
export function __resetDetailMetrics(): void {
  session = null;
  pendingSource = "unknown";
}

// Module-scope bridge: shared fetchJson → payload size log (FIX 6).
(globalThis as unknown as { __markDetailPayloadBytes?: (n: number) => void }).__markDetailPayloadBytes =
  markDetailPayloadBytes;
