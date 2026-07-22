# Expert Review: Provider Fallthrough / Redirect Hijacking in Android WebView Player

## 1. Problem Statement

When a user selects a streaming provider in our Android app, the selected provider's embed page loads in a native WebView. After 1-3 seconds, the WebView's content **silently changes to a different provider** (typically Server 1 / nxsha), while the React UI still shows the original provider as "selected."

### Observed behavior:

| Action | What happens |
|--------|-------------|
| Select Server 2 (peachify) | Shows peachify for ~1s → nxsha loads |
| Select Server 3 (screenscape) | Shows screenscape for ~1-3s → nxsha loads |
| Select Server 4 (nhdapi) | Takes 2-3s to switch (slow), but stays |
| Select Server 5 (zxcstream) | Loads zxcstream → after 1s cinemaos loads → after 1s zxcstream loads again |
| Select Server 6 (cinemaos) | Loads cinemaos → after 1s zxcstream loads |

### Expected behavior:
- The selected provider **must not change** under any circumstances
- Server 2 stays on Server 2, even if Server 2 returns HTTP 404/403
- No redirect to another provider, no embedded content from another provider
- Provider switching should be instant (or as fast as possible)

---

## 2. Architecture Overview

### 2.1 Provider Embed URLs

Each provider defines an embed URL template in `packages/shared/src/providers/registry.ts`:

```typescript
// Server 1 — nxsha
{ id: 'nxsha', baseUrl: 'https://web.nxsha.app', embed: { tv: `/embed/tv/${id}` } }
// Server 2 — peachify
{ id: 'peachify', baseUrl: 'https://peachify.top/embed', embed: { tv: `/tv/${id}` } }
// Server 3 — screenscape
{ id: 'screenscape', baseUrl: 'https://screenscape.me/embed', embed: { tv: `?tmdb=${id}` } }
// Server 4 — nhdapi
{ id: 'nhdapi', baseUrl: 'https://nhdapi.com', embed: { tv: `/embed/tv/${id}` } }
// Server 5 — zxcstream
{ id: 'zxcstream', baseUrl: 'https://zxcstream.xyz', embed: { tv: `/player/tv/${id}` } }
// Server 6 — cinemaos
{ id: 'cinemaos', baseUrl: 'https://cinemaos.live', embed: { tv: `/tv/watch/${id}` } }
```

The full URL becomes: `{baseUrl}{embed.path}` (e.g., `https://peachify.top/embed/tv/94997/1/1`).

### 2.2 React → Native rendering pipeline

```
VideoWebView.tsx (React component)
  ↓ source={{ uri: watchUrl }} + key={player-${mountGen}}
  ↓
PlayerWebView.tsx (Expo native module wrapper)
  ↓ exports { sourceUri, injectedScript, ... } as native props
  ↓
PlayerWebViewOverlayView.kt (Android custom view)
  ↓ has a WebView instance (from pool or newly created)
  ↓ loadUrl() → shouldInterceptRequest() → shouldOverrideUrlLoading() → onPageFinished()
```

### 2.3 Provider Switching Flow (VideoWebView.tsx:301)

```typescript
const switchProvider = (newId: string) => {
  clearAllState().catch(() => {});     // Clears cookies + WebStorage globally
  setProviderId(newId);                 // React state → new watchUrl computed
  setMountGen((g) => g + 1);           // Changes webViewKey → forces native remount
  if (newId !== providerId) setLoading(true);
  setError(null);
  setShowPicker(false);
  navigationChainRef.current = new Set();
  pageLoadedRef.current = false;
  navigationGenRef.current += 1;
  navigationAttemptsRef.current = 0;
};
```

The `clearAllState()` native call clears:
- `CookieManager.getInstance().removeAllCookies(null)` — all cookies, globally
- `WebStorage.getInstance().deleteAllData()` — all localStorage
- Temporary WebView: `clearCache(true)`, `clearFormData()`, `clearHistory()`, `clearSslPreferences()`

### 2.4 WebView Pool System

When the VideoWebView remounts (key change), the old native WebView is parked into a pool:
```
onDetachedFromWindow()
  → wv.onPause()
  → wv.loadUrl("about:blank")
  → wv visibility = GONE
  → remove from parent
  → add to pool (max 1-2 WebViews)
```

When a new VideoWebView mounts, it either reuses a pooled WebView or creates a new one:
```
ensureWebView()
  → if pool has WebView: reuse it (saves ~500-800ms renderer init)
  → else: create new WebView
  → addDocumentStartJavaScript(injectedScript) — registers persistent script
```

### 2.5 Guard Script Injection

The guard script (anti-adblock, popup blocking, progress reporting) is injected via two mechanisms:

1. **`addDocumentStartJavaScript()`** — persistent injection for ALL frames, registered once during `ensureWebView()`. Runs at document start on every page load.

2. **`evaluateJavascript()`** — one-shot injection for the main frame, called in `dispatchPageFinished()` after each page load.

---

## 3. Current Blocking / Navigation Rules

### 3.1 Request Flow in shouldInterceptRequest (PlayerWebViewOverlayView.kt ~780-930)

```
Request arrives
  ↓
[WDEV] workers.dev strict partitioning → BLOCK non-media, ALLOW media
  ↓
[R2] Known CDN domains (allowedCdnHosts) → ALLOW
  ↓
[R3] Current provider domain/subdomain → ALLOW
  ↓
[ADBLOCK_ENGINE] EasyList/EasyPrivacy/AdGuard → BLOCK if match
  ↓
[R4] Heuristic (iframe/script/image to unknown 3rd party) → BLOCK
  ↓
[R5] Provider profile → BLOCK non-allowed resources
  ↓
[R6-7] Domain/path blocklist → BLOCK
  ↓
[R8] Default → ALLOW
```

This ordering was recently changed (R2/R3 were moved BEFORE ADBLOCK_ENGINE).

### 3.2 Navigation Rules in shouldOverrideUrlLoading (PlayerWebViewOverlayView.kt ~666-717)

```kotlin
// Only blocks if NOT user-initiated:
if (request.isForMainFrame && !userInitiatedNavigation) {
    val chost = currentUrl?.let { Uri.parse(it) }?.host?.lowercase()
    if (targetHost != chost && !allowedCdnHosts.contains(targetHost)) {
        // BLOCK — hijack prevented
        return true  // block
    }
}
if (request.isForMainFrame) userInitiatedNavigation = false
```

The `userInitiatedNavigation` flag is set to `true` in `loadUrl()` but is **never consumed** because `loadUrl()` bypasses `shouldOverrideUrlLoading`. It stays `true` and leaks into the first in-page navigation.

### 3.3 Provider Profiles

Each provider has a profile defining which domains are allowed for `script`, `iframe`, and `image` resource types (used by R5):

```kotlin
private val providerProfiles: Map<String, Set<String>> = mapOf(
  "web.nxsha.app" to setOf("web.nxsha.app", "workers.dev", "cloudfront.net"),
  "peachify.top" to setOf("peachify.top", "eat-peach.sbs", "workers.dev",
                          "theintrodb.org", "flagcdn.com", "fonts.googleapis.com",
                          "gstatic.com", "cloudfront.net"),
  "screenscape.me" to setOf("screenscape.me", "googletagmanager.com",
                            "fonts.googleapis.com", "gstatic.com"),
  "www.chillflix.lol" to setOf("www.chillflix.lol", "vidapi.cloud", "cloudfront.net"),
  // ... other providers
)
```

Note: Some providers do NOT have a profile (e.g., zxcstream, cinemaos) and fall through to the general heuristic rules.

### 3.4 Known CDN Allowlist

```kotlin
private val allowedCdnHosts: Set<String> = setOf(
  "akamai.net", "cloudfront.net", "fastly.net",
  "xbm.", "mp4.",                      // Cloudflare Worker prefix patterns
  "vidapi.cloud", "vidnees",
  "eat-peach.sbs",
  "opensubtitles.org", "allorigins.win",
)
```

---

## 4. Recent Fixes (already applied, NOT YET TESTED)

### Fix A: userInitiatedNavigation reset (line 639)
Added `userInitiatedNavigation = false` in `onPageStarted()` to prevent the flag from leaking into the first in-page navigation.

### Fix B: R2/R3 before ADBLOCK_ENGINE
Moved CDN and provider domain checks before the adblock engine to prevent false-positive blocks of video/subtitle domains.

### Fix C: Subtitle domains in allowedCdnHosts
Added `opensubtitles.org` and `allorigins.win` to the CDN allowlist.

---

## 5. Known Gaps / Unsolved Issues

### 5.1 `Sec-Fetch-Dest` header missing on mobile
The heuristic blocking rules (R4, R5) check `secFetchDest in setOf("iframe", "script", "image")`. On Android WebView, this header can be null for certain request types (older Chrome, redirects, navigations). When null, the rule is skipped entirely, allowing cross-provider iframe loads.

### 5.2 `addDocumentStartJavaScript` script staleness
When a WebView is reused from the pool, `addDocumentStartJavaScript` was registered with the OLD provider's guard script. If the guard script is re-called (via `addDocumentStartJavaScript` again) with the new provider's script, the old script runs first and sets `__childFrameGuardInit`, preventing the new script's CSS from being injected.

### 5.3 Provider fallback architecture
The fundamental issue: provider embed pages may redirect to other providers (either as a server-side 302 redirect or client-side JS `window.location`). We need to:
1. **Block ALL cross-provider navigations** — full stop
2. **Block cross-provider iframe content** — don't load other providers' HTML in iframes
3. **Show the selected provider** — even if it fails, show the failure for THAT provider

Currently, the `shouldOverrideUrlLoading` hijack check only blocks unsolicited navigations (not user-initiated). JS redirects from the provider's page are treated as user-initiated in some Android WebView versions.

### 5.4 Provider switch speed
Current switch time: ~2-5s. Breakdown:
- `clearAllState()`: ~100-500ms (cookie clear + WebStorage clear)
- WebView pool/remount: ~0-800ms
- Provider page load: ~1-3s (DNS, TLS, HTML, JS)
- Video player initialization: variable

### 5.5 `clearAllState()` race condition
`clearAllState()` is fire-and-forget (not awaited). The WebView starts loading the new URL before cookies are fully cleared. Cookies from the old provider might influence the new provider's page behavior.

---

## 6. Code File Locations

| File | Role |
|------|------|
| `apps/mobile/components/VideoWebView.tsx` | React player component, provider switching |
| `apps/mobile/modules/player-webview/src/PlayerWebView.tsx` | Native module React wrapper |
| `apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/PlayerWebViewOverlayView.kt` | Native WebView + blocking + injection |
| `apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/PlayerwebviewModule.kt` | Expo module definition + clearAllState |
| `apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/AdblockEngine.kt` | EasyList-based ad blocking |
| `packages/shared/src/providers/registry.ts` | Provider definitions (URLs, allowed origins) |
| `packages/filter-compiler/src/export-android.ts` | Generates adblock-patterns.json |

---

## 7. Key Questions for Expert

1. **Main-frame redirect prevention:** The `userInitiatedNavigation` flag approach has a fundamental flaw — some in-page navigations (JS `window.location`, server 302 redirects) may not trigger `shouldOverrideUrlLoading` reliably across Android versions. What is the most robust way to prevent ANY main-frame navigation that changes the provider domain?

2. **Child iframe cross-provider blocking:** When `Sec-Fetch-Dest` header is null (common on mobile WebView), the heuristic rules (R4, R5) are skipped. How can we reliably block iframe documents from other provider domains?

3. **Guard script re-injection on provider switch:** `addDocumentStartJavaScript` scripts persist across pool operations but become stale when a new provider loads. How should we handle updating the injected script when the provider changes?

4. **Fast provider switching:** The WebView pool saves ~500-800ms but the full switch is still 2-5s. Is there a way to pre-initialize WebViews or preload provider pages to make switching instant?

5. **Alternative architecture:** Should we consider embedding each provider in its own isolated WebView (one per provider) rather than using a single WebView with pool recycling? The pool already keeps 1-2 WebViews. Expanding to N WebViews (one per provider) could eliminate the remount cost entirely.

6. **`clearAllState()` timing:** The fire-and-forget cookie clear means cookies might not be cleared before the new URL loads. Does this cause observable issues?

---

## 8. Environment

- **Platform:** Android (primary), Windows (web)
- **WebView:** Android System WebView (Chrome-based), version varies
- **Minimum API level:** Android 10 (API 29)
- **Device profile:** Tested on low-end (MediaTek Helio G35, 3GB RAM) and mid-range (Snapdragon 778G, 8GB RAM)
- **Expo modules:** Custom native module using `expo-modules-core`
- **React Native:** Latest SDK via Expo
