/**
 * Nxsha Download — WebView-based link extraction with premium UI.
 *
 * Loads the Nxsha page in a WebView, auto-solves the arithmetic CAPTCHA,
 * extracts ALL server links with labels, sorts intelligently (Hindi → Dual
 * Audio → Original → Other, each by quality descending), and presents them
 * in an immersive server-card picker.
 */

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  ScrollView,
  Platform,
  LayoutAnimation,
  Dimensions,
  Linking,
  Alert,
} from "react-native";
import { WebView } from "react-native-webview";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../theme/colors";
import { EpisodeRail } from "../../../components/player/EpisodeRail";
import { useDownloadInfra, useDownloadList } from "../../../lib/download";
import { fetchNxshaSources } from "../../../lib/nxshaApi";
import {
  organizeServers,
  extractFilename,
  isGatewayUrl,
  getExt,
  type NxshaServer,
  type ParsedLink,
} from "../../../lib/nxshaLinks";

// ── Constants ──

const AUTO_SOLVE_TIMEOUT = 30000;
const SCRAPE_TIMEOUT = 15000;
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const POSTER_W = 100;
const POSTER_H = 150;

// ── Quality helpers ──

const QUALITY_RANK: Record<string, number> = {
  "4k": 0,
  "2160p": 0,
  "1080p": 1,
  fhd: 1,
  "720p": 2,
  hd: 2,
  "480p": 3,
  sd: 3,
  "360p": 4,
  m3u8: 5,
};

const QUALITY_COLORS: Record<string, string> = {
  "4K": colors.gold,
  "2160p": colors.gold,
  "1080p": "#B45309",
  FHD: "#B45309",
  "720p": "#A1A1AA",
  HD: "#A1A1AA",
  "480p": "#64748B",
  SD: "#64748B",
  "360p": colors.textTertiary,
  M3U8: "#3B82F6",
};

const AUDIO_KEYWORDS = [
  { re: /hindi/, type: "hindi", priority: 0, label: "Hindi" },
  {
    re: /dual audio|dual channel/,
    type: "dual-audio",
    priority: 1,
    label: "Dual Audio",
  },
  {
    re: /original audio/,
    type: "original",
    priority: 2,
    label: "Original Audio",
  },
  { re: /tamil/, type: "tamil", priority: 3, label: "Tamil" },
  { re: /english/, type: "english", priority: 4, label: "English" },
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

type SolveState =
  | "loading-api"
  | "loading-page"
  | "solving"
  | "found-links"
  | "failed"
  | "no-links";

// ── Format helpers ──

function qualityColor(quality: string): string {
  switch (quality) {
    case "2160p":
    case "4k":
      return colors.gold;
    case "1080p":
    case "fhd":
      return "#B45309";
    case "720p":
    case "hd":
      return "#A1A1AA";
    case "480p":
    case "sd":
      return "#64748B";
    case "360p":
      return colors.textTertiary;
    default:
      return colors.textTertiary;
  }
}

// ── Server Accordion Card ──

function ServerCard({
  server,
  expanded,
  onToggle,
  downloads,
  onDownload,
  onOpen,
}: {
  server: NxshaServer & { parsed: ParsedLink[] };
  expanded: boolean;
  onToggle: () => void;
  downloads: ReturnType<typeof useDownloadList>["all"];
  onDownload: (link: ParsedLink) => void;
  onOpen: (link: ParsedLink) => void;
}) {
  const sorted = useMemo(
    () =>
      [...server.parsed].sort((a, b) => {
        if (a.audioPriority !== b.audioPriority)
          return a.audioPriority - b.audioPriority;
        if (a.qualityRank !== b.qualityRank)
          return a.qualityRank - b.qualityRank;
        return b.sizeBytes - a.sizeBytes;
      }),
    [server.parsed],
  );
  const linkCount = sorted.length;
  const audioGroups = useMemo(() => {
    const groups: { audioLabel: string; links: ParsedLink[] }[] = [];
    let currentGroup: ParsedLink[] = [];
    let currentLabel = sorted[0]?.audioLabel || "";
    for (const link of sorted) {
      if (link.audioLabel !== currentLabel && currentGroup.length > 0) {
        groups.push({ audioLabel: currentLabel, links: [...currentGroup] });
        currentGroup = [];
        currentLabel = link.audioLabel;
      }
      currentGroup.push(link);
    }
    if (currentGroup.length > 0)
      groups.push({ audioLabel: currentLabel, links: currentGroup });
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
      style={{
        backgroundColor: colors.bgSurface,
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      {/* Header */}
      <TouchableOpacity
        onPress={() => {
          LayoutAnimation.easeInEaseOut();
          onToggle();
        }}
        activeOpacity={0.7}
        className="flex-row items-center justify-between px-4 py-3.5"
      >
        <View className="flex-row items-center flex-1 mr-3" style={{ gap: 10 }}>
          {/* Server icon */}
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              backgroundColor: "rgba(212, 162, 55, 0.1)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="server" size={14} color={colors.gold} />
          </View>
          <View className="flex-1">
            <Text className="text-white text-sm font-bold" numberOfLines={1}>
              {server.name}
            </Text>
            <View
              className="flex-row flex-wrap items-center mt-0.5"
              style={{ gap: 4 }}
            >
              <Text className="text-zinc-500 text-[10px] font-medium">
                {linkCount} link{linkCount !== 1 ? "s" : ""}
              </Text>
              {audioBadges.length > 0 && (
                <>
                  <Text className="text-zinc-600 text-[10px]">·</Text>
                  <Text className="text-zinc-500 text-[10px]" numberOfLines={1}>
                    {audioBadges.join(", ")}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>
        <View
          className="w-7 h-7 rounded-full items-center justify-center"
          style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
        >
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={expanded ? colors.gold : colors.zinc500}
          />
        </View>
      </TouchableOpacity>

      {/* Content */}
      {expanded && (
        <View
          className="px-3 pb-3 pt-1"
          style={{ borderTopWidth: 0.5, borderTopColor: colors.border }}
        >
          {audioGroups.map((group, gi) => (
            <View key={gi}>
              {/* Audio type section header */}
              {group.audioLabel && (
                <View
                  className="flex-row items-center mt-2 mb-1.5 px-1"
                  style={{ gap: 6 }}
                >
                  <Ionicons
                    name={
                      group.audioLabel.toLowerCase().includes("hindi")
                        ? "language"
                        : group.audioLabel.toLowerCase().includes("dual")
                          ? "headset"
                          : group.audioLabel.toLowerCase().includes("tamil")
                            ? "language"
                            : group.audioLabel.toLowerCase().includes("english")
                              ? "globe-outline"
                              : "musical-note"
                    }
                    size={12}
                    color={colors.gold}
                  />
                  <Text
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: colors.gold }}
                  >
                    {group.audioLabel}
                  </Text>
                  <View
                    className="flex-1 h-px"
                    style={{ backgroundColor: colors.zincBgFull }}
                  />
                </View>
              )}

              {/* Links */}
              {group.links.map((link, li) => (
                <DownloadItem
                  key={`${link.downloadUrl}-${li}`}
                  link={link}
                  onDownload={() => onDownload(link)}
                  onOpen={() => onOpen(link)}
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

// ── Download Item Row ──

function DownloadItem({
  link,
  onDownload,
  onOpen,
  downloads,
}: {
  link: ParsedLink;
  onDownload: () => void;
  onOpen: () => void;
  downloads: ReturnType<typeof useDownloadList>["all"];
}) {
  const q = link.quality || "";
  const qualityDisplay = q ? q.toUpperCase() : "LINK";
  const qColor = qualityColor(link.quality);
  const isGateway = !link.isDirect && isGatewayUrl(link.downloadUrl);
  const storeTask = useMemo(
    () => downloads.find((t) => t.url === link.downloadUrl),
    [downloads, link.downloadUrl],
  );
  const isActive =
    storeTask?.status === "downloading" || storeTask?.status === "pending";
  const isDone = storeTask?.status === "completed";
  const progress = storeTask?.totalBytes
    ? storeTask.receivedBytes / storeTask.totalBytes
    : 0;

  const subtitle = [
    link.server,
    link.filename || link.downloadUrl.split("/").pop()?.split("?")[0],
  ]
    .filter(Boolean)
    .join(" · ");

  const extras = link.extras.slice(0, 4);

  return (
    <View
      className="flex-row items-center rounded-xl mb-1.5 px-3 py-2.5"
      style={{
        backgroundColor: colors.zincBgFull,
        borderWidth: 0.5,
        borderColor: colors.bgSubtle,
      }}
    >
      {/* Quality badge */}
      <View
        className="rounded-lg px-2 py-1 min-w-[52px] items-center mr-3"
        style={{ backgroundColor: `${qColor}18` }}
      >
        <Text
          style={{
            color: qColor,
            fontSize: 10,
            fontWeight: "800",
            letterSpacing: 0.5,
          }}
        >
          {qualityDisplay}
        </Text>
      </View>

      {/* Info */}
      <TouchableOpacity
        onPress={isGateway ? onOpen : onDownload}
        disabled={isActive}
        activeOpacity={0.7}
        className="flex-1 mr-2"
      >
        <View className="flex-row items-center flex-wrap" style={{ gap: 4 }}>
          {link.size ? (
            <Text className="text-zinc-300 text-[11px] font-semibold">
              {link.size}
            </Text>
          ) : (
            <Text className="text-zinc-600 text-[11px]">size unknown</Text>
          )}
          {link.langs?.map((lang) => (
            <View
              key={lang}
              className="rounded px-1.5 py-0.5"
              style={{ backgroundColor: "rgba(212,162,55,0.10)" }}
            >
              <Text className="text-amber-400 text-[8px] font-bold">
                {lang}
              </Text>
            </View>
          ))}
          {extras.map((ex) => (
            <View
              key={ex}
              className="rounded px-1.5 py-0.5"
              style={{ backgroundColor: "rgba(59,130,246,0.12)" }}
            >
              <Text className="text-blue-400 text-[8px] font-bold">{ex}</Text>
            </View>
          ))}
          {link.mirrorCount > 1 && (
            <View
              className="rounded px-1.5 py-0.5"
              style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
            >
              <Text className="text-zinc-400 text-[8px] font-bold">
                +{link.mirrorCount - 1} mirrors
              </Text>
            </View>
          )}
        </View>
        <Text className="text-zinc-600 text-[8px] mt-0.5" numberOfLines={1}>
          {subtitle}
        </Text>
        {/* Progress bar for active downloads */}
        {isActive && progress > 0 && (
          <View
            className="mt-1.5 h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: colors.bgSubtle }}
          >
            <View
              className="h-full rounded-full"
              style={{
                width: `${Math.min(progress * 100, 100)}%`,
                backgroundColor: qColor,
              }}
            />
          </View>
        )}
      </TouchableOpacity>

      {/* Action button: gold Download (direct) · blue Open↗ (gateway) */}
      {isActive ? (
        <View
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: `${qColor}20` }}
        >
          <ActivityIndicator size="small" color={qColor} />
        </View>
      ) : isDone ? (
        <View
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: "rgba(34,197,94,0.15)" }}
        >
          <Ionicons
            name="checkmark-circle"
            size={18}
            color={colors.successGreen}
          />
        </View>
      ) : isGateway ? (
        <TouchableOpacity
          onPress={onOpen}
          activeOpacity={0.7}
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: "rgba(59,130,246,0.15)" }}
        >
          <Ionicons name="open-outline" size={16} color="#3B82F6" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onDownload}
          activeOpacity={0.7}
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: "rgba(212, 162, 55, 0.15)" }}
        >
          <Ionicons name="download" size={16} color={colors.gold} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Main Screen ──

export default function NxshaDownloadScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ id: string[] }>();
  const webViewRef = useRef<WebView>(null);

  const [loadingPage, setLoadingPage] = useState(true);
  const [solveState, setSolveState] = useState<SolveState>("loading-api");
  const [apiTried, setApiTried] = useState(false);
  const [servers, setServers] = useState<NxshaServer[]>([]);
  const [expandedServers, setExpandedServers] = useState<
    Record<number, boolean>
  >({});
  const [statusText, setStatusText] = useState("Contacting download servers…");
  const [showEpPicker, setShowEpPicker] = useState(false);
  const [pickedSeason, setPickedSeason] = useState<number | null>(null);
  const [pickedEpisode, setPickedEpisode] = useState<number | null>(null);
  // Toast feedback replaced the old Modal popup — see context.tsx for status toasts

  const { enqueue } = useDownloadInfra();
  const { all: downloads } = useDownloadList();

  const params = useMemo(() => {
    const segs = rawParams.id ?? [];
    return {
      type: segs[0] as "movie" | "tv",
      id: segs[1],
      season: segs[2] ? Number(segs[2]) : undefined,
      episode: segs[3] ? Number(segs[3]) : undefined,
    };
  }, [(rawParams.id ?? []).join(",")]);

  const effectiveSeason = pickedSeason ?? params.season ?? 1;
  const effectiveEpisode = pickedEpisode ?? params.episode ?? 1;
  const isTV = params.type === "tv";

  const downloadUrl = useMemo(() => {
    if (!params.id || !params.type) return "";
    return isTV
      ? `https://web.nxsha.app/dl/tv/${params.id}/${effectiveSeason}/${effectiveEpisode}`
      : `https://web.nxsha.app/dl/movie/${params.id}`;
  }, [params.id, params.type, isTV, effectiveSeason, effectiveEpisode]);

  const handleEpisodeSelect = useCallback((season: number, episode: number) => {
    setPickedSeason(season);
    setPickedEpisode(episode);
    setShowEpPicker(false);
    setApiTried(false);
    setLoadingPage(true);
    setSolveState("loading-api");
    setServers([]);
    setExpandedServers({});
  }, []);

  // ── API-first fetch (proxy does the crypto server-side) ──
  useEffect(() => {
    if (apiTried || !params.id || !params.type) return;
    let cancelled = false;
    setApiTried(true);
    setSolveState("loading-api");
    setStatusText("Contacting download servers…");
    (async () => {
      const result = await fetchNxshaSources({
        type: params.type,
        id: params.id,
        season: effectiveSeason,
        episode: effectiveEpisode,
      });
      if (cancelled) return;
      if (result && result.length > 0) {
        setServers(result);
        setExpandedServers({ 0: true });
        setSolveState("found-links");
      } else {
        // No API result → fall back to the WebView CAPTCHA scrape.
        setSolveState("loading-page");
        setLoadingPage(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiTried, params.id, params.type, effectiveSeason, effectiveEpisode]);

  // ── Parse & organize servers ──
  const organizedServers = useMemo(() => {
    if (servers.length === 0) return [];
    return organizeServers(servers);
  }, [servers]);

  const totalLinks = useMemo(
    () => organizedServers.reduce((acc, s) => acc + s.parsed.length, 0),
    [organizedServers],
  );

  // ── Open gateway in external browser ──
  const handleOpen = useCallback((link: ParsedLink) => {
    Linking.openURL(link.downloadUrl).catch(() =>
      Alert.alert("Could not open URL"),
    );
  }, []);

  // ── Download handler ──
  const handleDownload = useCallback(
    (link: ParsedLink) => {
      const finalUrl = link.downloadUrl || link.url;
      const ext = getExt(finalUrl);
      const qualityStr = link.quality ? `-${link.quality}` : "";
      const filename = isTV
        ? `nxsha-S${effectiveSeason}E${effectiveEpisode}${qualityStr}-${link.server.replace(/[^a-zA-Z0-9]/g, "")}.${ext}`
        : `nxsha${qualityStr}-${link.server.replace(/[^a-zA-Z0-9]/g, "")}.${ext}`;

      enqueue({
        url: finalUrl,
        fileName: filename,
        server: "nxsha",
        mediaType: params.type,
        tmdbId: params.id,
        quality: link.quality || undefined,
        title: `Nxsha ${link.server} ${link.quality || ""}`.trim(),
        season: isTV ? effectiveSeason : undefined,
        episode: isTV ? effectiveEpisode : undefined,
        extension: ext,
      });

      // Download queued — toast appears automatically via context.tsx
      // Navigate to downloads page so user can see progress
      nav.push("/downloads");
    },
    [
      params.type,
      params.id,
      isTV,
      effectiveSeason,
      effectiveEpisode,
      enqueue,
      nav,
    ],
  );

  // ── WebView message handler ──
  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case "captcha-solved":
          console.log("[Nxsha] CAPTCHA solved:", msg.data?.a, "+", msg.data?.b);
          setSolveState("solving");
          break;
        case "captcha-timeout":
          console.warn("[Nxsha] CAPTCHA timeout");
          setSolveState("failed");
          break;
        case "download-links": {
          const data = msg.data;
          console.log("[Nxsha] Extracted", data?.servers?.length, "servers");
          if (data?.servers?.length > 0) {
            setServers(data.servers);
            // Expand first server by default
            setExpandedServers({ 0: true });
            setSolveState("found-links");
          }
          break;
        }
        case "scrape-timeout":
          console.warn("[Nxsha] Scrape timeout — no links found");
          setSolveState("no-links");
          break;
        default:
          break;
      }
    } catch {}
  }, []);

  // ── Navigation handler ──
  const handleNavigation = useCallback((request: any): boolean => {
    if (!request.url) return true;
    if (
      request.url.startsWith("intent://") ||
      request.url.startsWith("android-app://")
    )
      return false;
    try {
      const host = new URL(request.url).hostname.toLowerCase();
      const ads = [
        "doubleclick.net",
        "googleadservices",
        "googlesyndication",
        "pagead2",
        "adnxs.com",
        "popads.",
        "popcash.",
        "popunder.",
        "adsterra",
        "propellerads",
        "exoclick",
        "juicyads",
        "plugrush",
        "hakumnata.com",
        "tags.crwdcntrl",
        "crwdcntrl",
        "mgid.com",
        "tawk.to",
        "adservex",
        "onclickads",
        "peachify",
        "trafficwave",
        "trafficboss",
        "clk.sh",
      ];
      for (const a of ads) {
        if (host.indexOf(a) !== -1) return false;
      }
    } catch {}
    return true;
  }, []);

  // ── Error / Invalid params ──
  if (!params.id || !params.type || !downloadUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-8">
        <StatusBar barStyle="light-content" />
        <View
          className="w-16 h-16 rounded-full items-center justify-center mb-5"
          style={{ backgroundColor: colors.bgCard }}
        >
          <Ionicons
            name="download-outline"
            size={36}
            color={colors.textTertiary}
          />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">
          Download Unavailable
        </Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="bg-primary rounded-xl py-3 px-8"
          activeOpacity={0.8}
        >
          <Text className="text-black font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.playerBg }}>
      <StatusBar barStyle="light-content" />

      {/* ── Fixed header ── */}
      <View
        className="absolute top-0 left-0 right-0 z-30 flex-row items-center justify-between px-4"
        style={{ paddingTop: insets.top + 8, paddingBottom: 8 }}
      >
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={20} color={colors.textPrimary} />
        </TouchableOpacity>

        <View className="flex-row items-center" style={{ gap: 8 }}>
          {isTV && (
            <TouchableOpacity
              onPress={() => setShowEpPicker(true)}
              className="h-9 rounded-full flex-row items-center px-3"
              style={{ backgroundColor: "rgba(212,162,55,0.12)" }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="list-outline"
                size={13}
                color={colors.gold}
                style={{ marginRight: 4 }}
              />
              <Text className="text-amber-400 text-[11px] font-bold">
                S{effectiveSeason}:E{String(effectiveEpisode).padStart(2, "0")}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              setApiTried(false);
              setLoadingPage(true);
              setSolveState("loading-api");
              setServers([]);
              setExpandedServers({});
            }}
            className="w-9 h-9 rounded-full items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => nav.push("/downloads")}
            className="h-9 rounded-full flex-row items-center px-3"
            style={{ backgroundColor: "rgba(212,162,55,0.12)" }}
            activeOpacity={0.7}
          >
            <Ionicons
              name="download-outline"
              size={14}
              color={colors.gold}
              style={{ marginRight: 4 }}
            />
            <Text className="text-amber-400 text-[11px] font-bold">
              Downloads
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Loading overlay ── */}
      {(solveState === "loading-api" ||
        solveState === "loading-page" ||
        solveState === "solving") && (
        <View
          className="absolute inset-0 z-20 items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
        >
          <View
            className="rounded-3xl px-8 py-8 items-center"
            style={{
              backgroundColor: colors.bgSurface,
              borderWidth: 0.5,
              borderColor: colors.border,
              minWidth: 220,
            }}
          >
            <ActivityIndicator size="large" color={colors.gold} />
            <Text className="text-white text-sm font-semibold mt-4">
              {solveState === "loading-api"
                ? "Fetching download links…"
                : solveState === "loading-page"
                  ? "Loading download page..."
                  : "Solving security check..."}
            </Text>
            <Text className="text-zinc-500 text-xs mt-1.5 text-center leading-relaxed">
              {solveState === "loading-api"
                ? statusText
                : solveState === "solving"
                  ? "Extracting video links from all servers"
                  : "This should take a few seconds"}
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
      {solveState === "no-links" && !loadingPage && (
        <View className="absolute top-[100px] left-4 right-4 z-20">
          <View
            className="rounded-2xl p-4"
            style={{
              backgroundColor: "rgba(239,68,68,0.08)",
              borderWidth: 0.5,
              borderColor: "rgba(239,68,68,0.25)",
            }}
          >
            <View className="flex-row items-center mb-1.5" style={{ gap: 8 }}>
              <View
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: "rgba(239,68,68,0.15)" }}
              >
                <Ionicons name="alert-circle" size={16} color={colors.error} />
              </View>
              <View className="flex-1">
                <Text className="text-red-400 text-sm font-bold">
                  No links available
                </Text>
                <Text className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                  This server has no downloadable links for this title. Try
                  using another server instead.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                setSolveState("loading-page");
                setServers([]);
                webViewRef.current?.reload();
              }}
              className="rounded-xl py-2.5 items-center mt-1"
              style={{ backgroundColor: "rgba(239,68,68,0.15)" }}
              activeOpacity={0.7}
            >
              <Text className="text-red-400 text-xs font-bold">Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {solveState === "failed" && !loadingPage && (
        <View className="absolute top-[100px] left-4 right-4 z-20">
          <View
            className="rounded-2xl p-4"
            style={{
              backgroundColor: "rgba(239,68,68,0.08)",
              borderWidth: 0.5,
              borderColor: "rgba(239,68,68,0.25)",
            }}
          >
            <View className="flex-row items-center mb-1.5" style={{ gap: 8 }}>
              <View
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: "rgba(239,68,68,0.15)" }}
              >
                <Ionicons name="alert-circle" size={16} color={colors.error} />
              </View>
              <View className="flex-1">
                <Text className="text-red-400 text-sm font-bold">
                  Auto-solve failed
                </Text>
                <Text className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                  The security check could not be solved automatically. You can
                  retry or solve it manually in the WebView below.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                setSolveState("loading-page");
                setServers([]);
                webViewRef.current?.reload();
              }}
              className="rounded-xl py-2.5 items-center mt-1"
              style={{ backgroundColor: "rgba(239,68,68,0.15)" }}
              activeOpacity={0.7}
            >
              <Text className="text-red-400 text-xs font-bold">
                Retry Auto-Solve
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Links found: show the premium picker UI ── */}
      {solveState === "found-links" && organizedServers.length > 0 && (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 0, paddingBottom: 80 }}
        >
          {/* ── Hero Section ── */}
          <View
            className="relative overflow-hidden mb-4"
            style={{ minHeight: POSTER_H + 40 }}
          >
            {/* Dark gradient overlay */}
            <View
              className="absolute inset-0"
              style={{ backgroundColor: colors.bg }}
            />

            {/* Info row */}
            <View
              className="flex-row items-end px-5"
              style={{ paddingTop: insets.top + 60, paddingBottom: 16 }}
            >
              {/* Poster placeholder */}
              <View
                style={{
                  width: POSTER_W,
                  height: POSTER_H,
                  borderRadius: 14,
                  backgroundColor: colors.zincBgFull,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="film-outline"
                  size={28}
                  color={colors.emptyIcon}
                />
              </View>

              <View className="flex-1 ml-4 mb-1">
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <View
                    className="rounded px-2 py-0.5"
                    style={{ backgroundColor: "rgba(212,162,55,0.12)" }}
                  >
                    <Text className="text-amber-400 text-[10px] font-bold uppercase tracking-widest">
                      Direct DL
                    </Text>
                  </View>
                  <Text className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider">
                    {isTV ? "TV" : "Movie"}
                  </Text>
                </View>

                <Text
                  className="text-white text-2xl font-bold mt-2 leading-tight"
                  style={{ fontFamily: "PlayfairDisplay_700Bold" }}
                  numberOfLines={1}
                >
                  {params.type.charAt(0).toUpperCase() + params.type.slice(1)}
                  {isTV ? ` S${effectiveSeason}` : ""}
                </Text>

                {isTV && (
                  <Text className="text-zinc-400 text-xs mt-0.5">
                    Episode {effectiveEpisode}
                  </Text>
                )}

                {/* Stats row */}
                <View
                  className="flex-row items-center mt-2"
                  style={{ gap: 10 }}
                >
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Ionicons name="server" size={12} color={colors.gold} />
                    <Text className="text-amber-400 text-[11px] font-bold">
                      {organizedServers.length}
                    </Text>
                  </View>
                  <Text className="text-zinc-600 text-[10px]">·</Text>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Ionicons
                      name="link"
                      size={12}
                      color={colors.textSecondary}
                    />
                    <Text className="text-zinc-400 text-[11px] font-medium">
                      {totalLinks} links
                    </Text>
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
                style={{ fontFamily: "PlayfairDisplay_700Bold" }}
              >
                Download Sources
              </Text>
              <TouchableOpacity
                onPress={() => {
                  // Expand/collapse all
                  LayoutAnimation.easeInEaseOut();
                  const allExpanded =
                    Object.keys(expandedServers).length ===
                    organizedServers.length;
                  if (allExpanded) {
                    setExpandedServers({});
                  } else {
                    setExpandedServers(
                      Object.fromEntries(
                        organizedServers.map((_, i) => [i, true]),
                      ),
                    );
                  }
                }}
                activeOpacity={0.7}
              >
                <Text className="text-amber-400 text-xs font-semibold">
                  {Object.keys(expandedServers).length ===
                  organizedServers.length
                    ? "Collapse All"
                    : "Expand All"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text className="text-zinc-500 text-xs mt-1">
              Sorted: Hindi → Dual Audio → Original → Other · Highest quality
              first
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
                onOpen={handleOpen}
              />
            ))}
          </View>

          {/* ── Tip card ── */}
          <View
            className="mx-4 mt-2 rounded-2xl p-4"
            style={{
              backgroundColor: colors.bgSurface,
              borderWidth: 0.5,
              borderColor: colors.border,
            }}
          >
            <View className="flex-row items-start" style={{ gap: 10 }}>
              <View
                className="w-8 h-8 rounded-full items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(212,162,55,0.1)" }}
              >
                <Ionicons name="bulb-outline" size={16} color={colors.gold} />
              </View>
              <View className="flex-1">
                <Text className="text-zinc-300 text-xs font-bold mb-0.5">
                  Pro Tip
                </Text>
                <Text className="text-zinc-500 text-[10px] leading-relaxed">
                  Use VLC Media Player for the best playback experience — it
                  supports all formats including HEVC, MKV, and multi-audio
                  tracks.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ── WebView fallback (only when the API path returned nothing) ── */}
      {solveState !== "found-links" && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity:
              solveState === "loading-api" || solveState === "loading-page"
                ? 0
                : 1,
            zIndex:
              solveState === "loading-api" || solveState === "loading-page"
                ? -1
                : 1,
          }}
        >
          <WebView
            ref={webViewRef}
            source={{ uri: downloadUrl }}
            style={{ flex: 1, backgroundColor: colors.playerBg }}
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
              setSolveState("solving");
              setTimeout(() => {
                webViewRef.current?.injectJavaScript(SOLVE_SCRIPT);
              }, 1800);
            }}
            onError={() => setLoadingPage(false)}
          />
        </View>
      )}

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
    </View>
  );
}
