# Expert Consultation: Proxy Architecture for Cloudflare-Protected Provider

> **Status:** Seeking guidance on breaking the Cloudflare JS challenge infinite loop and blocking mobile popup ads.
> **Date:** 2026-07-16
> **Author:** FilmSnaps Engineering

---

## Situation

FilmSnaps is a video streaming web app (Next.js 14, React 18) that embeds content from third-party providers via `<iframe>`. One provider — **nxsha** (displayed as "Server 1" at `https://web.nxsha.app`) — injects popup ad overlays that only appear on **mobile devices**. These ads appear at unpredictable positions, sometimes covering the entire iframe, so CSS-based cover overlays are not viable.

We MUST proxy nxsha's HTML through our server to strip ads at the HTML level, rewrite asset URLs, and inject runtime protection scripts. However, nxsha is behind Cloudflare's JS Challenge platform, and server-side proxying creates an **infinite reload loop**.

This document describes the full architecture, the loop mechanics, and the open questions we need expert guidance on.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│              User's Browser                  │
│  ┌─────────┐   ┌─────────────────────────┐  │
│  │ Our Page │   │  SecureIframe (iframe)  │  │
│  │ (Next.js)│   │  src="/api/player/...   │  │
│  │          │   │  ┌─────────────────┐   │  │
│  │ ServerPicker   │  │ Proxied HTML    │   │  │
│  │ EpisodeRail    │  │ (same-origin)   │   │  │
│  │ PlayerControls │  │ ┌┄┄┄┄┄┄┄┄┄┄┄┄┐ │   │  │
│  └─────────┘   │  │ ┆NavBlocker/    ┆│   │  │
│                │  │ ┆RuntimeGuard   ┆│   │  │
│                │  │ └┄┄┄┄┄┄┄┄┄┄┄┄┘ │   │  │
│                │  └─────────────────┘   │  │
│                └─────────────────────────┘  │
└──────────┬──────────────────────────────────┘
           │  fetch /api/player/nxsha/...
           ▼
┌─────────────────────────────────────────────┐
│       Next.js API Route (proxy)              │
│  fetch → Cloudflare detection →             │
│  rewriteAssetUrls → inject protections →    │
│  return modified HTML with CSP header        │
└─────────────────────────────────────────────┘
           │  server-side fetch (Node.js)
           ▼
┌─────────────────────────────────────────────┐
│       Nxsha (behind Cloudflare)              │
│  → Returns "hybrid" page: real video         │
│    content + embedded JS challenge ref       │
│  → /cdn-cgi/challenge-platform/scripts/...   │
└─────────────────────────────────────────────┘
```

### Direct Iframe (no proxy, current working state)

```
┌─────────────────────────────────────────────┐
│              User's Browser                  │
│  ┌─────────┐   ┌─────────────────────────┐  │
│  │ Our Page │   │ Iframe (cross-origin)   │  │
│  │          │   │ src="https://web.nxsha  │  │
│  │          │   │      .app/embed/..."    │  │
│  │ Sandbox +│   │                         │  │
│  │ CSP attr │   │ Cloudflare challenge    │  │
│  │ cover    │   │ solved by user's        │  │
│  │ overlays │   │ browser natively        │  │
│  └─────────┘   │ Mobile: shows popups     │  │
│                │ (unreachable from parent) │  │
│                └─────────────────────────┘  │
└─────────────────────────────────────────────┘
```

The direct iframe works (Cloudflare challenge solved by the user's browser naturally). BUT on mobile, nxsha shows popup/overlay ads that the parent page cannot remove due to cross-origin restrictions.

---

## The Infinite Loop Problem

### How It Occurs

1. **Proxy fetch:** `GET /api/player/nxsha/embed/movie/{id}` → server-side `fetch()` to `https://web.nxsha.app/embed/movie/{id}`
2. **Cloudflare response:** Cloudflare returns a **hybrid page** — the real video player HTML (37464 bytes containing `<video>`, player elements) **plus** a Cloudflare JS challenge script reference at `/cdn-cgi/challenge-platform/scripts/jsd/main.js`
3. **Detection fails:** `isCloudflareChallenge()` (at `apps/web/lib/movieProviders/cloudflareDetect.ts`) checks:
   - HTML length < 50KB? ✅ (37464 passes)
   - Contains Cloudflare signatures? ✅ (`cdn-cgi/challenge-platform` present)
   - Does NOT contain player content? ❌ (contains `<video>`, `player` elements)
   
   Result: **`false`** — not detected as a challenge page.
4. **URL rewriting:** `rewriteAssetUrls()` rewrites ALL `<script src="...">` through the asset proxy. The Cloudflare challenge script becomes: `/api/player/nxsha/asset?url=https://web.nxsha.app/cdn-cgi/challenge-platform/scripts/jsd/main.js`
5. **Asset proxy fails:** The asset proxy fetches this script from nxsha origin → Cloudflare sees a server-side fetch for its challenge script → **blocks with 404** (or 403)
6. **Challenge script 404:** The browser loads the proxied HTML. The challenge script URL returns 404/empty response.
7. **Page self-reloads:** The Cloudflare challenge platform detects that `jsd/main.js` failed to load → triggers `location.reload()`
8. **Infinite loop:** The reload targets the proxy URL → proxy fetches from nxsha → same hybrid page → same 404 → same reload → ad infinitum

### Why It's Hard to Detect

The `isCloudflareChallenge()` heuristic is designed to detect **pure challenge pages** (small, no real content, lots of CF markers). nxsha's page is a **hybrid** — it has real video player content alongside the Cloudflare challenge script. So the heuristic thinks it's a legitimate page.

### Current Loop-Breaking Mechanisms

1. **`cloudflareFallback()` in route.ts** — returns a static "Server Behind Cloudflare" page. Only triggered when `isCloudflareChallenge()` returns `true`, which it never does for nxsha.
2. **FlareSolverr integration** — exists at `apps/web/lib/movieProviders/flareSolverr.ts` but not configured (no `FLARESOLVERR_URL` env var set).
3. **Redirect Breaker in SecureIframe** — polls `iframe.contentWindow`. On cross-origin security error, resets src to original URL. Since proxied content is same-origin, this doesn't fire.

### The Specific Check That Fails

```typescript
// apps/web/lib/movieProviders/cloudflareDetect.ts:38-61
export function isCloudflareChallenge(html: string): boolean {
  if (html.length > 50_000) return false;       // nxsha = 37464 ✅ passes
  const hasSignature = CLOUDFLARE_SIGNATURES.some(...)    // ✅ has cdn-cgi/challenge-platform
  const hasPlayerContent = lowerHtml.includes('<video') ||  // ✅ has <video>
    lowerHtml.includes('jwplayer') || lowerHtml.includes('player') || ...
  return !hasPlayerContent;  // ← returns false because player content EXISTS
}
```

---

## Provider Configuration

```typescript
// packages/shared/src/providers/registry.ts
{
  id: 'nxsha',
  name: 'Nxsha',
  displayName: 'Server 1 [Multi lang, Fast]',
  baseUrl: 'https://web.nxsha.app',
  embed: {
    movie: (id) => `/embed/movie/${id}?disable_dl_button=true&disable_app_ad=true&lang=hi`,
    tv: (id, s, e) => `/embed/tv/${id}/${s}/${e}?disable_dl_button=true&disable_app_ad=true&lang=hi`,
  },
  sandbox: 'allow-scripts allow-same-origin ',
  platforms: ['web'],
  allowedOrigins: ['https://web.nxsha.app'],
  // No protection config set — defaults apply
}
```

Note: `disable_app_ad=true` is already passed in the URL. Despite this, mobile popups still appear.

---

## Protection Systems (Currently Working for Non-Cloudflare Providers)

### 1. Server-Side Proxy (`apps/web/app/api/player/[provider]/[...path]/route.ts`)
- Fetches provider HTML server-side (desktop UA, `redirect: 'follow'`)
- `rewriteAssetUrls()` — rewrites `<script>`, `<link>`, `<iframe>`, `<img>` src/href through asset proxy, blocking known ad/tracker URLs
- Injects `generateNavBlockerScript()` — location freezing, popup blocking, history protection, link/form interception, self-healing
- Injects `generateRuntimeProtectionScript()` — network interception (fetch/XHR/sendBeacon), element creation interception, service worker neutralization, continuous cleanup, MutationObserver
- Returns modified HTML with strict `buildProviderCSP()` header

### 2. Asset Proxy (same route.ts, `isAsset` check)
- Scripts, styles, iframes rewritten to: `/api/player/{provider}/asset?url={encoded_absolute_url}`
- Fetches from provider origin with desktop UA
- Returns with proper Content-Type + CORS headers
- Blocks URLs matching `DEFAULT_BLOCKED_PATTERNS` (140k+ @cliqz/adblocker filters + 90 legacy patterns)

### 3. @cliqz/adblocker Engine (`apps/web/lib/movieProviders/filterService.ts`)
- `FiltersEngine` deserialized from precompiled binary (140,993 network + 42,097 cosmetic filters)
- Loaded at module import time
- Falls back to legacy pattern matching if engine binary unavailable
- Matches every asset URL through the engine's `Request` matching

### 4. Client-Side Guards (SecureIframe) (`apps/web/components/player/SecureIframe.tsx`)
- **Navigation guard:** 500ms interval checking `window.location.href`, blocks changes + `history.pushState` patches + `window.open` override
- **Popup guard:** Focus reclamation when popup steals focus (50ms interval for 15s)
- **CPU abuse watchdog:** 3s checks for >300ms lag, warns after 3 consecutive bad readings
- **Redirect breaker:** 1500ms poll of `iframe.contentWindow` — resets iframe src on cross-origin navigation
- **Session refresh:** Forces iframe refresh after 60 minutes
- **Load timeout:** 15s timeout triggers onError callback

### 5. Parent-side Protections
- **Sandbox attribute:** `allow-scripts allow-same-origin` (no `allow-popups`, no `allow-top-navigation`, no `allow-forms`)
- **CSP attribute:** `buildIframeCSP()` — `default-src 'none'` + permissive overrides for scripts/media/images
- **Cover overlays:** Positioned `<div>` elements at known ad coordinates with `pointer-events: none`

---

## Technical Details — The Proxy Route

```typescript
// apps/web/app/api/player/[provider]/[...path]/route.ts — GET handler
const embedPath = '/' + path.join('/');
const queryString = new URL(req.url).searchParams.toString();
const targetUrl = queryString
  ? `${providerBaseUrl}${embedPath}?${queryString}`
  : `${providerBaseUrl}${embedPath}`;

// Step 0: Fetch HTML
const response = await fetch(targetUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...Chrome/131.0.0.0',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: providerBaseUrl + '/',
  },
  redirect: 'follow',
});
let html = await response.text();

// Step 1: Cloudflare detection (fails for nxsha's hybrid page)
if (isCloudflareChallenge(html)) {
  // Try FlareSolverr, else fallback page
  // Never reached for nxsha
}

// Step 2: Rewrite asset URLs
html = rewriteAssetUrls(html, providerBaseUrl, providerKey);

// Step 3: Inject runtime protection
const runtimeScript = generateRuntimeProtectionScript(targetUrl, providerKey, provider);
html = html.replace('</head>', runtimeScript + '\n</head>');

// Step 4: Inject nav blocker
html = injectProtectionIntoHtml(html, targetUrl, provider);

// Return with CSP header
return new NextResponse(html, {
  headers: {
    'Content-Security-Policy': buildProviderCSP(provider),
    // ...
  },
});
```

### Asset Proxy Behavior

```typescript
// Same route.ts — asset requests
const isAsset = embedPath.match(/\.(js|css|png|...)$/i);
if (isAsset) {
  const fullUrl = `${providerBaseUrl}${embedPath}`;
  if (shouldBlockUrl(fullUrl, { provider })) {
    return new NextResponse(null, { status: 204 }); // blocked
  }
  const response = await fetch(fullUrl, { /* desktop UA */ });
  return new NextResponse(response.body, {
    headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' },
  });
}
```

### WatchClient Embed URL Builder

```typescript
// apps/web/app/watch/[...id]/WatchClient.tsx
const PROXIED_PROVIDERS = new Set<string>([]); // Currently empty — nxsha NOT proxied

function buildEmbedUrl(provider, contentid, plat, selectedSeason, activeEpisode): string {
  const embedPath = plat === 'tv'
    ? provider.embed.tv(contentid, selectedSeason, activeEpisode)
    : provider.embed.movie(contentid);
  if (PROXIED_PROVIDERS.has(provider.id)) {
    const [pathPart, queryPart] = embedPath.split('?');
    const proxyPath = `/api/player/${provider.id}${pathPart}`;
    return queryPart ? `${proxyPath}?${queryPart}` : proxyPath;
  }
  return `${provider.baseUrl}${embedPath}`; // Direct iframe (current state)
}
```

---

## FlareSolverr Integration

Exists at `apps/web/lib/movieProviders/flareSolverr.ts` but not deployed.

### Prerequisites
```bash
docker run -p 8191:8191 flaresolverr/flaresolverr
# Set FLARESOLVERR_URL=http://localhost:8191 (default)
```

### Architecture
1. **Cookie cache** (`RETRY_MS`): Disk-based cache of `cf_clearance` cookies in `.cf-cache/` directory. 25-minute TTL (below FlareSolverr's ~30 min session expiry).
2. **Cache-first:** On request, checks cache for valid cf_clearance cookie. If found, fetches directly with the cached cookie (no headless browser = ~20ms instead of ~5s).
3. **Cache miss → FlareSolverr:** Sends `request.get` command to FlareSolverr's `/v1` endpoint. Headless browser solves the challenge. Extracts cf_clearance cookie, caches it, returns rendered HTML.
4. **Cache invalidation:** If cached cookie results in a Cloudflare challenge page, clear cache and re-solve.

### Integration Point in route.ts

```typescript
// Currently: detection only, no fallback to FlareSolverr for hybrid pages
if (isCloudflareChallenge(html)) {
  // Only triggered for pure challenge pages, NOT for nxsha's hybrid page
  if (isFlareSolverrConfigured()) {
    const solved = await fetchWithFlareSolverr(providerKey, targetUrl);
    if (solved) html = solved;
  }
}
```

---

## Key Constraints

1. **Server-side rendering** — The proxy runs in Next.js Edge/Serverless runtime. Long-running operations (FlareSolverr's ~5s solve time) may hit function timeout limits.
2. **Same-origin proxy model** — Proxied content is served from our domain, making it same-origin with the parent page. This enables JS-level protection (nav blocking, element interception) but means the iframe CSP attribute isn't needed (server CSP covers it).
3. **Mobile-specific ads** — nxsha's popups only appear on mobile devices. Desktop users see a clean video. This suggests the ads are triggered by mobile UA detection or viewport size.
4. **No user authentication** — Local-first app. No login system.
5. **Next.js App Router** — API routes use the `app/api/` directory structure with edge-compatible handlers.

---

## Questions for the Expert

### 1. Breaking the Infinite Loop

Given that nxsha returns a hybrid page (real content + embedded Cloudflare JS challenge ref):

1. **What's the most reliable server-side detection method for this hybrid scenario?**
   - The current `isCloudflareChallenge()` says "has player content → not a challenge." Is there a better heuristic?
   - Could we check for the presence of BOTH `cdn-cgi/challenge-platform` AND player content, then probe deeper?
   - Is there a different header/status-code signal from Cloudflare we should look for?

2. **Can we safely strip the Cloudflare challenge script from the HTML?**
   - If we regex-strip `<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js">` during `rewriteAssetUrls()` (by adding it to blocked patterns), does the page still work? Or does the missing challenge script cause a reload regardless?

3. **Can we replace the challenge script with a no-op/stub?**
   - The page seems to reload when it detects the challenge script failed. If we replace the script with a stub that fakes a successful challenge, would that stop the reload?
   - What would such a stub need to do? Set specific cookies? Call specific functions?

4. **Can we use the response headers to detect the loop?**
   - Could we add a `X-Proxy-Attempt` header and detect retries within a short window?
   - Could we detect the reload by checking the `Referer` header pattern?
   - Is there a `Sec-Fetch-*` header pattern that distinguishes a page reload from an initial load?

5. **What's the right FlareSolverr integration point for this hybrid case?**
   - Should FlareSolverr be the first attempt (before direct fetch), bypassing the HTML-level detection entirely?
   - Or should we detect the challenge script 404 in the proxied HTML and THEN escalate to FlareSolverr?

### 2. Proxying Through Cloudflare JS Challenges

Given that FlareSolverr creates a ~5s delay per challenge solve:

1. **Is FlareSolverr viable in a serverless/edge environment?**
   - Next.js API routes have a 10s (Basic) to 30s (Pro) timeout on Vercel. FlareSolverr solves take ~5s. Is there enough margin?
   - Would AWS Lambda's 15s timeout (or our own server with no limit) be necessary?

2. **Cookie persistence across solves:**
   - Our disk-based cookie cache uses a 25-minute TTL. Is this the right approach?
   - Should we share the cache across multiple FlareSolverr instances?
   - Does the cf_clearance cookie need the provider's full domain path context?

3. **What happens when FlareSolverr can't solve?**
   - Sessions expire (~30 min). If we get an expired session, do we get a 403 from nxsha or a new challenge page?
   - What's the refresh mechanism — just re-solve with a new FlareSolverr session?

4. **Rate limiting concerns:**
   - If multiple users request the same provider simultaneously, do we get many FlareSolverr solves or can we share the cached cookie across requests?
   - Are there Cloudflare rate limits to be aware of?

### 3. Mobile Popup Ads — Without a Proxy

If proxying is not viable (Cloudflare challenges can't be reliably solved):

1. **What are ALL possible techniques to suppress overlay ads inside a cross-origin iframe on mobile browsers?**
   - Sandbox: `allow-scripts allow-same-origin` (no `allow-popups`, no `allow-top-navigation`)
   - iframe CSP attribute: `default-src 'none'` + specific overrides
   - Cover overlays: positioned `<div>` elements
   - What else is possible?

2. **Can the sandbox attribute be made more aggressive for mobile?**
   - Drop `allow-same-origin`? Would that break the player?
   - Drop `allow-scripts`? Obviously would break everything.
   - Use different sandbox per viewport (`useMediaQuery`)?

3. **Are there CSS-only approaches?**
   - `pointer-events: none` on the iframe itself (breaks video controls)
   - `filter: none` or other CSS properties that affect content
   - `mix-blend-mode` hacks to hide certain pixel patterns
   - What about intercepting at the compositor level?

4. **Browser-specific tricks:**
   - Chrome Custom Tabs / Trusted Web Activity?
   - Service Worker registration from the parent page to intercept iframe requests?
   - `srcdoc` with a proxy wrapper?

5. **URL parameter exploration:**
   - nxsha's URL has `disable_app_ad=true` — does it have other ad-suppression params?
   - Common patterns: `ads=0`, `no_ads=true`, `force_player=1`, `hide_overlay=1`
   - Is there an ad-free embed variant at a different path?

### 4. Hybrid / Alternative Approaches

1. **Direct iframe + postMessage bridge:**
   - Load directly (bypasses Cloudflare for the user's browser)
   - Use a service worker registered on our domain to intercept iframe requests?
   - Is there any way to inject a content script into a cross-origin iframe from the parent?

2. **Two-layer approach:**
   - Load initially via direct iframe (user's browser solves Cloudflare)
   - After the Cloudflare challenge is solved and cf_clearance is set in the user's browser, POST the cookie to our proxy
   - Use the proxy to re-fetch with the user's cookie and serve ad-free content
   - This avoids FlareSolverr entirely by reusing the user's browser session

3. **Subdomain isolation:**
   - Put the iframe on a different subdomain (e.g., `player.filmsnaps.app`)
   - Serve a sandboxed HTML page that loads nxsha directly
   - The parent communicates with this page via `postMessage`
   - Does this give us any additional protection capabilities?

4. **WebView approach (mobile):**
   - On mobile, use a native WebView with `shouldInterceptRequest` or equivalent
   - Android's `WebViewClient.shouldInterceptRequest()` can block specific URLs
   - Could use `evaluateJavascript()` to inject ad-blocking JS
   - Are there iOS WKWebView equivalents?

### 5. Cloudflare Bypass Strategies (Without FlareSolverr)

1. **Can the server-side fetch present a more "browser-like" fingerprint?**
   - Current: Chrome 131 desktop UA, no special headers
   - Could we use a more complete header set (Accept-Encoding, Accept-Ch, Sec-CH-UA, etc.)?
   - What about HTTP/2 connection reuse, TLS fingerprinting, TCP parameters?
   - Is `undici` or a specific HTTP client better than the built-in `fetch`?

2. **Client-side preflight:**
   - Load nxsha in a hidden `<iframe>` first (from the user's browser)
   - Wait for the Cloudflare challenge to complete and cookies to be set
   - Then have the server-side proxy use those cookies in a fetch request
   - This requires a postMessage bridge to relay cookies. Is there a simpler approach?

3. **Is there a session reuse pattern?**
   - Direct iframe: user's browser gets cf_clearance from Cloudflare
   - After successful load, can the iframe's cookies be accessed from the parent? (No, cross-origin)
   - What about redirecting through our domain to set a same-origin cookie?

### 6. Architecture Decision

Given all of the above:

- **Should we invest in FlareSolverr** and make the proxy work for nxsha?
- **Or should we accept direct iframe for nxsha** and use aggressive sandbox/cover overlays for mobile?

The tradeoff:
- **Proxy (with FlareSolverr):** Requires running a FlareSolverr Docker container, ~5s latency on first solve, cookie caching reduces subsequent latency. Gives us FULL ad-blocking capability because we control the HTML.
- **Direct iframe:** No infrastructure needed, works now. But mobile popups are unblockable from the parent. Cover overlays help but miss unpredictable-position ads.

What factors should guide this decision?

---

## Relevant Files

| File | Purpose |
|------|---------|
| `apps/web/app/api/player/[provider]/[...path]/route.ts` | Proxy route — fetch, rewrite, inject protection |
| `apps/web/app/watch/[...id]/WatchClient.tsx` | Client — embed URL builder with PROXIED_PROVIDERS set |
| `apps/web/components/player/SecureIframe.tsx` | Iframe wrapper — redirect breaker, nav guard, popup guard, CPU watchdog |
| `apps/web/components/player/PlayerControlOverlay.tsx` | Player controls overlay |
| `apps/web/lib/movieProviders/protection.ts` | Nav blocker script, runtime protection script, asset URL rewriting, URL filtering |
| `apps/web/lib/movieProviders/filterService.ts` | @cliqz/adblocker filter engine (140k+ network, 42k+ cosmetic filters) |
| `apps/web/lib/movieProviders/cloudflareDetect.ts` | Cloudflare challenge page detection |
| `apps/web/lib/movieProviders/flareSolverr.ts` | FlareSolverr client with cookie caching |
| `apps/web/lib/movieProviders/cspBuilder.ts` | CSP header and iframe CSP attribute builders |
| `packages/shared/src/providers/registry.ts` | All provider definitions including nxsha |
| `packages/shared/src/types/provider.ts` | ProviderDefinition type (coverOverlays, sandbox, allowedOrigins, protection config, platforms) |

---

## Expert Analysis (Received 2026-07-16)

### 1. Breaking the Infinite Loop

**1.1 Reliable Server-Side Detection for Hybrid Pages**
The `isCloudflareChallenge()` heuristic fails because it assumes CF challenges are pure challenge pages. Modern Cloudflare "Managed Challenge" or "JS Challenge" modes often return the real HTML payload alongside the `/cdn-cgi/challenge-platform/` script.

- **Better heuristic:** If `cdn-cgi/challenge-platform` exists *anywhere* in the HTML, treat it as a challenge. The presence of this string means the content is temporary and requires JS execution to reveal the actual payload.
- **Header signal:** Check `cf-mitigated: challenge` response header. Also check HTTP status `403`/`503` alongside expected HTML.

**1.2 Stripping the CF Challenge Script — No**
The browser will not execute the challenge, but actual video sources are often encrypted/dynamically loaded *post-challenge*. Stripping the script means the video is permanently broken.

**1.3 Replacing with a No-Op Stub — Highly Impractical**
The Cloudflare script is heavily obfuscated and generates a cryptographic token (`cf_clearance` cookie) based on browser fingerprinting (canvas, WebGL, execution timing). Reverse-engineering daily-rotating JS VM is an arms race. Moreover, the script itself contains self-reload logic; stubbing it often results in an infinite loop anyway.

**1.4 Response-Header Loop Detection**
Detecting the loop server-side is difficult because `location.reload()` looks like a standard `GET`. You could inject a short-lived `__proxy_loop_attempt` cookie, but **preventing the loop doesn't solve the problem** — the video still won't load without the challenge being solved.

**1.5 FlareSolverr Integration Point**
If you stick to a pure proxy model, FlareSolverr must be the **first attempt** — not a fallback after native `fetch` already got the hybrid page and triggered a reload.

---

### 2. Proxying Through Cloudflare JS Challenges

**2.1 FlareSolverr Viability in Serverless — Practically No**
Vercel Edge will absolutely time out. Even Vercel Pro's 60s Node.js timeout is risky. FlareSolverr **must** run on a dedicated Docker host (Railway, AWS ECS, VPS). The Next.js API route asynchronously forwards the request and waits.

**2.2 Cookie Persistence — The IP/UA Binding Trap**
`cf_clearance` cookies are **strictly bound to the User-Agent and IP address** that solved the challenge. If FlareSolverr solves on IP A and your Next.js proxy fetches from IP B, the cookie is rejected. You must either:
- Proxy the final fetch through FlareSolverr's session (same IP)
- Run your proxy on the same IP as FlareSolverr
- Cache keyed by `(TargetDomain, UserAgent)`

**2.3/2.4 Failure & Rate Limiting**
- Expired session → CF returns 403 or new challenge → delete cached cookie → re-solve
- You *can* share cached `cf_clearance` across multiple users ONLY if requests use the same outbound IP (NAT gateway or the FlareSolverr VPS itself)

---

### 3. ⭐ THE GOLDEN PATH: TLS Fingerprinting (curl-impersonate)

The expert's primary recommendation. **FlareSolverr is heavy and slow.** The modern way to bypass Cloudflare's basic JS challenge from a serverless environment is to spoof the TLS/JA3 fingerprint and HTTP/2 frame ordering of a real browser.

**How it works:** Cloudflare often serves the hybrid page to Node's native `fetch` because it detects the TLS fingerprint of `undici` (Node's fetch engine). If you use `curl-impersonate` with Chrome's JA3 fingerprint, Cloudflare often serves clean HTML directly — **without the challenge script**.

- **Latency:** < 500ms (no headless browser needed)
- **Integration:** Replace native `fetch()` in `route.ts` with a `curl-impersonate` call (or Node wrappers: `node-libcurl-impersonate`, `cycletls`)
- **Result:** The infinite loop is bypassed entirely because the hybrid page is never returned in the first place

---

### 4. Mobile Popup Ads — Without a Proxy

**Ground truths for cross-origin iframes:**

- **Sandbox:** `allow-scripts allow-same-origin` required for player. Omitting `allow-popups` blocks `window.open()` but does NOT prevent dynamic `<div>` overlay injections within the iframe's own DOM.
- **CSS:** Cross-origin CSS cannot pierce the iframe boundary. `pointer-events: none` on the iframe itself breaks video controls.
- **postMessage Bridge:** Impossible — you cannot inject a content script into a cross-origin iframe unless you own the iframe's domain or have a browser extension.
- **Service Worker:** A SW on `filmsnaps.app` **cannot** intercept requests inside an iframe loading `web.nxsha.app`. SW scope is strictly bound by origin.

**Mobile WebView (the real solution):**
- **Android:** `WebViewClient.shouldInterceptRequest()` can inspect every request. `evaluateJavascript()` can run ad-removal JS *inside* the cross-origin iframe from the native layer. TWA cannot do this, but a native WebView can.
- **iOS:** `WKUserScript` injected at `documentEnd` can run JS inside cross-origin iframes to strip ad nodes.

**URL Parameter Exploration:** `disable_app_ad=true` is clearly failing on nxsha. Mobile ads are likely triggered by `window.innerWidth < 768`. Since the provider controls the HTML, client-side blocking without a proxy or native WebView is virtually impossible.

---

### 5. Hybrid / Alternative Approaches

**5.1 Two-Layer Cookie Relay — Flawed**
Cannot read `cf_clearance` from the iframe via `document.cookie` because it is `HttpOnly`. Even if not, cross-origin JS cannot access it.

**5.2 User-Agent Spoofing via Proxy — HIGHLY EFFECTIVE**
If nxsha's mobile popups are triggered by User-Agent, proxy the HTML but let the user's browser solve the Cloudflare challenge:
1. Use `curl-impersonate` (or enhanced Node.js HTTPS) to fetch nxsha with an **iPad UA string**
2. iPad UA often bypasses both JS challenges AND site-specific mobile ad-logic
3. nxsha returns clean HTML without popups and without CF challenges
4. Serve through proxy with NavBlocker injected

---

### 6. Architecture Decision & Recommendation

**RECOMMENDATION: Do not use FlareSolverr. Adopt a two-pronged architecture.**

#### Phase 1: The Native Fingerprint Proxy (Immediate Fix)
Replace Node's `fetch` in `route.ts` with a TLS-fingerprinting HTTP client (`curl-impersonate` wrapper or enhanced `node:https` with Chrome TLS config + iPad UA).

1. Proxy requests nxsha URL using Chrome 131 TLS fingerprint + iPad User-Agent
2. Bypasses Cloudflare JS Challenge server-side (no infinite loop, no hybrid page)
3. iPad UA means nxsha serves HTML **without mobile popup ad scripts**
4. Existing `rewriteAssetUrls`, `@cliqz/adblocker`, and `SecureIframe` protections handle the rest
5. Add `nxsha` to `PROXIED_PROVIDERS` (already done)

#### Phase 2: Native WebView Injection (Mobile App)
If `curl-impersonate` doesn't completely eliminate mobile ads (nxsha switches to viewport-based media queries instead of UA sniffing):
1. Route through a custom Native WebView component (Capacitor or React Native)
2. Use Android `shouldInterceptRequest` and iOS `WKUserContentController` to inject runtime adblocker directly into the nxsha iframe

**Why this wins:**
- **No FlareSolverr:** Eliminates Docker dependencies, 5s latency, Vercel timeout risks
- **Solves the Infinite Loop:** Bypasses CF hybrid page at the network layer (not HTML hacking)
- **Solves Mobile Ads:** iPad UA means nxsha never sends mobile ad DOM in the first place

---

## Implementation (Current State)

| Aspect | Status |
|--------|--------|
| TLS-fingerprinting HTTP client | ✅ `apps/web/lib/movieProviders/tlsFetch.ts` |
| | → curl-impersonate primary (if available) |
| | → `node:https` with Chrome TLS config + iPad UA |
| | → Native `fetch` fallback for edge runtimes |
| Cloudflare hybrid detection | ✅ `isCloudflareChallenge()` now catches hybrid pages |
| | → `cdn-cgi/challenge-platform` presence ALONE = challenge |
| | → `cf-mitigated` response header check |
| Proxy route updated | ✅ Uses `tlsFetch` for HTML page requests |
| | → Falls back to FlareSolverr if available |
| | → Falls back to iPad UA retry if no FlareSolverr |
| | → Returns clean CF fallback page if all methods fail |
| nxsha in PROXIED_PROVIDERS | ✅ Already configured |
| | → Updated docstring to reflect TLS approach |
| Provider protection config | ✅ Added custom block patterns + CDN origins for nxsha |
| EXPERTS.md | ✅ Expert analysis documented in this section |
| curl-impersonate binary | ⏳ Not installed — falls back to `node:https` mode |
| FlareSolverr setup | ⏳ Optional Docker container if needed for other providers |

---

# Expert Consultation: Mobile App Ad Blocking — Matching Brave/uBlock Origin

> **Status:** Seeking guidance on improving the mobile app's ad-blocking stack to match Brave Browser / uBlock Origin's effectiveness on streaming provider sites.
> **Date:** 2026-07-17
> **Author:** FilmSnaps Engineering

---

## Situation

FilmSnaps has a React Native mobile app (Android/iOS) that embeds streaming provider pages in a custom native WebView module. The providers work flawlessly in Brave Browser or any browser with uBlock Origin — no ads, no popups, clean video playback. But on some Android devices (Android 16+), our WebView's ad-blocking fails to catch certain popups and overlays from provider **nxsha** ("Server 1").

**Key observation:** When the exact same provider URL is opened in Brave Browser on the same Android 16 device, no ads or popups appear. The video plays cleanly. This confirms the site is not inherently malicious — it's our WebView's ad-blocking that's insufficient compared to what Brave/Chrome+uBlock achieve.

---

## Current Mobile Architecture

```
┌─────────────────────────────────────────────────┐
│                 React Native App                 │
│  ┌───────────────────────────────────────────┐  │
│  │  WatchScreen (app/watch/[...id].tsx)       │  │
│  │  - Reads provider from URL param            │  │
│  │  - Renders VideoWebView                     │  │
│  └──────────────────┬────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼────────────────────────┐  │
│  │  VideoWebView (components/VideoWebView.tsx) │  │
│  │  - State mgmt (provider, episode, progress) │  │
│  │  - Builds embed URL from registry           │  │
│  │  - Injects guard scripts into WebView       │  │
│  │  - Handles messages (progress, fullscreen)  │  │
│  └──────────────────┬────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼────────────────────────┐  │
│  │  PlayerWebView (native module)             │  │
│  │  - Window-overlay WebView (bypasses Fabric) │  │
│  │  - WebView pool (1-2 cached instances)     │  │
│  │  - Ad blocking in shouldInterceptRequest    │  │
│  │  - Per-provider profile filtering           │  │
│  │  - Child frame bridge injection             │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Current Ad-Blocking Layers (Mobile App)

### Layer 1: JavaScript Injection (`injectedJavaScriptBeforeContentLoaded`)

The mobile app injects a consolidated JavaScript guard script at document start into the WebView. This is built from three sources:

#### A. `POPUP_BLOCKER_SCRIPT` (inline in VideoWebView.tsx)
- `window.open()` override with ad domain filtering (90+ domain patterns)
- `window.fetch()` and `XMLHttpRequest` interception (block ad/tracker requests)
- `MutationObserver` DOM sweeper:
  - Removes ad iframes by src pattern
  - Hides fixed/sticky elements with z-index > 50 (high-position overlay ads)
  - Auto-clicks "Skip Ad" / "Close Ad" / "Continue" buttons when found on fixed overlays
- Click interception: blocks `<a>` navigation to external domains
- Service Worker neutralization: unregisters existing SWs, blocks new registration
- Blocks `document.write()` / `document.writeln()`

#### B. `makeCFBypassScript()` (inline in VideoWebView.tsx)
- Cloudflare bot-detection stealth:
  - `navigator.webdriver = false`
  - `window.chrome` stub (runtime, loadTimes, csi)
  - `navigator.plugins` spoofed to array of 5
  - `navigator.languages` spoofed to `['en-US', 'en']`
  - `navigator.permissions.query` — returns denied for notifications
  - WebGL renderer spoofed to "Intel Iris OpenGL Engine"
- `window.open()` permanently sealed (`Object.defineProperty(writable: false)`)
- `window.showModalDialog` / `showModelessDialog` blocked
- `a[target="_blank"]` click interception
- `Node.prototype.appendChild/removeChild` overrides:
  - Tracks video iframes and video containers
  - Prevents ad/tracker iframes from being removed (anti-anti-adblock)
  - Prevents video container's innerHTML from being cleared
- Fullscreen API interception (postMessage bridge for RN)
- Video detection + progress tracking via postMessage
- Per-provider cosmetic CSS injection (from `providerConfig.ts`)
  - nxsha: hides overlay/popup/modal divs via class, id, and inline-style selectors
  - screenscape: hides timer, download app prompts
  - chillflix: hides login/signup prompts

#### C. Shared `buildGuardScript()` (`packages/shared/src/security/playerGuard.ts`)
15 layers of protection (essentially mirrors A + B with some additional coverage):
- Popup blocking, ad network fetch/XHR filtering, DOM sweeper, click interception
- SW blocking, document.write blocking, CF stealth
- window.open sealing, a[target="_blank"] blocking
- Ad iframe protection (prevent removal of video iframes)
- Fullscreen API interceptor
- Content-ready detection (12s watchdog for `document.open()` without `close()`)
- Console bridge (log relay to RN side)
- Child frame anchor probe + boot diagnostic

#### Script Re-injection
The guard script is also re-evaluated via `evaluateJavascript()` on every `onPageFinished` callback, handled in `PlayerWebViewOverlayView.dispatchPageFinished()`:
```kotlin
if (injectedScript.isNotEmpty()) {
  wv?.evaluateJavascript(injectedScript, null)
}
```

### Layer 2: Native Kotlin WebViewClient (shouldInterceptRequest + shouldOverrideUrlLoading)

#### 2a. Heuristic-Based Blocking (shouldInterceptRequest)
The native layer analyzes HTTP request metadata to determine request PURPOSE:

1. **Video/audio content or Range requests** → ALLOW (unconditionally)
2. **CDN allowlist** → ALLOW (cloudfront.net, akamai.net, fastly.net, workers.dev, vidapi.cloud, eat-peach.sbs)
3. **Current provider host** → ALLOW
4. **Per-provider profile** → Heuristic block for script/iframe/image requests to domains NOT in the essential resource map
5. **Domain blocklist** → BLOCK (70+ ad/tracker domains)
6. **Path-based blocking** → BLOCK same-origin paths matching `/ads/`, `/banner/`, `/popup/`, etc.

#### 2b. Navigation Guard (shouldOverrideUrlLoading)
- Blocks unsolicited main-frame navigations to non-provider domains (Type A hijacks)
- `userInitiatedNavigation` flag — set true on user-triggered loads, consumed after first navigation
- Blocks `intent:` URLs (non-Android-navigation hijack bypass)
- Blocks known ad/tracker domains in all navigations

#### 2c. Popup Window Prevention (WebChromeClient)
- `onCreateWindow` returns `false` unconditionally (blocks all popup windows at native level)

#### 2d. Intent URL Blocking (shouldOverrideUrlLoading)
- `url.startsWith("intent:")` returns `true` before any other processing

### Layer 3: Provider-Specific CSS (via providerConfig.ts)

Per-provider CSS rules injected at document-start:

**nxsha** (heaviest config):
- CSS: `display:none !important` for overlay, popup, modal divs (by class, id, inline-style, z-index >= 99)
- Hide selectors: div[class*="overlay|popup|modal|ad-"], a[href*="go."|"click."]
- Hide keywords: "close ad", "skip ad", "advertisement", "sponsored"

**chillflix**: hide login/signup buttons
**screenscape**: hide timer/ad download prompts

---

## The nxsha Popup Problem on Android 16

On some Android devices (notably Android 16), nxsha's page manages to show popups despite all the above layers. Here's what we've traced:

### Observed Behavior
1. Video plays normally for 10-60 seconds
2. A full-page overlay appears (sometimes translucent, sometimes solid)
3. On interaction (tap), redirects to external ad URLs
4. On some devices, hijack chain: `frowstyambler.qpon` → ad landing page
5. **Does NOT happen on:** Brave Browser, Chrome + uBlock Origin on the SAME device

### Suspected Weak Points

1. **Per-provider profile for nxsha is too permissive:**
   ```kotlin
   "web.nxsha.app" to setOf("web.nxsha.app", "workers.dev", "cloudfront.net")
   ```
   `workers.dev` is a wildcard — nxsha uses Cloudflare Workers as BOTH video CDNs AND hijack redirectors. The native layer cannot distinguish between `xbm.video.cdn.workers.dev/playlist.m3u8` (legitimate video) and `hijack-redirect.workers.dev/popup.html` (ad injection) because both match `workers.dev`.

2. **addDocumentStartJavaScript fails for cross-origin child iframes:**
   On MediaTek Helio G35 / Android 14 and possibly Android 16, `addDocumentStartJavaScript` silently fails to inject into cross-origin child iframes. This means nxsha's child iframes (where ads may be injected) don't get the guard script.

3. **JS re-injection timing:**
   The guard script is re-evaluated on `onPageFinished`, but by that point, if the page uses `document.open()` (which some providers do to prevent PageFinished), the re-injection may happen too late or not at all.

4. **No network request cosmetic filtering:**
   We block ad/tracker requests by domain, but we don't do HIDE-GENERIC-style cosmetic filtering (hiding elements based on URL match + CSS selector patterns like EasyList's `##` rules).

5. **No scriptlet injection:**
   uBlock Origin can inject "scriptlets" — small JS snippets that neutralize anti-adblock scripts (e.g., `abort-on-property-read`, `abort-current-inline-script`, `set-constant`). We have no equivalent.

6. **No declarativeNetRequest or Content Blocker API usage:**
   Chrome extensions use `declarativeNetRequest` for efficient rule-based request blocking. Android WebView has no equivalent API — we must use `shouldInterceptRequest` which is called on the UI thread.

---

## The Central Question

### How can we make our Android WebView match Brave Browser's or uBlock Origin's ad-blocking capability for streaming provider pages?

Brave Browser and Chrome+uBlock Origin block ALL ads/popups from nxsha on the same Android 16 device. We need to understand what they do differently and whether we can replicate it in a custom WebView.

#### Specific technical questions:

**Q1. Filter list integration in WebView**
- Brave uses a built-in Rust-based adblock engine with EasyList, EasyPrivacy, uBlock filters etc.
- Chrome extensions use `declarativeNetRequest` / `webRequest`
- Can we integrate a real filter list engine inside WebView's `shouldInterceptRequest`?
- Specifically, we already have `@cliqz/adblocker` in our web package.json — can this run inside an Android WebView's `shouldInterceptRequest`? The SDK provides `FiltersEngine.parseSerialized()` — could we deserialize this on Android and match every subresource request through it?
- How do we handle cosmetic filters (elemHide / `##` rules) without a browser extension API? Can a MutationObserver-based approach reproduce the full cosmetic filtering behavior of Brave/Chrome extensions?

**Q2. Timing of script injection**
- uBlock Origin's content scripts run at `document_start` before any page script executes, via Chrome's content script API (manifest.json `"run_at": "document_start"`).
- Android's `addDocumentStartJavaScript` (AndroidX) is supposed to do the same, but fails for cross-origin iframes on some devices.
- Our `evaluateJavascript` fallback on `onPageFinished` runs too late — ads may have already loaded.
- **Is there a reliable way to inject JS into ALL frames (including cross-origin child iframes) at document_start on Android WebView?**
- Does `shouldInterceptRequest` + HTML rewriting (our existing `injectBridgeIntoHtml`) work for this? It intercepts the iframe's HTML response and injects a bridge — but is there a simpler, more reliable mechanism?

**Q3. Distinguishing video CDN workers from ad workers on shared wildcard domains**
- nxsha uses `workers.dev` for both video streaming and ad/popup injection. These are Cloudflare Workers — the domain prefix changes per session (`xbm.video-session-id.workers.dev`).
- We currently ALLOW all `workers.dev` because video CDN traffic uses it — but ad traffic ALSO uses it.
- uBlock Origin / Brave somehow blocks the ad workers while allowing the video workers.
- **What heuristics do Brave/uBlock use to tell them apart?**
  - Response MIME type (video/* vs text/html)?
  - Request initiator (video element vs script/fetch)?
  - URL path pattern (`.m3u8` / `.ts` / `.mp4` vs `.html` / `.js`)?
  - Request timing / pattern of requests?
  - Referer header / Sec-Fetch-* headers?
- We currently check for `Range` header (video chunk requests always have it) and `Sec-Fetch-Dest: video/audio`. Is this sufficient, or is there a smarter approach?

**Q4. Cosmetic filtering — hiding overlay ads**
- uBlock Origin uses cosmetic filters (`example.com##.ad-overlay-class`) to hide DOM elements on specific pages.
- Brave has a built-in cosmetic filtering engine that runs on every page.
- We currently do:
  - Per-provider CSS rules (hardcoded in providerConfig.ts, ~40 rules)
  - MutationObserver DOM sweeper (hides fixed elements with z-index>50, sweeps every 3s)
  - Skip-ad auto-clicker (clicks buttons containing "skip", "close ad", "continue")
- **What's missing from our cosmetic filtering that Brave/uBlock has?**
  - Generic cosmetic filters (EasyList's `##[class*="ad-"]`, etc.)?
  - Element hiding emulation (procedural filters like `##:has()` selectors)?
  - Scriptlet injection (abort-current-inline-script, set-constant, etc.)?
  - Dynamic cosmetic filtering (content aware)?

**Q5. Anti-anti-adblock (scriptlet injection)**
- Some providers use anti-adblock scripts that detect when `window.fetch` or `XMLHttpRequest` is monkey-patched.
- uBlock Origin's scriptlet injection (`+js(nowoif.js)`, `+js(set-constant.js)`) neutralizes these.
- **Do you know if nxsha or similar streaming providers have anti-adblock detection that could neutralize our JS patching?**
- **How would we implement scriptlet injection in a WebView without the Chrome extension API?**

**Q6. WebView version-specific behavior on Android 16**
- Android 16 ships with a newer Chromium WebView. Are there any known changes in WebView behavior that could affect:
  - `addDocumentStartJavaScript` working in cross-origin iframes?
  - Service Worker behavior?
  - `shouldInterceptRequest` blocking effectiveness?
  - CSP enforcement affecting our injected scripts?

**Q7. Without any of the above — what's the minimal change that would significantly improve our blocking?**

If implementing full EasyList/ublock filter support is impractical in a WebView:
- What's the ONE most impactful improvement we could make?
- The per-provider profile approach catches obvious ad domains. The heuristic approach catches scripts/iframes/images from unknown third parties. What's the highest-impact addition we're missing?

**Q8. Brave's CF challenge handling**
- When we open nxsha in Brave on Android, Cloudflare doesn't show a challenge page. How does Brave handle this without FlareSolverr?
- We know Brave uses Rustls (Rust TLS library) instead of BoringSSL/OpenSSL. Does Rustls's JA3 fingerprint naturally avoid CF detection?
- If so, can we somehow replicate this in Android WebView (e.g., via a different WebView implementation, or by configuring Chromium's TLS settings)?

---

## Current WebView Setup (Android Native Module)

Key code in `PlayerWebViewOverlayView.kt`:

```kotlin
// Domain profile: only these are allowed for each provider
"web.nxsha.app" to setOf("web.nxsha.app", "workers.dev", "cloudfront.net")

// Heuristic: block scripts/iframes/images from unknown third parties
if (secFetchDest in setOf("iframe", "script", "image")) {
  val isRefererMatching = headers["Referer"]?.contains(currentHost) == true
  if (isProviderReferer && host != currentHost) {
    return BLOCK  // heuristic block
  }
}

// Video CDN detection: Range header or video/audio Sec-Fetch-Dest => ALLOW
if (hasRangeHeader || secFetchDest in setOf("video", "audio")) {
  return ALLOW
}

// Popup block: WebChromeClient.onCreateWindow returns false
override fun onCreateWindow(view, isDialog, isUserGesture, resultMsg): Boolean = false

// Navigation guard: block unsolicited main-frame navigations
if (request.isForMainFrame && !userInitiatedNavigation) {
  if (targetHost != currentHost) return BLOCK
}

// PageFinished re-injection of guard script
override fun onPageFinished(view, url) {
  wv?.evaluateJavascript(injectedScript, null)
  // Guard script re-evaluated here
}
```

---

## Relevant Files

| File | Purpose |
|------|---------|
| `apps/mobile/app/watch/[...id].tsx` | WatchScreen — renders VideoWebView |
| `apps/mobile/components/VideoWebView.tsx` | State management, embed URL building, JS guard injection |
| `apps/mobile/components/providerConfig.ts` | Per-provider CSS rules, hide selectors, hide keywords |
| `apps/mobile/modules/player-webview/.../PlayerWebViewOverlayView.kt` | Native Android WebView with all ad blocking logic |
| `apps/mobile/modules/player-webview/.../PlayerwebviewModule.kt` | Expo module registration, clearAllState |
| `packages/shared/src/security/playerGuard.ts` | Shared 15-layer guard script template |
| `apps/web/lib/movieProviders/protection.ts` | Web proxy protection scripts (for reference — includes @cliqz/adblocker integration) |
