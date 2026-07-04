# 🤝 Contributing to FilmSnaps

Guidelines for adding providers, features, and making changes across web, mobile, and desktop.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Adding a New Provider](#adding-a-new-provider)
3. [Provider Types & Security Scripts](#provider-types--security-scripts)
4. [Platform-Specific Notes](#platform-specific-notes)
5. [Testing Checklist](#testing-checklist)
6. [Code Style & Conventions](#code-style--conventions)
7. [Common Pitfalls](#common-pitfalls)

---

## Project Structure

```
filmsnaps/
├── packages/shared/src/providers/   ← Provider registry (SOURCE OF TRUTH)
│   └── registry.ts
├── apps/web/                        ← Next.js web app
│   ├── app/watch/[...id]/WatchClient.jsx
│   ├── app/api/player/              ← Player proxy
│   └── lib/movieProviders/
│       ├── providers.ts             ← Web-specific provider list
│       └── iframeProviders.ts       ← Iframe provider configs
├── apps/mobile/                     ← React Native/Expo app
│   └── components/VideoWebView.tsx  ← WebView with security scripts
└── apps/desktop/                    ← Electron app
```

---

## Adding a New Provider

### Step 1: Register in Shared Package (REQUIRED)

**File**: `packages/shared/src/providers/registry.ts`

```typescript
{
  id: 'myprovider',                    // Unique ID (used in URLs & code)
  name: 'MyProvider',                  // Internal name
  displayName: 'Server XX',            // Shown in UI (mask real name)
  baseUrl: 'https://example.com/embed', // Embed base URL
  embed: {
    movie: (id) => `/movie/${id}`,
    tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
  },
}
```

### Step 2: Add to Web Provider List

**File**: `apps/web/lib/movieProviders/providers.ts`

Add the same provider object to the web-specific list.

### Step 3: Add to Iframe Providers (if applicable)

**File**: `apps/web/lib/movieProviders/iframeProviders.ts`

If the provider uses iframe embedding (most do), add to `iframeProviders` map and `providerConfigs`.

### Step 4: Add to Video Extract (if applicable)

**File**: `apps/web/app/api/video-extract/[provider]/route.ts`

If the provider needs server-side video extraction, add to the `PROVIDERS` map.

### Step 5: Test on Mobile (IMPORTANT)

The mobile WebView has stricter security. Test that:
1. Video plays without 404 errors
2. No ad popups appear
3. Fullscreen works (if provider has its own)
4. Provider UI elements are accessible

---

## Provider Types & Security Scripts

### Type 1: Standard Providers (Default)

**Security Script**: `POPUP_BLOCKER_SCRIPT`
**Used by**: Most providers (vixsrc, toonstream, etc.)

**Characteristics**:
- No Cloudflare protection
- Standard ad injection (popups, overlays, trackers)
- Works with full ad blocking stack (13 layers)

**What happens automatically**:
- All 13 security layers applied
- Navigation chain tracking (5s bootstrap)
- Overlay ad removal with settings protection
- Fetch/XHR/iframe interception

### Type 2: Cloudflare-Protected Providers

**Security Script**: `makeCFBypassScript(providerHost)`
**Used by**: nxsha, chillflix

**Characteristics**:
- Protected by Cloudflare's challenge-platform
- Detects WebView environments
- Uses Next.js App Router (SPA)
- Needs specific browser fingerprinting to pass challenge

**What you MUST do**:
1. Add provider ID to the CF check in `VideoWebView.tsx`:
   ```typescript
   if (providerId === 'nxsha' || providerId === 'chillflix' || providerId === 'NEWPROVIDER') {
     ? makeCFBypassScript(new URL(currentProvider.baseUrl).hostname)
   }
   ```
2. Add to `onShouldStartLoadWithRequest` CF allowlist:
   ```typescript
   if (providerId === 'nxsha' || providerId === 'chillflix' || providerId === 'NEWPROVIDER') {
     // Only allow same-origin
   }
   ```
3. Add to fullscreen handling (if provider has fullscreen button)
4. Add to `onMessage` handler for landscape lock

**Characteristics of CF_BYPASS_SCRIPT**:
- Cloudflare fingerprint bypass (webdriver, chrome, plugins, WebGL)
- Blocks `window.open` (popups)
- Removes non-provider iframes via MutationObserver
- Does NOT freeze `location` (breaks Next.js routing)
- Does NOT block `pushState` (breaks client-side navigation)
- Does NOT block `new Function()` (breaks provider scripts)

### Type 3: Providers Needing Custom Handling

If a provider doesn't fit the above categories:

1. **Document why** in the code comments
2. **Create a new bypass script** if needed (follow `makeCFBypassScript` pattern)
3. **Test on all platforms** (web, mobile, desktop)
4. **Update this documentation**

---

## Platform-Specific Notes

### Mobile (React Native WebView)

**File**: `apps/mobile/components/VideoWebView.tsx`

**Key considerations**:
- WebView environment is detectable by Cloudflare
- `injectedJavaScriptBeforeContentLoaded` runs before page scripts
- `onShouldStartLoadWithRequest` catches top-level navigation
- `onMessage` receives messages from injected JS (e.g., fullscreen events)
- `expo-screen-orientation` locks rotation for fullscreen

**Adding a new CF-protected provider**:
1. Add to `makeCFBypassScript` check
2. Add to `onShouldStartLoadWithRequest` allowlist
3. Add to `onMessage` handler
4. Add to height adjustment (if needed for controls)
5. Add to fullscreen button hiding (if provider has its own)
6. Add to provider-specific UI cleanup (if needed)

### Web (Next.js)

**File**: `apps/web/app/watch/[...id]/WatchClient.jsx`

**Key considerations**:
- Iframe loads provider directly (no proxy needed for most)
- Proxy available at `/api/player/` for problematic providers
- `onShouldStartLoadWithRequest` not available (browser iframe)

### Desktop (Electron)

**File**: `apps/desktop/`

**Key considerations**:
- Separate renderer process for security
- `nodeIntegration: false` enforced
- Same security scripts as mobile (injected via `executeJavaScript`)

---

## Testing Checklist

### New Provider
- [ ] Registered in `packages/shared/src/providers/registry.ts`
- [ ] Added to `apps/web/lib/movieProviders/providers.ts`
- [ ] Added to `apps/web/lib/movieProviders/iframeProviders.ts`
- [ ] Video plays on web (Chrome, Firefox, Safari)
- [ ] Video plays on mobile (Android WebView, iOS WKWebView)
- [ ] Video plays on desktop (Electron)
- [ ] No ad popups appear
- [ ] No overlay ads covering video
- [ ] Fullscreen works (if provider has it)
- [ ] Provider UI elements accessible (settings, server list, etc.)
- [ ] No console errors in WebView
- [ ] No CORS errors in browser console

### Security Changes
- [ ] Test on standard provider (vixsrc)
- [ ] Test on CF-protected provider (nxsha/chillflix)
- [ ] Verify ad blocking still works
- [ ] Verify navigation blocking still works
- [ ] Verify provider settings/quality menus still work
- [ ] Test fullscreen/landscape behavior
- [ ] Test provider switching mid-session

---

## Code Style & Conventions

### JavaScript Security Scripts
- Use `var` (not `const`/`let`) for compatibility with older WebViews
- Wrap in IIFE `(function(){ ... })()` to avoid polluting global scope
- Always `try/catch` individual protections (one failure doesn't break others)
- Use `console.log('[AB] ...')` for ad-blocking debug messages
- Comment each protection layer with `// ── Layer N: Description ──`

### TypeScript (React Native)
- Use `useMemo` for expensive computations (provider lists, URLs)
- Use `useCallback` for event handlers
- Use `useRef` for mutable values that don't trigger re-renders
- Destructure props in function signature

### Provider Registry
- `id`: lowercase, no spaces (e.g., `'myprovider'`)
- `displayName`: Human-readable, masked (e.g., `'Server 20'`)
- `baseUrl`: Include `/embed` suffix if provider uses it
- `embed.movie`: Return path relative to `baseUrl` (e.g., `/movie/${id}`)
- `embed.tv`: Return path with season/episode (e.g., `/tv/${id}/${season}/${episode}`)

---

## Common Pitfalls

### ❌ Don't: Freeze `location` for CF-protected providers
```javascript
// BREAKS Next.js client-side routing
Object.defineProperty(window, 'location', { ... });
```

### ❌ Don't: Block `pushState` for CF-protected providers
```javascript
// BREAKS Next.js navigation
history.pushState = function() { return; };
```

### ❌ Don't: Block `new Function()` for CF-protected providers
```javascript
// BREAKS provider scripts that use dynamic code generation
window.Function = function() { return function() {}; };
```

### ✅ Do: Use CF_BYPASS_SCRIPT for Cloudflare providers
```typescript
if (providerId === 'nxsha' || providerId === 'chillflix') {
  makeCFBypassScript(providerHost)
}
```

### ✅ Do: Test provider switching
- User might switch from standard → CF-protected mid-session
- Security script must change correctly
- WebView remounts with new script

### ✅ Do: Handle provider-specific UI quirks
- Some providers hide controls in portrait mode → add height adjustment
- Some providers have install/login buttons → add cleanup
- Some providers use `intent://` URLs → add to blocklist

---

## Architecture Decisions

### Why Two Security Scripts?

1. **Standard providers**: Full ad blocking is needed. They inject aggressive ads, trackers, and popups. The 13-layer `POPUP_BLOCKER_SCRIPT` handles all of these.

2. **CF-protected providers**: Full ad blocking BREAKS them. They use Next.js App Router which needs `location`, `pushState`, and `new Function()`. We use lightweight bypass + same-origin enforcement instead.

### Why Not Proxy Everything?

Proxying breaks Next.js SPAs because:
- URL rewriting breaks client-side routing
- Fetch/XHR interception conflicts with RSC data fetching
- CORS issues with cross-origin asset loading

Better to load directly and use browser-level security.

### Why `injectedJavaScriptBeforeContentLoaded`?

Runs BEFORE page scripts execute. This means:
- We override `navigator.webdriver` before Cloudflare checks it
- We block `window.open` before ads can override our block
- We freeze `location` before ads can hijack it
