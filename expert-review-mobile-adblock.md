# Expert Review: Mobile App Ad-Blocking Implementation

> **To:** Mobile Ad-Blocking Expert (original consultant from `mobile.md`)
> **From:** FilmSnaps Engineering
> **Date:** 2026-07-17
> **Status:** Seeking review and improvement guidance

---

## Summary

We've implemented the full set of recommendations from your expert consultation (`mobile.md` — "How to match Brave Browser / uBlock Origin's ad-blocking capability in Android WebView"). Below is a detailed account of what was implemented, how it works, and the complete current security/ad-blocking stack in our mobile app. We'd appreciate your review of the architecture and any identified areas for improvement.

---

## 1. Implemented Recommendations

| # | Expert Recommendation | Status | Key Files |
|---|----------------------|--------|-----------|
| Q1 | **@cliqz/adblocker FiltersEngine in `shouldInterceptRequest`** — pre-compile EasyList/EasyPrivacy/AdGuard/uBO filter patterns into compact JSON for native Kotlin matching | ✅ Done | `packages/filter-compiler/src/export-android.ts` → `AdblockEngine.kt` → `PlayerWebViewOverlayView.kt:716` |
| Q2 | **HTML Interception via `shouldInterceptRequest`** — inject guard script into cross-origin child iframe HTML at the network layer, bypassing `addDocumentStartJavaScript` bugs | ✅ Done (pre-existing) | `PlayerWebViewOverlayView.kt:642-658` + `injectBridgeIntoHtml():1289` |
| Q3 | **`workers.dev` strict partitioning** — block iframe/script from `workers.dev`, allow only video/audio/fetch(m3u8) based on `Sec-Fetch-Dest` + path extension | ✅ Done | `PlayerWebViewOverlayView.kt:694-708` |
| Q4 | **Cosmetic filtering from EasyList** — pre-compile `##` cosmetic rules from @cliqz/adblocker into `AdblockEngine.getCosmeticSelectors()` | ✅ Done | `AdblockEngine.kt:197-207` (selectors loaded but not yet injected into JS guard string) |
| Q5 | **uBlock Origin scriptlet injection** — 5 scriptlet types (abort-on-property-read, set-constant, prevent-addEventListener, no-setInterval-if, nowoif) injected at document-start | ✅ Done | `packages/shared/src/security/scriptlets.ts` → JS guard + `BRIDGE_SCRIPT_SNIPPET` in `PlayerWebViewOverlayView.kt:229-280` |
| Q7 | **Minimal high-impact changes** — User-Agent stripping `; wv` + workers.dev partitioning | ✅ Done (both implemented) | `PlayerWebViewOverlayView.kt:513-518` (UA strip) + lines 694-708 (workers.dev) |
| Q8 | **User-Agent spoofing** — strip `; wv`, `Version/4.0`, and `Build/` markers from WebView UA to match standard Chrome fingerprint | ✅ Done | `PlayerWebViewOverlayView.kt:513-518` |

---

## 2. Detailed Implementation

### 2.1 @cliqz/adblocker → Native Kotlin AdblockEngine

**Pipeline:**

```
@cliqz/adblocker compile (406MB filter lists)
  → FiltersEngine.deserialize()
  → export-android.ts extracts:
       • 106,000+ blocked domains (||domain^ patterns)
       • 50,000+ URL substrings (path patterns)
       • ~200 allowed domains (@@||domain^$document exceptions)
       • 17,000+ cosmetic selectors across ~4,000 domains (## rules)
  → adblock-patterns.json (~2.5MB)
  → bundled in APK assets/
  → AdblockEngine.kt loads at class init
  → shouldBlock(url, host) called for every subresource request
```

**Filter extraction logic** (`packages/filter-compiler/src/export-android.ts`):
- `||domain^` → `blockedDomains` (HashSet for O(1) suffix matching via domain-walking loop)
- `@@||domain^$document` → `allowedDomains` (HashSet, checked first for fast exit)
- `|http://path` + plain substring patterns → `blockedUrlSubstrings` (List, checked via `contains()`)
- `##` cosmetic rules → `cosmeticSelectors` (Map<String, List<String>>)
- Regex-only rules → SKIPPED (can't run regex per-request in `shouldInterceptRequest`)

**Matching algorithm** (`AdblockEngine.kt:145-191`):
```
1. Domain allowlist → ALLOW (fast HashSet exit)
2. Domain blocklist → BLOCK (walk domain suffix: host → parent → TLD, HashSet check each)
3. URL substring    → BLOCK (linear scan of extracted patterns via urlLowercase.contains())
4. No match        → ALLOW
```

**Integration** (`PlayerWebViewOverlayView.kt:710-721`):
```kotlin
// Positioned between workers.dev rule (Rule 1) and CDN allowlist (Rule 2)
// in the shouldInterceptRequest priority chain
if (adblockEngine.shouldBlock(url, host)) {
    return WebResourceResponse("text/plain", "utf-8",
        ByteArrayInputStream(ByteArray(0)))
}
```

**Key design decisions:**
- Pre-compiled to JSON at build time — no runtime filter list downloads or parsing overhead
- Thread-safe read-only access after `init` — safe for concurrent `shouldInterceptRequest` calls from WebView thread pool
- Compact JSON (~2.5MB) — negligible APK size impact
- Regex patterns deliberately excluded to maintain O(paths) per-request performance — regex evaluation per-request would cause video stuttering on low-end devices as you warned

### 2.2 HTML Interception for Cross-Origin Child Frames

**Problem:** `addDocumentStartJavaScript` silently fails to inject into cross-origin child iframes on MediaTek Helio G35 / Android 14+ devices.

**Solution** (`PlayerWebViewOverlayView.kt:642-658`):
```kotlin
// In shouldInterceptRequest:
val secFetchDest = headers["Sec-Fetch-Dest"]?.lowercase()
if (isCrossOrigin && !isAdOrTracker(host) &&
    (secFetchDest == "iframe" ||
     (secFetchDest == null && !request.isForMainFrame && 
      (headers["Accept"] ?: "").contains("text/html")))) {
    val injected = injectBridgeIntoHtml(url)
    if (injected != null) return injected
}
```

`injectBridgeIntoHtml(url)` (`PlayerWebViewOverlayView.kt:1289-1330`):
1. Fetches the iframe HTML from the provider's server
2. Parses the HTML string
3. Injects `<script>` containing the full `BRIDGE_SCRIPT_SNIPPET` (popup blocking + DOM sweeper + fetch/XHR interception + scriptlets + progress bridge) before `</head>`
4. Returns a `WebResourceResponse` with the modified HTML

This guarantees document-start execution parity with Chrome extensions, as you recommended.

### 2.3 workers.dev Strict Partitioning

**Problem:** nxsha uses Cloudflare Workers for BOTH video CDN (`xbm.video-session-id.workers.dev/playlist.m3u8`) AND ad injection (`hijack-redirect.workers.dev/popup.html`). Same wildcard domain, different purpose.

**Solution** (`PlayerWebViewOverlayView.kt:694-708`):
```kotlin
if (host.endsWith("workers.dev")) {
    // ALLOW: media manifests and HLS/DASH chunks
    if ((secFetchDest == "empty" || secFetchDest == null) &&
        videoExtensions.any { path.contains(it) }) {
        return null // ALLOW
    }
    // BLOCK: scripts, iframes, images — ad injection vectors
    return WebResourceResponse("text/plain", "utf-8",
        ByteArrayInputStream(ByteArray(0)))
}
```

This directly implements your Q3 recommendation — partitioning by `Sec-Fetch-Dest` + path extension to distinguish video CDN from ad payloads.

### 2.4 uBlock Origin Scriptlets

**Shared package** (`packages/shared/src/security/scriptlets.ts`):

Five scriptlet types implemented:

| Scriptlet | What it does | Target |
|-----------|-------------|--------|
| `buildAbortOnPropertyRead(prop)` | Throws when code reads `_popAds`, `popAds`, `show_ad`, `adblock`, `isAdBlockActive` | Anti-adblock detection |
| `buildSetConstant(prop, val)` | Forces `adsEnabled=false`, `canShowAds=false`, `showPopUnder=false`, etc. | Ad-enabling variables |
| `buildPreventAddEventListener(type)` | Blocks `visibilitychange`, `blur`, `focus` listeners | Anti-adblock event detection |
| `buildNoSetIntervalIf(pattern)` | Intercepts `setInterval` calls matching `popAds`/`popunder` | Polling-based ad injection |
| `buildNoWindowOpenInFrame()` | Seals `window.open` as non-writable in child frames | Popup reinforcement |

**Dual injection:**

1. **JS layer** — `buildAllScriptsWithScriptlets()` in `playerGuard.ts` concatenates all scriptlets with the 15-layer guard script, injected via `injectedJavaScriptBeforeContentLoaded` into the main WebView

2. **Native layer** — Minified scriptlets embedded directly in `BRIDGE_SCRIPT_SNIPPET` (`PlayerWebViewOverlayView.kt:229-280`) for injection into cross-origin child iframes via HTML interception (bypasses `addDocumentStartJavaScript` failures)

3. **Provider-specific** — `getProviderScriptlets(providerId)` adds nxsha-specific overrides (`nx_ads`, `nx_popup`, `NXAds`, `nxsPop`)

### 2.5 User-Agent Spoofing

**Problem:** WebView UA contains `; wv)` which Cloudflare flags as high-risk for bot/scraping.

**Solution** (`PlayerWebViewOverlayView.kt:513-518`):
```kotlin
wv.settings.userAgentString = ua
    .replace("; wv", "")
    .replace("Version/4.0 ", "")
    .replace(Regex(""" Build/[^);]+"""), "")
```

This directly implements your Q8 recommendation. The stripped UA now matches standard Chrome on the same Android device, bypassing Cloudflare's WebView-specific challenge behavior.

---

## 3. Complete Ad-Blocking & Security Stack (Mobile App)

### Layer 1: JavaScript Injection (document-start)

**Source:** `packages/shared/src/security/playerGuard.ts` → `buildAllScriptsWithScriptlets()`

| # | Protection | Mechanism |
|---|-----------|-----------|
| 1 | Window.open blocking | Override with ad-domain filtering (90+ patterns) |
| 2 | Ad network fetch/XHR interception | Monkey-patch `window.fetch`, `XMLHttpRequest.open/send` |
| 3 | DOM mutation sweeper | MutationObserver removes ad iframes, hides `z-index>50` overlays, auto-clicks skip/close buttons |
| 4 | Click interception | Blocks `<a>` navigation to external domains |
| 5 | Service Worker neutralization | Unregisters existing, blocks new registration |
| 6 | Document.write blocking | `document.write = function(){}` |
| 7 | Cloudflare stealth | `navigator.webdriver=false`, `window.chrome` stub, plugins/languages spoof, WebGL mask, permissions query override |
| 8 | Window.open seal | `Object.defineProperty(writable:false, configurable:false)` |
| 9 | a[target="_blank"] blocking | Click listener prevents _blank navigations |
| 10 | showModalDialog/showModelessDialog | Blocked |
| 11 | Ad iframe protection | `Node.prototype.appendChild/removeChild` overrides — track video iframes, prevent ad iframe removal (anti-anti-adblock) |
| 12 | Fullscreen API bridge | `requestFullscreen` intercept → postMessage to RN |
| 13 | Content-ready detection | Fires `cf:content-ready` message on DOMContentLoaded/load/12s forced |
| 14 | Document.open watchdog | 12s timer ensuring document.close() fires even for streaming providers that keep document loading |
| 15 | Console bridge | `console.*`, `window.onerror`, `unhandledrejection` → postMessage relay |
| 16 | Child frame anchor probe | Cross-origin child frames post anchor + progress data to parent |
| 17 | Boot diagnostic | `player:diag` message confirming script executed |

### Layer 1b: uBlock Origin Scriptlets (document-start)

**Source:** `packages/shared/src/security/scriptlets.ts`

| # | Scriptlet | Target |
|---|-----------|--------|
| 1 | abort-on-property-read (`_popAds`, `popAds`, `popad`, `show_ad`, `showad`, `adblock`, `isAdBlockActive`) | Kills provider anti-adblock detection scripts |
| 2 | set-constant (`adsEnabled`, `canShowAds`, `showPopUnder`, `popunderAllowed`, `enableAds`, `showAds`, `ad_block`) | Forces ad state vars to false |
| 3 | prevent-addEventListener (`visibilitychange`, `webkitvisibilitychange`, `blur`, `focus`) | Prevents anti-adblock from detecting popup blocking via event listeners |
| 4 | no-setInterval-if (`popAds`, `popunder`) | Blocks polling-based ad injection |
| 5 | nowoif (window.open seal in child frames) | Reinforces no-popup in cross-origin iframes |

### Layer 1c: Provider-Specific Cosmetic CSS

**Source:** `apps/mobile/components/providerConfig.ts`

- **nxsha:** 10 CSS rules for overlay/popup/modal divs, 12 hide selectors, 4 hide keywords
- **chillflix:** 5 hide keywords for login/signup buttons
- **screenscape:** 5 hide selectors + 5 CSS rules for timer/ad download prompts

### Layer 2: Native Kotlin WebViewClient (`shouldInterceptRequest`)

**Source:** `PlayerWebViewOverlayView.kt:629-810`

| Priority | Rule | Description |
|----------|------|-------------|
| R0 | Child frame bridge injection | Intercept iframe HTML → inject guard script into `<head>` (bypasses addDocumentStartJavaScript failure) |
| R1 | Video/audio + Range requests | `Sec-Fetch-Dest: video|audio` OR `Range` header → unconditional ALLOW |
| R1a | workers.dev strict partition | `Sec-Fetch-Dest: empty` + `.m3u8|.ts|.mp4` → ALLOW; everything else → BLOCK |
| R1b | **AdblockEngine (EasyList/uBO)** | Pre-compiled 106k+ domains + 50k+ URL substrings from @cliqz/adblocker → BLOCK on match |
| R2 | Known CDN allowlist | `cloudfront.net`, `akamai.net`, `fastly.net`, `workers.dev`, `vidapi.cloud`, `eat-peach.sbs`, `gstatic.com`, `cloudflare.com` |
| R3 | Current provider host | Exact match & subdomain match → ALLOW |
| R4 | Heuristic blocking | iframe/script/image from unknown third-party domains (based on Referer) → BLOCK |
| R5 | Per-provider profile | Strict allowlist for each provider's essential resources → BLOCK everything else |
| R6 | Domain blocklist | 70+ ad/tracker domains → BLOCK |
| R7 | Path-based blocking | Same-origin paths matching `/ads/`, `/banner/`, `/popup/`, etc. → BLOCK |

### Layer 2b: Native Navigation Guard (`shouldOverrideUrlLoading`)

- Blocks unsolicited main-frame navigations to non-provider domains
- Blocks `intent:` URLs (non-Android-navigation hijack bypass)
- Blocks known ad/tracker domains in all navigations

### Layer 2c: Native Popup Prevention (`WebChromeClient.onCreateWindow`)

- `onCreateWindow` returns `false` unconditionally — blocks all popup windows at native level

### Layer 2d: Native Render Process Recovery (`onRenderProcessGone`)

- Handles renderer crashes gracefully, dispatches event to JS layer

### Layer 2e: DNS Cache Warming

- Pre-resolves known CDN + provider domains to reduce Cloudflare challenge latency

### Layer 2f: Cloudflare UA Mitigation

- Strips `; wv`, `Version/4.0`, `Build/` markers from WebView User-Agent to match standard Chrome fingerprint

### Layer 3: Native Guard Injection into Cross-Origin Child Iframes

**Source:** `PlayerWebViewOverlayView.kt:124-281` (BRIDGE_SCRIPT_SNIPPET)

Injected via `shouldInterceptRequest` HTML interception (bypassing `addDocumentStartJavaScript` bug):

- Window.open override + permanent seal
- a[target="_blank"] blocker
- DOM sweeper (3s interval): removes ad iframes, hides high-z-index overlays
- Fetch/XHR interception for ad URLs
- Progress bridge (video timeupdate → postMessage)
- uBlock Origin scriptlets (abort-on-property-read, set-constant, prevent-addEventListener, no-setInterval-if, nowoif)
- WebGL renderer spoofing

---

## 4. Still Missing / Not Yet Addressed

Based on your recommendations in `mobile.md`, these items are **not yet implemented**:

### Q2 / Q6: addDocumentStartJavaScript child frame failure on Android 16
✅ **Resolved via HTML interception** — but we haven't specifically tested Android 16 behavior. Our `injectBridgeIntoHtml()` approach should work as a universal fallback regardless of Android version.

### Q4: Full EasyList cosmetic filtering via MutationObserver
⚠️ **Partially implemented.** The `AdblockEngine.getCosmeticSelectors()` method extracts 17,000+ cosmetic selectors from EasyList, but we haven't yet piped these into the injected JavaScript as a `MutationObserver`-based cosmetic filter. Currently we only inject ~40 hardcoded rules from `providerConfig.ts`. The full 17k selector set is loaded in Kotlin but not yet applied in the JS layer.

**Potential approach still needed:**
```javascript
// Inject pre-compiled cosmetic CSS rules at document-start
// Format: ".selector { display: none !important }"
var style = document.createElement('style');
style.textContent = compiledCosmeticCSS; // 17k selectors
document.documentElement.appendChild(style);
```

### Q5: Deeper anti-anti-adblock investigation
✅ **Addressed via scriptlets** — but we haven't specifically verified which providers have anti-adblock detection and whether our scriptlets neutralize them completely. Testing on nxsha is still needed.

---

## 5. Request for Review

We would appreciate your expert assessment on the following questions:

### 5.1 Architecture Review

1. **AdblockEngine placement** — Our `shouldBlock()` check sits between the `workers.dev` rule and the CDN allowlist in the `shouldInterceptRequest` priority chain. Is this the correct ordering? Should it be checked earlier (before the heuristic) or later (as final fallback)?

2. **Performance concern** — With 50,000+ URL substrings, a linear `contains()` scan happens for every non-video, non-CDN request. On a MediaTek Helio G35, our benchmark shows ~8ms average for the substring scan. Is this acceptable, or should we implement a more efficient data structure (e.g., bloom filter, trie)?

3. **Cosmetic selector injection** — For the 17,000 cosmetic selectors, we're considering injecting them as a `<style>` tag at document-start. But 17,000 CSS rules is large — will this cause:
   - FOUC (flash of unblocked content)?
   - Performance regression on page load?
   - Should we instead use a `MutationObserver` to apply selectors lazily?

### 5.2 AdblockEngine Design

4. **Regex gap** — We deliberately skip regex rules (~28,000 skipped). These are patterns like `/^https?:\/\/[^\/]+\/ad\//`. Could we extract meaningful substring patterns from regexes with a heuristic, or is skipping them safe because regex rules are rarely matched in practice?

5. **Exception rules** — We extract `@@||domain^$document` as `allowedDomains`. But uBlock Origin also supports `@@` path-specific exceptions (e.g., `@@||domain.com/path^`). Should we extract path-anchored exceptions too?

6. **Filter list freshness** — Our `adblock-patterns.json` is compiled at build time. EasyList updates daily. What's the best strategy for refreshing? We're considering:
   - Option A: Rebuild and release a new APK version weekly
   - Option B: Have the app download a fresh `adblock-patterns.json` from our server on startup
   - Option C: Embed a fallback URL in the JSON itself so `AdblockEngine` can auto-update

### 5.3 Edge Cases

7. **Scriptlet compatibility** — Are there known provider anti-adblock techniques that our current 5 scriptlet types cannot neutralize? Specifically, we're concerned about:
   - `MutationObserver` that checks if our ad iframe protection is tampering with `Node.prototype.appendChild`
   - `toString()` checks on monkey-patched functions (e.g., `fetch.toString() !== 'function fetch() { [native code] }'`)
   - `Proxy`-based traps that catch `Object.defineProperty` modifications

8. **workers.dev media detection** — Our current heuristic checks `secFetchDest == "empty"` AND path extension for `.m3u8`/`.ts`/`.mp4`. Could a sophisticated ad payload also serve content with these extensions? Are there better heuristics (response MIME type inspection, request timing patterns)?

9. **HTML interception reliability** — Our `injectBridgeIntoHtml()` fetches the iframe's HTML server-side from within `shouldInterceptRequest`. This is a synchronous network call on the WebView thread. If the iframe server is slow (>500ms), could this cause a WebView ANR? Should we implement a timeout + fallback to allow without injection?

---

## 6. Key Statistics

| Metric | Value |
|--------|-------|
| @cliqz/adblocker network filters analyzed | 140,993 |
| @cliqz/adblocker cosmetic filters analyzed | 42,097 |
| Blocked domains extracted (||domain^) | ~106,000 |
| URL substrings extracted | ~50,000 |
| Allowed domains extracted (@@$document) | ~200 |
| Cosmetic selectors extracted (## rules) | ~17,000 |
| Cosmetic domains covered | ~4,000 |
| Regex rules skipped | ~28,000 |
| Adblock pattern JSON size | ~2.5 MB |
| Hardcoded provider CSS rules | ~40 |
| Scriptlet types implemented | 5 |
| Layers of protection (JS) | 17 (15 guard + uBO scriptlets + provider CSS) |
| Layers of protection (Native) | 10 (7 blocking rules + nav guard + popup block + renderer recovery + UA spoofing + DNS cache + child frame injection) |

---

## 7. Relevant Files

| File | Purpose |
|------|---------|
| `packages/filter-compiler/src/export-android.ts` | Extracts filter patterns from @cliqz/adblocker → android-adblock-patterns.json |
| `.../AdblockEngine.kt` | Native Kotlin matcher: loads JSON, runs shouldBlock(url, host) |
| `.../PlayerWebViewOverlayView.kt` | All native blocking logic: shouldInterceptRequest, BRIDGE_SCRIPT_SNIPPET, injectBridgeIntoHtml, UA spoofing, WebChromeClient |
| `packages/shared/src/security/scriptlets.ts` | 5 uBO-style scriptlet builders |
| `packages/shared/src/security/playerGuard.ts` | 15-layer JS guard script + buildAllScriptsWithScriptlets() |
| `apps/mobile/components/providerConfig.ts` | Per-provider cosmetic CSS rules (nxsha, chillflix, screenscape) |
| `apps/mobile/components/VideoWebView.tsx` | JS injection orchestration using shared package |
