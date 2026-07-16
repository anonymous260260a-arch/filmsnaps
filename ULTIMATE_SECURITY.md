# FilmSnaps Ad/Popup Blocking Architecture & Implementation Plan

## Table of Contents
1. [Executive Summary & Core Insight](#1-executive-summary--core-insight)
2. [Current-State vs. Target-State Architecture](#2-current-state-vs-target-state-architecture)
3. [The "Brave/uBlock Origin" Target Experience](#3-the-braveublock-origin-target-experience)
4. [The Sandbox Detection Problem & Solution](#4-the-sandbox-detection-problem--solution)
5. [Target Architecture Layers](#5-target-architecture-layers)
6. [Detailed Implementation Guide & Code Snippets](#6-detailed-implementation-guide--code-snippets)
7. [Edge Cases & Mitigations](#7-edge-cases--mitigations)
8. [Phased Migration & Implementation Plan](#8-phased-migration--implementation-plan)

---

## 1. Executive Summary & Core Insight

FilmSnaps currently relies on a 10+ layer heuristic protection system (DOM scrapers, `window.open` overrides, `appendChild` interception, CPU watchdogs, location locking). This approach fights ad scripts *after* they have loaded, resulting in a CPU-heavy, fragile cat-and-mouse game that providers easily bypass using Shadow DOM, `a.click()` redirects, and race conditions.

**The Core Insight:** We must shift the battle from the DOM to the Network Layer. 

The architecture used by Brave Browser and uBlock Origin relies on two things: **declarative network blocking** (using compiled EasyList filters) and **cosmetic CSS**. By integrating the `@cliqz/adblocker` library (the exact engine used by Brave), applying it server-side on web, and utilizing native WebView APIs on mobile, we can achieve the seamless, zero-ad experience of uBlock Origin without the endless maintenance.

---

## 2. Current-State vs. Target-State Architecture

**Current State (Fragile):**
- 80% DOM/Runtime hacks (MutationObservers, appendChild patches, location freezes)
- 20% Network interception (incomplete, bypassed by cross-origin iframes)
- High CPU drain (3s interval sweepers)
- Easily defeated by polymorphic JS and Shadow DOM.

**Target State (Robust):**
- 90% Network-level blocking + iframe restrictions (declarative, list-driven)
- 10% Cosmetic CSS + minimal targeted JS (surgical, zero CPU overhead)
- Filter lists maintained via CI pipeline (EasyList + EasyPrivacy + custom overrides)
- Network blocking happens before ad scripts execute, eliminating race conditions.

---

## 3. The "Brave/uBlock Origin" Target Experience

**Question:** *When we play these providers in Brave or Chrome with uBlock Origin, no popups and ads open and video plays fine. Can we achieve this?*

**Answer:** Yes, absolutely. Brave and uBlock succeed because they intercept network requests at the browser engine level *before* the JavaScript executes. We replicate this exact behavior in FilmSnaps:

1. **Mobile (Android/iOS):** We use native WebView network interception (`shouldInterceptRequest` / `WKContentRuleList`). This operates identically to a browser extension, killing ad requests before the JS engine wakes up.
2. **Web (Proxied Providers):** Since we control the server, we fetch the provider's HTML, parse it, physically delete the ad `<script>` and `<iframe>` tags based on EasyList rules, and serve a clean HTML file to the browser.
3. **Web (Cloudflare Providers):** We solve the Cloudflare challenge server-side via a headless browser, fetch the clean HTML, strip the ads, and serve it. 

---

## 4. The Sandbox Detection Problem & Solution

**The Problem:** For Cloudflare-protected cross-origin providers on the web, we previously proposed using the HTML `sandbox` attribute (without `allow-popups`) to block popups at the browser level. However, sophisticated providers detect the `sandbox` attribute (by triggering a SecurityError on restricted APIs) and intentionally crash the video player.

**The Solution:** We throw the `sandbox` attribute in the trash. If we cannot use sandbox, we MUST route these providers through our server-side proxy (Path A).

### Bypassing Cloudflare & Sandbox Detection (Web)
1. **Solve Cloudflare Server-Side:** Stand up `FlareSolverr` (or a Playwright script) in a serverless function or small VM. When a user requests a video from `nxsha` or `chillflix`, FilmSnaps server asks FlareSolverr to visit the URL. FlareSolverr passes the JS challenge and grabs the `cf_clearance` cookie.
2. **Fetch HTML Same-Origin:** The Next.js API route uses that cookie to fetch the provider's HTML. Cloudflare sees a valid, cleared user.
3. **Strip Ad Scripts (Network Filtering):** Parse the HTML using `@cliqz/adblocker`. Find `<script>` tags matching EasyList patterns.
4. **Stub the Scripts (Bypass Anti-Adblock):** Instead of deleting the ad script tags (which providers detect via `typeof window.adScript === 'undefined'`), rewrite their `src` to point to a local empty stub on our server:
   ```html
   <!-- Original -->
   <script src="https://evil-ads-network.com/popup.js"></script>
   <!-- Rewritten by our server -->
   <script src="/api/stubs/empty-ad-script.js"></script>
   ```
   The stub file returns: `window.myAdScript = function() { /* do nothing */ };`
5. **Deliver Clean iframe:** Serve the pristine HTML to a standard `<iframe>` (no `sandbox` attribute needed). The provider's video player checks pass, video plays, and no ads pop up.

### Mobile is Unaffected
On mobile, we do not use the `sandbox` attribute. Native network interception (`shouldInterceptRequest` / `WKContentRuleList`) blocks the ad network requests silently. The provider's anti-adblock checks pass perfectly, and the video plays without interruption.

---

## 5. Target Architecture Layers

### L0: Filter List Compiler (The Foundation)
Run as a daily CI step. Uses `@cliqz/adblocker` to compile EasyList, EasyPrivacy, and custom provider overrides into an optimized JSON artifact (`compiled-filters.json`) utilizing Aho-Corasick pattern matching.

### L1a: Web Proxy Path (Same-Origin, ~60% of providers)
The Next.js API route fetches upstream HTML, parses the AST, drops/replaces ad scripts/iframes matching network filter rules, injects cosmetic CSS + minimal runtime guard, and sets a tightened CSP.

### L1b: Web Cloudflare Solver Proxy (Same-Origin, CF Providers)
Uses a headless browser (FlareSolverr) to solve Cloudflare challenges server-side, cache the `cf_clearance` cookie, and route the provider through L1a. **This is how we defeat sandbox detection.**

### L1c: Mobile Native Network Blocking (Android & iOS)
- **Android:** `shouldInterceptRequest` intercepts *every* resource load (including nested iframes) before JS executes. Returns empty 204 responses for blocked URLs.
- **iOS:** `WKContentRuleListStore` compiles declarative rules into WebKit's native binary format (the same engine Safari extensions use). Zero JS overhead, zero race conditions.

### L2: Cosmetic Filtering (Universal)
Compiles CSS rules (e.g., `.ad-container { display: none !important; }` and `div:has(> iframe[src*='ad'])`) and injects them via `<style>` tags (web), `evaluateJavascript` (Android), or `WKUserScript` (iOS). Zero CPU drain compared to MutationObservers.

### L3: Minimal Runtime Guard (Surgical)
A ~50-line script replacing the 15-layer guard. Retains `window.open` overriding, `a.click()` interception, and `attachShadow` interception (forcing `mode: 'open'`). Retires location locking, appendChild interception, and CPU watchdogs.

### L4: CSP Strategy
Tighten `script-src`, `frame-src`, `connect-src`, and `form-action` aggressively based on provider allowlists. Keep `media-src` permissive for video chunk origins. Drop deprecated `navigate-to`.

---

## 6. Detailed Implementation Guide & Code Snippets

### 6.1 Server-Side Proxy & Script Stubbing (Web)

```typescript
// apps/web/app/api/player/[provider]/[...path]/route.ts
import { Engine } from '@cliqz/adblocker';
import { parse } from 'parse5';
import { serialize } from 'parse5-serializer';

let engine: Engine | null = null;
async function getEngine() {
  if (engine) return engine;
  const raw = await readFile('path/to/compiled-filters.json', 'utf8');
  engine = Engine.parse(raw, { enableMutationObserver: false, loadCosmeticFilters: true });
  return engine;
}

export async function GET(req: Request, { params }: { params: { provider: string; path: string[] } }) {
  const provider = registry.get(params.provider)!;
  const upstreamUrl = provider.buildEmbedUrl(params.path);
  
  // If CF provider, use FlareSolverr to get cf_clearance cookie here
  const cookies = await solveCloudflareIfRequired(provider);
  
  const upstreamResp = await fetch(upstreamUrl, { headers: { ...provider.headers, Cookie: cookies } });
  const html = await upstreamResp.text();
  
  const ab = await getEngine();
  const document = parse(html);
  
  // Walk AST, strip matching scripts/iframes/links
  walk(document, (node) => {
    if (node.tagName === 'script' || node.tagName === 'iframe' || node.tagName === 'link') {
      const src = getAttr(node, 'src') || getAttr(node, 'href');
      if (!src) return;
      const absolute = new URL(src, upstreamUrl).href;
      const match = ab.match({ url: absolute, sourceUrl: upstreamUrl, type: mapType(node.tagName) });
      
      if (match.block) {
        // STUB THE SCRIPT instead of deleting it to bypass anti-adblock checks
        if (node.tagName === 'script') {
          setAttr(node, 'src', '/api/stubs/empty-ad-script.js');
        } else {
          replaceWithComment(node, `<!-- FS blocked: ${match.filter} -->`);
        }
      }
    }
  });
  
  // Inject minimal guard + cosmetic CSS at top of <head>
  const head = findHead(document);
  prependScript(head, MINIMAL_GUARD_JS);
  prependStyle(head, ab.getCosmeticFiltersFor(upstreamUrl).map(r => r.css).join('\n'));
  
  // Set tightened CSP
  const csp = buildCSP(provider);
  return new Response(serialize(document), {
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy': csp,
      'X-Frame-Options': 'SAMEORIGIN',
    }
  });
}
```

### 6.2 Web iframe (No Sandbox needed)
```tsx
// apps/web/components/player/SecureIframe.tsx
export function SecureIframe({ src, provider }: Props) {
  return (
    <iframe
      src={src} // Points to our proxied, cleaned HTML
      referrerPolicy="no-referrer"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      // NO sandbox attribute - scripts are stubbed server-side
    />
  );
}
```

### 6.3 Android Native Interception
```kotlin
// apps/mobile/modules/player-webview/android/src/main/java/PlayerWebViewModule.kt
class PlayerWebViewClient(private val rules: CompiledFilterRules) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
        val url = req.url.toString()
        val host = req.url.host ?: return null
        
        // Allowlist first (video CDNs)
        if (rules.allowlist.contains(host)) return null
        
        // Then check block rules (O(1) hash table lookup)
        if (rules.blockDomains.contains(host) || rules.blockPatterns.any { url.contains(it) }) {
            // Return empty 204 silently - provider does not detect an adblocker
            return WebResourceResponse(
                "text/plain", "utf-8", 204, "No Content",
                mapOf("X-FS-Block" to "1"), ByteArrayInputStream(ByteArray(0))
            )
        }
        return null
    }
    
    override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
        // Block intent:// and custom schemes
        if (req.url.scheme !in listOf("http", "https")) return true
        // Block external redirects
        if (req.isRedirect && req.url.host != view.url?.let { Uri.parse(it).host }) return true
        return false
    }
}
```

### 6.4 iOS Native Interception
```swift
// apps/mobile/modules/player-webview/ios/PlayerWebViewView.swift
class PlayerWebViewView: UIView {
    func setupContentBlocker() {
        guard let rulesJSON = loadRulesFromBundle("webkit-rules.json") else { return }
        WKContentRuleListStore.default()?.compileContentRuleList(
            forIdentifier: "com.filmsnaps.adblocker",
            encodedContentRuleList: rulesJSON
        ) { ruleList, error in
            guard let ruleList = ruleList else { return }
            self.webView.configuration.userContentController.add(ruleList)
        }
    }
    
    func webView(_ webView: WKWebView, decidePolicyFor nav: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = nav.request.url else { decisionHandler(.cancel); return }
        if url.scheme != "https" && url.scheme != "http" { decisionHandler(.cancel); return }
        if nav.targetFrame == nil { decisionHandler(.cancel); return } // killed popup
        decisionHandler(.allow)
    }
}
```

### 6.5 Minimal Runtime Guard (Replaces 15-Layer playerGuard.ts)
```js
// packages/shared/src/security/minimal-guard.ts
(function() {
  'use strict';
  if (window.__FS_GUARD__) return;
  window.__FS_GUARD__ = true;

  // A. window.open
  const _open = window.open;
  window.open = function(url, ...rest) {
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin) return _open.call(window, url, ...rest);
    } catch {}
    return null;
  };

  // B. anchor click() popup path
  const _click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.target === '_blank' || (this.href && isExternal(this.href))) return;
    return _click.call(this);
  };

  // C. Cosmetic & Self-healing ad suppression (Debounced)
  let removed = new WeakSet();
  new MutationObserver(debounce(() => {
    requestIdleCallback(() => {
      for (const el of document.querySelectorAll('iframe[src*="ad"], div[style*="fixed"]')) {
        if (isLikelyAd(el) && !removed.has(el)) {
          removed.add(el);
          el.remove();
        }
      }
    });
  }, 250)).observe(document, { childList: true, subtree: true });

  // D. Shadow DOM interception
  const _attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = _attachShadow.call(this, { ...init, mode: 'open' });
    observeAdProneIn(root);
    return root;
  };
})();
```

---

## 7. Edge Cases & Mitigations

| Scenario | Mitigation |
|----------|------------|
| **Provider detects sandbox attribute** | **SOLVED:** Do not use `sandbox` on web. Route CF providers through FlareSolverr server-side, rewrite ad scripts to point to local stubs. |
| Provider rotates CDN domain every 24h | Allowlist must use registrable domain (or `*.video-cdn.tld` pattern). Add provider override rules that auto-allowlist sibling subdomains. |
| Provider serves video and ads from SAME domain | Suppress network rule for that domain; cosmetic CSS removes the ad container. Alternatively, use path-specific blocking (`provider.example.com^ads/`). |
| Cloudflare changes challenge type | FlareSolverr is community-maintained. Pin a known-good version; monitor breakage via provider health telemetry. |
| Chrome drops iframe Sandbox support | Accept as tail risk (would break the web). We no longer rely on sandbox for web anyway. |
| WKContentRuleList at 50k-rule limit exceeded | Split rules across two `WKContentRuleList` instances. Apply high-priority rules first. |
| Provider detects missing ad script (Anti-Adblock) | **SOLVED:** Server-side rewriting stubs the `<script>` tag rather than deleting it, passing anti-adblock checks. |
| Filter-list false positive breaks a provider | Per-provider allowlist in `registry.ts` (`filterAllowlist: string[]`). Merged at compile time as `@@||...$important`. |
| Service worker races native injection | **SOLVED:** `shouldInterceptRequest` (Android) and `WKContentRuleList` (iOS) intercept at the network layer before any JS executes. The SW script network request is blocked entirely. |

---

## 8. Phased Migration & Implementation Plan

### Phase 1: Filter Foundation (Week 1)
1. Stand up `packages/filter-compiler/` CI step. Pull EasyList + EasyPrivacy + AdGuard Base + custom 80+ patterns as overrides. Output `compiled-filters.json`.
2. Integrate `@cliqz/adblocker` into the web proxy `route.ts` *alongside* existing `protection.ts` (feature-flagged at 10%).
3. Implement script stubbing (`/api/stubs/empty-ad-script.js`).

### Phase 2: Web Cleanup & CSP (Week 2)
4. Replace `SecureIframe` logic: remove `sandbox` attribute (if testing with stubs), ensure server-side stripping handles popups.
5. Replace `playerGuard.ts` with `minimal-guard.ts` (~50 lines). Delete DOM sweepers, `appendChild` patches, and location locks.
6. Implement tightened CSP based on provider allowlists.

### Phase 3: Mobile Native Integration (Weeks 3-4)
7. Android: Wire `shouldInterceptRequest` to the compiled filter engine. Add native nav guard for `intent://` schemes.
8. iOS: Generate `WKContentRuleList` JSON from compiled filters. Wire `decidePolicyFor` for popup blocking.
9. Strip inline guard JS from mobile WebViews entirely; rely on native + cosmetic CSS.

### Phase 4: Cloudflare Unlock (Weeks 5-6)
10. Deploy `FlareSolverr` to a small VM/serverless function.
11. Migrate `nxsha` and `chillflix` to the new CF-solver route.
12. Verify provider playback, ensure server-side rewriting + script stubbing successfully defeats anti-adblock checks without `sandbox`.

### Phase 5: Telemetry & OTA (Week 7)
13. Add filter-list effectiveness telemetry (boolean block/no-block + provider ID).
14. Implement OTA fast-pack for mobile (fetch `/api/filters/latest.json` on launch, persist to device, update native engines).