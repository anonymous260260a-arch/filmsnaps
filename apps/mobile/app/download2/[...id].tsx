import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';

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

// ── Lightweight ad/popup blocker ──
const INJECTED_SCRIPT = `
(function() {
  var AD_KEYWORDS = [
    'doubleclick','googleadservices','googlesyndication','googletagmanager','gtag',
    'pagead2','adnxs','rubiconproject','adsystem','adserver',
    'popads','popcash','popunder','adsterra',
    'propellerads','trafficfactory',
    'histats','scorecardresearch',
    'exoclick','juicyads','plugrush',
    'clickadu','clicksco','hilltopads',
    'pyppo','hakumnata','tags.crwdcntrl','crwdcntrl',
    'tawk.to','va.tawk.to','embed.tawk.to',
    'adservex','mgid','cpmstar','advanse',
    'xhamster','xporn','adult','porn',
    'onclickads','clkrev','adf.ly','shortlink',
    'ouo.io','shrinkme','linkbucks',
    'adreactor','adcash','trafficjunky',
    'adroll','optimizely','outbrain','taboola',
    'peachify','peach','trafficwave','trafficboss',
    'clickfrog','hilltopads','adsterra',
    'clk.sh','sh.st','viid.me',
    'admicro','adpiler','adtica','adnium',
    '7eer.net','axf8.net','d2pr','d3p',
    'a.mo','cpm','revcontent','taboola',
    'spoutable','nativo','triplelift','sovrn',
    'sharethrough','undertone','districtm',
    'indexww','pubmatic','openx',
    'appnexus','rhythmone','spotx',
    'insticator','sekindo','bidfilter',
    'contextweb','comcluster','cpx',
    'advertising','sponsor','affiliate',
  ];

  function isAd(url) {
    if (!url) return false;
    var l = url.toLowerCase();
    for (var i = 0; i < AD_KEYWORDS.length; i++) {
      if (l.indexOf(AD_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }

  function isIntent(url) {
    return url && typeof url === 'string' && (url.indexOf('intent://') === 0 || url.indexOf('android-app://') === 0);
  }

  try {
    var _f = window.fetch;
    window.fetch = function(i, o) {
      var u = (typeof i === 'string') ? i : (i && i.url) || '';
      if (isAd(u) || isIntent(u)) return Promise.resolve(new Response('', {status: 204}));
      return _f.call(this, i, o);
    };
  } catch(e) {}

  try {
    var _xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u) {
      if (isAd(u) || isIntent(u)) { this._aborted = true; return; }
      return _xo.apply(this, arguments);
    };
    var _xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(b) {
      if (this._aborted) return;
      return _xs.apply(this, arguments);
    };
  } catch(e) {}

  try { window.open = function() { return null; }; } catch(e) {}

  try {
    var _lp = Object.getPrototypeOf(window.location);
    var _hd = Object.getOwnPropertyDescriptor(_lp, 'href');
    if (_hd && _hd.set) {
      Object.defineProperty(_lp, 'href', {
        set: function(v) {
          if (v && typeof v === 'string' && (isAd(v) || isIntent(v))) return;
          return _hd.set.call(this, v);
        },
        get: function() { return _hd.get.call(this); },
        configurable: false,
      });
    }
  } catch(e) {}

  try {
    var _lr = window.location.constructor.prototype.replace;
    window.location.constructor.prototype.replace = function(u) {
      if (u && typeof u === 'string' && (isAd(u) || isIntent(u))) return;
      return _lr.call(this, u);
    };
  } catch(e) {}

  try {
    var _la = window.location.constructor.prototype.assign;
    window.location.constructor.prototype.assign = function(u) {
      if (u && typeof u === 'string' && (isAd(u) || isIntent(u))) return;
      return _la.call(this, u);
    };
  } catch(e) {}

  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'BODY') {
      if (el.tagName === 'A') {
        var h = el.getAttribute('href') || el.href || '';
        if (h && (isAd(h) || isIntent(h))) { e.preventDefault(); e.stopPropagation(); return false; }
        break;
      }
      el = el.parentElement;
    }
  }, true);

  try {
    var metas = document.querySelectorAll('meta[http-equiv="refresh"]');
    for (var i = 0; i < metas.length; i++) { try { metas[i].remove(); } catch(e) {} }
  } catch(e) {}
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
  const [saving, setSaving] = useState(false);

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

  // ── Save .bin as .mp4 via expo-file-system ──
  const saveAsMp4 = useCallback(async () => {
    if (!binUrl) return;
    setSaving(true);
    try {
      const filename = `filmsnaps-${params.type}-${params.id}.mp4`;
      const fileUri = FileSystem.documentDirectory + filename;
      const download = FileSystem.createDownloadResumable(binUrl, fileUri, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        md5: false,
      });
      const result = await download.downloadAsync();
      if (result) {
        Alert.alert('✅ Saved as MP4', `File saved as:\n${filename}`);
        setBinUrl(null);
      }
    } catch (e: any) {
      Alert.alert('Save Failed', e.message);
    } finally {
      setSaving(false);
    }
  }, [binUrl, params.type, params.id]);

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
  }, []);

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
            <TouchableOpacity onPress={() => router.back()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center" activeOpacity={0.7}>
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <Text className="text-white font-bold text-sm ml-3">Download</Text>
          </View>
          <TouchableOpacity onPress={() => webViewRef.current?.reload()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center" activeOpacity={0.7}>
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
              disabled={saving}
              className="bg-blue-600 rounded-full py-2.5 flex-row items-center justify-center"
              activeOpacity={0.8}
            >
              <Ionicons name="download" size={16} color="#fff" />
              <Text className="text-white text-xs font-bold ml-1.5">
                {saving ? 'Saving...' : '💾 Save as .mp4 (via app)'}
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
          injectedJavaScript={`(function(){var w=null;(async function(){try{if('wakeLock'in navigator){w=await navigator.wakeLock.request('screen');}}catch(e){}window.addEventListener('beforeunload',function(){if(w){try{w.release()}catch(e){}}});window.addEventListener('pagehide',function(){if(w){try{w.release()}catch(e){}}})})()})()`}
          allowsBackForwardNavigationGestures={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={handleNavigation}
          onLoadEnd={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      </View>
    </View>
  );
}
