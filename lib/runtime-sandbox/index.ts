/**
 * Runtime Sandbox - Client-side injection script for iframe hardening
 * 
 * This script is injected BEFORE any page scripts run and provides:
 * 1. Network API interception (fetch, XHR, sendBeacon, WebSocket)
 * 2. Navigation hijacking prevention (location, window.open, history)
 * 3. Popup blocking
 * 4. Safe navigation within iframe boundaries
 * 
 * Inspired by uBlock Origin's scriptlets and AdGuard's JS-injection.
 */

import { DEFAULT_FILTER_RULES } from '../filter-engine';

export interface SandboxConfig {
  targetUrl: string;
  providerKey: string;
  proxyBase: string;
  allowNavigation?: boolean;
  blockTrackers?: boolean;
}

/**
 * Generate the complete runtime sandbox script
 * This is injected as the FIRST script in the HTML document
 */
export function generateRuntimeSandbox(config: SandboxConfig): string {
  const filterRulesJson = JSON.stringify(DEFAULT_FILTER_RULES);
  
  return `
<script data-runtime-sandbox="true">
(function() {
  'use strict';
  
  // ============================================
  // CONFIGURATION
  // ============================================
  const CONFIG = {
    TARGET_URL: '${config.targetUrl}',
    PROVIDER_KEY: '${config.providerKey}',
    PROXY_BASE: '${config.proxyBase}',
    ALLOW_NAVIGATION: ${config.allowNavigation ?? false},
    BLOCK_TRACKERS: ${config.blockTrackers ?? true},
  };
  
  const TARGET_ORIGIN = new URL(CONFIG.TARGET_URL).origin;
  const FILTER_RULES = ${filterRulesJson};
  
  console.log('[RuntimeSandbox] 🔒 Initializing with config:', CONFIG);
  
  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function log(...args) {
    console.log('[RuntimeSandbox]', ...args);
  }
  
  function warn(...args) {
    console.warn('[RuntimeSandbox]', ...args);
  }
  
  function isBlobOrDataUrl(url) {
    return url.startsWith('blob:') || url.startsWith('data:');
  }
  
  function shouldBlockUrl(url) {
    if (!CONFIG.BLOCK_TRACKERS) return false;
    if (isBlobOrDataUrl(url)) return false;
    
    const urlLower = url.toLowerCase();
    
    for (var i = 0; i < FILTER_RULES.length; i++) {
      var rule = FILTER_RULES[i];
      var ruleLower = rule.toLowerCase();
      
      // Domain pattern (||domain.com^)
      if (rule.startsWith('||')) {
        var pattern = rule.slice(2).replace(/\\^$/, '');
        if (urlLower.includes(pattern.toLowerCase())) return true;
      }
      // Regex pattern (/pattern/)
      else if (rule.startsWith('/') && rule.endsWith('/')) {
        try {
          var regex = new RegExp(rule.slice(1, -1), 'i');
          if (regex.test(url)) return true;
        } catch(e) {}
      }
      // Path pattern (simple substring)
      else {
        if (urlLower.includes(ruleLower)) return true;
      }
    }
    
    return false;
  }
  
  function rewriteUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (isBlobOrDataUrl(url)) return url;
    if (url.startsWith('javascript:')) return url;
    
    // Already proxied
    if (url.includes('/api/') && url.includes(CONFIG.PROVIDER_KEY)) {
      return url;
    }
    
    // Relative URL - proxy it
    if (url.startsWith('/') && !url.startsWith('//')) {
      return CONFIG.PROXY_BASE + url;
    }
    
    // Absolute URL to target origin - proxy it
    try {
      var urlObj = new URL(url);
      if (urlObj.origin === TARGET_ORIGIN) {
        return CONFIG.PROXY_BASE + urlObj.pathname + urlObj.search;
      }
    } catch(e) {}
    
    return url;
  }
  
  // ============================================
  // LAYER 1: NAVIGATION HIJACKING PREVENTION
  // ============================================
  
  log('🔒 Layer 1: Installing navigation blockers');
  
  // Block window.open completely
  window.open = function() {
    warn('❌ window.open blocked');
    return null;
  };
  
  // Create mock location object that prevents navigation
  var mockLocation = {
    href: CONFIG.TARGET_URL,
    origin: TARGET_ORIGIN,
    protocol: new URL(CONFIG.TARGET_URL).protocol,
    host: new URL(CONFIG.TARGET_URL).host,
    hostname: new URL(CONFIG.TARGET_URL).hostname,
    port: new URL(CONFIG.TARGET_URL).port,
    pathname: new URL(CONFIG.TARGET_URL).pathname,
    search: new URL(CONFIG.TARGET_URL).search,
    hash: new URL(CONFIG.TARGET_URL).hash,
    assign: function(url) {
      warn('❌ location.assign blocked:', url);
    },
    replace: function(url) {
      warn('❌ location.replace blocked:', url);
    },
    reload: function() {
      warn('❌ location.reload blocked');
    },
    toString: function() {
      return CONFIG.TARGET_URL;
    }
  };
  
  // Override window.location
  try {
    Object.defineProperty(window, 'location', {
      configurable: false,
      enumerable: true,
      get: function() {
        return mockLocation;
      },
      set: function(val) {
        warn('❌ location.href assignment blocked:', val);
      }
    });
  } catch(e) {
    warn('⚠️ Could not override location:', e);
  }
  
  // Block top/parent navigation attempts
  try {
    Object.defineProperty(window, 'top', {
      get: function() {
        return { location: mockLocation };
      }
    });
    Object.defineProperty(window, 'parent', {
      get: function() {
        return { location: mockLocation };
      }
    });
  } catch(e) {}
  
  // Block history manipulation for cross-origin navigation
  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;
  
  history.pushState = function(state, title, url) {
    if (url && !url.startsWith(TARGET_ORIGIN) && !url.startsWith('/') && !url.startsWith('#')) {
      warn('❌ history.pushState blocked:', url);
      return;
    }
    return originalPushState.apply(this, arguments);
  };
  
  history.replaceState = function(state, title, url) {
    if (url && !url.startsWith(TARGET_ORIGIN) && !url.startsWith('/') && !url.startsWith('#')) {
      warn('❌ history.replaceState blocked:', url);
      return;
    }
    return originalReplaceState.apply(this, arguments);
  };
  
  // Block beforeunload (used for exit-intent popups)
  window.onbeforeunload = null;
  try {
    Object.defineProperty(window, 'onbeforeunload', {
      get: function() { return null; },
      set: function() {}
    });
  } catch(e) {}
  
  // Intercept click events to block external navigation
  document.addEventListener('click', function(e) {
    var target = e.target;
    while (target && target !== document) {
      if (target.tagName === 'A') {
        var href = target.getAttribute('href') || target.href;
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            var urlObj = new URL(href, CONFIG.TARGET_URL);
            if (urlObj.origin !== TARGET_ORIGIN && !CONFIG.ALLOW_NAVIGATION) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              warn('❌ External link click blocked:', href);
              return false;
            }
          } catch(err) {}
        }
      }
      target = target.parentElement;
    }
  }, true);
  
  // Block form submissions
  document.addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
    warn('❌ Form submission blocked');
    return false;
  }, true);
  
  // Remove target attributes from links
  setInterval(function() {
    try {
      document.querySelectorAll('a[target="_blank"], a[target="_top"], a[target="_parent"]').forEach(function(link) {
        link.removeAttribute('target');
      });
      document.querySelectorAll('meta[http-equiv="refresh"]').forEach(function(meta) {
        meta.remove();
      });
    } catch(e) {}
  }, 200);
  
  // ============================================
  // LAYER 2: NETWORK API INTERCEPTION
  // ============================================
  
  log('🔒 Layer 2: Installing network blockers');
  
  // Block fetch API
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input.url || input);
    
    if (shouldBlockUrl(url)) {
      warn('❌ fetch blocked:', url);
      return Promise.resolve(new Response('', { 
        status: 204, 
        statusText: 'Blocked by RuntimeSandbox' 
      }));
    }
    
    // Rewrite URL through proxy
    var rewrittenUrl = rewriteUrl(url);
    if (rewrittenUrl !== url) {
      log('🔗 fetch rewritten:', url, '->', rewrittenUrl);
      if (input instanceof Request) {
        input = new Request(rewrittenUrl, input);
      } else {
        input = rewrittenUrl;
      }
    }
    
    return originalFetch.apply(this, arguments);
  };
  
  // Block XMLHttpRequest
  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    if (shouldBlockUrl(url)) {
      warn('❌ XHR.open blocked:', url);
      this._sandboxBlocked = true;
      return;
    }
    
    var rewrittenUrl = rewriteUrl(url);
    if (rewrittenUrl !== url) {
      log('🔗 XHR rewritten:', url, '->', rewrittenUrl);
      url = rewrittenUrl;
    }
    
    return originalXHROpen.call(this, method, url, async, user, password);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    if (this._sandboxBlocked) {
      warn('❌ XHR.send blocked');
      return;
    }
    return originalXHRSend.call(this, body);
  };
  
  // Block sendBeacon (used for tracking)
  var originalSendBeacon = navigator.sendBeacon;
  navigator.sendBeacon = function(url, data) {
    if (shouldBlockUrl(url)) {
      warn('❌ sendBeacon blocked:', url);
      return false;
    }
    return originalSendBeacon.call(this, url, data);
  };
  
  // Optional: Block WebSocket (can be enabled if needed)
  // var originalWebSocket = window.WebSocket;
  // window.WebSocket = function(url, protocols) {
  //   if (shouldBlockUrl(url)) {
  //     warn('❌ WebSocket blocked:', url);
  //     throw new Error('WebSocket blocked by RuntimeSandbox');
  //   }
  //   return new originalWebSocket(url, protocols);
  // };
  
  // ============================================
  // LAYER 3: ELEMENT CREATION INTERCEPTION
  // ============================================
  
  log('🔒 Layer 3: Installing element interceptors');
  
  // Intercept document.createElement for scripts, images, links
  var originalCreateElement = document.createElement.bind(document);
  
  document.createElement = function(tagName, options) {
    var el = originalCreateElement(tagName, options);
    var tag = tagName.toLowerCase();
    
    if (tag === 'script' || tag === 'img' || tag === 'link' || tag === 'iframe') {
      // Override src attribute
      var originalSetAttribute = el.setAttribute.bind(el);
      var originalGetAttribute = el.getAttribute.bind(el);
      
      el.setAttribute = function(name, value) {
        if (name === 'src' || name === 'href') {
          if (shouldBlockUrl(value)) {
            warn('❌ Element src/href blocked:', value);
            return;
          }
          value = rewriteUrl(value);
        }
        return originalSetAttribute(name, value);
      };
      
      // Handle property setters
      if (tag === 'script' || tag === 'img') {
        try {
          var originalSrcDescriptor = Object.getOwnPropertyDescriptor(
            tag === 'script' ? HTMLScriptElement.prototype : HTMLImageElement.prototype,
            'src'
          );
          
          if (originalSrcDescriptor) {
            Object.defineProperty(el, 'src', {
              get: function() {
                return originalSrcDescriptor.get.call(this);
              },
              set: function(val) {
                if (shouldBlockUrl(val)) {
                  warn('❌ Script/Image src blocked:', val);
                  return;
                }
                originalSrcDescriptor.set.call(this, rewriteUrl(val));
              },
              configurable: true,
              enumerable: true
            });
          }
        } catch(e) {}
      }
      
      if (tag === 'link') {
        try {
          var originalHrefDescriptor = Object.getOwnPropertyDescriptor(
            HTMLLinkElement.prototype,
            'href'
          );
          
          if (originalHrefDescriptor) {
            Object.defineProperty(el, 'href', {
              get: function() {
                return originalHrefDescriptor.get.call(this);
              },
              set: function(val) {
                if (shouldBlockUrl(val)) {
                  warn('❌ Link href blocked:', val);
                  return;
                }
                originalHrefDescriptor.set.call(this, rewriteUrl(val));
              },
              configurable: true,
              enumerable: true
            });
          }
        } catch(e) {}
      }
      
      if (tag === 'iframe') {
        try {
          var originalSrcDescriptor = Object.getOwnPropertyDescriptor(
            HTMLIFrameElement.prototype,
            'src'
          );
          
          if (originalSrcDescriptor) {
            Object.defineProperty(el, 'src', {
              get: function() {
                return originalSrcDescriptor.get.call(this);
              },
              set: function(val) {
                if (shouldBlockUrl(val)) {
                  warn('❌ Iframe src blocked:', val);
                  return;
                }
                // Rewrite nested iframes through proxy
                if (val && !val.startsWith('blob:') && !val.startsWith('data:')) {
                  try {
                    var urlObj = new URL(val, CONFIG.TARGET_URL);
                    if (urlObj.origin === TARGET_ORIGIN) {
                      val = CONFIG.PROXY_BASE + urlObj.pathname + urlObj.search;
                    }
                  } catch(e) {}
                }
                originalSrcDescriptor.set.call(this, val);
              },
              configurable: true,
              enumerable: true
            });
          }
        } catch(e) {}
      }
    }
    
    return el;
  };
  
  // Intercept Image constructor
  var OriginalImage = window.Image;
  window.Image = function(width, height) {
    var img = new OriginalImage(width, height);
    
    try {
      var originalSrcDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        'src'
      );
      
      if (originalSrcDescriptor) {
        Object.defineProperty(img, 'src', {
          get: function() {
            return originalSrcDescriptor.get.call(this);
          },
          set: function(val) {
            if (shouldBlockUrl(val)) {
              warn('❌ Image() src blocked:', val);
              return;
            }
            originalSrcDescriptor.set.call(this, rewriteUrl(val));
          },
          configurable: true,
          enumerable: true
        });
      }
    } catch(e) {}
    
    return img;
  };
  
  // ============================================
  // LAYER 4: SERVICE WORKER NEUTRALIZATION
  // ============================================
  
  log('🔒 Layer 4: Neutralizing service workers');
  
  if ('serviceWorker' in navigator) {
    // Unregister any existing service workers
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      for (var i = 0; i < registrations.length; i++) {
        registrations[i].unregister();
        log('✅ Service worker unregistered');
      }
    }).catch(function() {});
    
    // Block new registrations
    navigator.serviceWorker.register = function() {
      warn('❌ Service worker registration blocked');
      return Promise.reject(new Error('Service worker blocked by RuntimeSandbox'));
    };
  }
  
  // ============================================
  // LAYER 5: ADDITIONAL PROTECTIONS
  // ============================================
  
  log('🔒 Layer 5: Installing additional protections');
  
  // Block document.write (used for dynamic script injection)
  var originalWrite = document.write;
  var originalWriteLn = document.writeln;
  
  document.write = function(html) {
    // Allow but scan for blocked content
    if (shouldBlockUrl(html)) {
      warn('❌ document.write blocked');
      return;
    }
    return originalWrite.call(this, html);
  };
  
  document.writeln = function(html) {
    if (shouldBlockUrl(html)) {
      warn('❌ document.writeln blocked');
      return;
    }
    return originalWriteLn.call(this, html);
  };
  
  // Block eval and Function constructor (optional, can break players)
  // var originalEval = window.eval;
  // window.eval = function(code) {
  //   if (shouldBlockUrl(code)) {
  //     warn('❌ eval blocked');
  //     return;
  //   }
  //   return originalEval.call(this, code);
  // };
  
  // Continuous cleanup interval
  setInterval(function() {
    try {
      // Remove any injected tracking scripts
      document.querySelectorAll('script[src*="analytics"], script[src*="tracking"], script[src*="beacon"]').forEach(function(s) {
        if (shouldBlockUrl(s.src)) {
          s.remove();
          log('✅ Removed tracking script');
        }
      });
      
      // Remove tracking pixels
      document.querySelectorAll('img[src*="pixel"], img[src*="track"], img[src*="analytics"]').forEach(function(img) {
        if (shouldBlockUrl(img.src)) {
          img.remove();
          log('✅ Removed tracking pixel');
        }
      });
      
      // Remove hidden iframes (often used for tracking)
      document.querySelectorAll('iframe[style*="display:none"], iframe[style*="visibility:hidden"], iframe[width="0"], iframe[height="0"]').forEach(function(iframe) {
        iframe.remove();
        log('✅ Removed hidden iframe');
      });
    } catch(e) {}
  }, 1000);
  
  // ============================================
  // INITIALIZATION COMPLETE
  // ============================================
  
  log('✅ RuntimeSandbox initialization complete');
  log('🛡️  Protection layers active:');
  log('   - Navigation hijacking prevention');
  log('   - Network API interception');
  log('   - Element creation interception');
  log('   - Service worker neutralization');
  log('   - Continuous cleanup');
  
})();
</script>
`.trim();
}

/**
 * Generate a minimal version for performance-critical scenarios
 */
export function generateMinimalSandbox(config: SandboxConfig): string {
  return `
<script data-minimal-sandbox="true">
(function() {
  'use strict';
  var TARGET = '${config.targetUrl}';
  var PROXY = '${config.proxyBase}';
  
  // Block navigation
  window.open = function() { return null; };
  Object.defineProperty(window, 'location', {
    get: function() { return { href: TARGET, origin: new URL(TARGET).origin, assign: function(){}, replace: function(){} }; }
  });
  
  // Block fetch
  var _fetch = window.fetch;
  window.fetch = function(u) {
    if (u && (u.includes('analytics') || u.includes('tracking') || u.includes('cdn-cgi'))) {
      return Promise.resolve(new Response('', {status: 204}));
    }
    return _fetch.apply(this, arguments);
  };
  
  // Block XHR
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u) {
    if (u && (u.includes('analytics') || u.includes('tracking'))) { this._b = true; return; }
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() { if (this._b) return; };
})();
</script>
`.trim();
}

export default {
  generateRuntimeSandbox,
  generateMinimalSandbox,
};
