import type { ApiInterceptRule } from "@filmsnaps/shared";

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
  /**
   * Synthetic API-response intercepts (e.g. screenscape's ad-window poll).
   * Mirrors blocklist.json `providers[].apiIntercepts` — the shared bundle's
   * fetch/XHR monkey-patch returns a synthetic response before the request
   * leaves the WebView.
   */
  apiIntercepts?: ApiInterceptRule[];
}

export const providerConfigs: Record<string, ProviderConfig> = {
  nxsha: {
    cssRules: [
      'a[href="https://nxsha.app"]{display:none!important}',
      // Only hide specific ad patterns, NOT generic modal/overlay classes
      // (nxsha's own quality picker uses "modal" in class names)
      'div[class*="ad-"]{display:none!important}',
      'div[class*="ad_"]{display:none!important}',
      'div[id*="ad-"]{display:none!important}',
      'div[id*="ad_"]{display:none!important}',
      'div[class*="advert"]{display:none!important}',
      'div[class*="sponsor"]{display:none!important}',
      // Fixed-position overlays with high z-index that are clearly ads
      // (not player controls — nxsha's player overlays have z-index < 9999)
      'div[style*="z-index: 2147483647"]{display:none!important}',
      // Player chrome cleanup (mirror of blocklist.json cosmeticRules):
      // "Episodes" list button (lucide-list icon), "Crop to Fill" fullscreen
      // button, and the right-side player-tools rail (server 6). :has() is
      // legal in the CSS channel only — keep it OUT of hideSelectors.
      "button:has(svg.lucide-list){display:none!important}",
      'button[title="Crop to Fill"]{display:none!important}',
      'div[class*="right-3"][class*="top-1/2"][class*="z-30"]{display:none!important}',
    ],
    hideSelectors: [
      'div[class*="ad-"]',
      'div[class*="ad_"]',
      'div[class*="advert"]',
      'div[class*="sponsor"]',
      'div[id*="ad-"]',
      'div[id*="ad_"]',
      'a[href*="go."]',
      'a[href*="click."]',
      'a[href*="nxsha.app"]',
      'button[title="Crop to Fill"]',
      'div[class*="right-3"][class*="top-1/2"][class*="z-30"]',
    ],
    hideKeywords: ["close ad", "skip ad", "advertisement", "sponsored"],
  },
  chillflix: {
    hideKeywords: [
      "watch party",
      "login",
      "log in",
      "sign in",
      "create account",
      "sign up",
    ],
  },
  screenscape: {
    hideKeywords: ["download our app", "up next", "next episode"],
    hideSelectors: [
      'a[href="https://screenscape.fun"]',
      'a[href*="download" i]',
      'button[aria-label^="Ads window ends" i]',
      'div[aria-label^="Ads window ends" i]',
      'span[aria-label^="Ads window ends" i]',
      // Desktop parity (blocklist.json cosmeticRules): title-variant badge +
      // the two ad/telegram footer buttons.
      'button[title^="Ads window ends" i]',
      'button[title^="Download Sources" i]',
      'button[title^="Switch server and open Telegram" i]',
      // "Up Next Ep N" toast (Dismiss button + next-episode button).
      // The toast wrapper div can't be swept with :has() here (querySelectorAll
      // throws), so hide the Dismiss button (stable anchor). The sibling
      // Up-Next button has no stable attribute — it's caught by the "up next"
      // hideKeyword (sweeper scans button textContent, no :has() needed) and,
      // when the device supports :has(), by the CSS div:has(...) rule below.
      'button[aria-label="Dismiss"]',
    ],
    cssRules: [
      'a[href="https://screenscape.fun"]{display:none!important}',
      'a[href="https://screenscape.fun"]+*{display:none!important}',
      // :has() is legal inside a <style> tag (CSS channel). It must NOT go
      // into hideSelectors — Android WebView's querySelectorAll throws
      // SyntaxError on :has().
      'div:has(> a[href="https://screenscape.fun"]){display:none!important}',
      'button[aria-label^="Ads window ends" i]{display:none!important}',
      'button[title^="Ads window ends" i]{display:none!important}',
      'button[title^="Download Sources" i]{display:none!important}',
      'button[title^="Switch server and open Telegram" i]{display:none!important}',
      'div[class*="timer" i]{display:none!important}',
      // "Up Next Ep N" toast: the wrapper div (flex items-center gap-2)
      // contains a Dismiss button + next-episode button. :has() is legal in
      // the CSS channel — hides the whole toast via the stable Dismiss anchor
      // (parity with blocklist.json cosmeticRules).
      'div:has(> button[aria-label="Dismiss"]){display:none!important}',
      // Backup for when :has() is unsupported: the Up Next wrapper is a div
      // whose first child is a Dismiss button (the X). These two ancestor
      // selectors don't need :has().
      'button[aria-label="Dismiss"]{display:none!important}',
    ],
    apiIntercepts: [
      {
        // Mirror of blocklist.json providers[].screenscape.apiIntercepts:
        // the ad-window cycle poll returns a synthetic ad-free response
        // before the request leaves the WebView.
        match: "/api/ads/cycles",
        methods: ["GET", "POST"],
        synthetic: {
          primary: { ok: true, anchorMs: "@@NOW@@" },
          fallback: { anchorMs: "@@NOW@@", source: "fallback" },
          fallbackCondition: "source=fallback",
        },
      },
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
  if (!config) return "";
  const parts: string[] = [];

  // ── CSS injection ──
  // Append to <html> if <head> isn't parsed yet (safe at document-start).
  // ref: "is it possible to add style tag before head tag" (uBlock Origin pattern)
  if (config.cssRules?.length) {
    const css = config.cssRules.join(" ");
    parts.push(
      `(function(){try{var s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);}catch(e){}})();`,
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

    // V6: the sweeper now runs for the WHOLE session, not just the first 10s.
    // Root cause of the screenscape "Up Next Ep N" toast: it appears at END of
    // video (~37s in, driven by the vp-ring-fill progress ring), but the V5
    // interval was cleared after 10s — dead before the toast ever rendered.
    // Two-layer cadence: a fast 1.5s sweep for the first 15s (React hydration
    // re-renders) + a permanent slow 3s sweep so end-of-video UI is caught.
    // The MutationObserver ALSO watches style/class/aria-label attribute
    // changes now — display toggles don't insert nodes, so a childList-only
    // observer missed them. Cost is bounded: each tick is a handful of
    // selector matches + a text scan over buttons; a hidden element stays
    // hidden (display:none is idempotent).
    parts.push(
      `(function(){var sels=${sels};var kws=${kws};function sweep(root){if(!root)root=document;` +
        `if(sels.length){sels.forEach(function(sel){try{var nodes=root.querySelectorAll(sel);` +
        `for(var i=0;i<nodes.length;i++){nodes[i].style.display='none';}}catch(e){}});}` +
        `if(kws.length){try{var el=root.querySelectorAll('button,a,span[role="button"],div');` +
        `for(var i=0;i<el.length;i++){var t=(el[i].textContent||'').toLowerCase().trim();` +
        `if(!t)continue;for(var j=0;j<kws.length;j++){if(t.indexOf(kws[j])!==-1){` +
        `el[i].style.display='none';break;}}}}catch(e){}}}` +
        `sweep(document);try{var obs=new MutationObserver(function(){sweep(document);});` +
        `obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,` +
        `attributeFilter:['style','class','aria-label']});}catch(e){}` +
        `try{var fast=setInterval(function(){sweep(document);},1500);` +
        `setTimeout(function(){clearInterval(fast);},15000);}catch(e){}` +
        `try{setInterval(function(){sweep(document);},3000);}catch(e){}})();`,
    );
  }

  // ── COSMETIC-PROBE (DIAGNOSTIC) ──
  // Reveals WHY a UI element we want gone is still visible. One log per 5s.
  // Questions this answers for the screenscape "Up Next Ep N" toast + home
  // escape:
  //   1. Does this device's WebView support CSS :has()? `cssHas` true/false —
  //      if false, every `div:has(...)` rule (the toast-wrapper hide!important)
  //      is dropped and only the JS sweeper selectors apply.
  //   2. Does an "Up Next"/"next episode" element exist and what are its
  //      tagName/class + computed display? We can't hide what we can't target.
  //   3. How many `button[aria-label=Dismiss]` (the toast's Dismiss X) exist +
  //      whether that JS sweeper rule is landing.
  // Filtered: adb logcat -s PlayerWebView COSMETIC-PROBE:V  (they also appear
  // as [Console:...] lines under the PlayerWebView tag).
  parts.push(
    `(function(){var last=0;function probe(){try{var now=Date.now();` +
      `if(now-last<5000)return;last=now;` +
      `var hasHas=(window.CSS&&window.CSS.supports)?window.CSS.supports('selector(div:has(*))'):'na';` +
      `var upNext=0,upDisp='',upTag='';var all=document.querySelectorAll('button,a');` +
      `for(var i=0;i<all.length;i++){var t=(all[i].textContent||'').toLowerCase();` +
      `if(t.indexOf('up next')===-1&&t.indexOf('next episode')===-1)continue;` +
      `upNext++;if(!upDisp){upDisp=getComputedStyle(all[i]).display;` +
      `upTag=all[i].tagName+(all[i].getAttribute('aria-label')?'['+all[i].getAttribute('aria-label')+']':'');}}` +
      `var dismiss=document.querySelectorAll('button[aria-label="Dismiss"]').length;` +
      `var wrapDisp='';try{var d=document.querySelector('button[aria-label="Dismiss"]');` +
      `if(d&&d.parentElement){wrapDisp=getComputedStyle(d.parentElement).display;}}catch(e){}` +
      `console.log('[COSMETIC-PROBE] cssHas='+hasHas+' upNext='+upNext+' upNextDisp='+upDisp+' dismissBtn='+dismiss+' wrapDisp='+wrapDisp);` +
      `if(upNext>0){console.log('[COSMETIC-PROBE] upNext sample='+upTag);}` +
      `}catch(e){console.log('[COSMETIC-PROBE] err '+e);}}probe();setInterval(probe,5000);})();`,
  );

  return parts.join("\n");
}
