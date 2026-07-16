/**
 * Minimal Runtime Guard — surgical replacement for the 15-layer playerGuard.
 *
 * Per the expert recommendation, most protections previously done via
 * JS hacks are now handled by:
 *   - Network-level blocking  (@cliqz/adblocker — strips ads before they load)
 *   - Iframe sandbox attribute (browser-enforced popup/nav blocking)
 *   - Cosmetic CSS injection   (zero-CPU style-based ad hiding)
 *
 * This guard only handles what those layers cannot:
 *   A. window.open — defense-in-depth (sandbox should already block this)
 *   B. Anchor click() popup bypass (some providers use <a>.click() for popups)
 *   C. Self-healing ad re-injection — debounced, idle-scheduled MutationObserver
 *   D. attachShadow interception — forced open mode for ad detection
 *
 * @returns A self-executing JS string to inject into the player page
 */
export function buildMinimalGuardScript(): string {
  return `
(function() {
  'use strict';
  if (window.__FS_GUARD__) return;
  window.__FS_GUARD__ = true;

  function isExternal(href) {
    try {
      var u = new URL(href, location.href);
      return u.origin !== location.origin;
    } catch(e) { return true; }
  }

  function isAdElement(el) {
    if (!el || !el.tagName) return false;
    var src = el.getAttribute('src') || el.src || '';
    var l = src.toLowerCase();
    var adHints = ['doubleclick', 'googleadservices', 'googlesyndication',
      'google-analytics', 'googletagmanager', 'adnxs', 'popads', 'popcash',
      'popunder', 'adsterra', 'propellerads', 'exoclick', 'juicyads',
      'plugrush', 'adcash', 'clickadu', 'pixel.', 'track.',
      'frowstyambler', 'cloudflareinsights', 'beacon.'];
    for (var i = 0; i < adHints.length; i++) {
      if (l.indexOf(adHints[i]) !== -1) return true;
    }
    // High-z-index fixed overlays without video
    try {
      var cs = window.getComputedStyle(el);
      var z = parseInt(cs.zIndex);
      if (!isNaN(z) && z > 100 && (cs.position === 'fixed' || cs.position === 'sticky')) {
        if (!el.querySelector('video, iframe[src*=\\"player\\"], iframe[src*=\\"embed\\"]')) {
          return true;
        }
      }
    } catch(e) {}
    return false;
  }

  // A. window.open — defense-in-depth
  try {
    window.open = function(url) {
      if (url && typeof url === 'string') {
        if (!isExternal(url)) {
          try { return window.open(url); } catch(e) { return null; }
        }
      }
      return null;
    };
  } catch(e) {}

  // B. Anchor click() popup bypass
  try {
    var _aClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.target === '_blank' || (this.href && isExternal(this.href))) return;
      return _aClick.call(this);
    };
  } catch(e) {}

  // C. Self-healing ad re-injection — debounced + idle-scheduled
  try {
    var removedAds = [];
    var adObserver = new MutationObserver(function(muts) {
      var hasAds = false;
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < (muts[i].addedNodes || []).length; j++) {
          var n = muts[i].addedNodes[j];
          if (n.nodeType === 1 && (n.tagName === 'IFRAME' || n.tagName === 'DIV' || n.tagName === 'SECTION' || n.tagName === 'ASIDE')) {
            if (isAdElement(n)) {
              n.remove();
              hasAds = true;
            }
          }
        }
      }
      if (hasAds) {
        // Schedule another sweep in 500ms for any re-injected ads
        setTimeout(function() {
          document.querySelectorAll('iframe, div, section, aside').forEach(function(el) {
            if (isAdElement(el)) el.remove();
          });
        }, 500);
      }
    });
    adObserver.observe(document.documentElement, { childList: true, subtree: true });
    // Also sweep on initial load (deferred to avoid layout thrash)
    setTimeout(function() {
      document.querySelectorAll('iframe[src*=\\"ad\\"], div[style*=\\"position: fixed\\"]').forEach(function(el) {
        if (isAdElement(el)) el.remove();
      });
    }, 1000);
  } catch(e) {}

  // D. attachShadow interception
  try {
    var _attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      var root = _attachShadow.call(this, { mode: 'open' });
      // Watch for ad elements inside shadow roots
      try {
        var shadowObs = new MutationObserver(function(muts) {
          for (var i = 0; i < muts.length; i++) {
            for (var j = 0; j < (muts[i].addedNodes || []).length; j++) {
              var n = muts[i].addedNodes[j];
              if (n.nodeType === 1 && n.tagName === 'IFRAME' && isAdElement(n)) {
                n.remove();
              }
            }
          }
        });
        shadowObs.observe(root, { childList: true, subtree: true });
      } catch(e) {}
      return root;
    };
  } catch(e) {}

  console.log('[FSGuard] Minimal guard active');
})();
true;
`.trim();
}

/**
 * Build the cosmetic CSS injection script.
 * Injects a <style> tag with the given CSS at the top of <head>.
 */
export function buildCosmeticInjectScript(css: string): string {
  if (!css) return '';
  return `
(function() {
  try {
    var style = document.createElement('style');
    style.id = 'fs-cosmetic';
    style.textContent = ${JSON.stringify(css)};
    if (document.head) {
      document.head.insertBefore(style, document.head.firstChild);
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        document.head.insertBefore(style, document.head.firstChild);
      });
    }
  } catch(e) {}
})();
true;
`.trim();
}

/**
 * Build the complete scripts for injection into a player page.
 * Minimal guard + cosmetic CSS (if provided).
 */
export function buildAllPlayerScripts(css?: string): string {
  const scripts = [buildMinimalGuardScript()];
  if (css) {
    scripts.push(buildCosmeticInjectScript(css));
  }
  return scripts.join('\n\n');
}
