/**
 * FilmSnaps Desktop — Nxsha Scraper Preload
 *
 * Runs at document-start inside the HIDDEN scraper BrowserWindow
 * (media-sources.ts). Two jobs:
 *
 *   1. Bridge page → main messages (`window.__nxsha.post(type, data)`)
 *      replacing mobile's `window.ReactNativeWebView.postMessage`.
 *   2. Install the ad/intent shims BEFORE any page script runs — a direct port
 *      of mobile's AD_BLOCK_SCRIPT (download/nxsha), minus the React Native
 *      postMessage calls that have no desktop equivalent.
 *
 * Compiled by tsc to dist/preload/nxsha-preload.js; no placeholder injection
 * needed (the provider-preload bake-in step only touches provider-preload.js).
 */

import { contextBridge, ipcRenderer } from "electron";

// ── Message bridge ──

contextBridge.exposeInMainWorld("__nxsha", {
  post: (type: string, data?: unknown) =>
    ipcRenderer.send("nxsha:msg", { type, data }),
});

// ── Ad / intent blocking (document-start, port of mobile AD_BLOCK_SCRIPT) ──

(function () {
  var AD_DOMAINS = [
    "doubleclick.net",
    "googleadservices.com",
    "googlesyndication.com",
    "googletagmanager.com",
    "gtag/js",
    "pagead2.googlesyndication.com",
    "adnxs.com",
    "rubiconproject.com",
    "adsystem.",
    "adserver.",
    "popads.",
    "popcash.",
    "popunder.",
    "adsterra.com",
    "propellerads.com",
    "trafficfactory.biz",
    "histats.com",
    "scorecardresearch.com",
    "exoclick.com",
    "juicyads.com",
    "plugrush.com",
    "trafficjunky.com",
    "adreactor.com",
    "adcash.com",
    "clickadu.com",
    "clicksco.net",
    "hilltopads.com",
    "pyppo.com",
    "jr.prahmnatured.com",
    "brigadedelegatesandbox.com",
    "hakumnata.com",
    "tags.crwdcntrl.net",
    "crwdcntrl.net",
    "tawk.to",
    "va.tawk.to",
    "embed.tawk.to",
  ];
  function isAdUrl(url: string): boolean {
    if (!url) return false;
    try {
      var host = new URL(url).hostname.toLowerCase();
      for (var i = 0; i < AD_DOMAINS.length; i++) {
        if (host.indexOf(AD_DOMAINS[i]) !== -1) return true;
      }
    } catch (e) {}
    return false;
  }
  function isIntentUrl(url: unknown): boolean {
    return (
      !!url &&
      typeof url === "string" &&
      (url.indexOf("intent://") === 0 || url.indexOf("android-app://") === 0)
    );
  }

  // fetch shim — ad requests resolve as 204 no-op.
  try {
    var _origFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      var url =
        typeof input === "string"
          ? input
          : input && typeof input === "object" && "url" in input
            ? (input as Request).url
            : "";
      if (isAdUrl(String(url)) || isIntentUrl(url)) {
        return Promise.resolve(new Response("", { status: 204 }));
      }
      return _origFetch.call(this, input, init);
    };
  } catch (e) {}

  // XHR shim — ad requests never open/send.
  try {
    var _origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { _fsAborted?: boolean },
      method: string,
      url: string | URL,
    ) {
      this._fsAborted = isAdUrl(String(url)) || isIntentUrl(url);
      if (this._fsAborted) return;
      return _origXHROpen.apply(
        this,
        arguments as unknown as Parameters<typeof _origXHROpen>,
      );
    } as typeof XMLHttpRequest.prototype.open;
    var _origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { _fsAborted?: boolean },
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      if (this._fsAborted) return;
      return _origXHRSend.call(this, body);
    };
  } catch (e) {}

  // Popups never open.
  try {
    window.open = function () {
      return null;
    } as typeof window.open;
  } catch (e) {}

  // location.href setter — swallow ad/intent assignments.
  try {
    var _locProto = Object.getPrototypeOf(window.location);
    if (_locProto) {
      var _hrefDesc = Object.getOwnPropertyDescriptor(_locProto, "href");
      if (_hrefDesc && _hrefDesc.set && _hrefDesc.get) {
        // Capture narrowed accessors — TS loses the null-check inside closures.
        var hrefSet = _hrefDesc.set;
        var hrefGet = _hrefDesc.get;
        Object.defineProperty(_locProto, "href", {
          set: function (val: string) {
            if (val && typeof val === "string") {
              if (isIntentUrl(val)) return;
              if (isAdUrl(val)) return;
            }
            return hrefSet.call(this, val);
          },
          get: function () {
            return hrefGet.call(this);
          },
          configurable: false,
        });
      }
    }
  } catch (e) {}

  // location.replace/assign — same swallow.
  try {
    var _lr = window.location.constructor.prototype.replace;
    window.location.constructor.prototype.replace = function (u: string) {
      if (u && typeof u === "string" && (isAdUrl(u) || isIntentUrl(u))) return;
      return _lr.call(this, u);
    };
    var _la = window.location.constructor.prototype.assign;
    window.location.constructor.prototype.assign = function (u: string) {
      if (u && typeof u === "string" && (isAdUrl(u) || isIntentUrl(u))) return;
      return _la.call(this, u);
    };
  } catch (e) {}

  // Click capture — block anchor clicks pointing at ad hosts.
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target as Element | null;
      while (el && el.tagName !== "BODY") {
        if (el.tagName === "A") {
          var h = el.getAttribute("href") || "";
          if (h) {
            try {
              var absUrl = new URL(h, location.href).toString();
              if (isAdUrl(absUrl)) {
                e.preventDefault();
                return false;
              }
            } catch (err) {}
          }
          break;
        }
        el = el.parentElement;
      }
    },
    true,
  );
})();
