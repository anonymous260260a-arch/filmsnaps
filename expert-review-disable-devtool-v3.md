# Expert Review v3: `disable-devtool` — Why JavaScript Injection Fails

## Executive Summary

After exhaustive analysis of the `disable-devtool` source code and 7+ failed attempts to neutralize it via JavaScript injection, we've identified the **root cause**: our `addDocumentStartJavaScript` injections are NOT running before the inline script executes. The provider embeds the `disable-devtool` script INLINE in its HTML, and Android WebView's `addDocumentStartJavaScript` API does NOT guarantee execution before inline `<script>` blocks in the same document.

## The Core Problem

### Our Injection Architecture
```kotlin
// In switchProvider():
WebViewCompat.addDocumentStartJavaScript(newWv, DEVTOOT_REDIRECT_BLOCKER, emptySet())
WebViewCompat.addDocumentStartJavaScript(newWv, injectedScript, emptySet())
// ... later ...
newWv.loadUrl(url)  // Page loads with inline disable-devtool script
```

### What Actually Happens
1. `addDocumentStartJavaScript` registers scripts to run at document start
2. `loadUrl()` starts loading the provider's HTML
3. The provider's HTML contains an **inline** `<script>` block that calls `disableDevtool()`
4. The inline script runs **BEFORE** our `addDocumentStartJavaScript` scripts
5. The detectors are installed before our overrides are in place
6. Our overrides never take effect

### Evidence from Logs
- `NAV:devtool-hijack` entries appear every ~500ms starting at ~024615ms
- This proves the `setInterval` heartbeat IS running (our FIX 3c didn't block it)
- The redirect IS happening (our Layer 3 redirect interception catches it at Kotlin level)
- But the detectors are still firing and calling `closeWindow()`

## What We've Tried (All Failed)

| Attempt | Approach | Result |
|---------|----------|--------|
| Layer 1 | Freeze `window.disableDevtool` as no-op | Script uses ES module exports, not `window.disableDevtool` |
| Layer 2 | Network stub returning HTTP 200 | Script is INLINE, not fetched via network |
| Layer 3 | Redirect interception (Location.href, etc.) | Redirect blocked but detectors still fire |
| Layer 4 | Timing warmup (console.log, Function.toString) | Detectors still fire despite warmup |
| FIX 3c | Block setInterval heartbeat | Heartbeat still runs (proof: NAV:devtool-hijack entries) |
| FIX 3b | Block `__defineGetter__` on HTML elements | DefineIdDetector still fires |
| Expert fix | console.table alias, console.log throttle | Detectors still fire |

## Why All JavaScript Approaches Fail

The fundamental issue is **timing**: `addDocumentStartJavaScript` scripts run at document start, but inline `<script>` blocks in the HTML execute as the parser encounters them. If the provider's inline script runs before our injected scripts, all our overrides are too late.

This is confirmed by the logs: the `NAV:devtool-hijack` entries prove the heartbeat IS running, which means `disableDevtool()` was called successfully, which means the detectors were installed before our overrides.

## Recommended Solution: HTML Response Interception

Since JavaScript injection fails, the only reliable approach is to **intercept and modify the provider's HTML response** before it reaches the WebView.

### How It Works
1. In `shouldInterceptRequest`, when the provider's HTML is loaded as a document
2. Fetch the HTML response body
3. Find the `<script>` tag that loads `disable-devtool` (or the inline script that calls it)
4. Either:
   - **Option A**: Replace the script with a no-op: `<script>window.disableDevtool=function(){}</script>`
   - **Option B**: Add `data-disable-devtool-auto` attribute with `ignore` config pointing to a function that always returns true
5. Return the modified HTML

### Implementation Sketch
```kotlin
// In interceptRequestForWebView, after P0 check:
if (request.isForMainFrame && host in effectiveProviderRootHosts) {
    // This is a provider page loading — intercept and modify HTML
    val conn = URL(url).openConnection() as HttpURLConnection
    val html = conn.inputStream.bufferedReader().readText()
    
    // Neutralize disable-devtool: replace the script reference
    val modifiedHtml = html
        .replace(Regex("""<script[^>]*src=["'][^"']*disable-devtool[^"']*[""][^>]*>"""), 
                 """<script>window.disableDevtool=function(){return{close:function(){},isRunning:function(){return false}}};</script>""")
        .replace(Regex("""disableDevtool\(\{[^}]*\}\)"""), "/* neutered */")
    
    return WebResourceResponse("text/html", "utf-8", 
        ByteArrayInputStream(modifiedHtml.toByteArray()))
}
```

### Pros
- Completely neutralizes the script before it runs
- No timing issues — the script never executes
- Works regardless of how the script is loaded (inline, external, etc.)

### Cons
- Performance overhead (fetch + parse + modify HTML on every provider page load)
- Fragile (HTML regex can break on format changes)
- Need to handle gzip encoding, chunked transfer, etc.

## Alternative: Return Real Script Body (No Detectors)

Instead of modifying the HTML, intercept the script request and return the **real script content with detectors disabled**:

```kotlin
// Fetch the real script once, cache it
val realScript = fetchAndCache("https://theajack.github.io/disable-devtool/disable-devtool.min.js")

// Patch: neuter all detectors
val patchedScript = realScript
    .replace(Regex("""this\.onDevToolOpen\(\)"""), "/* neutered */")
    .replace(Regex("""config\.ondevtoolopen"""), "function(){}")

// Return patched script for all disable-devtool requests
return WebResourceResponse("application/javascript", "utf-8", 
    ByteArrayInputStream(patchedScript.toByteArray()))
```

This satisfies the provider's existence check (real script body, correct Content-Length) while completely disabling all detectors.

## Recommendation

**Implement HTML Response Interception (Option A)**. It's the most reliable approach because:
1. No timing dependencies
2. Works with inline scripts
3. Completely neutralizes the script before execution
4. The provider sees HTTP 200 with real HTML content

The performance overhead is acceptable for a video player app (one extra fetch per provider page load).
