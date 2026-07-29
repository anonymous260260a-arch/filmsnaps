/**
 * SeasonPicker — horizontal season chips + vertical episode list for TV detail screens.
 *
 * Features:
 * - Download summary bar per season (showing completion progress)
 * - State-aware episode download icons (downloaded / downloading / paused / failed / not-downloaded)
 * - Batch download for remaining episodes
 * - Per-episode play + smart download
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../theme/colors";
import { useSeasonEpisodes } from "../hooks/useTMDB";
import { getProgress } from "../lib/watchHistory";
import { getImageUrl } from "@filmsnaps/shared";
import { ProgressiveImage } from "./ProgressiveImage";
import * as Haptics from "expo-haptics";
import { useDownloadInfra, useSmartDownload } from "../lib/download/context";
import { downloadToast } from "./DownloadToast";
import type { MediaDownloadSummary } from "../lib/download/types";

interface SeasonInfo {
  seasonNumber: number;
  episodeCount: number;
  name?: string;
}

interface EpisodeProgress {
  currentTime: number;
  percent: number;
}

interface SeasonPickerProps {
  tmdbId: string;
  seasons: SeasonInfo[];
  /** The season to default to (from resume state) */
  initialSeason?: number;
  backdropPath?: string | null;
  /** NEW: For download-aware features */
  title?: string;
  posterPath?: string | null;
  downloadSummary?: MediaDownloadSummary;
}

const COLLAPSE_THRESHOLD = 8;

/**
 * Format runtime in minutes -> "52m" / "1h 02m"
 */
function formatRuntime(minutes: number): string {
  if (!minutes || minutes < 1) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function SeasonPicker({
  tmdbId,
  seasons,
  initialSeason,
  backdropPath,
  title: showTitle,
  posterPath,
  downloadSummary,
}: SeasonPickerProps) {
  const nav = useSafeNavigation();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const [selectedSeason, setSelectedSeason] = useState<number>(
    initialSeason ?? seasons[0]?.seasonNumber ?? 1,
  );
  const [expanded, setExpanded] = useState(false);
  const [episodeProgress, setEpisodeProgress] = useState<
    Record<string, EpisodeProgress>
  >({});
  const chipScrollRef = useRef<ScrollView>(null);
  const { store, enqueue } = useDownloadInfra();
  const { smartDownload } = useSmartDownload();

  // Fetch episodes for the selected season
  const { data: seasonData, isLoading } = useSeasonEpisodes(
    tmdbId,
    selectedSeason,
  );
  const episodes = seasonData?.episodes ?? [];

  // Load per-episode progress when episodes arrive
  useEffect(() => {
    if (episodes.length === 0) return;

    let cancelled = false;
    const progressMap: Record<string, EpisodeProgress> = {};

    Promise.all(
      episodes.map(async (ep: any) => {
        try {
          const p = await getProgress(
            tmdbId,
            "tv",
            selectedSeason,
            ep.episode_number,
          );
          if (p && p.percent > 0) {
            progressMap[`${selectedSeason}-${ep.episode_number}`] = {
              currentTime: p.currentTime,
              percent: p.percent,
            };
          }
        } catch {
          // silently ignore
        }
      }),
    ).then(() => {
      if (!cancelled) setEpisodeProgress(progressMap);
    });

    return () => {
      cancelled = true;
    };
  }, [tmdbId, selectedSeason, episodes]);

  // Auto-scroll chip to selected season
  const handleSeasonChange = useCallback(
    (seasonNum: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedSeason(seasonNum);
      setExpanded(false);

      const idx = seasons.findIndex((s) => s.seasonNumber === seasonNum);
      if (idx >= 0 && chipScrollRef.current) {
        chipScrollRef.current.scrollTo({
          x: Math.max(0, idx * 80 - 20),
          animated: true,
        });
      }
    },
    [seasons],
  );

  // Find the season summary for the currently selected season
  const seasonSummary = downloadSummary?.seasons?.find(
    (s) => s.seasonNumber === selectedSeason,
  );

  // Get download status for a specific episode
  const getEpisodeDownloadStatus = useCallback(
    (episodeNumber: number) => {
      const all = store.getAll();
      const task = all.find(
        (t: any) =>
          t.tmdbId === tmdbId &&
          t.season === selectedSeason &&
          t.episode === episodeNumber &&
          t.status !== "cancelled",
      );
      return task?.status ?? null;
    },
    [store, tmdbId, selectedSeason],
  );

  // Download all remaining episodes for this season
  const handleDownloadRemaining = useCallback(async () => {
    if (episodes.length === 0) return;

    const remaining = episodes.filter((ep: any) => {
      const status = getEpisodeDownloadStatus(ep.episode_number);
      return (
        status !== "completed" &&
        status !== "downloading" &&
        status !== "pending"
      );
    });

    if (remaining.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      downloadToast.info("All episodes already downloaded");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let count = 0;
    for (const ep of remaining) {
      const epNum = ep.episode_number;
      try {
        await smartDownload({
          url: "",
          fileName: `${showTitle || "TV"}_S${selectedSeason}E${String(epNum).padStart(2, "0")}.mp4`,
          mediaType: "tv",
          tmdbId,
          title: `${showTitle || ""} S${selectedSeason}E${epNum}`,
          posterPath: posterPath ?? undefined,
          season: selectedSeason,
          episode: epNum,
        });
        count++;
      } catch {
        // skip failures — continue with next
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    downloadToast.success(`Queued ${count} episodes for download`);
  }, [
    episodes,
    getEpisodeDownloadStatus,
    smartDownload,
    showTitle,
    selectedSeason,
    tmdbId,
    posterPath,
  ]);

  // Download single episode
  const handleEpisodeDownload = useCallback(
    async (episodeNumber: number) => {
      await smartDownload({
        url: "",
        fileName: `${showTitle || "TV"}_S${selectedSeason}E${String(episodeNumber).padStart(2, "0")}.mp4`,
        mediaType: "tv",
        tmdbId,
        title: `${showTitle || ""} S${selectedSeason}E${episodeNumber}`,
        posterPath: posterPath ?? undefined,
        season: selectedSeason,
        episode: episodeNumber,
      });
    },
    [smartDownload, showTitle, selectedSeason, tmdbId, posterPath],
  );

  if (!seasons || seasons.length === 0) return null;

  const displayEpisodes = expanded
    ? episodes
    : episodes.slice(0, COLLAPSE_THRESHOLD);
  const showExpandButton = episodes.length > COLLAPSE_THRESHOLD;
  const remainingCount = episodes.filter((ep: any) => {
    const status = getEpisodeDownloadStatus(ep.episode_number);
    return status !== "completed";
  }).length;

  return (
    <View className="mt-6">
      {/* Section header */}
      <Text
        style={{
          fontSize: 16,
          fontFamily: "Inter_600SemiBold",
          color: colors.textPrimary,
          marginBottom: 10,
          paddingHorizontal: 0,
        }}
      >
        Episodes
      </Text>

      {/* Season chips — horizontal scroll */}
      <ScrollView
        ref={chipScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 12 }}
        contentContainerStyle={{ gap: 8, paddingRight: 16 }}
      >
        {seasons.map((season) => {
          const isActive = season.seasonNumber === selectedSeason;
          const sSummary = downloadSummary?.seasons?.find(
            (s) => s.seasonNumber === season.seasonNumber,
          );
          return (
            <TouchableOpacity
              key={season.seasonNumber}
              onPress={() => handleSeasonChange(season.seasonNumber)}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 20,
                backgroundColor: isActive ? colors.goldBadge : colors.zincBg,
                borderWidth: 0.5,
                borderColor: isActive ? colors.gold : colors.bgSubtle,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_500Medium",
                  color: isActive ? colors.gold : colors.textSecondary,
                }}
              >
                {season.name || `Season ${season.seasonNumber}`}
              </Text>
              {sSummary && sSummary.downloadedEpisodes > 0 && (
                <Text
                  style={{
                    fontSize: 9,
                    fontFamily: "Inter_700Bold",
                    color: isActive ? colors.successGreen : colors.textTertiary,
                  }}
                >
                  {sSummary.downloadedEpisodes}/{sSummary.totalEpisodes}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Season download summary bar */}
      {seasonSummary && seasonSummary.downloadedEpisodes > 0 && (
        <View
          style={{
            backgroundColor: colors.zincBg,
            borderRadius: 10,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: colors.textSecondary,
                fontWeight: "500",
              }}
            >
              {seasonSummary.downloadedEpisodes}/{seasonSummary.totalEpisodes}{" "}
              episodes downloaded
            </Text>
            {seasonSummary.downloadingEpisodes > 0 && (
              <Text
                style={{
                  fontSize: 12,
                  color: colors.gold,
                  fontWeight: "500",
                  marginLeft: 4,
                }}
              >
                · {seasonSummary.downloadingEpisodes} downloading
              </Text>
            )}
          </View>
          <View
            style={{
              height: 3,
              borderRadius: 1.5,
              backgroundColor: colors.progressTrack,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                borderRadius: 1.5,
                backgroundColor:
                  seasonSummary.downloadedEpisodes >=
                  seasonSummary.totalEpisodes
                    ? colors.successGreen
                    : colors.gold,
                width: `${(seasonSummary.downloadedEpisodes / Math.max(seasonSummary.totalEpisodes, 1)) * 100}%`,
              }}
            />
          </View>
        </View>
      )}

      {/* Batch download button */}
      {episodes.length > 0 && (
        <TouchableOpacity
          onPress={handleDownloadRemaining}
          activeOpacity={0.7}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 10,
            marginBottom: 10,
            borderRadius: 10,
            backgroundColor: colors.goldBadge,
            borderWidth: 0.5,
            borderColor: colors.goldRatingBorder,
          }}
        >
          <Ionicons
            name="cloud-download-outline"
            size={15}
            color={colors.gold}
            style={{ marginRight: 6 }}
          />
          <Text
            style={{
              color: colors.gold,
              fontSize: 13,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            {seasonSummary && seasonSummary.downloadedEpisodes > 0
              ? `Download Remaining (${remainingCount})`
              : `Download Season ${selectedSeason} (${episodes.length})`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Episode list */}
      {isLoading ? (
        <View style={{ paddingVertical: 24, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      ) : displayEpisodes.length > 0 ? (
        <View style={{ gap: 6 }}>
          {displayEpisodes.map((episode: any, index: number) => {
            const epNum = episode.episode_number;
            const epKey = `${selectedSeason}-${epNum}`;
            const progress = episodeProgress[epKey];
            const stillUri = episode.still_path
              ? getImageUrl(episode.still_path, "w185")
              : backdropPath
                ? getImageUrl(backdropPath, "w185")
                : null;

            const dlStatus = getEpisodeDownloadStatus(epNum);

            return (
              <TouchableOpacity
                key={`${selectedSeason}-${epNum}`}
                onPress={() => {
                  const base = `/watch/tv/${tmdbId}/${selectedSeason}/${epNum}`;
                  const qs =
                    progress && progress.percent > 0 && progress.percent < 0.95
                      ? `?t=${Math.floor(progress.currentTime)}&backdrop=${backdropPath || ""}`
                      : `?backdrop=${backdropPath || ""}`;
                  nav.push(`${base}${qs}`);
                }}
                activeOpacity={0.7}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 8,
                  paddingHorizontal: 4,
                  borderBottomWidth:
                    index < displayEpisodes.length - 1 ? 0.5 : 0,
                  borderBottomColor: colors.bgElevated,
                }}
              >
                {/* Episode thumbnail */}
                {stillUri ? (
                  <ProgressiveImage
                    uri={stillUri}
                    style={{
                      width: 60,
                      height: 34,
                      borderRadius: 4,
                      backgroundColor: colors.bgElevated,
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 60,
                      height: 34,
                      borderRadius: 4,
                      backgroundColor: colors.bgElevated,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name="tv-outline"
                      size={14}
                      color={colors.textTertiary}
                    />
                  </View>
                )}

                {/* Episode info */}
                <View className="flex-1 ml-3">
                  <View className="flex-row items-center">
                    <Text
                      className="flex-1"
                      style={{
                        fontSize: 13,
                        fontFamily: "Inter_500Medium",
                        color: colors.textPrimary,
                      }}
                      numberOfLines={1}
                    >
                      E{epNum} · {episode.name || "Untitled"}
                    </Text>
                    {episode.runtime ? (
                      <Text
                        style={{
                          fontSize: 10,
                          color: colors.textTertiary,
                          fontFamily: "Inter_400Regular",
                          marginLeft: 6,
                        }}
                      >
                        {formatRuntime(episode.runtime)}
                      </Text>
                    ) : null}
                  </View>

                  {/* Progress bar */}
                  {progress && progress.percent > 0 && (
                    <View
                      style={{
                        height: 2,
                        borderRadius: 1,
                        backgroundColor: colors.progressTrackAlt,
                        marginTop: 4,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.round(progress.percent * 100)}%`,
                          height: "100%",
                          backgroundColor:
                            progress.percent >= 0.95
                              ? colors.success
                              : colors.gold,
                          borderRadius: 1,
                        }}
                      />
                    </View>
                  )}
                </View>

                {/* Actions */}
                <View
                  className="flex-row items-center"
                  style={{ gap: 4, marginLeft: 8 }}
                >
                  {/* Play icon */}
                  <Ionicons
                    name="play"
                    size={14}
                    color={colors.textSecondary}
                  />

                  {/* Download icon - state-aware */}
                  {dlStatus === "completed" ? (
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={colors.successGreen}
                      />
                    </View>
                  ) : dlStatus === "downloading" || dlStatus === "pending" ? (
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="cloud-download"
                        size={14}
                        color={colors.gold}
                      />
                    </View>
                  ) : dlStatus === "paused" ? (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        handleEpisodeDownload(epNum);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="play-circle-outline"
                        size={16}
                        color={colors.gold}
                      />
                    </TouchableOpacity>
                  ) : dlStatus === "failed" ? (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        handleEpisodeDownload(epNum);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="alert-circle-outline"
                        size={16}
                        color={colors.error}
                      />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        handleEpisodeDownload(epNum);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel={`Download episode ${epNum}`}
                      style={{
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="download-outline"
                        size={14}
                        color={colors.textTertiary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Expand / collapse */}
          {showExpandButton && (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setExpanded(!expanded);
              }}
              activeOpacity={0.7}
              style={{
                paddingVertical: 10,
                alignItems: "center",
                borderRadius: 8,
                backgroundColor: colors.zincBg,
                marginTop: 2,
              }}
            >
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 12,
                  fontFamily: "Inter_500Medium",
                }}
              >
                {expanded
                  ? "Show less"
                  : `Show all ${episodes.length} episodes`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <Text
          style={{
            color: colors.textTertiary,
            fontSize: 13,
            fontFamily: "Inter_400Regular",
            textAlign: "center",
            paddingVertical: 20,
          }}
        >
          No episodes found
        </Text>
      )}
    </View>
  );
}
