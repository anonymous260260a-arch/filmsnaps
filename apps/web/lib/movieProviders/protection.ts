// lib/movieProviders/protection.ts
// Centralized security engine — uBlock Origin–style URL filtering & navigation protection
// All routes import from here instead of duplicating patterns

import type { ProviderDefinition } from '@filmsnaps/shared/types';
import { getProvider } from '@filmsnaps/shared/providers';
import { matchFilterUrl, isFilterEngineLoaded, getFilterStats } from './filterService';

// ═══════════════════════════════════════════════════════════════
// DEFAULT BLOCKED PATTERNS — trackers, ads, analytics, miners
// Add patterns here and they apply to ALL providers automatically
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_BLOCKED_PATTERNS = [
  // Cloudflare tracking / RUM
  'cdn-cgi/rum',
  'cdn-cgi/challenge-platform',
  'cloudflareinsights.com',
  'cloudflare-beacon.com',
  'cloudflarestream.com',

  // Google tracking
  'googletagmanager.com',
  'google-analytics.com',
  'googleadservices.com',
  'googleads.g.doubleclick.net',
  'stats.g.doubleclick.net',
  'analytics.google.com',
  'gtag/js',
  'pagead2.googlesyndication.com',

  // DoubleClick
  'doubleclick.net',
  'ad.doubleclick.net',

  // Facebook / Meta
  'facebook.com/tr',
  'connect.facebook.net',
  'pixel.facebook.com',
  'an.facebook.com',

  // Analytics services
  'umami.',
  'plausible.io',
  'analytics.',
  'matomo.',
  'hotjar.com',
  'fullstory.com',
  'logrocket.com',
  'sentry.io',
  'mouseflow.com',
  'clarity.ms',
  'clarity-s.',
  'livesession.io',
  'heap.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'segment.com',
  'rudderstack.com',

  // Ad networks
  'adsystem.',
  'adserver.',
  'ads.',
  'banner.',
  'adnxs.com',
  'rubiconproject.com',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'revcontent.com',

  // Tracking / telemetry
  'pixel.',
  'track.',
  'tracking.',
  'beacon.',
  'telemetry.',
  'histats.com',
  'counter.',
  'statcounter.com',

  // Crypto miners
  'coinhive.com',
  'cryptoloot.',
  'coinimp.com',
  'miner.',
  'webminepool.com',

  // Popup / popunder
  'popads.',
  'popcash.',
  'popup.',
  'popunder.',
  'adsterra.com',
  'propellerads.com',
  'trafficfactory.biz',

  // Specific file patterns
  '/analytics.js',
  '/tracking.js',
  '/tracker.js',
  '/beacon.js',
  '/telemetry.js',
  '/rum.js',
  '/gtag.js',
  '/fbevents.js',
  '/pixel.js',

  // Query parameter trackers
  '?utm_',
  '?fbclid=',
  '?gclid=',
  '?_ga=',
  '?mc_cid=',
  '?mc_eid=',
  '?utm_source=',
  '?utm_medium=',
  '?utm_campaign=',
  '?utm_term=',
  '?utm_content=',
];

// ═══════════════════════════════════════════════════════════════
// URL FILTERING
// ═══════════════════════════════════════════════════════════════

export interface FilterContext {
  /** The provider being used (for per-provider rules) */
  provider?: ProviderDefinition;
  /** Request type hint */
  requestType?: 'script' | 'image' | 'xhr' | 'fetch' | 'frame' | 'media' | 'other';
}

/**
 * Check whether a URL should be blocked.
 * Uses the @cliqz/adblocker filter engine first (if loaded), then
 * falls back to provider-specific and global block patterns.
 *
 * Respects per-provider protection settings:
 *   - provider.protection.enabled = false → allow everything
 *   - provider.protection.allowPatterns → override blocklist
 *   - provider.protection.customBlockPatterns → extra blocked URLs
 */
export function shouldBlockUrl(url: string, context?: FilterContext): boolean {
  const provider = context?.provider;
  const urlLower = url.toLowerCase();

  // ── Per-provider protection off → allow everything ──
  if (provider?.protection?.enabled === false) {
    return false;
  }

  // ── Check provider-specific allow patterns (override) ──
  if (provider?.protection?.allowPatterns) {
    for (const allow of provider.protection.allowPatterns) {
      if (urlLower.includes(allow.toLowerCase())) {
        return false;
      }
    }
  }

  // ── Check provider-specific block patterns ──
  if (provider?.protection?.customBlockPatterns) {
    for (const pattern of provider.protection.customBlockPatterns) {
      if (urlLower.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  // ── @cliqz/adblocker filter engine check (if loaded) ──
  if (isFilterEngineLoaded()) {
    // Use the provider's base URL as the source URL context
    const sourceUrl = provider?.baseUrl || url;
    const result = matchFilterUrl(url, sourceUrl, context?.requestType);
    if (result !== null) {
      // If the engine says "blocked", respect it
      if (result.blocked) {
        return true;
      }
      // If the engine says "not blocked" AND it's loaded (not a legacy fallback),
      // still fall through to check legacy patterns below
    }
  }

  // ── Check global block patterns (legacy fallback) ──
  for (const pattern of DEFAULT_BLOCKED_PATTERNS) {
    if (urlLower.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION BLOCKER — client-side script injection
// ═══════════════════════════════════════════════════════════════

/**
 * Generate the navigation blocker script injected into provider HTML.
 * Updated with self-healing, MutationObserver, and multi-layer defenses.
 * Blocks: popups, location hijacks, history manipulation, form submissions,
 * external link clicks, window.name, document.domain, EventSource/WebSocket tracking.
 * Self-heals every 1s if provider scripts strip the protection.
 */
export function generateNavBlockerScript(
  targetUrl: string,
  provider?: ProviderDefinition,
): string {
  if (provider?.protection?.enabled === false) {
    return '';
  }

  const origin = (() => {
    try { return new URL(targetUrl).origin; } catch { return targetUrl; }
  })();

  return `<!-- Navigation Blocker (Fortified) -->
<script data-nav-blocker="true">
(function(){
  'use strict';
  var ORIGIN = ${JSON.stringify(origin)};
  var TARGET = ${JSON.stringify(targetUrl)};

  if(window.__navBlockerActive) return; // prevent double-run
  window.__navBlockerActive = true;

  // ── Polyfill Object.assign for old browsers ──
  var assign = Object.assign || function(t){ for(var i=1;i<arguments.length;i++){ var s=arguments[i]; if(s) for(var k in s) t[k]=s[k]; } return t; };

  // ── Build a frozen location impersonator ──
  function makeSafeLocation(){
    var loc = {
      href: TARGET,
      origin: ORIGIN,
      protocol: new URL(TARGET).protocol,
      host: new URL(TARGET).host,
      hostname: new URL(TARGET).hostname,
      port: new URL(TARGET).port,
      pathname: new URL(TARGET).pathname,
      search: '',
      hash: '',
      ancestorOrigins: { length: 0, contains: function(){return false;}, item: function(){return null;} },
      assign: function(u){ console.log('[NavBlocker] Blocked location.assign:', u); },
      replace: function(u){ console.log('[NavBlocker] Blocked location.replace:', u); },
      reload: function(){ console.log('[NavBlocker] Blocked location.reload'); },
      toString: function(){ return TARGET; }
    };
    try { Object.freeze(loc); } catch(e){}
    return loc;
  }

  var SAFE_LOC = makeSafeLocation();

  // ── Lock an object's property descriptor with a non-replacable getter/setter ──
  function lockLocation(obj){
    try {
      Object.defineProperty(obj, 'location', {
        configurable: false,
        enumerable: true,
        get: function(){ return SAFE_LOC; },
        set: function(v){ console.log('[NavBlocker] Blocked location= set:', v); }
      });
    } catch(e){}
  }

  // ── Initial lock on window ──
  lockLocation(window);

  // ── Also attempt to lock top / parent references (same-origin) ──
  try {
    if(window.top && window.top !== window) {
      Object.defineProperty(window.top, 'location', {
        configurable: false,
        get: function(){ return SAFE_LOC; },
        set: function(v){ console.log('[NavBlocker] Blocked top.location=', v); }
      });
    }
  } catch(e){}
  try {
    if(window.parent && window.parent !== window) {
      Object.defineProperty(window.parent, 'location', {
        configurable: false,
        get: function(){ return SAFE_LOC; },
        set: function(v){ console.log('[NavBlocker] Blocked parent.location=', v); }
      });
    }
  } catch(e){}

  // ── Popup blocking ──
  window.open = function(url){
    if(url && url !== 'about:blank') {
      try {
        var u = new URL(url, TARGET);
        if(u.origin !== ORIGIN) {
          console.log('[NavBlocker] Blocked popup:', url);
          return { closed:true, close:function(){}, focus:function(){}, blur:function(){} };
        }
      } catch(e){}
    }
    return null;
  };

  // ── History manipulation ──
  var _ps = history.pushState, _rs = history.replaceState;
  history.pushState = function(s,t,u){
    if(u && typeof u === 'string' && !u.startsWith(ORIGIN) && !u.startsWith('/') && !u.startsWith('#')){
      console.log('[NavBlocker] Blocked pushState:', u); return;
    }
    return _ps.apply(this, arguments);
  };
  history.replaceState = function(s,t,u){
    if(u && typeof u === 'string' && !u.startsWith(ORIGIN) && !u.startsWith('/') && !u.startsWith('#')){
      console.log('[NavBlocker] Blocked replaceState:', u); return;
    }
    return _rs.apply(this, arguments);
  };

  // ── Block window.name (crypto cross-origin communication vector) ──
  try {
    Object.defineProperty(window, 'name', {
      configurable: false,
      get: function(){ return ''; },
      set: function(v){ console.log('[NavBlocker] Blocked window.name=', v); }
    });
  } catch(e){}

  // ── Block document.domain relaxation ──
  try {
    Object.defineProperty(document, 'domain', {
      configurable: false,
      get: function(){ return ORIGIN.replace(/^https?:\\/\\//,''); },
      set: function(v){ console.log('[NavBlocker] Blocked document.domain=', v); }
    });
  } catch(e){}

  // ── Block EventSource (tracking channel) ──
  window.EventSource = function(){ console.log('[NavBlocker] Blocked EventSource'); this.readyState=2; this.CLOSED=2; };
  window.EventSource.prototype = { CONNECTING:0, OPEN:1, CLOSED:2, close:function(){}, addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){return false;} };

  // ── Link click interception (capture phase) ──
  document.addEventListener('click', function(e){
    var el = e.target;
    while(el && el !== document){
      if(el.tagName === 'A'){
        var href = el.getAttribute('href') || el.href;
        if(href && href.indexOf('#') !== 0 && href.indexOf('javascript:') !== 0){
          try {
            var u = new URL(href, TARGET);
            if(u.origin !== ORIGIN){
              e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
              console.log('[NavBlocker] Blocked external link:', href);
            }
          } catch(err){}
        }
        break;
      }
      el = el.parentElement;
    }
  }, true);

  // ── Form submission blocking ──
  document.addEventListener('submit', function(e){
    e.preventDefault(); e.stopPropagation();
    console.log('[NavBlocker] Blocked form submission');
  }, true);

  // ── Context menu blocking (prevent "Open in new tab" hijacks) ──
  document.addEventListener('contextmenu', function(e){
    var el = e.target;
    while(el && el !== document){
      if(el.tagName === 'A'){
        var href = el.getAttribute('href') || el.href;
        if(href && href.indexOf('#') !== 0 && href.indexOf('javascript:') !== 0){
          try {
            var u = new URL(href, TARGET);
            if(u.origin !== ORIGIN){
              e.preventDefault();
              console.log('[NavBlocker] Blocked external context menu link:', href);
            }
          } catch(err){}
        }
        break;
      }
      el = el.parentElement;
    }
  }, true);

  // ── Continuous cleanup ──
  setInterval(function(){
    try {
      document.querySelectorAll('a[target], area[target]').forEach(function(el){ el.removeAttribute('target'); });
      document.querySelectorAll('meta[http-equiv="refresh"]').forEach(function(el){ el.remove(); });
    } catch(e){}
  }, 500);

  // ── SELF-HEALING: check every 1s if location is still frozen ──
  setInterval(function(){
    try {
      // Quick test: if setting window.location.href doesn't throw, protection is intact
      // Actually we can test by checking if the descriptor is still in place
      var desc = Object.getOwnPropertyDescriptor(window, 'location');
      if(!desc || desc.configurable !== false){
        console.log('[NavBlocker] Self-heal: location was tampered');
        lockLocation(window);
      }
    } catch(e){}
  }, 1000);

  // ── MutationObserver: watch for injected scripts that try to strip protections ──
  try {
    var observer = new MutationObserver(function(mutations){
      for(var i=0; i<mutations.length; i++){
        var mut = mutations[i];
        if(mut.type === 'childList' && mut.addedNodes.length){
          for(var j=0; j<mut.addedNodes.length; j++){
            var node = mut.addedNodes[j];
            if(node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('data-nav-blocker') !== 'true'){
              // Intercept newly injected scripts — they can't be blocked but we can re-heal
              console.log('[NavBlocker] New script detected, re-locking location');
              setTimeout(function(){ lockLocation(window); }, 0);
            }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e){}

  console.log('[NavBlocker] Fortified — self-healing, MutationObserver active');
})();
</script>`;
}

// ═══════════════════════════════════════════════════════════════
// RUNTIME PROTECTION SCRIPT — injected into provider HTML
// ═══════════════════════════════════════════════════════════════

/**
 * Generate the runtime protection script that is injected into the
 * provider's HTML page when served via server-side proxy.
 *
 * This script runs in the browser and provides:
 *   1. fetch/XHR interception — proxies same-origin requests through our
 *      asset handler to avoid CORS failures when running on our domain
 *   2. Tracker blocking — blocks URLs matching DEFAULT_BLOCKED_PATTERNS
 *   3. Navigation/popup blocking — prevents window.open, location escapes
 *   4. Service worker neutralization
 *   5. Form submission blocking
 *   6. Dynamically created element interception (scripts, images, links)
 *   7. Self-healing — periodically re-checks and re-applies protections
 *   8. MutationObserver — detects injected scripts trying to strip protections
 *
 * This replaces the browser's sandbox attribute entirely.
 */
export function generateRuntimeProtectionScript(
  targetUrl: string,
  providerId: string,
  provider?: ProviderDefinition,
): string {
  const origin = (() => {
    try {
      return new URL(targetUrl).origin;
    } catch {
      return targetUrl;
    }
  })();

  const patternsJson = JSON.stringify(DEFAULT_BLOCKED_PATTERNS);

  // If protection is disabled for this provider, return a minimal script
  const skipProtection = provider?.protection?.enabled === false;
  if (skipProtection) {
    return `<script data-runtime-sandbox="true">console.log('[RuntimeSandbox] Protection disabled for ${providerId}');</script>`;
  }

  return `<script data-runtime-sandbox="true">
(function(){
  'use strict';

  var TARGET_ORIGIN = ${JSON.stringify(origin)};
  var PROVIDER_KEY = ${JSON.stringify(providerId)};
  var TARGET_URL = ${JSON.stringify(targetUrl)};
  var PROXY_PREFIX = '/api/player/' + PROVIDER_KEY + '/asset?url=';
  var BLOCKED_PATTERNS = ${patternsJson};

  if(window.__runtimeSandboxActive) return;
  window.__runtimeSandboxActive = true;

  function log(msg){ console.log('[RuntimeSandbox]', msg); }
  function warn(msg){ console.warn('[RuntimeSandbox]', msg); }

  // ── URL filtering ──
  function shouldBlockUrl(url){
    if(!url || typeof url !== 'string') return false;
    var l = url.toLowerCase();
    for(var i=0; i<BLOCKED_PATTERNS.length; i++){
      if(l.indexOf(BLOCKED_PATTERNS[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  // ── Proxy URL rewriting ──
  function proxyUrl(url){
    if(!url || typeof url !== 'string') return url;
    if(url.indexOf('blob:')===0 || url.indexOf('data:')===0) return url;
    if(url.indexOf(PROXY_PREFIX) !== -1) return url;

    var absUrl = url;
    if(url.indexOf('://') === -1){
      if(url.charAt(0) === '/') absUrl = TARGET_ORIGIN + url;
      else absUrl = TARGET_ORIGIN + '/' + url;
    }
    if(absUrl.indexOf(TARGET_ORIGIN) !== 0) return url;
    if(absUrl.indexOf('blob:')===0 || absUrl.indexOf('data:')===0) return absUrl;
    return PROXY_PREFIX + encodeURIComponent(absUrl);
  }

  // ── Build a frozen safe location object ──
  function makeSafeLocation(){
    var loc = {
      href: TARGET_URL,
      origin: TARGET_ORIGIN,
      protocol: new URL(TARGET_URL).protocol,
      host: new URL(TARGET_URL).host,
      hostname: new URL(TARGET_URL).hostname,
      port: new URL(TARGET_URL).port,
      pathname: new URL(TARGET_URL).pathname,
      search: '',
      hash: '',
      ancestorOrigins: { length: 0, contains: function(){return false;}, item: function(){return null;} },
      assign: function(u){ warn('location.assign blocked: ' + u); },
      replace: function(u){ warn('location.replace blocked: ' + u); },
      reload: function(){ console.log('[NavBlocker] Blocked location.reload'); },
      toString: function(){ return TARGET_URL; }
    };
    // Also freeze the nested ancestorOrigins
    try { Object.freeze(loc.ancestorOrigins); } catch(e){}
    try { Object.freeze(loc); } catch(e){}
    return loc;
  }

  var SAFE_LOC = makeSafeLocation();

  // ── Lock location on a window object ──
  function lockLocation(obj){
    try {
      Object.defineProperty(obj, 'location', {
        configurable: false,
        enumerable: true,
        get: function(){ return SAFE_LOC; },
        set: function(v){ warn('location= blocked: ' + v); }
      });
    } catch(e){}
  }

  // ── Layer 1: Navigation / Popup prevention ──
  log('Blocking navigation & popups');

  lockLocation(window);

  // Attempt to lock top / parent references (same-origin when proxied)
  try {
    if(window.top && window.top !== window) {
      Object.defineProperty(window.top, 'location', {
        configurable: false,
        get: function(){ return SAFE_LOC; },
        set: function(v){ warn('top.location= blocked: ' + v); }
      });
    }
  } catch(e){}
  try {
    if(window.parent && window.parent !== window) {
      Object.defineProperty(window.parent, 'location', {
        configurable: false,
        get: function(){ return SAFE_LOC; },
        set: function(v){ warn('parent.location= blocked: ' + v); }
      });
    }
  } catch(e){}

  window.open = function(){
    warn('window.open blocked');
    return {closed:true, close:function(){}, focus:function(){}, blur:function(){}};
  };

  // ── Block window.name (cross-origin communication vector) ──
  try {
    Object.defineProperty(window, 'name', {
      configurable: false,
      get: function(){ return ''; },
      set: function(v){ warn('window.name blocked: ' + v); }
    });
  } catch(e){}

  // ── Block document.domain relaxation ──
  try {
    Object.defineProperty(document, 'domain', {
      configurable: false,
      get: function(){ return TARGET_ORIGIN.replace(/^https?:\\/\\//,''); },
      set: function(v){ warn('document.domain blocked: ' + v); }
    });
  } catch(e){}

  // ── Block EventSource tracking ──
  window.EventSource = function(){ warn('EventSource blocked'); this.readyState=2; this.CLOSED=2; };
  try { window.EventSource.prototype = { CONNECTING:0, OPEN:1, CLOSED:2, close:function(){}, addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){return false;} }; } catch(e){}

  // Click blocking for external links
  document.addEventListener('click', function(e){
    var el = e.target;
    while(el && el !== document){
      if(el.tagName === 'A'){
        var href = el.getAttribute('href') || el.href;
        if(href && href.indexOf('#') !== 0 && href.indexOf('javascript:') !== 0){
          try {
            var u = new URL(href, TARGET_URL);
            if(u.origin !== TARGET_ORIGIN){
              e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
              warn('External link blocked: ' + href);
            }
          } catch(err){}
        }
        break;
      }
      el = el.parentElement;
    }
  }, true);

  // Form submission blocking
  document.addEventListener('submit', function(e){
    e.preventDefault(); e.stopPropagation();
    warn('Form submission blocked');
  }, true);

  // Context menu blocking (prevent "Open in new tab" hijacks)
  document.addEventListener('contextmenu', function(e){
    var el = e.target;
    while(el && el !== document){
      if(el.tagName === 'A'){
        var href = el.getAttribute('href') || el.href;
        if(href && href.indexOf('#') !== 0 && href.indexOf('javascript:') !== 0){
          try {
            var u = new URL(href, TARGET_URL);
            if(u.origin !== TARGET_ORIGIN){
              e.preventDefault();
              warn('Context menu link blocked: ' + href);
            }
          } catch(err){}
        }
        break;
      }
      el = el.parentElement;
    }
  }, true);

  // ── Layer 2: Network API interception ──
  log('Installing network interceptors');

  var _fetch = window.fetch;
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if(shouldBlockUrl(url)){
      warn('fetch blocked: ' + url);
      return Promise.resolve(new Response('', {status: 204, statusText: 'Blocked'}));
    }
    var rewritten = proxyUrl(url);
    if(rewritten !== url){
      if(input instanceof Request) input = new Request(rewritten, input);
      else input = rewritten;
    }
    return _fetch.apply(window, arguments);
  };

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass){
    if(shouldBlockUrl(url)){
      warn('XHR blocked: ' + url);
      this._sandboxBlocked = true;
      return;
    }
    var rewritten = proxyUrl(url);
    if(rewritten !== url) url = rewritten;
    return _open.call(this, method, url, async, user, pass);
  };
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body){
    if(this._sandboxBlocked) return;
    return _send.call(this, body);
  };

  var _beacon = navigator.sendBeacon;
  navigator.sendBeacon = function(url, data){
    if(shouldBlockUrl(url)){ warn('sendBeacon blocked: ' + url); return false; }
    return _beacon.call(this, url, data);
  };

  // ── Layer 3: Element creation interception ──
  log('Installing element interceptors');

  var _createElement = document.createElement.bind(document);
  document.createElement = function(tagName, options){
    var el = _createElement(tagName, options);
    var tag = tagName.toLowerCase();
    if(tag === 'script' || tag === 'img' || tag === 'link' || tag === 'iframe'){
      var _setAttr = el.setAttribute.bind(el);
      el.setAttribute = function(name, value){
        if(name === 'src' || name === 'href'){
          if(shouldBlockUrl(value)){ warn('Element src blocked: ' + value); return; }
          value = proxyUrl(value);
        }
        return _setAttr(name, value);
      };
      try {
        if(tag === 'script' || tag === 'img'){
          var desc = Object.getOwnPropertyDescriptor(
            tag === 'script' ? HTMLScriptElement.prototype : HTMLImageElement.prototype, 'src'
          );
          if(desc){
            Object.defineProperty(el, 'src', {
              get: function(){ return desc.get.call(this); },
              set: function(v){
                if(shouldBlockUrl(v)){ warn('Element src blocked: ' + v); return; }
                desc.set.call(this, proxyUrl(v));
              },
              configurable: true, enumerable: true
            });
          }
        }
      } catch(e){}
    }
    return el;
  };

  // ── Layer 4: Service Worker neutralization ──
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(function(regs){
      for(var i=0; i<regs.length; i++) regs[i].unregister();
    }).catch(function(){});
    navigator.serviceWorker.register = function(){
      warn('ServiceWorker blocked');
      return Promise.reject(new Error('Blocked by RuntimeSandbox'));
    };
  }

  // ── Continuous cleanup ──
  setInterval(function(){
    try {
      document.querySelectorAll('a[target], area[target]').forEach(function(el){ el.removeAttribute('target'); });
      document.querySelectorAll('meta[http-equiv="refresh"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('script[src*="analytics"], script[src*="tracking"], script[src*="beacon"], script[src*="pixel"]').forEach(function(s){
        if(shouldBlockUrl(s.src)){ s.remove(); log('Removed tracking script'); }
      });
      document.querySelectorAll('iframe[style*="display:none"], iframe[style*="visibility:hidden"], iframe[width="0"], iframe[height="0"]').forEach(function(f){
        f.remove(); log('Removed hidden iframe');
      });
    } catch(e){}
  }, 1000);

  // ── SELF-HEALING: re-check protections every 1s ──
  setInterval(function(){
    try {
      var desc = Object.getOwnPropertyDescriptor(window, 'location');
      if(!desc || desc.configurable !== false){
        log('Self-heal: location was tampered');
        lockLocation(window);
      }
    } catch(e){}
  }, 1000);

  // ── MutationObserver: watch for nav hijack attempts ──
  try {
    var observer = new MutationObserver(function(mutations){
      for(var i=0; i<mutations.length; i++){
        var mut = mutations[i];
        if(mut.type === 'childList' && mut.addedNodes.length){
          for(var j=0; j<mut.addedNodes.length; j++){
            var node = mut.addedNodes[j];
            if(node.tagName === 'SCRIPT'){
              setTimeout(function(){ lockLocation(window); }, 0);
            }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e){}

  log('RuntimeSandbox active — all layers: nav/popup, network, elements, SW, self-healing');
})();
</script>`;
}

// ═══════════════════════════════════════════════════════════════
// HTML REWRITING — rewrite asset URLs through proxy
// ═══════════════════════════════════════════════════════════════

/**
 * Rewrite asset URLs (scripts, styles, iframes) to go through the
 * proxy, blocking any that match the filter patterns.
 * Returns the modified HTML.
 */
export function rewriteAssetUrls(
  html: string,
  baseUrl: string,
  providerId: string,
): string {
  const provider = getProvider(providerId);

  // Rewrite script src
  html = html.replace(
    /<script([^>]*)\s+src=["']([^"']+)["']/gi,
    (match, attrs, src) => {
      if (shouldBlockUrl(src, { provider })) {
        console.log(`[Protection:${providerId}] BLOCKED script  ${src}`);
        return `<script data-blocked="true"${attrs}`;
      }
      const absoluteSrc = src.startsWith('http')
        ? src
        : new URL(src, baseUrl).href;
      const proxySrc = `/api/player/${providerId}/asset?url=${encodeURIComponent(absoluteSrc)}`;
      return `<script${attrs} src="${proxySrc}"`;
    },
  );

  // Rewrite link href (CSS, fonts)
  html = html.replace(
    /<link([^>]*)\s+href=["']([^"']+)["']/gi,
    (match, attrs, href) => {
      if (shouldBlockUrl(href, { provider })) {
        console.log(`[Protection:${providerId}] BLOCKED link/href  ${href}`);
        return `<link data-blocked="true"${attrs}`;
      }
      const absoluteHref = href.startsWith('http')
        ? href
        : new URL(href, baseUrl).href;
      const proxySrc = `/api/player/${providerId}/asset?url=${encodeURIComponent(absoluteHref)}`;
      return `<link${attrs} href="${proxySrc}"`;
    },
  );

  // Rewrite iframe src
  html = html.replace(
    /<iframe([^>]*)\s+src=["']([^"']+)["']/gi,
    (match, attrs, src) => {
      if (shouldBlockUrl(src, { provider })) {
        console.log(`[Protection:${providerId}] BLOCKED iframe  ${src}`);
        return `<iframe data-blocked="true"${attrs}`;
      }
      const absoluteSrc = src.startsWith('http')
        ? src
        : new URL(src, baseUrl).href;
      const proxySrc = `/api/player/${providerId}/asset?url=${encodeURIComponent(absoluteSrc)}`;
      return `<iframe${attrs} src="${proxySrc}"`;
    },
  );

  // Rewrite img src (for tracking pixels)
  html = html.replace(
    /<img([^>]*)\s+src=["']([^"']+)["']/gi,
    (match, attrs, src) => {
      if (shouldBlockUrl(src, { provider })) {
        return `<img data-blocked="true"${attrs}`;
      }
      return match;
    },
  );

  return html;
}

/**
 * Inject protection (nav blocker) into HTML.
 * Returns the modified HTML with nav blocker injected.
 */
export function injectProtectionIntoHtml(
  html: string,
  targetUrl: string,
  provider?: ProviderDefinition,
): string {
  const script = generateNavBlockerScript(targetUrl, provider);
  if (!script) return html; // protection disabled

  if (html.includes('</head>')) {
    return html.replace('</head>', script + '\n</head>');
  }
  if (html.includes('<body')) {
    return html.replace('<body', script + '\n<body');
  }
  return script + '\n' + html;
}

// ═══════════════════════════════════════════════════════════════
// CONTENT TYPE HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Determine Content-Type from file extension
 */
export function getContentTypeFromUrl(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    js: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    m3u8: 'application/x-mpegURL',
    mpd: 'application/dash+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    json: 'application/json',
    wasm: 'application/wasm',
  };
  return types[ext || ''] || 'application/octet-stream';
}

/**
 * Generate an empty response body based on content type
 */
export function getEmptyResponseBody(contentType: string): BodyInit {
  if (contentType.includes('javascript')) return '// Blocked';
  if (contentType.includes('css')) return '/* Blocked */';
  return new Uint8Array(0);
}
