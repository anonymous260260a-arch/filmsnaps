/**
 * Sentry — crashes + ANRs only (no performance, no PII).
 *
 * Gating: init runs only after settings load AND analyticsEnabled AND
 * legalAccepted. Toggle off → closeAndDiscard + no re-init.
 *
 * beforeSend scrubber: strips URLs/breadcrumbs that touch stream/provider
 * endpoints and drops user/email/device fields — only exception type +
 * stack survive as-is.
 */

import Constants from "expo-constants";

let initialized = false;
let closed = false;

const STREAM_HOST_HINTS = [
  "vidsrc",
  "falix",
  "nxsha",
  "hdhub",
  "spacedom",
  "chillflix",
  "hls",
  "m3u8",
  "workers.dev",
  "tmdb",
  "imdb",
  "cloudflare",
  "speed.cloudflare",
];

function looksLikeEndpoint(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  return STREAM_HOST_HINTS.some((h) => lower.includes(h));
}

function scrubBreadcrumbs(crumbs: unknown): unknown {
  if (!Array.isArray(crumbs)) return [];
  return crumbs
    .map((c) => {
      if (!c || typeof c !== "object") return c;
      const b = { ...(c as Record<string, unknown>) };
      if (looksLikeEndpoint(b.message)) b.message = "[redacted:endpoint]";
      if (looksLikeEndpoint(b.category)) b.category = "[redacted]";
      if (b.data && typeof b.data === "object") {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(b.data as Record<string, unknown>)) {
          if (looksLikeEndpoint(v) || /url|href|endpoint/i.test(k)) {
            data[k] = "[redacted]";
          } else if (
            /email|user|device|idfa|gaid|adid|ip|session/i.test(k)
          ) {
            continue;
          } else {
            data[k] = v;
          }
        }
        b.data = data;
      }
      return b;
    })
    .filter(Boolean);
}

function scrubEvent(event: any): any {
  if (!event) return event;
  // Drop free-text / user fields entirely.
  if (event.user) delete event.user;
  if (event.tags) {
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(event.tags)) {
      if (/email|user|device|ip|session/i.test(k)) continue;
      tags[k] = String(v);
    }
    event.tags = tags;
  }
  if (event.extra) {
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.extra)) {
      if (/email|user|device|ip|session/i.test(k)) continue;
      if (looksLikeEndpoint(v)) continue;
      extra[k] = v;
    }
    event.extra = extra;
  }
  event.breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
  if (event.request) {
    // Keep method only — never URL/query/body.
    event.request = { method: event.request.method };
  }
  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      const ctx = event.contexts[key];
      if (ctx && typeof ctx === "object") {
        for (const k of Object.keys(ctx)) {
          if (/url|email|user|device|ip/i.test(k)) delete ctx[k];
        }
      }
    }
  }
  return event;
}

/**
 * Init crashes-only Sentry. Safe no-op when DSN missing, package not
 * installed, or gate closed. Idempotent.
 */
export function initSentryIfAllowed(opts: {
  legalAccepted: boolean;
  analyticsEnabled: boolean;
}): void {
  if (!opts.legalAccepted || !opts.analyticsEnabled) {
    if (initialized && !closed) {
      try {
        const Sentry = require("@sentry/react-native");
        Sentry.closeAndDiscard?.() ?? Sentry.close?.(2000);
      } catch {
        /* package may be absent */
      }
      closed = true;
      initialized = false;
    }
    return;
  }
  if (initialized) return;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/react-native");
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      enableAutoSessionTracking: false,
      attachStacktrace: true,
      release: Constants.expoConfig?.version
        ? `filmsnaps@${Constants.expoConfig.version}`
        : undefined,
      beforeSend: scrubEvent,
      beforeBreadcrumb: (bc: any) => {
        if (looksLikeEndpoint(bc?.message)) return null;
        if (looksLikeEndpoint(bc?.data?.url)) return null;
        return bc;
      },
    });
    initialized = true;
    closed = false;
    console.log("[Sentry] init (crashes-only)");
  } catch (e) {
    console.log("[Sentry] init skipped:", e instanceof Error ? e.message : e);
  }
}

/** Manual capture for the React ErrorBoundary (still scrubbed). */
export function captureAppError(error: unknown): void {
  if (!initialized) return;
  try {
    const Sentry = require("@sentry/react-native");
    Sentry.captureException(error);
  } catch {
    /* ignore */
  }
}
