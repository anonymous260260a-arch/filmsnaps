/**
 * watchPerf mismatch detector (FIX 3) — console-only.
 *
 * Tracks, per media base key (`tv:95350:s1:e1` — no provider suffix):
 *   - which provider the details page prefetched
 *   - which provider watch sync-resolved (+ tier)
 *   - async lastProvider flips
 *   - pipelines ready / in-flight / started for that base
 *   - which pipeline the player consumed vs discarded
 *
 * Emits `[watchperf] MISMATCH …` when (a) details ≠ watch resolve, or
 * (b) watch starts one provider while another for the same base is already
 * ready/in-flight. No behavior changes — logs only.
 */

export type WatchPerfTier =
  | "route"
  | "session"
  | "saved"
  | "last"
  | "default"
  | "unknown";

interface PipelineInfo {
  providerId: string;
  status: "inflight" | "ready" | "empty";
  trigger?: string;
  startedAt: number;
}

interface BaseState {
  detailsProvider?: string;
  watchSyncProvider?: string;
  watchSyncTier?: WatchPerfTier;
  asyncFlip?: { from: string; to: string; tier: WatchPerfTier };
  pipelines: Map<string, PipelineInfo>;
  consumed?: string;
  discarded: Set<string>;
  mismatchLogged?: boolean;
}

const BASES = new Map<string, BaseState>();
const MAX_BASES = 32;

function baseKey(mediaType: string, tmdbId: number | string, season?: number, episode?: number): string {
  return `${mediaType}:${tmdbId}:s${season ?? 0}:e${episode ?? 0}`;
}

function getBase(key: string): BaseState {
  let b = BASES.get(key);
  if (!b) {
    if (BASES.size >= MAX_BASES) {
      const first = BASES.keys().next().value;
      if (first !== undefined) BASES.delete(first);
    }
    b = { pipelines: new Map(), discarded: new Set() };
    BASES.set(key, b);
  }
  return b;
}

function formatMismatch(b: BaseState, extra: string): string {
  const parts = [
    `details=${b.detailsProvider ?? "—"}`,
    `watch=${b.watchSyncProvider ?? "—"}`,
    `consumed=${b.consumed ?? "—"}`,
    `discarded=${[...b.discarded].join("+") || "—"}`,
  ];
  if (b.watchSyncTier) parts.push(`tier=${b.watchSyncTier}`);
  if (b.asyncFlip) {
    parts.push(`flip=${b.asyncFlip.from}→${b.asyncFlip.to}(${b.asyncFlip.tier})`);
  }
  if (extra) parts.push(extra);
  return `[watchperf] MISMATCH ${parts.join(" ")}`;
}

function maybeLogMismatch(key: string, b: BaseState, extra: string): void {
  // (a) details prefetched a different provider than watch sync-resolved
  const resolveMismatch =
    b.detailsProvider &&
    b.watchSyncProvider &&
    b.detailsProvider !== b.watchSyncProvider;
  // (b) at least two pipelines for this base (ready or in-flight)
  const active = [...b.pipelines.values()].filter(
    (p) => p.status === "ready" || p.status === "inflight",
  );
  const multi = active.length >= 2;
  if (!resolveMismatch && !multi) return;
  if (b.mismatchLogged && !multi) return;
  // Log once per base for resolve mismatch; multi can re-log on new starts.
  if (resolveMismatch && !b.mismatchLogged) {
    b.mismatchLogged = true;
    console.log(formatMismatch(b, extra));
    return;
  }
  if (multi) console.log(formatMismatch(b, extra));
}

/** Details page started a prefetch for this media (trigger=details). */
export function noteDetailsPrefetch(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  season: number | undefined,
  episode: number | undefined,
  providerId: string,
): void {
  const b = getBase(baseKey(mediaType, tmdbId, season, episode));
  b.detailsProvider = providerId;
  const p = b.pipelines.get(providerId);
  if (p) {
    p.trigger = p.trigger ?? "details";
  } else {
    b.pipelines.set(providerId, {
      providerId,
      status: "inflight",
      trigger: "details",
      startedAt: Date.now(),
    });
  }
}

/** Watch route's first sync resolve. */
export function noteWatchSyncResolve(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  season: number | undefined,
  episode: number | undefined,
  providerId: string,
  tier: WatchPerfTier,
): void {
  const b = getBase(baseKey(mediaType, tmdbId, season, episode));
  b.watchSyncProvider = providerId;
  b.watchSyncTier = tier;
  maybeLogMismatch(baseKey(mediaType, tmdbId, season, episode), b, "at=syncResolve");
}

/** Async lastProvider re-resolve flipped the active provider after sync. */
export function noteProviderAsyncFlip(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  season: number | undefined,
  episode: number | undefined,
  from: string,
  to: string,
  tier: WatchPerfTier,
): void {
  const b = getBase(baseKey(mediaType, tmdbId, season, episode));
  b.asyncFlip = { from, to, tier };
  if (from && from !== to) b.discarded.add(from);
  console.log(
    `[watchperf] ASYNC_FLIP ${baseKey(mediaType, tmdbId, season, episode)} ${from}→${to} tier=${tier}`,
  );
}

/** A pipeline for this base started (START or join). */
export function notePipelineStart(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  season: number | undefined,
  episode: number | undefined,
  providerId: string,
  trigger: string | undefined,
  mode: "start" | "join",
): void {
  const key = baseKey(mediaType, tmdbId, season, episode);
  const b = getBase(key);
  const existing = b.pipelines.get(providerId);
  if (mode === "join" && existing) {
    existing.status = existing.status === "ready" ? "ready" : "inflight";
  } else {
    b.pipelines.set(providerId, {
      providerId,
      status: "inflight",
      trigger,
      startedAt: Date.now(),
    });
  }
  const others = [...b.pipelines.values()].filter(
    (p) =>
      p.providerId !== providerId &&
      (p.status === "ready" || p.status === "inflight"),
  );
  if (others.length > 0) {
    const discarded = others.map((o) => o.providerId).join("+");
    maybeLogMismatch(
      key,
      b,
      `start=${providerId}(${mode},${trigger ?? "?"}) other=${discarded}`,
    );
    // Always log the parallel-start case even if resolve already matched.
    if (!b.mismatchLogged) {
      b.mismatchLogged = true;
      console.log(formatMismatch(b, `start=${providerId}(${mode},${trigger ?? "?"}) parallel=${discarded}`));
    } else {
      console.log(
        `[watchperf] MISMATCH_PARALLEL ${key} start=${providerId} parallel=${discarded} consumed=${b.consumed ?? "—"}`,
      );
    }
  }
}

/** Pipeline settled for this base. */
export function notePipelineSettled(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  season: number | undefined,
  episode: number | undefined,
  providerId: string,
  ok: boolean,
): void {
  const b = getBase(baseKey(mediaType, tmdbId, season, episode));
  const p = b.pipelines.get(providerId);
  if (p) p.status = ok ? "ready" : "empty";
  else {
    b.pipelines.set(providerId, {
      providerId,
      status: ok ? "ready" : "empty",
      startedAt: Date.now(),
    });
  }
}

/** The player consumed links tagged with this provider. */
export function noteConsumed(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  season: number | undefined,
  episode: number | undefined,
  providerId: string | undefined,
): void {
  if (!providerId) return;
  const key = baseKey(mediaType, tmdbId, season, episode);
  const b = getBase(key);
  const prev = b.consumed;
  b.consumed = providerId;
  if (prev && prev !== providerId) b.discarded.add(prev);
  for (const [pid, p] of b.pipelines) {
    if (pid !== providerId && (p.status === "ready" || p.status === "inflight")) {
      b.discarded.add(pid);
    }
  }
}

/** Clear state for a media key (optional hygiene when leaving watch). */
export function resetWatchPerfMismatch(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  season?: number,
  episode?: number,
): void {
  BASES.delete(baseKey(mediaType, tmdbId, season, episode));
}
