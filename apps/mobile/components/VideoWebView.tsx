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
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getEnabledProviders, getImageUrl } from '@filmsnaps/shared';
import { ProgressiveImage } from './ProgressiveImage';
import type { ProviderDefinition } from '@filmsnaps/shared';
import { useSeasonEpisodes, useTVSeasonsOnly } from '../hooks/useTMDB';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import { useQueryClient } from '@tanstack/react-query';
import { tmdbApi } from '../lib/api';
import { saveProgress, getResumePoint, getProgress, markCompleted } from '../lib/watchHistory';
import { getNextEpisode } from '../lib/tvUtils';
import type { WatchProgress } from '../lib/watchHistory';

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

  // ── DOM manipulation (deferred until DOMContentLoaded — avoids blocking page parse) ──
  function _domInit() {
    // MutationObserver: remove injected ad iframes (disconnect-reconnect pattern prevents jank)
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
              if (isAdUrl(src)) { n.remove(); console.log('[AB] removed ad iframe'); }
            }
          }
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch(e) {}
    // ── Phase B continues below with sweeper + ScreenScape ──
    _sweepAds();
    // ── ScreenScape: hide download app banner & ads timer (MutationObserver + periodic) ──
    try {
      function _hideSSBanner(root) {
        var _link = root.querySelector && root.querySelector('a[href="https://screenscape.fun"]');
        if (!_link) return;
        _link.style.display = 'none';
        var _p = _link.nextElementSibling;
        while (_p) { _p.style.display = 'none'; _p = _p.nextElementSibling; }
        if (_link.parentElement) _link.parentElement.style.display = 'none';
      }
      function _hideSSAds(root) {
        var _adsBtn = root.querySelector && root.querySelector('button[aria-label^="Ads window ends"]');
        if (_adsBtn) _adsBtn.style.display = 'none';
      }
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
      setInterval(function() {
        _hideSSBanner(document);
        _hideSSAds(document);
      }, 8000);
    } catch(e) {}

    // ── Video progress tracking (for predictive preloading) ──
    try {
      var _lastProgress = 0;
      window.addEventListener('message', function _progHandler(e) {
        // Server 2 (peachify) PLAYER_EVENT format
        if (e.data && e.data.type === 'PLAYER_EVENT') {
          var pd = e.data.data;
          if (pd && typeof pd.currentTime === 'number' && typeof pd.duration === 'number') {
            var pct = pd.duration > 0 ? pd.currentTime / pd.duration : 0;
            // Throttle: report at most every 5% progress
            if (pct - _lastProgress >= 0.05 || pct >= 0.95) {
              _lastProgress = pct;
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'player:progress',
                data: { currentTime: pd.currentTime, duration: pd.duration, percent: pct,
                        tmdbId: pd.tmdbId, mediaType: pd.mediaType,
                        season: pd.season, episode: pd.episode }
              }));
            }
          }
        }
        // Server 3 (screenscape) progress response
        if (e.data && e.data.type === 'SCREENSCAPE_WATCH_HISTORY_WITH_PROGRESS_RESPONSE') {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'screenscape:progress',
            data: e.data.watchHistory
          }));
        }
      });
      // Request progress from Screenscape player if present
      setTimeout(function() {
        try {
          var _ssIframe = document.getElementById('screenscape-player');
          if (_ssIframe && _ssIframe.contentWindow) {
            _ssIframe.contentWindow.postMessage({
              type: 'SCREENSCAPE_GET_WATCH_HISTORY_WITH_PROGRESS',
              requestId: 'filmsnaps-1'
            }, 'https://screenscape.me');
          }
        } catch(e) {}
      }, 5000);
    } catch(e) {}
  }
  // ── End of _domInit ──

  // Run Phase B after DOMContentLoaded (doesn't block page parse)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _domInit);
  } else {
    _domInit();
  }

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
    var _pushState = history.pushState;
    history.pushState = function() { console.log('[AB] Blocked pushState'); return _pushState.call(this, null, ''); };
    var _replaceState = history.replaceState;
    history.replaceState = function() { console.log('[AB] Blocked replaceState'); return _replaceState.call(this, null, ''); };
  } catch(e) {}
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

  // ── Overlay ad removal + auto-skip (Layer 8, observer-driven, no fixed interval) ──
  // Instead of scanning the full DOM every 1.2s, only sweep when DOM changes occur,
  // with disconnect-reconnect pattern to prevent jank on SPA pages.
  function _sweepAds() {
    try {
      // 1. Auto-click skip buttons in ad overlays.
      var skipTexts = ['skip', 'skip ad', 'close ad', 'continue',
                       'continue to video'];
      var clickables = document.querySelectorAll('button, a, span, div[role="button"]');
      for (var bi = 0; bi < clickables.length; bi++) {
        var txt = (clickables[bi].textContent || '').trim().toLowerCase();
        if (txt.length > 0 && txt.length < 30) {
          for (var si = 0; si < skipTexts.length; si++) {
            if (txt === skipTexts[si] || txt.indexOf(skipTexts[si]) !== -1) {
              var cs = window.getComputedStyle(clickables[bi]);
              if (cs.position === 'fixed' || cs.position === 'sticky' ||
                  parseInt(cs.zIndex) > 50 || clickables[bi].closest('[style*="fixed"],[style*="z-index"]')) {
                clickables[bi].click();
                console.log('[AB] Auto-clicked:', txt);
              }
            }
          }
        }
      }

      // 2. Remove ad iframes.
      var iframes = document.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        var src = (iframes[fi].src || '').toLowerCase();
        var w = iframes[fi].offsetWidth;
        var h = iframes[fi].offsetHeight;
        if (w > 150 && h > 150) {
          try {
            var iu = new URL(src);
            if (iu.hostname !== location.hostname) {
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

      // 3. Remove overlay ad containers (fixed position, high z-index, large)
      try {
        var overlays = document.querySelectorAll('div[style*="fixed"], div[style*="z-index"]');
        for (var oi = 0; oi < overlays.length; oi++) {
          var el = overlays[oi];
          var cs = window.getComputedStyle(el);
          var z = parseInt(cs.zIndex) || 0;
          if ((cs.position === 'fixed' || cs.position === 'sticky') && z > 100 && el.offsetWidth > 200 && el.offsetHeight > 200) {
            // Check if it contains video-like content (avoid removing the actual player)
            var hasVideo = el.querySelector('video');
            var hasPlayerClass = /player|video|embed/.test(el.className || '');
            if (!hasVideo && !hasPlayerClass) {
              el.style.setProperty('display', 'none', 'important');
              console.log('[AB] Hidden overlay ad container');
            }
          }
        }
      } catch(e) {}

      // 4. Hide provider next-episode buttons (show our own instead, avoid duplicates)
      try {
        var nextEpPatterns = ['next episode', 'next ep', 'up next', 'next→'];
        var nextEpEls = document.querySelectorAll('button, a, [role="button"], div[class*="next"], div[class*="upnext"]');
        for (var ni = 0; ni < nextEpEls.length; ni++) {
          if (nextEpEls[ni].offsetWidth < 10) continue;
          var txt = (nextEpEls[ni].textContent || '').toLowerCase().trim();
          var aria = (nextEpEls[ni].getAttribute('aria-label') || '').toLowerCase();
          var cls = (nextEpEls[ni].className || '').toString().toLowerCase();
          for (var pi = 0; pi < nextEpPatterns.length; pi++) {
            if (txt.indexOf(nextEpPatterns[pi]) !== -1 || aria.indexOf(nextEpPatterns[pi]) !== -1 || cls.indexOf(nextEpPatterns[pi]) !== -1) {
              nextEpEls[ni].style.setProperty('display', 'none', 'important');
              nextEpEls[ni].style.setProperty('visibility', 'hidden', 'important');
              console.log('[AB] Hidden next-ep button');
              break;
            }
          }
        }
      } catch(e) {}

      // 5. Periodically run _hideNextEpButtons via setInterval (catches dynamically added ones)
    } catch(e) {}
  }

  // Observer-driven sweeper: runs only when DOM changes, with 5s debounce
  try {
    var _sweepTimer = null;
    var _sweepObs = new MutationObserver(function() {
      _sweepObs.disconnect();
      clearTimeout(_sweepTimer);
      _sweepTimer = setTimeout(function() {
        _sweepAds();
        try { _sweepObs.observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}
      }, 5000);
    });
    _sweepObs.observe(document.documentElement, { childList: true, subtree: true });
    // Fallback: run at least once every 15s even without DOM changes
    setInterval(_sweepAds, 15000);
  } catch(e) {
    // If observer fails, fall back to a simple interval
    setInterval(_sweepAds, 8000);
  }
  // Run once immediately
  _sweepAds();

  // ── Universal video progress polling (fallback for providers without postMessage) ──
  // Polls video elements every 10s. Searches the main document AND any same-origin
  // iframes — many provider embed pages load the player inside an iframe.
  function _findVideoElements() {
    var videos = [];
    try {
      var mainVids = document.querySelectorAll('video');
      for (var i = 0; i < mainVids.length; i++) videos.push(mainVids[i]);
    } catch(e) {}
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var iDoc = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
          if (iDoc) {
            var iVids = iDoc.querySelectorAll('video');
            for (var j = 0; j < iVids.length; j++) videos.push(iVids[j]);
          }
        } catch(e) {}
      }
    } catch(e) {}
    return videos;
  }

  setInterval(function() {
    try {
      var videos = _findVideoElements();
      for (var vi = 0; vi < videos.length; vi++) {
        var video = videos[vi];
        if (video && video.duration > 0 && video.currentTime > 5) {
          var pct = video.currentTime / video.duration;
          if (pct < 0.98) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'player:progress',
              data: {
                currentTime: video.currentTime,
                duration: video.duration,
                percent: pct
              }
            }));
          }
        }
      }
    } catch(e) {}
  }, 10000);

  // ── Intercept postMessage calls from iframe players ──
  // Overrides window.postMessage so that when a child iframe sends progress data
  // to its parent (this page), we detect it regardless of message format.
  try {
    var _origPM = window.postMessage;
    window.postMessage = function(msg, targetOrigin, transfer) {
      if (msg && typeof msg === 'object') {
        var pd = msg.data || msg;
        if (pd && typeof pd.currentTime === 'number' && typeof pd.duration === 'number') {
          var pct = pd.duration > 0 ? pd.currentTime / pd.duration : 0;
          if (pct > 0.01 && pct < 0.98) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'player:progress',
              data: {
                currentTime: pd.currentTime,
                duration: pd.duration,
                percent: pct,
                season: pd.season,
                episode: pd.episode
              }
            }));
          }
        }
      }
      return _origPM.call(window, msg, targetOrigin, transfer);
    };
  } catch(e) {}

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
  // ── Phase B deferred (DOM work after DOMContentLoaded) ──
  function _cfDomInit() {
    // Observer-driven iframe removal (disconnect-reconnect prevents jank)
    try {
      var _cfTimer = null;
      var observer = new MutationObserver(function(mutations) {
        observer.disconnect();
        clearTimeout(_cfTimer);
        _cfTimer = setTimeout(function() {
          try { observer.observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}
        }, 3000);
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
    // One-time iframe sweep after page settles (not a repeating interval)
    setTimeout(function() {
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var i = iframes.length - 1; i >= 0; i--) {
          var src = iframes[i].getAttribute('src') || iframes[i].src || '';
          if (!isOwnUrl(src)) { iframes[i].remove(); }
        }
      } catch(e) {}
    }, 3000);

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
      try {
        var _cfUIobs = new MutationObserver(function() {
          _cfUIobs.disconnect();
          setTimeout(function() {
            hideMatchingElements(document);
            try { _cfUIobs.observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}
          }, 8000);
        });
        _cfUIobs.observe(document.documentElement, { childList: true, subtree: true });
      } catch(e) {
        setInterval(function() { hideMatchingElements(document); }, 15000);
      }
    }

    // ── Nxsha: hide app install button (no parent climbing) ──
    if (PROVIDER_HOST.indexOf('nxsha') !== -1) {
      try {
        var _nxSheet = new CSSStyleSheet();
        _nxSheet.replaceSync(
          'a[href="https://nxsha.app"]{display:none!important}'
        );
        document.adoptedStyleSheets.push(_nxSheet);
      } catch(e) {
        try {
          var _nxSt = document.createElement('style');
          _nxSt.textContent = 'a[href="https://nxsha.app"]{display:none!important}';
          (document.head || document.documentElement).appendChild(_nxSt);
        } catch(e) {}
      }
      try {
        var _a = document.querySelector('a[href="https://nxsha.app"]');
        if (_a) { _a.style.setProperty('display', 'none', 'important'); _a.remove(); }
      } catch(e) {}
      setTimeout(function() {
        try {
          var _a = document.querySelector('a[href="https://nxsha.app"]');
          if (_a) { _a.style.setProperty('display', 'none', 'important'); _a.remove(); }
        } catch(e) {}
      }, 3000);
    }

    // ── Hide provider next-episode buttons (avoid duplicates with our UI) ──
    try {
      var _nextEpPatterns = ['next episode', 'next ep', 'up next', 'next→'];
      function _cfHideNextEp() {
        try {
          var _els = document.querySelectorAll('button, a, [role="button"], div[class*="next"], div[class*="upnext"]');
          for (var _i = 0; _i < _els.length; _i++) {
            if (_els[_i].offsetWidth < 10) continue;
            var _txt = (_els[_i].textContent || '').toLowerCase().trim();
            var _aria = (_els[_i].getAttribute('aria-label') || '').toLowerCase();
            var _cls = (_els[_i].className || '').toString().toLowerCase();
            for (var _p = 0; _p < _nextEpPatterns.length; _p++) {
              if (_txt.indexOf(_nextEpPatterns[_p]) !== -1 || _aria.indexOf(_nextEpPatterns[_p]) !== -1 || _cls.indexOf(_nextEpPatterns[_p]) !== -1) {
                _els[_i].style.setProperty('display', 'none', 'important');
                break;
              }
            }
          }
        } catch(e) {}
      }
      // Run immediately and periodically
      _cfHideNextEp();
      setInterval(_cfHideNextEp, 10000);
      // Also observe DOM changes
      try {
        var _nextEpObs = new MutationObserver(function() {
          _nextEpObs.disconnect();
          setTimeout(function() {
            _cfHideNextEp();
            try { _nextEpObs.observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}
          }, 3000);
        });
        _nextEpObs.observe(document.documentElement, { childList: true, subtree: true });
      } catch(e) {}
    } catch(e) {}

    // ── Video progress tracking (for predictive preloading) ──
    try {
      var _lastProgress = 0;
      window.addEventListener('message', function _progHandler(e) {
        if (e.data && e.data.type === 'PLAYER_EVENT') {
          var pd = e.data.data;
          if (pd && typeof pd.currentTime === 'number' && typeof pd.duration === 'number') {
            var pct = pd.duration > 0 ? pd.currentTime / pd.duration : 0;
            if (pct - _lastProgress >= 0.05 || pct >= 0.95) {
              _lastProgress = pct;
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'player:progress',
                data: { currentTime: pd.currentTime, duration: pd.duration, percent: pct,
                        tmdbId: pd.tmdbId, mediaType: pd.mediaType,
                        season: pd.season, episode: pd.episode }
              }));
            }
          }
        }
        if (e.data && e.data.type === 'SCREENSCAPE_WATCH_HISTORY_WITH_PROGRESS_RESPONSE') {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'screenscape:progress',
            data: e.data.watchHistory
          }));
        }
      });
      setTimeout(function() {
        try {
          var _ssIframe = document.getElementById('screenscape-player');
          if (_ssIframe && _ssIframe.contentWindow) {
            _ssIframe.contentWindow.postMessage({
              type: 'SCREENSCAPE_GET_WATCH_HISTORY_WITH_PROGRESS',
              requestId: 'filmsnaps-1'
            }, 'https://screenscape.me');
          }
        } catch(e) {}
      }, 5000);
    } catch(e) {}

    // ── Video progress polling for CF providers (nxsha trick) ──
    // Cloudflare-protected providers don't emit postMessage events, so we
    // poll video elements every 5s. Searches main document AND iframes.
    function _cfFindVideos() {
      var videos = [];
      try { var m = document.querySelectorAll('video'); for (var i=0;i<m.length;i++) videos.push(m[i]); } catch(e) {}
      try {
        var ifs = document.querySelectorAll('iframe');
        for (var i=0;i<ifs.length;i++) {
          try {
            var d = ifs[i].contentDocument || (ifs[i].contentWindow && ifs[i].contentWindow.document);
            if (d) { var v = d.querySelectorAll('video'); for (var j=0;j<v.length;j++) videos.push(v[j]); }
          } catch(e) {}
        }
      } catch(e) {}
      return videos;
    }
    setInterval(function() {
      try {
        var videos = _cfFindVideos();
        for (var vi = 0; vi < videos.length; vi++) {
          var video = videos[vi];
          if (video && video.duration > 0 && video.currentTime > 5) {
            var pct = video.currentTime / video.duration;
            if (pct < 0.98) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'player:progress',
                data: {
                  currentTime: video.currentTime,
                  duration: video.duration,
                  percent: pct
                }
              }));
            }
          }
        }
      } catch(e) {}
    }, 5000);
  }

  // Defer Phase B until DOMContentLoaded
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
  const progressRef = useRef<{ percent: number; tmdbId?: number; season?: number; episode?: number }>({ percent: 0 });
  const startAtRef = useRef<number>(0);
  const lastSavePctRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showNextEpBtn, setShowNextEpBtn] = useState(false);
  const nextEpInfoRef = useRef({ season: 1, episode: 2 });

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
            }
          }
        } else {
          const progress = await getProgress(id, 'movie');
          if (progress && !progress.completed && progress.currentTime > 5) {
            startAtRef.current = progress.currentTime;
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

  // Safety timer: clear loading after 15s in case onLoadEnd never fires
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 15000);
    return () => clearTimeout(timer);
  }, [providerId, currentSeason, currentEpisode]);

  // ── Log provider state for debugging ──
  console.warn(
    `[WebView] providers=${providers.length} providerId=${providerId} currentProvider=${currentProvider?.id ?? 'NULL'} type=${type} id=${id}`,
  );

  const watchUrl = useMemo(() => {
    if (!currentProvider) {
      console.warn('[WebView] No currentProvider — URL is empty');
      return '';
    }
    const startAt = startAtRef.current > 0 ? startAtRef.current : undefined;
    const embedPath =
      type === 'tv' && currentSeason && currentEpisode
        ? currentProvider.embed.tv(id, currentSeason, currentEpisode, startAt)
        : currentProvider.embed.movie(id, startAt);
    const url = `${currentProvider.baseUrl}${embedPath}`;
    console.warn(`[WebView] built URL: ${url} (startAt=${startAt})`);
    return url;
  }, [currentProvider, type, id, currentSeason, currentEpisode]);

  const handleOpenWindow = useCallback((syntheticEvent: any) => {
    console.warn('[PopupBlocker] Blocked popup window:', syntheticEvent.nativeEvent.targetUrl);
  }, []);

  // Restore portrait THEN navigate back — prevents the dismiss animation from
  // glitching when the orientation changes during the transition.
  const handleClose = useCallback(() => {
    restorePortrait();
    // Save final progress before closing
    const prog = progressRef.current;
    if (prog.percent > 0.05 && prog.percent < 0.95) {
      saveProgress({
        tmdbId: id,
        mediaType: type,
        providerId: providerId,
        currentTime: 0,
        duration: 0,
        percent: prog.percent,
        season: isTV ? currentSeason : undefined,
        episode: isTV ? currentEpisode : undefined,
        updatedAt: Date.now(),
        completed: false,
      }).catch(() => {});
    }
    // Small delay to let orientation settle before dismiss animation starts
    setTimeout(() => onClose?.(), 200);
  }, [restorePortrait, onClose, id, type, providerId, isTV, currentSeason, currentEpisode]);

  // ── Save progress on unmount (catches hardware-back, gesture, etc.) ──
  const unmountSavedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (unmountSavedRef.current) return;
      unmountSavedRef.current = true;
      const prog = progressRef.current;
      if (prog.percent > 0.05) {
        saveProgress({
          tmdbId: id,
          mediaType: type,
          providerId: providerId,
          currentTime: 0,
          duration: 0,
          percent: prog.percent,
          season: isTV ? currentSeason : undefined,
          episode: isTV ? currentEpisode : undefined,
          updatedAt: Date.now(),
          completed: prog.percent >= 0.95,
        }).catch(() => {});
      }
    };
  }, [id, type, providerId, isTV, currentSeason, currentEpisode]);

  const switchProvider = (newId: string) => {
    // Clean up injected next-episode button
    webViewRef.current?.injectJavaScript(`
      var btn = document.getElementById('filmsnaps-next-ep-btn');
      if (btn) btn.remove();
    `);
    setProviderId(newId);
    // Only show loading if provider actually changed (prevents infinite spinner
    // when user taps the same provider they're already using)
    if (newId !== providerId) {
      setLoading(true);
    }
    setError(null);
    setShowPicker(false);
    setShowNextEpBtn(false);
    // Reset navigation chain for the new provider
    navigationChainRef.current = new Set();
    pageLoadedRef.current = false;
  };

  // ── Predictive preloading: when 80% watched, prefetch next episode metadata ──
  const preloadNextEpisode = useCallback(() => {
    if (type !== 'tv' || !id) return;
    const prog = progressRef.current;
    const nextEp = (prog.episode ?? currentEpisode) + 1;
    const nextSeason = prog.season ?? currentSeason;

    // Prefetch next episode of current season
    queryClient.prefetchQuery({
      queryKey: ['tv', id, 'season', nextSeason],
      queryFn: () => tmdbApi.getSeasonEpisodes(id, nextSeason),
      staleTime: 1000 * 60 * 60,
    });
    console.log(`[Preload] Prefetched S${String(nextSeason).padStart(2,'0')}E${String(nextEp).padStart(2,'0')} metadata`);
  }, [type, id, currentEpisode, currentSeason, queryClient]);

  // Force WebView remount only on provider switch (not episode change)
  const webViewKey = useMemo(
    () => `${providerId}-${type}`,
    [providerId, type],
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
          // Clean up injected next-episode button when manually changing episode
          webViewRef.current?.injectJavaScript(`
            var btn = document.getElementById('filmsnaps-next-ep-btn');
            if (btn) btn.remove();
          `);
          setCurrentSeason(season);
          setCurrentEpisode(episode);
          setShowEpPicker(false);
          setShowNextEpBtn(false);
          // Only show loading if episode actually changed (prevents infinite spinner
          // when user taps the same episode they're already watching)
          if (season !== currentSeason || episode !== currentEpisode) {
            setLoading(true);
          }
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
              style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
              onLoad={(event) => {
                console.warn(`[WebView] onLoad: ${event.nativeEvent.url.substring(0, 100)}`);
              }}
              allowsFullscreenVideo={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              sharedCookiesEnabled={true}
              thirdPartyCookiesEnabled={true}
              injectedJavaScriptBeforeContentLoaded={
                (providerId === 'nxsha' || providerId === 'chillflix')
                  ? makeCFBypassScript(currentProvider?.baseUrl ? new URL(currentProvider.baseUrl).hostname : '')
                  : POPUP_BLOCKER_SCRIPT
              }
              // Runs on EVERY page navigation (episode changes, redirects)
              // POPUP_BLOCKER handles ad-overlay removal and window.open interception
              // at document_end — fine for non-CF providers on re-navigation.
              injectedJavaScript={POPUP_BLOCKER_SCRIPT}
              allowsBackForwardNavigationGestures={false}
              setSupportMultipleWindows={false}
              // ── Security hardening ──
              allowFileAccess={false}
              allowUniversalAccessFromFileURLs={false}
              javaScriptCanOpenWindowsAutomatically={false}
              geolocationEnabled={false}
              mixedContentMode="never"
              cacheEnabled={false}
              incognito={true}
              onShouldStartLoadWithRequest={(request) => {
                const reqUrl = request.url || '';
                const isMainFrame = request.isTopFrame ?? true;
                // Log every request for debugging
                console.warn(
                  `[WebView] nav: ${reqUrl.substring(0, 120)} mainFrame=${isMainFrame}`
                );
                // Block intent:// URLs universally (ad popups trying to open Chrome)
                if (!reqUrl || reqUrl.startsWith('intent://')) {
                  console.warn('[WebView] blocked: intent URL');
                  return false;
                }
                // CF-protected providers: allow only same-origin + player modal domains
                if (providerId === 'nxsha' || providerId === 'chillflix') {
                  const host = (() => { try { return new URL(reqUrl).hostname; } catch { return ''; }})();
                  const providerHost = currentProvider?.baseUrl ? new URL(currentProvider.baseUrl).hostname : '';
                  const allowed = host === providerHost;
                  if (!allowed) console.warn(`[WebView] blocked: CF mismatch host=${host} providerHost=${providerHost}`);
                  return allowed;
                }
                // Chain tracking: record all domains during page load (first 5s),
                // then block any navigation to unvisited domains (likely ads).
                if (reqUrl) {
                  try {
                    const parsed = new URL(reqUrl);
                    const host = parsed.hostname.toLowerCase();

                    // During bootstrapping phase (first 5s after load), record
                    // all domains in the redirect chain so we can allow them.
                    if (!pageLoadedRef.current) {
                      navigationChainRef.current.add(host);
                      console.warn(`[WebView] bootstrap allow: ${host}`);
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
                  } catch (e) {
                    console.warn('[WebView] nav parse error:', reqUrl.substring(0, 80));
                  }
                }
                return true;
              }}
              onLoadStart={(event) => {
                console.warn(`[WebView] onLoadStart: ${event.nativeEvent.url.substring(0, 100)}`);
                // Clean up injected button on navigation
                webViewRef.current?.injectJavaScript(`
                  var btn = document.getElementById('filmsnaps-next-ep-btn');
                  if (btn) btn.remove();
                `);
              }}
              onLoadEnd={(event) => {
                console.warn(`[WebView] onLoadEnd: ${event.nativeEvent.url.substring(0, 100)}`);
                setLoading(false);
                // After page fully loads, allow 5s for provider redirect chain,
                // then lock it — any new domain after this is likely an ad.
                setTimeout(() => { pageLoadedRef.current = true; }, 5000);

                // ── Seek video to resume point (universal, works on any provider) ──
                // Providers that already support ?startAt= in URL (vidnest, vixsrc)
                // would also get this, but double-seeking to the same position is harmless.
                const seekTime = startAtRef.current;
                if (seekTime > 5) {
                  webViewRef.current?.injectJavaScript(`
                    (function(){
                      var _st = ${Math.floor(seekTime)};
                      var _pi = setInterval(function(){
                        var _v = document.querySelector('video');
                        if(_v && _v.readyState >= 1){
                          _v.currentTime = _st;
                          _v.play();
                          clearInterval(_pi);
                        }
                      }, 400);
                      setTimeout(function(){ clearInterval(_pi); }, 35000);
                    })();
                  `);
                  // Reset so it doesn't re-fire on subsequent navigations
                  startAtRef.current = 0;
                }
              }}
              onError={(syntheticEvent) => {
                const err = syntheticEvent.nativeEvent;
                console.warn(`[WebView] onError: ${err.code} ${err.description?.substring(0, 100) ?? ''}`);
                // Clear loading on error so user sees error state, not infinite spinner
                setLoading(false);
              }}
              onHttpError={(syntheticEvent) => {
                const err = syntheticEvent.nativeEvent;
                console.warn(`[WebView] HTTP ${err.statusCode}: ${err.description?.substring(0, 100) ?? ''}`);
              }}
              onMessage={(event) => {
                try {
                  const data = JSON.parse(event.nativeEvent.data);
                  if (data.type === 'cf:fullscreen' && (providerId === 'nxsha' || providerId === 'chillflix')) {
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
                  if (data.type === 'filmsnaps:nextEpisode') {
                      // User clicked the injected "Next Episode" button
                      // Fetch correct next episode (handles season transitions)
                      (async () => {
                        try {
                          const { nextSeason, nextEpisode } = await getNextEpisode(id, currentSeason, currentEpisode);
                          nextEpInfoRef.current = { season: nextSeason, episode: nextEpisode };
                        } catch {
                          nextEpInfoRef.current = { season: currentSeason, episode: currentEpisode + 1 };
                        }
                        setShowNextEpBtn(false);
                        setError(null);
                        setLoading(true);
                        setCurrentEpisode(nextEpInfoRef.current.episode);
                        setCurrentSeason(nextEpInfoRef.current.season);
                      })();
                    }
                    // ── Progress tracking (triggers next-episode preloading) ──
                  if (data.type === 'player:progress' || data.type === 'screenscape:progress') {
                    const prevPct = progressRef.current.percent;
                    const newPct = data.data?.percent ?? prevPct;
                    progressRef.current = { ...progressRef.current, ...data.data, percent: newPct };
                    // Trigger preload at 80%
                    if (prevPct < 0.8 && newPct >= 0.8) {
                      preloadNextEpisode();
                    }

                    // ── Persist progress to AsyncStorage (throttled) ──
                    const currentTime = data.data?.currentTime ?? 0;
                    const duration = data.data?.duration ?? 0;
                    if (currentTime > 5 && duration > 0) {
                      // Save if 10% more progress since last save, or every 10s
                      const pctDiff = newPct - lastSavePctRef.current;
                      if (pctDiff >= 0.1 || newPct >= 0.95 || Date.now() % 10000 < 200) {
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

                    // ── TV episode: show "Next Episode" button at 95%+ ──
                    if (isTV && prevPct < 0.95 && newPct >= 0.95) {
                      // Mark current episode completed
                      markCompleted(id, 'tv', currentSeason, currentEpisode).catch(() => {});

                      // Calculate correct next episode (handles season rollover)
                      (async () => {
                        try {
                          const nextEp = await getNextEpisode(id, currentSeason, currentEpisode);
                          nextEpInfoRef.current = { season: nextEp.nextSeason, episode: nextEp.nextEpisode };
                          setShowNextEpBtn(true);

                          // Inject button into WebView DOM for fullscreen visibility
                          webViewRef.current?.injectJavaScript(`
                            (function() {
                              // Remove any existing injected button
                              var existing = document.getElementById("filmsnaps-next-ep-btn");
                              if (existing) existing.remove();

                              var seasonStr = "${String(nextEp.nextSeason).padStart(2, "0")}";
                              var episodeStr = "${String(nextEp.nextEpisode).padStart(2, "0")}";

                              // Create button
                              var btn = document.createElement("button");
                              btn.id = "filmsnaps-next-ep-btn";
                              btn.innerHTML = "<span style=\"display:flex;align-items:center;gap:8px;\"><span style=\"background:rgba(232,160,32,0.2);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#e8a020\" stroke-width=\"2.5\"><polygon points=\"5 4 19 12 5 20\"/></svg></span><span style=\"display:flex;flex-direction:column;\"><span style=\"font-size:10px;color:#a1a1aa;font-weight:600;letter-spacing:0.5px;\">UP NEXT</span><span style=\"font-size:13px;color:#fff;font-weight:700;\">S" + seasonStr + " E" + episodeStr + "</span></span></span>";
                              btn.style.cssText = "position:fixed;bottom:calc(env(safe-area-inset-bottom, 0px) + 80px);right:16px;z-index:2147483647;background:rgba(0,0,0,0.9);border:1px solid rgba(232,160,32,0.4);border-radius:12px;padding:10px 14px;color:#fff;font-family:system-ui;font-size:13px;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);cursor:pointer;animation:slideUp 0.3s ease-out;";
                              btn.onclick = function() {
                                window.ReactNativeWebView.postMessage(JSON.stringify({type:"filmsnaps:nextEpisode"}));
                              };

                              // Add animation keyframes
                              var style = document.createElement("style");
                              style.textContent = "@keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }";
                              document.head.appendChild(style);

                              document.body.appendChild(btn);

                              // Auto-hide after 15s if not clicked
                              setTimeout(function() {
                                var b = document.getElementById("filmsnaps-next-ep-btn");
                                if (b) { b.style.animation = "slideUp 0.3s ease-in reverse"; setTimeout(function(){ b.remove(); }, 300); }
                              }, 15000);
                            })();
                          `);
                        } catch (e) {
                          // Fallback on error
                          nextEpInfoRef.current = { season: currentSeason, episode: currentEpisode + 1 };
                          setShowNextEpBtn(true);
                        }
                      })();
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
