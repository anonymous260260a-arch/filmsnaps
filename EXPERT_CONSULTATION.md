# Expert Consultation: Web Video Player — Ad/Popup Blocking Architecture

## Background

We are building a multi-platform video streaming app (FilmSnaps) that aggregates content from **third-party streaming provider websites**. These providers host embeddable player pages that we render in iframes (web) or WebViews (mobile). The providers are free services that monetize via aggressive advertising — popups, popunders, ad iframes, redirect hijacks, crypto miners, and tracking networks.

We have built an extensive multi-layer protection system, but ads and popups still break through, and the cat-and-mouse dynamic means each provider changes their ad delivery mechanism frequently. We need an expert architect to design a **robust, maintainable ad/popup blocking strategy** that works across all providers without breaking playback.

---

## Architecture Overview

### Platforms

| Platform | Rendering | Injection Method |
|----------|-----------|-----------------|
| **Web** | iframe (cross-origin for Cloudflare providers; same-origin via server proxy for others) | Server-side HTML rewriting + injected `<script>` tags; client-side `SecureIframe` component with navigation guard |
| **Mobile** | Native `PlayerWebView` (Expo module wrapping platform WebView) | `injectedJavaScriptBeforeContentLoaded` — JS injected at document creation |

### Providers

We have ~20 registered providers (6-8 actively enabled). Their embed pages range from:
- **Simple iframe embeds** (just a `<video>` tag, minimal ads)
- **Complex video aggregators** (multiple nested iframes, ad overlays, popunders)
- **Cloudflare-protected** (require challenge clearance, prefer direct iframe loading over proxy)

---

## Current Protection Layers — What We've Tried

### Layer 1: `window.open()` Override (All platforms)

```js
// Simplified — replaces window.open with smart filtering
window.open = function(url, name, features) {
  if (isAdDomain(url)) return null; // AD_PATTERNS list
  return originalOpen.apply(window, arguments);
};
```

**AD_PATTERNS includes:** 80+ patterns for ad networks, trackers, popund services, analytics.

**Problem:** Some providers use `document.createElement('a')` then `.click()` to trigger popups — bypasses `window.open`. Others use `window.location.href = '...'` redirects.

### Layer 2: Network Interception (fetch/XHR) (All platforms)

```js
window.fetch = function(input, init) {
  if (isAdUrl(url)) return Promise.resolve(new Response('', {status: 204}));
  return originalFetch.call(window, input, init);
};
```

**Problem:** Only catches same-origin requests on mobile (injected before content loads). On web with proxy, some requests bypass because they're initiated from cross-origin child iframes. Also, providers are increasingly using `document.createElement('script')` with dynamic `src` attributes that `createElement` interception doesn't catch reliably.

### Layer 3: DOM Mutation Sweeper (All platforms)

```js
// MutationObserver + periodic interval sweeper
new MutationObserver(function(mutations) {
  // Remove ad iframes when they appear in DOM
  // Hide fixed-position, high-z-index overlays that don't contain video
}).observe(document, { childList: true, subtree: true });

setInterval(function() {
  // Sweep: hide fixed overlays, remove hidden iframes, click "Skip Ad" buttons
}, 3000);
```

**Problem:** 
- The sweeper is **heuristic-based** — it looks at z-index, position, and whether the element contains a video element. This means some ad overlays that happen to be near the video get missed, and legitimate UI controls get hidden if they match the heuristics.
- Heavy continuous DOM scanning is a CPU drain (especially on low-end mobile devices).
- Providers are using Shadow DOM to hide ads from the MutationObserver.

### Layer 4: Click Interception & Navigation Blocking (All platforms)

```js
document.addEventListener('click', function(e) {
  // Block clicks on links pointing to external domains
  // Block a[target="_blank"]
  // Block context menu on external links
}, true); // capture phase
```

**Problem:** Some providers use touch events, mousedown, or pointer events instead of click — these bypass click capture. Others use invisible overlay `<div>` elements with their own click handlers that intercept clicks intended for the video player (play/pause).

### Layer 5: Location Locking (Web — server proxy path)

```js
Object.defineProperty(window, 'location', {
  configurable: false,
  get: function() { return safeLocation; },
  set: function(v) { /* blocked */ }
});
```

**Problem:** 
- Only applies when provider HTML is served through our server-side proxy (same-origin).
- Cloudflare-protected providers (nxsha, chillflix) must load directly via iframe (cross-origin) — we CANNOT inject location locking there because cross-origin restrictions prevent access.
- Some provider scripts detect the frozen location and purposely crash the page.

### Layer 6: Service Worker Neutralization (All platforms)

```js
navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
navigator.serviceWorker.register = () => Promise.reject(new Error('Blocked'));
```

**Problem:** On mobile, some providers register service workers before our script can run (race condition in `injectedJavaScriptBeforeContentLoaded`). Once a service worker is active, it can intercept all fetch requests and serve ads even after our network interception is in place.

### Layer 7: Server-Side Proxy & HTML Rewriting (Web only)

```ts
// apps/web/app/api/player/[provider]/[...path]/route.ts
// Fetches provider HTML, rewrites all asset URLs through our proxy,
// blocks URLs matching DEFAULT_BLOCKED_PATTERNS, injects protection scripts
```

This is our most powerful tool on web — it rewrites the provider's HTML **before it reaches the browser**, allowing us to:
- Remove tracking scripts entirely (not just block them at runtime)
- Rewrite ad iframe `src` to point to our proxy (which returns empty 204 responses)
- Inject our protection scripts at the top of `<head>` before any provider code runs
- Set a restrictive Content-Security-Policy

**Problems:**
1. **Provider compatibility:** ~40% of providers break when proxied (Cloudflare challenge loops, broken relative URLs, redirect loops)
2. **Maintenance burden:** Each provider's embed page has a different HTML structure — a rewrite rule that works for Provider A breaks Provider B
3. **Redirect chains:** Some providers issue multiple `302` redirects that lose our proxy context
4. **Dynamic content:** video players loaded via JS after DOMContentLoaded aren't caught by our static HTML rewriting
5. **CSP bypass:** The very permissive CSP we need for video playback (blob:, data:, 'unsafe-inline', 'unsafe-eval') leaves the door open for ads
6. **Form-Action is blocked by navigate-to:** Chrome is dropping `navigate-to` CSP directive support

### Layer 8: CPU Abuse Watchdog (Web SecureIframe)

Monitors if the iframe thread is using excessive CPU (lagging behind expected timer deadlines). If CPU is pegged for 3+ consecutive checks (>300ms lag per 3s window), it blanks the iframe and shows a warning. This catches crypto miners and runaway ad scripts.

**Problem:** False positives — legitimate buffering or video decoding can trigger the watchdog on low-end devices.

### Layer 9: Popup Focus Reclaim (Web SecureIframe)

```js
window.addEventListener('blur', () => {
  // Continuously reclaim focus when a popup steals it
  setInterval(() => { window.focus(); }, 50);
});
```

**Problem:** Browsers now block `window.focus()` calls not triggered by user gesture — this is mostly ineffective in modern Chrome/Edge.

### Layer 10: `Node.prototype.appendChild` Interception (Mobile)

```js
var _origAppendChild = Node.prototype.appendChild;
Node.prototype.appendChild = function(node) {
  // Identify video-carrying iframes and protect them from removal
  // Block appendChild for ad iframes
};
```

**Problem:** Some providers detect the monkey-patched `appendChild` and throw errors, breaking the page entirely. The interception also doesn't work for Shadow DOM content.

---

## Known Issues & Gaps

### Critical: Cloudflare Provider Gap (Web)
Providers that use Cloudflare (nxsha, chillflix) MUST load via direct cross-origin iframe — Cloudflare challenge pages break when proxied. This means we have **ZERO JS injection capability** on these providers' pages. Our only defense is the outer `SecureIframe` component's navigation guard and popup reclaim, which are weak.

### Critical: Mobile Popup Escapes
On mobile (Expo `PlayerWebView`), some providers manage to open popups via:
1. `window.open` before our injection runs (race condition)
2. `<a target="_blank">` clicks that the WebView opens in a system browser
3. Intent URLs (`intent://`) that trigger Android system activities
4. `window.location` assignments that trigger navigation

### Critical: Child Iframe Ad Loading
Provider pages often load the actual video player in a **child iframe** (cross-origin from the provider's page). Our injected JS runs in the top frame of the provider page, but:
- We can't intercept fetch calls made from the child iframe
- We can't remove DOM elements from the child iframe
- The child iframe can open popups independently
- Some providers host the video on a completely separate domain from the ad content

### Problematic: Ad Overlays Over Video
Many providers show semi-transparent ad banners overlaid on the video player. Our sweeper tries to remove `position: fixed` elements with high z-index, but:
- Some video controls ARE fixed position with high z-index
- Some ads use `position: absolute` within the video container
- Some ads insert themselves as pseudo-elements (::before, ::after)

### Problematic: Redirect Chain Hijacking
When clicking play on some providers, the user gets redirected through 3-4 ad domains before landing on the actual video. Our navigation blocker catches some but not all of these chains, especially on mobile where the WebView's native navigation delegate can override our JS.

### Problematic: Self-Healing Ad Scripts
Sophisticated providers check periodically if their ad elements are still in the DOM. If our sweeper removes them, they get re-injected within 500ms. Our mutation observer re-removes them, creating a CPU loop.

### Problematic: Polymorphic Ad Delivery
Some providers serve ads from the same CDN/domain as the video content itself, making URL-pattern-based blocking impossible without also breaking the video.

---

## What We Need From You

### Primary Goal
Design a **comprehensive ad/popup blocking strategy** that:
1. Blocks all popups, popunders, and redirect hijacks across all providers
2. Blocks ad iframes, tracking pixels, analytics beacons, and crypto miners
3. Does NOT break video playback or interfere with legitimate provider functionality
4. Works on both **web** (same-origin proxy + cross-origin iframe) and **mobile** (React Native WebView)
5. Is **maintainable** — doesn't require per-provider rules for every new provider

### Specific Questions

1. **Architecture** — What is the right architecture for ad blocking in this context?
   - Service Worker-based interception?
   - Native-level request blocking (WebView `shouldInterceptRequest` on Android, `WKNavigationDelegate` on iOS)?
   - Electron/Browser extension-level API (webRequest, declarativeNetRequest)?
   - Service Worker as a fetch proxy?
   - A lightweight uBlock Origin–style approach with compiled filter lists?

2. **uBlock Origin integration** — Can we integrate uBlock Origin's filter list compilation into our server-side proxy? The proxy already rewrites HTML — could it also filter resources against EasyList + EasyPrivacy before they reach the browser?

3. **Child iframe problem** — How do we handle ad loading inside a cross-origin child iframe (where our JS can't reach)?

4. **Cloudflare providers** — For providers that can't be proxied, how can we achieve ad blocking in a cross-origin iframe when we can't inject any JS into their page?

5. **Mobile native blocking** — What's the best native-level approach?
   - Android: Should we intercept all requests in `shouldInterceptRequest` and block ad URLs at the native layer?
   - iOS: Should we use `WKNavigationDelegate.decidePolicyForNavigationAction`?
   - Can we use `WebView.setWebContentsDebuggingEnabled` for debugging?

6. **Race conditions** — Our `injectedJavaScriptBeforeContentLoaded` sometimes misses early window.open calls and service worker registrations. How can we win this race reliably?

7. **Shadow DOM** — Some providers use Shadow DOM to hide ad elements. Can we detect and remove ads in Shadow DOM without breaking the page?

8. **CSP strategy** — We currently use a very permissive CSP. Can we design a CSP that blocks ad content while allowing video playback? What about `navigate-to` deprecation?

9. **Filter list maintenance** — Ad domain patterns change weekly. What's the recommended approach for keeping filter lists up to date? Can we compile EasyList into a compact format our server-side proxy uses?

10. **Performance** — Our current DOM sweeper runs every 3s and scans all elements. What's the right approach for ad removal that doesn't drain CPU?

### Constraints

- **No user authentication** — local-first, no backend accounts
- **Must not break video playback** — blocking a legitimate domain that also serves video content is unacceptable
- **Cross-platform** — solution must work on web (desktop browser + Electron) and mobile (Android + iOS)
- **Minimal CPU** — can't peg the main thread scanning the DOM on low-end Android devices
- **No browser extensions** — must work in standard browser contexts (no extension API access)
- **Cloudflare compatibility** — must not interfere with Cloudflare challenge resolution
- **Maintenance budget** — we have limited time for per-provider workarounds; the solution should be mostly automatic

---

## Relevant Code Locations

| File | Purpose |
|------|---------|
| `packages/shared/src/security/playerGuard.ts` | 15-layer guard script builder (pure JS) |
| `apps/web/components/player/SecureIframe.tsx` | Web iframe wrapper with nav guard, popup reclaim, CPU watchdog |
| `apps/web/components/player/PlayerProvider.tsx` | Web player state context |
| `apps/web/app/watch/[...id]/WatchClient.tsx` | Web player page — composes player components |
| `apps/web/app/api/player/[provider]/[...path]/route.ts` | **Key file** - Server-side proxy fetches provider HTML, rewrites assets, injects protection |
| `apps/web/app/api/player/[provider]/asset/route.ts` | Asset proxy — proxies individual assets through server |
| `apps/web/lib/movieProviders/protection.ts` | **Key file** - All protection logic: URL filtering, nav blocker script, runtime protection script, HTML rewriting |
| `apps/web/lib/movieProviders/providers.ts` | Old provider registry |
| `packages/shared/src/providers/registry.ts` | Current provider registry |
| `apps/mobile/components/VideoWebView.tsx` | **Key file** — Mobile player with inline guard scripts and native WebView wrapper |
| `apps/mobile/components/player/ServerPickerSheet.tsx` | Mobile server picker (receives provider list) |
| `apps/mobile/modules/player-webview/` | Native WebView module for Expo |
| `packages/shared/src/providers/health.ts` | Provider health checking |

---

## How to Proceed

1. **Review** the code files listed above (especially `protection.ts`, `VideoWebView.tsx`, `route.ts`, and `playerGuard.ts`)
2. **Design** a comprehensive ad blocking architecture that addresses all the problems above
3. **Provide** your solution as:
   - Architecture diagram / written architecture description
   - Specific implementation steps for each layer
   - Code snippets for key parts (filter list format, native interception hooks, CSP configuration)
   - Migration path from current system to proposed system
4. **Anticipate** edge cases: what happens when a provider changes their page layout, when Chrome changes security policies, when new ad delivery mechanisms emerge

**The final deliverable** should be a detailed implementation plan we can hand off to our development team that covers all platforms (web, mobile Android, mobile iOS) and all 6 active providers.
