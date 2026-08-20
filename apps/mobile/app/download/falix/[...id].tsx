import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
  Linking,
  ScrollView,
  Image,
  SafeAreaView,
  StyleSheet,
  Platform,
  FlatList,
  LayoutAnimation,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useDownloadInfra, useDownloadList } from "../../../lib/download";
import { colors } from "../../../theme/colors";

// ── API Base ──
const FALIX_API_BASE = "https://download-falix-falixmovies-backend-hf.hf.space";

// ── Types ──
interface FalixTelegramFile {
  quality: string;
  id: string;
  name: string;
  size: string;
}

interface FalixMovieData {
  _id: string;
  tmdb_id: number;
  title: string;
  genres: string[];
  description: string;
  rating: number;
  release_year: number;
  poster: string;
  backdrop: string;
  media_type: "movie" | "tv";
  runtime: number;
  updated_on: string;
  languages: string[];
  rip: string;
  telegram: FalixTelegramFile[];
  external_links: any[];
  type: "movie";
}

interface FalixTVData {
  _id: string;
  tmdb_id: number;
  title: string;
  genres: string[];
  description: string;
  rating: number;
  release_year: number;
  poster: string;
  backdrop: string;
  media_type: "movie" | "tv";
  total_seasons: number;
  total_episodes: number;
  status: string;
  updated_on: string;
  languages: string[];
  rip: string;
  seasons: Array<{
    season_number: number;
    episodes: Array<{
      episode_number: number;
      title: string;
      episode_backdrop: string;
      telegram: FalixTelegramFile[];
    }>;
  }>;
  type: "tv";
}

type FalixData = FalixMovieData | FalixTVData;

// ── Quality order for sorting ──
const QUALITY_ORDER: Record<string, number> = {
  "4k": 1,
  "2160p": 1,
  "1080p": 2,
  "720p": 3,
  "480p": 4,
  "360p": 5,
};

const sortByQuality = (a: FalixTelegramFile, b: FalixTelegramFile) => {
  const aq = QUALITY_ORDER[a.quality.toLowerCase()] ?? 99;
  const bq = QUALITY_ORDER[b.quality.toLowerCase()] ?? 99;
  return aq - bq;
};

// ── Parse size string to bytes ──
const parseSizeToBytes = (sizeStr: string): number => {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return value * (multipliers[unit] || 0);
};

// ── Format bytes to readable string ──
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
};

// ── Quality Tier Type ──
type QualityTier = "low" | "mid" | "high";

const QUALITY_TIER_LABELS: Record<QualityTier, string> = {
  low: "Lowest",
  mid: "Medium",
  high: "Highest",
};

const QUALITY_TIER_DESCRIPTIONS: Record<QualityTier, string> = {
  low: "Smallest file size",
  mid: "Balanced quality & size",
  high: "Best available quality",
};

// ── Get file by quality tier from sorted list ──
const getFileByTier = (
  sortedFiles: FalixTelegramFile[],
  tier: QualityTier,
): FalixTelegramFile | null => {
  if (sortedFiles.length === 0) return null;
  if (tier === "low") return sortedFiles[sortedFiles.length - 1]; // last = lowest
  if (tier === "high") return sortedFiles[0]; // first = highest
  // mid: pick the middle one
  const midIndex = Math.floor(sortedFiles.length / 2);
  return sortedFiles[midIndex];
};

export default function FalixDownloadScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ id: string[] }>();

  const params = useMemo(() => {
    const segs = rawParams.id ?? [];
    return {
      type: segs[0] as "movie" | "tv",
      id: segs[1],
      season: segs[2] ? Number(segs[2]) : undefined,
      episode: segs[3] ? Number(segs[3]) : undefined,
    };
  }, [(rawParams.id ?? []).join(",")]);

  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [expandedEpisodes, setExpandedEpisodes] = useState<
    Record<number, boolean>
  >({});
  const [bulkQualityTier, setBulkQualityTier] = useState<QualityTier>("mid");
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const { enqueue } = useDownloadInfra();
  const { all: downloads } = useDownloadList();

  // ── Fetch data from Falix API (cached via react-query) ──
  // The response is cached per (type, id) and reused on re-open / back-nav,
  // so the page renders instantly from cache instead of reloading every time.
  const {
    data: falixData,
    isLoading: falixLoading,
    isError: falixIsError,
    error: falixError,
  } = useQuery<FalixData | null>({
    queryKey: ["falix", "detail", params.type, params.id],
    queryFn: async () => {
      if (!params.id) return null;
      const res = await fetch(`${FALIX_API_BASE}/api/id/${params.id}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return (await res.json()) as FalixData;
    },
    enabled: !!params.id,
    staleTime: 10 * 60 * 1000,
  });

  const data = falixData ?? null;
  const loading = falixLoading;
  const error =
    falixIsError && falixError
      ? falixError instanceof Error
        ? falixError.message
        : String(falixError)
      : null;

  // Default the selected season once falix data arrives.
  useEffect(() => {
    if (data?.type === "tv" && data.seasons?.length > 0) {
      setSelectedSeason(data.seasons[0].season_number);
    }
  }, [data]);

  // ── Build download URL ──
  const buildDownloadUrl = (fileId: string, fileName: string): string => {
    const encodedName = encodeURIComponent(fileName);
    return `${FALIX_API_BASE}/dl/${fileId}/${encodedName}`;
  };

  // ── Download file via store ──
  const downloadFile = useCallback(
    (fileId: string, fileName: string, quality: string) => {
      const url = buildDownloadUrl(fileId, fileName);
      const ext = fileName.split(".").pop() || "mkv";
      const filename = `${data?.title || "video"}-${quality}.${ext}`;

      enqueue({
        url,
        fileName: filename,
        server: "falix",
        mediaType: params.type,
        tmdbId: params.id,
        quality,
        title: data?.title,
        season: params.season,
        episode: params.episode,
        extension: ext,
      });
    },
    [params.id, params.type, params.season, params.episode, data, enqueue],
  );

  // ── Open in external browser ──
  const openInBrowser = (fileId: string, fileName: string) => {
    const url = buildDownloadUrl(fileId, fileName);
    Linking.openURL(url).catch(() => Alert.alert("Could not open URL"));
  };

  // ── Get current season episodes ──
  const currentEpisodes = useMemo(() => {
    if (!data || data.type !== "tv") return [];
    const season = data.seasons?.find(
      (s) => s.season_number === selectedSeason,
    );
    return season?.episodes || [];
  }, [data, selectedSeason]);

  // ── Bulk download calculation ──
  const bulkDownloadInfo = useMemo(() => {
    if (!data || data.type !== "tv") return null;

    const episodes = currentEpisodes;
    let totalBytes = 0;
    let validCount = 0;
    const fileSelections: Array<{
      episode: (typeof episodes)[0];
      file: FalixTelegramFile;
    }> = [];

    for (const ep of episodes) {
      const sorted = [...(ep.telegram || [])].sort(sortByQuality);
      const file = getFileByTier(sorted, bulkQualityTier);
      if (file) {
        totalBytes += parseSizeToBytes(file.size);
        validCount++;
        fileSelections.push({ episode: ep, file });
      }
    }

    return {
      totalBytes,
      totalFormatted: formatBytes(totalBytes),
      validCount,
      totalEpisodes: episodes.length,
      fileSelections,
    };
  }, [data, currentEpisodes, bulkQualityTier]);

  // ── Execute bulk download ──
  const handleBulkDownload = useCallback(() => {
    if (!bulkDownloadInfo || bulkDownloadInfo.fileSelections.length === 0)
      return;

    Alert.alert(
      "Download All Episodes",
      `Download ${bulkDownloadInfo.validCount} episodes (${QUALITY_TIER_LABELS[bulkQualityTier]} quality) — Total: ${bulkDownloadInfo.totalFormatted}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Download All",
          onPress: () => {
            for (const { episode, file } of bulkDownloadInfo.fileSelections) {
              const url = buildDownloadUrl(file.id, file.name);
              const ext = file.name.split(".").pop() || "mkv";
              const filename = `${data?.title || "video"}-S${String(selectedSeason).padStart(2, "0")}E${String(episode.episode_number).padStart(2, "0")}-${file.quality}.${ext}`;

              enqueue({
                url,
                fileName: filename,
                server: "falix",
                mediaType: "tv",
                tmdbId: params.id,
                quality: file.quality,
                title: data?.title,
                season: selectedSeason,
                episode: episode.episode_number,
                extension: ext,
              });
            }
          },
        },
      ],
    );
  }, [
    bulkDownloadInfo,
    bulkQualityTier,
    data,
    selectedSeason,
    params.id,
    enqueue,
  ]);

  // ── Render episode list ──
  const renderEpisode = useCallback(
    ({ item }: { item: any }) => {
      const episodeNum = item.episode_number;
      const isExpanded = expandedEpisodes[episodeNum] ?? false;
      const telegramFiles = item.telegram || [];
      const sortedFiles = [...telegramFiles].sort(sortByQuality);

      return (
        <View
          key={episodeNum}
          style={{
            backgroundColor: "rgba(24, 24, 27, 0.6)",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "rgba(63, 63, 70, 0.5)",
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          {/* Episode header */}
          <TouchableOpacity
            onPress={() => {
              LayoutAnimation.easeInEaseOut();
              setExpandedEpisodes((prev) => ({
                ...prev,
                [episodeNum]: !isExpanded,
              }));
            }}
            activeOpacity={0.9}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 14,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                flex: 1,
              }}
            >
              {item.episode_backdrop && (
                <Image
                  source={{ uri: item.episode_backdrop }}
                  style={{ width: 72, height: 42, borderRadius: 8 }}
                  resizeMode="cover"
                />
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: "#ffffff",
                    fontWeight: "700",
                    fontSize: 14,
                    marginBottom: 3,
                  }}
                >
                  Episode {episodeNum}
                </Text>
                {/* Full title shown — no truncation */}
                <Text
                  style={{
                    color: "#a1a1aa",
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  {item.title || "Untitled Episode"}
                </Text>
              </View>
            </View>
            <View style={{ marginLeft: 8 }}>
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={colors.zinc500}
              />
            </View>
          </TouchableOpacity>

          {/* Expanded download options */}
          {isExpanded && sortedFiles.length > 0 && (
            <View
              style={{
                paddingHorizontal: 14,
                paddingBottom: 14,
                borderTopWidth: 1,
                borderTopColor: "rgba(63, 63, 70, 0.3)",
              }}
            >
              {sortedFiles.map((file, i) => {
                const storeTask = downloads.find(
                  (t) =>
                    t.title === data?.title &&
                    t.quality === file.quality &&
                    t.server === "falix",
                );
                const isDownloading =
                  storeTask?.status === "downloading" ||
                  storeTask?.status === "pending";
                const progress = storeTask?.totalBytes
                  ? storeTask.receivedBytes / storeTask.totalBytes
                  : 0;

                return (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      marginBottom: 8,
                      backgroundColor: "rgba(39, 39, 42, 0.5)",
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginBottom: 5,
                        }}
                      >
                        <View
                          style={{
                            backgroundColor: "rgba(212, 162, 55, 0.15)",
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 20,
                          }}
                        >
                          <Text
                            style={{
                              color: colors.gold,
                              fontSize: 10,
                              fontWeight: "800",
                              letterSpacing: 0.5,
                            }}
                          >
                            {file.quality.toUpperCase()}
                          </Text>
                        </View>
                        <Text
                          style={{
                            color: "#71717a",
                            fontSize: 11,
                            marginLeft: 8,
                          }}
                        >
                          {file.size}
                        </Text>
                      </View>
                      {/* Full file name — no truncation */}
                      <Text
                        style={{
                          color: "#d4d4d8",
                          fontSize: 12,
                          lineHeight: 17,
                          fontWeight: "500",
                        }}
                      >
                        {file.name}
                      </Text>
                    </View>

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      {isDownloading && progress > 0 && (
                        <View
                          style={{
                            width: 50,
                            height: 4,
                            backgroundColor: "rgba(63,63,70,0.5)",
                            borderRadius: 2,
                          }}
                        >
                          <View
                            style={{
                              width: `${progress * 100}%`,
                              height: "100%",
                              backgroundColor: colors.gold,
                              borderRadius: 2,
                            }}
                          />
                        </View>
                      )}
                      {isDownloading ? (
                        <ActivityIndicator size="small" color={colors.gold} />
                      ) : (
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <TouchableOpacity
                            onPress={() => openInBrowser(file.id, file.name)}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 17,
                              backgroundColor: "rgba(63, 63, 70, 0.8)",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name="open-outline"
                              size={15}
                              color={colors.textSecondary}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() =>
                              downloadFile(file.id, file.name, file.quality)
                            }
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 17,
                              backgroundColor: colors.gold,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name="download"
                              size={15}
                              color={colors.voidBlack}
                            />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      );
    },
    [expandedEpisodes, downloadFile, downloads, data],
  );

  // ── Render season tabs ──
  const renderSeasonTabs = useCallback(() => {
    if (!data || data.type !== "tv") return null;
    const seasons = data.seasons || [];

    return (
      <View style={{ marginBottom: 16 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 0, gap: 8 }}
        >
          {seasons.map((s) => (
            <TouchableOpacity
              key={s.season_number}
              onPress={() => {
                setSelectedSeason(s.season_number);
                if (s.episodes?.length > 0) {
                  LayoutAnimation.easeInEaseOut();
                  setExpandedEpisodes((prev) => ({
                    ...prev,
                    [s.episodes[0].episode_number]: true,
                  }));
                }
              }}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 24,
                backgroundColor:
                  selectedSeason === s.season_number
                    ? colors.gold
                    : "rgba(39, 39, 42, 0.8)",
                borderWidth: 1,
                borderColor:
                  selectedSeason === s.season_number
                    ? "rgba(212, 162, 55, 0.4)"
                    : "rgba(63, 63, 70, 0.5)",
              }}
            >
              <Text
                style={{
                  fontWeight: "700",
                  fontSize: 13,
                  color:
                    selectedSeason === s.season_number ? "#000000" : "#d4d4d8",
                }}
              >
                Season {s.season_number}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }, [data, selectedSeason]);

  // ── Bulk Download Panel ──
  const renderBulkDownloadPanel = useCallback(() => {
    if (!data || data.type !== "tv" || currentEpisodes.length === 0)
      return null;

    return (
      <View
        style={{
          backgroundColor: "rgba(24, 24, 27, 0.85)",
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "rgba(212, 162, 55, 0.25)",
          marginBottom: 20,
          overflow: "hidden",
        }}
      >
        {/* Panel Header */}
        <TouchableOpacity
          onPress={() => {
            LayoutAnimation.easeInEaseOut();
            setShowBulkPanel((prev) => !prev);
          }}
          activeOpacity={0.9}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: "rgba(212, 162, 55, 0.15)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="layers-outline" size={18} color={colors.gold} />
            </View>
            <View>
              <Text
                style={{ color: "#ffffff", fontWeight: "700", fontSize: 15 }}
              >
                Download All Episodes
              </Text>
              <Text style={{ color: "#a1a1aa", fontSize: 12, marginTop: 2 }}>
                Season {selectedSeason} • {currentEpisodes.length} episodes
              </Text>
            </View>
          </View>
          <Ionicons
            name={showBulkPanel ? "chevron-up" : "chevron-down"}
            size={20}
            color={colors.zinc500}
          />
        </TouchableOpacity>

        {/* Expanded Panel Content */}
        {showBulkPanel && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            {/* Quality Tier Selector */}
            <Text
              style={{
                color: "#a1a1aa",
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 10,
              }}
            >
              Choose Quality for All
            </Text>

            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
              {(["low", "mid", "high"] as QualityTier[]).map((tier) => {
                const isActive = bulkQualityTier === tier;
                return (
                  <TouchableOpacity
                    key={tier}
                    onPress={() => setBulkQualityTier(tier)}
                    activeOpacity={0.7}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      paddingHorizontal: 8,
                      borderRadius: 12,
                      backgroundColor: isActive
                        ? "rgba(212, 162, 55, 0.15)"
                        : "rgba(39, 39, 42, 0.6)",
                      borderWidth: 1.5,
                      borderColor: isActive
                        ? colors.gold
                        : "rgba(63, 63, 70, 0.5)",
                      alignItems: "center",
                    }}
                  >
                    <Ionicons
                      name={
                        tier === "low"
                          ? "arrow-down-circle-outline"
                          : tier === "mid"
                            ? "remove-circle-outline"
                            : "arrow-up-circle-outline"
                      }
                      size={20}
                      color={isActive ? colors.gold : "#71717a"}
                      style={{ marginBottom: 6 }}
                    />
                    <Text
                      style={{
                        color: isActive ? colors.gold : "#d4d4d8",
                        fontWeight: "700",
                        fontSize: 13,
                        marginBottom: 2,
                      }}
                    >
                      {QUALITY_TIER_LABELS[tier]}
                    </Text>
                    <Text
                      style={{
                        color: "#71717a",
                        fontSize: 10,
                        textAlign: "center",
                      }}
                    >
                      {QUALITY_TIER_DESCRIPTIONS[tier]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Total Size Display */}
            {bulkDownloadInfo && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "rgba(39, 39, 42, 0.5)",
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 14,
                }}
              >
                <View>
                  <Text
                    style={{ color: "#a1a1aa", fontSize: 11, marginBottom: 3 }}
                  >
                    Estimated Total Size
                  </Text>
                  <Text
                    style={{
                      color: "#ffffff",
                      fontWeight: "800",
                      fontSize: 20,
                    }}
                  >
                    {bulkDownloadInfo.totalFormatted}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={{ color: "#a1a1aa", fontSize: 11, marginBottom: 3 }}
                  >
                    Episodes
                  </Text>
                  <Text
                    style={{
                      color: colors.gold,
                      fontWeight: "700",
                      fontSize: 16,
                    }}
                  >
                    {bulkDownloadInfo.validCount}/
                    {bulkDownloadInfo.totalEpisodes}
                  </Text>
                </View>
              </View>
            )}

            {/* Per-episode preview */}
            {bulkDownloadInfo && bulkDownloadInfo.fileSelections.length > 0 && (
              <View style={{ marginBottom: 14 }}>
                <Text
                  style={{
                    color: "#71717a",
                    fontSize: 11,
                    fontWeight: "600",
                    marginBottom: 8,
                  }}
                >
                  Preview ({bulkDownloadInfo.fileSelections.length} files)
                </Text>
                <ScrollView
                  style={{ maxHeight: 140 }}
                  showsVerticalScrollIndicator={true}
                >
                  {bulkDownloadInfo.fileSelections.map(
                    ({ episode, file }, idx) => (
                      <View
                        key={idx}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          paddingVertical: 7,
                          borderBottomWidth:
                            idx < bulkDownloadInfo.fileSelections.length - 1
                              ? 0.5
                              : 0,
                          borderBottomColor: "rgba(63,63,70,0.3)",
                        }}
                      >
                        <Text
                          style={{
                            color: "#d4d4d8",
                            fontSize: 12,
                            flex: 1,
                            marginRight: 8,
                          }}
                          numberOfLines={2}
                        >
                          E{String(episode.episode_number).padStart(2, "0")} —{" "}
                          {file.name}
                        </Text>
                        <Text
                          style={{
                            color: "#71717a",
                            fontSize: 11,
                            fontWeight: "600",
                          }}
                        >
                          {file.size}
                        </Text>
                      </View>
                    ),
                  )}
                </ScrollView>
              </View>
            )}

            {/* Download All Button */}
            <TouchableOpacity
              onPress={handleBulkDownload}
              activeOpacity={0.8}
              disabled={!bulkDownloadInfo || bulkDownloadInfo.validCount === 0}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.gold,
                borderRadius: 14,
                paddingVertical: 15,
                gap: 8,
                opacity:
                  bulkDownloadInfo && bulkDownloadInfo.validCount > 0 ? 1 : 0.4,
              }}
            >
              <Ionicons name="download-outline" size={18} color="#000000" />
              <Text
                style={{ color: "#000000", fontWeight: "800", fontSize: 15 }}
              >
                Download All ({bulkDownloadInfo?.totalFormatted || "0 B"})
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [
    data,
    currentEpisodes,
    selectedSeason,
    showBulkPanel,
    bulkQualityTier,
    bulkDownloadInfo,
    handleBulkDownload,
  ]);

  // ── Loading / Error / Empty ──
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.voidBlack,
        }}
      >
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={colors.gold} />
        <Text style={{ color: "#a1a1aa", fontSize: 14, marginTop: 16 }}>
          Loading download info...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.voidBlack,
          paddingHorizontal: 24,
        }}
      >
        <StatusBar barStyle="light-content" />
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Ionicons
            name="alert-circle-outline"
            size={36}
            color={colors.error}
          />
        </View>
        <Text
          style={{
            color: "#d4d4d8",
            fontSize: 18,
            fontWeight: "600",
            marginBottom: 8,
          }}
        >
          Failed to Load
        </Text>
        <Text
          style={{
            color: "#71717a",
            fontSize: 14,
            textAlign: "center",
            marginBottom: 24,
            lineHeight: 20,
          }}
        >
          {error}
        </Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          style={{
            backgroundColor: colors.gold,
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 32,
          }}
          activeOpacity={0.8}
        >
          <Text style={{ color: "#000000", fontWeight: "700", fontSize: 15 }}>
            Go Back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.voidBlack,
        }}
      >
        <StatusBar barStyle="light-content" />
        <Text style={{ color: "#71717a" }}>No data available</Text>
      </View>
    );
  }

  const isTV = data.type === "tv";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.voidBlack }}>
      <StatusBar barStyle="light-content" />

      {/* Backdrop */}
      {data.backdrop && (
        <Image
          source={{ uri: data.backdrop }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          blurRadius={Platform.OS === "android" ? 10 : 20}
        />
      )}
      {/* Dark overlay for readability */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(0,0,0,0.7)" },
        ]}
      />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Header — offset below the status bar (insets.top) so the back btn and
            Downloads link never overlap the phone's top bar */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: insets.top + 12,
            paddingBottom: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <TouchableOpacity
              onPress={() => nav.goBack({ fallback: "/(tabs)" })}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: "rgba(0,0,0,0.5)",
                alignItems: "center",
                justifyContent: "center",
              }}
              activeOpacity={0.7}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => nav.push("/downloads")}
              style={{
                height: 38,
                borderRadius: 19,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 14,
                backgroundColor: "rgba(212,162,55,0.12)",
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="download-outline"
                size={15}
                color={colors.gold}
                style={{ marginRight: 5 }}
              />
              <Text
                style={{ color: colors.gold, fontSize: 12, fontWeight: "700" }}
              >
                Downloads
              </Text>
            </TouchableOpacity>
          </View>

          {/* Poster + Info */}
          <View
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}
          >
            <Image
              source={{ uri: data.poster }}
              style={{
                width: 115,
                height: 172,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(63, 63, 70, 0.6)",
              }}
              resizeMode="cover"
            />
            <View style={{ flex: 1, paddingTop: 4 }}>
              {/* Full title — no truncation */}
              <Text
                style={{
                  color: "#ffffff",
                  fontWeight: "700",
                  fontSize: 20,
                  lineHeight: 26,
                  fontFamily: "PlayfairDisplay_700Bold",
                }}
              >
                {data.title}
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 10,
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "rgba(39, 39, 42, 0.6)",
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 20,
                  }}
                >
                  <Ionicons name="star" size={12} color={colors.gold} />
                  <Text
                    style={{
                      color: colors.gold,
                      fontSize: 12,
                      fontWeight: "700",
                      marginLeft: 4,
                    }}
                  >
                    {data.rating?.toFixed(1) || "—"}
                  </Text>
                </View>
                <Text style={{ color: "#71717a", fontSize: 12 }}>
                  {data.release_year}
                </Text>
                <Text style={{ color: "#52525b", fontSize: 12 }}>•</Text>
                <Text style={{ color: "#71717a", fontSize: 12 }}>
                  {data.rip}
                </Text>
                {"runtime" in data && data.runtime > 0 && (
                  <>
                    <Text style={{ color: "#52525b", fontSize: 12 }}>•</Text>
                    <Text style={{ color: "#71717a", fontSize: 12 }}>
                      {data.runtime}m
                    </Text>
                  </>
                )}
              </View>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  marginTop: 12,
                  gap: 6,
                }}
              >
                {data.genres?.slice(0, 4).map((g, i) => (
                  <View
                    key={i}
                    style={{
                      backgroundColor: "rgba(39, 39, 42, 0.6)",
                      borderWidth: 1,
                      borderColor: "rgba(63, 63, 70, 0.5)",
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 20,
                    }}
                  >
                    <Text
                      style={{
                        color: "#d4d4d8",
                        fontSize: 11,
                        fontWeight: "600",
                      }}
                    >
                      {g}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Movie quick download */}
              {!isTV && data.telegram && data.telegram.length > 0 && (
                <TouchableOpacity
                  onPress={() =>
                    downloadFile(
                      data.telegram[0]?.id || "",
                      data.telegram[0]?.name || "",
                      "best",
                    )
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: colors.gold,
                    borderRadius: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                    marginTop: 14,
                    alignSelf: "flex-start",
                    gap: 6,
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="download" size={16} color="#000000" />
                  <Text
                    style={{
                      color: "#000000",
                      fontWeight: "700",
                      fontSize: 13,
                    }}
                  >
                    Best Quality
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Description */}
        {data.description && (
          <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
            <Text
              style={{
                color: "#ffffff",
                fontWeight: "700",
                fontSize: 15,
                marginBottom: 8,
                fontFamily: "PlayfairDisplay_700Bold",
              }}
            >
              About
            </Text>
            <Text style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 22 }}>
              {data.description}
            </Text>
          </View>
        )}

        {/* TV: Bulk Download Panel */}
        {isTV && (
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            {renderBulkDownloadPanel()}
          </View>
        )}

        {/* TV: Season tabs + Episodes */}
        {isTV && (
          <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
            {renderSeasonTabs()}
            <Text
              style={{
                color: "#ffffff",
                fontWeight: "700",
                fontSize: 15,
                marginBottom: 14,
                fontFamily: "PlayfairDisplay_700Bold",
              }}
            >
              Season {selectedSeason} Episodes
            </Text>
            <FlatList
              data={currentEpisodes}
              renderItem={renderEpisode}
              keyExtractor={(item) => String(item.episode_number)}
              scrollEnabled={false}
              ListEmptyComponent={
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <Ionicons name="tv-outline" size={28} color="#52525b" />
                  <Text
                    style={{ color: "#71717a", fontSize: 13, marginTop: 8 }}
                  >
                    No episodes found
                  </Text>
                </View>
              }
            />
          </View>
        )}

        {/* Movie: Direct downloads */}
        {!isTV && data.telegram && data.telegram.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            <Text
              style={{
                color: "#ffffff",
                fontWeight: "700",
                fontSize: 15,
                marginBottom: 14,
                fontFamily: "PlayfairDisplay_700Bold",
              }}
            >
              Download Options
            </Text>
            {[...data.telegram].sort(sortByQuality).map((file, i) => {
              const storeTask = downloads.find(
                (t) =>
                  t.title === data?.title &&
                  t.quality === file.quality &&
                  t.server === "falix",
              );
              const isDownloading =
                storeTask?.status === "downloading" ||
                storeTask?.status === "pending";
              const progress = storeTask?.totalBytes
                ? storeTask.receivedBytes / storeTask.totalBytes
                : 0;

              return (
                <View
                  key={i}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    borderRadius: 14,
                    marginBottom: 10,
                    backgroundColor: "rgba(24, 24, 27, 0.6)",
                    borderWidth: 1,
                    borderColor: "rgba(63, 63, 70, 0.5)",
                  }}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <View
                        style={{
                          backgroundColor: "rgba(212, 162, 55, 0.15)",
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 20,
                        }}
                      >
                        <Text
                          style={{
                            color: colors.gold,
                            fontSize: 11,
                            fontWeight: "800",
                            letterSpacing: 0.5,
                          }}
                        >
                          {file.quality.toUpperCase()}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: "#71717a",
                          fontSize: 12,
                          marginLeft: 10,
                        }}
                      >
                        {file.size}
                      </Text>
                    </View>
                    {/* Full file name — no truncation */}
                    <Text
                      style={{
                        color: "#d4d4d8",
                        fontSize: 13,
                        lineHeight: 19,
                        fontWeight: "500",
                      }}
                    >
                      {file.name}
                    </Text>
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {isDownloading && progress > 0 && (
                      <View
                        style={{
                          width: 50,
                          height: 4,
                          backgroundColor: "rgba(63,63,70,0.5)",
                          borderRadius: 2,
                        }}
                      >
                        <View
                          style={{
                            width: `${progress * 100}%`,
                            height: "100%",
                            backgroundColor: colors.gold,
                            borderRadius: 2,
                          }}
                        />
                      </View>
                    )}
                    {isDownloading ? (
                      <ActivityIndicator size="small" color={colors.gold} />
                    ) : (
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => openInBrowser(file.id, file.name)}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: "rgba(63, 63, 70, 0.8)",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name="open-outline"
                            size={16}
                            color={colors.textSecondary}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            downloadFile(file.id, file.name, file.quality)
                          }
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: colors.gold,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="download" size={16} color="#000000" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
