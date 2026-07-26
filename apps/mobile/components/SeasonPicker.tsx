/**
 * SeasonPicker — horizontal season chips + vertical episode list for TV detail screens.
 *
 * Uses useSeasonEpisodes (from useTMDB.ts) for per-season episode data.
 * Shows per-episode progress bars, play/download actions.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSeasonEpisodes } from "../hooks/useTMDB";
import { getProgress } from "../lib/watchHistory";
import { getImageUrl } from "@filmsnaps/shared";
import { ProgressiveImage } from "./ProgressiveImage";
import * as Haptics from "expo-haptics";
import { useDownloadInfra } from "../lib/download/context";
import { useSettings } from "../lib/settings";
import { downloadToast } from "./DownloadToast";

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
}: SeasonPickerProps) {
  const router = useRouter();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const [selectedSeason, setSelectedSeason] = useState<number>(
    initialSeason ?? seasons[0]?.seasonNumber ?? 1,
  );
  const [expanded, setExpanded] = useState(false);
  const [episodeProgress, setEpisodeProgress] = useState<
    Record<string, EpisodeProgress>
  >({});
  const [showBatchSheet, setShowBatchSheet] = useState(false);
  const chipScrollRef = useRef<ScrollView>(null);
  const { enqueue } = useDownloadInfra();
  const { settings } = useSettings();

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

      // Rough auto-scroll: each chip ~80px wide, start at offset -20
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
          fontSize: 16,
          fontFamily: "Inter_600SemiBold",
          color: "#F4F4F5",
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
          return (
            <TouchableOpacity
              key={season.seasonNumber}
              onPress={() => handleSeasonChange(season.seasonNumber)}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 20,
                backgroundColor: isActive
                  ? "rgba(212,162,55,0.15)"
                  : "rgba(39,39,42,0.4)",
                borderWidth: 0.5,
                borderColor: isActive ? "#D4A237" : "#222226",
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_500Medium",
                  color: isActive ? "#D4A237" : "#A1A1AA",
                }}
              >
                {season.name || `Season ${season.seasonNumber}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Download Season button */}
      {episodes.length > 0 && (
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowBatchSheet(true);
          }}
          activeOpacity={0.7}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 10,
            marginBottom: 10,
            borderRadius: 10,
            backgroundColor: "rgba(212,162,55,0.1)",
            borderWidth: 0.5,
            borderColor: "rgba(212,162,55,0.3)",
          }}
        >
          <Ionicons
            name="download"
            size={15}
            color="#D4A237"
            style={{ marginRight: 6 }}
          />
          <Text
            style={{
              color: "#D4A237",
              fontSize: 13,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            Download Season {selectedSeason}
          </Text>
        </TouchableOpacity>
      )}

      {/* Episode list */}
      {isLoading ? (
        <View style={{ paddingVertical: 24, alignItems: "center" }}>
          <ActivityIndicator size="small" color="#D4A237" />
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

            return (
              <TouchableOpacity
                key={`${selectedSeason}-${epNum}`}
                onPress={() => {
                  const base = `/watch/tv/${tmdbId}/${selectedSeason}/${epNum}`;
                  const qs =
                    progress && progress.percent > 0 && progress.percent < 0.95
                      ? `?t=${Math.floor(progress.currentTime)}&backdrop=${backdropPath || ""}`
                      : `?backdrop=${backdropPath || ""}`;
                  router.push(`${base}${qs}`);
                }}
                activeOpacity={0.7}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 8,
                  paddingHorizontal: 4,
                  borderBottomWidth:
                    index < displayEpisodes.length - 1 ? 0.5 : 0,
                  borderBottomColor: "#16161A",
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
                      backgroundColor: "#16161A",
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 60,
                      height: 34,
                      borderRadius: 4,
                      backgroundColor: "#16161A",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="tv-outline" size={14} color="#52525B" />
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
                        color: "#F4F4F5",
                      }}
                      numberOfLines={1}
                    >
                      E{epNum} · {episode.name || "Untitled"}
                    </Text>
                    {episode.runtime ? (
                      <Text
                        style={{
                          fontSize: 10,
                          color: "#52525B",
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
                        backgroundColor: "rgba(255,255,255,0.1)",
                        marginTop: 4,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.round(progress.percent * 100)}%`,
                          height: "100%",
                          backgroundColor:
                            progress.percent >= 0.95 ? "#4caf82" : "#D4A237",
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
                  <Ionicons name="play" size={14} color="#A1A1AA" />

                  {/* Download icon - links directly */}
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push(
                        `/download/nxsha/tv/${tmdbId}/${selectedSeason}/${epNum}` as any,
                      );
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={`Download episode ${epNum}`}
                  >
                    <Ionicons
                      name="download-outline"
                      size={14}
                      color="#52525B"
                    />
                  </TouchableOpacity>
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
                backgroundColor: "rgba(39,39,42,0.3)",
                marginTop: 2,
              }}
            >
              <Text
                style={{
                  color: "#D4A237",
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
            color: "#52525B",
            fontSize: 13,
            fontFamily: "Inter_400Regular",
            textAlign: "center",
            paddingVertical: 20,
          }}
        >
          No episodes found
        </Text>
      )}

      {/* Batch confirmation sheet */}
      <Modal
        visible={showBatchSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBatchSheet(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowBatchSheet(false)}
          />
          <View
            style={{
              backgroundColor: "#18181B",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 20,
              paddingBottom: 40,
            }}
          >
            <View style={{ alignItems: "center", paddingVertical: 12 }}>
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "#3f3f3f",
                }}
              />
            </View>

            <Text
              style={{
                fontSize: 16,
                fontFamily: "Inter_600SemiBold",
                color: "#F4F4F5",
                marginBottom: 4,
              }}
            >
              Download Season {selectedSeason}
            </Text>
            <Text
              style={{
                fontSize: 13,
                fontFamily: "Inter_400Regular",
                color: "#A1A1AA",
                marginBottom: 16,
              }}
            >
              {episodes.length} episodes · {settings.downloadQuality}
            </Text>

            {/* Estimate size */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons
                name="cloud-download-outline"
                size={14}
                color="#52525B"
                style={{ marginRight: 6 }}
              />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  color: "#52525B",
                }}
              >
                ~{(episodes.length * 0.5).toFixed(1)} GB estimated
              </Text>
            </View>

            {/* Actions */}
            <TouchableOpacity
              onPress={() => {
                setShowBatchSheet(false);
                // Enqueue each episode at default quality
                let count = 0;
                for (const ep of episodes) {
                  const epNum = ep.episode_number;
                  enqueue({
                    url: "",
                    fileName: `S${selectedSeason}E${String(epNum).padStart(2, "0")}.mp4`,
                    server: "nxsha",
                    mediaType: "tv",
                    tmdbId,
                    season: selectedSeason,
                    episode: epNum,
                    quality: settings.downloadQuality,
                    title: `S${selectedSeason}·E${epNum}`,
                  });
                  count++;
                }
                downloadToast.success(`Queued ${count} episodes for download`);
              }}
              activeOpacity={0.9}
              style={{
                backgroundColor: "#D4A237",
                borderRadius: 10,
                paddingVertical: 14,
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: "#070708",
                }}
              >
                Download All
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowBatchSheet(false)}
              activeOpacity={0.7}
              style={{ paddingVertical: 12, alignItems: "center" }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_500Medium",
                  color: "#71717A",
                }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
