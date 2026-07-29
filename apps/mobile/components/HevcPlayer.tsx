/**
 * HevcPlayer — Native HEVC video player using expo-video.
 *
 * Plays direct video URLs (MKV/MP4) with hardware-accelerated decoding.
 * Used for Falix provider content which serves HEVC-encoded MKV files.
 *
 * Features:
 * - Hardware HEVC decoding (AVPlayer on iOS, ExoPlayer on Android)
 * - Custom glassmorphism controls matching existing player style
 * - Audio track selection for multi-language content
 * - Subtitle/text track selection
 * - Progress tracking with watch history save
 * - Landscape orientation in fullscreen
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ScreenOrientation from "expo-screen-orientation";
import * as KeepAwake from "expo-keep-awake";
import { colors } from "../theme/colors";
import { AudioTrackPicker } from "./player/AudioTrackPicker";
import { SubtitlePicker } from "./player/SubtitlePicker";
import { saveProgress } from "../lib/watchHistory";

interface HevcPlayerProps {
  videoUrl: string;
  tmdbId?: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
  startAt?: number;
  title?: string;
  onClose: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export function HevcPlayer({
  videoUrl,
  tmdbId,
  mediaType = "movie",
  season,
  episode,
  startAt = 0,
  title = "",
  onClose,
}: HevcPlayerProps) {
  const insets = useSafeAreaInsets();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [showSubtitlePicker, setShowSubtitlePicker] = useState(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const playerRef = useRef<VideoPlayer | null>(null);

  // Create video player
  const player = useVideoPlayer(videoUrl, (playerInstance) => {
    playerInstance.loop = false;
    playerRef.current = playerInstance;

    // Set initial position
    if (startAt > 0) {
      playerInstance.currentTime = startAt;
    }
  });

  playerRef.current = player;

  // Auto-hide controls after 5 seconds
  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    setShowControls(true);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 5000);
  }, [isPlaying]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    setIsPlaying(!isPlaying);
    resetControlsTimeout();
  }, [isPlaying, player, resetControlsTimeout]);

  // Seek to position
  const seekTo = useCallback(
    (time: number) => {
      player.currentTime = Math.max(0, Math.min(time, duration));
      resetControlsTimeout();
    },
    [player, duration, resetControlsTimeout],
  );

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT,
      );
      setIsFullscreen(false);
    } else {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE,
      );
      setIsFullscreen(true);
    }
    resetControlsTimeout();
  }, [isFullscreen, resetControlsTimeout]);

  // Handle close
  const handleClose = useCallback(async () => {
    // Save progress before closing
    if (tmdbId && currentTime > 0 && duration > 0) {
      await saveProgress({
        tmdbId,
        mediaType,
        season,
        episode,
        currentTime,
        duration,
        percent: Math.round((currentTime / duration) * 100),
        updatedAt: Date.now(),
        completed: false,
      });
    }

    // Restore portrait orientation
    if (isFullscreen) {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT,
      );
    }

    onClose();
  }, [
    tmdbId,
    mediaType,
    season,
    episode,
    currentTime,
    duration,
    isFullscreen,
    onClose,
  ]);

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Handle player status updates
  useEffect(() => {
    const subscription = player.addListener("statusChange", (status) => {
      setIsBuffering(status.status === "loading");
      if (status.status === "readyToPlay") {
        setIsBuffering(false);
      }
    });

    return () => subscription.remove();
  }, [player]);

  // Handle time updates
  useEffect(() => {
    const subscription = player.addListener("timeUpdate", (update) => {
      setCurrentTime(update.currentTime);
      setDuration(player.duration);
    });

    return () => subscription.remove();
  }, [player]);

  // Handle playback state
  useEffect(() => {
    const subscription = player.addListener("playingChange", (update) => {
      setIsPlaying(update.isPlaying);
    });

    return () => subscription.remove();
  }, [player]);

  // Keep screen awake during playback
  useEffect(() => {
    if (isPlaying) {
      KeepAwake.activateKeepAwakeAsync();
    } else {
      KeepAwake.deactivateKeepAwake();
    }

    return () => {
      KeepAwake.deactivateKeepAwake();
    };
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Handle tap on video area
  const handleVideoTap = useCallback(() => {
    if (showControls) {
      setShowControls(false);
    } else {
      resetControlsTimeout();
    }
  }, [showControls, resetControlsTimeout]);

  const seekForward = useCallback(() => {
    seekTo(currentTime + 10);
  }, [currentTime, seekTo]);

  const seekBackward = useCallback(() => {
    seekTo(currentTime - 10);
  }, [currentTime, seekTo]);

  return (
    <View style={styles.container}>
      <StatusBar hidden={isFullscreen} />

      {/* Video View */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={handleVideoTap}
        style={[
          styles.videoContainer,
          isFullscreen && styles.videoContainerFullscreen,
        ]}
      >
        <VideoView
          style={[styles.video, isFullscreen && styles.videoFullscreen]}
          player={player}
          allowsPictureInPicture={false}
          fullscreenOptions={{ enable: false }}
        />
      </TouchableOpacity>

      {/* Controls Overlay */}
      {showControls && (
        <View style={styles.controlsOverlay}>
          {/* Top Bar */}
          <View
            style={[
              styles.topBar,
              { paddingTop: (isFullscreen ? 8 : insets.top) + 8 },
            ]}
          >
            <TouchableOpacity
              onPress={handleClose}
              style={styles.controlButton}
              activeOpacity={0.7}
            >
              <Ionicons
                name="chevron-down"
                size={24}
                color={colors.textPrimary}
              />
            </TouchableOpacity>

            <Text style={styles.title} numberOfLines={1}>
              {title || "HEVC Player"}
            </Text>

            <View style={styles.topRightButtons}>
              <TouchableOpacity
                onPress={() => setShowAudioPicker(true)}
                style={styles.controlButton}
                activeOpacity={0.7}
              >
                <Ionicons name="musical-notes" size={20} color={colors.gold} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowSubtitlePicker(true)}
                style={styles.controlButton}
                activeOpacity={0.7}
              >
                <Ionicons name="text" size={20} color={colors.gold} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={toggleFullscreen}
                style={styles.controlButton}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isFullscreen ? "contract" : "expand"}
                  size={20}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Center Play/Pause */}
          <View style={styles.centerControls}>
            <TouchableOpacity
              onPress={seekBackward}
              style={styles.seekButton}
              activeOpacity={0.7}
            >
              <Ionicons name="play-back" size={32} color={colors.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={togglePlayPause}
              style={styles.playButton}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={40}
                color={colors.bg}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={seekForward}
              style={styles.seekButton}
              activeOpacity={0.7}
            >
              <Ionicons
                name="play-forward"
                size={32}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          </View>

          {/* Bottom Bar */}
          <View
            style={[
              styles.bottomBar,
              { paddingBottom: (isFullscreen ? 8 : insets.bottom) + 8 },
            ]}
          >
            {/* Time Display */}
            <Text style={styles.timeText}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>

            {/* Seek Bar */}
            <View style={styles.seekBarContainer}>
              <View style={styles.seekBarBackground}>
                <View
                  style={[
                    styles.seekBarProgress,
                    {
                      width:
                        duration > 0
                          ? `${(currentTime / duration) * 100}%`
                          : "0%",
                    },
                  ]}
                />
              </View>
              <TouchableOpacity
                style={styles.seekBarTouch}
                onPress={(e) => {
                  const { locationX } = e.nativeEvent;
                  const barWidth = SCREEN_WIDTH - 32;
                  const percent = locationX / barWidth;
                  seekTo(percent * duration);
                }}
              />
            </View>

            {/* Format Badge */}
            <View style={styles.formatBadge}>
              <Text style={styles.formatBadgeText}>HEVC</Text>
            </View>
          </View>
        </View>
      )}

      {/* Loading Overlay */}
      {isBuffering && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.gold} />
          <Text style={styles.loadingText}>Loading video...</Text>
        </View>
      )}

      {/* Audio Track Picker Modal */}
      <AudioTrackPicker
        visible={showAudioPicker}
        player={player}
        onClose={() => setShowAudioPicker(false)}
      />

      {/* Subtitle Picker Modal */}
      <SubtitlePicker
        visible={showSubtitlePicker}
        player={player}
        onClose={() => setShowSubtitlePicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.playerBg,
  },
  videoContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  videoContainerFullscreen: {
    // Fullscreen is handled by orientation lock
  },
  video: {
    width: "100%",
    height: "100%",
  },
  videoFullscreen: {
    width: SCREEN_HEIGHT,
    height: SCREEN_WIDTH,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    zIndex: 10,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
    marginHorizontal: 12,
  },
  topRightButtons: {
    flexDirection: "row",
    gap: 8,
  },
  centerControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
  },
  seekButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  timeText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 8,
  },
  seekBarContainer: {
    position: "relative",
    height: 20,
    justifyContent: "center",
  },
  seekBarBackground: {
    height: 4,
    backgroundColor: colors.progressTrackAlt,
    borderRadius: 2,
    overflow: "hidden",
  },
  seekBarProgress: {
    height: "100%",
    backgroundColor: colors.gold,
    borderRadius: 2,
  },
  seekBarTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  formatBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.goldBadge,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 8,
  },
  formatBadgeText: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "700",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 12,
  },
});
