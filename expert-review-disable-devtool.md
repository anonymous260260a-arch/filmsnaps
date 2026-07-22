# Expert Review: `disable-devtool` Script Conflict in Android WebView Player

## 1. Problem Statement

We have a cross-platform streaming app (FilmSnaps) with an Android native WebView player module. Multiple third-party video providers (peachify, screenscape, cinemaos, etc.) embed the `disable-devtool` script from `https://theajack.github.io/disable-devtool/disable-devtool.min.js` in their pages. This script is an anti-debugging tool that detects DevTools/tampering and redirects the page to a white robot 404 page.

**The dilemma:**
- If we **allow** the script → it detects our injected globals as "tampering", redirects to its 404 page (white robot), and disrupts the video player
- If we **block** the script (return empty HTTP 200) → providers detect the script didn't load properly and show their own "no video" error
- If we **block the 404 redirect** at the network level → the script retries every 500ms in an infinite loop, consuming resources and still disrupting the video player

**This was NOT an issue before** when we reused the same WebView across provider switches (WebView pool approach). It only appeared after we switched to the "Destroy & Recreate" approach where each provider switch creates a brand new WebView.

## 2. Architecture Context

### Current Architecture: Destroy & Recreate with Double-Buffering

```
Provider switch flow:
1. React sets new sourceUri → native switchProvider() called
2. New WebView created INVISIBLE (incoming)
3. Guard script + addDocumentStartJavaScript injected
4. New URL loaded in background
5. Old WebView stays VISIBLE during load (no flicker)
6. When new page ready → swapViews() → old WebView destroyed
```

Key points:
- Each provider switch creates a **brand new WebView** (no pooling)
- Guard scripts are injected via `addDocumentStartJavaScript` (runs at document start)
- The `disable-devtool` script is loaded by the provider's HTML via `<script src>`
- Our injected globals (`__childFrameGuardInit`, native bridge objects) are present from document start

### Previous Architecture: WebView Pool (worked fine)

```
Provider switch flow:
1. Old WebView parked into pool (onPause + loadUrl("about:blank"))
2. New WebView created (or reused from pool)
3. Guard scripts re-injected
4. New URL loaded
```

In this approach, the `disable-devtool` script loaded once and stayed loaded. It didn't re-detect tampering on each provider switch because the WebView wasn't recreated.

## 3. What We've Tried

### Approach A: Allow the script, block the 404 redirect (Kotlin level)

**Implementation:**
```kotlin
// In shouldOverrideUrlLoading:
if (url.contains("theajack.github.io/disable-devtool/404.html")) {
    return true // Cancel navigation
}
```

**Result:** The redirect IS blocked, but the script retries every ~500ms in an infinite loop. The video player doesn't initialize properly because the script's tampering detection runs repeatedly, disrupting the JavaScript context. The provider shows its own "no video" error.

### Approach B: Block the script entirely (return empty HTTP 200)

**Implementation:**
```kotlin
// In shouldInterceptRequest:
if (url.contains("theajack.github.io/disable-devtool")) {
    return WebResourceResponse("application/javascript", "utf-8", 200, "OK",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)))
}
```

**Result:** The provider detects the script didn't load properly (empty body) and shows its own "no video" error. The video CDN requests are made but the player never initializes.

### Approach C: JS override in main frame (window.location.href)

**Implementation:**
```javascript
// Injected via addDocumentStartJavaScript:
var _proto = window.location.constructor.prototype;
var _desc = Object.getOwnPropertyDescriptor(_proto, 'href');
if (_desc && _desc.set) {
    var _origSet = _desc.set;
    Object.defineProperty(_proto, 'href', {
        set: function(url) {
            if (url.indexOf('theajack.github.io') !== -1) return;
            return _origSet.call(this, url);
        },
        get: _desc.get
    });
}
```

**Result:** The redirect is still attempted (shows in logs as `NAV:devtool-hijack`). The JS override may not be intercepting all redirect mechanisms, or the script uses a different approach. Video CDN requests are made but player doesn't render.

### Approach D: Combination of B + C

**Result:** Same as Approach B — provider shows "no video" error because the script body is empty.

## 4. Key Questions for Expert

### 4.1 Script Analysis
The `disable-devtool` script is public: `https://theajack.github.io/disable-devtool/disable-devtool.min.js`

**Can you analyze this script and tell us:**
1. What exactly does it detect as "tampering"? (custom globals, overridden methods, injected scripts, etc.)
2. What countermeasures does it take besides the redirect? (DOM manipulation, event blocking, method overrides, etc.)
3. Is there a way to make the script "think" everything is normal so it doesn't trigger any countermeasures?
4. Does the script check the response body of its own load? (i.e., does it verify it loaded correctly?)
5. What specific global variables or methods does it scan for?

### 4.2 Provider Dependency
The providers (peachify, screenscape, cinemaos) load this script via `<script src>`. Some providers seem to check that the script loaded (HTTP 200 with real content).

**Questions:**
1. Is there a way to return a "dummy" script that satisfies the provider's existence check but doesn't execute any tampering detection?
2. Could we return the actual script content but override the specific detection functions before they run?
3. Should we approach the providers to remove this dependency?

### 4.3 WebView-Specific Behavior
The issue only appears with the "Destroy & Recreate" approach. With the old WebView pool, the script loaded once and didn't cause problems.

**Questions:**
1. Why does the script cause issues on a fresh WebView but not on a reused one?
2. Is there something about the WebView initialization state that affects the script's behavior?
3. Could we pre-warm the WebView in a way that makes the script "see" a clean environment?

### 4.4 Alternative Approaches
1. **Content rewriting:** Intercept the script response and modify it to remove the tampering detection code while keeping the rest intact. Is this feasible?
2. **CSP injection:** Add a Content-Security-Policy header that blocks the script from executing. Would this break the provider?
3. **Script sandboxing:** Load the provider page in a sandboxed iframe where the script can't access the main frame's `window.location`.
4. **User-agent spoofing:** Could we make the WebView appear as a "normal" browser to the script?

## 5. Logs

### When script is allowed (redirect blocked at network level):
```
BLOCK | NAV:devtool-hijack | theajack.github.io | navigation | https://theajack.github.io/disable-devtool/404.html?h=peachify.top
```
This repeats every ~500ms. Video CDN requests are made but player doesn't render.

### When script is blocked (empty HTTP 200):
Provider shows its own "no video" error. No devtool-hijack entries in logs.

## 6. Constraints

1. **Cannot remove `theajack.github.io` from allowlist** — providers check for the script
2. **Cannot return fake script content** — providers detect empty/fake responses
3. **Must work on Android WebView** (Chrome-based, version varies)
4. **Must not break video playback** — this is the primary requirement
5. **Must work with Destroy & Recreate architecture** — this is non-negotiable for security

## 7. Request

Please analyze the `disable-devtool` script and suggest a solution that:
1. Lets the script load with real content (satisfies provider checks)
2. Prevents the script from detecting tampering or redirecting
3. Doesn't disrupt the video player
4. Works reliably across Android WebView versions

If you can provide a JavaScript injection that neutralizes the script's detection mechanism while keeping the rest functional, that would be ideal.
