import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Animated,
  Alert,
  Linking,
  ScrollView,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getProvider } from '@filmsnaps/shared';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// ── Enhanced injected script ──
// Three layers:
//   Layer 1: Ad/popup blocking (same as VideoWebView)
//   Layer 2: Download URL capture (fetch/XHR response interception, DOM scanning)
//   Layer 3: Network activity logger (for debugging)
const INJECTED_SCRIPT = `
(function() {
  // ──────────────────────────────────────────────────────────────────
  // Layer 1: Ad / popup blocking
  // ──────────────────────────────────────────────────────────────────
  var AD_DOMAINS = [
    'doubleclick.net','googleadservices.com','googlesyndication.com',
    'googletagmanager.com','gtag/js','pagead2.googlesyndication.com',
    'adnxs.com','rubiconproject.com','adsystem.','adserver.',
    'popads.','popcash.','popunder.','adsterra.com',
    'propellerads.com','trafficfactory.biz',
    'histats.com','scorecardresearch.com',
    'exoclick.com','juicyads.com','plugrush.com',
    'trafficjunky.com','adreactor.com','adcash.com',
    'clickadu.com','clicksco.net','hilltopads.com',
    'pyppo.com','jr.prahmnatured.com','brigadedelegatesandbox.com',
    'hakumnata.com','tags.crwdcntrl.net','crwdcntrl.net',
    'tawk.to','va.tawk.to','embed.tawk.to',
  ];

  var DL_EXTENSIONS = ['.mp4','.m3u8','.webm','.mkv','.avi','.zip','.ts'];
  var DL_HOSTS = ['workers.dev', 'bcdnxw.hakunaymatata.com', 'hakunaymatata.com'];

  function isDlUrl(url) {
    if (!url) return false;
    try {
      var u = new URL(url);
      // Check 1: known download hostnames (Workers URLs have no file extension)
      var host = u.hostname.toLowerCase();
      for (var i = 0; i < DL_HOSTS.length; i++) {
        if (host.indexOf(DL_HOSTS[i]) !== -1) return true;
      }
      // Check 2: file extensions in path (only check host+path, not query params)
      var path = host + u.pathname.toLowerCase();
      for (var i = 0; i < DL_EXTENSIONS.length; i++) {
        if (path.indexOf(DL_EXTENSIONS[i]) !== -1) return true;
      }
      // Check 3: search params for ?file=video.mp4 patterns
      if (u.search) {
        var s = u.search.toLowerCase();
        for (var i = 0; i < DL_EXTENSIONS.length; i++) {
          if (s.indexOf(DL_EXTENSIONS[i]) !== -1) return true;
        }
      }
    } catch(e) {}
    return false;
  }

  function isAdUrl(url) {
    if (!url) return false;
    try {
      var host = new URL(url).hostname.toLowerCase();
      for (var i = 0; i < AD_DOMAINS.length; i++) {
        if (host.indexOf(AD_DOMAINS[i]) !== -1) return true;
      }
    } catch(e) {}
    return false;
  }

  function isIntentUrl(url) {
    return url && (typeof url === 'string') &&
      (url.indexOf('intent://') === 0 || url.indexOf('android-app://') === 0);
  }

  function post(type, data) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type: type, data: data})); } catch(e) {}
  }

  // ── Clear any service worker caches on first load ──
  try {
    if (window.caches) {
      caches.keys().then(function(names) {
        names.forEach(function(name) { caches.delete(name); });
      });
    }
  } catch(e) {}

  // ──────────────────────────────────────────────────────────────────
  // Layer 2: Download URL capture — inspect API response bodies
  // ──────────────────────────────────────────────────────────────────

  function extractDownloadUrls(obj, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 10) return;
    if (obj === null || obj === undefined) return;
    // Try to parse JSON strings into objects for recursive scanning
    if (typeof obj === 'string') {
      // First, try JSON.parse for API response bodies
      if (obj.length > 20 && (obj[0] === '{' || obj[0] === '[')) {
        try {
          var parsed = JSON.parse(obj);
          extractDownloadUrls(parsed, depth);
          return;
        } catch(e) { /* not JSON, continue */ }
      }
      // Then check if it's a URL directly
      if (obj.length > 5 && obj.length < 1000) {
        if (isDlUrl(obj)) {
          post('dl-url', obj);
          return;
        }
        if (isIntentUrl(obj)) {
          post('intent-url', obj);
          return;
        }
      }
      return;
    }
    if (typeof obj === 'object') {
      // Check all string values recursively
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          var val = obj[key];
          if (typeof val === 'string') {
            if (isDlUrl(val)) {
              post('dl-url', val);
            } else if (isIntentUrl(val)) {
              post('intent-url', val);
            } else if ((key === 'url' || key === 'src' || key === 'file' || key === 'data' || key === 'link') && val.length > 5) {
              post('api-url', key + ': ' + val);
            }
          } else if (typeof val === 'object') {
            extractDownloadUrls(val, depth + 1);
          }
        }
      }
    }
  }

  // ── Intercept fetch responses, with cache-busting for download-proxy ──
  try {
    var _origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var urlStr = (typeof url === 'string') ? url : '';

      // Block ad requests
      if (isAdUrl(urlStr)) {
        return Promise.resolve(new Response('', {status: 204}));
      }

      // ── Cache-bust for download-proxy to get FRESH CDN URLs ──
      // The server caches responses; adding _t= forces a cache miss
      var actualInput = input;
      var actualInit = init || {};
      if (urlStr.indexOf('download-proxy') !== -1) {
        var separator = urlStr.indexOf('?') === -1 ? '?' : '&';
        var bustedUrl = urlStr + separator + '_t=' + Date.now();
        if (typeof actualInput === 'string') {
          actualInput = bustedUrl;
        }
        actualInit.cache = 'no-cache';
        if (!actualInit.headers) actualInit.headers = {};
        post('log', 'Cache-busting download-proxy -> ' + bustedUrl.substring(0, 200));
      }

      return _origFetch.call(this, actualInput, actualInit).then(function(response) {
        try {
          var ct = response.headers && response.headers.get && response.headers.get('content-type');
          if (ct && ct.indexOf('json') !== -1) {
            var clone = response.clone();
            clone.text().then(function(text) {
              if (text && text.length < 50000) {
                extractDownloadUrls(text);
                // Post full response for all API calls
                post('api-full', urlStr.substring(0, 200) + ' | ' + text.substring(0, 3000));
              }
            }).catch(function(){});
          }
        } catch(e) {}
        return response;
      });
    };
  } catch(e) {}

  // ── Intercept XHR responses, with cache-busting for download-proxy ──
  try {
    var _origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = (typeof url === 'string') ? url : (url && url.url) || '';
      if (isAdUrl(this._url)) {
        this._aborted = true;
        return;
      }
      // Cache-bust for download-proxy to get FRESH CDN URLs
      if (this._url.indexOf('download-proxy') !== -1) {
        var separator = this._url.indexOf('?') === -1 ? '?' : '&';
        var bustedUrl = this._url + separator + '_t=' + Date.now();
        this._url = bustedUrl;
        post('log', 'XHR cache-bust download-proxy');
        arguments[1] = bustedUrl;
      }
      return _origXHROpen.apply(this, arguments);
    };

    var _origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      if (this._aborted) return;
      var self = this;
      var _origOnReadyStateChange = this.onreadystatechange;
      this.onreadystatechange = function() {
        if (this.readyState === 4) {
          try {
            var text = this.responseText;
            if (text && text.length < 50000) {
              // Only post if it looks like JSON with possible URLs
              if (text.indexOf('{') !== -1 || text.indexOf('[') !== -1) {
                extractDownloadUrls(text);
              }
              // Also post the raw URL and content for debugging
              if (self._url && (text.indexOf('mp4') !== -1 || text.indexOf('m3u8') !== -1 || text.indexOf('download') !== -1)) {
                post('api-full', (self._url || '') + ' | ' + text.substring(0, 3000));
              }
            }
          } catch(e) {}
          if (_origOnReadyStateChange) {
            _origOnReadyStateChange.apply(this, arguments);
          }
        } else {
          if (_origOnReadyStateChange) {
            _origOnReadyStateChange.apply(this, arguments);
          }
        }
      };
      return _origXHRSend.apply(this, arguments);
    };
  } catch(e) {}

  // ──────────────────────────────────────────────────────────────────
  // Layer 3: Block ads / capture download navigations
  // ──────────────────────────────────────────────────────────────────

  // window.open → capture download URLs, let them proceed
  var _origWindowOpen = window.open;
  try {
    window.open = function(url) {
      if (url && typeof url === 'string') {
        if (isDlUrl(url)) {
          post('dl-url', url);
          // Let download URLs open normally
          try { return _origWindowOpen.call(window, url); } catch(e) {}
        }
        if (isIntentUrl(url)) { post('intent-url', url); return null; }
        if (!isAdUrl(url)) { post('popup-url', url); }
      }
      return null;
    };
    Object.defineProperty(window, 'open', { value: window.open, writable: false, configurable: false });
  } catch(e) {}

  // Location.href interceptor
  try {
    var _locProto = Object.getPrototypeOf(window.location);
    if (_locProto) {
      var _hrefDesc = Object.getOwnPropertyDescriptor(_locProto, 'href');
      if (_hrefDesc && _hrefDesc.set) {
        Object.defineProperty(_locProto, 'href', {
          set: function(val) {
            if (val && typeof val === 'string') {
              if (isDlUrl(val)) { post('dl-url', val); }  // capture + let proceed
              if (isIntentUrl(val)) { post('intent-url', val); return; }
              if (isAdUrl(val)) { return; }
            }
            return _hrefDesc.set.call(this, val);
          },
          get: function() { return _hrefDesc.get.call(this); },
          configurable: false,
        });
      }
    }
  } catch(e) {}

  // location.replace / assign
  try {
    var _locReplace = window.location.constructor.prototype.replace;
    window.location.constructor.prototype.replace = function(url) {
      if (url && typeof url === 'string') {
        if (isDlUrl(url)) { post('dl-url', url); }  // capture + let proceed
        if (isIntentUrl(url)) { post('intent-url', url); return; }
        if (isAdUrl(url)) { return; }
      }
      return _locReplace.call(this, url);
    };
  } catch(e) {}

  try {
    var _locAssign = window.location.constructor.prototype.assign;
    window.location.constructor.prototype.assign = function(url) {
      if (url && typeof url === 'string') {
        if (isDlUrl(url)) { post('dl-url', url); }  // capture + let proceed
        if (isIntentUrl(url)) { post('intent-url', url); return; }
        if (isAdUrl(url)) { return; }
      }
      return _locAssign.call(this, url);
    };
  } catch(e) {}

  // ── Click interceptor ──
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || el.href;
        if (href) {
          try {
            var absUrl = new URL(href, location.href).toString();
            // Capture download URLs but DON'T prevent default — let them navigate
            if (isDlUrl(absUrl)) { post('dl-url', absUrl); return; }
            if (isIntentUrl(absUrl)) { post('intent-url', absUrl); e.preventDefault(); return false; }
            if (isAdUrl(absUrl)) { e.preventDefault(); return false; }
          } catch(e) {
            if (isIntentUrl(href)) { post('intent-url', href); e.preventDefault(); return false; }
          }
        }
        break;
      }
      if (el.tagName === 'BUTTON' || el.tagName === 'SPAN') {
        var txt = (el.textContent || '').toLowerCase();
        if (txt.indexOf('download') !== -1) { post('dl-click', txt); }
      }
      el = el.parentElement;
    }
  }, true);

  // ── MutationObserver for dynamically added elements ──
  try {
    new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var n = muts[i].addedNodes[j];
          if (n.nodeType !== 1) continue;
          // Check <a> tags
          if (n.tagName === 'A') {
            var h = n.getAttribute('href') || '';
            if (h) {
              try {
                var a = new URL(h, location.href).toString();
                if (isDlUrl(a)) { post('dl-url', a); }
                if (isIntentUrl(a)) { post('intent-url', a); }
              } catch(e) {}
            }
          }
          // Check <video> / <source> tags for direct video URLs
          if (n.tagName === 'VIDEO') {
            var src = n.getAttribute('src') || '';
            if (src) { post('video-url', src); }
          }
          if (n.tagName === 'SOURCE') {
            var src = n.getAttribute('src') || '';
            if (src) { post('video-url', src); }
          }
          // Check <iframe> for download URLs in src
          if (n.tagName === 'IFRAME') {
            var src = n.getAttribute('src') || '';
            if (src && (isDlUrl(src) || src.indexOf('vidvault') !== -1)) {
              post('dl-url', src);
            }
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  // ── Periodic scan for video elements and download links ──
  setInterval(function() {
    try {
      // Video elements
      var videos = document.querySelectorAll('video[src], video source[src]');
      for (var i = 0; i < videos.length; i++) {
        var src = videos[i].getAttribute('src') || videos[i].src || '';
        if (src && !videos[i].hasAttribute('data-dl-scanned')) {
          videos[i].setAttribute('data-dl-scanned', '1');
          post('video-url', src);
        }
      }
      // Anchor tags
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var h = links[i].getAttribute('href') || '';
        if (h && !links[i].hasAttribute('data-dl-scanned')) {
          try {
            var a = new URL(h, location.href).toString();
            if (isDlUrl(a)) {
              links[i].setAttribute('data-dl-scanned', '1');
              post('dl-link', a);
            } else if (isIntentUrl(h)) {
              links[i].setAttribute('data-dl-scanned', '1');
              post('intent-url', h);
            }
          } catch(e) {}
        }
      }
      // Check for download buttons that may have appeared
      var buttons = document.querySelectorAll('button, a.btn, .download-btn, [class*=download], [id*=download]');
      for (var i = 0; i < buttons.length; i++) {
        if (!buttons[i].hasAttribute('data-scanned')) {
          buttons[i].setAttribute('data-scanned', '1');
          var txt = (buttons[i].textContent || '').toLowerCase();
          if (txt.indexOf('download') !== -1) { post('dl-button', txt); }
        }
      }
    } catch(e) {}
  }, 2000);
})();
true;
`;

// ── API base URL ──
const API_BASE = process.env.EXPO_PUBLIC_WEB_URL || 'http://localhost:3000';

export default function DownloadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ id: string[] }>();
  const webViewRef = useRef<WebView>(null);

  // Extract params ONCE
  const params = useMemo(() => {
    const segs = rawParams.id ?? [];
    return {
      type: segs[0] as 'movie' | 'tv',
      id: segs[1],
      season: segs[2] ? Number(segs[2]) : undefined,
      episode: segs[3] ? Number(segs[3]) : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(rawParams.id ?? []).join(',')]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [capturedUrls, setCapturedUrls] = useState<string[]>([]);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // Status toast animation
  const statusOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (statusMessage) {
      Animated.sequence([
        Animated.timing(statusOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(statusOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start(() => setStatusMessage(''));
    }
  }, [statusMessage, statusOpacity]);

  const showStatus = useCallback((msg: string) => setStatusMessage(msg), []);

  const addLog = useCallback((msg: string) => {
    setDebugLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  // ── Build VidVault URL ──
  const downloadUrl = useMemo(() => {
    if (!params.id || !params.type) return '';
    try {
      const v = getProvider('vidvault');
      if (v) {
        return params.type === 'tv' && params.season && params.episode
          ? `${v.baseUrl}${v.embed.tv(params.id, params.season, params.episode)}`
          : `${v.baseUrl}${v.embed.movie(params.id)}`;
      }
    } catch {}
    const path = params.type === 'tv' && params.season && params.episode
      ? `/tv/${params.id}/${params.season}/${params.episode}`
      : `/movie/${params.id}`;
    return `https://vidvault.ru${path}`;
  }, [params.id, params.type, params.season, params.episode]);

  // ── Call VidVault API from inside the WebView (has proper cookies/token) ──
  const callVidVaultApi = useCallback(async () => {
    if (!params.id) return;
    showStatus('Injecting fresh API call...');

    // Inject JS into the WebView to re-fetch download-proxy with cache-busting
    // This runs INSIDE the page context so it has proper headers/cookies/tokens
    webViewRef.current?.injectJavaScript(`
      (function() {
        var ts = Date.now();
        var rand = Math.random().toString(36).slice(2, 8);

        // Step 1: Get a fresh token
        fetch('https://vidvault.ru/api/get-token?_t=' + ts, {cache: 'no-store'})
          .then(function(r) { return r.json(); })
          .then(function(token) {
            if (!token || !token.t) throw new Error('No token');

            // Step 2: Call download-proxy with cache-busting
            var body = JSON.stringify({
              token: token.t,
              subjectId: '${params.id}',
              type: '${params.type}',
            });
            return fetch('https://vidvault.ru/api/download-proxy?_force=' + ts + '_' + rand, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: body,
              cache: 'no-store',
            });
          })
          .then(function(r) { return r.text(); })
          .then(function(text) {
            var isCached = text.indexOf('"fromCache":true') !== -1;
            var data;
            try { data = JSON.parse(text); } catch(e) { data = null; }

            // Post the full response
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'api-full',
              data: 'REFRESH: fromCache=' + isCached + ' len=' + text.length + ' | ' + text.substring(0, 3000),
            }));

            // Extract download URLs (handles mp4Data, mkvData, mkvV2Data, mkvV3Data)
            function extractDlUrls(data) {
              if (!data) return;
              // Check mp4Data -> downloadInfo
              if (data.mp4Data && data.mp4Data.downloadInfo && data.mp4Data.downloadInfo.data && data.mp4Data.downloadInfo.data.downloads) {
                var dls = data.mp4Data.downloadInfo.data.downloads;
                for (var i = 0; i < dls.length; i++) {
                  if (dls[i].url) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({type: 'dl-url', data: dls[i].url}));
                  }
                }
              }
              // Check mkvData.files
              var mkvKeys = ['mkvData', 'mkvV2Data', 'mkvV3Data'];
              for (var k = 0; k < mkvKeys.length; k++) {
                var mkv = data[mkvKeys[k]];
                if (mkv && mkv.files) {
                  for (var f = 0; f < mkv.files.length; f++) {
                    if (mkv.files[f].url) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'dl-url', data: mkv.files[f].url}));
                    }
                  }
                }
              }
              // Check top-level url
              if (data.url) {
                window.ReactNativeWebView.postMessage(JSON.stringify({type: 'dl-url', data: data.url}));
              }
              // Also check mp4Data itself
              if (data.mp4Data && data.mp4Data.url) {
                window.ReactNativeWebView.postMessage(JSON.stringify({type: 'dl-url', data: data.mp4Data.url}));
              }
            }
            extractDlUrls(data);

            if (!isCached) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'log',
                data: '✅ Fresh download URLs obtained! Check the bottom bar.',
              }));
            } else {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'log',
                data: '⚠️ Still got cached response. Trying harder...',
              }));
              // Retry with even stronger cache busting
              return fetch('https://vidvault.ru/api/get-token?_t=' + ts + '_2', {cache: 'no-store'})
                .then(function(r) { return r.json(); })
                .then(function(token2) {
                  if (!token2 || !token2.t) throw new Error('No token retry');
                  return fetch('https://vidvault.ru/api/download-proxy?_force=' + ts + '_' + rand + '_retry', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Cache-Control': 'no-cache, no-store, must-revalidate',
                      'Pragma': 'no-cache',
                    },
                    body: JSON.stringify({
                      token: token2.t,
                      subjectId: '${params.id}',
                      type: '${params.type}',
                    }),
                    cache: 'reload',
                  });
                })
                .then(function(r2) { return r2.text(); })
                .then(function(t2) {
                  var isCached2 = t2.indexOf('"fromCache":true') !== -1;
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'api-full',
                    data: 'REFRESH_RETRY: fromCache=' + isCached2 + ' len=' + t2.length + ' | ' + t2.substring(0, 3000),
                  }));
                  if (!isCached2) {
                    try {
                      var d2 = JSON.parse(t2);
                      extractDlUrls(d2);
                    } catch(e) {}
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'log',
                      data: '✅ Found fresh URLs after retry!',
                    }));
                  } else {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'log',
                      data: '❌ Server keeps returning cached data. Try manually via Browser button.',
                    }));
                  }
                });
            }
          })
          .catch(function(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'log',
              data: 'Refresh error: ' + (e.message || e),
            }));
          });
      })();
      true;
    `);

    setTimeout(() => showStatus('Check debug logs for results'), 3000);
  }, [params.id, params.type]);

  // ── Inject JS to dump page state ──
  const dumpPageState = useCallback(() => {
    webViewRef.current?.injectJavaScript(`
      (function() {
        var results = [];

        // Collect all script tags
        var scripts = document.querySelectorAll('script');
        results.push('Scripts: ' + scripts.length);

        // Collect all iframes
        var iframes = document.querySelectorAll('iframe');
        results.push('Iframes: ' + iframes.length);
        iframes.forEach(function(f, i) {
          results.push('  [' + i + '] src=' + (f.getAttribute('src') || f.src || 'none'));
        });

        // Collect all video elements
        var videos = document.querySelectorAll('video');
        results.push('Videos: ' + videos.length);
        videos.forEach(function(v, i) {
          results.push('  [' + i + '] src=' + (v.getAttribute('src') || v.src || 'none'));
          var sources = v.querySelectorAll('source');
          sources.forEach(function(s, j) {
            results.push('    source[' + j + '] src=' + (s.getAttribute('src') || s.src || 'none'));
          });
        });

        // Collect all <a> tags
        var links = document.querySelectorAll('a[href]');
        links.forEach(function(l) {
          var h = l.getAttribute('href') || '';
          if (h.indexOf('http') === 0 || h.indexOf('intent') === 0 || h.indexOf('.mp4') !== -1 || h.indexOf('m3u8') !== -1) {
            results.push('Link: ' + h.substring(0, 300));
          }
        });

        // Check window object for download-related properties
        for (var key in window) {
          try {
            if (key.toLowerCase().indexOf('download') !== -1 || key.toLowerCase().indexOf('player') !== -1) {
              results.push('Window.' + key + ' = ' + typeof window[key]);
            }
          } catch(e) {}
        }

        results.push('URL: ' + window.location.href);
        results.push('ReadyState: ' + document.readyState);

        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'page-dump', data: results.join('\\n')}));
      })();
      true;
    `);
    showStatus('Dumping page state...');
  }, []);

  // ── Native file download via expo-file-system ──
  const downloadNative = useCallback(async (url: string) => {
    try {
      showStatus('⏳ Downloading via native...');
      addLog('Native download: ' + url.substring(0, 200));

      const ext = url.includes('.mkv') ? 'mkv' : url.includes('.mp4') ? 'mp4' : 'mkv';
      const filename = `filmsnaps-${params.type}-${params.id}.${ext}`;
      const fileUri = FileSystem.documentDirectory + filename;

      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        fileUri,
        {
          headers: {
            'Referer': 'https://vidvault.ru/',
            'Origin': 'https://vidvault.ru',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          },
          md5: false,
        },
      );

      addLog('Starting download...');
      const result = await downloadResumable.downloadAsync();
      if (!result) throw new Error('Download returned nothing — server may have returned an error');

      addLog('✅ Saved: ' + result.uri);
      showStatus('✅ Download complete!');

      // Offer to share the file
      const canShare = await Sharing.isAvailableAsync();
      Alert.alert(
        'Download Complete',
        `File saved!\n${filename}\n\nOpen or share it?`,
        [
          { text: 'Close', style: 'cancel' },
          {
            text: 'Share / Open',
            onPress: () => {
              if (canShare) {
                Sharing.shareAsync(result.uri, {
                  mimeType: 'video/x-matroska',
                  dialogTitle: `filmsnaps-${params.type}-${params.id}`,
                }).catch(() => addLog('Share cancelled'));
              }
            },
          },
        ],
      );
    } catch (e: any) {
      showStatus('❌ Download failed');
      addLog('Native error: ' + e.message);
      Alert.alert('Download Failed', e.message);
    }
  }, [params.id, params.type]);

  // ── Navigation handler ──
  const handleNavigation = useCallback((request: any): boolean => {
    if (!request.url) return true;
    addLog('Nav: ' + request.url.substring(0, 200));

    // Capture intent:// URLs
    if (request.url.startsWith('intent://') || request.url.startsWith('android-app://')) {
      addLog('Intent URL: ' + request.url.substring(0, 200));
      return false;
    }

    // Block known ad domains
    try {
      const host = new URL(request.url).hostname.toLowerCase();
      const adHosts = [
        'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
        'pagead2.googlesyndication.com', 'adnxs.com', 'rubiconproject.com',
        'popads.', 'popcash.', 'popunder.', 'adsterra.com',
        'propellerads.com', 'trafficfactory.biz',
        'exoclick.com', 'juicyads.com', 'plugrush.com',
        'clickadu.com', 'clicksco.net', 'hilltopads.com',
        'pyppo.com', 'histats.com', 'scorecardresearch.com',
        'hakumnata.com', 'tags.crwdcntrl.net', 'crwdcntrl.net',
      ];
      for (const a of adHosts) {
        if (host.indexOf(a) !== -1) return false;
      }
    } catch {}
    return true;
  }, [addLog]);

  // ── Handle WebView messages ──
  const capturedUrlsRef = useRef<string[]>([]);
  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      console.log('[DL] WebView msg:', msg);
      addLog(`Msg: ${msg.type}: ${typeof msg.data === 'string' ? msg.data.substring(0, 200) : JSON.stringify(msg.data).substring(0, 200)}`);

      if (msg.type === 'dl-url' || msg.type === 'dl-link' || msg.type === 'video-url') {
        const url = msg.data;
        if (!capturedUrlsRef.current.includes(url)) {
          capturedUrlsRef.current = [url, ...capturedUrlsRef.current];
          setCapturedUrls(capturedUrlsRef.current);
          // DON'T auto-navigate — let the SPA handle navigation naturally
          // (it sets cookies/session context right before navigating)
          // Just log it and show the URL in the bottom bar
          addLog('Captured download URL: ' + url.substring(0, 200));
          showStatus('📥 Download URL captured — tap a button below');
        }
      } else if (msg.type === 'intent-url') {
        const url = msg.data;
        addLog('Intent URL captured: ' + url.substring(0, 200));
        if (!capturedUrlsRef.current.includes(url)) {
          capturedUrlsRef.current = [url, ...capturedUrlsRef.current];
          setCapturedUrls(capturedUrlsRef.current);
          Alert.alert(
            'Intent URL Captured',
            'This is an Android intent:// URL. You can try opening it.',
            [
              {
                text: 'Show Full',
                onPress: () => Alert.alert('Intent URL', url),
              },
              {
                text: 'Try Open',
                onPress: () => {
                  Linking.openURL(url).catch(() => {
                    showStatus('Cannot open intent URL directly');
                  });
                },
              },
              { text: 'Close', style: 'cancel' },
            ]
          );
        }
      } else if (msg.type === 'dl-click' || msg.type === 'dl-button') {
        showStatus('Download button detected: ' + msg.data);
      } else if (msg.type === 'api-url') {
        addLog('API URL found: ' + msg.data);
      } else if (msg.type === 'api-resp') {
        addLog('API: ' + (msg.data || '').substring(0, 300));
      } else if (msg.type === 'api-full') {
        addLog('API FULL: ' + (msg.data || '').substring(0, 1000));
        // Note: download URLs are already captured via dl-url/dl-link/video-url handlers
      } else if (msg.type === 'popup-url') {
        addLog('Popup URL: ' + msg.data);
      } else if (msg.type === 'page-dump') {
        addLog('Page Dump: ' + msg.data);
      } else if (msg.type === 'log') {
        addLog('JS: ' + msg.data);
      }
    } catch (e: any) {
      addLog('Msg parse error: ' + e.message);
    }
  }, [addLog]);

  // ── Error state ──
  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950 px-8">
        <StatusBar barStyle="light-content" />
        <View className="w-16 h-16 rounded-full bg-red-500/10 items-center justify-center mb-5">
          <Ionicons name="alert-circle" size={32} color="#ef4444" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">Failed to Load</Text>
        <Text className="text-zinc-500 text-sm mb-2 text-center leading-5">{error}</Text>
        <View className="flex-row" style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={() => { setError(null); setLoading(true); webViewRef.current?.reload(); }}
            className="bg-amber-500 rounded-xl py-3 px-6 flex-row items-center"
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={16} color="#000" />
            <Text className="text-black font-bold text-sm ml-2">Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.back()}
            className="border border-zinc-700 rounded-xl py-3 px-6 flex-row items-center"
            activeOpacity={0.8}
          >
            <Text className="text-zinc-300 font-bold text-sm ml-2">Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!params.id || !params.type || !downloadUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950 px-8">
        <StatusBar barStyle="light-content" />
        <View className="w-16 h-16 rounded-full bg-zinc-800 items-center justify-center mb-5">
          <Ionicons name="download-outline" size={32} color="#52525b" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">Download Unavailable</Text>
        <Text className="text-zinc-500 text-sm mb-2 text-center leading-5">
          Could not load the download page.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-amber-500 rounded-xl py-3 px-8"
          activeOpacity={0.8}
        >
          <Text className="text-black font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main view ──
  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" />

      {/* Top bar */}
      <View style={{ paddingTop: insets.top }} className="absolute top-0 left-0 right-0 z-30">
        <View className="flex-row items-center justify-between px-4 py-2">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
              activeOpacity={0.7}
              accessibilityLabel="Close download"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <View className="ml-3">
              <Text className="text-white font-bold text-sm">Download</Text>
              <Text className="text-zinc-500 text-[10px]">
                {params.type === 'tv'
                  ? `S${String(params.season ?? 1).padStart(2, '0')} E${String(params.episode ?? 1).padStart(2, '0')}`
                  : 'Movie'}
              </Text>
            </View>
          </View>
          <View className="flex-row" style={{ gap: 6 }}>
            <TouchableOpacity
              onPress={() => {
                setShowDebug(!showDebug);
                showStatus(showDebug ? 'Debug hidden' : 'Debug visible');
              }}
              className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
              activeOpacity={0.7}
            >
              <Ionicons name="bug" size={16} color={showDebug ? '#f59e0b' : '#71717a'} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => webViewRef.current?.reload()}
              className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Status toast */}
      {statusMessage ? (
        <Animated.View
          style={{ opacity: statusOpacity, paddingTop: insets.top + 52 }}
          className="absolute top-0 left-0 right-0 z-40 items-center"
          pointerEvents="none"
        >
          <View className="bg-amber-500/90 rounded-full px-4 py-2">
            <Text className="text-black text-xs font-bold">{statusMessage}</Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Loading overlay */}
      {loading && (
        <View className="absolute inset-0 z-20 items-center justify-center bg-black/80">
          <View className="items-center">
            <ActivityIndicator size="large" color="#f59e0b" />
            <Text className="text-zinc-500 text-sm mt-4">Loading VidVault page...</Text>
          </View>
        </View>
      )}

      {/* Bottom action bar */}
      <View
        style={{ paddingBottom: Math.max(insets.bottom + 12, showDebug ? 220 : 12) }}
        className="absolute bottom-0 left-0 right-0 z-30"
        pointerEvents="box-none"
      >
        <View className="items-center" style={{ gap: 6 }}>
          {/* ── Captured Download URLs ── */}
          {capturedUrls.length > 0 && (
            <View className="bg-zinc-900/95 rounded-xl border border-amber-500/30 mx-4 p-3 w-[90%]">
              <Text className="text-amber-400 text-xs font-bold mb-2">
                📥 {capturedUrls.length} Download URL{capturedUrls.length > 1 ? 's' : ''} Captured
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48 }}>
                {capturedUrls.slice(0, 3).map((url, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => {
                      Linking.openURL(url).catch(() => showStatus('Could not open URL'));
                    }}
                    className="bg-amber-500 rounded-full px-3 py-1.5 mr-2 flex-row items-center"
                    activeOpacity={0.8}
                  >
                    <Ionicons name="download" size={12} color="#000" />
                    <Text className="text-black text-[10px] font-bold ml-1">
                      URL {i + 1}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View className="flex-row mt-2" style={{ gap: 6 }}>
                <TouchableOpacity
                  onPress={() => {
                    const url = capturedUrls[0];
                    addLog('Opening in system browser: ' + url.substring(0, 200));
                    Linking.openURL(url).catch(() => showStatus('Cannot open URL'));
                  }}
                  className="flex-1 bg-amber-500 rounded-full py-2 flex-row items-center justify-center"
                  activeOpacity={0.8}
                >
                  <Ionicons name="open-outline" size={14} color="#000" />
                  <Text className="text-black text-xs font-bold ml-1">Download via Browser</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    // Navigate WebView to first URL (keep headers/context)
                    const url = capturedUrls[0];
                    webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
                    showStatus('⏬ Download started in WebView...');
                  }}
                  className="flex-1 bg-zinc-800 rounded-full py-2 flex-row items-center justify-center"
                  activeOpacity={0.8}
                >
                  <Ionicons name="globe" size={14} color="#f59e0b" />
                  <Text className="text-amber-400 text-xs font-bold ml-1">Download via WebView</Text>
                </TouchableOpacity>
              </View>
              <View className="mt-2">
                <TouchableOpacity
                  onPress={() => {
                    const url = capturedUrls[0];
                    downloadNative(url);
                  }}
                  className="bg-emerald-600 rounded-full py-2.5 flex-row items-center justify-center"
                  activeOpacity={0.8}
                >
                  <Ionicons name="download" size={16} color="#fff" />
                  <Text className="text-white text-xs font-bold ml-1.5">📲 Native Download (expo-file-system)</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Primary: Call VidVault API directly */}
          <TouchableOpacity
            onPress={callVidVaultApi}
            className="bg-amber-500 rounded-full py-3 px-8 flex-row items-center"
            activeOpacity={0.8}
          >
            <Ionicons name="globe" size={16} color="#000" />
            <Text className="text-black font-bold text-sm ml-2">Check VidVault API</Text>
          </TouchableOpacity>

          {/* Secondary: Dump page state */}
          <TouchableOpacity
            onPress={dumpPageState}
            className="bg-zinc-800/90 rounded-full py-2.5 px-6 flex-row items-center"
            activeOpacity={0.8}
          >
            <Ionicons name="search" size={14} color="#a1a1aa" />
            <Text className="text-zinc-400 text-xs font-medium ml-1.5">Dump Page State</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Debug panel */}
      {showDebug && (
        <View
          style={{ paddingBottom: 100, paddingTop: insets.top + 50 }}
          className="absolute inset-0 z-50"
          pointerEvents="box-none"
        >
          <View className="flex-1 mx-2 mt-1 rounded-xl bg-zinc-900/95 border border-zinc-700 overflow-hidden">
            <View className="flex-row items-center justify-between px-3 py-2 border-b border-zinc-700">
              <Text className="text-zinc-400 text-xs font-bold">DEBUG LOGS</Text>
              <TouchableOpacity onPress={() => setDebugLogs([])}>
                <Text className="text-zinc-500 text-[10px]">Clear</Text>
              </TouchableOpacity>
            </View>
            <ScrollView className="flex-1 px-2 py-1">
              {debugLogs.length === 0 ? (
                <Text className="text-zinc-600 text-[10px] italic py-4 text-center">
                  Waiting for events...
                </Text>
              ) : (
                debugLogs.map((log, i) => (
                  <Text key={i} className="text-zinc-400 text-[9px] font-mono leading-tight mb-0.5" selectable>
                    {log}
                  </Text>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {/* WebView */}
      <View className="flex-1">
        <WebView
          ref={webViewRef}
          source={{ uri: downloadUrl }}
          style={{ flex: 1, backgroundColor: '#000' }}
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
          allowsFullscreenVideo={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          startInLoadingState={true}
          injectedJavaScriptBeforeContentLoaded={INJECTED_SCRIPT}
          allowsBackForwardNavigationGestures={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false}
          incognito={true}
          renderLoading={() => null}
          onShouldStartLoadWithRequest={handleNavigation}
          onLoadEnd={() => {
            setLoading(false);
            showStatus('Page loaded — tap Download on page');
            // Clear any cached data to force fresh API responses
            webViewRef.current?.injectJavaScript(`
              try { if (window.caches) { caches.keys().then(function(ns) { ns.forEach(function(n) { caches.delete(n); }); }); } } catch(e){}
              try { localStorage.removeItem('authToken'); } catch(e){}
              true;
            `);
          }}
          onError={(e) => { console.warn('[DL] Error:', e.nativeEvent.description); setLoading(false); }}
          onOpenWindow={(e) => {
            const url = e.nativeEvent.targetUrl || '';
            addLog('Popup: ' + url.substring(0, 200));
            // Check if it's a download URL
            if (url && !capturedUrlsRef.current.includes(url)) {
              const l = url.toLowerCase();
              if (l.includes('.mp4') || l.includes('.m3u8') || l.includes('.mkv') || l.includes('.webm') || l.includes('download')) {
                capturedUrlsRef.current = [url, ...capturedUrlsRef.current];
                setCapturedUrls(capturedUrlsRef.current);
                showStatus('Download URL from popup!');
                Alert.alert('Download URL Found', url, [
                  { text: 'Open', onPress: () => Linking.openURL(url).catch(() => {}) },
                  { text: 'Show Full', onPress: () => Alert.alert('Download URL', url) },
                  { text: 'Close', style: 'cancel' },
                ]);
              }
            }
          }}
          onMessage={handleMessage}
        />
      </View>
    </View>
  );
}
