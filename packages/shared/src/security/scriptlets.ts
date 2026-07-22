/**
 * uBlock Origin-style scriptlets for anti-anti-adblock protection.
 *
 * These are small JavaScript functions that neutralize common anti-adblock
 * techniques used by streaming providers. They prevent providers from
 * detecting that we've monkey-patched window.open, fetch, XHR, etc.
 *
 * Each function returns a self-executing JS string. They are combined
 * via buildAllScriptlets() and injected alongside the main guard script.
 *
 * Reference: uBlock Origin's built-in scriptlets
 *   https://github.com/gorhill/uBlock/tree/master/src/js/scriptlets
 */

/**
 * abort-on-property-read — prevents a page from successfully reading a
 * specific property. When any code tries to read the named property,
 * this scriptlet throws, aborting the calling script.
 *
 * Use cases:
 *   - _popAds / popAds (blocks popunder ad libraries)
 *   - showad / show_ad (blocks ad-showing functions)
 *   - adblock / isAdBlockActive (blocks anti-adblock detection)
 */
export function buildAbortOnPropertyRead(propertyName: string): string {
  return `
(function() {
  if (window.__abort_${propertyName}) return;
  window.__abort_${propertyName} = true;
  var chain = ${JSON.stringify(propertyName)}.split('.');
  var target = window;
  for (var i = 0; i < chain.length - 1; i++) {
    target = target[chain[i]];
    if (!target) return;
  }
  var prop = chain[chain.length - 1];
  var desc = Object.getOwnPropertyDescriptor(target, prop) || { configurable: true, enumerable: true };
  Object.defineProperty(target, prop, {
    get: function() { throw new Error('abort-on-property-read: ' + ${JSON.stringify(propertyName)}); },
    set: function(v) {
      Object.defineProperty(target, prop, { value: v, writable: true, configurable: true });
    },
    configurable: true
  });
})();`;
}

/**
 * abort-current-inline-script — prevents execution of inline script blocks
 * that contain a specific string pattern. This catches anti-adblock scripts
 * before they execute.
 *
 * Use cases:
 *   - Inline scripts containing "popunder" or "adBlock" or "adblock"
 *   - Inline scripts with specific URL patterns or function calls
 */
export function buildAbortCurrentInlineScript(searchPattern: string): string {
  return `
(function() {
  if (window.__abortInline) return;
  window.__abortInline = true;
  var _search = ${JSON.stringify(searchPattern)};
  try {
    var _origCreateElement = document.createElement.bind(document);
    document.createElement = function(tag, options) {
      var el = _origCreateElement(tag, options);
      if (tag && tag.toLowerCase() === 'script') {
        var origText = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'textContent') || {};
        Object.defineProperty(el, 'textContent', {
          set: function(v) {
            if (typeof v === 'string' && v.indexOf(_search) !== -1) {
              return;
            }
            return origText.set ? origText.set.call(this, v) : undefined;
          },
          get: function() { return origText.get ? origText.get.call(this) : ''; },
          configurable: true
        });
        var origSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src') || {};
        Object.defineProperty(el, 'src', {
          set: function(v) {
            if (typeof v === 'string' && v.indexOf(_search) !== -1) {
              return;
            }
            origSrc.set ? origSrc.set.call(this, v) : (el.src = v);
          },
          get: function() { return origSrc.get ? origSrc.get.call(this) : ''; },
          configurable: true
        });
      }
      return el;
    };
  } catch(e) {}
})();`;
}

/**
 * set-constant — forces a property to always return a specific value.
 * This prevents providers from checking whether ads are enabled/blocked.
 *
 * Use cases:
 *   - adsEnabled = false
 *   - canShowAds = false
 *   - adblock = false
 *   - showPopUnder = false
 *   - popunderAllowed = false
 */
export function buildSetConstant(propertyName: string, value: string): string {
  return `
(function() {
  if (window.__setConst_${propertyName}) return;
  window.__setConst_${propertyName} = true;
  var chain = ${JSON.stringify(propertyName)}.split('.');
  var target = window;
  for (var i = 0; i < chain.length - 1; i++) {
    target = target[chain[i]];
    if (!target) return;
  }
  var prop = chain[chain.length - 1];
  Object.defineProperty(target, prop, {
    get: function() { return ${value}; },
    set: function() {},
    configurable: false
  });
})();`;
}

/**
 * nowoif (no-window-open-in-frame) — prevents Window.open calls in
 * cross-origin child iframes. This reinforces the window.open seal
 * that the parent frame already has.
 */
export function buildNoWindowOpenInFrame(): string {
  return `
(function() {
  if (window.__noWoif) return;
  window.__noWoif = true;
  try {
    var _noop = function() { return null; };
    Object.defineProperty(window, 'open', {
      value: _noop,
      writable: false,
      configurable: false
    });
  } catch(e) {}
})();`;
}

/**
 * prevent-addEventListener — blocks specific event listeners from
 * being added. This prevents anti-adblock scripts from detecting
 * focus/blur/visibility changes caused by our popup blocking.
 *
 * Use cases:
 *   - Prevent visibilitychange listeners (anti-adblock detects
 *     when tab focus is stolen by popup blocking)
 *   - Prevent focus/blur listener-based detection
 */
export function buildPreventAddEventListener(type: string, pattern?: string): string {
  const searchPattern = pattern || '.*';
  return `
(function() {
  if (window.__preventEL_${type}) return;
  window.__preventEL_${type} = true;
  try {
    var _origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(eventType, listener, options) {
      if (eventType === ${JSON.stringify(type)}) {
        return;
      }
      return _origAdd.call(this, eventType, listener, options);
    };
  } catch(e) {}
})();`;
}

/**
 * no-setInterval-if — blocks setInterval calls whose handler string
 * or interval matches a pattern. Useful for blocking polling-based ads.
 */
export function buildNoSetIntervalIf(pattern: string): string {
  return `
(function() {
  if (window.__noSetIntervalIf) return;
  window.__noSetIntervalIf = true;
  var _search = ${JSON.stringify(pattern)};
  try {
    var _orig = window.setInterval;
    window.setInterval = function(handler, delay) {
      if (typeof handler === 'string' && handler.indexOf(_search) !== -1) {
        return 0;
      }
      return _orig.apply(window, arguments);
    };
  } catch(e) {}
})();`;
}

/**
 * Build ALL anti-anti-adblock scriptlets into a single JS string.
 * This is the main entry point.
 */
export function buildAllScriptlets(): string {
  const scriptlets: string[] = [];

  // 1. Prevent access to common popunder/ad variables
  scriptlets.push(buildAbortOnPropertyRead('_popAds'));
  scriptlets.push(buildAbortOnPropertyRead('popAds'));
  scriptlets.push(buildAbortOnPropertyRead('popad'));
  scriptlets.push(buildAbortOnPropertyRead('show_ad'));
  scriptlets.push(buildAbortOnPropertyRead('showad'));
  scriptlets.push(buildAbortOnPropertyRead('adblock'));
  scriptlets.push(buildAbortOnPropertyRead('isAdBlockActive'));

  // 2. Set ad-related constants to false
  scriptlets.push(buildSetConstant('adsEnabled', 'false'));
  scriptlets.push(buildSetConstant('canShowAds', 'false'));
  scriptlets.push(buildSetConstant('showPopUnder', 'false'));
  scriptlets.push(buildSetConstant('popunderAllowed', 'false'));
  scriptlets.push(buildSetConstant('enableAds', 'false'));
  scriptlets.push(buildSetConstant('showAds', 'false'));
  scriptlets.push(buildSetConstant('ad_block', 'false'));

  // 3. Prevent addEventListener for visibility/focus changes
  // Anti-adblock scripts use visibilitychange to detect popup blocking
  scriptlets.push(buildPreventAddEventListener('visibilitychange'));
  scriptlets.push(buildPreventAddEventListener('webkitvisibilitychange'));
  scriptlets.push(buildPreventAddEventListener('blur'));
  scriptlets.push(buildPreventAddEventListener('focus'));

  // 4. Block setInterval for ad-lookup polling
  scriptlets.push(buildNoSetIntervalIf('popAds'));
  scriptlets.push(buildNoSetIntervalIf('popunder'));

  // 5. no-window-open-in-frame for child frames
  scriptlets.push(buildNoWindowOpenInFrame());

  return scriptlets.join('\n\n');
}

/**
 * Provider-specific set-constant overrides.
 * Some providers use specific variable names for ad control.
 */
export function getProviderScriptlets(providerId: string): string[] {
  const overrides: Record<string, string[]> = {
    nxsha: [
      buildSetConstant('nx_ads', 'false'),
      buildSetConstant('nx_popup', 'false'),
      buildAbortOnPropertyRead('NXAds'),
      buildAbortOnPropertyRead('nxsPop'),
    ],
    chillflix: [
      buildSetConstant('cf_ads', 'false'),
    ],
  };
  return overrides[providerId] || [];
}
