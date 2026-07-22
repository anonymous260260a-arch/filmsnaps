# Expert Review v2: `disable-devtool` — Full Code + Logs

## 1. Problem

The `disable-devtool` script from `theajack.github.io` runs in our Android WebView player. It detects "tampering" (our injected guard scripts, native bridge objects) and tries to redirect to its 404 page. We've implemented a 5-layer defense but the script STILL runs — the `NAV:devtool-hijack` redirect attempts appear every ~500ms, and the provider (peachify) shows its own "no video" 404.

**Key observation:** This was NOT an issue with the old WebView pool approach. It only broke after switching to "Destroy & Recreate" (each provider switch creates a brand new WebView).

## 2. Our Architecture

### WebView Lifecycle
- **No pooling** — each provider switch creates a brand new WebView
- **Double-buffering** — new WebView loads INVISIBLE in background, old stays VISIBLE until swap
- **Swap trigger** — `onPageFinished` on the incoming WebView OR 4s timeout
- **Old WebView destroyed** after swap via `destroyWebViewCompletely()`

### Script Injection Points

1. **`addDocumentStartJavaScript`** in `ensureWebView()` (first attach) and `switchProvider()` (each switch) — injects `DEVTOOT_REDIRECT_BLOCKER` then `injectedScript`
2. **`evaluateJavascript`** in `onPageStarted()` — backup injection of `DEVTOOT_REDIRECT_BLOCKER_NOOP`
3. **`evaluateJavascript`** in `dispatchPageFinished()` — re-injects `injectedScript`
4. **`shouldInterceptRequest`** — returns stub script for `disable-devtool.min.js` requests
5. **`shouldOverrideUrlLoading`** — blocks `disable-devtool/404.html` navigation

### Current Code

#### DEVTOOT_REDIRECT_BLOCKER (injected via addDocumentStartJavaScript):
```kotlin
private val DEVTOOT_REDIRECT_BLOCKER = """
  (function(){
    'use strict';

    // Layer 4: Aggressive timing warmup
    try { var _f=function(){}; for(var i=0;i<1000;i++){_f.toString();} Function.prototype.toString.call(_f); } catch(e){}
    try { for(var j=0;j<500;j++){console.log('');} } catch(e){}
    try { for(var k=0;k<100;k++){Object.keys(window);} } catch(e){}
    try { var _e=eval; for(var m=0;m<50;m++){_e('1+1');} } catch(e){}
    try { var _st=setTimeout; for(var n=0;n<50;n++){_st(function(){},1);} } catch(e){}

    // Layer 1: Freeze window.disableDevtool as no-op
    var noop=function(opts){return{close:function(){},isRunning:function(){return false;}};};
    noop.close=function(){};noop.isRunning=function(){return false;};
    try{Object.defineProperty(window,'disableDevtool',{value:noop,writable:false,configurable:false,enumerable:true});}catch(e){try{window.disableDevtool=noop;}catch(_){}}
    try{Object.defineProperty(noop,'version',{value:'0.0.0',configurable:false});Object.defineProperty(noop,'debug',{value:function(){},configurable:false});Object.defineProperty(noop,'time',{value:Date.now(),configurable:false});}catch(e){}

    // Layer 3: Comprehensive redirect interception
    var HINTS=['theajack.github.io','disable-devtool','/404.html'];
    function blocked(u){if(u==null)return false;var s=String(u);for(var i=0;i<HINTS.length;i++){if(s.indexOf(HINTS[i])!==-1)return true;}return false;}
    try{var proto=window.Location.prototype;var d=Object.getOwnPropertyDescriptor(proto,'href');if(d&&d.set){var origHrefSet=d.set;Object.defineProperty(proto,'href',{configurable:true,enumerable:true,get:d.get,set:function(u){if(!blocked(u))origHrefSet.call(this,u);}});}}catch(e){}
    ['assign','replace'].forEach(function(m){var orig=window.Location.prototype[m];window.Location.prototype[m]=function(u){if(!blocked(u))return orig.call(this,u);};});
    var origOpen=window.open;window.open=function(u){if(blocked(u))return null;return origOpen.apply(this,arguments);};
    try{var dDesc=Object.getOwnPropertyDescriptor(Document.prototype,'location');if(dDesc&&dDesc.set){var origDocSet=dDesc.set;Object.defineProperty(Document.prototype,'location',{configurable:true,enumerable:true,get:dDesc.get,set:function(u){if(!blocked(u))origDocSet.call(this,u);}});}}catch(e){}
    ['pushState','replaceState'].forEach(function(m){var orig=History.prototype[m];History.prototype[m]=function(state,title,url){if(url&&blocked(url))return;return orig.apply(this,arguments);};});
  })();
""".trimIndent()
```

#### DEVTOOT_REDIRECT_BLOCKER_NOOP (backup, injected via evaluateJavascript in onPageStarted):
```kotlin
private val DEVTOOT_REDIRECT_BLOCKER_NOOP = """
  (function(){
    try{
      var noop=function(){return{close:function(){},isRunning:function(){return false;}};};
      noop.close=function(){};noop.isRunning=function(){return false;};
      if(!window.disableDevtool||window.disableDevtool===Function){
        try{Object.defineProperty(window,'disableDevtool',{value:noop,writable:false,configurable:false,enumerable:true});}catch(e){window.disableDevtool=noop;}
      }
    }catch(e){}
  })();
""".trimIndent()
```

#### Network-level stub (in interceptRequestForWebView):
```kotlin
if (url.contains("theajack.github.io/disable-devtool")) {
    val isPage = url.contains("404.html")
    logRequest("BLOCK", if (isPage) "REQ:devtool-404" else "REQ:devtool-stub",
        "theajack.github.io", if (isPage) "empty" else "script", url)
    if (isPage) {
        return WebResourceResponse("text/html", "utf-8", 200, "OK",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(ByteArray(0)))
    }
    val stub = buildString {
        append("(function(){'use strict';\n")
        append("var noop=function(o){return{close:function(){},isRunning:function(){return false;}}};\n")
        append("noop.close=function(){};noop.isRunning=function(){return false;};\n")
        append("noop.version='0.0.0';\n")
        append("try{Object.defineProperty(window,'disableDevtool',{value:noop,writable:false,configurable:false,enumerable:true});}catch(e){window.disableDevtool=noop;}\n")
        repeat(4000) { append(" ") }
        append("})();\n")
    }.toByteArray(Charsets.UTF_8)
    return WebResourceResponse("application/javascript", "utf-8", 200, "OK",
        mapOf("Content-Type" to "application/javascript; charset=utf-8",
              "Content-Length" to stub.size.toString(),
              "Cache-Control" to "no-cache, no-store, must-revalidate"),
        ByteArrayInputStream(stub))
}
```

#### NAV redirect block (in shouldOverrideNavForWebView):
```kotlin
if (url.contains("theajack.github.io/disable-devtool/404.html")) {
    logRequest("BLOCK", "NAV:devtool-hijack", "theajack.github.io", "navigation", url)
    return true
}
```

#### Injection points:
```kotlin
// In ensureWebView() — first WebView creation:
WebViewCompat.addDocumentStartJavaScript(wv, DEVTOOT_REDIRECT_BLOCKER, emptySet())
if (injectedScript.isNotEmpty()) {
    WebViewCompat.addDocumentStartJavaScript(wv, injectedScript, emptySet())
}

// In switchProvider() — incoming WebView:
WebViewCompat.addDocumentStartJavaScript(newWv, DEVTOOT_REDIRECT_BLOCKER, emptySet())
if (injectedScript.isNotEmpty()) {
    WebViewCompat.addDocumentStartJavaScript(newWv, injectedScript, emptySet())
}

// In onPageStarted() — backup injection:
view?.evaluateJavascript(DEVTOOT_REDIRECT_BLOCKER_NOOP, null)
```

#### injectedScript setter (from React side):
```kotlin
var injectedScript: String = ""
    set(value) {
        field = value
        if (value.isNotEmpty()) {
            currentWebView?.let { WebViewCompat.addDocumentStartJavaScript(it, value, setOf("*")) }
        }
    }
```

## 3. Why the 5-Layer Defense Isn't Working

Despite all layers, `NAV:devtool-hijack` entries still appear every ~500ms. This means:

1. **Layer 1 (no-op define) isn't preventing the script from running.** The script's detectors ARE being installed, which means `window.disableDevtool()` IS being called successfully.

2. **The network stub (Layer 2) IS being served** — we see `REQ:devtool-stub` in logs... actually, we DON'T see it. The stub block is NOT being triggered. This means the `disable-devtool` script is loaded INLINE in the provider's HTML, not as a separate `<script src>` tag. Our `shouldInterceptRequest` block never fires for it.

3. **Layer 3 (redirect interception) IS working** — the `NAV:devtool-hijack` entries confirm the redirect is being blocked at the Kotlin level. But the script keeps retrying.

4. **Layer 4 (timing warmup) may not be sufficient** — the cold-start timing on a fresh WebView might still trigger the detectors despite our warmup.

## 4. Questions for Expert

1. **Why isn't Layer 1 working?** We freeze `window.disableDevtool` via `Object.defineProperty` with `writable:false, configurable:false` BEFORE the script runs (via `addDocumentStartJavaScript`). But the script's detectors still fire. Is the script defining `disableDevtool` via a mechanism that bypasses our freeze? Could it be using `eval()` or `new Function()` internally?

2. **The script is loaded INLINE** — our network stub never fires. The provider embeds the script directly in its HTML. This means Layer 2 is useless for this provider. Is there a different approach for inline scripts?

3. **Why did this work with WebView pool but not with Destroy & Recreate?** With the pool, the script loaded once and the detectors didn't fire on subsequent loads. With Destroy & Recreate, a fresh WebView is created each time. Is the issue that the fresh V8 isolate causes the timing detectors to flip?

4. **Should we try a different approach entirely?** For example:
   - Intercept the provider's HTML response and strip the inline `disable-devtool` script before it reaches the WebView
   - Use a WebView `WebSettings` flag to disable certain debugging APIs
   - Use `android:debuggable="false"` in the manifest to prevent DevTools detection

5. **Can you analyze the actual `disable-devtool.min.js` script?** It's at `https://theajack.github.io/disable-devtool/disable-devtool.min.js`. If you can identify exactly what it detects and how it initializes, we can针对性 neutralize it.

## 5. Logs

The provider (peachify) loads successfully. Video CDN requests are made and allowed. But the player doesn't render video. The `NAV:devtool-hijack` entries appear every ~500ms, confirming the script's detectors are running and trying to redirect.

```
07-18 18:50:06.417 | ALLOW | R3:prov-exact | peachify.top | document | https://peachify.top/embed/tv/94997/1/1
07-18 18:50:07.280 | ALLOW | R3:prov-exact | peachify.top | style | https://peachify.top/_next/static/chunks/d0ad422c3939f556.css
07-18 18:50:07.281 | ALLOW | R3:prov-exact | peachify.top | script | https://peachify.top/_next/static/chunks/53d02eea1ad60916.js
07-18 18:50:09.131 | ALLOW | R2:cdn-allowlist | usa.eat-peach.sbs | empty | https://usa.eat-peach.sbs/holly/tv/94997/1/1
07-18 18:50:10.392 | BLOCK | NAV:devtool-hijack | theajack.github.io | navigation | https://theajack.github.io/disable-devtool/404.html?h=peachify.top
07-18 18:50:10.862 | BLOCK | NAV:devtool-hijack | theajack.github.io | navigation | https://theajack.github.io/disable-devtool/404.html?h=peachify.top
07-18 18:50:11.391 | BLOCK | NAV:devtool-hijack | theajack.github.io | navigation | https://theajack.github.io/disable-devtool/404.html?h=peachify.top
[... repeats every ~500ms indefinitely ...]
```

## 6. Request

Please:
1. Analyze the actual `disable-devtool.min.js` script to understand exactly how it initializes and what it detects
2. Explain why our Layer 1 (`Object.defineProperty` freeze) isn't preventing the script from running
3. Provide working code that neutralizes the script in our Destroy & Recreate WebView architecture
4. Consider that the script is loaded INLINE (not via `<script src>`), so network-level interception doesn't help
