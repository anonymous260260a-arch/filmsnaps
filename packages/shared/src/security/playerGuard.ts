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

export function buildGuardScript(providerHostname: string): string {
  return `
(function() {
  // ── Popup blocking (Layer 1) ──
  // Override window.open with smart filtering — allow same-origin, block ad domains.
  (function() {
    var _origOpen = window.open;
    window.open = function(url, name, features) {
      if (url && typeof url === 'string') {
        try {
          var u = new URL(url, location.href);
          if (u.hostname !== location.hostname) {
            var l = u.href.toLowerCase();
            var AD_PATTERNS = [
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
            for (var i = 0; i < AD_PATTERNS.length; i++) {
              if (l.indexOf(AD_PATTERNS[i]) !== -1) {
                try { return new Proxy({}, {get:function(){return function(){return null}}}); } catch(e){ return null; }
              }
            }
          }
        } catch(e) {}
      }
      try { return _origOpen.apply(window, arguments); } catch(e) { return null; }
    };
  })();

  // ── Ad / tracker network blocklist (Layer 2) ──
  (function() {
    var AD_PATTERNS = [
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
      'click.', 'adx.', 'adv.', 'banner.',
      'traffic.', 'redirect.', 'redirecting.',
      'bestchange', 'best-',
    ];
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
      window.fetch = function(input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (isAdUrl(url)) return Promise.resolve(new Response('', {status: 204}));
        return _fetch.call(window, input, init);
      };
    } catch(e) {}
    // Intercept XHR
    try {
      var _xhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        if (isAdUrl(url)) { this._aborted = true; return; }
        return _xhrOpen.apply(this, arguments);
      };
      var _xhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function() {
        if (this._aborted) return;
        return _xhrSend.apply(this, arguments);
      };
    } catch(e) {}
  })();

  // ── DOM mutation sweeper (Layer 3) ──
  (function() {
    var AD_PATTERNS = [
      'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
      'google-analytics.com', 'googletagmanager.com', 'gtag/js',
      'pagead2.googlesyndication.com', 'adnxs.com', 'popads.', 'popcash.',
      'popunder.', 'adsterra.com', 'exoclick.com', 'juicyads.com',
      'plugrush.com', 'adcash.com', 'clickadu.com',
      'frowstyambler', 'zoaclachan', 'riverlayboy', 'hai8g',
      'developdomicile', 'cloudflareinsights',
    ];
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

  // ── Seal window.open permanently (Layer 8) ──
  try {
    var _noopWin = function() { try{ return new Proxy({}, {get:function(){return function(){return null}}}); }catch(e){ return null; } };
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
      if (data && data.type === 'progress') {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    } catch(e) {}
  });

  // Expose seek API so the app can send seek commands
  window.__seekTo = function(time) {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      videos[i].currentTime = time;
    }
  };
})();
true;
`;
}

/**
 * Build the complete set of scripts to inject into a player WebView/iframe.
 * Combines all guard layers into a single concatenated string.
 */
export function buildAllScripts(providerHostname: string): string {
  return [
    buildGuardScript(providerHostname),
    buildContentReadyScript(),
    buildBridgeScript(),
  ].join('\n\n');
}
