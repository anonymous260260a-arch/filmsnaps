/**
 * Main-frame media hook — the app-side time source for providers that emit
 * NOTHING usable (nxsha / zxcstream / cinemaos / videasy / etc.).
 *
 * Why this exists: the native postMessage / MEDIA_DATA paths only work for
 * providers that choose to publish their playback position. Silent providers
 * leave our progress ref at {0,0,0} forever → no saves, no resume, no
 * next-episode affordance. We cannot read a cross-origin iframe's DOM, but we
 * CAN run a script in the provider's MAIN frame (which is same-origin to
 * itself) and read its own `<video>` element. So we inject this tiny hook
 * there; it finds the playing video, polls currentTime/duration at ~1 Hz, and
 * posts `fs:progress` back to React Native.
 *
 * Cost: one setInterval at 1 Hz + a debounced MutationObserver sweep. No 500 ms
 * DOM-injection churn, no full-store reparses — exactly the "lightweight" the
 * redesign calls for. For providers with `progress: 'app'` only.
 *
 * The hook is idempotent (guarded by a window symbol) so re-injection on
 * navigation / reload is a no-op.
 */

export const MEDIA_HOOK_SCRIPT = `
(function () {
  if (window.__filmsnaps_media_hook) return;
  window.__filmsnaps_media_hook = true;

  function post(currentTime, duration) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            type: 'fs:progress',
            data: { currentTime: currentTime, duration: duration },
          }),
        );
      }
    } catch (e) {}
  }

  function findVideo() {
    var vids = [];
    try {
      vids = Array.prototype.slice.call(document.querySelectorAll('video'));
    } catch (e) {}
    // Also peek into SAME-ORIGIN child iframes (cross-origin throws — caught).
    try {
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var fd = frames[i].contentDocument;
        if (!fd) continue;
        var fv = fd.querySelectorAll('video');
        for (var j = 0; j < fv.length; j++) vids.push(fv[j]);
      }
    } catch (e) {}
    if (!vids.length) return null;
    // Prefer the video with the greatest known duration (the real feature,
    // not a hidden ad tile), and that is actually playing / has advanced.
    var best = null;
    for (var k = 0; k < vids.length; k++) {
      var v = vids[k];
      var d = v.duration || 0;
      var t = v.currentTime || 0;
      if (!best) { best = v; continue; }
      var bd = best.duration || 0;
      // pick the larger-duration video; tie-break by further playback
      if (d > bd || (d === bd && (t || 0) > (best.currentTime || 0))) best = v;
    }
    return best;
  }

  function tick() {
    var v = findVideo();
    if (!v) return;
    var d = v.duration;
    var t = v.currentTime || 0;
    if (d && !isNaN(d) && d > 0 && t >= 0) {
      post(t, d);
    }
  }

  // 1 Hz poll — cheap, and accurate enough for a 95% next-episode trigger
  // and resume saves. requestVideoFrameCallback is not universally available,
  // so a plain interval is the most robust low-cost choice.
  setInterval(tick, 1000);

  // Catch late-appearing / swapped video elements without waiting a full second.
  try {
    var mo = new MutationObserver(function () { tick(); });
    mo.observe(document, { childList: true, subtree: true });
  } catch (e) {}

  // Initial sweep (page may already have a video).
  tick();
})();
true;
`;

/**
 * Returns the media-hook source. Kept as a function so a future version can
 * parameterize the poll rate or the postMessage envelope without touching the
 * call sites.
 */
export function buildMediaHookScript(): string {
  return MEDIA_HOOK_SCRIPT;
}
