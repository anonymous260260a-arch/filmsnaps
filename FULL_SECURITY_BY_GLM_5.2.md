# FilmSnaps Ad/Popup Blocking Architecture — Expert Recommendation

## TL;DR — The Core Insight

After reviewing your 10 layers and their pathologies, the conclusion is direct: **you are fighting the war at the wrong layer**. Heuristic DOM scraping, monkey-patched `appendChild`, frozen `window.location`, and CPU watchdogs are all *symptom-level* defenses. They compete on the polymorphic-JS battlefield where ad scripts win because they have home-field advantage (they authored the page).

The architecture that has been proven at scale for 20 years (uBlock Origin, AdGuard, Brave Shields) is **declarative, list-driven, network-level blocking** with cosmetic CSS as a secondary layer. Your current layers are roughly:

```
80% DOM/runtime hacks → fragile, CPU-heavy, cat-and-mouse
20% network interception → strong but incomplete
```

The target inverts this:

```
90% network-level + iframe-sandbox (declarative) → fast, stable, list-maintained
10% cosmetic CSS + minimal targeted JS  → cheap, surgical
```

The DOM sweeper, location-locking, appendChild interception, popup focus reclaim, and CPU watchdog should all be **retired**, not improved. They are architectural debt.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  L0  FILTER LIST COMPILER (build pipeline, runs in CI)          │
│       EasyList + EasyPrivacy + AdGuard + custom overrides        │
│       → compiled-filters.json (network + cosmetic + exceptions) │
│       → bundled in mobile binary + cached on web server         │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ WEB (proxy)   │   │ WEB (iframe / │   │ MOBILE        │
│ Same-origin   │   │ CF provider)  │   │ Native WebView│
│               │   │               │   │               │
│ L1a: HTML     │   │ L1c: Headless │   │ L1d: Native   │
│   rewrite @   │   │   CF solver   │   │   request     │
│   proxy ♦     │   │   rev-proxy ♦ │   │   intercept ♦ │
│               │   │               │   │  (Android:    │
│ L2: Cosmetic  │   │ L2: iframe    │   │   shouldInter │
│   CSS inject  │   │   sandbox attr│   │   ceptRequest │
│               │   │   (no JS!)    │   │   iOS:        │
│ L3: Light     │   │               │   │   WKContent   │
│   runtime     │   │ L3: Cosmetic  │   │   RuleList ♦  │
│   guard for   │   │   CSS inject  │   │               │
│   self-healers│   │               │   │ L2: Cosmetic  │
│               │   │               │   │   CSS inject  │
│ L4: CSP       │   │ L4: Parent-   │   │               │
│   allowlist   │   │   frame popup │   │ L3: Native    │
│               │   │   reclaim     │   │   nav guard   │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                            ▼
            ┌──────────────────────────────────┐
            │  SHARED TELEMETRY / HEALTH       │
            │  • Provider breakage signals      │
            │  • Filter list effectiveness      │
            │  • False-positive triage pipeline │
            └──────────────────────────────────┘
```

`♦` = primary blocking layer; everything else is defense-in-depth.

---

## Layer-by-Layer Design

### L0 — Filter List Compiler (the foundation)

Run as a CI step, output a versioned JSON artifact. This artifact is the *single source of truth* on every platform.

**Inputs:**
- EasyList (`easylist.txt`)
- EasyPrivacy (`easyprivacy.txt`)
- AdGuard Base Filter, Annoyances Filter
- uBlock Origin filter lists (`ublock-filters.txt`, `ublock-privacy.txt`)
- **Custom allowlist** — provider video CDNs that must NOT be blocked even if matched
- **Custom overrides** — provider-specific rules (e.g., `||provider-cdn.net/ad/$important`)

**Output schema** (`compiled-filters.v1.json`):

```json
{
  "version": "2024-03-15-1",
  "network": {
    "block": [
      { "pattern": "doubleclick.net", "type": "domain" },
      { "pattern": "/ads.js", "type": "path-contains" },
      { "pattern": "ads.example.com^path", "type": "domain-path" }
    ],
    "allow": [
      { "pattern": "provider-video-cdn.com", "type": "domain" }
    ],
    "exceptions": [
      { "pattern": "video-provider.net/ads/", "type": "path-contains", "reason": "video metadata endpoint, despite path name" }
    ]
  },
  "cosmetic": {
    "css": [
      ".ad-container { display: none !important; }",
      "#popup-overlay { display: none !important; }",
      "div[class*='banner-ad'] { display: none !important; }"
    ],
    "procedural": [
      { "selector": "div:has(> iframe[src*='ad'])", "action": "remove" }
    ]
  },
  "cspDirectives": {
    "frameSrc": ["video-cdn-1.com", "video-cdn-2.com"],
    "mediaSrc": ["*.video-cdn.com", "blob:"]
  }
}
```

Use `@cliqz/adblocker` (used by Brave and Ghostery; MIT licensed; runs in Node, browser, and React Native). It compiles EasyList into an optimized in-memory engine with **Aho-Corasick pattern matching** for URL substrings — O(1)-ish lookups. Do not write your own pattern matcher.

```
packages/filter-compiler/   <-- new monorepo package
  src/
    compile.ts             <-- dev script
    sources.toml           <-- which lists to pull
    overrides/             <-- per-provider custom rules
      vidplay.json
      nxsha.json
      ...
  build/compiled-filters.json  <-- generated artifact
```

### L1a — Web Proxy Path (same-origin providers, ~60%)

Your existing `/api/player/[provider]/[...path]/route.ts` becomes the primary blocking surface. Restructure it:

1. **Fetch upstream** (no rewriting yet).
2. **Run the response through `@cliqz/adblocker`**'s `Engine.cosmeticFilter(injectionRules)` — produces a CSS string of cosmetic blocking rules.
3. **Static HTML rewrite**: parse with `parse5`, walk the AST, drop/replace any `<script>`, `<iframe>`, `<link>`, `<img>` whose `src`/`href` matches a network filter rule. Replace removed scripts with empty text nodes (preserves layout/positions).
4. **Inject protection scripts** at top of `<head>` *before* any provider scripts: a minimal runtime guard (see L3 below).
5. **Inject compiled cosmetic CSS** as a `<style>` tag immediately.
6. **Set tightened CSP** (see L4 below) in the HTTP response headers.
7. **Re-issue asset requests** — `/api/player/[provider]/asset?u=<encoded>` — and apply same filter rules at the asset proxy.

**Why this is bulletproof vs. your current implementation:** provider scripts that matched ad patterns are *physically absent* from the HTML the browser receives. No runtime race, no polymorphic cat-and-mouse. The page never sees the ad code.

### L1b — Server-Side Cloudflare Solver (the unlock you don't yet have)

Your stated Cloudflare gap is the highest-risk issue. The fix is a **headless-browser challenge-solver reverse proxy**, not "give up on proxied CF providers."

```
apps/web/app/api/cf-proxy/[provider]/[...path]/route.ts
```

Pipeline:
1. Request hits `/api/cf-proxy/nxsha/watch?...`.
2. Look up `cf-cookies.json` for this provider on disk (cached clearance cookies).
3. If valid (TTL ~30 min): forward request upstream with those cookies; pass through response, apply filter compiler, return to client.
4. If expired/missing: spawn a Puppeteer/Playwright job **server-side** that navigates to the challenge URL, waits for clearance (typically 5s), extracts `cf_clearance` cookie, stores it in `cf-cookies.json` with TTL, then proceeds with step 3.
5. Cache the cleared HTML response at the edge (Cloudflare Workers KV, Vercel KV, or local disk) keyed by `(provider, full-url+params)` with short TTL.

Tradeoff: this costs you a server-side headless browser instance. Run it on a small VM (or as a Cloudflare Worker using `:headless`, or via a service like `brightdata.com` or `flaresolverr` self-hosted). Latency: 1–2s on first hit per provider per 30min window; cached thereafter.

Once the page is same-origin through `cf-proxy`, ALL of L1a's HTML rewriting, CSS injection, and tightened CSP applies. **The Cloudflare gap closes.**

This is the single biggest architectural unlock in this proposal. It transforms the cross-origin "zero JS injection" scenario into the same-origin "full filter-list application" scenario.

### L1c — Web iframe sandbox (defense-in-depth when proxy isn't available)

For the residual cases where neither proxy nor CF-solver is enabled, the iframe uses the `sandbox` attribute. This is the most underutilized tool in your stack — it enforces browser-level restrictions that NO cross-origin script can bypass.

```tsx
<iframe
  src={embedUrl}
  sandbox="allow-scripts allow-same-origin allow-presentation"
  // NOTE: deliberately OMIT:
  //   allow-popups               — kills window.open() popups
  //   allow-popups-to-escape-sandbox
  //   allow-top-navigation       — kills top-frame redirects
  //   allow-top-navigation-by-user-activation
  referrerpolicy="no-referrer"
  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
/>
```

The sandbox attribute is **enforced by the browser engine**, not by JS that the iframe can override. It defeats:
- `window.open()` from any nested frame in the iframe
- `a[target=_blank]` navigation
- `window.top.location = ...` hijacks
- Form submissions opening new windows

The only escape hatch providers have is `allow-top-navigation-by-user-activation`, which we do not grant. This is the single most defensive primitive in the entire pipeline and requires zero code on the iframe's page.

**Caveat**: `allow-scripts` + `allow-same-origin` together can theoretically let a script remove the sandbox attribute by manipulating the iframe element from inside *(only if the iframe document is same-origin with the parent — which is not the case for cross-origin providers)*. For truly cross-origin providers, this is safe. Audit per provider before enabling.

### L1d — Mobile Native Network Blocking (the gold layer)

Mobile has a structural advantage over web here: native WebView APIs intercept **every** resource request from **every** nested frame at the native layer, before any JavaScript runs.

**Android (`shouldInterceptRequest`)**:

```kotlin
// player-webview/android/src/main/java/PlayerWebViewModule.kt
class AdBlockingWebViewClient(private val engine: AdblockEngine) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
        val url = req.url.toString()
        
        // Apply network filter rules (cliqz engine)
        val filter = engine.match(FilterRequest(url = url, sourceUrl = ...))
        if (filter.block) {
            return WebResourceResponse("text/plain", "utf-8", 204, "No Content", emptyMap(), null.inputStream())
        }
        // Allowlist: video CDNs (no blocking even if pattern matches)
        if (engine.isAllowlisted(url)) return null
        
        return null  // pass through
    }
}
```

This catches ad iframes, tracking pixels, beacons, popup scripts — *everything* — for **all nested iframes**, because `shouldInterceptRequest` is the only entry point any WebView fetch goes through. Children iframes can never escape this. The "child iframe problem" disappears on Android.

Call order: `shouldInterceptRequest` fires at the native networking stack — *before* the JS engine even starts executing anything in any frame. The race condition is structurally eliminated.

**iOS (`WKContentRuleList`)** — this is the killer feature most people don't know exists:

```swift
// player-webview/ios/PlayerWebViewView.swift
import WebKit

let jsonRules = """
[
  { "trigger": { "url-filter": ".*doubleclick\\\\.net.*" }, "action": { "type": "block" } },
  { "trigger": { "url-filter": ".*\\\\/ads\\\\.js.*" }, "action": { "type": "block" } },
  { "trigger": { "url-filter": ".*popads\\\\.net.*" }, "action": { "type": "block" } },
  { "trigger": { "resource-type": ["script"] }, "url-filter": ".*tracker.*" }, "action": { "type": "block" } }
]
"""

WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "filmsnaps-adblocker", encodedContentRuleList: jsonRules) { ruleList, error in
    guard let ruleList = ruleList else { return }
    config.userContentController.add(ruleList)
}
```

`WKContentRuleList` is the *same* engine Safari's content blocker app extensions use. Rules are compiled by WebKit to a native binary format. Enforcement is at the WebKit network stack level: **below** JS, **below** fetch interception, **above** the socket. Zero JS overhead, zero race conditions, zero CPU impact.

Generate the JSON rules from your `compiled-filters.json` at build time (a Node script that converts EasyList syntax to WebKit's JSON schema). WebKit accepts up to 50,000 rules — your compiled EasyList + EasyPrivacy is ~40k after dedup.

`setWebContentsDebuggingEnabled(true)`: yes, for dev builds only. Gate it behind `__DEV__`.

**Both platforms**: also wire `decidePolicyForNavigationAction` (iOS) / `shouldOverrideUrlLoading` (Android) for top-level navigation policy. This catches `intent://` URLs, custom schemes, and anything that escapes content rules. Default policy: cancel any navigation whose URL scheme is not `https`, except for same-origin navigations on the player's own origin.

### L2 — Cosmetic Filtering (universal, zero-CPU, CSS-only)

Cosmetic rules compile to a CSS string. Inject this as a `<style id="fs-cosmetic">` tag in:
- Web proxy path: server-side at HTML rewrite time (in `<head>`)
- Web iframe path (CF-solved): same, server-side via L1b
- Web iframe path (truly cross-origin, last resort): cannot inject — rely on iframe sandbox and accept residual cosmetic ugliness
- Android: inject via `evaluateJavascript` on `onPageFinished`
- iOS: inject via `WKUserScript` at `documentStart` (cosmetic CSS injected there lands before any paint)

CSS-only cosmetic filtering is **free**: the browser's style-matching engine handles it natively. No MutationObserver, no setInterval, no WeakSet. uBlock Origin's own profiling shows cosmetic CSS adds <1ms to first paint.

**Avoid procedural cosmetic filters** (those used when CSS alone isn't expressive enough — `:has()` and JS-based removal). Use them *only* when a specific ad pattern can't be expressed as CSS, and limit their count to ~20 rules total (each one is a MutationObserver subscription). The vast majority of cosmetic removal happens in CSS.

CSS `:has()` is now supported in all evergreen browsers (Chrome 105+, Safari 15.4+, Firefox 121+). It lets you express procedural filters in pure CSS:

```css
div:has(> iframe[src*="adprovider"]) { display: none !important; }
div:has(> video) > div:not([class*="controls"]):not([class*="overlay"]) { display: none !important; }
```

Migrate your current JS MutationObserver selectors to `:has()` CSS rules first; only keep JS for true dynamic removals.

### L3 — Minimal Runtime Guard (surgical replacement for L1–L10)

The runtime footprint shrinks dramatically. Replaces every layer except L1, L2, L4, and sandbox. Targets only what static rewriting and CSS cannot reach.

```js
// packages/shared/src/security/minimal-guard.ts
(function() {
  'use strict';
  if (window.__FS_GUARD__) return;  // dedupe
  window.__FS_GUARD__ = true;

  // ---- A. window.open — keep but trivial ----
  const _open = window.open;
  window.open = function(url, ...rest) {
    try {
      // Allow only same-origin (provider's own video CDN endpoints)
      const u = new URL(url, location.href);
      if (u.origin === location.origin) return _open.call(window, url, ...rest);
    } catch {}
    return null;  // block everything else (sandbox already does this; defense in depth)
  };

  // ---- B. anchor click() popup path ----
  const _click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.target === '_blank' || (this.href && isExternal(this.href))) return;
    return _click.call(this);
  };

  // ---- C. self-healing ad re-injection suppression ----
  // Only observe known ad-prone elements (iframes fixed overlays)
  // Debounced + idle-scheduled; NOT a setInterval
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

  // ---- D. attachShadow interception for shadow-DOM ads ----
  const _attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = _attachShadow.call(this, { ...init, mode: 'open' });
    observeAdProneIn(root);
    return root;
  };
})();
```

Things removed from your current 15-layer guard:
- `window.location` Object.defineProperty freeze → providers crash on detection; rely on iframe sandbox instead
- `appendChild` interception → causes crashes; network blocking is sufficient
- `setInterval` sweeper at 3s → CPU draw; replaced by debounced MutationObserver
- Popup focus reclaim → modern browsers block `window.focus()`; useless
- CPU watchdog → false positives; with network blocking, miners can't load in first place

### L4 — CSP Strategy

You said CSP needs to be permissive for video playback. This is true for `media-src` and `img-src` but **false for `script-src`, `frame-src`, `connect-src`, and `form-action`**. Tighten these aggressively.

```
Content-Security-Policy:
  default-src 'none';
  script-src  'self' 'nonce-{NONCE}' 'unsafe-inline' {provider-allowed-origins};
    ; ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    ; NOTE: 'unsafe-eval' is required by some video players (e.g. hls.js sandbox).
    ; Audit per-provider; drop it where possible. 'unsafe-inline' needed because
    ; some players emit inline event handlers. Pair with a nonce to constrain
    ; the inline allowance, OR pre-strip inline handlers in L1a rewrite.
  style-src   'self' 'unsafe-inline';
  img-src     'self' data: blob: {provider-img-origins};
  media-src   'self' blob: data: https: {provider-cdn-origins};
    ; ^^^ permissive on purpose — video chunk origins rotate
  frame-src   'self' {provider-frame-origins};
  connect-src 'self' {provider-cdn-origins};
  font-src    'self' data:;
  object-src  'none';
  base-uri    'none';
  form-action 'self';
  workersrc   'self' blob:;
  navigate-to 'none';    ; deprecated in Chrome, ignored; mitigated by iframe sandbox
  require-trusted-types-for 'script';   ; optional hard mode
```

Provider-allowed origins come from your provider registry (a per-provider allowlist field you add).

For `frame-src`, this restricts which child iframes can be embedded. **The iframe-sandbox attribute on our outer iframe to the provider doesn't affect the provider's child iframes** — those are governed by the provider's own CSP. BUT, since for proxied/CF-solved providers we *are* their CSP, we set it server-side. For ad iframes whose `src` we missed in HTML rewriting, CSP `frame-src` blocks them at load time as a backstop.

### L5 — Click & Event Interception (mobile only, native)

On web, this is now mostly redundant (sandbox + L3 cover it). On mobile, native-level interception is necessary for intent:// URLs and custom scheme handlers:

```kotlin
override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
    val url = req.url
    if (url.scheme != "https" && url.scheme != "http") return true  // block intent://, mailto:, etc.
    if (req.hasGesture() && isExternal(url.toString())) return true   // user-triggered external click
    return false
}
```

iOS equivalent via `decidePolicyFor`:
```swift
func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = navigationAction.request.url {
        if url.scheme != "https" && url.scheme != "http" { decisionHandler(.cancel); return }
        if navigationAction.targetFrame == nil { decisionHandler(.cancel); return }  // popup
    }
    decisionHandler(.allow)
}
```

---

## Specific Answers to Your Questions

**1. Architecture.** Declarative filter-list approaching neutrality via `@cliqz/adblocker`, with the inversion: network-first (90%), DOM last (10%). Primary blocking layers per platform:
- Web proxy path → server-side HTML rewriting + CSP, both filter-list driven
- Web CF path → headless-browser challenge solver unlocks proxy path
- Web last-resort cross-origin → iframe `sandbox` attribute (browser-enforced)
- Mobile Android → `shouldInterceptRequest`
- Mobile iOS → `WKContentRuleListStore`

DOM sweeper retired. Location locking retired. appendChild interception retired.

**2. uBlock Origin integration.** Yes — directly integrate `@cliqz/adblocker` (Brave's engine). It compiles EasyList/EasyPrivacy/AdGuard into an in-memory engine with Aho-Corasick URL matching. Two integration targets:
- Server-side (`apps/web/app/api/player/.../route.ts`): `const engine = Engine.parse(easylistText, { enableMutationObserver: false }); engine.match({ url, sourceUrl, type });` — invoked during HTML rewriting and asset proxying.
- Mobile: ship compiled engine JSON via OTA; instantiate `@cliqz/adblocker`'s React Native build (`@cliqz/adblocker-content`). On Android, the wrapped rules drive `shouldInterceptRequest`. On iOS, compile to WebKit's `WKContentRuleList` JSON format with a thin transform pipeline.

**3. Child iframe problem.** Three-tier solution:
1. **HTML rewrite (L1a/L1b) strips child-iframe `src` attrs that match network rules before the browser ever loads them.** This is the primary fix.
2. **CSP `frame-src` blocks any child iframe src we missed** during static parse.
3. **Mobile native `shouldInterceptRequest` / `WKContentRuleList`** intercepts every nested-frame request with no JS access required.
4. **iframe `sandbox` outer attribute** (without `allow-popups`) blocks the child iframe's `window.open()` attempts at the browser level.

The "can't inject JS into child iframe" problem is moot: you don't need to. You block the *requests* those iframes would make — at the network layer where you do have authority.

**4. Cloudflare providers.** This is the most important unlock. Two paths:

- **Path A (recommended): headless-browser CF solver** (L1b). Adds same-origin proxy for CF providers via a server-side headless browser that solves the challenge and caches the `cf_clearance` cookie (~30min TTL). Subsequent requests to `/api/cf-proxy/{provider}/...` use the cached cookie. ~1–2s latency on first cold hit per 30min window; ~20ms thereafter. This converts your most vulnerable providers into the strongest-path architecture.

- **Path B (fallback): iframe sandbox alone.** For providers where (a) you cannot run the CF solver (cost, latency sensitivity), (b) the provider works in a cross-origin iframe without our JS injection. Use bare `sandbox="allow-scripts allow-same-origin allow-presentation"` — this kills popups, top-navigation, and popunders at the browser engine level. You will NOT block cosmetic ads (overlays) inside the iframe on this path, but the worst outcomes (popups, redirects) are stopped.

Most providers should use Path A. Reserve Path B for high-volume providers where CF solver cost is prohibitive, accept cosmetic-ad leakage, document to users.

**5. Mobile native blocking.**
- Android: `shouldInterceptRequest` is the gold layer. It catches *every* resource load including from nested iframes. Wire it to the cliqz engine. Return empty 204 `WebResourceResponse` for blocks. Pair with `shouldOverrideUrlLoading` for navigation policy.
- iOS: `WKContentRuleListStore` compiles declarative rules into WebKit-level blockers — same engine Safari's App-Store content blockers use. This is the best-in-class approach on iOS. Pair with `decidePolicyFor` for navigation policy.
- `setWebContentsDebuggingEnabled(true)`: yes in dev. Always gate behind `__DEV__` / BuildConfig.DEBUG. Production exposure leaks video URLs to anyone with Chrome DevTools on the same machine — privacy liability.

**6. Race conditions.** Native wins. `shouldInterceptRequest` (Android) and `WKContentRuleList` (iOS) intercept at the network layer **before** any JS executes in **any** frame. The race is structurally eliminated. Specifically:
- Service worker registration never wins because the service worker never loads (network blocked).
- `window.open` from a script-injection race never wins because by the time any script runs in any sub-frame, the resource has already been blocked or allowed by content rules.

For the web `injectedJavaScriptBeforeContentLoaded` race on web (where you don't have native): equivalent is the iframe sandbox attribute set in HTML — which is enforced at parse time, before scripts run. Plus, server-injected scripts in `<head>` run before any provider scripts (per HTML5 spec: parser-inserted scripts without `defer`/`async` execute in document order; earliest-injected wins).

**7. Shadow DOM.** Network-level filtering is shadow-DOM-immune (it doesn't care where the ad loads from — just blocks the URL). For cosmetic removal in shadow DOM:
- Monkey-patch `Element.prototype.attachShadow` to force `mode: 'open'` (so we can introspect) and attach a child MutationObserver on the returned `ShadowRoot`.
- Use CSS `::part()` and `::slotted()` pseudo-elements against the shadow host. Requires the shadow parts to be exposed via the `part` attribute, which providers won't do voluntarily.
- Use CSS `:has()` to scope styles to shadow-reaching selectors when the host element has a known class.
- For Shadow DOM *contents* you cannot reach via CSS, accept the cosmetic ugliness; network-level still blocks the actual ad load.

The order of effectiveness: network filtering (100%) > cosmetic CSS (>90%) > procedural JS (<10%).

**8. CSP strategy.** See L4 above. Key principles:
- Tighten `script-src`, `frame-src`, `connect-src`, `form-action`, `object-src`, `base-uri` aggressively.
- Keep `media-src` and `img-src` permissive enough for video chunk origins, BUT driven by an allowlist from your provider registry (not hardcoded).
- Use a nonce for inline scripts — pre-rewrite inline scripts in L1a to assign them the nonce; rest get blocked by default.
- Drop `navigate-to` — deprecated, rely on iframe `sandbox` attribute instead.
- Evaluate `require-trusted-types-for 'script'` for the most aggressive providers — it neutralizes obfuscated script injection entirely, though it will break some video players.

**9. Filter list maintenance.** Build pipeline runs daily in CI:
1. `git submodule update --remote` pulls latest EasyList, EasyPrivacy, AdGuard, uBlock filters.
2. `packages/filter-compiler/src/compile.ts` runs `@cliqz/adblocker` parser, merges with your `overrides/*.json`, generates `compiled-filters.v{date}.json`.
3. Web: published as a server-cached asset (`/api/filters/compiled.json`); CDN-cached with ETag. Updated daily; clients refetch via ETag polling (or via version-pinned URL `/api/filters/2024-03-15.json`).
4. Mobile: compiled-filters.json gets bundled into the app at release time (full update), AND a "fast filter pack" can be fetched OTA via CodePush / Expo Updates (no app store review needed for OTA JS bundles). So you have:
   - Base filter pack in app binary (slow updates, ~monthly)
   - Fast filter pack via OTA JS bundle (weekly)
   - Optional hot patch from `/api/filters/latest.json` on app launch (sub-week)

Cross-reference: your `packages/shared/src/providers/health.ts` should post a "broken provider" signal when a provider's playback fails persistently. Triaging that signal vs. a recent filter list release detects false positives fast.

**10. Performance.** Core principle: **stop scanning the DOM**. Cosmetic CSS is parsed once, applied via the style engine — effectively free. Network filtering is a hash lookup — sub-microsecond. Specifically:
- Drop the `setInterval` sweeper.
- Drop the `appendChild` interception (CPU + crashes).
- Drop the CPU watchdog (false positives + can't block miners that load before JS).
- Keep ONE MutationObserver, scoped to known ad-prone selectors, debounced at 250ms, scheduled via `requestIdleCallback`.
- Mobile: load `@cliqz/adblocker`-compiled engine into native side (Kotlin/Swift), not into the WebView JS. Compare URL against native map — no JS overhead at all.

Expected CPU profile: <0.1% sustained, vs. current ~10–15% on the sweeper's 3s scans.

---

## Implementation Plan (Phased)

### Phase 1 (1–2 weeks): Live the new foundation
1. Stand up `packages/filter-compiler/` with EasyList + EasyPrivacy + AdGuard Base + your current 80+ `AD_PATTERNS` as overrides. Output `compiled-filters.json`. Run as a pre-commit + CI hook.
2. Integrate `@cliqz/adblocker` `/Engine` into `apps/web/app/api/player/.../route.ts`. Use it in the existing HTML rewriter. Strip scripts/iframes/links matching network rules. Verify your currently-proxied providers still play.
3. Generate cosmetic CSS from compiled filters; inject as `<style id="fs-cosmetic">` in `<head>` server-side.
4. Replace the 15-layer `playerGuard.ts` with `minimal-guard.ts` (the ~50-line version above). Remove location freeze, appendChild interception, setInterval sweeper, popup focus reclaim, CPU watchdog.
5. Set `sandbox="allow-scripts allow-same-origin allow-presentation"` on the SecureIframe `<iframe>`. Verify popups stop on CF providers too.

### Phase 2 (2–3 weeks): Mobile native integration
6. Expo module: add `shouldInterceptRequest` on Android, wired to a static filter list bundled into the native module's JNI Kotlin side. Compile `compiled-filters.json` → in-memory hash map at module init.
7. iOS: convert compiled-filters to `WKContentRuleList` JSON at build time; load via `WKContentRuleListStore`. Wire `decidePolicyFor` for supp nav policy.
8. Mobile WebView: drop the inline guard scripts entirely (the native layer replaces them). Keep only the cosmetic CSS injection (`evaluateJavascript` on `onPageFinished` for Android, `WKUserScript` documentStart for iOS).
9. OTA fast-pack: load `/api/filters/latest.json` on app launch, persist to device storage, merge into native engine (Android subs block list; iOS recompiles `WKContentRuleList`).

### Phase 3 (2 weeks): Cloudflare unlock
10. Stand up `apps/web/app/api/cf-proxy/[provider]/[...path]/route.ts` using `flaresolverr` self-hosted (or a small Playwright instance hosted on a VPS, called via an HTTP wrapper). Cache `cf_clearance` cookies in KV/local-file with TTL.
11. Migrate `nxsha` and `chillflix` to CF-solver route. Verify playback + sandbox + cosmetic CSS all apply now (since path is same-origin).
12. Add per-provider allowlist field in `packages/shared/src/providers/registry.ts`: `allowedOrigins: string[]`. Drive CSP `frame-src`/`media-src`/`connect-src` from this.

### Phase 4 (1 week): Cleanup + telemetry
13. Remove retired layers from codebase (`playerGuard.ts` legacy exports, `SecureIframe` focus-reclaim, CPU watchdog).
14. Add filter-list effectiveness telemetry (test only — provider success rate before/after rule changes; opt-in, no PII).
15. False-positive triage: surface "blocked by network rule" decisions from `shouldInterceptRequest` in dev builds; tag with provider; ship weekly reports.

---

## Code Snippets (Key Parts)

### Server-side proxy rewrite with adblocker (apps/web/app/api/player/[provider]/route.ts excerpt)

```ts
import { Engine, CosmeticFilter } from '@cliqz/adblocker';
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
  const upstreamResp = await fetch(upstreamUrl, { headers: provider.headers });
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
        // Replace with empty comment node
        replaceWithComment(node, `<!-- FS blocked: ${match.filter} -->`);
      }
    }
  });
  
  // Inject minimal guard + cosmetic CSS at top of <head>
  const head = findHead(document);
  prependScript(head, MINIMAL_GUARD_JS);
  prependStyle(head, ab.getCosmeticFiltersFor(upstreamUrl).map(r => r.css).join('\n'));
  
  // Set CSP
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

### Web iframe with locked-down sandbox + CSP fallback (apps/web/components/player/SecureIframe.tsx excerpt)

```tsx
export function SecureIframe({ src, provider }: Props) {
  return (
    <iframe
      src={src}
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerPolicy="no-referrer"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      onLoad={(e) => {
        // No popup reclaim — sandbox already blocks popups
      }}
    />
  );
}
```

### Android native interception (player-webview module)

```kotlin
class PlayerWebViewClient(private val rules: CompiledFilterRules) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
        val url = req.url.toString()
        val host = req.url.host ?: return null
        
        // Allowlist first (video CDNs)
        if (rules.allowlist.contains(host)) return null
        
        // Then check block rules (O(1) hash table lookup)
        if (rules.blockDomains.contains(host) || rules.blockPatterns.any { url.contains(it) }) {
            return WebResourceResponse(
                "text/plain", "utf-8",
                204, "No Content",
                mapOf("X-FS-Block" to "1"),
                ByteArrayInputStream(ByteArray(0))
            )
        }
        return null
    }
    
    override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
        if (req.isRedirect && req.url.host != view.url?.let { Uri.parse(it).host }) return true
        if (req.url.scheme !in listOf("http", "https")) return true
        return false
    }
}
```

### iOS WKContentRuleList compilation (player-webview module)

```swift
// Pre-build step: convert compiled-filters.json -> webkit-rules.json
// Then at WebView init:

class PlayerWebViewView: UIView {
    func setupContentBlocker() {
        guard let rulesJSON = loadRulesFromBundle("webkit-rules.json") else { return }
        WKContentRuleListStore.default()?.compileContentRuleList(
            forIdentifier: "com.filmsnaps.adblocker",
            encodedContentRuleList: rulesJSON
        ) { ruleList, error in
            guard let ruleList = ruleList else { 
                print("Failed: \(error!)"); return 
            }
            self.webView.configuration.userContentController.add(ruleList)
        }
    }
    
    func webView(_ webView: WKWebView, decidePolicyFor nav: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = nav.request.url else { decisionHandler(.cancel); return }
        if url.scheme != "https" && url.scheme != "http" { decisionHandler(.cancel); return }
        if nav.targetFrame == nil { decisionHandler(.cancel); return }  // killed popup
        decisionHandler(.allow)
    }
}
```

### Filter list OTA (mobile)

```ts
// apps/mobile/lib/filters/refresh.ts
export async function refreshFilters(): Promise<void> {
  const latest = await fetch('https://api.filmsnaps.app/filters/latest.json');
  if (!latest.ok) return;
  const etag = latest.headers.get('etag');
  const cachedEtag = await SecureStore.getItemAsync('filters.etag');
  if (etag === cachedEtag) return;  // no change
  
  const data = await latest.json();
  await NativeModules.PlayerWebView.updateFilterRules(data);
  await SecureStore.setItemAsync('filters.etag', etag ?? '');
  await SecureStore.setItemAsync('filters.lastRefresh', Date.now().toString());
}
```

---

## Edge Cases

| Scenario | Mitigation |
|----------|------------|
| Provider rotates CDN domain every 24h | Allowlist must use registrable domain (or `*.video-cdn.tld` pattern). See `tldts` library for eTLD parsing. Add provider override rules that automatically allowlist any sibling subdomain of known video CDNs. |
| Provider serves video and ads from SAME domain | Network rule for that domain is suppressed; cosmetic CSS removes the ad container. Alternatively, `path-contains` rule for ad URLs on that domain (`provider.example.com^ads/`) — AdGuard-style path-specific block. |
| Cloudflare changes its challenge type (Turnstile/JS challenge/managed) | `flaresolverr` is community-maintained for this exact cat-and-mouse. Pin a known-good version; monitor breakage via provider health telemetry; fail over to direct iframe + sandbox when solver is down. |
| Chrome drops iframe sandbox support (extremely unlikely) | Iframes and sandbox are spec-level HTML5; this would break the entire web. Accept as tail risk. |
| WKContentRuleList at 50k-rule limit exceeded | Split rules across two `WKContentRuleList` instances. Apply high-priority rules (EasyPrivacy) first; deprioritize low-frequency rules. |
| Provider detects sandbox attribute and crashes the page | Add `allow-same-origin` (already present). Detecting "I'm in a sandboxed iframe" requires checking `window.frameElement` which returns null cross-origin regardless — providers can't reliably detect it. If a provider truly does this, switch to Path A (CF solver). |
| Provider mandates `unsafe-eval` for video player | Per-provider CSP profile in your registry; accept `unsafe-eval` only for that provider. Pair with strict `script-src` domain allowlist so eval'd code can only fetch from allowlisted domains. |
| Filter-list false positive breaks a provider | Per-provider allowlist in `packages/shared/src/providers/registry.ts` (`filterAllowlist: string[]`). These are merged at compile time as `@@||...$important`. Telemetry surfaces breakages within ~24h. |
| Service worker still loads despite network blocking | `navigator.serviceWorker.register` should never execute because the SW script itself is network-blocked. If somehow cached, SWs are scoped to origin; cross-origin iframe SWs cannot affect parent. Mobile: Android WebView has `setServiceWorkerEnabled` (disable by default). iOS doesn't support SWs in WKWebView. |
| User reports an ad that slipped through | Trivial: add `||known-ad-domain^` to `overrides/{provider}.json`; deploy in next daily filter compile. Compare ~5min cycle vs. current days-of-engineering cycle. |

---

## Migration Path

Don't do a big-bang rewrite. Sequence:

1. **Day 1**: Stand up `packages/filter-compiler/` CI step. Create `compiled-filters.json` artifact. This is a one-day landing that no one depends on yet — zero risk.
2. **Week 1**: Integrate adblocker into web proxy `route.ts` *alongside* (not replacing) your existing `protection.ts`. A/B / feature-flag: 10% of proxied provider loads go through the new path. Verify playback metrics. Monitor.
3. **Week 2**: Replace `<iframe sandbox>` attribute in `SecureIframe.tsx`. Rollback insurance: feature flag. Verify popup counts in telemetry drop to zero.
4. **Week 3**: Strip retired layers from `playerGuard.ts`. Now `protection.ts` becomes thin (just renders `MINIMAL_GUARD_JS`). Delete (don't comment out). If playback breaks, restore from git — relies on your test coverage.
5. **Weeks 4–5**: Mobile native interception. Wire native modules; ship OTA fast-pack endpoint; client telemetry enabled by default (privacy-preserving — only block/no-block booleans + provider ID, hashed URLs).
6. **Weeks 6–7**: Cloudflare solver standup. Migrate `nxsha`, `chillflix` to `/api/cf-proxy/...` route. Feature-flag per provider. Monitor proxy latency p50/p95.
7. **Week 8**: Telemetry dashboard, false-positive triage workflow.

The four-to-six-week "full deployment" timeline assumes one engineer. With two engineers in parallel (one on web, one on mobile modules) Phase 1+2 finish in 2 weeks.

---

## Closing

The pattern that will save you the most sustained engineering time: **when an ad slips through, the fix should always be a single-line addition to a filter list in your overrides directory, redeployed in CI in ~10 minutes.** If the fix requires new code, you've picked the wrong architecture. Right now your fixes require new code every time — that's the original sin this design corrects.

The first deliverable to ship is the filter compiler + integration into the existing proxy. Everything else layers on top of that foundation. Don't build anything else until the filter pipeline produces `compiled-filters.json` reliably in CI.