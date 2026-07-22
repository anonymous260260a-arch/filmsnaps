/**
 * ProviderSandbox — Private WebView that runs a Nuvio provider JS bundle
 * and posts the result back via onMessage.
 *
 * CRITICAL: The WebView's `source` prop MUST be stable to prevent infinite
 * reload loops. See memoization notes below.
 */
import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import { View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { PROVIDER_SOURCES, EXPERIMENTAL_PROVIDERS } from './providerSources';
import type { SandboxResult, ExperimentalProvider } from './types';

interface Props {
  providerId: string;
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  season: number;
  episode: number;
  onResult: (result: SandboxResult) => void;
}

/**
 * Build the self-contained sandbox HTML page with comprehensive logging
 * at every execution step so we can diagnose what's failing.
 */
function buildSandboxHtml(
  providerId: string,
  tmdbId: string,
  mediaType: string,
  season: number,
  episode: number,
): string {
  const providerJs = PROVIDER_SOURCES[providerId];
  if (!providerJs) {
    return `<html><body><script>
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:'Provider not found: ${providerId}',elapsed:0}));
    </script></body></html>`;
  }

  const providerInfo: ExperimentalProvider | undefined =
    EXPERIMENTAL_PROVIDERS.find((p) => p.id === providerId);

  const needsCrypto = providerInfo?.deps?.crypto ?? false;
  const needsCheerio = providerInfo?.deps?.cheerio ?? false;

  // Escape for JS string injection (inside template literal)
  const escapedJs = providerJs
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  const escId = tmdbId.replace(/'/g, "\\'");
  const escType = mediaType.replace(/'/g, "\\'");

  const cryptoShim = needsCrypto
    ? `__modules['crypto-js'] = window.CryptoJS;`
    : '';

  const cheerioShim = needsCheerio
    ? `console.warn('[Sandbox] cheerio not shimmed');`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
</head>
<body>
${needsCrypto ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js"></script>' : ''}
<script>
// ── Phase 1: Sandbox boot ──
window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] Sandbox boot: DOM ready']}));

var __modules={};
function require(n){
  if(__modules[n]) return __modules[n];
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] require() called for:',n]}));
  throw new Error('Module not found: '+n);
}
var module={exports:{}};
var exports=module.exports;
${cryptoShim}
${cheerioShim}
var _log=console.log;
console.log=function(){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}]',Array.prototype.slice.call(arguments).join(' ')]}))}catch(e){}_log.apply(console,arguments)};

// ── Wrap fetch to log network activity ──
var _origFetch = window.fetch;
window.fetch = function(url, opts) {
  var method = (opts&&opts.method)||'GET';
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] FETCH '+method+' '+String(url).substring(0,200)]}));
  return _origFetch.apply(this, arguments).then(function(r){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] FETCH OK '+r.status+' '+String(url).substring(0,200)]}));
    return r;
  }).catch(function(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] FETCH FAIL: '+(e&&e.message?e.message:String(e))]}));
    throw e;
  });
};

// ── Wrap XMLHttpRequest to log network activity ──
var _origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  this._sandboxUrl = String(url).substring(0,200);
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] XHR '+method+' '+this._sandboxUrl]}));
  return _origOpen.apply(this, arguments);
};
var _origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(body) {
  var self = this;
  var _origOnLoad = this.onload;
  this.onload = function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] XHR DONE '+self.status+' '+self._sandboxUrl]}));
    if(_origOnLoad) _origOnLoad.apply(self, arguments);
  };
  var _origOnError = this.onerror;
  this.onerror = function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] XHR ERROR '+self._sandboxUrl]}));
    if(_origOnError) _origOnError.apply(self, arguments);
  };
  return _origSend.apply(this, arguments);
};

// ── Phase 2: Inject provider JS ──
window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] Injecting provider JS (${(escapedJs.length / 1024).toFixed(1)} KB)...']}));
try {
  ${escapedJs}
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] Provider JS injected OK']}));
} catch(e) {
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:'[${providerId}] JS inject error: '+(e&&e.message?e.message:String(e)),elapsed:0}));
}

// ── Phase 3: Check exports and call getStreams ──
window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] module.exports keys:',Object.keys(module.exports).join(', ')||'(empty)']}));
window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] exports keys:',Object.keys(exports).join(', ')||'(empty)']}));

var t0=Date.now();
var fn = module.exports.getStreams || exports.getStreams || exports.default?.getStreams;

if(typeof fn !== 'function') {
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:'[${providerId}] getStreams not found. exports='+JSON.stringify(Object.keys(module.exports))+' type='+typeof fn,elapsed:0}));
} else {
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] Calling getStreams("${escId}","${escType}",${season},${episode})...']}));
  try {
    var p = fn('${escId}','${escType}',${season},${episode});
    if(p && typeof p.then === 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] getStreams returned Promise, waiting...']}));
      var timeout_handle = setTimeout(function(){
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:'[${providerId}] getStreams promise timed out (>30s)',elapsed:Date.now()-t0}));
      }, 30000);
      p.then(function(s){
        clearTimeout(timeout_handle);
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'result',streams:s||[],elapsed:Date.now()-t0}));
      }).catch(function(e){
        clearTimeout(timeout_handle);
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:e&&e.message?e.message:String(e),elapsed:Date.now()-t0}));
      });
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'log',args:['[${providerId}] getStreams returned sync result']}));
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'result',streams:p||[],elapsed:Date.now()-t0}));
    }
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:e&&e.message?e.message:String(e),elapsed:Date.now()-t0}));
  }
}
</script>
</body>
</html>`;
}

/**
 * Inner sandbox — only renders the WebView with full memoization.
 */
const SandboxInner = React.memo(
  function SandboxInner({
    providerId,
    tmdbId,
    mediaType,
    season,
    episode,
    onResult,
  }: Props) {
    const onResultRef = useRef(onResult);
    useEffect(() => {
      onResultRef.current = onResult;
    }, [onResult]);

    // Log mount/unmount for debugging
    useEffect(() => {
      onResultRef.current({
        type: 'log',
        args: [`[Sandbox] Mounted ${providerId} (${mediaType}/${tmdbId})`],
      });
      return () => {
        onResultRef.current({
          type: 'log',
          args: [`[Sandbox] Unmounted ${providerId}`],
        });
      };
    }, [providerId, tmdbId, mediaType]);

    const html = useMemo(
      () => buildSandboxHtml(providerId, tmdbId, mediaType, season, episode),
      [providerId, tmdbId, mediaType, season, episode],
    );

    // CRITICAL: memoize source object itself to avoid WebView reload
    const source = useMemo(() => ({ html }), [html]);

    const handleMessage = useCallback((event: any) => {
      try {
        const data: SandboxResult = JSON.parse(event.nativeEvent.data);
        onResultRef.current(data);
      } catch {
        // Ignore JSON parse errors
      }
    }, []);

    const handleError = useCallback(() => {
      onResultRef.current({
        type: 'error',
        message: `[${providerId}] WebView load error`,
        elapsed: 0,
      });
    }, [providerId]);

    const handleLoadEnd = useCallback(
      (event: any) => {
        onResultRef.current({
          type: 'log',
          args: [
            `[Sandbox] WebView loadEnd: ${event?.nativeEvent?.url || 'unknown'}`,
          ],
        });
      },
      [],
    );

    return (
      <View style={{ height: 0, overflow: 'hidden', width: 0 }}>
        <WebView
          source={source}
          style={{ width: 1, height: 1, opacity: 0 }}
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          onError={handleError}
          javaScriptEnabled={true}
          domStorageEnabled={false}
          originWhitelist={['*']}
          mixedContentMode="always"
          androidLayerType="hardware"
        />
      </View>
    );
  },
  // Custom props comparison: skip onResult (we use a ref)
  (prevProps: Props, nextProps: Props) => {
    return (
      prevProps.providerId === nextProps.providerId &&
      prevProps.tmdbId === nextProps.tmdbId &&
      prevProps.mediaType === nextProps.mediaType &&
      prevProps.season === nextProps.season &&
      prevProps.episode === nextProps.episode
    );
  },
);

export const ProviderSandbox = SandboxInner;
