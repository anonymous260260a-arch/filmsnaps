import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadInfra } from '../../lib/download';

// ── Safe video extensions ──
const VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m3u8', '.ts', '.flv', '.wmv', '.m4v', '.3gp'];
// Potentially video but disguised — allow with rename
const AMBIGUOUS_EXTS = ['.bin', '.part', '.download', '.stream', '.blob'];
// Block these unconditionally
const BLOCKED_EXTS = ['.apk', '.exe', '.bat', '.cmd', '.com', '.msi', '.dll', '.scr', '.vbs', '.jar', '.sh', '.deb', '.rpm', '.iso'];

function getFileExt(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const match = path.match(/\.[a-z0-9]+(?:\?|$)/);
    return match ? match[0] : null;
  } catch { return null; }
}

// ── Comprehensive ad/popup blocker (matching watch page) ──
const INJECTED_SCRIPT = `
(function() {
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

  try {
    var _origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var urlStr = (typeof url === 'string') ? url : '';
      if (isAdUrl(urlStr) || isIntentUrl(urlStr)) {
        return Promise.resolve(new Response('', {status: 204}));
      }
      return _origFetch.call(this, input, init);
    };
  } catch(e) {}

  try {
    var _origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = (typeof url === 'string') ? url : (url && url.url) || '';
      if (isAdUrl(this._url) || isIntentUrl(this._url)) { this._aborted = true; return; }
      return _origXHROpen.apply(this, arguments);
    };
    var _origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      if (this._aborted) return;
      return _origXHRSend.apply(this, arguments);
    };
  } catch(e) {}

  try { window.open = function() { return null; }; } catch(e) {}

  try {
    var _locProto = Object.getPrototypeOf(window.location);
    var _hrefDesc = Object.getOwnPropertyDescriptor(_locProto, 'href');
    if (_hrefDesc && _hrefDesc.set) {
      Object.defineProperty(_locProto, 'href', {
        set: function(val) {
          if (val && typeof val === 'string') {
            if (isIntentUrl(val)) return;
            if (isAdUrl(val)) return;
          }
          return _hrefDesc.set.call(this, val);
        },
        get: function() { return _hrefDesc.get.call(this); },
        configurable: false,
      });
    }
  } catch(e) {}

  try {
    var _lr = window.location.constructor.prototype.replace;
    window.location.constructor.prototype.replace = function(u) {
      if (u && typeof u === 'string' && (isAdUrl(u) || isIntentUrl(u))) return;
      return _lr.call(this, u);
    };
  } catch(e) {}

  try {
    var _la = window.location.constructor.prototype.assign;
    window.location.constructor.prototype.assign = function(u) {
      if (u && typeof u === 'string' && (isAdUrl(u) || isIntentUrl(u))) return;
      return _la.call(this, u);
    };
  } catch(e) {}

  // Click interceptor
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'BODY') {
      if (el.tagName === 'A') {
        var h = el.getAttribute('href') || '';
        if (h) {
          try {
            var absUrl = new URL(h, location.href).toString();
            if (isAdUrl(absUrl)) { e.preventDefault(); return false; }
          } catch(e) {}
        }
        break;
      }
      el = el.parentElement;
    }
  }, true);
})();
true;
`;

export default function Download2Screen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ id: string[] }>();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [binUrl, setBinUrl] = useState<string | null>(null);

  const params = useMemo(() => {
    const segs = rawParams.id ?? [];
    return { type: segs[0] as 'movie' | 'tv', id: segs[1], season: segs[2] ? Number(segs[2]) : undefined, episode: segs[3] ? Number(segs[3]) : undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(rawParams.id ?? []).join(',')]);

  const downloadUrl = useMemo(() => {
    if (!params.id || !params.type) return '';
    if (params.type === 'tv' && params.season && params.episode) {
      return `https://02moviedownloader.site/api/download/tv/${params.id}/${params.season}/${params.episode}`;
    }
    return `https://02moviedownloader.site/api/download/movie/${params.id}`;
  }, [params.id, params.type, params.season, params.episode]);

  const { enqueue } = useDownloadInfra();

  // ── Save .bin as .mp4 via download store ──
  const saveAsMp4 = useCallback(() => {
    if (!binUrl) return;
    const filename = `filmsnaps-${params.type}-${params.id}.mp4`;

    enqueue({
      url: binUrl,
      fileName: filename,
      server: 'alt-dl',
      mediaType: params.type,
      tmdbId: params.id,
      title: `FilmSnaps ${params.type} ${params.id}`,
    });

    setBinUrl(null);
  }, [binUrl, params.type, params.id, enqueue]);

  // ── Navigation handler with file-type checks ──
  const handleNavigation = useCallback((request: any): boolean => {
    if (!request.url) return true;
    if (request.url.startsWith('intent://') || request.url.startsWith('android-app://')) return false;

    // Check file extension
    const ext = getFileExt(request.url);

    // Block dangerous files
    if (ext && BLOCKED_EXTS.includes(ext)) {
      Alert.alert('🚫 Blocked', `This file type (${ext}) is not allowed.`);
      return false;
    }

    // Detect video files -> prompt download
    if (ext && VIDEO_EXTS.includes(ext)) {
      const filename = `filmsnaps-${params.type}-${params.id}${ext}`;
      Alert.alert(
        '🎬 Video Detected',
        'Download this video file?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save Video', onPress: () => {
            enqueue({
              url: request.url,
              fileName: filename,
              server: 'alt-dl',
              mediaType: params.type,
              tmdbId: params.id,
              title: `FilmSnaps ${params.type} ${params.id}`,
              extension: ext.replace('.', ''),
            });
          }},
        ]
      );
      return false;
    }

    // Detect .bin / ambiguous video files → capture for rename
    if (ext && AMBIGUOUS_EXTS.includes(ext)) {
      setBinUrl(request.url);
      Alert.alert(
        '📁 .bin Detected',
        'This is likely a video file with a .bin extension.\n\nSave it as .mp4 instead?',
        [
          { text: 'Let WebView handle it', style: 'cancel' },
          { text: 'Save as .mp4', onPress: () => setBinUrl(request.url) },
        ]
      );
      return true; // Let it play in WebView regardless
    }

    // Block known ad domains
    try {
      const host = new URL(request.url).hostname.toLowerCase();
      const ads = [
        'doubleclick.net', 'googleadservices', 'googlesyndication', 'pagead2',
        'adnxs.com', 'popads.', 'popcash.', 'popunder.', 'adsterra',
        'propellerads', 'exoclick', 'juicyads', 'plugrush',
        'hakumnata.com', 'tags.crwdcntrl', 'crwdcntrl', 'mgid.com',
        'tawk.to', 'adservex', 'onclickads', 'peachify',
        'trafficwave', 'trafficboss', 'clk.sh',
      ];
      for (const a of ads) {
        if (host.indexOf(a) !== -1) return false;
      }
    } catch {}
    return true;
  }, [enqueue, params]);

  if (!params.id || !params.type || !downloadUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950 px-8">
        <StatusBar barStyle="light-content" />
        <Ionicons name="download-outline" size={48} color="#52525b" />
        <Text className="text-zinc-400 mt-3">Download unavailable</Text>
        <TouchableOpacity onPress={() => router.back()} className="bg-amber-500 rounded-xl py-3 px-8 mt-4" activeOpacity={0.8}>
          <Text className="text-black font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" />
      <View style={{ paddingTop: insets.top }} className="absolute top-0 left-0 right-0 z-30">
        <View className="flex-row items-center justify-between px-4 py-2">
          <View className="flex-row items-center">
            <TouchableOpacity onPress={() => router.back()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center" activeOpacity={0.7} accessibilityLabel="Close download" accessibilityRole="button">
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <Text className="text-white font-bold text-sm ml-3">Download</Text>
          </View>
          <TouchableOpacity onPress={() => webViewRef.current?.reload()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center" activeOpacity={0.7} accessibilityLabel="Reload page" accessibilityRole="button">
            <Ionicons name="refresh" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {loading && (
        <View className="absolute inset-0 z-20 items-center justify-center bg-black/80">
          <ActivityIndicator size="large" color="#f59e0b" />
          <Text className="text-zinc-400 text-sm mt-4">Loading...</Text>
        </View>
      )}

      {/* .bin → MP4 save bar */}
      {binUrl && !loading && (
        <View style={{ paddingBottom: insets.bottom + 12 }} className="absolute bottom-0 left-0 right-0 z-30 items-center">
          <View className="bg-zinc-900/95 rounded-xl border border-blue-500/30 mx-4 p-3 w-[92%]">
            <Text className="text-blue-400 text-xs font-bold mb-2">
              📁 .bin video detected — save as MP4?
            </Text>
            <Text className="text-zinc-500 text-[10px] mb-2" numberOfLines={1} selectable>
              {binUrl.substring(0, 120)}...
            </Text>
            <TouchableOpacity
              onPress={saveAsMp4}
              className="bg-blue-600 rounded-full py-2.5 flex-row items-center justify-center"
              activeOpacity={0.8}
            >
              <Ionicons name="download" size={16} color="#fff" />
              <Text className="text-white text-xs font-bold ml-1.5">
                💾 Save as .mp4 (via app)
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View className="flex-1" style={{ marginTop: 0 }}>
        <WebView
          ref={webViewRef}
          source={{ uri: downloadUrl }}
          style={{ flex: 1, backgroundColor: '#000' }}
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
          onShouldStartLoadWithRequest={handleNavigation}
          onLoadEnd={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      </View>
    </View>
  );
}
