import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Dimensions,
  Animated,
  Image,
  Platform,
} from 'react-native';
import PlayerWebView, { PlayerWebViewRef } from '../modules/player-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getEnabledProviders, getImageUrl } from '@filmsnaps/shared';
import { ProgressiveImage } from './ProgressiveImage';
import type { ProviderDefinition } from '@filmsnaps/shared';
import { useSeasonEpisodes, useTVSeasonsOnly } from '../hooks/useTMDB';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import { saveProgress, getResumePoint, getProgress, markCompleted } from '../lib/watchHistory';
import type { WatchProgress } from '../lib/watchHistory';
import { clearAllState } from '../modules/player-webview';
import { providerConfigs, generateProviderSnippet } from './providerConfig';

const POPUP_BLOCKER_SCRIPT = `
(function() {
  // ── Popup blocking with smart filtering (Layer 1) ──
  // Block popups to known ad/tracker domains while allowing legitimate
  // ones (e.g. screenscape's server selector dialog).
  (function() {
    var _origOpen = window.open;
    window.open = function(url, name, features) {
      // Allow same-origin popups (provider's own UI) and unknown origins
      if (url && typeof url === 'string') {
        try {
          var u = new URL(url, location.href);
          // Block only if the URL matches an ad/tracker pattern
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
              // Aggressive popup domains (nxsha and similar providers)
              'go. ', 'go.', 'click.', 'tracking.',
              'adx.', 'adv.', 'banner.',
              'traffic.', 'redirect.', 'redirecting.',
              'bestchange', 'best-',
            ];
            for (var i = 0; i < AD_PATTERNS.length; i++) {
              if (l.indexOf(AD_PATTERNS[i]) !== -1) {
                // Block: return inert proxy that discards all calls
                try { return new Proxy({}, {get:function(){return function(){return null}}}); } catch(e){ return null; }
              }
            }
          }
        } catch(e) {}
      }
      // Allow: delegate to original window.open
      try { return _origOpen.apply(window, arguments); } catch(e) { return null; }
    };
  })();

  // ── Ad / tracker domain blocklist (Layer 2) ──
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
    // Aggressive popup domains (nxsha and similar providers)
    'go. ', 'click.', 'adx.', 'adv.', 'banner.',
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

  // Intercept fetch & XHR to ad domains
  try {
    var _fetch = window.fetch;
    window.fetch = function(input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (isAdUrl(url)) return Promise.resolve(new Response('', {status: 204}));
      return _fetch.call(window, input, init);
    };
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

  // ── DOM manipulation (deferred until DOMContentLoaded) ──
  function _domInit() {
    // Ad iframe + overlay sweeper
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
            var tag = n.tagName;
            // Block ad iframes by src URL
            if (tag === 'IFRAME') {
              var src = n.getAttribute('src') || n.src || '';
              if (isAdUrl(src)) { n.remove(); continue; }
            }
            // Block overlay popups: fixed/sticky position divs with high z-index
            if (tag === 'DIV' || tag === 'SECTION' || tag === 'ASIDE') {
              try {
                var cs = window.getComputedStyle(n);
                var zIdx = parseInt(cs.zIndex);
                if (!isNaN(zIdx) && zIdx > 50 && (cs.position === 'fixed' || cs.position === 'sticky')) {
                  // Make sure it's not the player wrapper — check it doesn't contain a video
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

    // Auto-click skip buttons + popup overlay removal
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
        // Popup overlay removal: hide fixed-position high-z-index containers
        // that don't contain the actual video player
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
    _sweepAds(); // Initial sweep — continued via interval below

    // Periodic popup sweep every 3s (catches delayed/timed popups)
    try { setInterval(_sweepAds, 3000); } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _domInit);
  } else {
    _domInit();
  }

  // ── Click interception: block navigation to external domains ──
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

  // ── Service Worker blocking ──
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

  // ── Block document.write / writeln ──
  try {
    document.write = function() {};
    document.writeln = function() {};
  } catch(e) {}
})();
true;
`;

// ── Content-ready detector ──
// Fires on DOMContentLoaded, load, or forced recovery if the page is stuck.
// We do NOT call window.stop() here because it cancels legitimate video
// players (Shaka, HLS.js) that take 10-15s to negotiate DRM on slow networks.
// DOMContentLoaded fires BEFORE the page fully loads so we can hide the
// spinner without waiting for onPageFinished.
const CONTENT_READY_SCRIPT = `
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

  // Gentle fallback: if the page is genuinely stuck (not just slow), close the
  // document write stream. No window.stop() — that would cancel video loading.
  setTimeout(function() {
    if (!_fired && document.readyState !== 'complete') {
      try { document.close(); } catch(e) {}
      fire('forced');
    }
  }, 6000);
})();
true;
`;

// ── document.open() watchdog ──
// Many free streaming providers (peachify, screenscape, vidking, chillflix)
// use document.open() without ever calling document.close(). This keeps the
// document in "loading" readyState indefinitely, which prevents Android
// WebViewClient.onPageFinished() from ever firing. We patch document.open()
// to force-close after 12 seconds if the provider's own code doesn't.
// The native onPageFinished fallback timer also handles this, but patching
// at the JS level gives a cleaner experience (the page's own JS continues
// running rather than having onPageFinished synthesized from native code).
const DOCUMENT_CLOSE_WATCHDOG_SCRIPT = `
(function() {
  if (document._closeWatchdogPatched) return;
  document._closeWatchdogPatched = true;

  var _open = Document.prototype.open;
  var _close = Document.prototype.close;

  // Patch close to clear the watchdog timer (clean shutdown).
  Document.prototype.close = function() {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    return _close.apply(this, arguments);
  };

  // Patch open to schedule force-close if the provider never calls it.
  Document.prototype.open = function() {
    var result = _open.apply(this, arguments);
    if (this._closeTimer) clearTimeout(this._closeTimer);
    var self = this;
    self._closeTimer = setTimeout(function() {
      try {
        if (self.readyState === 'loading') {
          // Close the document write stream — may trigger onPageFinished.
          // No window.stop() here — that would cancel video player loading.
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
true;
`;

// ── Console bridge ──
const CONSOLE_BRIDGE_SCRIPT = `
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
true;
`;

// Minimal Cloudflare bypass script
function makeCFBypassScript(providerHost: string, providerId?: string) {
  const providerSnippet = providerId
    ? generateProviderSnippet(providerConfigs[providerId])
    : '';

  return `
(function() {
  // Each section is wrapped in its own try/catch so a single failure doesn't
  // poison the entire page parse — bot-detection sees a healthy execution.

  // ── Child-anchor probe (expert recommendation) ──
  // This IIFE runs at the VERY TOP of the injected script, OUTSIDE any
  // DOMContentLoaded handler, OUTSIDE any interval. It fires one-shot from
  // EVERY child frame the instant addDocumentStartJavaScript evaluates the
  // script. If this fires, addDocumentStartJavaScript IS reaching child
  // frames. If not, the API is silently failing on this device/WebView.
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

      // Also detect iframe navigation (boomerang pattern):
      // Cross-origin players commonly load a stub child frame first, then
      // jump it to a new URL on play click. Each hop destroys the script
      // context. This unload listener catches those navigations.
      window.addEventListener('unload', function() {
        try { window.top.postMessage({ type: '__player:child_unload', href: location.href, ts: Date.now() }, '*'); } catch(_) {}
      });
    }
  } catch(e) {}

  // ── Boot diagnostic: confirm script runs (main frame only) ──
  try {
    if (window.top === window.self) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'player:diag',
        data: { msg: 'script_boot', ts: Date.now() }
      }));
    }
  } catch(e) {}

  // ── Frame diagnostic: report how many child iframes exist early ──
  try {
    if (window.top === window.self) {
      setTimeout(function() {
        var _ifs = document.querySelectorAll('iframe');
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'player:diag',
          data: { msg: 'frame_count', count: _ifs.length, ts: Date.now() }
        }));
      }, 100);
    }
  } catch(e) {}

  // ── Cloudflare stealth: webdriver detection ──
  try { Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } }); } catch(e) {}

  // ── Chrome runtime stubs ──
  try {
    if (!window.chrome) {
      window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
    }
  } catch(e) {}

  // ── Plugin enumeration ──
  try { Object.defineProperty(navigator, 'plugins', { get: function() { return [1, 2, 3, 4, 5]; }, configurable: true }); } catch(e) {}

  // ── Language preferences ──
  try { Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US', 'en']; }, configurable: true }); } catch(e) {}

  // ── Permissions query ──
  try {
    var _origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = function(params) {
      return params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : _origQuery(params);
    };
  } catch(e) {}

  // ── WebGL fingerprint ──
  try {
    var _getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return _getParam.call(this, param);
    };
  } catch(e) {}

  // ── Intercept fullscreen API ──
  try {
    var _fs = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function() {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen', entering:true}));
      return _fs ? _fs.apply(this, arguments) : Promise.resolve();
    };
    var _efs = Element.prototype.exitFullscreen;
    Element.prototype.exitFullscreen = function() {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen', entering:false}));
      return _efs ? _efs.apply(this, arguments) : Promise.resolve();
    };
    document.addEventListener('fullscreenchange', function() {
      var isFS = !!document.fullscreenElement;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen', entering:isFS}));
    });
  } catch(e) {}

  window.open = function() { try{ return new Proxy({}, {get:function(){return function(){return null}}}); }catch(e){ return null; } };
  window.showModalDialog = function() { return null; };
  window.showModelessDialog = function() { return null; };

  // Seal the override so provider scripts can't restore the real function
  try {
    var _noopWin = function() { try{ return new Proxy({}, {get:function(){return function(){return null}}}); }catch(e){ return null; } };
    Object.defineProperty(window, 'open', { value: _noopWin, writable: false, configurable: false });
  } catch(e) {}

  // Block a[target="_blank"] clicks and middle-click new-tab — prevents click-based popunders
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

  // ── Video iframe freeze (only blocks AD iframe removal) ──
  // IMPORTANT: Only freeze removal of AD iframes. Legitimate video iframe
  // replacement (e.g. screenscape switching video source) MUST be allowed
  // or the page breaks when the user clicks server/quality selectors.
  try {
    var _videoIframes = {};
    var _videoContainer = null;
    var _AD_SRC = ['doubleclick','googleadservices','googlesyndication',
      'adnxs','popads','popcash','popunder','adsterra','exoclick','juicyads',
      'plugrush','adcash','clickadu','exdynsrv','moatads','servedby',
      'frowstyambler','zoaclachan','riverlayboy','hai8g','my.rtmark',
      'developdomicile','cloudflareinsights'];
    function _isAdSrc(s) {
      if (!s) return false; var l=s.toLowerCase();
      for (var _i=0;_i<_AD_SRC.length;_i++){if(l.indexOf(_AD_SRC[_i])!==-1)return true;}
      return false;
    }
    var _origAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function(node) {
      if (node && node.tagName === 'IFRAME') {
        var src = (node.getAttribute('src') || node.src || '').toLowerCase();
        if (src.indexOf('xbm.') !== -1 || src.indexOf('mp4.') !== -1 ||
            src.indexOf('vidnees') !== -1 || src.indexOf('vidapi.') !== -1 ||
            src.indexOf('eat-peach') !== -1 ||
            src.indexOf('player') !== -1 || src.indexOf('embed') !== -1 ||
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
        // Only freeze iframes whose src matches ad/tracker patterns.
        // Legitimate video iframe replacement (server switch, quality
        // change) must be allowed or the page breaks.
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


    // ── MAIN FRAME: Relay progress → RN + expose seek API ──
    // NOTE: This runs at DOCUMENT-START (not deferred to DOMContentLoaded)
    // because we MUST register the message listener before the provider's
    // iframe loads and starts posting progress events. Many streaming
    // providers keep the document in "loading" state via document.open(),
    // which prevents DOMContentLoaded from firing naturally.
    (function() {
      // Only run in the top-most frame
      if (window.top !== window.self) return;
      // One-time guard — this IIFE runs at document-start AND on
      // onPageFinished (via evaluateJavascript), avoid duplicate listeners.
      if (window.__playerBridgeInitialized) return;
      window.__playerBridgeInitialized = true;

      var _progressReceived = false;

      // Relay: child iframe → React Native
      window.addEventListener('message', function(e) {
        if (!e.data) return;

        // Forward progress
        if (e.data.type === '__player:progress') {
          _progressReceived = true;
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'player:progress',
              data: {
                currentTime: e.data.currentTime,
                duration: e.data.duration,
                percent: e.data.percent
              }
            }));
          } catch(ex) {}
          return;
        }

        // Forward diagnostics to React Native
        if (e.data.type === '__player:diag') {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'player:diag',
              data: e.data
            }));
          } catch(ex) {}
          return;
        }

        // Child-anchor probe (expert recommendation): fires whenever a
        // child iframe receives the injected script. If this fires,
        // addDocumentStartJavaScript IS reaching child frames.
        if (e.data.type === '__player:child_anchor') {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'player:diag',
              data: { msg: 'child_anchor', href: e.data.href, readyState: e.data.readyState, origin: e.data.origin, host: e.data.host, ts: e.data.ts }
            }));
          } catch(ex) {}
          return;
        }

        // Iframe navigation detection (boomerang pattern)
        if (e.data.type === '__player:child_unload') {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'player:diag',
              data: { msg: 'child_unload', href: e.data.href, ts: e.data.ts }
            }));
          } catch(ex) {}
          return;
        }
      });

      // Expose seek API globally for React Native injectJavaScript
      window.__playerSeek = function(time, play) {
        // Try main-document video first
        var _v = document.querySelector('video');
        if (_v && _v.readyState >= 1) {
          _v.currentTime = time;
          if (play) _v.play();
          return;
        }
        // Broadcast to all directly-owned iframes
        var _ifs = document.querySelectorAll('iframe');
        for (var _i = 0; _i < _ifs.length; _i++) {
          try {
            _ifs[_i].contentWindow.postMessage({
              type: '__player:seek', time: time, play: play
            }, '*');
          } catch(e) {}
        }
      };

      // Diagnostic: report bridge status 8s after load
      setTimeout(function() {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'player:diag',
            data: {
              msg: 'bridge_status',
              hasPlayerSeek: typeof window.__playerSeek === 'function',
              progressReceived: _progressReceived,
              iframeCount: document.querySelectorAll('iframe').length,
              hasVideo: document.querySelectorAll('video').length > 0
            }
          }));
        } catch(e) {}
      }, 8000);
    })();

  // ── DOM manipulation (deferred) ──
  function _cfDomInit() {
    var AD_DOMAINS = ['doubleclick.net','googleadservices.com','googlesyndication.com','pagead2.','adnxs.com','rubiconproject.com','criteo.','popads.','popcash.','popunder.','adsterra.com','propellerads.com','exoclick.com','juicyads.com','plugrush.com','adcash.com','clickadu.com','cloudflareinsights.com','go.','click.','adx.','traffic.','redirect.','bestchange','ads.','popunders','popad'];
    function _isAdUrl(u) { if (!u) return false; var l=u.toLowerCase(); for(var di=0;di<AD_DOMAINS.length;di++){if(l.indexOf(AD_DOMAINS[di])!==-1)return true;} return false; }

    try {
      var adIframeObserver = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var nodes = mutations[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.tagName === 'IFRAME') {
              var src = n.getAttribute('src') || n.src || '';
              if (_isAdUrl(src)) n.remove();
            }
          }
        }
      });
      adIframeObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch(e) {}

    // ── Provider-specific UI cleanup (from providerConfig.ts) ──
    ${providerSnippet}

    // ════════════════════════════════════════════════════════════════
    // TWO-WAY postMessage BRIDGE FOR CROSS-ORIGIN VIDEO PROGRESS
    // ════════════════════════════════════════════════════════════════
    // This script runs in ALL frames (main + child iframes) via
    // addDocumentStartJavaScript. We use a frame-detection guard:
    //
    //   CHILD IFRAME  → polls for <video>, picks largest (skip ads),
    //                    reports progress via window.top.postMessage,
    //                    listens for __player:seek commands
    //
    //   MAIN FRAME    → relays __player:progress → ReactNativeWebView,
    //                    exposes window.__playerSeek() for RN calls
    //
    // This handles:
    //   - Cross-origin iframes (nxsha/workers.dev, peachify/eat-peach.sbs)
    //   - Deeply nested iframe chains (nxsha: page → iframe → player)
    //       using window.top (not window.parent) to skip intermediate frames
    //   - Pre-roll ads: picks the largest-resolution <video>
    //   - Slow video metadata: checks readyState >= 1 before seeking
    // ════════════════════════════════════════════════════════════════

    // ── CHILD IFRAME: Find video, report progress, listen for seeks ──
    (function() {
      // Only run in child frames. Main frame handles separately below.
      if (window.top === window.self) return;

      var _seekInterval = null;

      // Poll for video element (DOM isn't ready at document-start)
      var _finder = setInterval(function() {
        var _videos = document.querySelectorAll('video');
        if (!_videos.length) return;

        // Heuristic: pick the largest video to avoid pre-roll ads
        var _v = _videos[0];
        for (var _i = 1; _i < _videos.length; _i++) {
          if (_videos[_i].videoWidth * _videos[_i].videoHeight >
              _v.videoWidth * _v.videoHeight) {
            _v = _videos[_i];
          }
        }

        clearInterval(_finder);

        // Diagnostic: confirm child frame found video
        try {
          window.top.postMessage({type: '__player:diag', msg: 'found_video', vw: _v.videoWidth, vh: _v.videoHeight}, '*');
        } catch(e) {}

        // Attach throttled progress reporter
        var _lastSent = 0;
        _v.addEventListener('timeupdate', function() {
          try {
            if (_v.duration <= 0 || _v.currentTime <= 5) return;
            var _now = Date.now();
            if (_now - _lastSent < 5000) return;
            _lastSent = _now;

            // Use window.top to handle deeply nested iframe chains
            window.top.postMessage({
              type: '__player:progress',
              currentTime: _v.currentTime,
              duration: _v.duration,
              percent: _v.currentTime / _v.duration
            }, '*');

            // Diagnostic: confirm progress posted
            try {
              window.top.postMessage({type: '__player:diag', msg: 'progress_posted', ct: _v.currentTime, dur: _v.duration}, '*');
            } catch(e) {}
          } catch(e) {}
        });

        // Listen for seek commands from RN / Main Frame
        window.addEventListener('message', function(e) {
          if (!e.data || e.data.type !== '__player:seek') return;

          // Wait for video metadata before seeking
          if (_seekInterval) clearInterval(_seekInterval);
          _seekInterval = setInterval(function() {
            if (_v.readyState >= 1) {
              try {
                _v.currentTime = e.data.time;
                if (e.data.play) _v.play().catch(function(){});
              } catch(ex) {}
              clearInterval(_seekInterval);
              _seekInterval = null;
            }
          }, 200);
        });
      }, 500);
    })();

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _cfDomInit);
  } else {
    _cfDomInit();
  }
})();
true;
`;
}

interface VideoWebViewProps {
  type: 'movie' | 'tv';
  id: string;
  season?: number;
  episode?: number;
  onClose?: () => void;
  initialProvider?: string;
}

// ── Consolidated script injection ──
// Wraps all injected scripts in a SINGLE outer IIFE to reduce V8 parse
// overhead on low-end devices. Inner try/catch blocks ensure one failure
// doesn't poison the rest. CONSOLE_BRIDGE is intentionally excluded from
// production builds — its JSON.stringify calls add measurable GC pressure.
function makeConsolidatedScript(providerHost: string, providerId?: string): string {
  // Strip the outer IIFE wrappers from each script, keeping their inner bodies
  const scripts = [
    POPUP_BLOCKER_SCRIPT,
    CONTENT_READY_SCRIPT,
    DOCUMENT_CLOSE_WATCHDOG_SCRIPT,
    makeCFBypassScript(providerHost, providerId),
  ];
  const innerBodies: string[] = [];
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    // Remove leading (function() { / })(), true; / ; true; patterns
    const body = s
      .replace(/^\s*\(function\s*\(\)\s*\{?/, '')   // opening (function() {
      .replace(/\}\s*\)\s*\(\s*\)\s*;?\s*true\s*;?\s*$/, '') // closing })(), true;
      .replace(/^\s*true\s*;?\s*$/, '') // standalone true;
      .trim();
    if (body) innerBodies.push(body);
  }

  return `(function(){
${innerBodies.join('\n\n')}
})();
true;`;
}

export function VideoWebView({
  type,
  id,
  season,
  episode,
  onClose,
  initialProvider,
  backdropUrl,
}: VideoWebViewProps & { backdropUrl?: string }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
  const webViewRef = useRef<PlayerWebViewRef>(null);
  const providerHostRef = useRef<string>('');
  const navigationChainRef = useRef<Set<string>>(new Set());
  const pageLoadedRef = useRef(false);
  const navigationGenRef = useRef(0);
  const navigationAttemptsRef = useRef(0);
  const navigationReceivedRef = useRef(false);
  const progressRef = useRef<{ currentTime: number; duration: number; percent: number; tmdbId?: number; season?: number; episode?: number }>({ currentTime: 0, duration: 0, percent: 0 });
  const startAtRef = useRef<number>(0);
  const [startAtTime, setStartAtTime] = useState<number>(0);
  const lastSavePctRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  // ── Slide-in animation deferral ──
  // On low-end devices (Helio G35), triggering loadUrl at the same moment
  // as the slide_from_bottom animation causes CPU contention between the
  // animation (UI thread) and Chromium's network/DNS (browser thread),
  // dropping animation frames. Wait 350ms for the animation to finish.
  const [slideInReady, setSlideInReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlideInReady(true), 350);
    return () => clearTimeout(timer);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  // ── Phase 3: Audit Mode (Domain Discovery) ──
  // Long-press the server pill to toggle. While active, every network
  // request the WebView makes is logged and collected. Turn off audit
  // mode to see the full list of captured domains.
  const [auditMode, setAuditMode] = useState(false);
  const [auditHosts, setAuditHosts] = useState<string[]>([]);
  // ── Overlay auto-hide (only in fullscreen) ──
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setOverlayVisible(false));
    }, 3000);
  }, [overlayOpacity]);

  const showOverlay = useCallback(() => {
    setOverlayVisible(true);
    Animated.timing(overlayOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    scheduleHide();
  }, [overlayOpacity, scheduleHide]);

  const providers = useMemo(() => getEnabledProviders(), []);

  const [providerId, setProviderId] = useState<string>(
    initialProvider && providers.some((p) => p.id === initialProvider)
      ? initialProvider
      : providers[0]?.id ?? '',
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  // When entering fullscreen → lock to landscape, start auto-hide.
  // When exiting → lock to portrait (prevents accidental landscape), keep visible.
  useEffect(() => {
    if (isFullscreen) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      scheduleHide();
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setOverlayVisible(true);
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isFullscreen, scheduleHide, overlayOpacity]);

  // Track orientation restore to avoid double-calling during dismiss
  const orientationRestoredRef = useRef(false);
  const restorePortrait = useCallback(() => {
    if (orientationRestoredRef.current) return;
    orientationRestoredRef.current = true;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);
  // Restore portrait on unmount (catches hardware-back, gesture, etc.)
  useEffect(() => {
    return () => { if (!orientationRestoredRef.current) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }};
  }, []);
  const [showEpPicker, setShowEpPicker] = useState(false);
  const [currentSeason, setCurrentSeason] = useState<number>(season ?? 1);
  const [currentEpisode, setCurrentEpisode] = useState<number>(episode ?? 1);
  const [tempSeason, setTempSeason] = useState<number>(currentSeason);
  const [tempEpisode, setTempEpisode] = useState<number>(currentEpisode);

  // ── Load watch history on mount to determine resume point ──
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    (async () => {
      try {
        if (type === 'tv') {
          const resume = await getResumePoint(id, 'tv', currentSeason, currentEpisode);
          if (resume) {
            if (resume.season != null && resume.episode != null) {
              setCurrentSeason(resume.season);
              setCurrentEpisode(resume.episode);
              setTempSeason(resume.season);
              setTempEpisode(resume.episode);
            }
            if (resume.currentTime > 5 && !resume.completed) {
              startAtRef.current = resume.currentTime;
              setStartAtTime(resume.currentTime);
              // If page already loaded before history resolved, seek immediately
              if (pageLoadedRef.current) {
                webViewRef.current?.injectJavaScript(`
                  if (window.__playerSeek) {
                    window.__playerSeek(${Math.floor(resume.currentTime)}, true);
                  }
                  true;
                `);
                startAtRef.current = 0;
              }
            }
          }
        } else {
          const progress = await getProgress(id, 'movie');
          if (progress && !progress.completed && progress.currentTime > 5) {
            startAtRef.current = progress.currentTime;
            setStartAtTime(progress.currentTime);
            if (pageLoadedRef.current) {
              webViewRef.current?.injectJavaScript(`
                if (window.__playerSeek) {
                  window.__playerSeek(${Math.floor(progress.currentTime)}, true);
                }
                true;
              `);
              startAtRef.current = 0;
            }
          }
        }
      } catch {
        // Silently fail — app works fine without history
      }
    })();
  }, [type, id, currentSeason, currentEpisode]);

  const currentProvider = providers.find((p) => p.id === providerId);
  const isTV = type === 'tv';

  // Keep provider hostname ref up to date for navigation blocking
  useEffect(() => {
    if (currentProvider) {
      try {
        providerHostRef.current = new URL(currentProvider.baseUrl).hostname;
      } catch (e) {
        providerHostRef.current = '';
      }
    }
  }, [currentProvider]);

  // Safety timer: clear loading state if the provider never navigates.
  // Does NOT auto-retry — that was causing more harm (reloading pages that
  // were still loading). The user can tap "Retry" or switch providers instead.
  useEffect(() => {
    navigationReceivedRef.current = false;
    const gen = navigationGenRef.current;

    // If NO navigation event fires within 30s, hide spinner so user sees
    // whatever the WebView shows (may be blank) and can decide to retry.
    const noNavTimer = setTimeout(() => {
      if (!navigationReceivedRef.current) {
        console.warn(`[WebView] No navigation within 30s (gen=${gen})`);
        setLoading(false);
      }
    }, 30000);

    // Force loading off after 35s no matter what (page may have hung after nav)
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 35000);

    return () => {
      clearTimeout(noNavTimer);
      clearTimeout(safetyTimer);
    };
  }, [providerId, currentSeason, currentEpisode]);

  // ── Log provider ID changes (not on every render) ──
  console.log(`[WebView] providerId=${providerId} type=${type} id=${id}`);

  const watchUrl = useMemo(() => {
    if (!currentProvider) {
      console.warn('[WebView] No currentProvider — URL is empty');
      return '';
    }
    const startAt = startAtTime > 0 ? startAtTime : undefined;
    const embedPath =
      type === 'tv' && currentSeason && currentEpisode
        ? currentProvider.embed.tv(id, currentSeason, currentEpisode, startAt)
        : currentProvider.embed.movie(id, startAt);
    const url = `${currentProvider.baseUrl}${embedPath}`;
    console.log(`[WebView] URL: ${url.substring(0, 120)}${startAt ? ` (startAt=${startAt})` : ''}`);
    return url;
  }, [currentProvider, type, id, currentSeason, currentEpisode, startAtTime]);

  // Restore portrait THEN navigate back — prevents the dismiss animation from
  // glitching when the orientation changes during the transition.
  const handleClose = useCallback(() => {
    restorePortrait();
    // Save final progress before closing
    const prog = progressRef.current;
    if (prog.currentTime > 5) {
      console.warn('[BRIDGE] Saving on close');
      saveProgress({
        tmdbId: id,
        mediaType: type,
        providerId: providerId,
        currentTime: prog.currentTime,
        duration: prog.duration,
        percent: prog.percent,
        season: isTV ? currentSeason : undefined,
        episode: isTV ? currentEpisode : undefined,
        updatedAt: Date.now(),
        completed: prog.percent >= 0.95,
      }).catch(() => {});
    }
    // Small delay to let orientation settle before dismiss animation starts
    setTimeout(() => onClose?.(), 200);
  }, [restorePortrait, onClose, id, type, providerId, isTV, currentSeason, currentEpisode]);

  // ── Periodic force-save (every 15s of wall-clock time) ──
  // Catches cases where the unmount handler fails (app crash, system kill)
  // or video progress throttling prevents an intermediate save.
  useEffect(() => {
    const intervalId = setInterval(() => {
      const prog = progressRef.current;
      if (prog.currentTime > 5) {
        console.warn('[BRIDGE] Periodic save triggered');
        saveProgress({
          tmdbId: id,
          mediaType: type,
          providerId: providerId,
          currentTime: prog.currentTime,
          duration: prog.duration,
          percent: prog.percent,
          season: isTV ? currentSeason : undefined,
          episode: isTV ? currentEpisode : undefined,
          updatedAt: Date.now(),
          completed: prog.percent >= 0.95,
        }).catch(() => {});
      }
    }, 15000);
    return () => clearInterval(intervalId);
  }, [id, type, providerId, isTV, currentSeason, currentEpisode]);

  // ── Save progress on unmount (catches hardware-back, gesture, etc.) ──
  const unmountSavedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (unmountSavedRef.current) return;
      unmountSavedRef.current = true;
      const prog = progressRef.current;
      // Save if the video actually started playing (currentTime > 5s)
      // Use absolute seconds, NOT percentage — duration may be 0/NaN on HLS
      if (prog.currentTime > 5) {
        console.warn('[BRIDGE] Saving on unmount/close');
        saveProgress({
          tmdbId: id,
          mediaType: type,
          providerId: providerId,
          currentTime: prog.currentTime,
          duration: prog.duration,
          percent: prog.percent,
          season: isTV ? currentSeason : undefined,
          episode: isTV ? currentEpisode : undefined,
          updatedAt: Date.now(),
          completed: prog.percent >= 0.95,
        }).catch((err: unknown) => console.warn('Unmount save failed', err));
      }
    };
  }, [id, type, providerId, isTV, currentSeason, currentEpisode]);

  const switchProvider = (newId: string) => {
    // Clear shared Chromium state (cookies, Service Workers, WebStorage)
    // before mounting the new WebView. This prevents stale SW registrations,
    // poisoned cookies, or leftover cache from the previous provider from
    // interfering with the new provider's page load.
    clearAllState().catch(() => {});

    setProviderId(newId);
    // Force full WebView remount on every provider switch. The fresh native
    // WebView always processes its initial source.uri correctly.
    setMountGen((g) => g + 1);
    // Only show loading if provider actually changed (prevents infinite spinner
    // when user taps the same provider they're already using)
    if (newId !== providerId) {
      setLoading(true);
    }
    setError(null);
    setShowPicker(false);
    // Reset navigation chain for the new provider
    navigationChainRef.current = new Set();
    pageLoadedRef.current = false;
    navigationGenRef.current += 1;
    navigationAttemptsRef.current = 0;
    // Carry over the latest progress position from any provider so the
    // new provider seeks to the same point (progress is per-media, not per-provider).
    const latestTime = (progressRef.current as any).currentTime ?? 0;
    if (latestTime > 5) {
      startAtRef.current = latestTime;
      setStartAtTime(latestTime);
    }
  };

  // Mount generation — incremented on each provider switch to force a fresh
  // native WebView instance. Unlike source-prop changes (which the WebView may
  // ignore when busy), a new key guarantees the WebView is fully remounted with
  // a clean native state and always starts navigation.
  const [mountGen, setMountGen] = useState(0);
  const webViewKey = `player-${mountGen}`;

  const getProviderDisplayName = (p: ProviderDefinition): string => {
    return p.displayName || p.name || p.id;
  };


  const retry = () => {
    if (error) {
      setError(null);
      setLoading(true);
    }
    navigationAttemptsRef.current = 0;
    // Force full remount on retry
    setMountGen((g) => g + 1);
  };

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950 px-8">
        <View className="w-16 h-16 rounded-full bg-red-500/10 items-center justify-center mb-5">
          <Ionicons name="alert-circle" size={32} color="#ef4444" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">Playback Error</Text>
        <Text className="text-zinc-500 text-sm mb-8 text-center leading-5">{error}</Text>
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={retry}
            className="bg-gold rounded-xl py-3 px-6 flex-row items-center"
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={16} color="#000" />
            <Text className="text-black font-bold text-sm ml-2">Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowPicker(true)}
            className="bg-zinc-800 rounded-xl py-3 px-6 flex-row items-center"
            activeOpacity={0.8}
          >
            <Ionicons name="server" size={16} color="#d4d4d8" />
            <Text className="text-zinc-300 font-bold text-sm ml-2">Switch Server</Text>
          </TouchableOpacity>
        </View>

        {/* Server picker modal from error state */}
        <Modal visible={showPicker} transparent animationType="slide">
          <ServerPicker
            providers={providers}
            currentId={providerId}
            onSelect={switchProvider}
            onClose={() => setShowPicker(false)}
            getDisplayName={getProviderDisplayName}
          />
        </Modal>
      </View>
    );
  }

  // ── Empty URL guard ──
  if (!watchUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-8">
        <View className="w-16 h-16 rounded-full bg-zinc-800 items-center justify-center mb-5">
          <Ionicons name="server" size={28} color="#534f4c" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">No player available</Text>
        <Text className="text-zinc-500 text-sm mb-8 text-center leading-5">
          No streaming servers are available. Try selecting a different server.
        </Text>
        <TouchableOpacity
          onPress={() => setShowPicker(true)}
          className="bg-gold rounded-xl py-3 px-6 flex-row items-center"
          activeOpacity={0.8}
        >
          <Ionicons name="server" size={16} color="#000" />
          <Text className="text-black font-bold text-sm ml-2">Choose Server</Text>
        </TouchableOpacity>
        <Modal visible={showPicker} transparent animationType="slide">
          <ServerPicker
            providers={providers}
            currentId={providerId}
            onSelect={switchProvider}
            onClose={() => setShowPicker(false)}
            getDisplayName={getProviderDisplayName}
          />
        </Modal>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      {/* ── Animated overlay bar (fades in/out) ── */}
      <Animated.View
        className="absolute top-0 left-0 right-0 z-30"
        style={{ opacity: overlayOpacity, paddingTop: insets.top + 4 }}
        pointerEvents={overlayVisible ? 'box-none' : 'none'}
      >
        <View className="flex-row items-center justify-between px-4">
          {/* Close / Shrink button (top left) */}
          <TouchableOpacity
            onPress={isFullscreen ? () => setIsFullscreen(false) : handleClose}
            className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
            activeOpacity={0.7}
            style={{ pointerEvents: 'auto' }}
          >
            <Ionicons
              name={isFullscreen ? 'contract' : 'chevron-down'}
              size={20}
              color="#fff"
            />
          </TouchableOpacity>

          {/* Center: Title or Season/Episode badge (for TV) */}
          {isTV && !isFullscreen && (
            <TouchableOpacity
              onPress={() => {
                setTempSeason(currentSeason);
                setTempEpisode(currentEpisode);
                setShowEpPicker(true);
              }}
              activeOpacity={0.7}
              style={{ pointerEvents: 'auto' }}
            >
              <View className="bg-black/60 rounded-full px-3 py-1.5 border border-amber-500/30 flex-row items-center">
                <Text className="text-white text-xs font-bold">
                  S{String(currentSeason).padStart(2, '0')}:E{String(currentEpisode).padStart(2, '0')}
                </Text>
                <Ionicons name="chevron-down" size={12} color="#a1a1aa" style={{ marginLeft: 4 }} />
              </View>
            </TouchableOpacity>
          )}

          {/* Right group: Server switcher + Fullscreen */}
          <View className="flex-row items-center gap-2" style={{ pointerEvents: 'auto' }}>
            <TouchableOpacity
              onPress={() => setShowPicker(true)}
              className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
              activeOpacity={0.7}
            >
              <Ionicons name="server" size={16} color="#e8a020" />
            </TouchableOpacity>
            {providerId !== 'nxsha' && providerId !== 'chillflix' && (
              <TouchableOpacity
                onPress={() => setIsFullscreen(!isFullscreen)}
                className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isFullscreen ? 'contract' : 'expand'}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>

      {/* ── Server pill (bottom) — also fades with overlay ── */}
      <Animated.View
        className="absolute bottom-0 left-0 right-0 z-30 px-4"
        style={{ opacity: overlayOpacity, paddingBottom: insets.bottom + 12 }}
        pointerEvents={overlayVisible ? 'box-none' : 'none'}
      >
        <TouchableOpacity
          onPress={() => setShowPicker(true)}
          onLongPress={() => {
            setAuditMode((m) => {
              const next = !m;
              console.warn(`[Audit] Mode ${next ? 'ENABLED' : 'DISABLED'} — ${next ? 'long-press again or toggle off to see results' : 'data dispatched to onAuditData'}`);
              if (next) setAuditHosts([]);
              return next;
            });
          }}
          activeOpacity={0.8}
          className="self-center bg-black/60 backdrop-blur-md rounded-full px-4 py-2.5 flex-row items-center border border-zinc-700/40"
          style={{ pointerEvents: 'auto' }}
        >
          <Ionicons name="server" size={13} color="#e8a020" />
          <Text className="text-white text-xs font-semibold ml-2 mr-1" numberOfLines={1}>
            {currentProvider ? getProviderDisplayName(currentProvider) : 'Server'}
          </Text>
          {auditMode && (
            <View className="bg-amber-500/20 rounded px-1.5 py-0.5 mr-1">
              <Text className="text-amber-400 text-[9px] font-bold tracking-wider">AUDIT</Text>
            </View>
          )}
          <Ionicons name="chevron-up" size={14} color="#71717a" />
        </TouchableOpacity>
      </Animated.View>

      {/* ── Modals ── */}
      <Modal visible={showPicker} transparent animationType="slide">
        <ServerPicker
          providers={providers}
          currentId={providerId}
          onSelect={switchProvider}
          onClose={() => setShowPicker(false)}
          getDisplayName={getProviderDisplayName}
        />
      </Modal>

      <EpisodePickerModal
        visible={showEpPicker}
        tvId={isTV ? id : null}
        currentSeason={currentSeason}
        currentEpisode={currentEpisode}
        onSelect={(season, episode) => {
          setCurrentSeason(season);
          setCurrentEpisode(episode);
          setShowEpPicker(false);
          // Only show loading if episode actually changed (prevents infinite spinner
          // when user taps the same episode they're already watching)
          if (season !== currentSeason || episode !== currentEpisode) {
            setMountGen((g) => g + 1);
            setLoading(true);
          }
        }}
        onClose={() => setShowEpPicker(false)}
      />

      {/* ── Audit Results Modal ── */}
      <Modal
        visible={auditHosts.length > 0 && !auditMode}
        transparent
        animationType="fade"
        onRequestClose={() => setAuditHosts([])}
      >
        <View className="flex-1 bg-black/70 items-center justify-center px-6">
          <View className="bg-zinc-900 rounded-2xl w-full max-h-[60%] p-5 border border-zinc-800">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center gap-2">
                <Ionicons name="radio-outline" size={18} color="#e8a020" />
                <Text className="text-white text-lg font-bold">Discovered Domains</Text>
              </View>
              <TouchableOpacity onPress={() => setAuditHosts([])} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color="#71717a" />
              </TouchableOpacity>
            </View>

            <Text className="text-zinc-400 text-xs mb-3">
              {auditHosts.length} unique hosts captured during this session.
              Review and add unknown ad/tracker domains to the blocklist.
            </Text>

            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              {auditHosts.map((host, i) => (
                <View
                  key={host}
                  className="flex-row items-center py-2 px-3 rounded-lg mb-1 bg-zinc-800/50"
                >
                  <Text className="text-zinc-300 text-xs font-mono flex-1">{host}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      // Copy to clipboard (console for now)
                      console.warn(`[Audit] Copy: ${host}`);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="copy-outline" size={14} color="#71717a" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              onPress={() => {
                const json = JSON.stringify(auditHosts, null, 2);
                console.warn(`[Audit] JSON export:\n${json}`);
                setAuditHosts([]);
              }}
              className="bg-gold rounded-xl py-3 mt-4 items-center"
              activeOpacity={0.8}
            >
              <Text className="text-black font-bold text-sm">Export & Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Loading overlay ── */}
      {loading && (
        <View className="absolute inset-0 z-20 items-center justify-center bg-black/80">
          <View className="items-center">
            <ActivityIndicator size="large" color="#e8a020" />
            <Text className="text-zinc-500 text-sm mt-4">Loading player...</Text>
          </View>
        </View>
      )}

      {/* ── Tap-to-reveal layer (only in fullscreen when overlay is hidden) ── */}
      {isFullscreen && !overlayVisible && (
        <TouchableOpacity
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 25,
          }}
          activeOpacity={1}
          onPress={showOverlay}
        />
      )}

      {/* ── Player area ── */}
      <View
        style={
          !isFullscreen
            ? {
                height: providerId === 'nxsha'  ? SCREEN_HEIGHT * 0.40 : SCREEN_HEIGHT * 0.68,
                justifyContent: 'center',
                marginTop: insets.top + 40,
              }
            : { flex: 1 }
        }
      >
        {/* ── Backdrop image placeholder ──
            Renders behind the WebView during the initial slide-in animation
            and while the provider loads. Uses the cached image from the
            detail page — insta-renders with no network cost.
            Only shown when loading or during the slide-in deferral. */}
        {backdropUrl && loading && (
          <Image
            source={{ uri: getImageUrl(backdropUrl, 'w780') }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            resizeMode="cover"
            blurRadius={Platform.OS === 'android' ? 10 : 20}
          />
        )}
        <View
          style={
            !isFullscreen
              ? {
                  width: '100%',
                  height: '100%',
                  backgroundColor: '#000',
                }
              : { flex: 1 }
          }
        >
            <PlayerWebView
              key={webViewKey}
              ref={webViewRef}
              source={{ uri: slideInReady ? watchUrl : '' }}
              style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
              allowsFullscreenVideo={true}
              injectedJavaScriptBeforeContentLoaded={
                currentProvider?.baseUrl
                  ? makeConsolidatedScript(new URL(currentProvider.baseUrl).hostname, currentProvider.id)
                  : ''
              }
              referrer={currentProvider?.baseUrl || ''}
              setSupportMultipleWindows={false}
              javaScriptCanOpenWindowsAutomatically={false}
              auditMode={auditMode}
              onAuditData={(event) => {
                const { hosts: hostsStr, count, hostsDetailed } = event.nativeEvent;
                const domains = hostsStr ? hostsStr.split(',').filter(Boolean) : [];
                setAuditHosts(domains);
                console.warn(`[Audit] Collected ${count} hosts:`);
                domains.forEach((d) => console.warn(`[Audit]   ${d}`));
                if (hostsDetailed) {
                  console.warn(`[Audit] Detailed metadata:\n${hostsDetailed}`);
                }
              }}
              userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36"
              onLoadingStart={(event) => {
                console.warn(`[WebView] onLoadingStart: ${event.nativeEvent.url.substring(0, 100)}`);
                navigationReceivedRef.current = true;
              }}
              onLoadingFinish={(event) => {
                console.warn(`[WebView] onLoadingFinish: ${event.nativeEvent.url.substring(0, 100)}`);
                setLoading(false);
                // Generation-aware bootstrap timeout (kept for consistency)
                const gen = navigationGenRef.current;
                setTimeout(() => {
                  if (navigationGenRef.current === gen && !pageLoadedRef.current) {
                    pageLoadedRef.current = true;
                    console.warn(`[WebView] bootstrap locked (gen=${gen})`);
                  }
                }, 15000);

                // ── Seek video to resume point (via postMessage bridge) ──
                const seekTime = startAtRef.current;
                if (seekTime > 5) {
                  webViewRef.current?.injectJavaScript(`
                    if (window.__playerSeek) {
                      window.__playerSeek(${Math.floor(seekTime)}, true);
                    }
                    true;
                  `);
                  // Reset so it doesn't re-fire on subsequent navigations
                  startAtRef.current = 0;
                }
              }}
              onHttpError={(syntheticEvent) => {
                const err = syntheticEvent.nativeEvent;
                console.warn(`[WebView] HTTP ${err.statusCode}: ${err.description?.substring(0, 100) ?? ''}`);
                setLoading(false);
                // Cloudflare 403 (Toustream) — show error so user switches provider
                if (err.statusCode === 403 && providerId === 'toustream') {
                  setError('Server 19 is behind Cloudflare protection and cannot be accessed directly. Please try a different server.');
                }
              }}
              onRenderProcessGone={(event) => {
                // WebView renderer crashed — force remount to recover
                const didCrash = event.nativeEvent?.didCrash ?? true;
                console.warn(`[WebView] Render process gone (crash=${didCrash}) — remounting`);
                setLoading(true);
                setMountGen((g) => g + 1);
              }}
              onMessage={(event) => {
                try {
                  const data = JSON.parse(event.nativeEvent.data);
                  // ── DIAGNOSTIC: dump page HTML and iframe sources ──
                  if (data.type === '__diag') {
                    console.warn('[DIAG] url:', data.url);
                    console.warn('[DIAG] iframes:', JSON.stringify(data.iframes));
                    console.warn('[DIAG] body (truncated):', data.html?.substring(0, 500));
                    return;
                  }
                  // ── Bridge diagnostics from injected postMessage script ──
                  if (data.type === 'player:diag') {
                    console.warn(`[BRIDGE] ${JSON.stringify(data.data)}`);
                    return;
                  }
                  // ── Content-ready: hide loading spinner when provider page loads ──
                  // This works around the native event dispatch issue in Fabric mode
                  // (onLoadingStart/onLoadingFinish never fire from the native module).
                  if (data.type === 'cf:content-ready') {
                    setLoading(false);
                    navigationReceivedRef.current = true;
                    pageLoadedRef.current = true;
                    // Seek to resume point if history loaded and we haven't sought yet
                    const seekTime = startAtRef.current;
                    if (seekTime > 5) {
                      webViewRef.current?.injectJavaScript(`
                        if (window.__playerSeek) {
                          window.__playerSeek(${Math.floor(seekTime)}, true);
                        }
                        true;
                      `);
                      startAtRef.current = 0;
                    }
                    return;
                  }
                  if (data.type === 'cf:fullscreen' && (providerId === 'nxsha' || providerId === 'chillflix' || providerId === 'toustream')) {
                    if (data.entering) {
                      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
                      setOverlayVisible(false);
                      overlayOpacity.setValue(0);
                    } else {
                      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
                      setOverlayVisible(true);
                      Animated.timing(overlayOpacity, {
                        toValue: 1,
                        duration: 200,
                        useNativeDriver: true,
                      }).start();
                    }
                  }
                  // ── Console bridge output (for debugging provider pages) ──
                  if (data.type === 'console') {
                    const level = data.level || 'log';
                    const args = data.args || [];
                    const text = args.join(' ');
                    if (level === 'error' || level === 'warn') {
                      console.warn(`[Page:${level.toUpperCase()}] ${text}`);
                    }
                    // Don't forward to user — just for diagnostics
                  }
                  // ── Progress tracking ──
                  if (data.type === 'player:progress' || data.type === 'screenscape:progress') {
                    const { currentTime = 0, duration = 0, percent: pct = 0 } = data.data ?? {};
                    const newPct = duration > 0 ? currentTime / duration : pct;
                    const prevPct = progressRef.current.percent;

                    // Log incoming progress for diagnostics
                    console.warn('[BRIDGE] Progress event:', JSON.stringify({ currentTime, duration, pct: newPct }));

                    // Only advance progressRef forward — don't let a new provider's
                    // 0% overwrite the existing position (unified progress across providers).
                    if (newPct >= prevPct) {
                      progressRef.current = { currentTime, duration, percent: newPct };
                    }

                    // ── Persist progress to AsyncStorage (throttled) ──
                    if (currentTime > 5) {
                      // Save if 5% jump since last save, or nearing completion
                      const pctDiff = newPct - lastSavePctRef.current;
                      if (pctDiff >= 0.05 || newPct >= 0.95) {
                        lastSavePctRef.current = newPct;
                        saveProgress({
                          tmdbId: id,
                          mediaType: type,
                          providerId: providerId,
                          currentTime,
                          duration,
                          percent: newPct,
                          season: isTV ? currentSeason : undefined,
                          episode: isTV ? currentEpisode : undefined,
                          updatedAt: Date.now(),
                          completed: newPct >= 0.95,
                        }).catch(() => {});
                      }
                    }

                    // ── TV episode: mark complete at 95%+ ──
                    if (isTV && prevPct < 0.95 && newPct >= 0.95) {
                      markCompleted(id, 'tv', currentSeason, currentEpisode).catch(() => {});
                    }
                  }
                } catch(e) {}
              }}
            />
          </View>
        </View>
      </View>
    );
  }

// ── Season/Episode Picker Modal ────────────────────────────────

function EpisodePickerModal({
  visible,
  tvId,
  currentSeason,
  currentEpisode,
  onSelect,
  onClose,
}: {
  visible: boolean;
  tvId: string | null;
  currentSeason: number;
  currentEpisode: number;
  onSelect: (season: number, episode: number) => void;
  onClose: () => void;
}) {
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');
  const [pickerSeason, setPickerSeason] = useState(currentSeason);

  const {
    data: seasonData,
    isLoading,
    isError,
  } = useSeasonEpisodes(tvId!, pickerSeason);
  const { data: tvData } = useTVSeasonsOnly(tvId!);

  const episodes = (seasonData?.episodes as any[]) ?? [];
  const seasons =
    (tvData?.seasons as any[])
      ?.filter((s: any) => s.season_number > 0 && s.episode_count > 0)
      ?.map((s: any) => s.season_number) ?? [];

  // Reset picker season when modal opens
  useEffect(() => {
    if (visible) {
      setPickerSeason(currentSeason);
    }
  }, [visible, currentSeason]);

  // ── Load watch history for resume indicators ──
  const [episodeProgress, setEpisodeProgress] = useState<Record<string, WatchProgress>>({});
  useEffect(() => {
    if (!tvId || !visible) return;
    getProgress(tvId, 'tv', pickerSeason, 0).then(() => {
      // Load all episodes for this season from watch history
      (async () => {
        const map: Record<string, WatchProgress> = {};
        const eps = episodes;
        const results = await Promise.all(
          eps.map((ep: any) => {
            const epNum = ep.episode_number;
            if (!epNum) return Promise.resolve(null);
            return getProgress(tvId, 'tv', pickerSeason, epNum)
              .then(p => ({ epNum, p }));
          })
        );
        for (const r of results) {
          if (r && r.p) {
            map[`${pickerSeason}:${r.epNum}`] = r.p;
          }
        }
        setEpisodeProgress(map);
      })();
    }).catch(() => {});
  }, [tvId, pickerSeason, visible]);

  const SHEET_HEIGHT = SCREEN_HEIGHT * 0.4;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/60">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />

        <View
          className="bg-zinc-900 rounded-t-2xl"
          style={{ height: SHEET_HEIGHT, paddingBottom: 8 }}
        >
          {/* Handle */}
          <View className="items-center py-2">
            <View className="w-8 h-0.5 rounded-full bg-zinc-600" />
          </View>

          {/* Season pills */}
          {seasons.length > 0 && (
            <View className="pb-2 border-b border-zinc-800/50">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
              >
                {seasons.map((s: number) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setPickerSeason(s)}
                    activeOpacity={0.7}
                    className={`px-3.5 py-1.5 rounded-full ${
                      s === pickerSeason
                        ? 'bg-gold'
                        : 'bg-zinc-800 border border-zinc-700/40'
                    }`}
                  >
                    <Text
                      className={`text-[11px] font-bold ${
                        s === pickerSeason ? 'text-black' : 'text-zinc-300'
                      }`}
                    >
                      Season {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Episode list */}
          {isLoading ? (
            <View className="items-center justify-center py-6">
              <ActivityIndicator size="small" color="#e8a020" />
              <Text className="text-zinc-500 text-xs mt-2">Loading episodes...</Text>
            </View>
          ) : isError ? (
            <View className="items-center justify-center py-8 px-6">
              <Ionicons name="alert-circle-outline" size={24} color="#ef4444" />
              <Text className="text-zinc-400 text-xs mt-2 text-center">
                Failed to load episodes
              </Text>
            </View>
          ) : episodes.length === 0 ? (
            <View className="items-center justify-center py-8">
              <Ionicons name="tv-outline" size={24} color="#52525b" />
              <Text className="text-zinc-600 text-xs mt-2">No episodes for this season</Text>
            </View>
          ) : (
            <ScrollView
              className="flex-1 px-3 pt-1.5"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {episodes.map((ep: any, index: number) => {
                const epNum = ep.episode_number;
                const isActive = pickerSeason === currentSeason && epNum === currentEpisode;
                const progKey = `${pickerSeason}:${epNum}`;
                const epProg = episodeProgress[progKey];
                const hasProgress = epProg && !epProg.completed && epProg.percent > 0.05;
                const isCompleted = epProg?.completed;

                return (
                  <TouchableOpacity
                    key={ep.id ?? index}
                    onPress={() => onSelect(pickerSeason, epNum ?? 1)}
                    activeOpacity={0.7}
                    className={`flex-row rounded-lg overflow-hidden mb-1.5 ${
                      isActive
                        ? 'bg-gold/10 border border-amber-500/20'
                        : 'bg-zinc-800/40'
                    }`}
                  >
                    {/* Thumbnail */}
                    <View className="w-[88px] bg-zinc-800">
                      <View className="aspect-[16/9]">
                        {ep.still_path ? (
                          <ProgressiveImage
                            uri={getImageUrl(ep.still_path, 'w300')}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View className="w-full h-full items-center justify-center">
                            <Ionicons name="tv-outline" size={16} color="#52525b" />
                          </View>
                        )}
                        {/* Play icon on current episode */}
                        {isActive && (
                          <View className="absolute inset-0 items-center justify-center">
                            <View className="w-5 h-5 rounded-full bg-gold items-center justify-center">
                              <Ionicons name="play" size={8} color="#000" />
                            </View>
                          </View>
                        )}
                        {/* Resume badge on partially-watched episodes */}
                        {hasProgress && !isActive && (
                          <View className="absolute bottom-0 left-0 right-0">
                            <View className="h-0.5 bg-zinc-700/80">
                              <View
                                className="h-full bg-gold"
                                style={{ width: `${Math.round(epProg.percent * 100)}%` }}
                              />
                            </View>
                            <View className="bg-black/70 px-1 py-0.5">
                              <Text className="text-gold text-[8px] font-bold">
                                {Math.round(epProg.percent * 100)}%
                              </Text>
                            </View>
                          </View>
                        )}
                        {/* Checkmark on completed episodes */}
                        {isCompleted && !isActive && (
                          <View className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-green-600 items-center justify-center">
                            <Ionicons name="checkmark" size={10} color="#fff" />
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Info */}
                    <View className="flex-1 px-2.5 py-1.5 justify-center">
                      <Text
                        className="text-white text-[13px] font-bold leading-tight"
                        numberOfLines={1}
                      >
                        {ep.name || `Episode ${epNum ?? index + 1}`}
                      </Text>
                      <View className="flex-row items-center gap-1 mt-0.5">
                        <Text className="text-zinc-400 text-[10px] font-semibold">
                          E{String(epNum ?? index + 1).padStart(2, '0')}
                        </Text>
                        {ep.runtime ? (
                          <>
                            <Text className="text-zinc-600 text-[10px]">·</Text>
                            <Text className="text-zinc-400 text-[10px]">{ep.runtime}m</Text>
                          </>
                        ) : null}
                        {ep.air_date ? (
                          <>
                            <Text className="text-zinc-600 text-[10px]">·</Text>
                            <Text className="text-zinc-500 text-[10px]">
                              {ep.air_date}
                            </Text>
                          </>
                        ) : null}
                      </View>
                      {ep.overview ? (
                        <Text
                          className="text-zinc-500 text-[10px] leading-tight mt-0.5"
                          numberOfLines={2}
                        >
                          {ep.overview}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Bottom Sheet Server Picker ─────────────────────────────────

function ServerPicker({
  providers,
  currentId,
  onSelect,
  onClose,
  getDisplayName,
}: {
  providers: ProviderDefinition[];
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  getDisplayName: (p: ProviderDefinition) => string;
}) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');

  return (
    <View className="flex-1 justify-end bg-black/60">
      <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />

      <View
        className="bg-zinc-900 rounded-t-3xl"
        style={{ maxHeight: SCREEN_HEIGHT * 0.6, paddingBottom: insets.bottom + 16 }}
      >
        {/* Handle */}
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 rounded-full bg-zinc-600" />
        </View>

        {/* Header */}
        <View className="flex-row items-center justify-between px-6 py-3 border-b border-zinc-800">
          <Text className="text-white text-lg font-bold">Select Server</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color="#71717a" />
          </TouchableOpacity>
        </View>

        {/* Server list */}
        <ScrollView className="px-4 pt-2" showsVerticalScrollIndicator={false}>
          {providers.map((p, index) => {
            const isActive = p.id === currentId;
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => onSelect(p.id)}
                activeOpacity={0.7}
                className={`flex-row items-center px-4 py-4 rounded-xl mb-1 ${
                  isActive ? 'bg-gold/10 border border-amber-500/20' : 'bg-zinc-800/40'
                }`}
              >
                {/* Icon */}
                <View
                  className={`w-10 h-10 rounded-full items-center justify-center mr-4 ${
                    isActive ? 'bg-gold' : 'bg-zinc-700'
                  }`}
                >
                  {isActive ? (
                    <Ionicons name="checkmark" size={18} color="#000" />
                  ) : (
                    <Ionicons name="server-outline" size={16} color="#71717a" />
                  )}
                </View>

                {/* Name */}
                <View className="flex-1">
                  <Text
                    className={`text-base font-semibold ${
                      isActive ? 'text-amber-400' : 'text-zinc-200'
                    }`}
                  >
                    {getDisplayName(p)}
                  </Text>
                  <Text className="text-zinc-600 text-xs mt-0.5">
                    {isActive ? 'Currently active' : 'Tap to switch'}
                  </Text>
                </View>

                {/* Active indicator */}
                {isActive && (
                  <View className="w-2 h-2 rounded-full bg-gold" />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
