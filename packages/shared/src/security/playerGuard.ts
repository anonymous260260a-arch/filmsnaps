/**
 * Player Guard Script — 15-layer popup/ad-blocking JavaScript.
 *
 * This is a PURE FUNCTION — no React, no platform imports.
 * It returns the JavaScript string to inject into a WebView or iframe.
 *
 * Platform wrappers handle injection method:
 *   - Web (SecureIframe):    srcdoc / sandbox attributes
 *   - Mobile (SecureWebView): react-native-webview injectedJavaScript prop
 *
 * @param providerHostname - The provider's hostname for referrer spoofing
 * @returns A self-executing JS string to inject into the player page
 */

import { buildAllScriptlets, getProviderScriptlets } from './scriptlets';

// ── Default ad/tracker patterns (fallback when no config injected) ──
//
// These cover the most common ad/tracker domains from EasyList that are
// unlikely to ever serve video content. When the WebView injects
// window.__FILMSNAPS_CONFIG__, these are replaced with the live
// blocklist.json rules.alwaysBlock.domains.
//
// The DOM sweeper layer also includes its own focused subset for the
// aggressive fixed-position overlay removal it performs.

export const DEFAULT_AD_FULL_PATTERNS = [
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
  'google-analytics.com', 'googletagmanager.com', 'gtag/js',
  'pagead2.googlesyndication.com', 'adnxs.com', 'rubiconproject.com',
  'criteo.com', 'criteo.net', 'outbrain.com', 'taboola.com',
  'revcontent.com', 'adsystem.', 'adserver.', 'ads.',
  'popads.', 'popcash.', 'popunder.', 'adsterra.com',
  'propellerads.com', 'trafficfactory.biz',
  'pixel.', 'track.', 'tracking.', 'beacon.',
  'histats.com', 'statcounter.com', 'scorecardresearch.com',
  'amazon-adsystem.com', 'casalemedia.com', 'contextweb.com',
  'openx.net', 'pubmatic.com', 'sharethrough.com',
  'media.net', 'advertising.com', 'adap.tv',
  'moatads.com', 'servedby.', 'exdynsrv.com',
  'exoclick.com', 'juicyads.com', 'plugrush.com',
  'trafficjunky.com', 'adreactor.com', 'adcash.com',
  'adhitz.com', 'adk2.com', 'adpierce.com',
  'clickadu.com', 'clicksco.net', 'hilltopads.com',
  'interlinecustomroofingllc.com', '1xlite',
  'riverlayboy.shop', 'hai8g.com',
  'zoaclachan.cyou', 'florian.sorrilylivyershape.cyou',
  'ag.phrymaphytic.com', 'my.rtmark.net',
  's.click.aliexpress.com', 'developdomicile.com',
  'cloudflareinsights.com', 'frowstyambler', 'qpon',
  'go.', 'click.', 'adx.', 'adv.', 'banner.',
  'traffic.', 'redirect.', 'redirecting.',
  'bestchange', 'best-',
];

export const DEFAULT_AD_SHORT_PATTERNS = [
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
  'google-analytics.com', 'googletagmanager.com', 'gtag/js',
  'pagead2.googlesyndication.com', 'adnxs.com', 'popads.', 'popcash.',
  'popunder.', 'adsterra.com', 'exoclick.com', 'juicyads.com',
  'plugrush.com', 'adcash.com', 'clickadu.com',
  'frowstyambler', 'zoaclachan', 'riverlayboy', 'hai8g',
  'developdomicile', 'cloudflareinsights',
];

export function buildGuardScript(
  providerHostname: string,
  blockedDomains?: string[],
): string {
  const fullPatterns = blockedDomains ?? DEFAULT_AD_FULL_PATTERNS;
  const shortPatterns = blockedDomains ?? DEFAULT_AD_SHORT_PATTERNS;
  const patternsJson = JSON.stringify(fullPatterns);
  const shortPatternsJson = JSON.stringify(shortPatterns);

  return `
(function() {
  // ── Injected ad/tracker domain patterns (from blocklist.json or default) ──
  var BLOCKED_DOMAINS = ${patternsJson};
  var BLOCKED_DOMAINS_SHORT = ${shortPatternsJson};

  // ── Native function masking helper (anti-anti-adblock) ──
  // Providers detect monkey-patched APIs by checking toString():
  //   window.fetch.toString() !== 'function fetch() { [native code] }'
  // This helper wraps any override to lie about its toString() output.
  //
  // Also tags the function with a hidden _fsNativeStr property so the
  // Function.prototype.toString override below works for the more
  // sophisticated Function.prototype.toString.call(fetch) bypass.
  function _maskFn(fn, nativeStr) {
    fn.toString = function() { return nativeStr; };
    fn.toString.toString = function() { return 'function toString() { [native code] }'; };
    // Tag with hidden property for Function.prototype.toString.call() defense.
    // This defeats providers using:
    //   Function.prototype.toString.call(window.fetch)  // bypasses fn.toString()
    try { Object.defineProperty(fn, '_fsNativeStr', { value: nativeStr, enumerable: false, configurable: false }); } catch(e) {}
    return fn;
  }

  // ── Global Function.prototype.toString override (anti-anti-adblock) ──
  // Sophisticated anti-adblock scripts (AdShield, BlockAdBlock) bypass
  // per-function fn.toString() overrides by using:
  //   Function.prototype.toString.call(window.fetch)
  // This reads the ACTUAL function source, defeating our _maskFn.
  //
  // Our override intercepts ALL Function.prototype.toString calls and,
  // if 'this' has a _fsNativeStr property (set by _maskFn), returns
  // the spoofed native string instead of the real source.
  (function() {
    var _origFuncToString = Function.prototype.toString;
    Function.prototype.toString = _maskFn(function toString() {
      if (this && this._fsNativeStr) return this._fsNativeStr;
      return _origFuncToString.call(this);
    }, 'function toString() { [native code] }');
  })();

  // ── Popup blocking (Layer 1) ──
  // Override window.open with smart filtering — allow same-origin, block ad domains.
  (function() {
    var _origOpen = window.open;
    window.open = _maskFn(function(url, name, features) {
      if (url && typeof url === 'string') {
        try {
          var u = new URL(url, location.href);
          if (u.hostname !== location.hostname) {
            var l = u.href.toLowerCase();
            var AD_PATTERNS = BLOCKED_DOMAINS;
            for (var i = 0; i < AD_PATTERNS.length; i++) {
              if (l.indexOf(AD_PATTERNS[i]) !== -1) {
                try { return new Proxy({}, {get:function(){return function(){return null}}}); } catch(e){ return null; }
              }
            }
          }
        } catch(e) {}
      }
      try { return _origOpen.apply(window, arguments); } catch(e) { return null; }
    }, 'function open() { [native code] }');
  })();

  // ── Ad / tracker network blocklist (Layer 2) ──
  (function() {
    var AD_PATTERNS = BLOCKED_DOMAINS;
    function isAdUrl(url) {
      if (!url || typeof url !== 'string') return false;
      var l = url.toLowerCase();
      for (var i = 0; i < AD_PATTERNS.length; i++) {
        if (l.indexOf(AD_PATTERNS[i]) !== -1) return true;
      }
      return false;
    }
    // Intercept fetch
    try {
      var _fetch = window.fetch;
      window.fetch = _maskFn(function(input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (isAdUrl(url)) return Promise.resolve(new Response('', {status: 204}));
        return _fetch.call(window, input, init);
      }, 'function fetch() { [native code] }');
    } catch(e) {}
    // Intercept XHR
    try {
      var _xhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = _maskFn(function(method, url) {
        if (isAdUrl(url)) { this._aborted = true; return; }
        return _xhrOpen.apply(this, arguments);
      }, 'function open() { [native code] }');
      var _xhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function() {
        if (this._aborted) return;
        return _xhrSend.apply(this, arguments);
      };
    } catch(e) {}
  })();

  // ── DOM mutation sweeper (Layer 3) ──
  (function() {
    var AD_PATTERNS = BLOCKED_DOMAINS_SHORT;
    function isAdUrl(url) {
      if (!url || typeof url !== 'string') return false;
      var l = url.toLowerCase();
      for (var i = 0; i < AD_PATTERNS.length; i++) {
        if (l.indexOf(AD_PATTERNS[i]) !== -1) return true;
      }
      return false;
    }
    function _domInit() {
      try {
        var _adTimer = null;
        var obs = new MutationObserver(function(muts) {
          obs.disconnect();
          clearTimeout(_adTimer);
          _adTimer = setTimeout(function() {
            try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}
          }, 3000);
          for (var i = 0; i < muts.length; i++) {
            for (var j = 0; j < muts[i].addedNodes.length; j++) {
              var n = muts[i].addedNodes[j];
              if (n.nodeType !== 1) continue;
              if (n.tagName === 'IFRAME') {
                var src = n.getAttribute('src') || n.src || '';
                if (isAdUrl(src)) { n.remove(); continue; }
              }
              if (n.tagName === 'DIV' || n.tagName === 'SECTION' || n.tagName === 'ASIDE') {
                try {
                  var cs = window.getComputedStyle(n);
                  var zIdx = parseInt(cs.zIndex);
                  if (!isNaN(zIdx) && zIdx > 50 && (cs.position === 'fixed' || cs.position === 'sticky')) {
                    if (!n.querySelector('video, iframe[src*="player"], iframe[src*="embed"]')) {
                      n.style.display = 'none';
                    }
                  }
                } catch(e) {}
              }
            }
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      } catch(e) {}

      function _sweepAds() {
        try {
          var skipTexts = ['skip', 'skip ad', 'close ad', 'continue', 'continue to video'];
          var clickables = document.querySelectorAll('button, a, span, div[role="button"]');
          for (var bi = 0; bi < clickables.length; bi++) {
            var txt = (clickables[bi].textContent || '').trim().toLowerCase();
            if (txt.length > 0 && txt.length < 30) {
              for (var si = 0; si < skipTexts.length; si++) {
                if (txt === skipTexts[si] || txt.indexOf(skipTexts[si]) !== -1) {
                  var cs = window.getComputedStyle(clickables[bi]);
                  if (cs.position === 'fixed' || cs.position === 'sticky' || parseInt(cs.zIndex) > 50) {
                    clickables[bi].click();
                  }
                }
              }
            }
          }
          var allFixed = document.querySelectorAll('div[style*="position: fixed"], div[style*="position:fixed"], section[style*="position: fixed"], section[style*="position:fixed"]');
          for (var fi = 0; fi < allFixed.length; fi++) {
            var fEl = allFixed[fi];
            try {
              var fCs = window.getComputedStyle(fEl);
              var fZ = parseInt(fCs.zIndex);
              if (!isNaN(fZ) && fZ > 50 && (fCs.position === 'fixed' || fCs.position === 'sticky') && !fEl.querySelector('video, iframe[src*="player"], iframe[src*="embed"]')) {
                fEl.style.display = 'none';
              }
            } catch(e) {}
          }
        } catch(e) {}
      }
      _sweepAds();
      try { setInterval(_sweepAds, 3000); } catch(e) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _domInit);
    } else {
      _domInit();
    }
  })();

  // ── Click interception: block navigation to external domains (Layer 4) ──
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || el.href;
        if (href && href.indexOf('#') !== 0 && href.indexOf('javascript:') !== 0) {
          try {
            var u = new URL(href, location.href);
            if (u.hostname !== location.hostname || el.hasAttribute('download')) {
              e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
              return false;
            }
          } catch(err) {}
        }
        break;
      }
      el = el.parentElement;
    }
  }, true);

  // ── Service Worker blocking (Layer 5) ──
  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        for (var i = 0; i < regs.length; i++) regs[i].unregister();
      });
      navigator.serviceWorker.register = function() {
        return Promise.reject(new Error('Blocked'));
      };
    }
  } catch(e) {}

  // ── Block document.write (Layer 6) ──
  try { document.write = function() {}; } catch(e) {}
  try { document.writeln = function() {}; } catch(e) {}

  // ── Cloudflare / bot-detection stealth (Layer 7) ──
  try { Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } }); } catch(e) {}
  try {
    if (!window.chrome) { window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} }; }
  } catch(e) {}
  try { Object.defineProperty(navigator, 'plugins', { get: function() { return [1, 2, 3, 4, 5]; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US', 'en']; }, configurable: true }); } catch(e) {}
  try {
    var _origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = function(params) {
      return params.name === 'notifications'
        ? Promise.resolve({ state: 'denied' })
        : _origQuery(params);
    };
  } catch(e) {}
  try {
    var _getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return _getParam.call(this, param);
    };
  } catch(e) {}

  // ── Devtool redirect blocker (Layer 7b) ──────────────────────────
  // The disable-devtool library (theajack.github.io) detects WebView
  // debug mode and redirects location.href every ~500ms. Our native
  // adblock blocks the actual navigation, but the script keeps firing.
  // This layer intercepts location.replace/assign AND the Location
  // prototype's href setter to silently drop devtool-domain redirects.
  (function() {
    // ── DefineIdDetector neutralization ─────────────────────────
    // The disable-devtool library's define-id.ts creates a div with
    // __defineGetter__('id', callback), then calls console.log(div).
    // Chromium always accesses div.id when serializing a DOM element
    // for console.log — even WITHOUT devtools. Block __defineGetter__
    // for 'id' on elements to prevent this false positive.
    try {
      var _origDefGetter = Object.prototype.__defineGetter__;
      if (typeof _origDefGetter === 'function') {
        Object.defineProperty(Object.prototype, '__defineGetter__', {
          value: function(prop, cb) {
            if (prop === 'id' && this != null && typeof this.tagName === 'string') {
              return;
            }
            return _origDefGetter.call(this, prop, cb);
          },
          writable: true, configurable: true
        });
      }
    } catch(e) {}
    try {
      var _origDefSetter = Object.prototype.__defineSetter__;
      if (typeof _origDefSetter === 'function') {
        Object.defineProperty(Object.prototype, '__defineSetter__', {
          value: function(prop, cb) {
            if (prop === 'id' && this != null && typeof this.tagName === 'string') {
              return;
            }
            return _origDefSetter.call(this, prop, cb);
          },
          writable: true, configurable: true
        });
      }
    } catch(e) {}
    var DEVTOOL_PATTERNS = ['theajack.github.io', 'disable-devtool',
      'devtool', 'devtools', 'devtools-detect'];
    function _isDevtoolUrl(url) {
      if (!url || typeof url !== 'string') return false;
      var l = url.toLowerCase();
      for (var i = 0; i < DEVTOOL_PATTERNS.length; i++) {
        if (l.indexOf(DEVTOOL_PATTERNS[i]) !== -1) return true;
      }
      return false;
    }
    // Override Location.prototype.replace
    try {
      var _origReplace = Location.prototype.replace;
      Location.prototype.replace = _maskFn(function(url) {
        if (_isDevtoolUrl(url)) return null;
        return _origReplace.call(this, url);
      }, 'function replace() { [native code] }');
    } catch(e) {}
    // Override Location.prototype.assign
    try {
      var _origAssign = Location.prototype.assign;
      Location.prototype.assign = _maskFn(function(url) {
        if (_isDevtoolUrl(url)) return null;
        return _origAssign.call(this, url);
      }, 'function assign() { [native code] }');
    } catch(e) {}
    // Override Location.prototype.href setter — catches all
    // location.href = '...' calls at the prototype level.
    try {
      var _hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
      if (_hrefDesc && _hrefDesc.set) {
        Object.defineProperty(Location.prototype, 'href', {
          set: function(val) {
            if (_isDevtoolUrl(val)) return;
            return _hrefDesc.set.call(this, val);
          },
          get: function() { return _hrefDesc.get.call(this); },
          configurable: true
        });
      }
    } catch(e) {}
    // Override Window.prototype.location setter — catches window.location = url
    try {
      var _winLocDesc = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(window), 'location');
      if (_winLocDesc && _winLocDesc.set) {
        var _origWinLocSet = _winLocDesc.set;
        Object.defineProperty(Object.getPrototypeOf(window), 'location', {
          set: function(val) {
            if (typeof val === 'string' && _isDevtoolUrl(val)) return;
            return _origWinLocSet.call(this, val);
          },
          get: function() { return _winLocDesc.get.call(this); },
          configurable: true
        });
      }
    } catch(e) {}
    // DOM clearing protection — prevent closeWindow() from nuking page content
    try {
      var _bodyInnerHtmlDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      if (_bodyInnerHtmlDesc && _bodyInnerHtmlDesc.set) {
        var _origBodySet = _bodyInnerHtmlDesc.set;
        Object.defineProperty(Element.prototype, 'innerHTML', {
          set: function(val) {
            if (val === '' && this === (document.body || document.documentElement)) return;
            return _origBodySet.call(this, val);
          },
          get: function() { return _bodyInnerHtmlDesc.get.call(this); },
          configurable: true
        });
      }
    } catch(e) {}
    // Block Document.prototype.open/write/writeln (used by some libs to replace content)
    try { Document.prototype.open = _maskFn(function() { return this; }, 'open'); } catch(e) {}
    try { Document.prototype.write = _maskFn(function() {}, 'write'); } catch(e) {}
    try { Document.prototype.writeln = _maskFn(function() {}, 'writeln'); } catch(e) {}
  })();

  // ── Seal window.open permanently (Layer 8) ──
  try {
    var _noopWin = function() { try{ return new Proxy({}, {get:function(){return function(){return null}}}); }catch(e){ return null; } };
    _maskFn(_noopWin, 'function open() { [native code] }');
    Object.defineProperty(window, 'open', { value: _noopWin, writable: false, configurable: false });
  } catch(e) {}

  // ── Block a[target="_blank"] and showModalDialog (Layer 9) ──
  window.showModalDialog = function() { return null; };
  window.showModelessDialog = function() { return null; };
  try {
    document.addEventListener('click', function(e) {
      var target = e.target;
      while (target) {
        if (target.tagName === 'A' && (target.getAttribute('target') === '_blank' || target.target === '_blank')) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        target = target.parentNode;
      }
    }, true);
  } catch(e) {}

  // ── Block ad iframe removal (Layer 10) ──
  try {
    var _AD_SRC = ['doubleclick','googleadservices','googlesyndication',
      'adnxs','popads','popcash','popunder','adsterra','exoclick','juicyads',
      'plugrush','adcash','clickadu','exdynsrv','moatads','servedby',
      'frowstyambler','zoaclachan','riverlayboy','hai8g',
      'developdomicile','cloudflareinsights'];
    function _isAdSrc(s) {
      if (!s) return false; var l=s.toLowerCase();
      for (var _i=0;_i<_AD_SRC.length;_i++){if(l.indexOf(_AD_SRC[_i])!==-1)return true;}
      return false;
    }
    var _videoIframes = {};
    var _videoContainer = null;
    var _origAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function(node) {
      if (node && node.tagName === 'IFRAME') {
        var src = (node.getAttribute('src') || node.src || '').toLowerCase();
        if (src.indexOf('player') !== -1 || src.indexOf('embed') !== -1 ||
            src.indexOf('/e/') !== -1 || src.indexOf('video') !== -1) {
          _videoIframes[src] = node;
        }
      }
      if (node && node.id && (node.id.indexOf('player') !== -1 ||
          node.id.indexOf('video') !== -1 || node.id.indexOf('embed') !== -1)) {
        _videoContainer = node;
      }
      return _origAppendChild.call(this, node);
    };
    var _origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function(node) {
      if (node && node.tagName === 'IFRAME') {
        var src = (node.getAttribute('src') || node.src || '').toLowerCase();
        if (_isAdSrc(src)) return node;
      }
      return _origRemoveChild.call(this, node);
    };
    var _origDescProp = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {
      set: function(val) {
        if (this && _videoContainer && this.contains(_videoContainer)) {
          if (typeof val === 'string' && val.indexOf('<iframe') === -1) return;
        }
        return _origDescProp.set.call(this, val);
      },
      get: function() { return _origDescProp.get.call(this); }
    });
  } catch(e) {}

  // ── Fullscreen API interception (Layer 11) ──
  try {
    var _fs = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function() {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen', entering:true}));
      return _fs ? _fs.apply(this, arguments) : Promise.resolve();
    };
    document.addEventListener('fullscreenchange', function() {
      var isFS = !!document.fullscreenElement;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen', entering:isFS}));
    });
  } catch(e) {}

  // ── Content-ready detection (Layer 12) ──
  (function() {
    if (window.top !== window.self) return;
    if (window.__playerBridgeInitialized) return;
    window.__playerBridgeInitialized = true;
    var _fired = false;
    function fire(state) {
      if (_fired) return;
      _fired = true;
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:content-ready', state: state || document.readyState}));
      } catch(e) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function(){ fire('interactive'); });
    } else {
      fire(document.readyState);
    }
    window.addEventListener('load', function(){ fire('complete'); });
    setTimeout(function() {
      if (!_fired && document.readyState !== 'complete') {
        try { document.close(); } catch(e) {}
        fire('forced');
      }
    }, 6000);
  })();

  // ── document.open() watchdog (Layer 13) ──
  (function() {
    if (document._closeWatchdogPatched) return;
    document._closeWatchdogPatched = true;
    var _open = Document.prototype.open;
    var _close = Document.prototype.close;
    Document.prototype.close = function() {
      if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
      return _close.apply(this, arguments);
    };
    Document.prototype.open = function() {
      var result = _open.apply(this, arguments);
      if (this._closeTimer) clearTimeout(this._closeTimer);
      var self = this;
      self._closeTimer = setTimeout(function() {
        try {
          if (self.readyState === 'loading') {
            try { self.close(); } catch(e) {}
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'cf:content-ready' })
            );
          }
        } catch(e) {}
      }, 12000);
      return result;
    };
  })();

  // ── Console bridge (Layer 14) ──
  (function(){
    var _send=function(lvl,args){
      try{
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type:'console',level:lvl,args:args.map(function(a){
            try{return String(a)}catch(e){return Object.prototype.toString.call(a)}
          })
        }));
      }catch(e){}
    };
    ['log','info','warn','error'].forEach(function(lvl){
      var _orig=console[lvl];
      console[lvl]=function(){
        var _args=Array.prototype.slice.call(arguments);
        _send(lvl,_args);
        _orig.apply(console,arguments);
      };
    });
    window.addEventListener('error',function(e){
      _send('error',[e.message,'@',e.filename+':'+e.lineno, e.error?e.error.stack:'']);
    });
    window.addEventListener('unhandledrejection',function(e){
      _send('error',['unhandledrejection',e.reason?(e.reason.stack||String(e.reason)):'']);
    });
  })();

  // ── Child frame anchor probe (Layer 15) ──
  try {
    if (window.top !== window.self) {
      window.top.postMessage({
        type: '__player:child_anchor',
        href: location.href,
        readyState: document.readyState,
        origin: location.origin,
        host: location.hostname,
        ts: Date.now()
      }, '*');
      window.addEventListener('unload', function() {
        try { window.top.postMessage({ type: '__player:child_unload', href: location.href, ts: Date.now() }, '*'); } catch(_) {}
      });
    }
  } catch(e) {}

  // ── Boot diagnostic (Layer 15b) ──
  try {
    if (window.top === window.self) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'player:diag',
        data: { msg: 'script_boot', ts: Date.now() }
      }));
    }
  } catch(e) {}
})();
true;
`;
}

/**
 * Build a content-ready detection script.
 * Fires on DOMContentLoaded, load, or forced recovery.
 * Does NOT call window.stop() — that would cancel video loading.
 */
export function buildContentReadyScript(): string {
  return `
(function() {
  var _fired = false;
  function fire(state) {
    if (_fired) return;
    _fired = true;
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:content-ready', state: state || document.readyState}));
    } catch(e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ fire('interactive'); });
  } else {
    fire(document.readyState);
  }
  window.addEventListener('load', function(){ fire('complete'); });
  setTimeout(function() {
    if (!_fired && document.readyState !== 'complete') {
      try { document.close(); } catch(e) {}
      fire('forced');
    }
  }, 6000);
})();
true;
`;
}

/**
 * Build the progress-bridge relay script.
 *
 * Provides a postMessage-based bridge so video progress events from
 * the iframe can reach React Native / React via window.ReactNativeWebView.
 */
export function buildBridgeScript(): string {
  return `
(function() {
  if (window.top !== window.self) return;
  if (window.__playerBridgeInitialized) return;
  window.__playerBridgeInitialized = true;

  // Listen for progress events from provider iframes
  window.addEventListener('message', function(event) {
    try {
      var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && (data.type === 'progress' || data.type === 'player:progress')) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    } catch(e) {}
  });

  // Expose seek API so the app can send seek commands
  window.__seekTo = function(time) {
    // Search current document for video elements
    var videos = document.querySelectorAll('video');

    if (videos.length === 0) {
      // Try child iframes
      var iframes = document.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        try {
          var iframeDoc = iframes[fi].contentDocument || iframes[fi].contentWindow.document;
          var iframeVids = iframeDoc.querySelectorAll('video');
          for (var vi = 0; vi < iframeVids.length; vi++) {
            iframeVids[vi].currentTime = time;
          }
        } catch(e) {
          // Permission denied accessing cross-origin iframe — expected
        }
      }
    }

    for (var i = 0; i < videos.length; i++) {
      videos[i].currentTime = time;
    }
  };
})();
true;
`;
}

/**
 * Build the universal video progress tracker script.
 *
 * Injected into every provider WebView via addDocumentStartJavaScript.
 * Polls <video> elements every 3 seconds and sends player:progress
 * events to React Native via window.ReactNativeWebView.postMessage().
 *
 * Features:
 * - MutationObserver to detect video elements added after page load
 * - Capturing-phase timeupdate listener for MSE-based players (Hls.js, Shaka)
 * - Message listener to relay player:progress from child iframes
 * - Console bridge integration (Layer 14) forwards logs to RN terminal
 * - Dedup: only sends when progress changes by >=2% or >=2 seconds
 */
export function buildProgressTrackerScript(): string {
  return `
(function() {
  if (window.__progressTrackerInit) return;
  window.__progressTrackerInit = true;

  var pollTimer = null;
  var lastSentCt = 0;
  var lastSentPct = 0;
  var MIN_TIME_DIFF = 2;      // seconds — skip if change < 2s
  var MIN_PCT_DIFF = 0.02;    // 2% — skip if change < 2%

  console.log('[ProgressTracker] Initializing...');

  // ── Helper: send player:progress to RN ──
  function sendProgress(ct, dur) {
    if (ct < 0 || dur <= 0) return;
    var pct = ct / dur;
    if (pct > 1) pct = 1;

    // Dedup: skip if not enough change
    var timeDiff = Math.abs(ct - lastSentCt);
    var pctDiff = Math.abs(pct - lastSentPct);
    if (timeDiff < MIN_TIME_DIFF && pctDiff < MIN_PCT_DIFF) return;

    lastSentCt = ct;
    lastSentPct = pct;

    var msg = JSON.stringify({
      type: 'player:progress',
      data: {
        currentTime: ct,
        duration: dur,
        percent: pct
      }
    });

    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(msg);
        console.log('[ProgressTracker] Sent: ct=' + ct.toFixed(1) + 's dur=' + dur.toFixed(1) + 's pct=' + (pct * 100).toFixed(1) + '%');
      } else {
        console.log('[ProgressTracker] ReactNativeWebView not available (iframe?) ct=' + ct.toFixed(1) + 's');
      }
    } catch (e) {
      console.warn('[ProgressTracker] postMessage error: ' + e);
    }
  }

  // ── Poll: read <video> currentTime/duration ──
  function poll() {
    var videos = document.querySelectorAll('video');
    if (videos.length === 0) {
      console.log('[ProgressTracker] Poll: no <video> elements found yet');
      return;
    }

    // Use the video with the longest duration (the main player)
    var best = videos[0];
    for (var i = 1; i < videos.length; i++) {
      if ((videos[i].duration || 0) > (best.duration || 0)) {
        best = videos[i];
      }
    }

    var ct = best.currentTime || 0;
    var dur = best.duration || 0;

    if (dur === 0 || isNaN(dur)) {
      console.log('[ProgressTracker] Poll: video found but duration=0 (not loaded yet)');
      return;
    }

    if (ct === 0 || isNaN(ct)) {
      console.log('[ProgressTracker] Poll: video found, currentTime=0 (not playing yet)');
      return;
    }

    sendProgress(ct, dur);
  }

  // ── Start polling ──
  function startPolling(src) {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    console.log('[ProgressTracker] Starting 3s poll interval (trigger: ' + src + ')');
    poll();
    pollTimer = setInterval(poll, 3000);
  }

  // ── MutationObserver: detect <video> added to DOM ──
  var obs = new MutationObserver(function(muts) {
    for (var i = 0; i < muts.length; i++) {
      for (var j = 0; j < muts[i].addedNodes.length; j++) {
        var n = muts[i].addedNodes[j];
        if (n.nodeType !== 1) continue;
        // Check if the added node is a <video> or contains one
        if (n.tagName === 'VIDEO') {
          console.log('[ProgressTracker] <video> element added via DOM');

          // Also listen for timeupdate on this specific video element
          n.addEventListener('timeupdate', function(e) {
            var v = e.target;
            if (v && v.tagName === 'VIDEO') {
              var ct = v.currentTime || 0;
              var dur = v.duration || 0;
              if (dur > 0 && ct > 0) {
                // Send immediately on timeupdate for smoother tracking
                sendProgress(ct, dur);
              }
            }
          });

          // Stop observing once we find a video
          obs.disconnect();
          startPolling('MutationObserver:VIDEO');
          return;
        }
        // Check inside the added subtree
        var inner = n.querySelector && n.querySelector('video');
        if (inner) {
          console.log('[ProgressTracker] <video> found inside added element');
          inner.addEventListener('timeupdate', function(e) {
            var v = e.target;
            if (v && v.tagName === 'VIDEO') {
              var ct = v.currentTime || 0;
              var dur = v.duration || 0;
              if (dur > 0 && ct > 0) sendProgress(ct, dur);
            }
          });
          obs.disconnect();
          startPolling('MutationObserver:video-in-container');
          return;
        }
      }
    }
  });

  try {
    obs.observe(document.documentElement, { childList: true, subtree: true });
    console.log('[ProgressTracker] MutationObserver active');
  } catch (e) {
    console.warn('[ProgressTracker] MutationObserver failed: ' + e);
  }

  // ── Check for existing video elements (loaded before this script?) ──
  var existing = document.querySelectorAll('video');
  if (existing.length > 0) {
    console.log('[ProgressTracker] Found ' + existing.length + ' existing <video> element(s)');

    // Attach timeupdate listeners
    for (var k = 0; k < existing.length; k++) {
      existing[k].addEventListener('timeupdate', function(e) {
        var v = e.target;
        if (v && v.tagName === 'VIDEO') {
          var ct = v.currentTime || 0;
          var dur = v.duration || 0;
          if (dur > 0 && ct > 0) sendProgress(ct, dur);
        }
      });
    }

    // Start poll (with a short delay to let video metadata load)
    setTimeout(function() { startPolling('existing-video'); }, 1000);
  } else {
    console.log('[ProgressTracker] No existing <video> — waiting via MutationObserver');
  }

  console.log('[ProgressTracker] Initialized');

  // NOTE: player:progress relay from child iframes is handled by buildBridgeScript
})();
true;
`;
}

/**
 * Build the complete set of scripts to inject into a player WebView/iframe.
 * Combines all guard layers + uBO scriptlets into a single concatenated string.
 */
export function buildAllScripts(providerHostname: string, blockedDomains?: string[]): string {
  return [
    buildGuardScript(providerHostname, blockedDomains),
    buildContentReadyScript(),
    buildBridgeScript(),
    buildProgressTrackerScript(),
  ].join('\n\n');
}

/**
 * Build all scripts including uBlock Origin scriptlets.
 * Use this variant when anti-anti-adblock scriptlets are desired.
 *
 * @param providerHostname - Provider hostname for referrer spoofing
 * @param providerId - Optional provider ID for provider-specific scriptlets
 */
export function buildAllScriptsWithScriptlets(providerHostname: string, providerId?: string, blockedDomains?: string[]): string {
  const baseScriptlets = buildAllScriptlets();
  const providerScriptlets = providerId ? getProviderScriptlets(providerId) : [];

  return [
    buildGuardScript(providerHostname, blockedDomains),
    baseScriptlets,
    ...providerScriptlets,
    buildContentReadyScript(),
    buildBridgeScript(),
    buildProgressTrackerScript(),
  ].join('\n\n');
}
