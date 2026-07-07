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
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getEnabledProviders, getImageUrl } from '@filmsnaps/shared';
import type { ProviderDefinition } from '@filmsnaps/shared';
import { useSeasonEpisodes, useTVSeasonsOnly } from '../hooks/useTMDB';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';

const POPUP_BLOCKER_SCRIPT = `
(function() {
  // ── Popup / Navigation blocking (Layer 1) ──
  var _origOpen = window.open;
  window.open = function() { try{ return new Proxy({}, {get:function(){return function(){return null}}}); }catch(e){ return null; } };
  Object.defineProperty(window, 'open', { value: function() { try{ return new Proxy({}, {get:function(){return function(){return null}}}); }catch(e){ return null; } }, writable: false, configurable: false });
  try {
    var _locDesc = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      set: function(val) { return; },
      get: function() { return _locDesc ? _locDesc.get.call(window) : window.location; },
      configurable: false
    });
  } catch(e) {}

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
  ];

  function isAdUrl(url) {
    if (!url || typeof url !== 'string') return false;
    var l = url.toLowerCase();
    for (var i = 0; i < AD_PATTERNS.length; i++) {
      if (l.indexOf(AD_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }

  // Block fetch to ad domains
  try {
    var _fetch = window.fetch;
    window.fetch = function(input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (isAdUrl(url)) { console.log('[AB] block fetch:', url); return Promise.resolve(new Response('', {status: 204})); }
      return _fetch.call(window, input, init);
    };
  } catch(e) {}

  // Block XHR to ad domains
  try {
    var _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (isAdUrl(url)) { this._aborted = true; console.log('[AB] block xhr:', url); return; }
      return _xhrOpen.apply(this, arguments);
    };
    var _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      if (this._aborted) return;
      return _xhrSend.apply(this, arguments);
    };
  } catch(e) {}

  // Intercept iframe creation with ad src
  try {
    var _createEl = document.createElement.bind(document);
    document.createElement = function(tag, opts) {
      var el = _createEl(tag, opts);
      if (tag.toLowerCase() === 'iframe') {
        var _setAttr = el.setAttribute.bind(el);
        el.setAttribute = function(name, val) {
          if (name === 'src' && isAdUrl(val)) { console.log('[AB] block iframe:', val); return; }
          return _setAttr(name, val);
        };
        try {
          Object.defineProperty(el, 'src', {
            set: function(v) { if (!isAdUrl(v)) _setAttr('src', v); else console.log('[AB] iframe src blocked'); },
            get: function() { return el.getAttribute('src'); },
            configurable: true
          });
        } catch(e) {}
      }
      return el;
    };
  } catch(e) {}

  // MutationObserver: remove injected ad iframes
  try {
    var obs = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var n = muts[i].addedNodes[j];
          if (n.nodeType !== 1) continue;
          // Only remove iframes from ad domains — don't touch overlays since peachify
          // uses fixed-position modals for settings/language/captions.
          if (n.tagName === 'IFRAME') {
            var src = n.getAttribute('src') || n.src || '';
            if (isAdUrl(src)) { n.remove(); console.log('[AB] removed ad iframe'); }
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  // Periodic cleanup every 2s for ad iframes that slip through
  setInterval(function() {
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        var src = iframes[i].getAttribute('src') || iframes[i].src || '';
        if (isAdUrl(src)) { iframes[i].remove(); console.log('[AB] periodic: removed ad iframe'); }
      }
    } catch(e) {}
  }, 2000);

  // ── Click interception: block navigation to external domains (Layer 5) ──
  // Some providers use <a> links that navigate the page to ad URLs.
  // These bypass window.open and location.set since they're native browser navs.
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || el.href;
        if (href && href.indexOf('#') !== 0 && href.indexOf('javascript:') !== 0) {
          try {
            var u = new URL(href, location.href);
            if (u.hostname !== location.hostname) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              console.log('[AB] Blocked ad link click:', u.hostname + u.pathname);
              return false;
            }
          } catch(err) {}
        }
        break;
      }
      // Check if the actual target is a button or image inside an anchor
      if (el.tagName === 'BUTTON' || el.tagName === 'IMG') {
        var parent = el.parentElement;
        while (parent && parent !== document.body) {
          if (parent.tagName === 'A') {
            var phref = parent.getAttribute('href') || parent.href;
            if (phref && phref.indexOf('#') !== 0 && phref.indexOf('javascript:') !== 0) {
              try {
                var pu = new URL(phref, location.href);
                if (pu.hostname !== location.hostname) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  console.log('[AB] Blocked ad link click (parent):', pu.hostname + pu.pathname);
                  return false;
                }
              } catch(err) {}
            }
            break;
          }
          parent = parent.parentElement;
        }
      }
      el = el.parentElement;
    }
  }, true);

  // ── Form submission blocking (Layer 6) ──
  // Some providers use hidden forms that auto-submit to ad domains.
  document.addEventListener('submit', function(e) {
    var action = e.target && (e.target.getAttribute('action') || e.target.action);
    if (action && action.indexOf('#') !== 0) {
      try {
        var au = new URL(action, location.href);
        if (au.hostname !== location.hostname) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('[AB] Blocked form submit to:', au.hostname + au.pathname);
          return false;
        }
      } catch(err) {}
    }
  }, true);

  // ── Block location.replace & location.assign (Layer 7) ──
  // Some providers use these to redirect to ad pages even though the
  // location setter is frozen. This intercepts the methods directly.
  try {
    var _locReplace = window.location.constructor.prototype.replace;
    window.location.constructor.prototype.replace = function(url) {
      try {
        var u = new URL(url, location.href);
        if (u.hostname !== location.hostname) {
          console.log('[AB] Blocked location.replace:', u.hostname);
          return;
        }
      } catch(e) {}
      return _locReplace.call(this, url);
    };
  } catch(e) {}
  try {
    var _locAssign = window.location.constructor.prototype.assign;
    window.location.constructor.prototype.assign = function(url) {
      try {
        var u = new URL(url, location.href);
        if (u.hostname !== location.hostname) {
          console.log('[AB] Blocked location.assign:', u.hostname);
          return;
        }
      } catch(e) {}
      return _locAssign.call(this, url);
    };
  } catch(e) {}

  // ── Block window.location.href / document.location.href (Layer 7b) ──
  // Combined with Layer 10 download blocking below.
  // ── Overlay ad removal + auto-skip (Layer 8, enhanced) ──
  // Many providers inject ad overlays (iframes / divs) over the video.
  // This aggressively removes them and auto-clicks "Skip" buttons.
  setInterval(function() {
    try {
      // 1. Auto-click skip buttons in ad overlays.
      // Only target obvious ad-skip text — generic words like "close", "×",
      // or "dismiss" are too broad and kill provider settings dialogs.
      var skipTexts = ['skip', 'skip ad', 'close ad', 'continue',
                       'continue to video'];
      var clickables = document.querySelectorAll('button, a, span, div[role="button"]');
      for (var bi = 0; bi < clickables.length; bi++) {
        var txt = (clickables[bi].textContent || '').trim().toLowerCase();
        if (txt.length > 0 && txt.length < 30) {
          for (var si = 0; si < skipTexts.length; si++) {
            if (txt === skipTexts[si] || txt.indexOf(skipTexts[si]) !== -1) {
              var cs = window.getComputedStyle(clickables[bi]);
              // Only click if it's in a floating/ad element, not the main page
              if (cs.position === 'fixed' || cs.position === 'sticky' ||
                  parseInt(cs.zIndex) > 50 || clickables[bi].closest('[style*="fixed"],[style*="z-index"]')) {
                clickables[bi].click();
                console.log('[AB] Auto-clicked:', txt);
              }
            }
          }
        }
      }

      // 2. Remove ad iframes — any large iframe on an external domain
      // that doesn't contain known video player patterns.
      var iframes = document.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        var src = (iframes[fi].src || '').toLowerCase();
        var w = iframes[fi].offsetWidth;
        var h = iframes[fi].offsetHeight;
        if (w > 150 && h > 150) {
          try {
            var iu = new URL(src);
            if (iu.hostname !== location.hostname) {
              // Allow known video/embed domains through
              var videoDomain = false;
              if (iu.hostname.indexOf('vidsrc') !== -1 ||
                  iu.hostname.indexOf('embed') !== -1 ||
                  iu.hostname.indexOf('player') !== -1 ||
                  iu.hostname.indexOf('video') !== -1 ||
                  iu.hostname.indexOf('cdn') !== -1 ||
                  iu.hostname.indexOf('peachify') !== -1) {
                videoDomain = true;
              }
              if (!videoDomain) {
                iframes[fi].remove();
                console.log('[AB] Removed ad iframe:', iu.hostname);
              }
            }
          } catch(e) {}
        }
      }

      // 3. Remove fixed/sticky overlays — any large element floating over
      // the content with high z-index that doesn't contain the actual video.
      // To avoid killing provider settings dialogs, we only remove overlays
      // that ALSO look like ads (no interactive controls, no settings-related text).
      var all = document.querySelectorAll('div, section, aside');
      for (var ei = 0; ei < all.length; ei++) {
        var el = all[ei];
        if (el.offsetWidth < 50 || el.offsetHeight < 50) continue;
        var cs = window.getComputedStyle(el);
        if ((cs.position === 'fixed' || cs.position === 'sticky') &&
            (parseInt(cs.zIndex) > 50 || cs.zIndex === '9999' || cs.zIndex === '99999')) {
          // Never remove if it wraps a video player
          if (el.querySelector('video, iframe[src*="vidsrc"], iframe[src*="embed"], .jwplayer, .video-js')) continue;
          // Don't remove settings-like dialogs (multiple buttons = settings, not ad)
          var btns = el.querySelectorAll('button, select, input, [role="button"]');
          if (btns.length >= 3) continue; // settings dialogs have many options
          // Don't remove if it has settings-related text
          var elTxt = (el.textContent || '').toLowerCase();
          if (elTxt.indexOf('settings') !== -1 || elTxt.indexOf('quality') !== -1 ||
              elTxt.indexOf('playback') !== -1 || elTxt.indexOf('audio') !== -1 ||
              elTxt.indexOf('captions') !== -1 || elTxt.indexOf('speed') !== -1 ||
              elTxt.indexOf('language') !== -1) continue;
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
          console.log('[AB] Removed overlay');
        }
      }
    } catch(e) {}
  }, 1200);

  // ── History manipulation blocking (Layer 9) ──
  try {
    var _pushState = history.pushState;
    history.pushState = function() { console.log('[AB] Blocked pushState'); return _pushState.call(this, null, ''); };
    var _replaceState = history.replaceState;
    history.replaceState = function() { console.log('[AB] Blocked replaceState'); return _replaceState.call(this, null, ''); };
  } catch(e) {}

  // ── Navigation + Download blocking (Layer 10, replaces Layer 7b) ──
  // Blocks both cross-hostname navigation AND file downloads (.apk, .zip, etc.)
  // at the Location.prototype.href level.
  var DOWNLOAD_EXTS = ['.apk', '.zip', '.exe', '.msi', '.dmg', '.rar', '.7z', '.tar.gz'];
  function isDownloadUrl(url) {
    if (!url || typeof url !== 'string') return false;
    var lower = url.toLowerCase();
    for (var di = 0; di < DOWNLOAD_EXTS.length; di++) {
      if (lower.indexOf(DOWNLOAD_EXTS[di]) !== -1) return true;
    }
    return false;
  }
  // Block <a download> clicks
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.tagName === 'A' && el.hasAttribute('download')) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        console.log('[AB] Blocked download link'); return false;
      }
      el = el.parentElement;
    }
  }, true);
  // Block navigation to download/ad URLs via location.href
  try {
    var _dlLocProto = Object.getPrototypeOf(window.location);
    if (_dlLocProto) {
      var _dlHrefDesc = Object.getOwnPropertyDescriptor(_dlLocProto, 'href');
      if (_dlHrefDesc && _dlHrefDesc.set) {
        var _origSet = _dlHrefDesc.set;
        Object.defineProperty(_dlLocProto, 'href', {
          set: function(val) {
            // Block downloads
            if (isDownloadUrl(val)) {
              console.log('[AB] Blocked download URL:', val.substring(0, 80));
              return;
            }
            // Block cross-hostname navigation (ad redirects)
            try {
              var u = new URL(val, location.href);
              if (u.hostname !== location.hostname) {
                console.log('[AB] Blocked navigation:', u.hostname);
                return;
              }
            } catch(e) {}
            return _origSet.call(this, val);
          },
          get: function() { return _dlHrefDesc.get.call(this); },
          configurable: false,
        });
      }
    }
  } catch(e) {}

  // ── Service Worker blocking (Layer 11) ──
  // Prevent providers from installing service workers which can
  // intercept all network requests, cache data, and send push notifications.
  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        for (var i = 0; i < regs.length; i++) { regs[i].unregister(); }
      });
      navigator.serviceWorker.register = function() {
        return Promise.reject(new Error('[AB] Service workers blocked'));
      };
      // Periodically sweep — some providers delay SW registration
      setInterval(function() {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          for (var i = 0; i < regs.length; i++) { regs[i].unregister(); }
        });
      }, 15000);
    }
  } catch(e) {}

  // ── eval() + Function() blocking (Layer 12) ──
  // Ad scripts commonly use eval() / new Function() to execute
  // dynamically-downloaded code. Blocking these breaks packed
  // ad payloads while still allowing normal provider scripts.
  try {
    var _origEval = window.eval;
    Object.defineProperty(window, 'eval', {
      value: function(str) {
        // Allow small JS (provider libs) but block large blobs (ads)
        if (typeof str === 'string' && str.length < 10000) {
          return _origEval.call(window, str);
        }
        console.log('[AB] Blocked eval (payload too large):', (str && str.length) || 0);
        return undefined;
      },
      writable: false,
      configurable: false,
    });
  } catch(e) {}

  // Block new Function() — used by packed ad scripts
  try {
    var _origFn = window.Function;
    window.Function = function() {
      console.log('[AB] Blocked new Function()');
      return function() {};
    };
    Object.defineProperty(window.Function.prototype, 'constructor', {
      value: function() { console.log('[AB] Blocked Function constructor'); return function() {}; },
      writable: false,
      configurable: false,
    });
  } catch(e) {}

  // ── Block document.write / writeln (Layer 13) ──
  // Providers sometimes use document.write to inject ad scripts
  // synchronously, bypassing normal DOM loading checks.
  try {
    document.write = function() {
      console.log('[AB] Blocked document.write');
    };
    document.writeln = function() {
      console.log('[AB] Blocked document.writeln');
    };
  } catch(e) {}

  // ── CSP meta tag injection ──
  // Injects a relaxed Content-Security-Policy to restrict resource loading
  // while still allowing provider video/script functionality.
  try {
    var cspMeta = document.createElement('meta');
    cspMeta.httpEquiv = 'Content-Security-Policy';
    cspMeta.content = "default-src 'self' * 'unsafe-inline' 'unsafe-eval'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' *; " +
      "frame-src *; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'";
    document.head.appendChild(cspMeta);
  } catch(e) {}

  // ── Cookie clearing on page load (disabled — breaks Anubis-protected ──
  // providers like toustream that require cookies for anti-bot verification).
  // Cookie isolation between providers is already handled by domain scoping
  // (each provider uses a different base URL) and the key-based WebView remount
  // on provider switch.
  //try { ... } catch(e) {}

  // ── ScreenScape: hide download app banner & ads timer (MutationObserver + periodic) ──
  try {
    function _hideSSBanner(root) {
      var _link = root.querySelector && root.querySelector('a[href="https://screenscape.fun"]');
      if (!_link) return;
      // Hide the link, the <p> after it, and the parent div
      _link.style.display = 'none';
      var _p = _link.nextElementSibling;
      while (_p) { _p.style.display = 'none'; _p = _p.nextElementSibling; }
      if (_link.parentElement) _link.parentElement.style.display = 'none';
    }
    function _hideSSAds(root) {
      var _adsBtn = root.querySelector && root.querySelector('button[aria-label^="Ads window ends"]');
      if (_adsBtn) _adsBtn.style.display = 'none';
    }
    // Observer catches dynamically-added elements
    var _ssObs = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        var nodes = muts[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'A' && n.getAttribute('href') === 'https://screenscape.fun') {
            if (n.parentElement) n.parentElement.style.display = 'none';
          } else if (n.tagName === 'BUTTON' && n.getAttribute('aria-label')?.indexOf('Ads window ends') === 0) {
            n.style.display = 'none';
          } else if (n.querySelector) {
            _hideSSBanner(n);
            _hideSSAds(n);
          }
        }
      }
    });
    _ssObs.observe(document.documentElement, { childList: true, subtree: true });
    // Periodic fallback — catches elements the observer misses (SPA re-renders, etc.)
    setInterval(function() {
      _hideSSBanner(document);
      _hideSSAds(document);
    }, 3000);
  } catch(e) {}
})();
true;
`;

// Minimal script for Cloudflare-protected providers (e.g. Nxsha, ChillFlix).
// Only overrides bot-detection properties — no ad blocking or navigation hooks.
// Accepts provider host dynamically for iframe ad blocking.
function makeCFBypassScript(providerHost: string) {
  return `
(function() {
  // ── Cloudflare bypass ──
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  }
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
    configurable: true,
  });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true,
  });
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (params) =>
    params.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(params);
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, param);
  };

  // ── Intercept fullscreen API → notify React Native for landscape lock ──
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

  // ── Minimal ad blocking (no location/pushState interference) ──
  var PROVIDER_HOST = '${providerHost}';
  function isOwnUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try { return new URL(u, location.href).hostname === PROVIDER_HOST; }
    catch(e) { return u.indexOf(PROVIDER_HOST) !== -1; }
  }
  window.open = function() { return null; };
  try {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.tagName === 'IFRAME') {
            var src = n.getAttribute('src') || '';
            if (!isOwnUrl(src)) { n.remove(); }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}
  setTimeout(function() {
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = iframes.length - 1; i >= 0; i--) {
        var src = iframes[i].getAttribute('src') || iframes[i].src || '';
        if (!isOwnUrl(src)) { iframes[i].remove(); }
      }
    } catch(e) {}
  }, 500);

  // ── Provider-specific UI cleanup ──
  // ChillFlix: hide watch party, login, sign in, create account buttons
  if (PROVIDER_HOST.indexOf('chillflix') !== -1) {
    var HIDE_KEYWORDS = ['watch party', 'login', 'log in', 'sign in', 'create account', 'sign up', 'free account'];
    var HIDE_ICONCLS = ['party', 'watchparty', 'watch-party'];
    function hideMatchingElements(root) {
      var els = root.querySelectorAll('button, a');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.style.display === 'none') continue;
        var txt = (el.textContent || '').toLowerCase().trim();
        var cls = (el.className || '').toString().toLowerCase();
        var aria = (el.getAttribute('aria-label') || '').toLowerCase();
        var title = (el.getAttribute('title') || '').toLowerCase();
        for (var j = 0; j < HIDE_KEYWORDS.length; j++) {
          if (txt.indexOf(HIDE_KEYWORDS[j]) !== -1 || aria.indexOf(HIDE_KEYWORDS[j]) !== -1 || title.indexOf(HIDE_KEYWORDS[j]) !== -1) {
            el.style.display = 'none';
            break;
          }
        }
        if (el.style.display !== 'none') {
          for (var k = 0; k < HIDE_ICONCLS.length; k++) {
            if (cls.indexOf(HIDE_ICONCLS[k]) !== -1) {
              el.style.display = 'none';
              break;
            }
          }
        }
      }
    }
    hideMatchingElements(document);
    setInterval(function() { hideMatchingElements(document); }, 3000);
  }

  // ── Nxsha: hide install banner & UI clutter (CSS + periodic cleanup) ──
  if (PROVIDER_HOST.indexOf('nxsha') !== -1) {
    var s = document.createElement('style');
    s.textContent = 'a[href="https://nxsha.app"]{display:none!important}.modal-ui .sticky{display:none!important}[class*="download"]{display:none!important}[class*="banner"] {display:none!important}';
    document.documentElement.appendChild(s);
    // Periodic sweep for elements that sneak past CSS (SPA re-renders, etc.)
    setInterval(function() {
      document.querySelectorAll('a[href*="nxsha.app"],a[href*="download"],a[href*="install"]').forEach(function(el) {
        el.style.display = 'none';
      });
      document.querySelectorAll('[class*="download"],[class*="banner"],[class*="install"]').forEach(function(el) {
        el.style.display = 'none';
      });
    }, 3000);
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

export function VideoWebView({
  type,
  id,
  season,
  episode,
  onClose,
  initialProvider,
}: VideoWebViewProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
  const webViewRef = useRef<WebView>(null);
  const providerHostRef = useRef<string>('');
  const navigationChainRef = useRef<Set<string>>(new Set());
  const pageLoadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);


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

  // When entering fullscreen → start auto-hide. When exiting → keep visible.
  useEffect(() => {
    if (isFullscreen) {
      scheduleHide();
    } else {
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
  const [showEpPicker, setShowEpPicker] = useState(false);
  const [currentSeason, setCurrentSeason] = useState<number>(season ?? 1);
  const [currentEpisode, setCurrentEpisode] = useState<number>(episode ?? 1);
  const [tempSeason, setTempSeason] = useState<number>(currentSeason);
  const [tempEpisode, setTempEpisode] = useState<number>(currentEpisode);

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

  const watchUrl = useMemo(() => {
    if (!currentProvider) return '';
    const embedPath =
      type === 'tv' && currentSeason && currentEpisode
        ? currentProvider.embed.tv(id, currentSeason, currentEpisode)
        : currentProvider.embed.movie(id);
    return `${currentProvider.baseUrl}${embedPath}`;
  }, [currentProvider, type, id, currentSeason, currentEpisode]);

  const handleOpenWindow = useCallback((syntheticEvent: any) => {
    console.warn('[PopupBlocker] Blocked popup window:', syntheticEvent.nativeEvent.targetUrl);
  }, []);

  const switchProvider = (newId: string) => {
    setProviderId(newId);
    setLoading(true);
    setError(null);
    setShowPicker(false);
    // Reset navigation chain for the new provider
    navigationChainRef.current = new Set();
    pageLoadedRef.current = false;
  };

  // Bump this to force WebView reload when season/episode changes
  const webViewKey = useMemo(
    () => `${providerId}-${isTV ? `${currentSeason}-${currentEpisode}` : 'movie'}`,
    [providerId, isTV, currentSeason, currentEpisode],
  );

  const getProviderDisplayName = (p: ProviderDefinition): string => {
    return p.displayName || p.name || p.id;
  };


  const retry = () => {
    if (error) {
      setError(null);
      setLoading(true);
    }
    webViewRef.current?.reload();
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
            onPress={isFullscreen ? () => setIsFullscreen(false) : onClose}
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
          activeOpacity={0.8}
          className="self-center bg-black/60 backdrop-blur-md rounded-full px-4 py-2.5 flex-row items-center border border-zinc-700/40"
          style={{ pointerEvents: 'auto' }}
        >
          <Ionicons name="server" size={13} color="#e8a020" />
          <Text className="text-white text-xs font-semibold ml-2 mr-1" numberOfLines={1}>
            {currentProvider ? getProviderDisplayName(currentProvider) : 'Server'}
          </Text>
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
          setLoading(true);
        }}
        onClose={() => setShowEpPicker(false)}
      />

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
                marginTop: insets.top + 24,
              }
            : { flex: 1 }
        }
      >
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
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{ uri: watchUrl }}
              style={{ flex: 1, backgroundColor: '#000' }}
              allowsFullscreenVideo={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              sharedCookiesEnabled={true}
              thirdPartyCookiesEnabled={true}
              startInLoadingState={true}
              injectedJavaScriptBeforeContentLoaded={
                (providerId === 'nxsha' || providerId === 'chillflix')
                  ? makeCFBypassScript(currentProvider?.baseUrl ? new URL(currentProvider.baseUrl).hostname : '')
                  : POPUP_BLOCKER_SCRIPT
              }
              allowsBackForwardNavigationGestures={false}
              setSupportMultipleWindows={false}
              // ── Security hardening ──
              geolocationEnabled={false}
              mixedContentMode="never"
              cacheEnabled={false}
              renderLoading={() => <View />}
              onShouldStartLoadWithRequest={(request) => {
                // Block intent:// URLs universally (ad popups trying to open Chrome)
                if (!request.url || request.url.startsWith('intent://')) return false;
                // CF-protected providers: allow only same-origin + player modal domains
                if (providerId === 'nxsha' || providerId === 'chillflix') {
                  const host = (() => { try { return new URL(request.url).hostname; } catch { return ''; }})();
                  const providerHost = currentProvider?.baseUrl ? new URL(currentProvider.baseUrl).hostname : '';
                  if (host === providerHost) return true;
                  return false;
                }
                // Chain tracking: record all domains during page load (first 5s),
                // then block any navigation to unvisited domains (likely ads).
                if (request.url) {
                  try {
                    const reqUrl = new URL(request.url);
                    const host = reqUrl.hostname.toLowerCase();

                    // During bootstrapping phase (first 5s after load), record
                    // all domains in the redirect chain so we can allow them.
                    if (!pageLoadedRef.current) {
                      navigationChainRef.current.add(host);
                      return true;
                    }

                    // After bootstrapping, only allow same-host or chain domains
                    if (host === providerHostRef.current ||
                        navigationChainRef.current.has(host)) {
                      return true;
                    }

                    // Unknown domain navigated to after page load → likely ad
                    console.warn('[AB] Blocked navigation to:', host);
                    return false;
                  } catch (e) {}
                }
                return true;
              }}
              onLoadStart={(event) => {}}
              onLoadEnd={(event) => {
                setLoading(false);
                // After page fully loads, allow 5s for provider redirect chain,
                // then lock it — any new domain after this is likely an ad.
                setTimeout(() => { pageLoadedRef.current = true; }, 5000);
              }}
              onError={(syntheticEvent) => {}}
              onMessage={(event) => {
                try {
                  const data = JSON.parse(event.nativeEvent.data);
                  if (data.type === 'cf:fullscreen' && (providerId === 'nxsha' || providerId === 'chillflix')) {
                    if (data.entering) {
                      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
                      setOverlayVisible(false);
                      overlayOpacity.setValue(0);
                    } else {
                      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL).catch(() => {});
                      setOverlayVisible(true);
                      Animated.timing(overlayOpacity, {
                        toValue: 1,
                        duration: 200,
                        useNativeDriver: true,
                      }).start();
                    }
                  }
                } catch(e) {}
              }}
              onOpenWindow={handleOpenWindow}
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
                          <Image
                            source={{ uri: getImageUrl(ep.still_path, 'w300') }}
                            className="w-full h-full"
                            resizeMode="cover"
                          />
                        ) : (
                          <View className="w-full h-full items-center justify-center">
                            <Ionicons name="tv-outline" size={16} color="#52525b" />
                          </View>
                        )}
                        {isActive && (
                          <View className="absolute inset-0 items-center justify-center">
                            <View className="w-5 h-5 rounded-full bg-gold items-center justify-center">
                              <Ionicons name="play" size={8} color="#000" />
                            </View>
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
