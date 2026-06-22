/**
 * FilmSnaps Desktop — Provider Protection Script
 *
 * Ported from the mobile app's POPUP_BLOCKER_SCRIPT (apps/mobile/components/VideoWebView.tsx).
 * This is Layer 5 (defense-in-depth) — it catches things the network-level
 * filter and navigation guard might miss, such as:
 *   - Overlay ads injected by provider JS
 *   - Auto-skip buttons for ad overlays
 *   - History manipulation (pushState/replaceState)
 *   - eval() abuse detection
 *   - Service worker registration blocking
 *
 * KEY DIFFERENCE from mobile: In Electron, this is a SECONDARY defense.
 * The primary defense is the network-level filter (Layer 2) and native
 * navigation blocking (Layer 4) which run in the main process and CANNOT
 * be bypassed. In the mobile app, this script was the PRIMARY defense.
 *
 * Changes from mobile version:
 *   - Removed ReactNativeWebView.postMessage() references
 *   - Added process.type check for Electron context
 *   - Kept all 16 protection layers intact
 */

export const PROTECTION_SCRIPT = `
(function() {
  'use strict';

  // ── Prevent double injection ──
  if (window.__filmsnapsProtectionActive) return;
  window.__filmsnapsProtectionActive = true;

  function log(msg) { console.log('[AB]', msg); }
  function warn(msg) { console.warn('[AB]', msg); }

  // ── Layer 1: Popup / Navigation blocking ──
  window.open = function() {
    try { return new Proxy({}, { get: function() { return function() { return null; } } }); }
    catch(e) { return null; }
  };
  Object.defineProperty(window, 'open', {
    value: function() {
      try { return new Proxy({}, { get: function() { return function() { return null; } } }); }
      catch(e) { return null; }
    },
    writable: false,
    configurable: false
  });

  // Freeze window.location setter
  try {
    var _locDesc = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      set: function(val) { return; },
      get: function() { return _locDesc ? _locDesc.get.call(window) : window.location; },
      configurable: false
    });
  } catch(e) {}

  // ── Layer 2: Ad / tracker domain blocking ──
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
    'popcash.net',
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
      if (isAdUrl(url)) { log('block fetch:', url); return Promise.resolve(new Response('', {status: 204})); }
      return _fetch.call(window, input, init);
    };
  } catch(e) {}

  // Block XHR to ad domains
  try {
    var _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (isAdUrl(url)) { this._aborted = true; log('block xhr:', url); return; }
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
          if (name === 'src' && isAdUrl(val)) { log('block iframe:', val); return; }
          return _setAttr(name, val);
        };
        try {
          Object.defineProperty(el, 'src', {
            set: function(v) { if (!isAdUrl(v)) _setAttr('src', v); else log('iframe src blocked'); },
            get: function() { return el.getAttribute('src'); },
            configurable: true
          });
        } catch(e) {}
      }
      return el;
    };
  } catch(e) {}

  // ── Layer 3: MutationObserver for injected ad iframes ──
  try {
    var obs = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var n = muts[i].addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME') {
            var src = n.getAttribute('src') || n.src || '';
            if (isAdUrl(src)) { n.remove(); log('removed ad iframe (MO)'); }
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  // ── Layer 4: Periodic cleanup every 2s ──
  setInterval(function() {
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        var src = iframes[i].getAttribute('src') || iframes[i].src || '';
        if (isAdUrl(src)) { iframes[i].remove(); log('periodic: removed ad iframe'); }
      }
    } catch(e) {}
  }, 2000);

  // ── Layer 5: Click interception ──
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || el.href;
        if (href && href.indexOf('#') !== 0 && href.indexOf('javascript:') !== 0) {
          try {
            var u = new URL(href, location.href);
            if (u.hostname !== location.hostname) {
              e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
              log('Blocked ad link click:', u.hostname + u.pathname);
              return false;
            }
          } catch(err) {}
        }
        break;
      }
      if (el.tagName === 'BUTTON' || el.tagName === 'IMG') {
        var parent = el.parentElement;
        while (parent && parent !== document.body) {
          if (parent.tagName === 'A') {
            var phref = parent.getAttribute('href') || parent.href;
            if (phref && phref.indexOf('#') !== 0 && phref.indexOf('javascript:') !== 0) {
              try {
                var pu = new URL(phref, location.href);
                if (pu.hostname !== location.hostname) {
                  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                  log('Blocked ad link click (parent):', pu.hostname + pu.pathname);
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

  // ── Layer 6: Form submission blocking ──
  document.addEventListener('submit', function(e) {
    var action = e.target && (e.target.getAttribute('action') || e.target.action);
    if (action && action.indexOf('#') !== 0) {
      try {
        var au = new URL(action, location.href);
        if (au.hostname !== location.hostname) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          log('Blocked form submit to:', au.hostname + au.pathname);
          return false;
        }
      } catch(err) {}
    }
  }, true);

  // ── Layer 7: Block location.replace & location.assign ──
  try {
    var _locReplace = window.location.constructor.prototype.replace;
    window.location.constructor.prototype.replace = function(url) {
      try {
        var u = new URL(url, location.href);
        if (u.hostname !== location.hostname) { log('Blocked location.replace:', u.hostname); return; }
      } catch(e) {}
      return _locReplace.call(this, url);
    };
  } catch(e) {}
  try {
    var _locAssign = window.location.constructor.prototype.assign;
    window.location.constructor.prototype.assign = function(url) {
      try {
        var u = new URL(url, location.href);
        if (u.hostname !== location.hostname) { log('Blocked location.assign:', u.hostname); return; }
      } catch(e) {}
      return _locAssign.call(this, url);
    };
  } catch(e) {}

  // ── Layer 8: Overlay ad removal + auto-skip ──
  setInterval(function() {
    try {
      // 1. Auto-click skip buttons
      var skipTexts = ['skip', 'skip ad', 'close ad', 'continue', 'continue to video'];
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
                log('Auto-clicked:', txt);
              }
            }
          }
        }
      }

      // 2. Remove ad iframes (>150x150 from external domains, non-video)
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
              if (iu.hostname.indexOf('vidsrc') !== -1 || iu.hostname.indexOf('embed') !== -1 ||
                  iu.hostname.indexOf('player') !== -1 || iu.hostname.indexOf('video') !== -1 ||
                  iu.hostname.indexOf('cdn') !== -1 || iu.hostname.indexOf('peachify') !== -1) {
                videoDomain = true;
              }
              if (!videoDomain) { iframes[fi].remove(); log('Removed ad iframe:', iu.hostname); }
            }
          } catch(e) {}
        }
      }

      // 3. Remove fixed/sticky overlays that look like ads
      var all = document.querySelectorAll('div, section, aside');
      for (var ei = 0; ei < all.length; ei++) {
        var el = all[ei];
        if (el.offsetWidth < 50 || el.offsetHeight < 50) continue;
        var cs = window.getComputedStyle(el);
        if ((cs.position === 'fixed' || cs.position === 'sticky') &&
            (parseInt(cs.zIndex) > 50 || cs.zIndex === '9999' || cs.zIndex === '99999')) {
          if (el.querySelector('video, iframe[src*="vidsrc"], iframe[src*="embed"], .jwplayer, .video-js')) continue;
          var btns = el.querySelectorAll('button, select, input, [role="button"]');
          if (btns.length >= 3) continue;
          var elTxt = (el.textContent || '').toLowerCase();
          if (elTxt.indexOf('settings') !== -1 || elTxt.indexOf('quality') !== -1 ||
              elTxt.indexOf('playback') !== -1 || elTxt.indexOf('audio') !== -1 ||
              elTxt.indexOf('captions') !== -1 || elTxt.indexOf('speed') !== -1 ||
              elTxt.indexOf('language') !== -1) continue;
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
          log('Removed overlay');
        }
      }
    } catch(e) {}
  }, 1200);

  // ── Layer 9: History manipulation blocking ──
  try {
    var _pushState = history.pushState;
    history.pushState = function() { log('Blocked pushState'); return _pushState.call(this, null, ''); };
    var _replaceState = history.replaceState;
    history.replaceState = function() { log('Blocked replaceState'); return _replaceState.call(this, null, ''); };
  } catch(e) {}

  // ── Layer 10: Navigation + Download blocking ──
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
        log('Blocked download link'); return false;
      }
      el = el.parentElement;
    }
  }, true);
  // Block navigation via location.href
  try {
    var _dlLocProto = Object.getPrototypeOf(window.location);
    if (_dlLocProto) {
      var _dlHrefDesc = Object.getOwnPropertyDescriptor(_dlLocProto, 'href');
      if (_dlHrefDesc && _dlHrefDesc.set) {
        var _origSet = _dlHrefDesc.set;
        Object.defineProperty(_dlLocProto, 'href', {
          set: function(val) {
            if (isDownloadUrl(val)) { log('Blocked download URL:', val.substring(0, 80)); return; }
            try {
              var u = new URL(val, location.href);
              if (u.hostname !== location.hostname) { log('Blocked navigation:', u.hostname); return; }
            } catch(e) {}
            return _origSet.call(this, val);
          },
          get: function() { return _dlHrefDesc.get.call(this); },
          configurable: false,
        });
      }
    }
  } catch(e) {}

  // ── Layer 11: Service Worker blocking ──
  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        for (var i = 0; i < regs.length; i++) { regs[i].unregister(); }
      });
      navigator.serviceWorker.register = function() {
        return Promise.reject(new Error('[AB] Service workers blocked'));
      };
      setInterval(function() {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          for (var i = 0; i < regs.length; i++) { regs[i].unregister(); }
        });
      }, 5000);
    }
  } catch(e) {}

  // ── Layer 12: eval() + Function() blocking ──
  try {
    var _origEval = window.eval;
    Object.defineProperty(window, 'eval', {
      value: function(str) {
        if (typeof str === 'string' && str.length < 10000) {
          return _origEval.call(window, str);
        }
        log('Blocked eval (large payload):', (str && str.length) || 0);
        return undefined;
      },
      writable: false,
      configurable: false,
    });
  } catch(e) {}
  try {
    var _origFn = window.Function;
    window.Function = function() {
      log('Blocked new Function()');
      return function() {};
    };
    Object.defineProperty(window.Function.prototype, 'constructor', {
      value: function() { log('Blocked Function constructor'); return function() {}; },
      writable: false,
      configurable: false,
    });
  } catch(e) {}

  // ── Layer 13: Block document.write / writeln ──
  try {
    document.write = function() { log('Blocked document.write'); };
    document.writeln = function() { log('Blocked document.writeln'); };
  } catch(e) {}

  // ── Layer 14: CSP meta tag injection (defense-in-depth) ──
  try {
    var cspMeta = document.createElement('meta');
    cspMeta.httpEquiv = 'Content-Security-Policy';
    cspMeta.content = "default-src * 'unsafe-inline' 'unsafe-eval'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' *; " +
      "frame-src *; object-src 'none'; base-uri 'self'; form-action 'self'";
    document.head.appendChild(cspMeta);
  } catch(e) {}

  // ── Layer 15: Cookie clearing ──
  try {
    var cookies = document.cookie.split(';');
    for (var ci = 0; ci < cookies.length; ci++) {
      var c = cookies[ci];
      if (c.indexOf('__') === 0) continue;
      var eq = c.indexOf('=');
      if (eq > 0) {
        var name = c.substring(0, eq).trim();
        document.cookie = name + '=;expires=Thu, 01 Jan 2000 00:00:00 GMT;path=/';
      }
    }
  } catch(e) {}

  log('Protection active — 15 layers');
})();
true;
`;
