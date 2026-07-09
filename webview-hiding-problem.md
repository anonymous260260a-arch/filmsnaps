# Problem: Hiding Dynamically-Injected UI Elements Inside a WebView

## Environment
- React Native app using `react-native-webview` (Android)
- WebView loads third-party embed pages (different domains per "server")
- JavaScript is injected into the WebView via `injectedJavaScriptBeforeContentLoaded`
- Target: Android only (iOS not relevant)

## Goal
Hide **specific** download/install banner elements that third-party embed pages inject into their DOM.

These banners are:
1. **Not present in the initial HTML** — they are dynamically created by the page's JavaScript after load (SPA behavior)
2. Inside slide-in modal dialogs that appear when the user clicks certain buttons
3. Appear/re-appear when the page re-renders (e.g., switching episodes triggers a navigation/refresh inside the embed)

## What We've Tried

### Approach A: CSS Injection
```js
var s = document.createElement('style');
s.textContent = 'a[href="https://some-domain.app"]{display:none!important}' +
  '.modal-ui .sticky{display:none!important}' +
  '[class*="download"]{display:none!important}';
document.head.appendChild(s);
```
**Result:** CSS rules don't consistently apply to dynamically created elements. Injected `<style>` tags seem to lose effect when the page's JavaScript modifies `display` after element creation.

### Approach B: MutationObserver
```js
var obs = new MutationObserver(function(muts) {
  for (var i = 0; i < muts.length; i++) {
    for (var j = 0; j < muts[i].addedNodes.length; j++) {
      var n = muts[i].addedNodes[j];
      if (n.nodeType !== 1) continue;
      // Check and hide matching elements...
    }
  }
});
obs.observe(document.documentElement, { childList: true, subtree: true });
```
**Result:** MutationObserver misses elements. Some elements are created via complex JavaScript execution that the observer doesn't capture (maybe elements created via `innerHTML` assignment or DocumentFragment operations).

### Approach C: Periodic Full-DOM Sweep
```js
setInterval(function() {
  document.querySelectorAll('a[href*="some-domain"]').forEach(function(el) {
    el.style.setProperty('display', 'none', 'important');
  });
}, 3000);
```
**Result:** Partially works but:
- 3-second interval creates a visible flash (element appears → gets hidden)
- Page JavaScript may re-create the element between sweeps
- `querySelectorAll` with attribute selectors misses elements that use different attributes

### Approach D: Text-Content Based Sweeper
```js
setInterval(function() {
  var els = document.querySelectorAll('a, button, div, span');
  for (var i = 0; i < els.length; i++) {
    var txt = (els[i].textContent || '').toLowerCase().trim();
    if (txt.indexOf('download app') !== -1) {
      els[i].style.setProperty('display', 'none', 'important');
    }
  }
}, 1500);
```
**Two failures:**
1. **Over-hiding (false positives):** Text-content matching is too broad. Keywords like "download", "app", "install" appear in legitimate UI elements (download subtitles, installed codecs, app settings), breaking the page's player controls.
2. **Under-hiding (false negatives):** Even with specific text matching ("Get the X App"), elements sometimes are not hidden because:
   - The element is created with `display` already set inline by the page
   - The sweeper's `setProperty('display', 'none', 'important')` is overridden by the page's JavaScript immediately after
   - The sweeper and page JS are in a race condition (page re-sets display after our sweep)

### Approach E: Combination of all above
All four approaches combined still fail: elements either show through or the page breaks.

## Specific Technical Questions

For an expert who understands WebView internals and third-party embed manipulation:

1. **Why would an injected `<style>` tag with `!important` rules not apply to dynamically created elements?** CSS specificity should handle this — but the element keeps showing.

2. **Is there a way to intercept element creation at a lower level?** Can we hook into `Element.prototype.appendChild`, `Node.prototype.insertBefore`, or `document.createElement` to catch and block specific elements before they render? We tried this with iframes but not with divs/spans — is this viable without breaking the page?

3. **Can we use `Object.defineProperty` on `element.style.display` to prevent the page from setting it on specific elements?**

4. **Is there a WebView-specific approach (like `onShouldStartLoadWithRequest` but for DOM changes) that React Native exposes?**

5. **Is there a reliable way to "hide once and never show" that works against JavaScript that keeps recreating the element?** e.g., Intercepting the creation function itself or using a CSS `@keyframes` animation that forces `display: none` at the render level.

6. **Would a `Proxy` around `document.createElement` or `Element.prototype.innerHTML` setter work in a WebView context?** Are there restrictions on overriding native DOM APIs in mobile WebViews?

## Desired Format for Response

Please provide:
- **Recommended approach** with exact code (browser JavaScript, not Node.js)
- **Known limitations** of the approach in Android WebView (Chromium)
- **Fallback strategy** if the primary approach fails in certain cases
- **Performance considerations** (will this cause jank on low-end Android devices?)
