package expo.modules.playerwebview

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.*
import android.widget.FrameLayout
import androidx.webkit.WebViewCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import expo.modules.kotlin.AppContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.LinkedHashMap
import java.util.zip.GZIPInputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Window-Overlay WebView for the player module.
 *
 * Instead of fighting Fabric's RenderNode compositing (which blocks the WebView's
 * internal Chromium hardware surface), this view acts as an invisible anchor inside
 * the React Native hierarchy while the actual WebView is attached directly to the
 * Activity's root window (android.R.id.content).
 *
 * By bypassing Fabric entirely, the WebView composites through the standard Android
 * Window/View pipeline — the same path every other WebView in the OS uses.
 */
class PlayerWebViewOverlayView(
  context: Context,
  private val appContext: AppContext
) : FrameLayout(context) {

  companion object {
    // ── Dynamic WebView Pool ──
    // On low-end devices (<4GB RAM / isLowRamDevice), only keep 1 reserved
    // WebView to avoid OOM kills (each Chromium renderer uses ~40-80MB RSS).
    // On modern devices, keep 2 for snappier provider switches.
    private val maxPoolSize: Int by lazy {
      // Use the Dalvik heap limit as a proxy for device class.
      // Devices with <=128MB heap (typically <=3GB RAM) get pool size 1
      // to avoid OOM kills from multiple Chromium renderer processes.
      val maxHeapMb = Runtime.getRuntime().maxMemory() / (1024L * 1024L)
      if (maxHeapMb <= 128) 1 else 2
    }
    private val webViewPool: MutableList<WebView> = mutableListOf()

    // ── Per-Provider Essential Resource Profiles ──
    // Instead of a general-purpose blocklist (which grows perpetually), each
    // provider has an allowlist of domains it actually needs for video playback.
    // Everything else is blocked silently. This eliminates 100% of ad/tracker
    // bandwidth waste and prevents hijack loops without relying on window.stop().
    //
    // Keys: provider hostname (as it appears in currentUrl)
    // Values: hostname suffixes to allow — a request host passes if it contains
    //         any entry (e.g. "workers.dev" matches "xbm.elga15c1ba.workers.dev")
    //
    // Keep in sync with allowedCdnHosts below — profiles here take precedence
    // in the heuristic rule and make the general blocklist mostly redundant.
    private val providerProfiles: Map<String, Set<String>> = mapOf(
      "web.nxsha.app" to setOf("web.nxsha.app", "workers.dev", "cloudfront.net"),
      "peachify.top" to setOf("peachify.top", "eat-peach.sbs", "workers.dev",
                              "theintrodb.org", "flagcdn.com", "fonts.googleapis.com",
                              "gstatic.com", "cloudfront.net"),
      "screenscape.me" to setOf("screenscape.me", "googletagmanager.com",
                                "fonts.googleapis.com", "gstatic.com"),
      "www.chillflix.lol" to setOf("www.chillflix.lol", "vidapi.cloud", "cloudfront.net"),
      "chillflix.lol" to setOf("chillflix.lol", "vidapi.cloud", "cloudfront.net"),
      "vidnest.fun" to setOf("vidnest.fun", "workers.dev", "vidnees",
                             "wyzie.io", "vdrk.site", "cloudfront.net",
                             "themoviedb.org", "image.tmdb.org"),
      "nhdapi.com" to setOf("nhdapi.com", "cloudfront.net"),
      // New providers without profiles yet fall back to heuristic + blocklist
    )

    // ── DNS Cache Warming ──
    // Android's OS-level DNS resolver (netd) caches results for ~60 seconds.
    // Calling InetAddress.getAllByName() on a background thread populates the
    // OS cache so that when the WebView's network stack asks for the same
    // domain moments later, it resolves in <1ms instead of 100-300ms.
    private val dnsCacheWarmed = AtomicBoolean(false)
    private val dnsCacheDomains = listOf(
      "web.nxsha.app", "peachify.top", "screenscape.me",
      "www.chillflix.lol", "chillflix.lol", "vidnest.fun",
      "xbm.elga15c1ba.workers.dev", "mp4.cahra15e3b4.workers.dev",
      "api.theintrodb.org", "eat-peach.sbs", "vidapi.cloud",
      "api.themoviedb.org", "image.tmdb.org",
      "sub.wyzie.io", "sub.vdrk.site",
      "nhdapi.com",
    )

    /** Warm the platform DNS cache on a background thread. Called once. */
    fun warmDnsCache() {
      if (!dnsCacheWarmed.compareAndSet(false, true)) return
      Thread({ _warmDns() }, "dns-warm").apply { isDaemon = true; start() }
    }

    private fun _warmDns() {
      for (domain in dnsCacheDomains) {
        try { InetAddress.getAllByName(domain) } catch (_: Exception) {}
      }
      android.util.Log.d("PlayerWebView",
        "DNS cache warmed: ${dnsCacheDomains.size} domains")
    }

    // ── Child Frame Bridge HTML Injection ──
    // addDocumentStartJavaScript silently fails to inject into cross-origin
    // child iframes on some devices (MediaTek Helio G35 / Android 14).
    // As a fallback, we inject the bridge script directly into the HTML
    // response of child iframes via shouldInterceptRequest.

    private val BRIDGE_SCRIPT_SNIPPET: String = """
<script>
(function(){
if(window.__childBridgeInit)return;window.__childBridgeInit=true;
var _fi=setInterval(function(){
var _v=document.querySelector('video');
if(!_v)return;clearInterval(_fi);var _ls=0;
_v.addEventListener('timeupdate',function(){
if(_v.duration<=0||_v.currentTime<=5)return;
var _n=Date.now();if(_n-_ls<5000)return;_ls=_n;
try{window.top.postMessage({type:'__player:child_anchor',readyState:'injected_ct',href:location.href,host:location.hostname,ts:Date.now()},'*')}catch(e){}
try{window.top.postMessage({type:'__player:progress',currentTime:_v.currentTime,duration:_v.duration,percent:_v.currentTime/_v.duration},'*')}catch(e){}
});
window.addEventListener('message',function(e){
if(!e.data||e.data.type!=='__player:seek')return;
var _si=setInterval(function(){
if(_v.readyState>=1){try{_v.currentTime=e.data.time;if(e.data.play)_v.play().catch(function(){})}catch(ex){}clearInterval(_si)}
},200);
});
},500);
})();
</script>
""".trimIndent()

    // Cache of (url) -> injected HTML bytes to avoid re-fetching on repeat navigations
    private val htmlCache = object : LinkedHashMap<String, ByteArray>(32, 0.75f, true) {
      override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>): Boolean {
        return size > 20
      }
    }
  }

  // ReactContext for Fabric event dispatch — the FrameLayout's context is
  // ThemedReactContext (correct for Fabric), unlike the WebView which uses
  // Activity context for window-coordinate rendering.
  private val reactContext: ReactContext? =
    (context as? ReactContext) ?: (appContext.reactContext as? ReactContext)

  // The real WebView — lives in the Activity window, not in Fabric's tree
  private var webView: WebView? = null
  private var pageStartedFired = false
  private var pendingLoadUrl: String? = null
  private var currentUrl: String? = null
  private var isLoading = false
  private var lastFinishedUrl: String = ""
  private var isOverlayAttached = false

  // ── Position cache (avoids JNI calls every frame) ──
  // getLocationOnScreen() is a JNI call through the View hierarchy.
  // On 60fps preDraw, calling it every frame wastes CPU on low-end
  // devices. Cache the last-known anchor position and skip the call
  // entirely when the anchor hasn't actually moved.
  private var lastAnchorX = -1
  private var lastAnchorY = -1
  private var lastAnchorW = -1
  private var lastAnchorH = -1

  // ── Fullscreen state ──
  private var customView: View? = null
  private var customViewCallback: android.webkit.WebChromeClient.CustomViewCallback? = null

  // ── Fallback for provider pages that never finish loading ──
  // Some streaming providers (e.g., peachify, screenscape, vidking, chillflix)
  // use document.open() without document.close() to keep the document in
  // "loading" state indefinitely. This prevents WebViewClient.onPageFinished
  // from ever firing. We use a watchdog timer to synthesize onPageFinished
  // if the page doesn't complete within a generous timeout.
  private var pageFinishedFallbackPosted = false
  private val pageFinishedFallbackHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val pageFinishedFallbackRunnable = object : Runnable {
    override fun run() {
      val wv = webView
      val url = currentUrl
      if (isLoading && url != null) {
        android.util.Log.w("PlayerWebView",
          "PAGE_FINISHED_FALLBACK: onPageFinished never fired for $url -- forcing dispatch")
        dispatchPageFinished(url)
      }
      pageFinishedFallbackPosted = false
    }
  }

  var injectedScript: String = ""
    set(value) {
      field = value
      if (value.isNotEmpty()) {
        webView?.let { WebViewCompat.addDocumentStartJavaScript(it, value, setOf("*")) }
      }
    }

  var injectedJavaScriptAfterLoad: String = ""
  var referrer: String = ""

  var supportMultipleWindows: Boolean = false
    set(value) {
      field = value
      webView?.settings?.setSupportMultipleWindows(value)
    }

  var javaScriptCanOpenWindowsAutomatically: Boolean = false
    set(value) {
      field = value
      webView?.settings?.javaScriptCanOpenWindowsAutomatically = value
    }

  var userAgent: String? = null
    set(value) {
      field = value
      if (value != null) {
        webView?.settings?.userAgentString = value
      }
    }

  // ── Lifecycle ─────────────────────────────────────────────────────

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    syncWebViewFrame()
    true
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    isOverlayAttached = true
    val anchorId = System.identityHashCode(this)
    android.util.Log.d("PlayerWebView",
      "OVERLAY ATTACHED anchor=$anchorId size=${width}x${height}")

    ensureWebView()
    syncWebViewFrame()
    viewTreeObserver.addOnPreDrawListener(preDrawListener)

    // Resume timers for all WebViews. pauseTimers() is a global operation
    // that pauses JS timers for ALL WebViews. Without this call, any
    // previous onDetachedFromWindow's pauseTimers() would leave timers
    // suspended across the entire process.
    webView?.resumeTimers()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    isOverlayAttached = false
    val anchorId = System.identityHashCode(this)
    android.util.Log.d("PlayerWebView", "OVERLAY DETACHED anchor=$anchorId")
    viewTreeObserver.removeOnPreDrawListener(preDrawListener)
    cancelPageFinishedFallback()

    // Clean up any lingering fullscreen custom view
    customView?.let { cv ->
      val parent = cv.parent as? ViewGroup
      parent?.removeView(cv)
      customViewCallback?.onCustomViewHidden()
      customView = null
      customViewCallback = null
    }

    // WebView pool: park the WebView instead of destroying it.
    // The pool saves ~500-800ms of UI thread freeze on every provider
    // switch by reusing the Chromium renderer process initialization.
    webView?.let { wv ->
      // CRITICAL ORDER: onPause() MUST come before loadUrl("about:blank").
      // onPause() immediately pauses video playback by suspending the
      // WebView's internal renderer. If we call loadUrl first, the video
      // continues playing asynchronously while about:blank navigates.
      wv.onPause()
      wv.pauseTimers()
      // loadUrl("about:blank") cancels all JS timers and safely tears
      // down the DOM without destroying the native C++ peer. This is
      // preferred over destroy() + recreate because the Chromium
      // renderer process stays alive.
      wv.loadUrl("about:blank")
      wv.visibility = View.GONE
      val parent = wv.parent as? ViewGroup
      parent?.removeView(wv)
      // Clear client references to prevent memory leaks. Use reflection
      // to bypass compileSdk 36's non-null declaration.
      try { wv.javaClass.getMethod("setWebViewClient", android.webkit.WebViewClient::class.java).invoke(wv, null) } catch (_: Exception) {}
      try { wv.javaClass.getMethod("setWebChromeClient", android.webkit.WebChromeClient::class.java).invoke(wv, null) } catch (_: Exception) {}
      // Park into the pool, or destroy if pool is full
      synchronized(webViewPool) {
        if (webViewPool.size < maxPoolSize) {
          webViewPool.add(wv)
          android.util.Log.d("PlayerWebView",
            "OVERLAY POOLED WebView anchor=$anchorId poolSize=${webViewPool.size}")
        } else {
          wv.destroy()
          android.util.Log.d("PlayerWebView",
            "OVERLAY DESTROYED (pool full) anchor=$anchorId")
        }
      }
    }
    webView = null
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    webView?.visibility = visibility
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    syncWebViewFrame()
  }

  // ── Window Overlay ────────────────────────────────────────────────

  /**
   * Apply standard WebView settings. Shared between new WebViews and
   * recycled pool WebViews.
   */
  private fun applyWebViewSettings(wv: WebView) {
    // Log WebView version for cross-device diagnostics
    android.util.Log.d("PlayerWebView",
      "WebView: userAgent=${wv.settings.userAgentString.take(80)}... " +
      "version=${WebViewCompat.getCurrentWebViewPackage(wv.context)?.versionName ?: "unknown"} " +
      "pkg=${WebViewCompat.getCurrentWebViewPackage(wv.context)?.packageName ?: "unknown"} " +
      "api=${Build.VERSION.SDK_INT}")

    wv.isFocusable = true
    wv.isFocusableInTouchMode = true
    wv.layoutParams = ViewGroup.LayoutParams(width.coerceAtLeast(1), height.coerceAtLeast(1))

    // CRITICAL: Chromium stops compositing when background is transparent.
    // The WebView is outside Fabric's tree now, so Fabric won't call
    // setBackgroundColor(0) on it — but set it explicitly to be safe.
    // Using BLACK instead of WHITE to avoid a white flash during the
    // slide_from_bottom navigation transition on low-end devices.
    wv.setBackgroundColor(Color.BLACK)

    wv.settings.javaScriptEnabled = true
    wv.settings.domStorageEnabled = true
    wv.settings.databaseEnabled = true
    wv.settings.allowFileAccess = false
    wv.settings.allowContentAccess = false
    // Use LOAD_NO_CACHE to prevent disk cache bloat on cheap eMMC storage.
    // Streaming pages change frequently, so caching offers little benefit
    // while causing IO freezes on low-end devices.
    wv.settings.cacheMode = WebSettings.LOAD_NO_CACHE
    wv.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    wv.settings.mediaPlaybackRequiresUserGesture = false
    // Note: Android WebView doesn't expose setSpeculativeFetchesEnabled()
    // in the public API. Chromium's DNS prefetching is managed internally.
    // We compensate via DNS cache warming (see warmDnsCache()) and the
    // per-provider profile blocking in shouldInterceptRequest.
    wv.settings.useWideViewPort = true
    wv.settings.loadWithOverviewMode = true
    CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)

    // Override User-Agent to match Chrome exactly (remove "; wv" and "Build/" markers).
    val ua = wv.settings.userAgentString
    wv.settings.userAgentString = ua
      .replace("; wv", "")
      .replace("Version/4.0 ", "")
      .replace(Regex(""" Build/[^);]+"""), "")

    // Prevent WebView renderer process from being killed under memory pressure
    // on low-end devices (e.g. Helio G35 with 3GB RAM). Without this, backgrounding
    // the app for 2 minutes can cause the renderer to be reclaimed, resulting in a
    // blank white WebView that needs a full reload.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      wv.setRendererPriorityPolicy(
        android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT,
        true  // WaiveWhileVisible: don't kill renderer while WebView is visible
      )
    }
  }

  /**
   * Create a WebViewClient for a WebView. Exported as a method so pooled
   * WebViews can be assigned a fresh client bound to THIS anchor instance.
   */
  private fun makeWebViewClient(wv: WebView): WebViewClient {
    return object : WebViewClient() {
      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        android.util.Log.d("PlayerWebView",
          "OVERLAY onPageStarted url=${url?.take(80)}" +
          " contentHeight=${view?.contentHeight}")
        // Track the latest URL for the fallback timer. Redirects are handled
        // internally by WebView (shouldOverrideUrlLoading returns false), so
        // onPageStarted receives the redirect URL without a corresponding
        // loadUrl() call.
        currentUrl = url
        pageStartedFired = true
        isLoading = true
        dispatchEvent("onLoadingStart") { putString("url", url ?: "") }

        // Schedule a fallback timer: if onPageFinished doesn't fire within
        // 12 seconds, synthesize it. This handles provider pages that use
        // document.open() without document.close() to keep the document
        // in loading state indefinitely.
        cancelPageFinishedFallback()
        pageFinishedFallbackPosted = true
        pageFinishedFallbackHandler.postDelayed(pageFinishedFallbackRunnable, 12000L)
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        cancelPageFinishedFallback()
        val finalUrl = url ?: ""
        android.util.Log.d("PlayerWebView",
          "OVERLAY onPageFinished url=${finalUrl.take(80)}" +
          " size=(${width}x${height}) contentHeight=${wv.contentHeight}")
        dispatchPageFinished(finalUrl)
      }

      override fun onReceivedHttpError(
        view: WebView?,
        request: WebResourceRequest?,
        errorResponse: WebResourceResponse?
      ) {
        if (errorResponse?.statusCode ?: 0 >= 400) {
          dispatchEvent("onHttpError") {
            putInt("statusCode", errorResponse?.statusCode ?: 0)
            putString("description", errorResponse?.reasonPhrase ?: "")
          }
        }
      }

      override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest?
      ): Boolean {
        val url = request?.url?.toString() ?: return false
        trackRequestIfAuditing(url, request)
        if (url.startsWith("intent:")) return true

        // User-gesture heuristic: block unsolicited top-level navigations.
        // If this navigation was NOT triggered by a user-initiated loadUrl(),
        // and the target is a new domain, it's likely an ad hijack (Type A/B).
        val headers = request.requestHeaders ?: emptyMap()
        val secFetchDest = headers["Sec-Fetch-Dest"]
        val isUserGesture = request.isForMainFrame &&
          (secFetchDest == null || secFetchDest == "document")

        if (request.isForMainFrame && !userInitiatedNavigation) {
          // If the navigation target is NOT the current provider host, block it
          val targetHost = Uri.parse(url).host?.lowercase()
          val currentHost = currentUrl?.let { Uri.parse(it) }?.host?.lowercase()
          if (targetHost != null && currentHost != null &&
              targetHost != currentHost &&
              !allowedCdnHosts.any { targetHost.contains(it) }
          ) {
            android.util.Log.w("PlayerWebView",
              "[AB] HIJACK BLOCK (unsolicited nav): ${url.take(120)}")
            // IMPORTANT: Do NOT call window.stop() here. Returning true is
            // sufficient to block the navigation. window.stop() would also
            // cancel all in-flight video CDN requests (HLS manifests, chunks),
            // forcing the video player into retry loop and causing the
            // 20-30 second delay on providers like nxsha.
            userInitiatedNavigation = false
            return true
          }
        }
        // Consume the user-gesture flag after the first navigation
        if (request.isForMainFrame) userInitiatedNavigation = false

        // Domain-based nav blocking (catch known ad domains for Type A hijacks)
        if (isAdOrTracker(url)) {
          android.util.Log.w("PlayerWebView",
            "[AB] NAV BLOCK: ${url.take(120)}")
          return true
        }
        return false
      }

      override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
      ): WebResourceResponse? {
        val url = request?.url?.toString() ?: return null
        val host = Uri.parse(url).host?.lowercase() ?: return null

        // Enhanced audit tracking with request metadata
        trackRequestIfAuditing(url, request)

        val headers = request.requestHeaders ?: emptyMap()
        val currentHost = currentUrl?.let { Uri.parse(it) }?.host?.lowercase() ?: ""

        // ── Child Frame Bridge Injection ──
        // Intercept HTML document loads in cross-origin child iframes
        // and inject the postMessage bridge script. This is necessary
        // because addDocumentStartJavaScript silently fails to inject
        // into cross-origin child iframes on some devices.
        val secFetchDest = headers["Sec-Fetch-Dest"]?.lowercase()
        val isCrossOrigin = currentHost.isNotEmpty() && host != currentHost
        if (isCrossOrigin && !isAdOrTracker(host) &&
          (secFetchDest == "iframe" ||
           (secFetchDest == null && !request.isForMainFrame && (headers["Accept"] ?: "").contains("text/html")))) {
          val injected = injectBridgeIntoHtml(url)
          if (injected != null) {
            android.util.Log.d("PlayerWebView",
              "[INJECT] Child frame bridge injected: ${url.take(100)}")
            return injected
          }
        }

        // ═══════════════════════════════════════════════════════════
        // HEURISTIC-BASED AD BLOCKING
        // ═══════════════════════════════════════════════════════════
        // Instead of relying solely on domain blocklists (which ad
        // networks rotate daily), we analyze HTTP request headers to
        // determine the PURPOSE of each request. This approach is
        // immune to rotating ad domains — we block based on what the
        // browser is trying to do, not where it's trying to go.
        //
        // Order of operations (first match wins):
        //   1. Video/audio content or range requests → ALLOW (CDN)
        //   2. CDN allowlist                      → ALLOW
        //   3. Current provider host               → ALLOW
        //   4. iframe/script from unknown third-party → HEURISTIC BLOCK
        //   5. Per-provider profile (if available) → PROFILE BLOCK
        //   6. Domain blocklist                    → DOMAIN BLOCK
        //   7. Path-based blocking                 → PATH BLOCK
        //   8. Default                            → ALLOW
        // ═══════════════════════════════════════════════════════════

        val hasRangeHeader = headers.containsKey("Range")

        // Rule 1: Always allow video/audio content and range requests
        // (HLS/DASH video chunk requests). These are always legitimate
        // video streaming traffic regardless of origin.
        if (hasRangeHeader || secFetchDest in setOf("video", "audio")) {
          return null // ALLOW
        }

        // Rule 2: Never block known CDN domains
        if (allowedCdnHosts.any { host.contains(it) }) return null

        // Rule 3: Allow current provider domain and subdomains
        if (currentHost.isNotEmpty() && host.endsWith(".$currentHost")) return null
        if (currentHost.isNotEmpty() && host == currentHost) return null

        // Rule 4: Heuristic blocking for iframe/script/image requests
        // to unknown third-party domains. Streaming providers rarely
        // load third-party scripts — if it's not the provider's own
        // domain, it's almost certainly an ad or tracker.
        if (secFetchDest in setOf("iframe", "script", "image")) {
          // Check if the referer matches the current provider
          val referer = headers["Referer"]?.lowercase()
          val isRefererMatching = referer?.contains(currentHost) == true
          val isProviderReferer = currentHost.isEmpty() || isRefererMatching

          if (isProviderReferer && host != currentHost && !host.contains("google")) {
            // Google Fonts / APIs are fine — allow those
            if (host.contains("google") || host.contains("gstatic")) return null
            android.util.Log.w("PlayerWebView",
              "[AB] HEURISTIC BLOCK ($secFetchDest): ${url.take(120)}")
            return WebResourceResponse("text/plain", "utf-8",
              ByteArrayInputStream(ByteArray(0)))
          }
        }

        // Rule 5: Per-provider profile blocking (Essential Resource Map).
        // If the current provider has a profile, use it as a strict allowlist
        // for script/iframe/image requests — block EVERYTHING not in the profile.
        // This is stricter and more efficient than the general heuristic because
        // it doesn't depend on referer matching. Providers without a profile
        // fall through to the general rules below.
        if (currentHost.isNotEmpty()) {
          val profile = providerProfiles.entries.firstOrNull { (key, _) ->
            currentHost.contains(key) || key.contains(currentHost)
          }
          if (profile != null) {
            val allowedHosts = profile.value
            // Apply profile blocking to resource types that ads typically use.
            // Fonts/styles are excluded (Google Fonts/gstatic are always safe).
            if (secFetchDest in setOf("script", "iframe", "image")) {
              // Always allow Google domains (fonts, APIs, gstatic)
              if (!host.contains("google") && !host.contains("gstatic")) {
                val isAllowed = allowedHosts.any { host.contains(it) }
                if (!isAllowed) {
                  android.util.Log.w("PlayerWebView",
                    "[AB] PROFILE BLOCK ($secFetchDest): ${url.take(120)}")
                  return WebResourceResponse("text/plain", "utf-8",
                    ByteArrayInputStream(ByteArray(0)))
                }
              }
            }
            // For document/main-frame requests, block cross-origin navigation
            // to domains NOT in the profile (catches hijack without window.stop())
            if (secFetchDest == "document" && host != currentHost) {
              val isAllowed = allowedHosts.any { host.contains(it) }
              if (!isAllowed) {
                android.util.Log.w("PlayerWebView",
                  "[AB] PROFILE BLOCK (doc nav): ${url.take(120)}")
                return WebResourceResponse("text/plain", "utf-8",
                  ByteArrayInputStream(ByteArray(0)))
              }
            }
          }
        }

        // Rule 6 (fallback): Domain-based blocking (catch known ad networks)
        if (adDomains.any { host.contains(it) }) {
          android.util.Log.w("PlayerWebView",
            "[AB] DOMAIN BLOCK: ${url.take(120)}")
          return WebResourceResponse("text/plain", "utf-8",
            ByteArrayInputStream(ByteArray(0)))
        }

        // Rule 7 (fallback): Path-based blocking (same-origin ads)
        if (currentHost.isNotEmpty() && host == currentHost) {
          val path = Uri.parse(url).path ?: ""
          if (adPathPatterns.any { path.contains(it) }) {
            android.util.Log.w("PlayerWebView",
              "[AB] PATH BLOCK: ${url.take(120)}")
            return WebResourceResponse("text/plain", "utf-8",
              ByteArrayInputStream(ByteArray(0)))
          }
        }

        return null // ALLOW
      }

      override fun onRenderProcessGone(
        view: WebView?,
        detail: RenderProcessGoneDetail?
      ): Boolean {
        dispatchEvent("onRenderProcessGone") {
          putBoolean("didCrash", detail?.didCrash() ?: false)
        }
        return true
      }
    }
  }

  private fun makeWebChromeClient(wv: WebView): WebChromeClient {
    return object : WebChromeClient() {
      override fun onJsAlert(
        view: WebView?, url: String?, message: String?,
        result: JsResult?
      ): Boolean {
        android.util.Log.d("PlayerWebView", "onJsAlert: $message")
        result?.confirm()
        return true
      }
      override fun onJsConfirm(
        view: WebView?, url: String?, message: String?,
        result: JsResult?
      ): Boolean {
        android.util.Log.d("PlayerWebView", "onJsConfirm: $message")
        result?.confirm()
        return true
      }
      override fun onJsPrompt(
        view: WebView?, url: String?, message: String?,
        defaultValue: String?, result: JsPromptResult?
      ): Boolean {
        android.util.Log.d("PlayerWebView", "onJsPrompt: $message")
        result?.confirm()
        return true
      }
      override fun onGeolocationPermissionsShowPrompt(
        origin: String?,
        callback: GeolocationPermissions.Callback?
      ) {
        callback?.invoke(origin, true, false)
      }
      override fun onPermissionRequest(request: PermissionRequest?) {
        request?.grant(request.resources)
      }
      override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: android.os.Message?
      ): Boolean {
        android.util.Log.d("PlayerWebView",
          "onCreateWindow BLOCKED isDialog=$isDialog isUserGesture=$isUserGesture")
        // Reject all popup windows. Returning false silently blocks the
        // new window at the native level, catching any popups that bypass
        // the JS-level window.open override (e.g., Service Worker redirects,
        // window.open captured before our injection runs).
        return false
      }
      override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
        android.util.Log.d("PlayerWebView", "onShowCustomView: view=$view")
        if (customView != null) {
          callback?.onCustomViewHidden()
          return
        }
        customView = view
        customViewCallback = callback

        // Send fullscreen entering event to RN
        wv.evaluateJavascript(
          "window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen',entering:true}));",
          null
        )

        // Add the fullscreen video view to the Activity's root window
        // so it renders on top of everything. MATCH_PARENT covers the
        // entire screen.
        val act = appContext.currentActivity ?: return
        val root = act.findViewById<ViewGroup>(android.R.id.content)
        if (view != null) {
          root.addView(view, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT))
        }
        // Hide the overlay WebView while fullscreen is active to prevent
        // rendering conflicts between the WebView and the custom view.
        wv.visibility = View.GONE
      }

      override fun onHideCustomView() {
        android.util.Log.d("PlayerWebView", "onHideCustomView")
        val cv = customView ?: return
        val cb = customViewCallback

        // Send fullscreen exiting event to RN
        wv.evaluateJavascript(
          "window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen',entering:false}));",
          null
        )

        // Remove the custom view from the window
        val parent = cv.parent as? ViewGroup
        parent?.removeView(cv)
        cb?.onCustomViewHidden()

        // Restore the WebView visibility
        wv.visibility = View.VISIBLE

        customView = null
        customViewCallback = null
      }
    }
  }

  private fun ensureWebView() {
    if (webView != null) return
    // Warm the OS DNS cache on first call (fires once, daemon thread)
    warmDnsCache()
    val act = appContext.currentActivity ?: run {
      android.util.Log.e("PlayerWebView", "OVERLAY: No activity — cannot create WebView")
      return
    }
    WebView.setWebContentsDebuggingEnabled(true)
    val anchorId = System.identityHashCode(this)

    // Try the pool first — avoids ~500ms Chromium renderer process init
    val wv: WebView
    synchronized(webViewPool) {
      wv = if (webViewPool.isNotEmpty()) {
        webViewPool.removeAt(0).also {
          android.util.Log.d("PlayerWebView",
            "OVERLAY Pool REUSE anchor=$anchorId poolRemaining=${webViewPool.size}")
        }
      } else {
        WebView(act).also {
          android.util.Log.d("PlayerWebView",
            "OVERLAY CREATED new WebView anchor=$anchorId")
        }
      }
    }

    // If pooled, resume the WebView from paused state (onPause was called
    // before parking). Without onResume(), video playback remains suspended.
    wv.onResume()

    // Apply/re-apply standard settings, client, and chrome client
    applyWebViewSettings(wv)
    wv.webViewClient = makeWebViewClient(wv)
    wv.webChromeClient = makeWebChromeClient(wv)
    wv.addJavascriptInterface(JsBridgeInterface(), "ReactNativeWebView")

    // Apply deferred props
    webView = wv
    userAgent?.let { wv.settings.userAgentString = it }
    if (supportMultipleWindows) wv.settings.setSupportMultipleWindows(true)
    if (javaScriptCanOpenWindowsAutomatically) wv.settings.javaScriptCanOpenWindowsAutomatically = true
    if (injectedScript.isNotEmpty()) {
      android.util.Log.d("PlayerWebView",
        "OVERLAY INJECTING SCRIPT length=${injectedScript.length} start=${injectedScript.take(120).replace('\n', ' ')}")
      WebViewCompat.addDocumentStartJavaScript(wv, injectedScript, emptySet())
    } else {
      android.util.Log.w("PlayerWebView", "OVERLAY INJECTING SCRIPT SKIPPED — script is empty")
    }

    android.util.Log.d("PlayerWebView",
      "OVERLAY Applied deferred props: userAgent=${userAgent?.take(40)}..." +
      " supportMultWin=$supportMultipleWindows jsCanOpen=$javaScriptCanOpenWindowsAutomatically" +
      " scriptLen=${injectedScript.length}")

    // Add to Activity root content — bypasses Fabric entirely
    val rootContent = act.findViewById<ViewGroup>(android.R.id.content)
    rootContent.addView(wv)

    // Flush any pending URL
    pendingLoadUrl?.let { url ->
      android.util.Log.d("PlayerWebView",
        "OVERLAY Flushing pendingLoadUrl=$url anchor=$anchorId" +
        " UA=${wv.settings.userAgentString.take(60)}")
      pendingLoadUrl = null
      wv.loadUrl(url)
    }
  }

  /** Sync the WebView's window position to match this anchor view's screen position.
   *
   *  This is called on EVERY frame via OnPreDrawListener (60fps). To avoid
   *  expensive JNI traversal on low-end devices, we cache the anchor's last
   *  position and skip the call entirely when nothing has changed.
   */
  private fun syncWebViewFrame() {
    val wv = webView ?: return
    val act = appContext.currentActivity ?: return
    if (!isShown) {
      wv.visibility = View.GONE
      return
    }

    // Quick check: if the anchor view's dimensions haven't changed since
    // the last frame, skip getLocationOnScreen entirely.
    if (width == lastAnchorW && height == lastAnchorH) {
      // Dimensions are the same — position likely unchanged too.
      // Sanity-check via a cheap bounds comparison against the cached
      // (lastAnchorX, lastAnchorY) to handle edge cases like window insets.
      val loc = IntArray(2)
      getLocationOnScreen(loc)
      if (loc[0] == lastAnchorX && loc[1] == lastAnchorY) {
        // Everything stable — no work needed.
        wv.visibility = View.VISIBLE
        return
      }
      // Position changed despite stable size — update cache and continue.
      lastAnchorX = loc[0]
      lastAnchorY = loc[1]
    } else {
      // Size changed — full update.
      lastAnchorW = width
      lastAnchorH = height
      val loc = IntArray(2)
      getLocationOnScreen(loc)
      lastAnchorX = loc[0]
      lastAnchorY = loc[1]
    }

    val newX = lastAnchorX.toFloat()
    val newY = lastAnchorY.toFloat()

    if (wv.x != newX || wv.y != newY || wv.width != lastAnchorW || wv.height != lastAnchorH) {
      wv.x = newX
      wv.y = newY
      val lp = wv.layoutParams
      if (lp != null) {
        lp.width = lastAnchorW.coerceAtLeast(1)
        lp.height = lastAnchorH.coerceAtLeast(1)
        wv.layoutParams = lp
      }
      wv.requestLayout()
    }
    wv.visibility = View.VISIBLE
  }

  // ── Navigation ────────────────────────────────────────────────────

  fun loadUrl(url: String) {
    val wv = webView
    if (wv == null) {
      pendingLoadUrl = url
      return
    }
    if (url == currentUrl && isLoading) {
      android.util.Log.d("PlayerWebView", "OVERLAY loadUrl SKIPPED (already loading)")
      return
    }
    currentUrl = url
    isLoading = true
    userInitiatedNavigation = true // All RN-triggered loads are user-initiated
    android.util.Log.d("PlayerWebView", "OVERLAY loadUrl url=${url.take(80)}")
    if (referrer.isNotEmpty()) {
      wv.loadUrl(url, mapOf("Referer" to referrer))
    } else {
      wv.loadUrl(url)
    }
  }

  fun reload() {
    webView?.post { webView?.reload() }
  }

  fun stop() {
    webView?.post { webView?.stopLoading() }
  }

  // ── Props ─────────────────────────────────────────────────────────

  var sourceUri: String = ""
    set(value) {
      if (value == field || value.isEmpty()) return
      field = value
      android.util.Log.d("PlayerWebView",
        "OVERLAY sourceUri SET anchor=${System.identityHashCode(this)} url=${value.take(60)}")
      if (webView != null && isOverlayAttached) {
        loadUrl(value)
      } else {
        pendingLoadUrl = value
      }
    }

  var injectedJavaScript_: String = ""
    set(value) {
      field = value
      if (value.isNotEmpty() && value != lastInjectedJS) {
        lastInjectedJS = value
        webView?.evaluateJavascript(value, null)
      }
    }
  private var lastInjectedJS: String = ""

  private var lastForceLoadUrl: String = ""
  var forceLoadUrl: String = ""
    set(value) {
      field = value
      if (value.isNotEmpty() && value != lastForceLoadUrl) {
        lastForceLoadUrl = value
        loadUrl(value)
      }
    }

  // ── User-Gesture Tracking ──
  // Tracks whether a navigation was initiated by a user action (play button
  // click, provider switch) vs an unsolicited JS redirect. Used by
  // shouldOverrideUrlLoading to block unsolicited ad hijacks.
  private var userInitiatedNavigation: Boolean = false

  // ── Audit Mode (Domain Discovery / Phase 3) ──
  // When enabled, every hostname encountered in shouldInterceptRequest
  // and shouldOverrideUrlLoading is recorded. The full set is dispatched
  // to JS when audit mode is turned off, so the user can review which
  // domains each provider contacts and manually classify new ad domains.
  //
  // Enhanced in Phase 4: also captures Sec-Fetch-Dest header and whether
  // the request had a Range header — lets us distinguish video CDN workers
  // from ad/tracker workers without inspecting response bodies.
  var auditMode: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      if (value) {
        trackedHosts.clear()
        trackedHostsDetailed.clear()
        android.util.Log.d("PlayerWebView", "AUDIT MODE ENABLED")
      } else {
        dispatchAuditData()
      }
    }

  private val trackedHosts: MutableSet<String> = mutableSetOf()
  /** Enhanced audit: host → set of "sec-fetch-dest:hasRange" descriptors */
  private val trackedHostsDetailed: MutableMap<String, MutableSet<String>> = mutableMapOf()

  private fun trackRequestIfAuditing(url: String, request: WebResourceRequest?) {
    if (!auditMode) return
    try {
      val host = Uri.parse(url).host?.lowercase() ?: return
      trackedHosts.add(host)
      // Capture request purpose metadata
      val dest = request?.requestHeaders?.get("Sec-Fetch-Dest") ?: "unknown"
      val hasRange = if (request?.requestHeaders?.containsKey("Range") == true) ":range" else ""
      val descriptor = "$dest$hasRange"
      trackedHostsDetailed.getOrPut(host) { mutableSetOf() }.add(descriptor)
    } catch (_: Exception) {}
  }

  private fun dispatchAuditData() {
    if (trackedHosts.isEmpty() || !auditMode) {
      android.util.Log.d("PlayerWebView", "AUDIT MODE DISABLED (no data)")
      return
    }
    val hostsList = trackedHosts.sorted().toList()
    // Include detailed descriptors in the data string: "host1→dest:range,host2→script"
    val detailed = trackedHostsDetailed.entries.sortedBy { it.key }
      .joinToString(",") { (h, descs) -> "$h→${descs.joinToString("|")}" }
    dispatchEvent("onAuditData") {
      putString("hosts", hostsList.joinToString(","))
      putInt("count", hostsList.size)
      putString("hostsDetailed", detailed)
    }
    android.util.Log.d("PlayerWebView",
      "AUDIT DATA: ${hostsList.size} hosts\n$detailed")
  }

  // ── Ad Blocking ───────────────────────────────────────────────────
  //
  // Consolidated from across JS (POPUP_BLOCKER_SCRIPT AD_PATTERNS,
  // makeCFBypassScript AD_DOMAINS) and the original native list, plus
  // domains discovered during real-world provider playback.
  // This is the SINGLE source of truth for network-level ad blocking.

  private val adDomains: Set<String> = setOf(
    // Major ad networks
    "doubleclick.net", "googleadservices.com", "googlesyndication.com",
    "google-analytics.com", "googletagmanager.com", "gtag/js",
    "pagead2.googlesyndication.com",
    "adnxs.com", "rubiconproject.com", "criteo.com", "criteo.net",
    "outbrain.com", "taboola.com", "revcontent.com",
    // Popup / popunder networks
    "popads", "popcash", "popunder", "adsterra.com",
    "propellerads.com", "trafficfactory.biz",
    // Tracking / analytics
    "pixel.", "track.", "tracking.", "beacon.",
    "histats.com", "statcounter.com", "scorecardresearch.com",
    // Ad exchanges
    "amazon-adsystem.com", "casalemedia.com", "contextweb.com",
    "openx.net", "pubmatic.com", "sharethrough.com",
    "media.net", "advertising.com", "adap.tv",
    "moatads.com", "servedby.", "exdynsrv.com",
    // Ad networks (additional)
    "exoclick.com", "juicyads.com", "plugrush.com",
    "trafficjunky.com", "adreactor.com", "adcash.com",
    "adhitz.com", "adk2.com", "adpierce.com",
    "clickadu.com", "clicksco.net", "hilltopads.com",
    "adsystem.", "adserver.", "ads.",
    // Discovered during playback
    "interlinecustomroofingllc.com",
    "1xlite",
    // Phase 3 audit: main-frame hijack domains (used by nxsha, vidnest)
    "wo.riverlayboy.shop",
    "hai8g.com",
    // Phase 3 audit: injected ad iframes / trackers
    "zoaclachan.cyou",
    "florian.sorrilylivyershape.cyou",
    "ag.phrymaphytic.com",
    "my.rtmark.net",
    "s.click.aliexpress.com",
    "developdomicile.com",
    // == UNKNOWN == Hijack redirect domains (originally misclassified as CDN)
    // frowstyambler.qpon was found during audit to be the nxsha hijack redirector,
    // not a video CDN. The page navigates here during the Type B hijack chain.
    "frowstyambler", "qpon",
    // Cloudflare RUM beacon (purely analytics — safe to block)
    "cloudflareinsights.com",
    // Aggressive popup patterns (nxsha and similar providers)
    "go.", "click.", "adx.", "adv.", "banner.",
    "traffic.", "redirect.", "redirecting.",
    "bestchange", "best-"
  )

  // Same-origin ad paths — if the host matches the current provider domain
  // AND the path contains one of these, the request is blocked.
  // Also catches off-domain hijack paths like wo.riverlayboy.shop/cx/...
  private val adPathPatterns: Set<String> = setOf(
    "/ads/", "/banner/", "/popup/", "/popunder/",
    "/tracking/", "/affiliate/", "/promo/", "/sponsor/",
    "/cx/"
  )

  // Known video CDN domains — never block even if they match ad patterns.
  // Providers proxy video through Cloudflare Workers (xxx.*.workers.dev) with
  // predictable prefixes (xbm=video, mp4=video). The unique suffix (e.g.
  // "elga15c1ba") changes per session, so we match on the prefix pattern.
  private val allowedCdnHosts: Set<String> = setOf(
    "akamai.net", "akamaiedge.net", "cloudfront.net",
    "fastly.net", "fastlylb.net",
    
    // Cloudflare Worker video CDNs (xbm.*.workers.dev, mp4.*.workers.dev)
    "xbm.",
    "mp4.",
    // Provider-specific video infrastructure
    "vidapi.cloud",
    "vidnees",
    "eat-peach.sbs"
  )

  private fun isAdOrTracker(url: String): Boolean {
    val uri = Uri.parse(url)
    val host = uri.host?.lowercase() ?: return false

    // 1. Never block known video CDNs
    if (allowedCdnHosts.any { host.contains(it) }) return false

    // 2. Domain-based blocking
    if (adDomains.any { host.contains(it) }) return true

    // 3. Path-based blocking (same-origin ads)
    val currentHost = currentUrl?.let { Uri.parse(it) }?.host
    if (currentHost != null && host == currentHost) {
      val path = uri.path ?: ""
      if (adPathPatterns.any { path.contains(it) }) return true
    }

    return false
  }

  /**
   * Fetch an HTML page and inject the child frame bridge script.
   * Called from shouldInterceptRequest for iframe/document HTML loads.
   */
  private fun injectBridgeIntoHtml(url: String): WebResourceResponse? {
    try {
      val urlObj = URL(url)

      // Check cache first
      val cacheKey = url
      synchronized(htmlCache) {
        htmlCache[cacheKey]?.let { cached ->
          return WebResourceResponse("text/html", "utf-8", ByteArrayInputStream(cached))
        }
      }

      val conn = urlObj.openConnection() as HttpURLConnection
      conn.connectTimeout = 10000
      conn.readTimeout = 10000
      conn.instanceFollowRedirects = true
      conn.setRequestProperty("Accept", "text/html,application/xhtml+xml")
      conn.setRequestProperty("Accept-Encoding", "identity") // Avoid gzip to simplify parsing
      conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14)")

      // Copy cookies from WebView's cookie jar so authenticated iframes work
      try {
        val cookies = CookieManager.getInstance().getCookie(url)
        if (cookies != null && cookies.isNotEmpty()) {
          conn.setRequestProperty("Cookie", cookies)
        }
      } catch (_: Exception) {}

      val responseCode = conn.responseCode
      if (responseCode != 200) {
        conn.disconnect()
        return null // Let WebView handle redirects/errors normally
      }

      // Only inject into HTML content
      val contentType = conn.contentType ?: ""
      if (!contentType.startsWith("text/html")) {
        conn.disconnect()
        return null
      }

      // Read response body
      val inputStream: InputStream = if ("gzip" == conn.contentEncoding) {
        GZIPInputStream(conn.inputStream)
      } else {
        conn.inputStream
      }

      val buffer = ByteArrayOutputStream()
      val chunk = ByteArray(8192)
      var bytesRead: Int
      var totalBytes = 0
      val maxBytes = 512 * 1024 // 512KB max for HTML pages

      while (inputStream.read(chunk).also { bytesRead = it } != -1) {
        totalBytes += bytesRead
        if (totalBytes > maxBytes) {
          // Page too large, skip injection and let WebView handle raw response
          inputStream.close()
          conn.disconnect()
          return null
        }
        buffer.write(chunk, 0, bytesRead)
      }
      inputStream.close()
      conn.disconnect()

      val html = buffer.toString("utf-8")
      val bridgeSnippet = BRIDGE_SCRIPT_SNIPPET

      // Inject the bridge script right after <head> (handles both <head> and <head ...>)
      val headEndTag = "</head>"
      val modifiedHtml = if (html.contains(headEndTag, ignoreCase = true)) {
        html.replaceFirst(
          Regex("</head>", RegexOption.IGNORE_CASE),
          "$bridgeSnippet</head>"
        )
      } else {
        // No head tag — inject before </html> or append
        val htmlEndTag = "</html>"
        if (html.contains(htmlEndTag, ignoreCase = true)) {
          html.replaceFirst(
            Regex("</html>", RegexOption.IGNORE_CASE),
            "$bridgeSnippet</html>"
          )
        } else {
          html + bridgeSnippet
        }
      }

      val resultBytes = modifiedHtml.toByteArray(Charsets.UTF_8)

      // Cache the result
      synchronized(htmlCache) {
        htmlCache[cacheKey] = resultBytes
      }

      android.util.Log.d("PlayerWebView",
        "[INJECT] Bridge injected into iframe HTML: ${url.take(80)} size=${resultBytes.size}")

      // Build response headers (copy original, adjust content-length, rewrite CSP)
      val responseHeaders = mutableMapOf<String, String>().apply {
        conn.headerFields?.forEach { (key, values) ->
          if (key != null && values.isNotEmpty()) {
            val keyLower = key.lowercase()
            // Skip content-encoding (we decoded) and content-length (we changed)
            if (keyLower != "content-encoding" &&
                keyLower != "content-length" &&
                keyLower != "content-security-policy" &&
                keyLower != "content-security-policy-report-only") {
              put(key, values.first())
            }
          }
        }
        // Rewrite CSP to allow our inline bridge script
        val cspHeader = conn.headerFields?.entries?.firstOrNull { (k, _) ->
          k?.lowercase() in setOf("content-security-policy", "content-security-policy-report-only")
        }
        if (cspHeader != null && cspHeader.value.isNotEmpty()) {
          val rewrittenCsp = rewriteCspForInlineScript(cspHeader.value.first())
          put(cspHeader.key, rewrittenCsp)
        }
        // Set the correct content length
        put("Content-Length", resultBytes.size.toString())
      }

      return WebResourceResponse(
        "text/html", "utf-8", 200, "OK",
        responseHeaders,
        ByteArrayInputStream(resultBytes)
      )
    } catch (e: Exception) {
      android.util.Log.w("PlayerWebView",
        "[INJECT] Failed to inject bridge into $url: ${e.message}")
      return null // Fall through — let WebView handle normally
    }
  }

  /**
   * Rewrite a Content-Security-Policy header to allow our inline bridge script.
   * Adds 'unsafe-inline' to script-src if not already present, or adds a
   * script-src directive with 'unsafe-inline' if no script-src exists.
   */
  private fun rewriteCspForInlineScript(csp: String): String {
    val directives = csp.split(';').map { it.trim() }.filter { it.isNotEmpty() }
    var hasScriptSrc = false
    val rewritten = directives.map { directive ->
      val parts = directive.trimStart().split(Regex("\\s+"), limit = 2)
      if (parts.size == 2 && parts[0].lowercase() == "script-src") {
        hasScriptSrc = true
        val existing = parts[1]
        // Only add unsafe-inline if not already present
        if (!existing.contains("'unsafe-inline'") && !existing.contains("'strict-dynamic'")) {
          "script-src 'unsafe-inline' $existing"
        } else {
          directive
        }
      } else {
        directive
      }
    }.toMutableList()

    if (!hasScriptSrc) {
      rewritten.add("script-src 'unsafe-inline'")
    }

    return rewritten.joinToString("; ")
  }

  // ── Page-Finished Helpers ──────────────────────────────────────────

  /**
   * Dispatch onPageFinished logic, factoring out the duplicate-guard and
   * injected-script re-application so both the real callback and the
   * fallback timer share the same path.
   */
  private fun dispatchPageFinished(url: String) {
    val wv = webView
    isLoading = false

    if (url == lastFinishedUrl) {
      android.util.Log.d("PlayerWebView",
        "OVERLAY onPageFinished SKIPPED (duplicate) url=${url.take(60)}")
      return
    }
    lastFinishedUrl = url

    // ALWAYS re-evaluate the injected script on page finish. This is the
    // PRIMARY injection mechanism — evaluateJavascript is a bedrock WebView
    // API (API 19+) that always works. addDocumentStartJavaScript (used in
    // ensureWebView() for child iframe injection) may silently fail on some
    // device/WebView combinations (MediaTek Helio G35 / Android 14).
    // The boot diagnostic at the top of the injected script has a one-time
    // guard (window.__playerBridgeInitialized) to prevent duplicate execution.
    if (injectedScript.isNotEmpty()) {
      wv?.evaluateJavascript(injectedScript, null)
    }

    if (!pageStartedFired) {
      dispatchEvent("onLoadingStart") { putString("url", url) }
    }
    pageStartedFired = false
    dispatchEvent("onLoadingFinish") { putString("url", url) }

    if (injectedJavaScriptAfterLoad.isNotEmpty()) {
      wv?.evaluateJavascript(injectedJavaScriptAfterLoad, null)
    }
  }

  private fun cancelPageFinishedFallback() {
    if (pageFinishedFallbackPosted) {
      pageFinishedFallbackHandler.removeCallbacks(pageFinishedFallbackRunnable)
      pageFinishedFallbackPosted = false
    }
  }

  // ── Fabric Events ─────────────────────────────────────────────────

  private inner class ViewEvent(
    surfaceId: Int,
    viewTag: Int,
    private val eventNameInternal: String,
    private val eventData: com.facebook.react.bridge.WritableMap
  ) : Event<ViewEvent>(surfaceId, viewTag) {
    override fun getEventName(): String = eventNameInternal
    override fun getEventData() = eventData
    override fun canCoalesce(): Boolean = false
  }

  private fun dispatchEvent(eventName: String, body: (ArgumentsMapBuilder.() -> Unit)) {
    try {
      val rc = reactContext ?: run {
        android.util.Log.w("PlayerWebView", "OVERLAY dispatchEvent NO_REACT_CONTEXT")
        return
      }
      val surfaceId = -1
      val viewTag = this.id
      val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(rc, viewTag)

      if (dispatcher == null) {
        android.util.Log.d("PlayerWebView",
          "OVERLAY dispatchEvent NO_DISPATCHER event=$eventName viewTag=$viewTag")
        return
      }

      val writableMap = Arguments.createMap().apply {
        body(ArgumentsMapBuilder(this))
      }
      val normalizedName = if (eventName.startsWith("on")) {
        "top" + eventName.substring(2)
      } else {
        eventName
      }

      dispatcher.dispatchEvent(ViewEvent(surfaceId, viewTag, normalizedName, writableMap))
      android.util.Log.d("PlayerWebView",
        "OVERLAY dispatchEvent OK name=$normalizedName viewTag=$viewTag")
    } catch (e: Exception) {
      android.util.Log.e("PlayerWebView",
        "OVERLAY dispatchEvent EXCEPTION event=$eventName error=${e.message}")
    }
  }

  private class ArgumentsMapBuilder(private val map: com.facebook.react.bridge.WritableMap) {
    fun putString(key: String, value: String) = map.putString(key, value)
    fun putInt(key: String, value: Int) = map.putInt(key, value)
    fun putDouble(key: String, value: Double) = map.putDouble(key, value)
    fun putBoolean(key: String, value: Boolean) = map.putBoolean(key, value)
  }

  // ── JS Bridge ─────────────────────────────────────────────────────

  private inner class JsBridgeInterface {
    @android.webkit.JavascriptInterface
    fun postMessage(message: String) {
      dispatchEvent("onMessage") { putString("data", message) }
    }
  }
}
