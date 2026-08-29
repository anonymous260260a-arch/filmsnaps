/**
 * SeasonPicker — horizontal season chips + vertical episode list for TV detail screens.
 *
 * Features:
 * - 16:9 thumbnail preview with progress overlay
 * - Clean typography hierarchy (EPISODE number + title + runtime)
 * - Download summary bar per season
 * - State-aware episode download icons
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
  initialSeason?: number;
  backdropPath?: string | null;
  title?: string;
  posterPath?: string | null;
  downloadSummary?: MediaDownloadSummary;
}

const COLLAPSE_THRESHOLD = 8;
const THUMB_W = 88;
const THUMB_H = 50; // 16:9

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
  const [selectedSeason, setSelectedSeason] = useState<number>(
    initialSeason ?? seasons[0]?.seasonNumber ?? 1,
  );
  const [expanded, setExpanded] = useState(false);
  const [episodeProgress, setEpisodeProgress] = useState<
    Record<string, EpisodeProgress>
  >({});
  const chipScrollRef = useRef<ScrollView>(null);
  const { store } = useDownloadInfra();
  const { smartDownload } = useSmartDownload();

  const { data: seasonData, isLoading } = useSeasonEpisodes(
    tmdbId,
    selectedSeason,
  );
  const episodes = seasonData?.episodes ?? [];

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
        } catch {}
      }),
    ).then(() => {
      if (!cancelled) setEpisodeProgress(progressMap);
    });

    return () => {
      cancelled = true;
    };
  }, [tmdbId, selectedSeason, episodes]);

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

  const seasonSummary = downloadSummary?.seasons?.find(
    (s) => s.seasonNumber === selectedSeason,
  );

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

  return (
    <View className="mt-6">
      {/* Section header */}
      <Text
        style={{
          fontSize: 15,
          fontFamily: "Inter_600SemiBold",
          color: colors.textPrimary,
          marginBottom: 12,
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
              activeOpacity={0.75}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 9999,
                backgroundColor: isActive
                  ? colors.gold
                  : "rgba(14, 14, 17, 0.75)",
                borderWidth: 0.5,
                borderColor: isActive ? colors.gold : colors.borderSubtle,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_600SemiBold",
                  color: isActive ? colors.bg : colors.textSecondary,
                }}
              >
                {season.name || `Season ${season.seasonNumber}`}
              </Text>
              {sSummary && sSummary.downloadedEpisodes > 0 && (
                <Text
                  style={{
                    fontSize: 10,
                    fontFamily: "Inter_700Bold",
                    color: isActive ? colors.bg : colors.successGreen,
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
            backgroundColor: "rgba(14, 14, 17, 0.75)",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
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
                fontFamily: "Inter_500Medium",
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
                  fontFamily: "Inter_500Medium",
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

      {/* Episode list */}
      {isLoading ? (
        <View style={{ paddingVertical: 24, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      ) : displayEpisodes.length > 0 ? (
        <View style={{ gap: 8 }}>
          {displayEpisodes.map((episode: any) => {
            const epNum = episode.episode_number;
            const epKey = `${selectedSeason}-${epNum}`;
            const progress = episodeProgress[epKey];
            const stillUri = episode.still_path
              ? getImageUrl(episode.still_path, "w300")
              : backdropPath
                ? getImageUrl(backdropPath, "w300")
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
                activeOpacity={0.75}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 8,
                  backgroundColor: "rgba(14, 14, 17, 0.45)",
                  borderRadius: 12,
                  borderWidth: 0.5,
                  borderColor: colors.borderSubtle,
                }}
              >
                {/* 16:9 Thumbnail container */}
                <View
                  style={{
                    width: THUMB_W,
                    height: THUMB_H,
                    borderRadius: 8,
                    overflow: "hidden",
                    backgroundColor: colors.bgElevated,
                    position: "relative",
                  }}
                >
                  {stillUri ? (
                    <ProgressiveImage
                      uri={stillUri}
                      style={{
                        width: THUMB_W,
                        height: THUMB_H,
                        borderRadius: 8,
                      }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      style={{
                        width: THUMB_W,
                        height: THUMB_H,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="tv-outline"
                        size={16}
                        color={colors.textTertiary}
                      />
                    </View>
                  )}

                  {/* Progress bar at bottom of thumbnail */}
                  {progress && progress.percent > 0 && (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 2.5,
                        backgroundColor: "rgba(0,0,0,0.6)",
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.round(progress.percent * 100)}%`,
                          height: "100%",
                          backgroundColor:
                            progress.percent >= 0.95
                              ? colors.successGreen
                              : colors.gold,
                        }}
                      />
                    </View>
                  )}
                </View>

                {/* Episode info */}
                <View className="flex-1 ml-3 justify-center">
                  <Text
                    style={{
                      fontSize: 10,
                      fontFamily: "Inter_600SemiBold",
                      color: colors.gold,
                      letterSpacing: 0.5,
                    }}
                  >
                    EPISODE {epNum}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Inter_600SemiBold",
                      color: colors.textPrimary,
                      marginTop: 2,
                    }}
                    numberOfLines={1}
                  >
                    {episode.name || `Episode ${epNum}`}
                  </Text>

                  {episode.runtime ? (
                    <Text
                      style={{
                        fontSize: 10,
                        color: colors.textTertiary,
                        fontFamily: "Inter_400Regular",
                        marginTop: 2,
                      }}
                    >
                      {formatRuntime(episode.runtime)}
                    </Text>
                  ) : null}
                </View>

                {/* Actions: Download */}
                <View
                  className="flex-row items-center"
                  style={{ marginLeft: 6 }}
                >
                  {dlStatus === "completed" ? (
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={colors.successGreen}
                      />
                    </View>
                  ) : dlStatus === "downloading" || dlStatus === "pending" ? (
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="cloud-download"
                        size={16}
                        color={colors.gold}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        handleEpisodeDownload(epNum);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel={`Download episode ${epNum}`}
                      style={{
                        width: 32,
                        height: 32,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 16,
                        backgroundColor: "rgba(255,255,255,0.06)",
                      }}
                    >
                      <Ionicons
                        name="download-outline"
                        size={15}
                        color={colors.textSecondary}
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
              activeOpacity={0.75}
              style={{
                paddingVertical: 10,
                alignItems: "center",
                borderRadius: 10,
                backgroundColor: "rgba(14, 14, 17, 0.6)",
                borderWidth: 0.5,
                borderColor: colors.borderSubtle,
                marginTop: 4,
              }}
            >
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 12,
                  fontFamily: "Inter_600SemiBold",
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
