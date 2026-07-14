/**
 * Per-provider UI cleanup configuration.
 *
 * Instead of hardcoding provider-specific CSS rules and text-hide keywords
 * inside injected JavaScript strings, this config serves as a single source
 * of truth that makeCFBypassScript() reads at runtime.
 *
 * Each entry key matches the provider's `id` from the provider registry.
 */
export interface ProviderConfig {
  /** CSS rules injected via <style> tag on page load. */
  cssRules?: string[];
  /** Text keywords: elements whose textContent matches are hidden. */
  hideKeywords?: string[];
  /** CSS selectors to hide (injected as display:none rules). */
  hideSelectors?: string[];
}

export const providerConfigs: Record<string, ProviderConfig> = {
  nxsha: {
    cssRules: [
      'a[href="https://nxsha.app"]{display:none!important}',
      // Popup overlay patterns — class-based
      'div[class*="overlay"]{display:none!important}',
      'div[class*="popup"]{display:none!important}',
      'div[class*="modal"]{display:none!important}',
      'div[class*="ad-"]{display:none!important}',
      'div[id*="overlay"]{display:none!important}',
      'div[id*="popup"]{display:none!important}',
      'div[id*="modal"]{display:none!important}',
      // Fixed-position fullscreen overlays (semi-transparent backgrounds)
      'div[style*="position: fixed"][style*="background: rgba"]{display:none!important}',
      'div[style*="position:fixed"][style*="background:rgba"]{display:none!important}',
      'div[style*="position: fixed"][style*="z-index"]{display:none!important}',
      'div[style*="position:fixed"][style*="z-index"]{display:none!important}',
      // Blanket hide for elements with z-index >= 999 (common popup pattern)
      'div[style*="z-index: 99"]{display:none!important}',
      'div[style*="z-index:999"]{display:none!important}',
      'div[style*="z-index: 999"]{display:none!important}',
    ],
    hideSelectors: [
      'div[class*="overlay"]',
      'div[class*="popup"]',
      'div[class*="modal"]',
      'div[class*="ad-"]',
      'div[class*="ad_"]',
      'div[class*="advert"]',
      'div[id*="overlay"]',
      'div[id*="popup"]',
      'div[id*="modal"]',
      'div[id*="ad-"]',
      'a[href*="go."]',
      'a[href*="click."]',
    ],
    hideKeywords: [
      'close ad',
      'skip ad',
      'advertisement',
      'sponsored',
    ],
  },
  chillflix: {
    hideKeywords: [
      'watch party',
      'login',
      'log in',
      'sign in',
      'create account',
      'sign up',
    ],
  },
  screenscape: {
    hideKeywords: [
      'download our app',
    ],
    hideSelectors: [
      'a[href="https://screenscape.fun"]',
      'a[href*="download" i]',
      'button[aria-label^="Ads window ends" i]',
      'div[aria-label^="Ads window ends" i]',
      'span[aria-label^="Ads window ends" i]',
    ],
    cssRules: [
      'a[href="https://screenscape.fun"]{display:none!important}',
      'a[href="https://screenscape.fun"]+*{display:none!important}',
      'button[aria-label^="Ads" i]{display:none!important}',
      'div[class*="timer" i]{display:none!important}',
    ],
  },
};

/**
 * Generate a provider-specific JS snippet from a ProviderConfig.
 * Returns an empty string if no config is provided.
 *
 * This is called at injection-build time (in the RN JS thread), not inside
 * the WebView. The returned string is embedded into the injected JavaScript
 * template literal.
 */
export function generateProviderSnippet(config?: ProviderConfig): string {
  if (!config) return '';
  const parts: string[] = [];

  // ── CSS injection ──
  // Append to <html> if <head> isn't parsed yet (safe at document-start).
  // ref: "is it possible to add style tag before head tag" (uBlock Origin pattern)
  if (config.cssRules?.length) {
    const css = config.cssRules.join(' ');
    parts.push(
      `(function(){try{var s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);}catch(e){}})();`
    );
  }

  // ── DOM Sweeper (Selectors + Keywords, MutationObserver-driven) ──
  // Merged into a single sweeper so we only pay for one MutationObserver per
  // provider instead of two. The sweeper runs immediately on script execution
  // (catches elements that exist at DOMContentLoaded) and then on every DOM
  // mutation (catches dynamically-added server dialogs, ad timers, etc.).
  if (config.hideSelectors?.length || config.hideKeywords?.length) {
    const sels = JSON.stringify(config.hideSelectors || []);
    const kws = JSON.stringify(config.hideKeywords || []);

    parts.push(
      `(function(){var sels=${sels};var kws=${kws};function sweep(root){if(!root)root=document;` +
      `if(sels.length){sels.forEach(function(sel){try{var nodes=root.querySelectorAll(sel);` +
      `for(var i=0;i<nodes.length;i++){nodes[i].style.display='none';}}catch(e){}});}` +
      `if(kws.length){try{var el=root.querySelectorAll('button,a,span[role="button"],div');` +
      `for(var i=0;i<el.length;i++){var t=(el[i].textContent||'').toLowerCase().trim();` +
      `if(!t)continue;for(var j=0;j<kws.length;j++){if(t.indexOf(kws[j])!==-1){` +
      `el[i].style.display='none';break;}}}}catch(e){}}}` +
      `sweep(document);try{var obs=new MutationObserver(function(){sweep(document);});` +
      `obs.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}})();`
    );
  }

  return parts.join('\n');
}
