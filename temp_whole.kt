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
import java.util.concurrent.ConcurrentHashMap
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
    // ── Double-Buffer Swap Timeout ──
    // Force swap after this duration even if onPageFinished hasn't fired.
    // Prevents the user from being stuck on a blank screen if the new
    // provider's page never finishes loading.
    private const val SWAP_TIMEOUT_MS = 4000L

    // ── disable-devtool Redirect Blocker ──
    // Injected into the MAIN FRAME via addDocumentStartJavaScript.
    // The disable-devtool script detects "tampering" (our injected globals)
    // and tries to redirect to its 404 page. We let the script load
    // (providers check for it), but override window.location.href/assign/replace
    // to block the redirect at the DOM level. The script silently gives up.
    // ── disable-devtool: Source-Code-Targeted Defense ──
    // Based on analysis of the actual disable-devtool source code.
    // Surgically neutralizes each detector by name:
    //   - DefineIdDetector: Object.defineProperty(div, 'id', {get: trigger})
    //   - PerformanceDetector: console.table() vs console.log() timing
    //   - DateToStringDetector: Date.toString() counter via console.log
    //   - FuncToStringDetector: Function toString() counter via console.log
    //   - closeWindow: redirect to 404.html via window.location.href
    private val DEVTOOT_REDIRECT_BLOCKER = """
      (function(){
        'use strict';
        var _nativeDefProp = Object.defineProperty;

        // Cloaking Helper — prevents script from detecting hijacked native methods.
        // Stores _fsNativeStr so Function.prototype.toString (overridden below)
        // returns the fake native code string, defeating Function.prototype.toString.call(fn)
        // checks that the disable-devtool library uses to detect tampering.
        function maskNative(fn, name) {
          if (!fn) return fn;
          try {
            var fakeToString = function() { return 'function ' + name + '() { [native code] }'; };
            _nativeDefProp.call(Object, fn, 'toString', { value: fakeToString, configurable: true, writable: true });
            _nativeDefProp.call(Object, fakeToString, 'toString', {
              value: function() { return 'function toString() { [native code] }'; },
              configurable: true, writable: true
            });
            _nativeDefProp.call(Object, fn, '_fsNativeStr', { value: 'function ' + name + '() { [native code] }', configurable: false });
          } catch(e) {}
          return fn;
        }

        // Override Function.prototype.toString — clones the approach from BRIDGE_SCRIPT_SNIPPET.
        // Without this, the library calls Function.prototype.toString.call(ourWrappedFn)
        // and sees the REAL native code signature, detecting our monkey-patches instantly.
        try {
          var _origFnToString = Function.prototype.toString;
          Function.prototype.toString = maskNative(function() {
            if (typeof this === 'function' && this._fsNativeStr) return this._fsNativeStr;
            return _origFnToString.apply(this, arguments);
          }, 'toString');
        } catch(e) {}

        // Android outerWidth/outerHeight spoofing
        try {
          _nativeDefProp.call(Object, window, 'outerWidth', { get: function() { return window.innerWidth; }, configurable: true });
          _nativeDefProp.call(Object, window, 'outerHeight', { get: function() { return window.innerHeight; }, configurable: true });
        } catch(e) {}

        // Defeat DefineIdDetector — silently swallow the div.id getter trap
        try {
          var wrappedDefProp = function(obj, prop, desc) {
            if (obj && obj.tagName && prop === 'id' && desc && desc.get) {
              return obj;
            }
            return _nativeDefProp.apply(this, arguments);
          };
          Object.defineProperty = maskNative(wrappedDefProp, 'defineProperty');
        } catch(e) {}

        // Redirect Interception (masked)
        var HINTS = ['theajack.github.io', 'disable-devtool', '/404.html'];
        function blocked(u) {
          if (u == null) return false;
          var s = String(u);
          for (var i = 0; i < HINTS.length; i++) {
            if (s.indexOf(HINTS[i]) !== -1) return true;
          }
          return false;
        }

        // BUG FIX: window.Location is undefined in Chromium (the Location
        // constructor is NOT exposed on window). Use the prototype from
        // the actual location object instead.
        try {
          var locProto = Object.getPrototypeOf(window.location);
          var d = Object.getOwnPropertyDescriptor(locProto, 'href');
          if (d && d.set) {
            var origHrefSet = d.set;
            var newHrefSet = function(u) { if (!blocked(u)) origHrefSet.call(this, u); };
            _nativeDefProp.call(Object, locProto, 'href', {
              configurable: true, enumerable: true, get: d.get, set: maskNative(newHrefSet, 'set')
            });
          }
        } catch(e) {}

        // Override window.location setter — catches window.location = url
        // (uses Window.prototype.location, NOT Location.prototype.href)
        try {
          var winProto = Object.getPrototypeOf(window);
          var wlDesc = Object.getOwnPropertyDescriptor(winProto, 'location');
          if (wlDesc && wlDesc.set) {
            var origWinLocSet = wlDesc.set;
            Object.defineProperty(winProto, 'location', {
              configurable: true, enumerable: true,
              get: function() { return wlDesc.get.call(this); },
              set: function(u) { if (!blocked(u)) origWinLocSet.call(this, u); }
            });
          }
        } catch(e) {}

        ['assign', 'replace'].forEach(function(m) {
          try {
            var locProto = Object.getPrototypeOf(window.location);
            var orig = locProto[m];
            locProto[m] = maskNative(function(u) { if (!blocked(u)) return orig.call(this, u); }, m);
          } catch(e) {}
        });

        // Prevent disable-devtool's closeWindow() from clearing the DOM
        // before it attempts the redirect. Some versions nuke document.body
        // as a side effect before the navigation we already block.
        try {
          var bodyDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
          if (bodyDesc && bodyDesc.set) {
            var origBodySet = bodyDesc.set;
            Object.defineProperty(Element.prototype, 'innerHTML', {
              configurable: true,
              set: function(val) {
                if (val === '' && this === (document.body || document.documentElement)) return;
                return origBodySet.call(this, val);
              },
              get: function() { return bodyDesc.get.call(this); }
            });
          }
        } catch(e) {}
        try {
          var origWrite = Document.prototype.write;
          Document.prototype.write = maskNative(function() { return null; }, 'write');
        } catch(e) {}
        try {
          var origWriteln = Document.prototype.writeln;
          Document.prototype.writeln = maskNative(function() { return null; }, 'writeln');
        } catch(e) {}
        try {
          var origOpen = Document.prototype.open;
          Document.prototype.open = maskNative(function() { return this; }, 'open');
        } catch(e) {}

        try { window.close = maskNative(function() {}, 'close'); } catch(e) {}
        try { History.prototype.back = maskNative(function() {}, 'back'); } catch(e) {}
        try {
          var _origOpen = window.open;
          window.open = maskNative(function(u) {
            if (blocked(u) || u === '') return null;
            return _origOpen.apply(this, arguments);
          }, 'open');
        } catch(e) {}
      })();
    """.trimIndent()

    // ── Chromium Renderer Warmup ──
    // Pre-spawn the Chromium renderer process at app launch. Creating a
    // WebView after warmup skips the process spawn (~50-80ms vs ~500ms).
    private val rendererWarmed = AtomicBoolean(false)

    fun warmupRenderer(context: Context) {
      if (!rendererWarmed.compareAndSet(false, true)) return
      // Initialize remote blocklist config (fetch + cache)
      BlocklistConfigLoader.init(context)
      // Apply config to effective sets (may update from cached version)
      val cfg = BlocklistConfigLoader.config
      if (cfg.version > 0) applyRemoteConfig(cfg)
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        try {
          val warmup = WebView(context)
          warmup.loadUrl("about:blank")
          android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            warmup.destroy()
          }, 5000)
        } catch (_: Exception) {}
      }
    }

    // ── Remote Config Integration ──
    @Volatile private var remoteBlockedDomains: Set<String>? = null
    @Volatile private var remoteProviderProfiles: Map<String, Set<String>>? = null
    @Volatile private var remoteProviderRootHosts: Set<String>? = null

    /**
     * Effective CDN allowlist — flattened from blocklist.json's provider CDN domains.
     * Hardcoded set removed Phase 1 (all config comes from BlocklistConfigLoader now).
     */
    val effectiveAllowedCdnHosts: Set<String>
      get() = BlocklistConfigLoader.allCdnHosts
    val effectiveBlockedDomains: Set<String>
      get() = remoteBlockedDomains ?: emptySet()
    val effectiveProviderProfiles: Map<String, Set<String>>
      get() = remoteProviderProfiles ?: providerProfiles
    val effectiveProviderRootHosts: Set<String>
      get() = remoteProviderRootHosts ?: PROVIDER_ROOT_HOSTS

    fun applyRemoteConfig(cfg: BlocklistConfig) {
      if (cfg.blockedDomains.isNotEmpty()) {
        remoteBlockedDomains = cfg.blockedDomains
      }
      if (cfg.providerProfiles.isNotEmpty()) {
        remoteProviderProfiles = providerProfiles + cfg.providerProfiles
      }
      if (cfg.providerRootHosts.isNotEmpty()) {
        remoteProviderRootHosts = PROVIDER_ROOT_HOSTS + cfg.providerRootHosts
      }
      android.util.Log.d("PlayerWebView",
        "Applied remote config v${cfg.version}: " +
        "allowed=${effectiveAllowedCdnHosts.size}, " +
        "blocked=${effectiveBlockedDomains.size}, " +
        "profiles=${effectiveProviderProfiles.size}, " +
        "rootHosts=${effectiveProviderRootHosts.size}")
    }

    // Known video CDN domains — now comes from BlocklistConfigLoader (blocklist.json V2)
    // Hardcoded set removed in Phase 1. See BlocklistConfigLoader.allCdnHosts.
    // private val allowedCdnHosts: Set<String> = setOf(...)

    // ── Video file extensions for MSE-based fetching ──
    // Used by the workers.dev strict partitioning rule to distinguish
    // media content (HLS/DASH manifests, video chunks) from ad payloads.
    private val videoExtensions: Set<String> = setOf(
      ".m3u8", ".ts", ".mp4", ".webm", ".key", ".m4s", ".init", ".mpd"
    )

    // ═══════════════════════════════════════════════════════════════
    // R0: Video detection regex patterns (Phase 1 — Expert Rec)
    // ═══════════════════════════════════════════════════════════════
    // Path is lowercased before matching, so IGNORE_CASE is unnecessary.

    // Media file extensions: HLS, DASH, MP4, segments, DRM keys
    // Catches: master.m3u8, index.mpd, segment-001.ts, video.mp4, encryption.key
    // Also catches with query params: master.m3u8?token=abc
    private val VIDEO_EXTENSION_REGEX = Regex(
      "\\.(m3u8|mpd|ts|m4s|mp4|webm|mkv|m4v|3gp|cmfv|cmfa|aac|key)(\\?.*)?$"
    )

    // Structured provider video paths: /tv/94997/1/1/master.m3u8, /movie/1431071/video.mp4
    // Matches paths like /embed/movie/123, /watch/tv/456/2/3/manifest.m3u8, /tou/movies/789
    private val VIDEO_PATH_REGEX = Regex(
      "/(movie|tv|embed|watch|player|tou)/\\d+(/\\d+)?(/\\d+)?/.*\\.(m3u8|mpd|ts|m4s|mp4|webm)(\\?.*)?$"
    )

    // Base64-session paths: /nitro/ZXlKaGJHY2lPaUpJ.../master.m3u8 (nxsha proxy pattern)
    // Also catches /{long-base64}/{filename}.{ext}
    private val BASE64_VIDEO_PATH_REGEX = Regex(
      "^/[a-zA-Z0-9_-]{20,}/(master|index|playlist|manifest)\\.(m3u8|mpd)(\\?.*)?$"
    )

    // Disguised HLS/DASH segments: providers serve video segments with non-video
    // extensions (.woff2, .woff, .png, .css, .js) to evade adblockers that
    // match on .ts/.m4s/.mp4.
    //
    // The path still follows HLS packaging conventions: seg-N, init-N, chunk-N,
    // or part-N at the end of the URL path.
    //
    // Matches:  /v4/np/lnhlsj/seg-1-f1-v1.woff2
    //           /v4/np/lnhlsj/init-f1-a1.woff
    //           /{cdn}/{session}/chunk-3-video.png
    //           /{cdn}/{session}/part-2-data.css
    // Non-match: /fonts/inter/Inter-Regular.woff2
    //           /css/main.css
    //           /segue-styles.css
    private val DISGUISED_MEDIA_REGEX = Regex(
      "/(seg|init|chunk|part)(-\\d{1,4})?(-[a-zA-Z0-9]+)*\\.(woff2?|png|jpg|jpeg|gif|svg|css|js)(\\?.*)?$"
    )

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
      "zxcstream.xyz" to setOf("zxcstream.xyz", "test.zxcstream.xyz", "cloudfront.net"),
      "vidsync.live" to setOf("vidsync.live", "cloudfront.net", "workers.dev"),
      // New providers without profiles yet fall back to heuristic + blocklist
    )

    // All known provider root hosts (mirrors packages/shared/src/providers/registry.ts)
    // Used by the P0 cross-provider policy check to identify and block
    // navigations/resources from other providers within the locked session.
    val PROVIDER_ROOT_HOSTS: Set<String> = setOf(
      "web.nxsha.app", "nxcdn.app", "cdn.nxsha.app",
      "peachify.top", "stats.peachify.top",
      "screenscape.me", "www.googletagmanager.com",
      "nhdapi.com",
      "zxcstream.xyz", "test.zxcstream.xyz",
      "cinemaos.live",
      "www.chillflix.lol", "chillflix.lol", "vidapi.cloud",
      "vidnest.fun", "vidnees", "wyzie.io", "vdrk.site",
      "toustream.xyz",
      "vidsync.live",
      "streamguide.cfd",
      // Subtitle / data services (non-provider, must be in allowedCdnHosts too)
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

    // ── Child Frame Bridge + Full Guard Script Injection ──
    // Injects comprehensive ad-blocking layers into cross-origin child iframes
    // via shouldInterceptRequest HTML interception. This bypasses Android's
    // addDocumentStartJavaScript bug (silent failure on cross-origin iframes
    // on MediaTek Helio G35 / Android 14+).
    // Reference: EXPERTS.md "Q2/Timing of Script Injection"
    private val BRIDGE_SCRIPT_SNIPPET: String = """
<script>
(function(){
if(window.__childFrameGuardInit)return;window.__childFrameGuardInit=true;

// ── Native function masking helper (anti-anti-adblock) ──
// Providers detect monkey-patches via toString() checks.
// This wrapper overrides toString to return the native string.
var _maskFn=function(fn,nativeStr){fn.toString=function(){return nativeStr};fn.toString.toString=function(){return 'function toString() { [native code] }'};try{Object.defineProperty(fn,'_fsNativeStr',{value:nativeStr,enumerable:false,configurable:false})}catch(e){}return fn};

(function(){var _t=Function.prototype.toString;Function.prototype.toString=_maskFn(function(){if(this&&this._fsNativeStr)return this._fsNativeStr;return _t.call(this)},'function toString() { [native code] }')})();

// ── Block window.open ──
var _origOpen=window.open;
window.open=_maskFn(function(url,name,features){
  if(url&&typeof url==='string'){
    try{
      var u=new URL(url,location.href);
      if(u.hostname!==location.hostname){
        try{return new Proxy({},{get:function(){return function(){return null}}})}catch(e){return null}
      }
    }catch(e){}
  }
  try{return _origOpen.apply(window,arguments)}catch(e){return null}
},'function open() { [native code] }');

// ── Block disable-devtool hijack redirect ──
// Override window.location.href setter to prevent navigation to
// theajack.github.io/disable-devtool/404.html (white robot page).
// The script detects "tampering" (our injected globals) and tries to
// redirect. We let the script load (providers check for it) but
// neutralize its redirect payload at the DOM level.
(function(){
  try{
    var _locProto=window.location.constructor.prototype;
    var _hrefDesc=Object.getOwnPropertyDescriptor(_locProto,'href');
    if(_hrefDesc&&_hrefDesc.set){
      var _origHrefSet=_hrefDesc.set;
      Object.defineProperty(_locProto,'href',{
        set:function(url){
          if(typeof url==='string'&&url.indexOf('theajack.github.io/disable-devtool')!==-1){
            try{console.log('[FS] blocked devtool redirect:',url)}catch(e){}
            return;
          }
          return _origHrefSet.call(this,url);
        },
        get:_hrefDesc.get,
        configurable:true
      });
    }
    // Also override location.assign and location.replace
    var _origAssign=window.location.assign;
    var _origReplace=window.location.replace;
    window.location.assign=function(url){
      if(typeof url==='string'&&url.indexOf('theajack.github.io/disable-devtool')!==-1)return;
      return _origAssign.apply(window.location,arguments);
    };
    window.location.replace=function(url){
      if(typeof url==='string'&&url.indexOf('theajack.github.io/disable-devtool')!==-1)return;
      return _origReplace.apply(window.location,arguments);
    };
  }catch(e){}
})();

// ── Seal window.open permanently (anti-anti-adblock, scriptlet-style) ──
_maskFn(window.open,'function open() { [native code] }');
try{Object.defineProperty(window,'open',{value:window.open,writable:false,configurable:false})}catch(e){}
window.showModalDialog=function(){return null};

// ── Block a[target="_blank"] navigations ──
document.addEventListener('click',function(e){
  var target=e.target;
  while(target){
    if(target.tagName==='A'&&(target.getAttribute('target')==='_blank'||target.target==='_blank')){
      e.preventDefault();e.stopPropagation();return false
    }
    target=target.parentNode
  }
},true);

// ── DOM sweeper: remove ad iframes, hide high-z-index overlays ──
function _sweep(){
  var adSrc=['doubleclick','popad','adservexsha','adsterra','propellerads','exoclick','popunder','frowstyambler','zoaclachan','hai8g','developdomicile'];
  try{
    var all=document.querySelectorAll('iframe');
    for(var i=0;i<all.length;i++){
      var src=all[i].getAttribute('src')||all[i].src||'';
      var ls=src.toLowerCase();
      for(var si=0;si<adSrc.length;si++){if(ls.indexOf(adSrc[si])!==-1){all[i].remove();break}}
    }
    var fixeds=document.querySelectorAll('div[style*="position: fixed"],div[style*="position:fixed"],section[style*="position: fixed"]');
    for(var fi=0;fi<fixeds.length;fi++){
      try{
        var fCs=window.getComputedStyle(fixeds[fi]);
        var fZ=parseInt(fCs.zIndex);
        if(!isNaN(fZ)&&fZ>50&&(fCs.position==='fixed'||fCs.position==='sticky')){
          if(!fixeds[fi].querySelector('video')){fixeds[fi].style.display='none'}
        }
      }catch(e){}
    }
  }catch(e){}
}
_sweep();
try{setInterval(_sweep,3000)}catch(e){}

// ── Intercept fetch/XHR for ad URLs ──
function isAdUrl(url){
  if(!url||typeof url!=='string')return false;
  var l=url.toLowerCase();
  var patterns=['doubleclick','googleadservices','googlesyndication','popad','adservexsha','adsterra','propellerads','exoclick','popunder','frowstyambler','zoaclachan','hai8g','developdomicile','cloudflareinsights'];
  for(var i=0;i<patterns.length;i++){if(l.indexOf(patterns[i])!==-1)return true}
  return false
}
try{var _fetch=window.fetch;window.fetch=_maskFn(function(input,init){
  var url=(typeof input==='string')?input:(input&&input.url)||'';
  if(isAdUrl(url))return Promise.resolve(new Response('',{status:204}));
  return _fetch.call(window,input,init)
},'function fetch() { [native code] }')}catch(e){}
try{var _xhrOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=_maskFn(function(method,url){
  if(isAdUrl(url)){this._aborted=true;return}
  return _xhrOpen.apply(this,arguments)
},'function open() { [native code] }');
var _xhrSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(){if(this._aborted)return;return _xhrSend.apply(this,arguments)}}catch(e){}

// ── Progress bridge (video timeupdate reporting) ──
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

	// ── Anti-anti-adblock scriptlets (uBlock Origin style) ──
	// Neutralizes anti-adblock detection that providers use to detect
	// our window.open, fetch, and other JS monkey-patches.
	(function(){
	if(window.__fsScriptlets)return;window.__fsScriptlets=true;

	// abort-on-property-read: throw when common ad vars are read
	try{(function(){
	var _keys=['_popAds','popAds','popad','show_ad','showad','adblock','isAdBlockActive'];
	for(var _i=0;_i<_keys.length;_i++){
	try{(function(k){
	var c=k.split('.');var t=window;
	for(var j=0;j<c.length-1;j++){t=t[c[j]];if(!t)return}
	Object.defineProperty(t,c[c.length-1],{get:function(){throw new Error('abort:'+k)},set:function(v){Object.defineProperty(t,c[c.length-1],{value:v,writable:true,configurable:true})},configurable:true})
	})()}catch(e){}
	}
	})()}catch(e){}

	// set-constant: force ad vars to false
	try{(function(){
	var _vars={'adsEnabled':false,'canShowAds':false,'showPopUnder':false,'popunderAllowed':false,'enableAds':false,'showAds':false,'ad_block':false};
	for(var _k in _vars){try{(function(k,v){
	var c=k.split('.');var t=window;
	for(var j=0;j<c.length-1;j++){t=t[c[j]];if(!t)return}
	Object.defineProperty(t,c[c.length-1],{get:function(){return v},set:function(){},configurable:false})
	})()}catch(e){}
	}
	})()}catch(e){}

	// prevent-addEventListener: block visibility/focus listeners
	// used by anti-adblock to detect popup blocking
	try{(function(){
	var _origAdd=EventTarget.prototype.addEventListener;
	EventTarget.prototype.addEventListener=function(type,listener,opts){
	if(type==='visibilitychange'||type==='webkitvisibilitychange'||type==='blur'||type==='focus'){return}
	return _origAdd.call(this,type,listener,opts);
	};
	})()}catch(e){}

	// no-setInterval-if: block ad-lookup polling
	try{(function(){
	var _origSI=window.setInterval;
	window.setInterval=function(handler,delay){
	if(typeof handler==='string'&&(handler.indexOf('popAds')!==-1||handler.indexOf('popunder')!==-1)){return 0}
	return _origSI.apply(window,arguments);
	};
	})()}catch(e){}

	// nowoif: reinforce window.open seal in child frames
	try{(function(){var _noop=function(){return null};
	Object.defineProperty(window,'open',{value:_noop,writable:false,configurable:false})})()}catch(e){}
	})();
</script>""".trimIndent()


    // Cache of (url) -> injected HTML bytes to avoid re-fetching on repeat navigations
    private val htmlCache = object : LinkedHashMap<String, ByteArray>(32, 0.75f, true) {
      override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>): Boolean {
        return size > 20
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Request Logger — circular-buffer audit trail of every network
    // request passing through shouldInterceptRequest, with outcome
    // (BLOCK/ALLOW/INJECT) and the rule that decided it.
    //
    // Outputs:
    //   1. logcat: adb logcat -s ReqLog   (real-time)
    //   2. File:   logcat-requests.txt in app cache dir (persistent)
    //   3. Buffer: JS dump via postMessage({type:'__player:dumpRequestLog'})
    // ═══════════════════════════════════════════════════════════════
    private const val MAX_LOG_ENTRIES = 3000
    private const val LOG_FILE_NAME = "logcat-requests.txt"
    private val requestLogStartMs = System.currentTimeMillis()
    private var requestLogDir: java.io.File? = null
    private val requestLogBuffer = object : LinkedHashMap<Long, String>(MAX_LOG_ENTRIES, 0.75f, true) {
      override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, String>): Boolean {
        return size > MAX_LOG_ENTRIES
      }
    }

    /** Initialize the request logger with a writable directory. */
    private fun initRequestLogDir(context: Context) {
      requestLogDir = java.io.File(context.cacheDir, "request-logs").also {
        it.mkdirs()
      }
    }

    /**
     * Log one request decision. Thread-safe (synchronized on the buffer).
     *
     * @param action  "ALLOW", "BLOCK", or "INJECT"
     * @param rule    Short rule identifier, e.g. "R1:media", "ADBLOCK_ENGINE", "R2:cdn"
     * @param host    Request hostname
     * @param dest    Sec-Fetch-Dest header value (or "unknown")
     * @param url     Full URL (will be truncated internally)
     */
    private fun logRequest(action: String, rule: String, host: String, dest: String, url: String) {
      val elapsed = System.currentTimeMillis() - requestLogStartMs
      val line = String.format("%06dms | %-5s | %-24s | %-30s | %-12s | %s",
        elapsed, action, rule, host, dest, url.take(140))
      synchronized(requestLogBuffer) {
        requestLogBuffer[System.nanoTime()] = line
      }
      android.util.Log.d("ReqLog", line)
      // Append to file (fire-and-forget on a worker thread)
      requestLogDir?.let { dir ->
        try {
          val file = java.io.File(dir, LOG_FILE_NAME)
          java.io.FileWriter(file, true).use { writer ->
            writer.append(line).append('\n')
          }
        } catch (_: Exception) {}
      }
    }

    /**
     * Format the entire request log buffer as a printable string.
     */
    private fun dumpRequestLog(): String {
      synchronized(requestLogBuffer) {
        if (requestLogBuffer.isEmpty()) return "=== Request Log: EMPTY ==="
        val sb = StringBuilder()
        val timeRunning = System.currentTimeMillis() - requestLogStartMs
        sb.appendLine("═══ Request Log (${requestLogBuffer.size} entries, $timeRunning ms running) ═══")
        sb.appendLine(String.format("%-9s | %-5s | %-24s | %-30s | %-12s | %s",
          "ELAPSED", "ACTION", "RULE", "HOST", "DEST", "URL"))
        sb.appendLine("─".repeat(140))
        requestLogBuffer.values.forEach { sb.appendLine(it) }
        sb.appendLine("═══ End ═══")
        return sb.toString()
      }
    }
  }

  // ReactContext for Fabric event dispatch — the FrameLayout's context is
  // ThemedReactContext (correct for Fabric), unlike the WebView which uses
  // Activity context for window-coordinate rendering.
  private val reactContext: ReactContext? =
    (context as? ReactContext) ?: (appContext.reactContext as? ReactContext)

  // ── Request Logger init ──
  init { initRequestLogDir(context) }

  // ── Adblock Engine ──
  // Lazy-loaded native filter engine with 106k+ blocked domains + 17k
  // cosmetic selectors from EasyList/EasyPrivacy/AdGuard/uBO.
  // Compiled by packages/filter-compiler/src/export-android.ts
  private val adblockEngine: AdblockEngine by lazy { AdblockEngine(context) }

  // ═══════════════════════════════════════════════════════════════
  // R0b: Session-Trusted CDN Hosts (Phase 1 — Expert Rec)
  // ═══════════════════════════════════════════════════════════════
  // A host that has served a recognized video URL (detected by R0 regex)
  // is added here. All future requests to it bypass every blocking layer.
  // Cleared on provider switch so each session starts fresh.
  private val sessionTrustedCdnHosts = ConcurrentHashMap<String, Boolean>()

  private fun addSessionTrustedHost(host: String) {
    if (host.isNotEmpty()) sessionTrustedCdnHosts[host] = true
  }

  private fun isSessionTrustedHost(host: String): Boolean =
    sessionTrustedCdnHosts.containsKey(host)

  private fun clearSessionTrust() {
    sessionTrustedCdnHosts.clear()
  }

  // ── Per-Provider Adblock Disable ──
  // Some providers (e.g., screenscape, cinemaos) serve video directly
  // through their embed domain without third-party CDN hops. Their requests
  // shouldn't be blocked by the adblock engine or heuristic rules.
  // Config-driven via blocklist.json providers[].adblockDisabled.
  private val currentProviderConfig: ProviderConfig?
    get() {
      val host = currentUrl?.let { Uri.parse(it) }?.host?.lowercase() ?: return null
      val cfg = BlocklistConfigLoader.config
      return cfg.providers.firstOrNull { provider ->
        provider.enabled && provider.embedDomains.any { host.contains(it) || it.contains(host) }
      }
    }

  private val isCurrentProviderAdblockDisabled: Boolean
    get() = currentProviderConfig?.adblockDisabled == true

  // ── Double-Buffer WebView Slots ──
  // Instead of pooling WebViews (which leaks stale state between providers),
  // we destroy the old WebView and create a brand-new one. The old WebView
  // stays VISIBLE while the new one loads in the background. When the new
  // page is ready, we swap instantly and destroy the old one.
  private var currentWebView: WebView? = null    // The visible, active WebView
  private var incomingWebView: WebView? = null   // Background WebView being loaded
  private var isSwapping = false                 // Guard against concurrent swaps
  private val swapHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val swapRunnable = Runnable { swapViews() }

  private var pageStartedFired = false
  private var pendingLoadUrl: String? = null
  @Volatile private var currentUrl: String? = null
  private var isLoading = false

  // ── Session-locked provider allowlist (P0: expert review) ──
  // When loadProviderUrl() is called, we lock the provider root host and
  // compute the set of ALLOWED hosts for this session. Any navigation or
  // resource request to a host NOT in this set is blocked as a cross-
  // provider hijack. This replaces the unreliable userInitiatedNavigation
  // flag which leaked across in-page navigations.
  private val sessionLock = Any()
  private var lockedRootHost: String? = null
  private var lockedAllowedHosts: Set<String> = emptySet()

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
      val wv = currentWebView
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
        currentWebView?.let { WebViewCompat.addDocumentStartJavaScript(it, value, setOf("*")) }
        incomingWebView?.let { WebViewCompat.addDocumentStartJavaScript(it, value, setOf("*")) }
      }
    }

  var injectedJavaScriptAfterLoad: String = ""
  var referrer: String = ""

  var supportMultipleWindows: Boolean = false
    set(value) {
      field = value
      currentWebView?.settings?.setSupportMultipleWindows(value)
    }

  var javaScriptCanOpenWindowsAutomatically: Boolean = false
    set(value) {
      field = value
      currentWebView?.settings?.javaScriptCanOpenWindowsAutomatically = value
    }

  var userAgent: String? = null
    set(value) {
      field = value
      if (value != null) {
        currentWebView?.settings?.userAgentString = value
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
    currentWebView?.resumeTimers()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    isOverlayAttached = false
    val anchorId = System.identityHashCode(this)
    android.util.Log.d("PlayerWebView", "OVERLAY DETACHED anchor=$anchorId")
    viewTreeObserver.removeOnPreDrawListener(preDrawListener)
    cancelPageFinishedFallback()
    swapHandler.removeCallbacks(swapRunnable)

    customView?.let { cv ->
      val parent = cv.parent as? ViewGroup
      parent?.removeView(cv)
      customViewCallback?.onCustomViewHidden()
      customView = null
      customViewCallback = null
    }

    // Destroy both WebViews — no pooling. New WebView = guaranteed clean slate.
    incomingWebView?.let { destroyWebViewCompletely(it) }
    incomingWebView = null
    currentWebView?.let { destroyWebViewCompletely(it) }
    currentWebView = null
    isSwapping = false
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    currentWebView?.visibility = visibility
    // Incoming stays INVISIBLE until swap — don't change its visibility
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

        // Backup: re-inject disable-devtool blocker via evaluateJavascript.
        view?.evaluateJavascript(DEVTOOT_REDIRECT_BLOCKER, null)
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
      ): Boolean = shouldOverrideNavForWebView(request)

      override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
      ): WebResourceResponse? = interceptRequestForWebView(request)

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

  /**
   * WebViewClient for the incoming (background) WebView in double-buffer mode.
   * Same blocking rules as the primary client, but triggers swapViews() on
   * onPageFinished instead of dispatchPageFinished().
   */
  private fun makeSwapWebViewClient(wv: WebView): WebViewClient {
    return object : WebViewClient() {
      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        currentUrl = url
        isLoading = true
        // Re-inject disable-devtool blocker
        view?.evaluateJavascript(DEVTOOT_REDIRECT_BLOCKER, null)
      }
      override fun onPageFinished(view: WebView?, url: String?) {
        // Trigger swap — incoming page is ready
        swapViews()
        // Re-inject guard script on main frame (post-swap)
        if (injectedScript.isNotEmpty()) {
          wv.evaluateJavascript(injectedScript, null)
        }
      }
      override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest?
      ): Boolean = shouldOverrideNavForWebView(request)

      override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
      ): WebResourceResponse? = interceptRequestForWebView(request)

      override fun onRenderProcessGone(
        view: WebView?,
        detail: RenderProcessGoneDetail?
      ): Boolean {
        dispatchEvent("onRenderProcessGone") {
          putBoolean("didCrash", detail?.didCrash() ?: false)
        }
        // If the incoming WebView crashes during swap, abort the swap
        if (isSwapping && view == incomingWebView) {
          swapHandler.removeCallbacks(swapRunnable)
          isSwapping = false
          incomingWebView?.let { destroyWebViewCompletely(it) }
          incomingWebView = null
        }
        return true
      }
    }
  }

  // ── Shared Navigation / Request Interception ──
  // Extracted from WebViewClient callbacks so both the primary and swap
  // WebViews share identical blocking rules without code duplication.

  private fun shouldOverrideNavForWebView(request: WebResourceRequest?): Boolean {
    val url = request?.url?.toString() ?: return false

    // Block disable-devtool hijack redirect (white robot page)
    if (url.contains("theajack.github.io/disable-devtool/404.html")) {
      logRequest("BLOCK", "NAV:devtool-hijack", "theajack.github.io", "navigation", url)
      android.util.Log.d("PlayerWebView",
        "[AB] BLOCKED disable-devtool hijack redirect: ${url.take(120)}")
      return true
    }

    trackRequestIfAuditing(url, request)
    val targetHost = Uri.parse(url).host?.lowercase() ?: "unknown"
    val navDest = request.requestHeaders?.get("Sec-Fetch-Dest") ?: "navigation"
    if (url.startsWith("intent:")) {
      logRequest("BLOCK", "NAV:intent-scheme", targetHost, navDest, url)
      return true
    }

    // P0: Session-locked allowlist (replaces userInitiatedNavigation flag).
    if (request.isForMainFrame) {
      val (root, allowed) = synchronized(this@PlayerWebViewOverlayView.sessionLock) {
        this@PlayerWebViewOverlayView.lockedRootHost to this@PlayerWebViewOverlayView.lockedAllowedHosts
      }
      if (root != null && targetHost !in allowed) {
        logRequest("BLOCK", "NAV:hijack-allowlist", targetHost, navDest, url)
        android.util.Log.w("PlayerWebView",
          "[AB] HIJACK BLOCK (not in session allowlist): ${url.take(120)}")
        return true
      }
    }

    if (isAdOrTracker(url)) {
      logRequest("BLOCK", "NAV:ad-domain", targetHost, navDest, url)
      android.util.Log.w("PlayerWebView",
        "[AB] NAV BLOCK: ${url.take(120)}")
      return true
    }
    logRequest("ALLOW", "NAV:default", targetHost, navDest, url)
    return false
  }

  private fun interceptRequestForWebView(request: WebResourceRequest?): WebResourceResponse? {
    val url = request?.url?.toString() ?: return null

    // ═══════════════════════════════════════════════════════════════
    // R0b: SESSION-TRUSTED CDN HOST (fastest path — Phase 1)
    // ═══════════════════════════════════════════════════════════════
    // Once a host has been seen serving a recognized video URL (R0 below),
    // all future requests to it bypass EVERY blocking layer. This is O(1)
    // and handles hundreds of .ts segment requests without regex overhead.
    val r0Host = Uri.parse(url).host?.lowercase() ?: ""
    if (isSessionTrustedHost(r0Host)) {
      logRequest("ALLOW", "R0b:session-trust", r0Host, synthesizeSecFetchDest(request), url)
      return null
    }

    // ═══════════════════════════════════════════════════════════════
    // R0: VIDEO MEDIA DETECTION (Regex-based — Phase 1)
    // ═══════════════════════════════════════════════════════════════
    // Detects HLS manifests, DASH manifests, media segments, and DRM keys
    // by matching the path portion (query params stripped) against regex.
    // Path is lowercased first so regex patterns don't need IGNORE_CASE.
    val r0Path = Uri.parse(url).path?.lowercase() ?: ""
    val hasVideoExt = VIDEO_EXTENSION_REGEX.containsMatchIn(r0Path)
    val hasStructPath = VIDEO_PATH_REGEX.containsMatchIn(r0Path)
    val hasBase64Path = BASE64_VIDEO_PATH_REGEX.containsMatchIn(r0Path)
    val hasDisguisedMedia = DISGUISED_MEDIA_REGEX.containsMatchIn(r0Path)
    if (hasVideoExt || hasStructPath || hasBase64Path || hasDisguisedMedia) {
      addSessionTrustedHost(r0Host)
      logRequest("ALLOW", "R0:video-detection", r0Host, synthesizeSecFetchDest(request), url)
      return null
    }

    // Block disable-devtool — Layer 2: Serve a stub script.
    // Providers check for HTTP 200 + typeof disableDevtool === 'function'.
    // Returning empty body breaks providers. Returning a real-shaped stub
    // satisfies the check while the Layer 1 no-op prevents detectors from running.
    if (url.contains("theajack.github.io/disable-devtool")) {
      val isPage = url.contains("404.html")
      logRequest("BLOCK", if (isPage) "REQ:devtool-404" else "REQ:devtool-stub",
        "theajack.github.io", if (isPage) "empty" else "script", url)
      if (isPage) {
        return WebResourceResponse("text/html", "utf-8", 200, "OK",
          mapOf("Cache-Control" to "no-store"),
          ByteArrayInputStream(ByteArray(0)))
      }
      // Stub body — sized ~4KB to defeat naive length checks.
      // Re-asserts the no-op + installs redirect guards as defense in depth.
      val stub = buildString {
        append("(function(){'use strict';\n")
        append("var noop=function(o){return{close:function(){},isRunning:function(){return false;}}};\n")
        append("noop.close=function(){};noop.isRunning=function(){return false;};\n")
        append("noop.version='0.0.0';\n")
        append("try{Object.defineProperty(window,'disableDevtool',{value:noop,writable:false,configurable:false,enumerable:true});}catch(e){window.disableDevtool=noop;}\n")
        // Pad to ~4KB to defeat naive length checks
        repeat(4000) { append(" ") }
        append("})();\n")
      }.toByteArray(Charsets.UTF_8)
      return WebResourceResponse("application/javascript", "utf-8", 200, "OK",
        mapOf("Content-Type" to "application/javascript; charset=utf-8",
              "Content-Length" to stub.size.toString(),
              "Cache-Control" to "no-cache, no-store, must-revalidate"),
        ByteArrayInputStream(stub))
    }

    val host = Uri.parse(url).host?.lowercase() ?: return null
    val dest = synthesizeSecFetchDest(request)

    trackRequestIfAuditing(url, request)

    val headers = request.requestHeaders ?: emptyMap()
    val currentHost = currentUrl?.let { Uri.parse(it) }?.host?.lowercase() ?: ""

    // ═══════════════════════════════════════════════════════════════
    // P0: CROSS-PROVIDER POLICY CHECK
    // ═══════════════════════════════════════════════════════════════
    val (lockedRoot, lockedAllowed) = synchronized(this@PlayerWebViewOverlayView.sessionLock) {
        this@PlayerWebViewOverlayView.lockedRootHost to this@PlayerWebViewOverlayView.lockedAllowedHosts
    }
    if (lockedRoot != null) {
        val normalHost = host.removePrefix("www.")
        if (!request.isForMainFrame && normalHost in effectiveProviderRootHosts && normalHost !in lockedAllowed) {
            if (looksLikeDocumentLoad(request)) {
                logRequest("BLOCK", "P0:cross-provider-doc", host, dest, url)
                return emptyDocumentResponse()
            }
            logRequest("BLOCK", "P0:cross-provider-resource", host, dest, url)
            return emptyResourceResponse()
        }
        if (request.isForMainFrame && normalHost !in lockedAllowed) {
            logRequest("BLOCK", "P0:cross-provider-main", host, dest, url)
            return emptyDocumentResponse()
        }
    }

    // ── Remote config blocked domains ──
    if (effectiveBlockedDomains.any { host.contains(it) }) {
        logRequest("BLOCK", "REMOTE:blocked-domain", host, dest, url)
        return WebResourceResponse("text/plain", "utf-8",
            ByteArrayInputStream(ByteArray(0)))
    }

    // ── HTML Response Interception (disable-devtool defense) ──
    // For main-frame document loads from provider domains, fetch the HTML
    // and prepend our JS blocker at the TOP. This guarantees our code runs
    // BEFORE any inline <script> blocks, solving the timing issue where
    // addDocumentStartJavaScript doesn't execute before inline scripts.
    //
    // ALSO strips disable-devtool script tags from the HTML so the library
    // never loads — nuclear option for providers that bundle the library.
    if (request.isForMainFrame && dest == "document" && host in effectiveProviderRootHosts) {
        try {
            val conn = URL(url).openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            // Copy WebView's User-Agent and Cookies for auth
            currentWebView?.settings?.userAgentString?.let {
                conn.setRequestProperty("User-Agent", it)
            }
            val cookie = CookieManager.getInstance().getCookie(url)
            if (!cookie.isNullOrEmpty()) {
                conn.setRequestProperty("Cookie", cookie)
            }
            conn.connect()
            val responseCode = conn.responseCode
            if (responseCode == 200) {
                val contentType = conn.contentType ?: ""
                if (contentType.contains("text/html")) {
                    var html = conn.inputStream.bufferedReader().use { it.readText() }

                    // ── Strip disable-devtool scripts from HTML ──
                    // Remove external <script src="...disable-devtool...">
                    html = html.replace(
                        Regex("<script\\s+[^>]*src\\s*=\\s*[\"'][^\"']*(?:theajack|disable.?dev)[^\"']*[\"'][^>]*>\\s*</script>",
                            RegexOption.IGNORE_CASE),
                        "<!-- stripped: disable-devtool -->"
                    )
                    // Remove inline <script> containing disable-devtool code
                    html = html.replace(
                        Regex("<script[^>]*>[^<]*(?:theajack\\.github|disable.?devtool|disableDevtool|closeWindow|defineIdDetector)[^<]*</script>",
                            RegexOption.IGNORE_CASE),
                        "<!-- stripped: disable-devtool inline -->"
                    )
                    // Remove disable-devtool via CDN (jsdelivr, unpkg, cdnjs)
                    html = html.replace(
                        Regex("<script\\s+[^>]*src\\s*=\\s*[\"'][^\"']*(?:jsdelivr\\.net|unpkg\\.com|cdnjs\\.cloudflare\\.com)[^\"']*/(?:npm/)?disable[.-]devtool[^\"']*[\"'][^>]*>\\s*</script>",
                            RegexOption.IGNORE_CASE),
                        "<!-- stripped: disable-devtool-cdn -->"
                    )

                    // Prepend our JS blocker at the very top of the HTML
                    val finalHtml = "<script>" + DEVTOOT_REDIRECT_BLOCKER + "</script>" + html
                    val responseHeaders = mutableMapOf<String, String>()
                    conn.headerFields.forEach { (key, values) ->
                        if (key != null && values.isNotEmpty() &&
                            !key.equals("Content-Length", true) &&
                            !key.equals("Content-Encoding", true)) {
                            responseHeaders[key] = values.joinToString("; ")
                        }
                    }
                    responseHeaders["Content-Length"] = finalHtml.toByteArray().size.toString()
                    logRequest("INJECT", "html:devtool-strip+blocker", host, dest, url)
                    return WebResourceResponse("text/html", "utf-8", 200, "OK",
                        responseHeaders, ByteArrayInputStream(finalHtml.toByteArray()))
                }
            }
            conn.disconnect()
        } catch (e: Exception) {
            android.util.Log.w("PlayerWebView", "HTML intercept failed: ${e.message}")
        }
    }

    // ── Child Frame Bridge Injection ──
    val secFetchDest = synthesizeSecFetchDest(request)
    val isCrossOrigin = currentHost.isNotEmpty() && host != currentHost
    if (isCrossOrigin && !isAdOrTracker(host) &&
      secFetchDest == "iframe") {
      val injected = injectBridgeIntoHtml(url)
      if (injected != null) {
        logRequest("INJECT", "bridge:child-frame", host, dest, url)
        android.util.Log.d("PlayerWebView",
          "[INJECT] Child frame bridge injected: ${url.take(100)}")
        return injected
      }
    }

    val hasRangeHeader = headers.containsKey("Range")

    // Rule 1: video/audio/range → ALLOW
    if (hasRangeHeader || secFetchDest in setOf("video", "audio")) {
      logRequest("ALLOW", "R1:media/range", host, dest, url)
      return null
    }

    // workers.dev strict partitioning
    if (host.endsWith("workers.dev")) {
      // Allow workers.dev domains that match known CDN patterns (e.g., vidnees)
      if (effectiveAllowedCdnHosts.any { host.contains(it) }) {
        logRequest("ALLOW", "WDEV:cdn-match", host, dest, url)
        return null
      }
      val path = Uri.parse(url).path?.lowercase() ?: ""
      if (secFetchDest == "empty" &&
        videoExtensions.any { path.contains(it) }) {
        logRequest("ALLOW", "WDEV:media-ext", host, dest, url)
        return null
      }
      logRequest("BLOCK", "WDEV:non-media", host, dest, url)
      android.util.Log.w("PlayerWebView",
        "[AB] WORKERS.DEV BLOCK ($secFetchDest): ${url.take(120)}")
      return WebResourceResponse("text/plain", "utf-8",
        ByteArrayInputStream(ByteArray(0)))
    }

    // Rule 2: CDN allowlist → ALLOW
    if (effectiveAllowedCdnHosts.any { host.contains(it) }) {
      logRequest("ALLOW", "R2:cdn-allowlist", host, dest, url)
      return null
    }

    // Rule 3: Current provider domain → ALLOW
    if (currentHost.isNotEmpty() && host.endsWith(".$currentHost")) {
      logRequest("ALLOW", "R3:prov-subdomain", host, dest, url)
      return null
    }
    if (currentHost.isNotEmpty() && host == currentHost) {
      logRequest("ALLOW", "R3:prov-exact", host, dest, url)
      return null
    }

    // ADBLOCK DISABLED — skip native adblock for this provider
    // Controlled by blocklist.json providers[].adblockDisabled.
    // When set, the provider's embed requests bypass ALL blocking rules
    // (AdblockEngine, heuristic, profile, domain/path blocklists) and
    // go straight to default-allow. Use for providers whose video delivery
    // infrastructure overlaps with ad/tracker domains.
    if (isCurrentProviderAdblockDisabled) {
      logRequest("ALLOW", "ADBLOCK_DISABLED:provider-override", host, dest, url)
      return null
    }

    // ADBLOCK ENGINE
    if (adblockEngine.shouldBlock(url, host)) {
      logRequest("BLOCK", "ADBLOCK_ENGINE", host, dest, url)
      android.util.Log.w("PlayerWebView",
        "[AB] ADBLOCK ENGINE BLOCK: ${url.take(120)}")
      return WebResourceResponse("text/plain", "utf-8",
        ByteArrayInputStream(ByteArray(0)))
    }

    // Rule 4: Heuristic blocking
    if (secFetchDest in setOf("iframe", "script", "image")) {
      val referer = headers["Referer"]?.lowercase()
      val isRefererMatching = referer?.contains(currentHost) == true
      val isProviderReferer = currentHost.isEmpty() || isRefererMatching

      if (isProviderReferer && host != currentHost && !host.contains("google")) {
        if (host.contains("google") || host.contains("gstatic")) {
          logRequest("ALLOW", "R3b:google-safe", host, dest, url)
          return null
        }
        logRequest("BLOCK", "R4:heuristic", host, dest, url)
        android.util.Log.w("PlayerWebView",
          "[AB] HEURISTIC BLOCK ($secFetchDest): ${url.take(120)}")
        return WebResourceResponse("text/plain", "utf-8",
          ByteArrayInputStream(ByteArray(0)))
      }
    }

    // Rule 5: Per-provider profile blocking
    if (currentHost.isNotEmpty()) {
      val profile = providerProfiles.entries.firstOrNull { (key, _) ->
        currentHost.contains(key) || key.contains(currentHost)
      }
      if (profile != null) {
        val allowedHosts = profile.value
        if (secFetchDest in setOf("script", "iframe", "image")) {
          if (!host.contains("google") && !host.contains("gstatic")) {
            val isAllowed = allowedHosts.any { host.contains(it) }
            if (!isAllowed) {
              logRequest("BLOCK", "R5:profile-resource", host, dest, url)
              android.util.Log.w("PlayerWebView",
                "[AB] PROFILE BLOCK ($secFetchDest): ${url.take(120)}")
              return WebResourceResponse("text/plain", "utf-8",
                ByteArrayInputStream(ByteArray(0)))
            }
          }
        }
        if (secFetchDest == "document" && host != currentHost) {
          val isAllowed = allowedHosts.any { host.contains(it) }
          if (!isAllowed) {
            logRequest("BLOCK", "R5:profile-docnav", host, dest, url)
            android.util.Log.w("PlayerWebView",
              "[AB] PROFILE BLOCK (doc nav): ${url.take(120)}")
            return WebResourceResponse("text/plain", "utf-8",
              ByteArrayInputStream(ByteArray(0)))
          }
        }
      }
    }

    // Rule 6: Domain blocklist
    if (adDomains.any { host.contains(it) }) {
      logRequest("BLOCK", "R6:domain-blocklist", host, dest, url)
      android.util.Log.w("PlayerWebView",
        "[AB] DOMAIN BLOCK: ${url.take(120)}")
      return WebResourceResponse("text/plain", "utf-8",
        ByteArrayInputStream(ByteArray(0)))
    }

    // Rule 7: Path-based blocking
    if (currentHost.isNotEmpty() && host == currentHost) {
      val path = Uri.parse(url).path ?: ""
      if (adPathPatterns.any { path.contains(it) }) {
        logRequest("BLOCK", "R7:path-blocklist", host, dest, url)
        android.util.Log.w("PlayerWebView",
          "[AB] PATH BLOCK: ${url.take(120)}")
        return WebResourceResponse("text/plain", "utf-8",
          ByteArrayInputStream(ByteArray(0)))
      }
    }

    logRequest("ALLOW", "R8:default-allow", host, dest, url)
    return null
  }

  // ── Double-Buffer: Destroy & Recreate ──

  /**
   * Destroy a WebView completely — nukes its entire storage context,
   * renderer process state, and JS globals. This is the only way to
   * guarantee a clean slate for the next provider.
   */
  private fun destroyWebViewCompletely(wv: WebView) {
    wv.onPause()
    wv.loadUrl("about:blank")
    wv.visibility = View.GONE
    val parent = wv.parent as? ViewGroup
    parent?.removeView(wv)
    try { wv.javaClass.getMethod("setWebViewClient", android.webkit.WebViewClient::class.java).invoke(wv, null) } catch (_: Exception) {}
    try { wv.javaClass.getMethod("setWebChromeClient", android.webkit.WebChromeClient::class.java).invoke(wv, null) } catch (_: Exception) {}
    wv.removeJavascriptInterface("ReactNativeWebView")
    wv.destroy()
  }

  /**
   * Switch to a new provider URL using double-buffering.
   *
   * Creates a new invisible WebView in the background and starts loading
   * the new URL. The old WebView stays visible while loading. When the new
   * page finishes loading (or after SWAP_TIMEOUT_MS), we swap instantly
   * and destroy the old WebView.
   *
   * This eliminates state-leakage bugs between providers (stale cookies,
   * IndexedDB, addDocumentStartJavaScript registrations, JS globals)
   * because each provider gets a brand-new WebView.
   */
  fun switchProvider(url: String) {
    val act = appContext.currentActivity ?: return
    if (isSwapping) {
      // Rapid switch — cancel pending swap, destroy incoming, start fresh
      incomingWebView?.let { destroyWebViewCompletely(it) }
      incomingWebView = null
      isSwapping = false
    }

    // 1. Create new WebView INVISIBLE
    val newWv = WebView(act)
    newWv.visibility = View.INVISIBLE
    incomingWebView = newWv
    isSwapping = true

    // 2. Apply settings, clients, JS interface
    applyWebViewSettings(newWv)
    newWv.webViewClient = makeSwapWebViewClient(newWv)
    newWv.webChromeClient = makeWebChromeClient(newWv)
    newWv.addJavascriptInterface(JsBridgeInterface(), "ReactNativeWebView")

    // 3. Apply guard scripts
    WebViewCompat.addDocumentStartJavaScript(newWv, DEVTOOT_REDIRECT_BLOCKER, setOf("*"))
    if (injectedScript.isNotEmpty()) {
      WebViewCompat.addDocumentStartJavaScript(newWv, injectedScript, setOf("*"))
    }

    // 4. Add to Activity root (behind current — INVISIBLE)
    val rootContent = act.findViewById<ViewGroup>(android.R.id.content)
    rootContent.addView(newWv)
    // Position it at same location as current, but use ANCHOR dimensions
    // (currentWebView may have stale dimensions from before React Native layout pass)
    currentWebView?.let { cur ->
      newWv.x = cur.x; newWv.y = cur.y
    }
    val lp = newWv.layoutParams
    if (lp != null) {
      // Use anchor view's current dimensions (updated by RN layout)
      lp.width = width.coerceAtLeast(1)
      lp.height = height.coerceAtLeast(1)
      newWv.layoutParams = lp
    }

    // 5. Start loading
    currentUrl = url
    isLoading = true
    if (referrer.isNotEmpty()) {
      newWv.loadUrl(url, mapOf("Referer" to referrer))
    } else {
      newWv.loadUrl(url)
    }

    // 6. Safety timeout — force swap after SWAP_TIMEOUT_MS
    swapHandler.removeCallbacks(swapRunnable)
    swapHandler.postDelayed(swapRunnable, SWAP_TIMEOUT_MS)

    dispatchEvent("onLoadingStart") { putString("url", url) }
    logRequest("SWITCH", "double-buffer", Uri.parse(url).host ?: "", "navigation", url)
    android.util.Log.d("PlayerWebView",
      "OVERLAY switchProvider url=${url.take(80)} hasScript=${injectedScript.isNotEmpty()}")
  }

  /**
   * Complete the double-buffer swap: make the incoming WebView visible,
   * destroy the old one.
   */
  private fun swapViews() {
    if (!isSwapping) return
    swapHandler.removeCallbacks(swapRunnable)
    isSwapping = false

    val incoming = incomingWebView ?: return
    val old = currentWebView

    // Make incoming visible
    incoming.visibility = View.VISIBLE
    incoming.bringToFront()

    // Promote BEFORE syncWebViewFrame so the incoming WebView gets
    // the correct container dimensions. The old WebView was created
    // with outdated (nxsha) dimensions in switchProvider() because the
    // React Native layout pass hadn't run yet; syncWebViewFrame updates
    // currentWebView's dimensions to match the current container size.
    currentWebView = incoming
    syncWebViewFrame()

    // Destroy old WebView completely
    old?.let { destroyWebViewCompletely(it) }

    incomingWebView = null

    isLoading = false
    dispatchEvent("onLoadingFinish") { putString("url", currentUrl ?: "") }

    android.util.Log.d("PlayerWebView",
      "OVERLAY swapViews complete url=${currentUrl?.take(80)}")
  }

  // ── Double-Buffer: Destroy & Recreate ──

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
    if (currentWebView != null) return
    warmDnsCache()
    val act = appContext.currentActivity ?: run {
      android.util.Log.e("PlayerWebView", "OVERLAY: No activity — cannot create WebView")
      return
    }
    WebView.setWebContentsDebuggingEnabled(true)
    warmupRenderer(act)
    val cfg = BlocklistConfigLoader.config
    if (cfg.version > 0) applyRemoteConfig(cfg)
    val anchorId = System.identityHashCode(this)

    val wv = WebView(act)
    android.util.Log.d("PlayerWebView",
      "OVERLAY CREATED new WebView anchor=$anchorId")

    applyWebViewSettings(wv)
    wv.webViewClient = makeWebViewClient(wv)
    wv.webChromeClient = makeWebChromeClient(wv)
    wv.addJavascriptInterface(JsBridgeInterface(), "ReactNativeWebView")

    currentWebView = wv
    userAgent?.let { wv.settings.userAgentString = it }
    if (supportMultipleWindows) wv.settings.setSupportMultipleWindows(true)
    if (javaScriptCanOpenWindowsAutomatically) wv.settings.javaScriptCanOpenWindowsAutomatically = true

    // Inject disable-devtool redirect blocker into MAIN FRAME
    WebViewCompat.addDocumentStartJavaScript(wv, DEVTOOT_REDIRECT_BLOCKER, setOf("*"))

    if (injectedScript.isNotEmpty()) {
      android.util.Log.d("PlayerWebView",
        "OVERLAY INJECTING SCRIPT length=${injectedScript.length} start=${injectedScript.take(120).replace('\n', ' ')}")
      WebViewCompat.addDocumentStartJavaScript(wv, injectedScript, setOf("*"))
    } else {
      android.util.Log.w("PlayerWebView", "OVERLAY INJECTING SCRIPT SKIPPED — script is empty")
    }

    val rootContent = act.findViewById<ViewGroup>(android.R.id.content)
    rootContent.addView(wv)

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
    val wv = currentWebView ?: return
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
    val wv = currentWebView
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
    android.util.Log.d("PlayerWebView", "OVERLAY loadUrl url=${url.take(80)}")
    if (referrer.isNotEmpty()) {
      wv.loadUrl(url, mapOf("Referer" to referrer))
    } else {
      wv.loadUrl(url)
    }
  }

  /**
   * P0: Load a provider URL and lock the session allowlist (expert review).
   *
   * Computes the set of ALLOWED hosts from the URL's root host, the
   * provider profile, and the global CDN allowlist. Any navigation or
   * resource request to a host outside this set is blocked as a cross-
   * provider hijack. Call this instead of loadUrl() whenever the React
   * layer selects a new provider.
   *
   * Thread-safe via sessionLock — called from the main thread (React prop
   * setters) but the allowlist is read from WebViewClient callbacks that
   * may run on WebView's internal thread pool.
   */
  fun loadProviderUrl(url: String) {
    // Clear session trust for the new provider
    clearSessionTrust()
    val host = Uri.parse(url).host?.lowercase()
    if (host != null) {
      synchronized(sessionLock) {
        lockedRootHost = host
        // Compute allowed set: profile hosts (including CDNs) + root host + global CDNs
        val profile = effectiveProviderProfiles.entries.firstOrNull { (key, _) ->
          host.contains(key) || key.contains(host)
        }?.value ?: emptySet()
        lockedAllowedHosts = (profile + host + effectiveAllowedCdnHosts).toSet()
      }
      android.util.Log.d("PlayerWebView",
        "OVERLAY loadProviderUrl host=$host allowedSize=${lockedAllowedHosts.size}")
    }
    loadUrl(url)
  }

  fun reload() {
    currentWebView?.post { currentWebView?.reload() }
  }

  fun stop() {
    currentWebView?.post { currentWebView?.stopLoading() }
  }

  // ── Props ─────────────────────────────────────────────────────────

  var sourceUri: String = ""
    set(value) {
      if (value == field || value.isEmpty()) return
      field = value
      // Clear session trust for the new provider
      clearSessionTrust()
      android.util.Log.d("PlayerWebView",
        "OVERLAY sourceUri SET anchor=${System.identityHashCode(this)} url=${value.take(60)}")
      // Lock session allowlist for the new provider
      val host = Uri.parse(value).host?.lowercase()
      if (host != null) {
        synchronized(sessionLock) {
          lockedRootHost = host
          val profile = effectiveProviderProfiles.entries.firstOrNull { (key, _) ->
            host.contains(key) || key.contains(host)
          }?.value ?: emptySet()
          lockedAllowedHosts = (profile + host + effectiveAllowedCdnHosts).toSet()
        }
      }
      if (currentWebView != null && isOverlayAttached) {
        switchProvider(value)  // Double-buffer switch — destroy old, create new
      } else {
        // First load — will be flushed in ensureWebView()
        pendingLoadUrl = value
      }
    }

  var injectedJavaScript_: String = ""
    set(value) {
      field = value
      if (value.isNotEmpty() && value != lastInjectedJS) {
        lastInjectedJS = value
        currentWebView?.evaluateJavascript(value, null)
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

  // ── P0: Cross-provider document detection helpers (expert review) ──

  /**
   * Detect whether a resource request is loading a document (HTML page)
   * rather than a subresource (script, style, fetch, media). Uses multiple
   * signals since Sec-Fetch-Dest is unreliable on Android WebView.
   */
  private fun looksLikeDocumentLoad(request: WebResourceRequest): Boolean {
    val accept = request.requestHeaders?.get("Accept") ?: ""
    if (accept.contains("text/html") || accept.contains("xhtml")) return true
    val url = request.url.toString()
    if (url.endsWith(".html", true) || url.endsWith(".htm", true)) return true
    if (url.indexOf('?') < 0 && request.requestHeaders?.get("Sec-Fetch-Dest") == "iframe") return true
    val path = request.url.path ?: ""
    if (path.isNotEmpty() && path.indexOf('.') < 0 && accept.isEmpty()) return true
    return false
  }

  /**
   * P1: Synthesize Sec-Fetch-Dest header when the real header is null.
   *
   * Android WebView often omits Sec-Fetch-Dest for iframe loads, redirects,
   * and requests from older Chromium builds. Without this header, the R4/R5
   * heuristic blocking rules are skipped entirely, allowing cross-provider
   * iframe documents to load unchecked.
   *
   * This polyfill examines Accept header, URL patterns, and request type
   * to produce a reliable value. The default is "empty" (non-document
   * subresource) which is the safe fallback — it can only ADD blocks,
   * never remove them.
   */
  private fun synthesizeSecFetchDest(request: WebResourceRequest): String {
    val raw = request.requestHeaders?.get("Sec-Fetch-Dest")?.lowercase()
    if (raw != null && raw != "unknown") return raw
    if (request.isForMainFrame) return "document"
    val accept = request.requestHeaders?.get("Accept") ?: ""
    if (accept.contains("text/html") || accept.contains("xhtml")) return "iframe"
    val path = request.url.path?.lowercase() ?: ""
    if (path.endsWith(".js")) return "script"
    if (path.endsWith(".css")) return "style"
    if (path.endsWith(".html") || path.endsWith(".htm")) return "iframe"
    return "empty"
  }

  /** Empty 200 OK HTML document — prevents iframe rendering without error signals. */
  private fun emptyDocumentResponse(): WebResourceResponse =
    WebResourceResponse("text/html", "utf-8", 200, "OK",
      mapOf("Cache-Control" to "no-store", "Content-Length" to "0"),
      ByteArrayInputStream(ByteArray(0)))

  /** Empty 200 OK opaque response — blocks subresource loads silently. */
  private fun emptyResourceResponse(): WebResourceResponse =
    WebResourceResponse("application/octet-stream", null, 200, "OK",
      mapOf("Cache-Control" to "no-store", "Content-Length" to "0"),
      ByteArrayInputStream(ByteArray(0)))

  private fun isAdOrTracker(url: String): Boolean {
    val uri = Uri.parse(url)
    val host = uri.host?.lowercase() ?: return false

    // 1. Never block known video CDNs
    if (effectiveAllowedCdnHosts.any { host.contains(it) }) return false

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
      conn.connectTimeout = 2000       // 2s connect (down from 10s — iframe should respond fast)
      conn.readTimeout = 2000           // 2s read (down from 10s — don't stall video pipeline)
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

      // ── Contextual cosmetic CSS injection ──
      // Fetch only the selectors matching this iframe's domain (not all 17k
      // globally). Per expert recommendation, inject natively as a <style>
      // tag in the HTML so Blink renders it before any paint, avoiding FOUC.
      val cosmeticSelectors = try {
        val iframeHost = urlObj.host?.lowercase() ?: ""
        adblockEngine.getCosmeticSelectors(iframeHost)
      } catch (_: Exception) { emptyList() }
      val cssSnippet = if (cosmeticSelectors.isNotEmpty()) {
        val css = cosmeticSelectors.joinToString(" ") { "$it{display:none!important}" }
        "<style id=\"fs-adblock-css\">$css</style>"
      } else {
        ""
      }

      val bridgeSnippet = BRIDGE_SCRIPT_SNIPPET
      val injectionSnippet = "$cssSnippet${bridgeSnippet}"

      // Inject the bridge script + cosmetic CSS right after <head>
      // (handles both <head> and <head ...>)
      val headEndTag = "</head>"
      val modifiedHtml = if (html.contains(headEndTag, ignoreCase = true)) {
        html.replaceFirst(
          Regex("</head>", RegexOption.IGNORE_CASE),
          "$injectionSnippet</head>"
        )
      } else {
        // No head tag — inject before </html> or append
        val htmlEndTag = "</html>"
        if (html.contains(htmlEndTag, ignoreCase = true)) {
          html.replaceFirst(
            Regex("</html>", RegexOption.IGNORE_CASE),
            "$injectionSnippet</html>"
          )
        } else {
          html + injectionSnippet
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
    } catch (e: java.net.SocketTimeoutException) {
      android.util.Log.w("PlayerWebView",
        "[INJECT] TIMEOUT (${e.message}): ${url.take(80)} — falling back to raw HTML")
      return null // Timeout — let WebView fetch original HTML natively
    } catch (e: java.io.IOException) {
      android.util.Log.w("PlayerWebView",
        "[INJECT] IO ERROR (${e.message}): ${url.take(80)} — falling back to raw HTML")
      return null // IO error — don't stall video pipeline
    } catch (e: Exception) {
      android.util.Log.w("PlayerWebView",
        "[INJECT] FAILED (${e.message}): ${url.take(80)} — falling back to raw HTML")
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
    val wv = currentWebView
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
      try {
        val obj = org.json.JSONObject(message)
        if (obj.optString("type") == "__player:dumpRequestLog") {
          val logDump = dumpRequestLog()
          android.util.Log.d("ReqLog", "Dump requested via JS bridge:\n$logDump")
          // Send dump back via console.log so it appears in Metro terminal
          val escaped = logDump.replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
          val wv = currentWebView
          if (wv != null) {
            wv.evaluateJavascript(
              "console.log('=== ReqLog Dump ===\\n$escaped\\n=== End ReqLog Dump ===')",
              null
            )
          }
          return
        }
      } catch (_: Exception) {}
      dispatchEvent("onMessage") { putString("data", message) }
    }
  }
}
