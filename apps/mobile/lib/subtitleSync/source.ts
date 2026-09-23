/**
 * Source model, gating, and window sizing for subtitle auto-sync.
 */

export type SourceKind = "local" | "remote" | "hls";

export type SourceRef = {
  contentId: string; // STABLE release/stream ID - cache & prefs key. NEVER the resolved URL.
  kind: SourceKind;
  container: "mp4" | "mkv" | "webm" | "mov" | "m4v" | "other";
  resolve: () => Promise<{ uri: string; headers?: Record<string, string> }>;
};

export type NetworkType = "wifi" | "cellular" | "none";

export type PlaylistInfo = {
  live: boolean;
  drmProtected: boolean;
  muxedOnly: boolean;
};

export type ProbeResponse =
  | { ok: true; live: boolean; drmProtected: boolean; muxedOnly: boolean }
  | { ok: false; code?: string; message?: string };

/**
 * Probe adapter: (uri, headers) => playlist info. Production default lazily
 * requires "./nativeProbe" (the only file that statically imports
 * "expo-subtitle-sync"); tests inject a mock so the native module never loads.
 */
export type ProbeAdapter = (
  uri: string,
  headers: Record<string, string>,
) => Promise<ProbeResponse>;

let probeAdapter: ProbeAdapter | null = null;

export function setProbeAdapter(adapter: ProbeAdapter | null): void {
  probeAdapter = adapter;
}

export function getProbeAdapter(): ProbeAdapter {
  if (probeAdapter) return probeAdapter;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./nativeProbe") as { probe: ProbeAdapter };
  probeAdapter = mod.probe;
  return probeAdapter;
}

export type CanAutoSyncResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "hls"
        | "live"
        | "dash"
        | "mkv-ios"
        | "drm"
        | "probe-fail"
        | "no-subtitles";
    };

export type WindowPlan = { earlySec: number; lateSec: number; speed: number };

/** Feature flag - HLS auto-sync rolls out behind this; off -> same gate as before. */
export const HLS_AUTO_SYNC_ENABLED = true;

/**
 * Detect the source kind from a resolved URI (+ optional content-type).
 * HLS (.m3u8) needs a whole separate extraction path, so it gets its own kind.
 */
export function detectKind(uri: string, contentType?: string): SourceKind {
  const u = uri.toLowerCase();
  const ct = (contentType ?? "").toLowerCase();
  if (u.includes(".m3u8") || ct.includes("mpegurl")) return "hls";
  return /^https?:/i.test(uri) ? "remote" : "local";
}

/**
 * Lazy native probe: inspect the m3u8 playlist (live/drm/muxed) once per
 * contentId, then cache. The probe adapter defaults to require("./nativeProbe")
 * - deliberately lazy so the pure-ts engine stays unit-testable; tests inject
 * a mock via setProbeAdapter().
 */
const probeCache = new Map<string, PlaylistInfo>();

export class ProbeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProbeError";
    this.code = code;
  }
}

export async function probeHls(source: SourceRef): Promise<PlaylistInfo> {
  const hit = probeCache.get(source.contentId);
  if (hit) return hit;
  const { uri, headers } = await source.resolve();
  const r = await getProbeAdapter()(uri, headers ?? {});
  if (!r.ok) {
    throw new ProbeError(
      r.code ?? "probe-fail",
      r.message ?? "playlist probe failed",
    );
  }
  const info: PlaylistInfo = {
    live: r.live,
    drmProtected: r.drmProtected,
    muxedOnly: r.muxedOnly,
  };
  probeCache.set(source.contentId, info);
  return info;
}

/** Test/runtime helper to reset the probe cache (e.g. between streams). */
export function clearProbeCache(): void {
  probeCache.clear();
}

/**
 * Gate auto-sync. HLS is now supported (behind HLS_AUTO_SYNC_ENABLED) but
 * needs a playlist probe: live and DRM'd streams are rejected with clean
 * reasons. DASH (.mpd) and iOS + MKV/WebM stay permanently out of scope.
 * Note this is async now (probe) - await it before extracting.
 */
export async function canAutoSync(
  source: SourceRef,
  platform: "android" | "ios",
): Promise<CanAutoSyncResult> {
  if (source.kind === "hls") {
    if (!HLS_AUTO_SYNC_ENABLED) return { ok: false, reason: "hls" };
    try {
      const info = await probeHls(source);
      if (info.live) return { ok: false, reason: "live" };
      if (info.drmProtected) return { ok: false, reason: "drm" };
      return { ok: true };
    } catch (e: any) {
      // Probe failure (expired URL, network, not m3u8) - don't attempt a scan.
      console.log(`[SubSync] hls probe failed: ${e?.code ?? e?.message}`);
      return { ok: false, reason: "probe-fail" };
    }
  }
  if (source.container === "mkv" || source.container === "webm") {
    if (platform === "ios") return { ok: false, reason: "mkv-ios" };
  }
  return { ok: true };
}

/**
 * Detect HLS/DASH from URI string.
 * Call this before constructing SourceRef (used by UI gating for `.mpd`).
 */
export function isHlsOrDash(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.includes(".m3u8") || lower.includes(".mpd");
}

/**
 * Scan window sizes + speed per source kind.
 *
 * Android-first speed model (2026-09 rework):
 *   - the headless scan player runs at 4x (Android media3 cap; the native
 *     scan jobs clamp 1..4, so 4x is the effective ceiling)
 *   - windows are sized for wall time: 240s @ 4x ~= 60s of waiting per window
 *   - MKV/WebM read clusters sequentially over HTTP and MP4 ranges freely -
 *     both get the same tight windows now; the late window only scans when
 *     the early window fails to reach usable confidence (see autoSync)
 *   - HLS muxed-only playlists (mp4/m4a segments) cap at 3x (segment fetch
 *     jitter dominates above that); tuned HLS takes 4x with 300s/180s windows
 *   - local files decode offline faster than realtime - generous windows, no speedup
 */
export async function windowPlan(
  source: SourceRef,
  network: NetworkType,
): Promise<WindowPlan> {
  if (source.kind === "hls") {
    let muxedOnly = false;
    try {
      muxedOnly = (await probeHls(source)).muxedOnly;
    } catch {
      muxedOnly = false;
    }
    if (muxedOnly) return { earlySec: 240, lateSec: 120, speed: 3 };
    return { earlySec: 300, lateSec: 180, speed: 4 };
  }
  if (source.kind === "local") return { earlySec: 900, lateSec: 480, speed: 1 };
  // Remote progressive (mp4/mkv/webm/mov/m4v): 4x cap, tight windows.
  return { earlySec: 240, lateSec: 120, speed: 4 };
}
