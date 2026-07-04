# 🛡️ FilmSnaps Security Documentation

Complete reference for all security measures across web, mobile, and desktop platforms. This document ensures we never lose context on what's protected and why.

---

## Table of Contents

1. [Overview](#overview)
2. [Mobile WebView Security (VideoWebView.tsx)](#mobile-webview-security)
3. [Cloudflare-Protected Providers (CF Bypass)](#cloudflare-protected-providers)
4. [Navigation & Redirect Blocking](#navigation--redirect-blocking)
5. [Web App Security](#web-app-security)
6. [Desktop App Security](#desktop-app-security)
7. [Provider Security Model](#provider-security-model)
8. [Threat Matrix](#threat-matrix)

---

## Overview

FilmSnaps loads third-party streaming providers inside iframes/WebViews. These providers inject ads, trackers, popups, and malicious scripts. Our security model blocks these threats while preserving video player functionality.

**Key principle**: Block at the network/navigation level, not through aggressive DOM manipulation. Let the page load normally, intercept malicious actions.

---

## Mobile WebView Security

**File**: `apps/mobile/components/VideoWebView.tsx`

### Two Security Scripts

| Script | Used For | Approach |
|--------|----------|----------|
| `POPUP_BLOCKER_SCRIPT` | Most providers (vixsrc, toonstream, etc.) | Full ad blocking + navigation freezing |
| `makeCFBypassScript(host)` | Cloudflare-protected (nxsha, chillflix) | Minimal: Cloudflare evasion + iframe ad blocking |

The choice is made at line ~936:
```typescript
injectedJavaScriptBeforeContentLoaded={
  (providerId === 'nxsha' || providerId === 'chillflix')
    ? makeCFBypassScript(new URL(currentProvider.baseUrl).hostname)
    : POPUP_BLOCKER_SCRIPT
}
```

### POPUP_BLOCKER_SCRIPT — 13 Protection Layers

#### Layer 1: Popup / Navigation Freezing
- `window.open` → Returns fake proxy object (no actual popup)
- `Object.defineProperty(window, 'open', ...)` → Non-writable, non-configurable
- `window.location` setter → Frozen (prevents `location = "ad-url"`)
- **Why**: Providers open popups on first click, then redirect to ads

#### Layer 2: Ad / Tracker Domain Blocklist
- 50+ known ad domains (doubleclick, googleadservices, criteo, taboola, etc.)
- Applied to: `fetch()`, `XMLHttpRequest.open()`, iframe `src`, `<a>` clicks
- **Why**: Blocks tracking pixels, ad scripts, and analytics

#### Layer 3: Fetch / XHR Interception
- `window.fetch` → Returns 204 for ad domain requests
- `XMLHttpRequest.prototype.open` → Aborts ad domain requests
- **Why**: Ad scripts load via fetch/XHR; blocking at network level is cleanest

#### Layer 4: Iframe Creation Interception
- `document.createElement('iframe')` → Intercepts `setAttribute('src')` and `src` property
- Blocks iframes with ad domain URLs
- **Why**: Ads inject hidden iframes for tracking and popunders

#### Layer 5: Click Interception
- `document.addEventListener('click', ...)` → Captures clicks on `<a>` tags
- Blocks navigation to external domains (different hostname)
- Also checks parent elements for buttons/images inside anchors
- **Why**: Ads use `<a>` links that bypass `window.open` blocking

#### Layer 6: Form Submission Blocking
- `document.addEventListener('submit', ...)` → Blocks forms submitting to external domains
- **Why**: Hidden forms auto-submit to ad/tracking endpoints

#### Layer 7: Location Method Blocking
- `location.replace()` → Blocked for external domains
- `location.assign()` → Blocked for external domains
- **Why**: Some ads bypass the frozen `location` setter by using methods directly

#### Layer 8: Overlay Ad Removal + Auto-Skip
- `setInterval(1200ms)` → Continuously scans for:
  - **Skip buttons**: Auto-clicks "skip", "skip ad", "continue to video" (only in floating elements with z-index > 50)
  - **Ad iframes**: Removes large iframes (>150x150) on external domains (allows known video domains: vidsrc, embed, player, video, cdn, peachify)
  - **Overlay divs**: Removes fixed/sticky elements with high z-index (protects settings dialogs by checking for multiple buttons and settings-related text)
- **Why**: Provider video players use overlays for ads that cover the content

#### Layer 9: History Manipulation Blocking
- `history.pushState` → Blocked (returns without action)
- `history.replaceState` → Blocked
- **Why**: Ads use history API to change URL and trigger page state changes

#### Layer 10: Navigation + Download Blocking
- Blocks `<a download>` clicks
- Intercepts `location.href` setter to block:
  - File downloads (.apk, .zip, .exe, .msi, .dmg, .rar, .7z)
  - Cross-hostname navigation (ad redirects)
- **Why**: Malicious redirects to download pages and ad landing pages

#### Layer 11: Service Worker Blocking
- Unregisters all existing service workers
- Blocks `navigator.serviceWorker.register()`
- Periodic sweep every 5 seconds
- **Why**: Service workers can intercept all network requests, cache data, and send push notifications

#### Layer 12: eval() + Function() Blocking
- `window.eval()` → Allows small scripts (<10KB), blocks large blobs (packed ads)
- `new Function()` → Returns empty function
- `Function.prototype.constructor` → Blocked
- **Why**: Ad scripts use eval/Function to execute dynamically-downloaded code

#### Layer 13: document.write Blocking
- `document.write()` → No-op
- `document.writeln()` → No-op
- **Why**: Ads use document.write to inject scripts synchronously

#### CSP Meta Tag Injection
- Injects Content-Security-Policy meta tag:
  ```
  default-src 'self' * 'unsafe-inline' 'unsafe-eval';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' *;
  frame-src *;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  ```
- **Why**: Restricts resource loading while allowing provider functionality

### WebView Props (Hardcoded Security)

```typescript
setSupportMultipleWindows={false}     // Prevents popup windows
geolocationEnabled={false}            // No location access
mixedContentMode="never"              // Blocks HTTP on HTTPS pages
cacheEnabled={false}                  // Fresh loads, no cached ad content
allowsBackForwardNavigationGestures={false}  // Prevents navigation manipulation
```

### Navigation Chain Tracking (onShouldStartLoadWithRequest)

For standard providers:
1. **Bootstrap phase (first 5s)**: Records all domains in redirect chain
2. **Post-bootstrap**: Only allows same-hostname or chain domains
3. **Unknown domains**: Blocked as likely ads
4. **`intent://` URLs**: Always blocked (Android ad deep links)

---

## Cloudflare-Protected Providers

**Function**: `makeCFBypassScript(providerHost: string)`

Used for: `nxsha` (Server 1), `chillflix` (Server 18)

### Why Different Script?
Standard providers work with `POPUP_BLOCKER_SCRIPT`. Cloudflare-protected providers detect WebViews via:
- `navigator.webdriver` property
- Missing `window.chrome` object
- Missing `navigator.plugins`
- WebGL fingerprinting

The `POPUP_BLOCKER_SCRIPT` also breaks these providers because it freezes `location`, blocks `pushState`, and blocks `new Function()` — all needed by their Next.js SPA routing.

### Cloudflare Bypass
```javascript
navigator.webdriver → false
window.chrome → { runtime: {}, loadTimes, csi }
navigator.plugins → [1,2,3,4,5]
navigator.languages → ['en-US', 'en']
navigator.permissions.query → Returns notification permission
WebGLRenderingContext.getParameter → Returns "Intel Inc." / "Intel Iris OpenGL Engine"
```

### Fullscreen Interception
- Intercepts `Element.prototype.requestFullscreen` / `exitFullscreen`
- Sends `postMessage({type:'cf:fullscreen', entering})` to React Native
- React Native locks screen to landscape on enter, unlocks on exit
- **Why**: These providers hide bottom controls in portrait mode; landscape forces them visible

### Ad Blocking (Lightweight)
- `window.open` → Returns null (blocks popups)
- MutationObserver + 500ms cleanup → Removes iframes NOT from provider domain
- `onShouldStartLoadWithRequest` → Only allows same-origin navigation

### Provider-Specific UI Cleanup

**Nxsha** (Server 1):
- CSS injection: `a[href="https://nxsha.app"]{display:none!important}`
- Hides install app banner in cloud server dialog
- Cloud server button itself is preserved (important feature)

**ChillFlix** (Server 18):
- JS-based: Hides buttons matching "watch party", "login", "sign in", "create account"
- Runs once at 2s after page load

### Height & Orientation
- Portrait mode: `SCREEN_HEIGHT * 0.40` (shows bottom controls)
- Fullscreen: Forces landscape via `expo-screen-orientation`
- Our app's fullscreen button hidden (provider has its own)

---

## Navigation & Redirect Blocking

###三层Defense

| Layer | Mechanism | What It Blocks |
|-------|-----------|----------------|
| JS Injected | `POPUP_BLOCKER_SCRIPT` / `CF_BYPASS_SCRIPT` | window.open, location.set, fetch/XHR, iframes |
| WebView Props | `onShouldStartLoadWithRequest` | Top-level navigation to unknown domains |
| WebView Props | `setSupportMultipleWindows={false}` | Popup windows |

### Domain Allowlisting (CF Providers)
```typescript
// onShouldStartLoadWithRequest
if (providerId === 'nxsha' || providerId === 'chillflix') {
  const providerHost = new URL(currentProvider.baseUrl).hostname;
  if (host === providerHost) return true;
  return false;  // Block everything else
}
```

---

## Web App Security

### API Routes
- `/api/video-extract/[provider]/route.ts` — Provider-specific video extraction
- `/api/player/[provider]/route.ts` — Player proxy with uBlock-style filtering

### WatchClient.jsx
- Nxsha loads directly in iframe (no proxy needed for web)
- Other providers use `/api/player/` proxy
- Navigation blocking via `onShouldStartLoadWithRequest`

### next.config.js Security Headers
```javascript
headers: [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
```

---

## Desktop App Security

**File**: `apps/desktop/`

### Electron Security
- `nodeIntegration: false` — No Node.js in renderer
- `contextIsolation: true` — Renderer can't access main process
- `webSecurity: true` — Same-origin policy enforced
- `preload.js` — Only exposes specific IPC channels

---

## Provider Security Model

### Provider Definition (packages/shared/src/providers/registry.ts)
```typescript
interface ProviderDefinition {
  id: string;           // Unique identifier (e.g., 'vixsrc', 'nxsha')
  name: string;         // Internal name
  displayName: string;  // Shown in UI (e.g., "Server 1")
  baseUrl: string;      // Embed base URL
  embed: {
    movie: (id: string) => string;
    tv: (id: string, season: number, episode: number) => string;
  };
}
```

### Provider Categories

| Category | Providers | Security Script | Notes |
|----------|-----------|-----------------|-------|
| Standard | vixsrc, toonstream, etc. | `POPUP_BLOCKER_SCRIPT` | Full ad blocking |
| Cloudflare-Protected | nxsha, chillflix | `CF_BYPASS_SCRIPT` | Cloudflare evasion + lightweight blocking |

### Adding New Providers
See [CONTRIBUTING.md](CONTRIBUTING.md) for step-by-step guide.

---

## Threat Matrix

| Threat | Mitigation | Layer |
|--------|------------|-------|
| Popup ads | `window.open` blocked | JS Layer 1 |
| Redirect ads | `location.set/freeze` + `onShouldStartLoadWithRequest` | JS Layer 1 + WebView |
| Ad iframes | MutationObserver + periodic cleanup + `document.createElement` interception | JS Layers 4, 8 |
| Tracking pixels | fetch/XHR interception + ad domain blocklist | JS Layer 2, 3 |
| Overlay ads | Fixed/sticky element removal with settings protection | JS Layer 8 |
| Form hijacking | Form submission blocking | JS Layer 6 |
| History manipulation | pushState/replaceState blocking | JS Layer 9 |
| File downloads | Download link/URL blocking | JS Layer 10 |
| Service workers | SW registration blocking + periodic sweep | JS Layer 11 |
| Code injection | eval/Function blocking (with size threshold) | JS Layer 12 |
| DOM overwrite | document.write blocking | JS Layer 13 |
| WebView detection | Cloudflare bypass (webdriver, chrome, plugins, WebGL) | CF Bypass Script |
| Intent deep links | `intent://` URL blocking in `onShouldStartLoadWithRequest` | WebView Layer |
| Cross-origin nav | Same-origin enforcement for CF providers | WebView Layer |
| Ad button clicks | Click interception on `<a>` tags | JS Layer 5 |
| Auto-submit forms | Submit event interception | JS Layer 6 |
