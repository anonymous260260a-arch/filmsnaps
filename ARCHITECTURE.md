# 🛡️ Iframe Streaming System - Architecture Documentation

A production-grade, uBlock Origin-inspired iframe streaming system that blocks trackers and prevents navigation hijacking while preserving video player functionality.

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [System Components](#system-components)
3. [Request Flow](#request-flow)
4. [Filter Engine](#filter-engine)
5. [Security Model](#security-model)
6. [Edge Cases](#edge-cases)
7. [Comparison with uBlock Origin](#comparison-with-ublock-origin)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FILMSNAPS ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌─────────────────────────────────────────────────┐   │
│  │   Browser    │     │              Next.js Server                      │   │
│  │              │     │                                                  │   │
│  │  ┌────────┐  │     │  ┌──────────────────────────────────────────┐   │   │
│  │  │ Parent │  │     │  │           Iframe Proxy                   │   │   │
│  │  │  App   │  │     │  │  ┌────────────────────────────────────┐  │   │   │
│  │  │        │  │     │  │  │  1. Fetch External HTML            │  │   │   │
│  │  │  ┌───┐ │  │     │  │  │  2. Apply Filter Rules             │  │   │   │
│  │  │  │IFR│ │◄─┼─────┼──┼──┼──3. Inject Runtime Sandbox         │  │   │   │
│  │  │  │AM│ │  │     │  │  │  │  4. Rewrite Resource URLs        │  │   │   │
│  │  │  │E  │ │  │     │  │  │  │  5. Set Security Headers         │  │   │   │
│  │  │  └───┘ │  │     │  │  └────────────────────────────────────┘  │   │   │
│  │  │   ▲    │  │     │  │                    │                       │   │   │
│  │  └───┼────┘  │     │  │                    ▼                       │   │   │
│  │      │       │     │  │  ┌──────────────────────────────────────┐ │   │   │
│  │      │       │     │  │  │         Asset Proxy                  │ │   │   │
│  │      │       │     │  │  │  ┌────────────────────────────────┐  │ │   │   │
│  │      │       │     │  │  │  │  Filter Engine Check           │  │ │   │   │
│  │      │       │     │  │  │  │  ↓                             │  │ │   │   │
│  │      │       │     │  │  │  │  Blocked? → Return 204         │  │ │   │   │
│  │      │       │     │  │  │  │  Allowed? → Fetch & Return     │  │ │   │   │
│  │      │       │     │  │  │  └────────────────────────────────┘  │  │   │   │
│  │      │       │     │  │  └──────────────────────────────────────┘ │   │   │
│  │      │       │     │  └──────────────────────────────────────────┘   │   │
│  │      │       │     └─────────────────────────────────────────────────┘   │
│  │      │                                                                    │
│  │      │  Runtime Sandbox (Injected into iframe)                           │
│  │      │  ┌─────────────────────────────────────────────────────────────┐  │
│  │      │  │  Layer 1: Navigation Blocking                               │  │
│  │      │  │  - window.open → null                                       │  │
│  │      │  │  - location → mock object                                   │  │
│  │      │  │  - history.pushState → intercepted                          │  │
│  │      │  ├─────────────────────────────────────────────────────────────┤  │
│  │      │  │  Layer 2: Network API Interception                          │  │
│  │      │  │  - fetch → filtered & rewritten                             │  │
│  │      │  │  - XMLHttpRequest → filtered & rewritten                    │  │
│  │      │  │  - sendBeacon → blocked                                     │  │
│  │      │  ├─────────────────────────────────────────────────────────────┤  │
│  │      │  │  Layer 3: Element Creation Interception                     │  │
│  │      │  │  - document.createElement → src/hrewritten                  │  │
│  │      │  │  - Image() → src filtered                                   │  │
│  │      │  ├─────────────────────────────────────────────────────────────┤  │
│  │      │  │  Layer 4: Service Worker Neutralization                     │  │
│  │      │  │  - navigator.serviceWorker → blocked                        │  │
│  │      │  └─────────────────────────────────────────────────────────────┘  │
│  │                                                                          │
│  └──────────────────────────────────────────────────────────────────────────┘
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                    Filter Engine (uBlock-inspired)                     │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Rules: ||cdn-cgi/rum^, ||googletagmanager.com^, etc.           │  │  │
│  │  │  Types: domain, path, regex, exact                               │  │  │
│  │  │  Applied: Server-side + Client-side                              │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 System Components

### 1. Server-Side Proxy (`/api/iframe-proxy/[provider]`)

**Purpose:** Fetch external HTML, apply minimal sanitization, inject runtime sandbox.

**Key Features:**
- Minimal HTML sanitization (preserves player functionality)
- Runtime sandbox injection (before any page scripts)
- URL rewriting for assets
- Security headers (CSP, Referrer-Policy, etc.)

**File:** `app/api/iframe-proxy/[provider]/route.ts`

```typescript
// Key operations:
// 1. Fetch upstream HTML
// 2. minimalSanitize() - remove only known trackers
// 3. injectSandbox() - add runtime sandbox script
// 4. Return with security headers
```

---

### 2. Asset Proxy (`/api/[provider]/[...asset]`)

**Purpose:** Proxy all resource requests with filter engine blocking.

**Key Features:**
- Filter rule checking before fetching
- Returns 204 for blocked requests
- Proper CORS headers
- Special handling for service workers/manifests

**File:** `app/api/[provider]/[...asset]/route.ts`

```typescript
// Key operations:
// 1. Check shouldBlockRequest() using filter engine
// 2. If blocked → return 204 No Content
// 3. If allowed → fetch and return with CORS headers
```

---

### 3. Runtime Sandbox (Client-Side Injection)

**Purpose:** Provide runtime protection inside the iframe.

**Key Features:**
- Navigation hijacking prevention
- Network API interception
- Element creation interception
- Service worker neutralization

**File:** `lib/runtime-sandbox/index.ts`

**Injection Point:** Immediately after `<head>` tag (before any page scripts)

---

### 4. Filter Engine

**Purpose:** uBlock Origin-inspired rule matching system.

**Key Features:**
- EasyList-style filter rules
- Multiple rule types (domain, path, regex, exact)
- Server-side and client-side application

**File:** `lib/filter-engine/index.ts`

**Default Rules:**
```typescript
||cdn-cgi/rum^
||googletagmanager.com^
||google-analytics.com^
||doubleclick.net^
||cloudflareinsights.com^
```

---

## 🔄 Request Flow

### Page Load Flow

```
1. User navigates to /watch/movie/123
   ↓
2. WatchClient renders iframe with src:
   /api/iframe-proxy/vixsrc?url=https://vixsrc.to/movie/123
   ↓
3. Iframe Proxy:
   a. Fetches https://vixsrc.to/movie/123
   b. Applies minimalSanitize()
   c. Injects Runtime Sandbox script
   d. Rewrites relative URLs to /api/vixsrc/...
   e. Returns HTML with security headers
   ↓
4. Browser loads iframe content
   ↓
5. Runtime Sandbox executes FIRST:
   a. Blocks window.open, location changes
   b. Intercepts fetch, XHR
   c. Intercepts document.createElement
   ↓
6. Page scripts execute (with protections active)
   ↓
7. Resource requests flow through Asset Proxy:
   a. Script: /api/vixsrc/js/player.js
   b. Asset Proxy checks filter rules
   c. If blocked → 204 No Content
   d. If allowed → fetch from origin
```

### Resource Request Flow

```
1. Page requests: <script src="/js/tracker.js">
   ↓
2. Base tag rewrites to: /api/vixsrc/js/tracker.js
   ↓
3. Asset Proxy receives request
   ↓
4. Filter Engine checks:
   - URL: https://vixsrc.to/js/tracker.js
   - Rules: matches ||tracker^ pattern?
   ↓
5a. BLOCKED:
   - Return 204 No Content
   - Log: [Asset Proxy] 🚫 Blocked: ...
   
5b. ALLOWED:
   - Fetch from origin
   - Return with CORS headers
```

---

## 🎯 Filter Engine

### Rule Syntax

The filter engine uses EasyList-compatible syntax:

| Pattern | Example | Description |
|---------|---------|-------------|
| `||domain^` | `||googletagmanager.com^` | Block any URL containing domain |
| `|https://exact` | `|https://tracker.com` | Block exact domain start |
| `/regex/` | `/.*analytics.*\.js/` | Regex pattern matching |
| `path` | `/cdn-cgi/rum` | Simple substring match |

### Rule Options

```typescript
$third-party    // Only block third-party requests
$first-party    // Only block first-party requests
$script         // Only block script requests
$image          // Only block image requests
$xhr            // Only block XMLHttpRequest
$fetch          // Only block fetch requests
$frame          // Only block iframe requests
$media          // Only block media requests
```

### Adding Custom Rules

```typescript
import { createFilterEngine } from '@/lib/filter-engine';

const engine = createFilterEngine([
  '||custom-tracker.com^',
  '/.*malicious.*\\.js/',
]);

// Check if URL is blocked
if (engine.isBlocked('https://custom-tracker.com/script.js')) {
  // Block the request
}
```

---

## 🔒 Security Model

### Defense in Depth

The system uses multiple layers of protection:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 0: Browser Sandbox                                    │
│ - iframe sandbox attribute                                  │
│ - Blocks: top-navigation, popups, modals                    │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: Server-Side Proxy                                  │
│ - Minimal sanitization (removes known trackers)             │
│ - Security headers (CSP, Referrer-Policy)                   │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Runtime Sandbox                                    │
│ - Navigation blocking (location, window.open, history)      │
│ - Network interception (fetch, XHR, sendBeacon)             │
│ - Element creation interception                             │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Filter Engine                                      │
│ - Rule-based blocking (server + client)                     │
│ - EasyList-compatible syntax                                │
└─────────────────────────────────────────────────────────────┘
```

### Iframe Sandbox Configuration

```html
<iframe
  sandbox="allow-scripts allow-same-origin allow-forms"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  referrerpolicy="no-referrer"
>
```

**Why these permissions:**

| Permission | Allowed? | Reason |
|------------|----------|--------|
| `allow-scripts` | ✅ YES | Video players require JavaScript for initialization, HLS/DASH playback, controls |
| `allow-same-origin` | ✅ YES | Required for cookies/storage (session management), prevents CORS issues |
| `allow-forms` | ✅ YES | Some players use forms for quality selection, subtitles |
| `allow-top-navigation` | ❌ NO | Prevents iframe from escaping and navigating parent window |
| `allow-popups` | ❌ NO | Prevents popup windows (ads, trackers) |
| `allow-modals` | ❌ NO | Prevents alert/confirm/prompt abuse |

**Why NOT removing sandbox completely is unsafe:**

```
❌ DANGEROUS (no sandbox):
<iframe src="...">

Problems:
- iframe can navigate parent window (window.top.location)
- iframe can open popup windows
- iframe can show modal dialogs
- iframe can escape its boundaries

✅ SAFE (proper sandbox):
<iframe sandbox="allow-scripts allow-same-origin allow-forms" src="...">

Benefits:
- Navigation hijacking blocked at browser level
- Popups blocked at browser level
- Modals blocked at browser level
- Player functionality preserved
```

---

## ⚠️ Edge Cases

### 1. Video Not Loading

**Symptoms:** Player shows but video doesn't play

**Causes:**
- Video URL blocked by filter rules
- CORS issues with video stream
- Blob URL handling

**Solutions:**

```typescript
// Check filter rules - ensure video domains are not blocked
// Add exception for video domains:
const CUSTOM_RULES = [
  '@@||videoserver.com^$media',  // Whitelist video domain
];

// For blob URLs, the runtime sandbox already handles them:
if (url.startsWith('blob:')) {
  return url;  // Don't proxy blob URLs
}
```

---

### 2. CSP Conflicts

**Symptoms:** Console shows CSP violations, player scripts blocked

**Solution:** The CSP is intentionally permissive for player functionality:

```typescript
// In iframe-proxy route.ts
const directives = [
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: *",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: *",
  "media-src 'self' blob: data: *",
  // ...
];
```

**Note:** `'unsafe-inline'` and `'unsafe-eval'` are required because:
- Player scripts often use inline scripts
- HLS.js and other players use eval for decryption

---

### 3. Blob URLs

**Handling:** Blob URLs are NOT proxied (they're local to the browser):

```typescript
function rewriteUrl(url) {
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return url;  // Don't proxy
  }
  // ... rest of rewriting
}
```

**How it works:**
1. Player fetches video through proxy
2. Player creates blob URL from fetched data
3. Video element uses blob URL
4. Blob URL works normally (not intercepted)

---

### 4. HLS Streams (.m3u8)

**Handling:** HLS streams are proxied with special handling:

```typescript
// Asset proxy handles .m3u8 files
if (contentType.includes('application/vnd.apple.mpegurl')) {
  // Return m3u8 playlist
  // Segment URLs in playlist are automatically proxied via base tag
}
```

**Flow:**
```
1. Player requests: /api/vixsrc/stream/playlist.m3u8
2. Asset Proxy fetches from origin
3. m3u8 contains segment URLs: segment-1.ts, segment-2.ts
4. Base tag rewrites segments to: /api/vixsrc/segment-1.ts
5. All segments flow through proxy with filtering
```

---

### 5. DASH Streams (.mpd)

**Handling:** Similar to HLS, DASH manifests are proxied:

```typescript
if (contentType.includes('application/dash+xml')) {
  // Return mpd manifest
  // Segment URLs are proxied via base tag
}
```

---

### 6. Cloudflare Challenge Pages

**Symptoms:** Cloudflare protection page appears instead of content

**Causes:**
- Cloudflare detects automated requests
- JavaScript challenge not completed

**Solutions:**
1. Use proper User-Agent headers
2. Include Referer and Origin headers
3. Maintain cookies across requests (if needed)

```typescript
const upstream = await fetch(targetUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
    'Referer': new URL(targetUrl).origin + '/',
    'Origin': new URL(targetUrl).origin,
  },
});
```

---

## 🔍 Comparison with uBlock Origin

### Similarities

| Feature | uBlock Origin | Filmsnaps System |
|---------|--------------|------------------|
| Filter rules | EasyList syntax | EasyList-compatible |
| Network blocking | Intercepts requests | Intercepts requests |
| Script injection | Scriptlets | Runtime Sandbox |
| Element hiding | CSS selectors | DOM removal |
| Multiple layers | Browser extension + content scripts | Server + Client |

### Differences

| Aspect | uBlock Origin | Filmsnaps System |
|--------|--------------|------------------|
| Environment | Browser extension | Server + iframe |
| Scope | All browser traffic | Only iframe content |
| Persistence | User-configurable | System-defined |
| DOM access | Full extension APIs | Limited to iframe |

### How Filmsnaps Mimics uBlock Internally

```
uBlock Origin Flow:
1. Network request initiated
2. Request intercepted by extension
3. Filter rules checked
4. Blocked? → Return empty response
5. Allowed? → Continue to server

Filmsnaps Flow:
1. Network request initiated (inside iframe)
2. Runtime Sandbox intercepts (fetch/XHR override)
3. Filter rules checked (client-side)
4. Blocked? → Return 204 response
5. Allowed? → Request flows to Asset Proxy
6. Asset Proxy checks filter rules (server-side)
7. Blocked? → Return 204 response
8. Allowed? → Fetch from origin
```

**Key insight:** Filmsnaps implements the same blocking logic as uBlock, but at the application level instead of the browser extension level.

---

## 📁 File Structure

```
lib/
├── filter-engine/
│   └── index.ts          # uBlock-inspired rule matching
├── runtime-sandbox/
│   └── index.ts          # Client-side injection script
└── movieProviders/
    ├── common.ts         # Base sanitization utilities
    ├── index.ts          # Provider registry
    └── iframeProviders.ts # Provider origins

app/
└── api/
    ├── iframe-proxy/
    │   └── [provider]/
    │       └── route.ts  # Main iframe proxy
    └── [provider]/
        └── [...asset]/
            └── route.ts  # Asset proxy with filtering

watch/
└── [...id]/
    └── WatchClient.jsx   # Iframe component with sandbox
```

---

## ✅ Success Criteria Checklist

- [x] Loads third-party pages without breaking video players
- [x] Blocks ALL trackers (Cloudflare RUM, GA, GTM, etc.)
- [x] Blocks unwanted navigation (redirects, popups, top navigation)
- [x] Prevents malicious JS behavior
- [x] Avoids CORS errors
- [x] Works consistently across providers (not hardcoded)
- [x] Implements uBlock-like filter engine
- [x] Proper iframe sandbox configuration
- [x] Defense in depth (multiple protection layers)

---

## 🚀 Usage Example

```typescript
// In your component:
<iframe
  src={`/api/iframe-proxy/vixsrc?url=${encodeURIComponent(
    'https://vixsrc.to/movie/123'
  )}`}
  sandbox="allow-scripts allow-same-origin allow-forms"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  referrerPolicy="no-referrer"
/>

// The system automatically:
// 1. Fetches the page
// 2. Blocks trackers
// 3. Injects runtime sandbox
// 4. Proxies all resources
// 5. Prevents navigation hijacking
```

---

## 📝 Maintenance

### Adding New Filter Rules

Edit `lib/filter-engine/index.ts`:

```typescript
export const DEFAULT_FILTER_RULES: string[] = [
  // ... existing rules
  '||new-tracker.com^',
  '/.*malicious.*\\.js/',
];
```

### Adding New Providers

Edit `lib/movieProviders/iframeProviders.ts`:

```typescript
export const iframeProviders: Record<string, string> = {
  // ... existing providers
  newprovider: 'https://newprovider.com',
};
```

---

## 📞 Support

For issues or questions:
1. Check filter rules in `lib/filter-engine/index.ts`
2. Review runtime sandbox in `lib/runtime-sandbox/index.ts`
3. Inspect network requests in browser DevTools
4. Check server logs for proxy errors
