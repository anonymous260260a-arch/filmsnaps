/**
 * POST /api/telemetry — batched anonymous usage events from the mobile app.
 *
 * Privacy + safety:
 *  - Static header token (deterrent only; not user auth).
 *  - Kill-switch: TELEMETRY_ENABLED=0 → 204 + drop (no insert).
 *  - Same whitelist validation as the client scrub().
 *  - No IP access, no logging middleware on this route.
 *  - Per-request rate limit (simple in-memory counter, best-effort).
 */

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

const EVENT_DIMS: Record<string, readonly string[]> = {
  provider_fetch: [
    "providerId",
    "tmdbId",
    "mediaType",
    "outcome",
    "linkCountBucket",
    "fetchMs",
    "probeMs",
    "verdict",
    "capBucket",
    "chosenQualityBucket",
  ],
  watch_end: [
    "providerId",
    "mediaType",
    "tmdbId",
    "durationMs",
    "fallbacks",
    "switchedProvider",
    "intentToFirstFrameMs",
    "handoff",
    "eager",
    "prefAudioLang",
    "stallMs",
    "rebufferCount",
    "reachedFirstFrame",
    "gaveUp",
    "qualityBucket",
    "capBucket",
  ],
  provider_switch: ["from", "to", "reason"],
  app_launch: [
    "splashMs",
    "contentReadyMs",
    "reason",
    "prefAudioLang",
    "otaApplied",
  ],
  buffer_stall: [
    "positionMs",
    "durationMs",
    "providerId",
    "mediaType",
    "prefAudioLang",
  ],
  player_start: [
    "outcome",
    "intentToFirstFrameMs",
    "providerId",
    "mediaType",
    "prefAudioLang",
  ],
  player_error: [
    "errorClass",
    "surface",
    "providerId",
    "mediaType",
    "prefAudioLang",
  ],
  screen_view: ["screen"],
  search_performed: [
    "queryLengthBucket",
    "resultsCountBucket",
    "tookMs",
    "failed",
    "mediaType",
    "mode",
    "retriedAfterFail",
  ],
  session_end: ["durationMs", "eventCount", "providerSwitches", "prefAudioLang"],
  download_event: [
    "stage",
    "provider",
    "qualityBucket",
    "failureClass",
    "mediaType",
  ],
  feature_used: ["feature", "context"],
  network_speed: ["mbpsBucket", "connectionClass", "latencyBucket"],
  boundary_error: ["errorClass"],
};

const MAX_EVENTS = 50;
const MAX_DIMS = 24;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

// Best-effort in-process rate limit (per isolate). No IP keys.
let rateWindowStart = 0;
let rateCount = 0;

function getDB(): any | null {
  // D1 bindings are objects — OpenNext only copies *string* bindings onto
  // process.env, so read through the Cloudflare context instead.
  return (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
}

function rateLimited(): boolean {
  const now = Date.now();
  if (now - rateWindowStart > RATE_WINDOW_MS) {
    rateWindowStart = now;
    rateCount = 0;
  }
  rateCount += 1;
  return rateCount > RATE_MAX;
}

function sanitizeEvent(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const name = typeof e.name === "string" ? e.name : null;
  if (!name || !EVENT_DIMS[name]) return null;
  const allow = EVENT_DIMS[name];
  const ts = typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : null;
  if (ts == null) return null;

  const appVersion =
    typeof e.appVersion === "string" ? e.appVersion.slice(0, 32) : "0.0.0";
  const connectionClass =
    typeof e.connectionClass === "string"
      ? e.connectionClass.slice(0, 16)
      : "unknown";
  const deviceTier =
    typeof e.deviceTier === "string" ? e.deviceTier.slice(0, 16) : "unknown";

  const rawDims =
    e.dims && typeof e.dims === "object" ? (e.dims as Record<string, unknown>) : {};
  const dims: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const key of allow) {
    if (n >= MAX_DIMS) break;
    const v = rawDims[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      if (v.length > 128) continue;
      dims[key] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      dims[key] = v;
    } else if (typeof v === "boolean") {
      dims[key] = v;
    } else {
      continue;
    }
    n += 1;
  }

  return { name, ts, appVersion, connectionClass, deviceTier, dims };
}

export async function POST(req: Request) {
  // Kill-switch — accept and drop without touching D1.
  if (process.env.TELEMETRY_ENABLED === "0") {
    return new NextResponse(null, { status: 204 });
  }

  const token = process.env.TELEMETRY_INGEST_TOKEN;
  if (token) {
    const provided = req.headers.get("x-telemetry-token");
    if (provided !== token) {
      return new NextResponse(null, { status: 401 });
    }
  }

  if (rateLimited()) {
    return new NextResponse(null, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const eventsRaw = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) {
    return new NextResponse(null, { status: 400 });
  }

  const cleaned: Record<string, unknown>[] = [];
  for (const raw of eventsRaw.slice(0, MAX_EVENTS)) {
    const e = sanitizeEvent(raw);
    if (e) cleaned.push(e);
  }
  if (cleaned.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  const db = getDB();
  if (!db) {
    // D1 not bound — drop silently (never 500 on analytics).
    return new NextResponse(null, { status: 204 });
  }

  try {
    const stmt = db.prepare(
      `INSERT INTO telemetry_events
         (name, ts, app_version, connection_class, device_tier, dims_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const bound = cleaned.map((e) =>
      stmt.bind(
        e.name,
        e.ts,
        e.appVersion,
        e.connectionClass,
        e.deviceTier,
        JSON.stringify(e.dims),
      ),
    );
    await db.batch(bound);
  } catch {
    // Never surface analytics failures to the client.
  }

  return new NextResponse(null, { status: 204 });
}
