/**
 * [EXPERIMENTAL] CDN Diagnostic Logger
 *
 * Captures what Chromium actually sends to CDN domains (headers, cookies,
 * Sec-Fetch-*, User-Agent, etc.) via webRequest.onBeforeSendHeaders.
 *
 * PURPOSE: Identify why direct stream URLs return 403 when proxied through
 * Python but work in the browser. The hypothesis is TLS fingerprinting
 * (JA3/JA4) + missing Sec-Fetch-* headers + cookie requirements.
 *
 * ACTIVATION: Set FILMSNAPS_LOG=cdn or FILMSNAPS_LOG=* env var.
 *   The CDN logger activates only when FILMSNAPS_CDN_DIAG=1 is also set.
 *
 * ROLLBACK: Delete this file, remove import + startCdnDiagnostic() call
 * from main.ts. No other files reference this module.
 *
 * Date: 2026-09-03
 */

import { session, Session } from "electron";
import { cdn } from "../lib/log";

/** CDN domains to monitor. Add more as needed. */
const CDN_DOMAINS = [
  "*://*.itsnitrox.tech/*",
  "*://*.workers.dev/*",
  "*://*.flocw.com/*",
  "*://*.klcxm.com/*",
  "*://*.gigle432ski.com/*",
  "*://*.kkphimplayer7.com/*",
  "*://*.aoneroom.com/*",
  "*://*.joinformembers.com/*",
  "*://*.mz2d97.com/*",
  "*://*.pages.dev/*",
  "*://*.screenscape.me/*",
  "*://*.videasy.net/*",
  "*://*.vidfast.pro/*",
  "*://*.vidnest.fun/*",
  "*://*.moviesapi.to/*",
  "*://*.111movies.net/*",
  "*://*.vidzee.wtf/*",
];

/** Tracks cookies set by CDN domains */
const cookieStore: Record<string, string[]> = {};

export function startCdnDiagnostic(sess?: Session): void {
  // Install on BOTH defaultSession AND the provider partition
  // so we capture requests regardless of which session makes them.
  const sessions = sess
    ? [sess]
    : [
        session.defaultSession,
        session.fromPartition("persist:filmsnaps-provider"),
      ];

  for (const s of sessions) {
    installListeners(s);
  }
}

function installListeners(sess: Session): void {
  const filter = { urls: CDN_DOMAINS };

  // ── OUTGOING: Log every header Chromium sends to CDN domains ──
  sess.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const h = details.requestHeaders;
    const host = (() => {
      try {
        return new URL(details.url).hostname;
      } catch {
        return details.url;
      }
    })();

    // Log full header dump for stream-like requests (.m3u8, .ts, .mpd, .mp4)
    const isStream = /\.(m3u8|ts|mpd|mp4|mkv|webm|txt)(\?|$)/i.test(
      details.url,
    );
    if (isStream) {
      cdn.log(`▶ STREAM REQUEST: ${details.method} ${details.url}`);
      cdn.log(`  Resource type: ${details.resourceType}`);
      cdn.log(`  All request headers:`);
      for (const [key, val] of Object.entries(h)) {
        cdn.log(`    ${key}: ${val}`);
      }
      // Highlight Sec-Fetch-* specifically
      const secFetch = Object.entries(h)
        .filter(([k]) => k.toLowerCase().startsWith("sec-fetch"))
        .map(([k, v]) => `${k}=${v}`);
      if (secFetch.length) {
        cdn.log(`  Sec-Fetch headers: ${secFetch.join(", ")}`);
      } else {
        cdn.warn(`  NO Sec-Fetch headers found`);
      }
    } else {
      // Non-stream requests: one-line summary
      cdn.log(`▶ ${details.method} ${host} (${details.resourceType})`);
    }

    callback({ requestHeaders: h });
  });

  // ── INCOMING: Capture Set-Cookie from CDN domains ──
  sess.webRequest.onHeadersReceived(filter, (details, callback) => {
    const respHeaders = details.responseHeaders || {};
    const host = (() => {
      try {
        return new URL(details.url).hostname;
      } catch {
        return details.url;
      }
    })();

    // Capture Set-Cookie
    const setCookie = respHeaders["set-cookie"] || respHeaders["Set-Cookie"];
    if (setCookie && setCookie.length) {
      if (!cookieStore[host]) cookieStore[host] = [];
      cookieStore[host].push(...setCookie);
      cdn.log(`◀ SET-COOKIE from ${host}:`);
      for (const c of setCookie) {
        cdn.log(`  ${c.substring(0, 120)}`);
      }
    }

    // Log response status for stream requests
    const isStream = /\.(m3u8|ts|mpd|mp4|mkv|webm|txt)(\?|$)/i.test(
      details.url,
    );
    if (isStream) {
      cdn.log(`◀ RESPONSE ${details.method} ${details.url}`);
      cdn.log(`  Status: ${details.statusCode}`);
      // Log security-relevant response headers
      for (const key of [
        "server",
        "x-powered-by",
        "cf-ray",
        "cf-cache-status",
        "x-cache",
      ]) {
        const val = respHeaders[key];
        if (val) cdn.log(`  ${key}: ${val}`);
      }
    }

    callback({});
  });

  cdn.log("Diagnostic logger started — monitoring CDN domains");
  cdn.log("Play a video in the provider view to see header dumps");
}

/** Dump all captured cookies (call from IPC or devtools) */
export function dumpCookieStore(): Record<string, string[]> {
  return { ...cookieStore };
}
