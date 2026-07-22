# Experimental Provider Sandbox — Findings

## What We Tried

Build a hidden WebView sandbox that runs compiled Nuvio provider JS bundles
to test whether video stream extraction works without full integration.

- **7 providers bundled**: dooflix, vidnest, vixsrc, cinevibe, yflix, moviebox, castle
- **Architecture**: Hidden `react-native-webview` renders a self-contained HTML page that provides a `require()` shim, injects the provider JS, calls `module.exports.getStreams()`, and posts results back to React Native via `postMessage`
- **Runtime environment**: WebView with `source={{ html }}` → `data:` URI → origin is `null`

## What Worked

| Capability | Status |
|------------|--------|
| WebView loading inline HTML | ✅ Works |
| JS injection into WebView | ✅ Works, even for 50+ KB bundles |
| `module.exports` shim | ✅ All providers export `getStreams` correctly |
| `getStreams()` invocation | ✅ Called with correct args |
| Promise-based async flow | ✅ Promises resolve/reject properly |
| `postMessage` back to React Native | ✅ All message types received |
| React.memo + useMemo to prevent infinite reload loops | ✅ Fixed |
| TMDB API calls (`api.themoviedb.org`, allows `null` origin) | ✅ Succeed |
| Crypto-js CDN load | ✅ Loads successfully |

## What Failed

| Issue | Detail |
|-------|--------|
| **CORS — all non-TMDB API calls blocked** | Every `fetch()` call from `null` origin gets `Failed to fetch` — CORS policy blocks cross-origin requests from `data:` URIs |
| CORS — TMDB API works | TMDB's API sets `Access-Control-Allow-Origin: *`, so it works from `null` origin |
| CORS — all video CDN/API requests fail | `panel.watchkaroabhi.com`, `first.vidnest.fun`, `enc-dec.app`, `castle-downloader.xyz` — all reject `null` origin |
| Two providers hang (vixsrc, moviebox) | Their requests neither succeed nor fail within 60s — possibly using XMLHttpRequest that behaves differently with CORS failures |

**Concrete failure count (7 providers, Oppenheimer TMDB ID 872585):**

| Provider | Size | Result |
|----------|------|--------|
| dooflix | 3.1 KB | 0 streams, CORS blocked (1 fetch to panel.watchkaroabhi.com) |
| vidnest | 5.9 KB | 0 streams, TMDB OK, but 6 fetches to vidnest.fun all CORS blocked |
| vixsrc | ? | Timed out (no fetch log seen) |
| cinevibe | 3.7 KB | 0 streams, TMDB OK, but no further API visible |
| yflix | 4.6 KB | 0 streams, CORS blocked (1 fetch to enc-dec.app) |
| moviebox | ? | Timed out (needs crypto-js, but even that loaded OK) |
| castle | 3.3 KB | `Failed to fetch` error (1 fetch to castle-downloader.xyz) |

## Root Cause

The `react-native-webview` `source={{ html }}` renders the HTML as a `data:` URI,
which has origin `null`. The `fetch()` API in the browser enforces CORS — any
request to an origin that doesn't explicitly allow `null` via
`Access-Control-Allow-Origin: null` is blocked.

This is a WebView-level security restriction that cannot be bypassed via
WebView props (`originWhitelist`, `allowUniversalAccessFromFileURLs`, etc.)
because it's enforced by the browser engine, not WebView configuration.

## Alternatives (for future reference)

### 1. Local HTTP Server (recommended)
Run a tiny HTTP server on `localhost` inside the app to serve the sandbox HTML.
This gives a proper origin (`http://localhost:PORT`) that many APIs either allow
or can be configured to allow.

**Trade-offs**: Adds ~1-2 MB bundle size for the server, requires port management,
works on both platforms.

### 2. Android `shouldInterceptRequest` Proxy
Override `WebViewClient.shouldInterceptRequest()` in the native Android WebView
to intercept provider API calls and proxy them through the native HTTP stack,
bypassing CORS.

**Trade-offs**: Android-only, significant native code, requires maintaining
request/response header mapping.

### 3. WebView `injectedJavaScript` Before Request (Android-only)
Use `evaluateJavascript` to set `window.fetch` to an implementation that uses
the native WebView's cookie jar but skips CORS preflight. Not actually possible
from JS alone — CORS is enforced at the browser engine level.

### 4. Change Provider Architecture
Instead of running providers in a sandbox WebView, run the provider JS in a
React Native Hermes JS context (using `vm` or a JS engine) and implement all
HTTP requests through React Native's native `fetch()` which doesn't enforce
browser CORS.

**Trade-offs**: Requires rewriting providers to not use browser APIs, or
providing comprehensive browser API polyfills in the JS engine context.

## Code Artifacts

| File | Purpose |
|------|---------|
| `apps/mobile/components/experimental/ProviderSandbox.tsx` | Hidden WebView component with memoization |
| `apps/mobile/components/experimental/providerSources.ts` | Compiled provider JS bundles (7 providers) |
| `apps/mobile/components/experimental/types.ts` | TypeScript types for sandbox |
| `apps/mobile/app/experimental/index.tsx` | Test page UI |
| `apps/mobile/app/(tabs)/settings.tsx` | Settings link (dev-only) |
| `apps/mobile/app/_layout.tsx` | Route registration (dev-only) |

## Recommendations

1. **Abandon the WebView sandbox approach** for Nuvio provider testing. CORS
   from `null` origin is an insurmountable limitation for most APIs.

2. **Option 4 (Hermes JS context)** is the most promising long-term approach:
   run provider JS natively where CORS isn't a factor. The `require()` shim
   pattern we built is reusable.

3. **Clean up experimental code** when no longer needed — file list above.
