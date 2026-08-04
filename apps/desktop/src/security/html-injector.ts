/**
 * FilmSnaps Desktop — Network-Layer HTML Protection Injection
 *
 * THE WHOLE-PAGE GUARANTEE (per expert consultation 2026-08-02).
 *
 * The session-level preload (registerPreloadScript) is reload-immune but is
 * NOT guaranteed to reach every document Chromium produces — programmatic
 * frames, certain about:blank/srcdoc documents, and any frame whose renderer
 * process the preload mechanism misses. That is the delivery gap: the mobile
 * app's WebView bakes the protection into the page's own bytes on every
 * navigation, so it can never be missed. This layer makes desktop structurally
 * identical.
 *
 * We register session.protocol.handle('https' + 'http') on the provider
 * partition. Every network request this session makes is delegated to our
 * handler. HTML document responses are buffered, the protection script
 * (dist/preload/provider-preload.js — the same self-contained IIFE the preload
 * runs) is inlined at the top of <head>, and the rewritten body is returned.
 * Every other resource (media segments, scripts, images, XHR/JSON, blobs)
 * streams straight through net.fetch untouched — no buffering, no cost on video.
 *
 * Defense in depth:
 *   - Preload runs at document-start in frames the preload mechanism covers.
 *   - This layer guarantees coverage in EVERY https/html document by
 *     construction — reloads, cross-site navigations, process swaps, all.
 *   - The protection's own GUARD (Symbol.for('__filmsnaps_preload_guard'))
 *     makes the two idempotent: whichever runs first wins, the other no-ops.
 *
 * Fail-CLOSED for HTML documents (per expert consultation): if the protection
 * source loaded and a text/html response reaches us, an injection failure
 * returns 403 rather than serving an unprotectable page. If the source failed
 * to load at registration, L8 is NOT armed at all — the preload + frame-sweep
 * become the fail-closed gate. Non-HTML/media streams are never buffered.
 *
 * R0-R8 blocking is NOT duplicated here. session.fetch still triggers the
 * session's webRequest handlers (onBeforeRequest blocks ads at the network
 * layer; onHeadersReceived sets CSP/security headers), and our rewritten
 * Response copies those headers through.
 */

import { Session } from "electron";
import { readFileSync } from "fs";
import { join } from "path";
import { getCosmeticFilterPayload } from "./filter-engine";

// ── Protection source (loaded once at registration) ─────────────────────────

let _protectionSource: string | null = null;

function getProtectionSource(): string {
  if (_protectionSource !== null) return _protectionSource;
  try {
    // This module compiles to dist/security/html-injector.js, so __dirname is
    // dist/security — the preload lives one level up at dist/preload/.
    // Reading the COMPILED file (not the TS source) gives the exact bytes the
    // preload mechanism also runs, including the cosmetic CSS that
    // inject-preload-css.js bakes in at build time.
    const preloadPath = join(__dirname, "..", "preload", "provider-preload.js");
    _protectionSource = readFileSync(preloadPath, "utf8");
    console.log(
      `[HtmlInjector] Protection source loaded (${_protectionSource.length} chars)`,
    );
  } catch (err) {
    console.error("[HtmlInjector] Failed to load protection source:", err);
    _protectionSource = "";
  }
  return _protectionSource;
}

// ── Injection ───────────────────────────────────────────────────────────────

function blockedResponse(): Response {
  return new Response("", { status: 403, statusText: "Blocked" });
}

/**
 * Inline the protection script at the top of <head>, so it is the very first
 * element in the document — before any provider script, meta, or stylesheet.
 * Falls back to after <html>, then to a bare prepend for malformed fragments.
 */
function injectProtection(html: string, script: string): string {
  const tag = `<script>\n${script}\n</script>`;

  // After <head> or <head attr="...">.
  const headMatch = html.match(/<head[\s>]/i);
  if (headMatch?.index != null) {
    const close = html.indexOf(">", headMatch.index);
    if (close !== -1) {
      return html.slice(0, close + 1) + tag + html.slice(close + 1);
    }
  }

  // No <head> — after <html> (or <html attr="...">).
  const htmlMatch = html.match(/<html[\s>]/i);
  if (htmlMatch?.index != null) {
    const close = html.indexOf(">", htmlMatch.index);
    if (close !== -1) {
      return html.slice(0, close + 1) + tag + html.slice(close + 1);
    }
  }

  // Bare fragment — prepend.
  return tag + html;
}

/**
 * Inject engine-derived cosmetic CSS + scriptlets before </head> (falling back
 * to before </body>, then </html>, then a bare append). This mirrors mobile's
 * `getCosmeticSelectors(host)` → `<style>` before first paint — the CSS is part
 * of the document's BYTES, so there is no IPC, no timing window, no
 * hostname ambiguity, and no fail-open path (V5 Gap A — the primary fix).
 *
 * The payload is hostname-based only (no DOM tokens at the HTML-bytes level,
 * exactly like mobile's HTML-level injection). DOM-triggered rules are handled
 * separately by the in-page DOM sweeper → IPC → per-frame injection.
 */
function injectCosmetics(
  html: string,
  payload: { styles: string; scripts: string[] },
): string {
  if (!payload.styles && (!payload.scripts || payload.scripts.length === 0)) {
    return html;
  }

  let frag = "";
  if (payload.styles) {
    frag += `<style data-filmsnaps-cosmetic="true">${payload.styles}</style>\n`;
  }
  if (payload.scripts && payload.scripts.length) {
    for (const s of payload.scripts) {
      frag += `<script data-filmsnaps-scriptlet="true">${s}</script>\n`;
    }
  }

  // Insert before </head>, then </body>, then </html>, else append.
  const headEnd = html.search(/<\/head>/i);
  if (headEnd !== -1) {
    return html.slice(0, headEnd) + frag + html.slice(headEnd);
  }
  const bodyEnd = html.search(/<\/body>/i);
  if (bodyEnd !== -1) {
    return html.slice(0, bodyEnd) + frag + html.slice(bodyEnd);
  }
  const htmlEnd = html.search(/<\/html>/i);
  if (htmlEnd !== -1) {
    return html.slice(0, htmlEnd) + frag + html.slice(htmlEnd);
  }
  return html + frag;
}

// ── Registration ────────────────────────────────────────────────────────────

const armedSessions = new WeakSet<Session>();

/**
 * Arm network-layer HTML protection injection for a provider session.
 *
 * MUST be registered before the session's first request (i.e. at startup,
 * inside createProviderSession) — Electron requires protocol.handle to be
 * registered before any request to the scheme. Idempotent per session.
 */
export function registerHtmlInjection(session: Session): void {
  if (armedSessions.has(session)) return;
  armedSessions.add(session);

  const source = getProtectionSource();
  if (!source) {
    // SAFETY VALVE: fail-closed-on-all-HTML with an empty source would block
    // every provider page (the injection itself can never succeed). Instead we
    // do NOT arm L8 at all — the provider-preload (L5) and the per-frame sweep
    // (L7b, provider-security.ts) remain the fail-closed gate.
    console.error(
      "[HtmlInjector] No protection source — network HTML injection NOT armed. " +
        "Provider preload + frame-sweep remain the fail-closed gate.",
    );
    return;
  }

  // Fail-CLOSED for HTML documents, per expert consultation: if the protection
  // source loaded and a text/html response reaches us, we MUST NOT serve it
  // unprotectable — that is exactly the coverage hole that let ads render.
  // Non-HTML/media streams remain untouched (never buffered).
  const handler = async (request: Request): Promise<Response> => {
    // Forward through the SAME session's network stack. bypassCustomProtocolHandlers
    // prevents infinite recursion; the session's webRequest handlers (R0-R8
    // onBeforeRequest + onHeadersReceived CSP) still fire.
    //
    // NOTE: we intentionally do NOT use net.fetch() here. net.fetch issues
    // requests against the DEFAULT session and has no `session` option in
    // Electron 42 (verified in electron.d.ts) — switching would silently route
    // provider traffic outside this partition, losing the R0-R8 filter and the
    // provider session entirely. session.fetch keeps everything on the
    // provider partition. (Expert 2's net.fetch recommendation was based on
    // SSE/HTTP-2 concerns that do not apply to text/html document rewrites.)
    let response: Response;
    try {
      response = await session.fetch(request, {
        bypassCustomProtocolHandlers: true,
      });
    } catch {
      // Blocked by R0-R8 onBeforeRequest or aborted — reflect the block.
      return blockedResponse();
    }

    // Only rewrite HTML documents. Everything else (media segments, scripts,
    // images, XHR/JSON, blobs) streams through untouched — no buffering.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return response;

    try {
      const html = await response.text();
      let injected = injectProtection(html, source);

      // ── Engine-derived cosmetic CSS + scriptlets at the HTML-bytes level ──
      // (V5 Gap A — the primary parity fix). Hostname comes from the RESPONSE
      // URL (always known, never about:blank), matching mobile's native
      // getCosmeticSelectors(host) → <style> before first paint. No IPC, no
      // timing, no fail-open.
      let cosCssChars = 0;
      let cosScripts = 0;
      try {
        const cosmetic = getCosmeticFilterPayload(request.url);
        if (cosmetic.styles || (cosmetic.scripts && cosmetic.scripts.length)) {
          injected = injectCosmetics(injected, cosmetic);
          cosCssChars = cosmetic.styles?.length ?? 0;
          cosScripts = cosmetic.scripts?.length ?? 0;
        }
      } catch (cosErr) {
        // Cosmetic injection is best-effort — never fail the document over it.
        console.error("[HtmlInjector] Cosmetic injection failed:", cosErr);
      }

      const headers = new Headers();
      for (const [key, value] of response.headers) {
        // session.fetch auto-decompresses the body; strip the original encoding
        // + length so the rewritten bytes aren't double-decoded.
        if (/^content-(encoding|length)$/i.test(key)) continue;
        // Strip any provider CSP so it cannot suppress the injected script,
        // and any stale chunked marker so the re-wrapped body isn't misread.
        if (/^content-security-policy$/i.test(key)) continue;
        if (/^transfer-encoding$/i.test(key)) continue;
        headers.set(key, value);
      }
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("x-filmsnaps-protection", "injected");

      // POSITIVE log (V4 step 5 / V5 Gap A diagnostic): proves the bundle AND
      // the engine cosmetic CSS were baked into the response bytes.
      let hostname = "";
      try {
        hostname = new URL(request.url).hostname;
      } catch {}
      console.log(
        `[HtmlInjector] ${hostname}: bundle ${source.length} chars + ${cosCssChars} CSS chars + ${cosScripts} scriptlets`,
      );

      return new Response(injected, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (err) {
      // FAIL-CLOSED for HTML documents: never serve a page we could not
      // protect. (Previously fail-open — this was a silent coverage hole.)
      console.error(
        "[HtmlInjector] HTML injection failed — blocking unprotected document:",
        err,
      );
      return new Response(
        "<!doctype html><html><body>FilmSnaps: provider page could not be secured (blocked).</body></html>",
        {
          status: 403,
          statusText: "Blocked",
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
  };

  // ── V8 DIAGNOSTIC (2026-08-04): L8 protocol interception DISABLED ──────────
  // Expert V8: intercepting every https/http request and re-issuing it via
  // session.fetch() from the MAIN process re-issues the request WITHOUT the
  // renderer-context headers Chromium adds (Sec-Fetch-Dest/Mode/Site, Accept,
  // Accept-Language, Accept-Encoding, Origin, and the POST Content-Type). The
  // main-process fetch presents a minimal non-browser header profile to
  // Cloudflare → screenscape's zone 403s the token POST even with a clean UA.
  //
  // TEST: comment out protocol.handle entirely. L5 (session preload) still
  // delivers the protection bundle + cosmetic CSS at document-start in every
  // frame; R3.5/R5b + the in-page bundle still block ads. So this test does
  // NOT expose ads. If the screenscape 403 resolves → L8 confirmed as the
  // header-stripping mechanism, and L8 stays disabled permanently (see V8 §6
  // step 3a). If it still 403s → the minimal headers come from the renderer
  // itself; escalate to requestWillBeSentExtraInfo / onBeforeSendHeaders (V8 §4).
  //
  // The handler below is left in place (unused) so re-arming is a one-line
  // uncomment. NOT gated on an env var so the diagnostic is a clean flip.
  // try {
  //   session.protocol.handle("https", handler);
  //   session.protocol.handle("http", handler);
  //   console.log(
  //     "[HtmlInjector] Network-layer HTML protection armed (https + http)",
  //   );
  // } catch (err) {
  //   // A second registration for the same scheme throws — the armedSessions
  //   // WeakSet already guards against double-arming, but this catch is a hard
  //   // safety net so a registration error can never crash startup.
  //   console.error("[HtmlInjector] Failed to arm HTML protection:", err);
  // }
}
