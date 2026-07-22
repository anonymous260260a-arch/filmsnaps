/**
 * Nxsha Download — WebView-based link extraction with premium UI.
 *
 * Loads the Nxsha page in a WebView, auto-solves the arithmetic CAPTCHA,
 * extracts ALL server links with labels, sorts intelligently (Hindi → Dual
 * Audio → Original → Other, each by quality descending), and presents them
 * in an immersive server-card picker.
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Modal,
  ScrollView,
  Image,
  Platform,
  LayoutAnimation,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { EpisodeRail } from '../../../components/player/EpisodeRail';
import { useDownloadInfra, useDownloadList } from '../../../lib/download';

// ── Constants ──

const AUTO_SOLVE_TIMEOUT = 30000;
const SCRAPE_TIMEOUT = 45000;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const POSTER_W = 100;
const POSTER_H = 150;

// ── Quality helpers ──

const QUALITY_RANK: Record<string, number> = {
  '4k': 0, '2160p': 0,
  '1080p': 1, 'fhd': 1,
  '720p': 2, 'hd': 2,
  '480p': 3, 'sd': 3,
  '360p': 4,
  'm3u8': 5,
};

const QUALITY_COLORS: Record<string, string> = {
  '4K': '#D4A237',
  '2160p': '#D4A237',
  '1080p': '#B45309',
  'FHD': '#B45309',
  '720p': '#A1A1AA',
  'HD': '#A1A1AA',
  '480p': '#64748B',
  'SD': '#64748B',
  '360p': '#52525B',
  'M3U8': '#3B82F6',
};

const AUDIO_KEYWORDS = [
  { re: /hindi/, type: 'hindi', priority: 0, label: 'Hindi' },
  { re: /dual audio|dual channel/, type: 'dual-audio', priority: 1, label: 'Dual Audio' },
  { re: /original audio/, type: 'original', priority: 2, label: 'Original Audio' },
  { re: /tamil/, type: 'tamil', priority: 3, label: 'Tamil' },
  { re: /english/, type: 'english', priority: 4, label: 'English' },
];

// ── Ad-blocking script (unchanged) ──
const AD_BLOCK_SCRIPT = `
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
    try { var host = new URL(url).hostname.toLowerCase(); for (var i = 0; i < AD_DOMAINS.length; i++) { if (host.indexOf(AD_DOMAINS[i]) !== -1) return true; } } catch(e) {}
    return false;
  }
  function isIntentUrl(url) { return url && typeof url === 'string' && (url.indexOf('intent://') === 0 || url.indexOf('android-app://') === 0); }
  function post(type, data) { try { window.ReactNativeWebView.postMessage(JSON.stringify({type: type, data: data})); } catch(e) {} }
  try { var _origFetch = window.fetch; window.fetch = function(input, init) { var url = (typeof input === 'string') ? input : (input && input.url) || ''; var urlStr = (typeof url === 'string') ? url : ''; if (isAdUrl(urlStr) || isIntentUrl(urlStr)) { return Promise.resolve(new Response('', {status: 204})); } return _origFetch.call(this, input, init); }; } catch(e) {}
  try { var _origXHROpen = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method, url) { this._url = (typeof url === 'string') ? url : (url && url.url) || ''; if (isAdUrl(this._url) || isIntentUrl(this._url)) { this._aborted = true; return; } return _origXHROpen.apply(this, arguments); }; var _origXHRSend = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(body) { if (this._aborted) return; return _origXHRSend.apply(this, arguments); }; } catch(e) {}
  try { window.open = function() { return null; }; } catch(e) {}
  try { var _locProto = Object.getPrototypeOf(window.location); if (_locProto) { var _hrefDesc = Object.getOwnPropertyDescriptor(_locProto, 'href'); if (_hrefDesc && _hrefDesc.set) { Object.defineProperty(_locProto, 'href', { set: function(val) { if (val && typeof val === 'string') { if (isIntentUrl(val)) return; if (isAdUrl(val)) return; } return _hrefDesc.set.call(this, val); }, get: function() { return _hrefDesc.get.call(this); }, configurable: false, }); } } } catch(e) {}
  try { var _lr = window.location.constructor.prototype.replace; window.location.constructor.prototype.replace = function(u) { if (u && typeof u === 'string' && (isAdUrl(u) || isIntentUrl(u))) return; return _lr.call(this, u); }; } catch(e) {}
  try { var _la = window.location.constructor.prototype.assign; window.location.constructor.prototype.assign = function(u) { if (u && typeof u === 'string' && (isAdUrl(u) || isIntentUrl(u))) return; return _la.call(this, u); }; } catch(e) {}
  document.addEventListener('click', function(e) { var el = e.target; while (el && el.tagName !== 'BODY') { if (el.tagName === 'A') { var h = el.getAttribute('href') || ''; if (h) { try { var absUrl = new URL(h, location.href).toString(); if (isAdUrl(absUrl)) { e.preventDefault(); return false; } } catch(e) {} } break; } el = el.parentElement; } }, true);
  try { new MutationObserver(function(muts) { for (var i = 0; i < muts.length; i++) { for (var j = 0; j < muts[i].addedNodes.length; j++) { var n = muts[i].addedNodes[j]; if (n.nodeType !== 1) continue; if (n.tagName === 'A') { var h = n.getAttribute('href') || ''; if (h) { try { var a = new URL(h, location.href).toString(); if (isIntentUrl(a)) { post('intent-url', a); } } catch(e) {} } } if (n.tagName === 'IFRAME') { var src = n.getAttribute('src') || ''; if (src && (src.indexOf('vidvault') !== -1)) { post('dl-url', src); } } } } }).observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}
})();
true;
`;

// ── CAPTCHA solver + comprehensive link extractor ──
const SOLVE_SCRIPT = `
(function() {
  var startTime = Date.now();
  var captchaSolved = false;
  var expanded = false;

  function post(type, data) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type: type, data: data})); } catch(e) {}
  }

  // ── CAPTCHA helpers ──
  function findNumbers() {
    var all = document.querySelectorAll('div');
    var nums = [];
    for (var i = 0; i < all.length && nums.length < 2; i++) {
      var text = all[i].textContent.trim();
      if (/^\\d+$/.test(text) && text.length <= 3) {
        nums.push(parseInt(text, 10));
      }
    }
    return nums.length >= 2 ? nums : null;
  }

  function submitAnswer(sum) {
    var input = document.querySelector('input[inputMode="numeric"]');
    var btn = document.querySelector('button[type="submit"]');
    if (!input || !btn) return false;
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, String(sum));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    btn.click();
    return true;
  }

  // ── Accordion expander (only clicks collapsed ones) ──
  function expandAllServers() {
    var allDivs = document.querySelectorAll('div');
    for (var i = 0; i < allDivs.length; i++) {
      var d = allDivs[i];
      if (d.className && typeof d.className === 'string' &&
          d.className.indexOf('overflow-hidden') !== -1 &&
          d.className.indexOf('rounded-[') !== -1) {
        // Check if download links are already visible
        var dlLinks = d.querySelectorAll('a[href]');
        var hasVisible = false;
        for (var j = 0; j < dlLinks.length; j++) {
          if (dlLinks[j].textContent.trim().toLowerCase() === 'download') {
            hasVisible = true; break;
          }
        }
        if (!hasVisible) {
          var btn = d.querySelector('button');
          if (btn && btn.querySelector('h3')) btn.click();
        }
      }
    }
    expanded = true;
  }

  // ── Comprehensive link extractor ──
  function extractAllData() {
    var anchors = document.querySelectorAll('a[href]');
    var items = [];
    var seen = {};

    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.href || '';
      if (!href.startsWith('http')) continue;
      if (seen[href]) continue;

      // Only process links with "Download" text or video-like href
      var text = (a.textContent || '').trim().toLowerCase();
      var isDownloadLink = text === 'download';

      if (!isDownloadLink) continue;

      seen[href] = true;

      // ── Find the label text ──
      var label = '';
      var walker = a.parentElement;
      var limit = 8;
      while (walker && limit > 0) {
        var spans = walker.querySelectorAll('span');
        for (var s = 0; s < spans.length; s++) {
          var t = spans[s].textContent.trim();
          if (t && t.toLowerCase() !== 'download' && t.length > 0) {
            label = t;
            break;
          }
        }
        if (label) break;
        walker = walker.parentElement;
        limit--;
      }

      // ── Find the server name via h3 ancestor ──
      var serverName = '';
      var up = a.parentElement;
      var upLimit = 12;
      while (up && upLimit > 0) {
        var h3 = up.querySelector('h3');
        if (h3) { serverName = h3.textContent.trim(); break; }
        up = up.parentElement;
        upLimit--;
      }

      items.push({
        url: href,
        label: label || a.textContent.trim(),
        server: serverName,
      });
    }

    return items;
  }

  // ── CAPTCHA poll ──
  var pollCaptcha = setInterval(function() {
    if (Date.now() - startTime > ${AUTO_SOLVE_TIMEOUT}) {
      clearInterval(pollCaptcha);
      return;
    }
    if (!captchaSolved) {
      var nums = findNumbers();
      if (nums && nums[0] >= 0 && nums[1] >= 0) {
        if (submitAnswer(nums[0] + nums[1])) {
          captchaSolved = true;
          post('captcha-solved', {a: nums[0], b: nums[1]});
          clearInterval(pollCaptcha);
        }
      }
    }
  }, 500);

  // ── Extraction poll (runs concurrently) ──
  var pollExtract = setInterval(function() {
    if (Date.now() - startTime > ${SCRAPE_TIMEOUT}) {
      clearInterval(pollExtract);
      post('scrape-timeout', {});
      return;
    }

    // Expand accordions on first attempt or if still no links
    if (!expanded) expandAllServers();
    else {
      // Re-expand in case React re-collapsed after captcha
      expandAllServers();
    }

    var items = extractAllData();
    if (items.length > 0) {
      // Group by server
      var serverMap = {};
      for (var j = 0; j < items.length; j++) {
        var sv = items[j].server || 'Sources';
        if (!serverMap[sv]) serverMap[sv] = [];
        serverMap[sv].push({ url: items[j].url, label: items[j].label });
      }
      var servers = [];
      for (var name in serverMap) {
        servers.push({ name: name, links: serverMap[name] });
      }

      clearInterval(pollCaptcha);
      clearInterval(pollExtract);
      post('download-links', { servers: servers });
    }
  }, 1200);
})();
true;
`;

// ── Types ──

interface NxshaLink {
  url: string;
  label: string;
}

interface NxshaServer {
  name: string;
  links: NxshaLink[];
}

interface ParsedLink extends NxshaLink {
  quality: string;
  qualityRank: number;
  audioType: string;
  audioPriority: number;
  audioLabel: string;
  size: string;
  format: string;
  server: string;
}

type SolveState = 'loading-page' | 'solving' | 'found-links' | 'failed';

// ── Link parser ──

function parseLabel(label: string): {
  quality: string; qualityRank: number;
  audioType: string; audioPriority: number; audioLabel: string;
  size: string; format: string;
} {
  const lower = label.toLowerCase();

  // Quality
  let quality = '', qualityRank = 99;
  for (const [q, r] of Object.entries(QUALITY_RANK)) {
    if (lower.includes(q)) { quality = q === 'fhd' ? '1080p' : q === 'hd' ? '720p' : q === 'sd' ? '480p' : q; qualityRank = r as number; break; }
  }

  // Audio
  let audioType = 'other', audioPriority = 5, audioLabel = '';
  for (const kw of AUDIO_KEYWORDS) {
    if (kw.re.test(lower)) { audioType = kw.type; audioPriority = kw.priority; audioLabel = kw.label; break; }
  }

  // Size
  let size = '';
  const sm = lower.match(/([\d,.]+)\s*(gb|mb)/i);
  if (sm) size = sm[0];

  // Format
  let format = '';
  if (lower.includes('hevc') || lower.includes('h265')) format = 'HEVC';
  else if (lower.includes('m3u8')) format = 'M3U8';
  else if (lower.includes('h264')) format = 'H.264';

  return { quality, qualityRank, audioType, audioPriority, audioLabel, size, format };
}

function parseLinks(server: NxshaServer): ParsedLink[] {
  return server.links.map((link) => ({
    ...link,
    server: server.name,
    ...parseLabel(link.label),
  }));
}

function sortParsedLinks(links: ParsedLink[]): ParsedLink[] {
  return [...links].sort((a, b) => {
    if (a.audioPriority !== b.audioPriority) return a.audioPriority - b.audioPriority;
    return a.qualityRank - b.qualityRank;
  });
}

// ── Format helpers ──

function getExt(url: string): string {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.([a-z0-9]+)(?:\?|$)/i);
    return m ? m[1].toLowerCase() : 'mp4';
  } catch { return 'mp4'; }
}

const QUALITY_DISPLAY: Record<string, string> = {
  '4k': '4K', '2160p': '4K', '1080p': '1080p', 'fhd': '1080p',
  '720p': '720p', 'hd': '720p', '480p': '480p', 'sd': '480p', '360p': '360p',
  'm3u8': 'M3U8',
};

// ── Server Accordion Card ──

function ServerCard({
  server,
  expanded,
  onToggle,
  downloads,
  onDownload,
}: {
  server: NxshaServer & { parsed: ParsedLink[] };
  expanded: boolean;
  onToggle: () => void;
  downloads: ReturnType<typeof useDownloadList>['all'];
  onDownload: (link: ParsedLink) => void;
}) {
  const sorted = useMemo(() => sortParsedLinks(server.parsed), [server.parsed]);
  const linkCount = sorted.length;
  const audioGroups = useMemo(() => {
    const groups: { audioLabel: string; links: ParsedLink[] }[] = [];
    let currentGroup: ParsedLink[] = [];
    let currentLabel = sorted[0]?.audioLabel || '';
    for (const link of sorted) {
      if (link.audioLabel !== currentLabel && currentGroup.length > 0) {
        groups.push({ audioLabel: currentLabel, links: [...currentGroup] });
        currentGroup = [];
        currentLabel = link.audioLabel;
      }
      currentGroup.push(link);
    }
    if (currentGroup.length > 0) groups.push({ audioLabel: currentLabel, links: currentGroup });
    return groups;
  }, [sorted]);

  // ── Count active audio types for badge ──
  const audioBadges = useMemo(() => {
    const set = new Set<string>();
    for (const l of sorted) if (l.audioLabel) set.add(l.audioLabel);
    return Array.from(set);
  }, [sorted]);

  return (
    <View
      className="rounded-2xl mb-3 overflow-hidden"
      style={{ backgroundColor: '#0E0E11', borderWidth: 0.5, borderColor: '#1f1f1f' }}
    >
      {/* Header */}
      <TouchableOpacity
        onPress={() => { LayoutAnimation.easeInEaseOut(); onToggle(); }}
        activeOpacity={0.7}
        className="flex-row items-center justify-between px-4 py-3.5"
      >
        <View className="flex-row items-center flex-1 mr-3" style={{ gap: 10 }}>
          {/* Server icon */}
          <View
            style={{
              width: 32, height: 32, borderRadius: 10,
              backgroundColor: 'rgba(212, 162, 55, 0.1)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="server" size={14} color="#D4A237" />
          </View>
          <View className="flex-1">
            <Text className="text-white text-sm font-bold" numberOfLines={1}>
              {server.name}
            </Text>
            <View className="flex-row flex-wrap items-center mt-0.5" style={{ gap: 4 }}>
              <Text className="text-zinc-500 text-[10px] font-medium">{linkCount} link{linkCount !== 1 ? 's' : ''}</Text>
              {audioBadges.length > 0 && (
                <>
                  <Text className="text-zinc-600 text-[10px]">·</Text>
                  <Text className="text-zinc-500 text-[10px]" numberOfLines={1}>{audioBadges.join(', ')}</Text>
                </>
              )}
            </View>
          </View>
        </View>
        <View
          className="w-7 h-7 rounded-full items-center justify-center"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={expanded ? '#D4A237' : '#71717A'}
          />
        </View>
      </TouchableOpacity>

      {/* Content */}
      {expanded && (
        <View
          className="px-3 pb-3 pt-1"
          style={{ borderTopWidth: 0.5, borderTopColor: '#1f1f1f' }}
        >
          {audioGroups.map((group, gi) => (
            <View key={gi}>
              {/* Audio type section header */}
              {group.audioLabel && (
                <View className="flex-row items-center mt-2 mb-1.5 px-1" style={{ gap: 6 }}>
                  <AudioTypeIcon type={group.links[0]?.audioType || ''} size={12} />
                  <Text
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: getAudioColor(group.links[0]?.audioType || '') }}
                  >
                    {group.audioLabel}
                  </Text>
                  <View className="flex-1 h-px" style={{ backgroundColor: '#1a1a1e' }} />
                </View>
              )}

              {/* Links */}
              {group.links.map((link, li) => (
                <DownloadItem
                  key={`${link.url}-${li}`}
                  link={link}
                  onDownload={() => onDownload(link)}
                  downloads={downloads}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Audio type helpers ──

function getAudioColor(type: string): string {
  switch (type) {
    case 'hindi': return '#F97316';
    case 'dual-audio': return '#A855F7';
    case 'original': return '#3B82F6';
    case 'tamil': return '#EF4444';
    case 'english': return '#22C55E';
    default: return '#71717A';
  }
}

function AudioTypeIcon({ type, size = 12 }: { type: string; size?: number }) {
  const name: keyof typeof Ionicons.glyphMap =
    type === 'hindi' ? 'language' :
    type === 'dual-audio' ? 'headset' :
    type === 'original' ? 'mic-outline' :
    type === 'tamil' ? 'language' :
    type === 'english' ? 'globe-outline' : 'musical-note';
  return <Ionicons name={name} size={size} color={getAudioColor(type)} />;
}

// ── Download Item Row ──

function DownloadItem({
  link,
  onDownload,
  downloads,
}: {
  link: ParsedLink;
  onDownload: () => void;
  downloads: ReturnType<typeof useDownloadList>['all'];
}) {
  const qualityDisplay = QUALITY_DISPLAY[link.quality] || link.quality;
  const qualityColor = QUALITY_COLORS[link.quality.toUpperCase()] || QUALITY_COLORS[qualityDisplay] || '#52525B';
  const storeTask = useMemo(
    () => downloads.find((t) => t.url === link.url),
    [downloads, link.url],
  );
  const isActive = storeTask?.status === 'downloading' || storeTask?.status === 'pending';
  const isDone = storeTask?.status === 'completed';
  const progress = storeTask?.totalBytes ? (storeTask.receivedBytes / storeTask.totalBytes) : 0;

  return (
    <TouchableOpacity
      onPress={isActive ? undefined : onDownload}
      disabled={isActive}
      activeOpacity={0.7}
      className="flex-row items-center rounded-xl mb-1.5 px-3 py-2.5"
      style={{ backgroundColor: '#141417', borderWidth: 0.5, borderColor: '#1E1E22' }}
    >
      {/* Quality badge */}
      <View
        className="rounded-lg px-2 py-1 min-w-[52px] items-center mr-3"
        style={{ backgroundColor: `${qualityColor}18` }}
      >
        <Text style={{ color: qualityColor, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
          {qualityDisplay}
        </Text>
      </View>

      {/* Info */}
      <View className="flex-1 mr-2">
        {/* Size + Format row */}
        <View className="flex-row items-center" style={{ gap: 6 }}>
          {link.size ? (
            <Text className="text-zinc-300 text-[11px] font-semibold">{link.size}</Text>
          ) : null}
          {link.format && (
            <View
              className="rounded px-1.5 py-0.5"
              style={{ backgroundColor: 'rgba(59,130,246,0.12)' }}
            >
              <Text className="text-blue-400 text-[8px] font-bold">{link.format}</Text>
            </View>
          )}
        </View>
        {/* Truncated URL for reference */}
        <Text className="text-zinc-600 text-[8px] mt-0.5" numberOfLines={1}>
          {link.url.length > 45 ? link.url.substring(0, 45) + '…' : link.url}
        </Text>

        {/* Progress bar for active downloads */}
        {isActive && progress > 0 && (
          <View className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ backgroundColor: '#222226' }}>
            <View
              className="h-full rounded-full"
              style={{ width: `${Math.min(progress * 100, 100)}%`, backgroundColor: qualityColor }}
            />
          </View>
        )}
      </View>

      {/* Action button */}
      {isActive ? (
        <View
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: `${qualityColor}20` }}
        >
          <ActivityIndicator size="small" color={qualityColor} />
        </View>
      ) : isDone ? (
        <View
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: 'rgba(34,197,94,0.15)' }}
        >
          <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
        </View>
      ) : (
        <View
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: 'rgba(212, 162, 55, 0.15)' }}
        >
          <Ionicons name="download" size={16} color="#D4A237" />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main Screen ──

export default function NxshaDownloadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ id: string[] }>();
  const webViewRef = useRef<WebView>(null);

  const [loadingPage, setLoadingPage] = useState(true);
  const [solveState, setSolveState] = useState<SolveState>('loading-page');
  const [servers, setServers] = useState<NxshaServer[]>([]);
  const [expandedServers, setExpandedServers] = useState<Record<number, boolean>>({});
  const [showEpPicker, setShowEpPicker] = useState(false);
  const [pickedSeason, setPickedSeason] = useState<number | null>(null);
  const [pickedEpisode, setPickedEpisode] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const { enqueue } = useDownloadInfra();
  const { all: downloads } = useDownloadList();

  const params = useMemo(() => {
    const segs = rawParams.id ?? [];
    return {
      type: segs[0] as 'movie' | 'tv',
      id: segs[1],
      season: segs[2] ? Number(segs[2]) : undefined,
      episode: segs[3] ? Number(segs[3]) : undefined,
    };
  }, [(rawParams.id ?? []).join(',')]);

  const effectiveSeason = pickedSeason ?? params.season ?? 1;
  const effectiveEpisode = pickedEpisode ?? params.episode ?? 1;
  const isTV = params.type === 'tv';

  const downloadUrl = useMemo(() => {
    if (!params.id || !params.type) return '';
    return isTV
      ? `https://web.nxsha.app/dl/tv/${params.id}/${effectiveSeason}/${effectiveEpisode}`
      : `https://web.nxsha.app/dl/movie/${params.id}`;
  }, [params.id, params.type, isTV, effectiveSeason, effectiveEpisode]);

  const handleEpisodeSelect = useCallback((season: number, episode: number) => {
    setPickedSeason(season);
    setPickedEpisode(episode);
    setShowEpPicker(false);
    setLoadingPage(true);
    setSolveState('loading-page');
    setServers([]);
    setExpandedServers({});
  }, []);

  // ── Parse & organize servers ──
  const organizedServers = useMemo(() => {
    if (servers.length === 0) return [];
    return servers
      .map((s) => ({ ...s, parsed: parseLinks(s) }))
      .sort((a, b) => {
        // 1. Exact match "MbPly-[Multi-Lang]" always first
        const aExact = a.name.includes('MbPly') ? 0 : 1;
        const bExact = b.name.includes('MbPly') ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        // 2. Any server with "Multi-Lang" in the name comes next
        const aMulti = a.name.toLowerCase().includes('multi-lang') ? 0 : 1;
        const bMulti = b.name.toLowerCase().includes('multi-lang') ? 0 : 1;
        if (aMulti !== bMulti) return aMulti - bMulti;
        // 3. Rest stay in original order
        return 0;
      });
  }, [servers]);

  const totalLinks = useMemo(
    () => organizedServers.reduce((acc, s) => acc + s.parsed.length, 0),
    [organizedServers],
  );

  // ── Download handler ──
  const handleDownload = useCallback((link: ParsedLink) => {
    const ext = getExt(link.url);
    const qualityStr = link.quality ? `-${link.quality}` : '';
    const filename = isTV
      ? `nxsha-S${effectiveSeason}E${effectiveEpisode}${qualityStr}-${link.server.replace(/[^a-zA-Z0-9]/g, '')}.${ext}`
      : `nxsha${qualityStr}-${link.server.replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;

    enqueue({
      url: link.url,
      fileName: filename,
      server: 'nxsha',
      mediaType: params.type,
      tmdbId: params.id,
      quality: link.quality || undefined,
      title: `Nxsha ${link.server} ${link.quality || ''}`.trim(),
      season: isTV ? effectiveSeason : undefined,
      episode: isTV ? effectiveEpisode : undefined,
      extension: ext,
    });

    // Use inline Modal instead of Alert.alert — system Alert dialogs
    // steal activity focus on Android, causing React Navigation's
    // back-button handler to dispatch against a stale navigator ref.
    setSuccessMessage(filename);
    setShowSuccess(true);
  }, [params.type, params.id, isTV, effectiveSeason, effectiveEpisode, enqueue]);

  // ── WebView message handler ──
  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'captcha-solved':
          console.log('[Nxsha] CAPTCHA solved:', msg.data?.a, '+', msg.data?.b);
          setSolveState('solving');
          break;
        case 'captcha-timeout':
          console.warn('[Nxsha] CAPTCHA timeout');
          setSolveState('failed');
          break;
        case 'download-links': {
          const data = msg.data;
          console.log('[Nxsha] Extracted', data?.servers?.length, 'servers');
          if (data?.servers?.length > 0) {
            setServers(data.servers);
            // Expand first server by default
            setExpandedServers({ 0: true });
            setSolveState('found-links');
          }
          break;
        }
        case 'scrape-timeout':
          console.warn('[Nxsha] Scrape timeout');
          setSolveState('failed');
          break;
        default:
          break;
      }
    } catch {}
  }, []);

  // ── Navigation handler ──
  const handleNavigation = useCallback((request: any): boolean => {
    if (!request.url) return true;
    if (request.url.startsWith('intent://') || request.url.startsWith('android-app://')) return false;
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
      for (const a of ads) { if (host.indexOf(a) !== -1) return false; }
    } catch {}
    return true;
  }, []);

  // ── Error / Invalid params ──
  if (!params.id || !params.type || !downloadUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-8">
        <StatusBar barStyle="light-content" />
        <View className="w-16 h-16 rounded-full items-center justify-center mb-5" style={{ backgroundColor: '#141414' }}>
          <Ionicons name="download-outline" size={36} color="#52525B" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">Download Unavailable</Text>
        <TouchableOpacity onPress={() => { try { if (router.canGoBack()) router.back(); else router.push('/'); } catch {} }} className="bg-primary rounded-xl py-3 px-8" activeOpacity={0.8}>
          <Text className="text-black font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" />

      {/* ── Fixed header ── */}
      <View
        className="absolute top-0 left-0 right-0 z-30 flex-row items-center justify-between px-4"
        style={{ paddingTop: insets.top + 8, paddingBottom: 8 }}
      >
        <TouchableOpacity
          onPress={() => { try { if (router.canGoBack()) router.back(); else router.push('/'); } catch {} }}
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>

        <View className="flex-row items-center" style={{ gap: 8 }}>
          {isTV && (
            <TouchableOpacity
              onPress={() => setShowEpPicker(true)}
              className="h-9 rounded-full flex-row items-center px-3"
              style={{ backgroundColor: 'rgba(212,162,55,0.12)' }}
              activeOpacity={0.7}
            >
              <Ionicons name="list-outline" size={13} color="#D4A237" style={{ marginRight: 4 }} />
              <Text className="text-amber-400 text-[11px] font-bold">
                S{effectiveSeason}:E{String(effectiveEpisode).padStart(2, '0')}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => { webViewRef.current?.reload(); setLoadingPage(true); setSolveState('loading-page'); setServers([]); setExpandedServers({}); }}
            className="w-9 h-9 rounded-full items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Loading overlay ── */}
      {(solveState === 'loading-page' || solveState === 'solving') && (
        <View className="absolute inset-0 z-20 items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}>
          <View
            className="rounded-3xl px-8 py-8 items-center"
            style={{ backgroundColor: '#0E0E11', borderWidth: 0.5, borderColor: '#1f1f1f', minWidth: 220 }}
          >
            <ActivityIndicator size="large" color="#D4A237" />
            <Text className="text-white text-sm font-semibold mt-4">
              {solveState === 'loading-page' ? 'Loading download page...' : 'Solving security check...'}
            </Text>
            <Text className="text-zinc-500 text-xs mt-1.5 text-center leading-relaxed">
              {solveState === 'solving'
                ? 'Extracting video links from all servers'
                : 'This should take a few seconds'}
            </Text>
            <View className="flex-row items-center mt-4" style={{ gap: 8 }}>
              <View className="w-1.5 h-1.5 rounded-full bg-amber-500/50" />
              <View className="w-1.5 h-1.5 rounded-full bg-amber-500/30" />
              <View className="w-1.5 h-1.5 rounded-full bg-amber-500/10" />
            </View>
          </View>
        </View>
      )}

      {/* ── Failed state overlay ── */}
      {solveState === 'failed' && !loadingPage && (
        <View className="absolute top-[100px] left-4 right-4 z-20">
          <View className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 0.5, borderColor: 'rgba(239,68,68,0.25)' }}>
            <View className="flex-row items-center mb-1.5" style={{ gap: 8 }}>
              <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}>
                <Ionicons name="alert-circle" size={16} color="#ef4444" />
              </View>
              <View className="flex-1">
                <Text className="text-red-400 text-sm font-bold">Auto-solve failed</Text>
                <Text className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                  The security check could not be solved automatically. You can retry or solve it manually in the WebView below.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => { setSolveState('loading-page'); setServers([]); webViewRef.current?.reload(); }}
              className="rounded-xl py-2.5 items-center mt-1"
              style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}
              activeOpacity={0.7}
            >
              <Text className="text-red-400 text-xs font-bold">Retry Auto-Solve</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Links found: show the premium picker UI ── */}
      {solveState === 'found-links' && organizedServers.length > 0 && (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 0, paddingBottom: 80 }}
        >
          {/* ── Hero Section ── */}
          <View className="relative overflow-hidden mb-4" style={{ minHeight: POSTER_H + 40 }}>
            {/* Dark gradient overlay */}
            <View
              className="absolute inset-0"
              style={{ backgroundColor: '#09090B' }}
            />

            {/* Info row */}
            <View
              className="flex-row items-end px-5"
              style={{ paddingTop: insets.top + 60, paddingBottom: 16 }}
            >
              {/* Poster placeholder */}
              <View
                style={{
                  width: POSTER_W, height: POSTER_H, borderRadius: 14,
                  backgroundColor: '#141417', borderWidth: 1, borderColor: '#1f1f1f',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Ionicons name="film-outline" size={28} color="#3f3f46" />
              </View>

              <View className="flex-1 ml-4 mb-1">
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <View className="rounded px-2 py-0.5" style={{ backgroundColor: 'rgba(212,162,55,0.12)' }}>
                    <Text className="text-amber-400 text-[10px] font-bold uppercase tracking-widest">Direct DL</Text>
                  </View>
                  <Text className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider">
                    {isTV ? 'TV' : 'Movie'}
                  </Text>
                </View>

                <Text
                  className="text-white text-2xl font-bold mt-2 leading-tight"
                  style={{ fontFamily: 'PlayfairDisplay_700Bold' }}
                  numberOfLines={1}
                >
                  {params.type.charAt(0).toUpperCase() + params.type.slice(1)}
                  {isTV ? ` S${effectiveSeason}` : ''}
                </Text>

                {isTV && (
                  <Text className="text-zinc-400 text-xs mt-0.5">
                    Episode {effectiveEpisode}
                  </Text>
                )}

                {/* Stats row */}
                <View className="flex-row items-center mt-2" style={{ gap: 10 }}>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Ionicons name="server" size={12} color="#D4A237" />
                    <Text className="text-amber-400 text-[11px] font-bold">{organizedServers.length}</Text>
                  </View>
                  <Text className="text-zinc-600 text-[10px]">·</Text>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Ionicons name="link" size={12} color="#A1A1AA" />
                    <Text className="text-zinc-400 text-[11px] font-medium">{totalLinks} links</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* ── Section title ── */}
          <View className="px-5 mb-4">
            <View className="flex-row items-center justify-between">
              <Text
                className="text-white text-lg font-bold"
                style={{ fontFamily: 'PlayfairDisplay_700Bold' }}
              >
                Download Sources
              </Text>
              <TouchableOpacity
                onPress={() => {
                  // Expand/collapse all
                  LayoutAnimation.easeInEaseOut();
                  const allExpanded = Object.keys(expandedServers).length === organizedServers.length;
                  if (allExpanded) {
                    setExpandedServers({});
                  } else {
                    setExpandedServers(Object.fromEntries(organizedServers.map((_, i) => [i, true])));
                  }
                }}
                activeOpacity={0.7}
              >
                <Text className="text-amber-400 text-xs font-semibold">
                  {Object.keys(expandedServers).length === organizedServers.length ? 'Collapse All' : 'Expand All'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text className="text-zinc-500 text-xs mt-1">
              Sorted: Hindi → Dual Audio → Original → Other · Highest quality first
            </Text>
          </View>

          {/* ── Server cards ── */}
          <View className="px-4">
            {organizedServers.map((server, i) => (
              <ServerCard
                key={`${server.name}-${i}`}
                server={server}
                expanded={expandedServers[i] ?? false}
                onToggle={() => {
                  LayoutAnimation.easeInEaseOut();
                  setExpandedServers((prev) => ({ ...prev, [i]: !prev[i] }));
                }}
                downloads={downloads}
                onDownload={handleDownload}
              />
            ))}
          </View>

          {/* ── Tip card ── */}
          <View
            className="mx-4 mt-2 rounded-2xl p-4"
            style={{ backgroundColor: '#0E0E11', borderWidth: 0.5, borderColor: '#1f1f1f' }}
          >
            <View className="flex-row items-start" style={{ gap: 10 }}>
              <View
                className="w-8 h-8 rounded-full items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(212,162,55,0.1)' }}
              >
                <Ionicons name="bulb-outline" size={16} color="#D4A237" />
              </View>
              <View className="flex-1">
                <Text className="text-zinc-300 text-xs font-bold mb-0.5">Pro Tip</Text>
                <Text className="text-zinc-500 text-[10px] leading-relaxed">
                  Use VLC Media Player for the best playback experience — it supports all formats including HEVC, MKV, and multi-audio tracks.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ── WebView (always mounted, hidden when links found) ── */}
      <View
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          opacity: solveState === 'found-links' ? 0 : 1,
          zIndex: solveState === 'found-links' ? -1 : 1,
        }}
      >
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
          injectedJavaScriptBeforeContentLoaded={AD_BLOCK_SCRIPT}
          allowsBackForwardNavigationGestures={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          javaScriptCanOpenWindowsAutomatically={false}
          incognito={true}
          onShouldStartLoadWithRequest={handleNavigation}
          onMessage={handleMessage}
          onLoadEnd={() => {
            setLoadingPage(false);
            setTimeout(() => {
              webViewRef.current?.injectJavaScript(SOLVE_SCRIPT);
            }, 1800);
          }}
          onError={() => setLoadingPage(false)}
        />
      </View>

      {/* ── TV episode picker ── */}
      {isTV && (
        <EpisodeRail
          visible={showEpPicker}
          tvId={params.id}
          currentSeason={effectiveSeason}
          currentEpisode={effectiveEpisode}
          onSelect={handleEpisodeSelect}
          onClose={() => setShowEpPicker(false)}
        />
      )}

      {/* ── Download started success toast ── */}
      {/* Inline Modal instead of Alert.alert to avoid activity focus loss
          on Android which can corrupt React Navigation's back-button state */}
      <Modal
        visible={showSuccess}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSuccess(false)}
      >
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <View
            className="rounded-2xl px-8 py-8 items-center mx-8"
            style={{ backgroundColor: '#0E0E11', borderWidth: 0.5, borderColor: '#1f1f1f' }}
          >
            <View
              className="w-14 h-14 rounded-full items-center justify-center mb-4"
              style={{ backgroundColor: 'rgba(34,197,94,0.15)' }}
            >
              <Ionicons name="checkmark-circle" size={32} color="#22C55E" />
            </View>
            <Text
              className="text-white text-lg font-bold mb-1"
              style={{ fontFamily: 'PlayfairDisplay_700Bold' }}
            >
              Download Started
            </Text>
            <Text className="text-zinc-400 text-sm text-center leading-5 mb-6" numberOfLines={2}>
              {successMessage}
            </Text>
            <TouchableOpacity
              onPress={() => setShowSuccess(false)}
              className="rounded-xl py-3 px-10"
              style={{ backgroundColor: '#D4A237' }}
              activeOpacity={0.8}
            >
              <Text className="text-void font-bold text-sm">Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
